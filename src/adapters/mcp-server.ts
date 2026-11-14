import { timingSafeEqual } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import { Refusal, type Bridge } from "../application/bridge";

export interface McpServerOptions {
  bridge: Bridge;
  /** The bearer token that Grok Bot sends in the HTTP headers of the custom connector. */
  token: string;
  port: number;
  hostname?: string;
}

/** Gives the Discord tools to Grok Bot as an MCP server over Streamable HTTP. */
export function startMcpServer(options: McpServerOptions) {
  const server = Bun.serve({
    port: options.port,
    hostname: options.hostname,
    async fetch(request) {
      if (!hasToken(request, options.token)) {
        return new Response("Unauthorized", { status: 401, headers: { "WWW-Authenticate": "Bearer" } });
      }
      // Stateless mode: the Bridge makes a new MCP server and transport for each request.
      const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      const mcp = createDiscordTools(options.bridge);
      await mcp.connect(transport);
      return transport.handleRequest(request);
    },
  });

  return {
    url: new URL("/mcp", server.url),
    stop: () => server.stop(true),
  };
}

function hasToken(request: Request, token: string): boolean {
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${token}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

type ToolResult = { content: Array<{ type: "text"; text: string }>; isError?: boolean };

/** Runs a tool. The Bridge sends each error to Grok Bot as a tool error. Thus, Grok Bot can correct its call. */
async function run(action: () => Promise<string>): Promise<ToolResult> {
  try {
    return { content: [{ type: "text", text: await action() }] };
  } catch (error) {
    const text =
      error instanceof Refusal
        ? error.message
        : `Discord did not do the action: ${error instanceof Error ? error.message : String(error)}`;
    return { content: [{ type: "text", text }], isError: true };
  }
}

function sentReport({ messageIds }: { messageIds: string[] }): string {
  return `Sent. Message IDs: ${messageIds.join(", ")}`;
}

function createDiscordTools(bridge: Bridge): McpServer {
  const mcp = new McpServer({ name: "discord-bridge", version: "0.2.0" });
  mcp.registerTool(
    "answer_task",
    {
      description:
        "Post your Answer to a Discord task. The Requester sees it as a reply to their message. Use the task_id from the task that the routine received. The Bridge divides long text into more than one message.",
      inputSchema: {
        task_id: z.string().describe("The task_id from the task."),
        text: z.string().describe("The Answer. You can use Discord Markdown."),
      },
    },
    ({ task_id, text }) => run(async () => sentReport(await bridge.answerTask(task_id, text))),
  );
  mcp.registerTool(
    "send_message",
    {
      description:
        "Send a message to a Discord channel. To answer a task, use answer_task. Set reply_to to make the message a reply to a different message.",
      inputSchema: {
        channel_id: z.string().describe("The ID of the channel. Use list_channels to find it."),
        text: z.string().describe("The message. You can use Discord Markdown."),
        reply_to: z.string().optional().describe("The ID of a message to reply to."),
      },
    },
    ({ channel_id, text, reply_to }) =>
      run(async () => sentReport(await bridge.sendMessage(channel_id, text, reply_to ? { replyTo: reply_to } : undefined))),
  );
  mcp.registerTool(
    "read_messages",
    {
      description:
        "Read the last messages of a Discord channel, oldest first. Use this tool to read the conversation before a task message.",
      inputSchema: {
        channel_id: z.string().describe("The ID of the channel."),
        limit: z.number().int().optional().describe("The number of messages, from 1 to 100. The default is 20."),
        before: z.string().optional().describe("Read only the messages before the message with this ID."),
      },
    },
    ({ channel_id, limit, before }) =>
      run(async () => {
        const messages = await bridge.readMessages(channel_id, { limit: limit ?? 20, ...(before ? { before } : {}) });
        return JSON.stringify(
          messages.map((m) => ({
            id: m.id,
            author: { id: m.authorId, name: m.authorName },
            text: m.text,
            sent_at: m.sentAt.toISOString(),
          })),
        );
      }),
  );
  mcp.registerTool(
    "add_reaction",
    {
      description: "Add an emoji reaction to a Discord message, for example to show progress.",
      inputSchema: {
        channel_id: z.string().describe("The ID of the channel."),
        message_id: z.string().describe("The ID of the message."),
        emoji: z.string().describe('A Unicode emoji, for example "✅".'),
      },
    },
    ({ channel_id, message_id, emoji }) =>
      run(async () => {
        await bridge.addReaction(channel_id, message_id, emoji);
        return "Added.";
      }),
  );
  mcp.registerTool("list_channels", { description: "List the Discord text channels where you can read and send messages." }, () =>
    run(async () =>
      JSON.stringify((await bridge.listChannels()).map((c) => ({ id: c.id, name: c.name, server: c.guildName }))),
    ),
  );
  return mcp;
}
