import { timingSafeEqual } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import { Refusal } from "../application/bridge";
import type { Bridges } from "../application/bridges";
import type { Attachment } from "../application/ports";

export interface McpServerOptions {
  bridges: Bridges;
  /** The bearer token that Grok Bot sends in the HTTP headers of the custom connector. */
  token: string;
  port: number;
  hostname?: string;
}

/**
 * Gives the Discord tools to Grok Bot as an MCP server over Streamable HTTP.
 * One connector is sufficient for all bots: Grok Bot names the bot in each tool call.
 */
export function startMcpServer(options: McpServerOptions) {
  const server = Bun.serve({
    port: options.port,
    hostname: options.hostname,
    async fetch(request) {
      if (new URL(request.url).pathname.replace(/\/+$/, "") !== "/mcp") return new Response("Not Found", { status: 404 });
      if (!hasToken(request, options.token)) {
        return new Response("Unauthorized", { status: 401, headers: { "WWW-Authenticate": "Bearer" } });
      }
      // Stateless mode: the Bridge makes a new MCP server and transport for each request.
      const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      const mcp = createDiscordTools(options.bridges);
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

type FileInput = { name: string; content?: string | undefined; content_base64?: string | undefined };

/** Changes the files from the tool call into attachments. Text files use content, binary files use content_base64. */
function toAttachments(files: FileInput[] | undefined): Attachment[] | undefined {
  return files?.map((file) => {
    if ((file.content === undefined) === (file.content_base64 === undefined)) {
      throw new Refusal(`The file "${file.name}" must have content or content_base64, not both and not none.`);
    }
    const data = file.content !== undefined ? new TextEncoder().encode(file.content) : Buffer.from(file.content_base64!, "base64");
    return { name: file.name, data: new Uint8Array(data) };
  });
}

function sentReport({ messageIds }: { messageIds: string[] }): string {
  return `Sent. Message IDs: ${messageIds.join(", ")}`;
}

function createDiscordTools(bridges: Bridges): McpServer {
  const mcp = new McpServer({ name: "discord-bridge", version: "0.3.0" });
  const several = bridges.names.length > 1;
  const bot = z
    .string()
    .optional()
    .describe(
      several
        ? `The name of the Discord bot that does the action: ${bridges.names.join(", ")}. Use the bot of your routine.`
        : `The name of the Discord bot: ${bridges.names[0]}. You can omit it.`,
    );
  const files = z
    .array(
      z.object({
        name: z.string().describe('The file name with its extension, for example "napoli-sign-A6.svg".'),
        content: z.string().optional().describe("The content of a text file, for example SVG, Markdown, CSV, or code."),
        content_base64: z.string().optional().describe("The content of a binary file in base64, for example PDF or PNG."),
      }),
    )
    .optional()
    .describe(
      "Files to attach, a maximum of 10 and 10 MB together. Put long work in a file, for example a design, a document, or code, and write one short line about it in the text.",
    );
  const mention = z
    .array(z.string())
    .optional()
    .describe(
      several
        ? `The names of different bots to mention: ${bridges.names.join(", ")}. You can also write "@name" in the text, for example "@${bridges.names[0]}". A mentioned bot receives your message as a task. A reply to a message of a bot also gives that bot a task. To end a conversation with a bot, do not answer, or add a reaction. Bots can give each other a maximum of ${bridges.maxBotSteps} tasks in one conversation. A message that is not a reply starts a new conversation. You cannot mention persons or roles.`
        : "Not used. There is only one bot.",
    );
  mcp.registerTool(
    "answer_task",
    {
      description:
        "Post your Answer to a Discord task. The Requester sees it as a reply to their message. Use the task_id from the task that the routine received. The Bridge divides long text into more than one message.",
      inputSchema: {
        task_id: z.string().describe("The task_id from the task."),
        text: z.string().describe("The Answer. You can use Discord Markdown. It can be empty if you attach files."),
        mention,
        files,
      },
    },
    ({ task_id, text, mention: names, files: input }) =>
      run(async () => sentReport(await bridges.answerTask(task_id, text, names, toAttachments(input)))),
  );
  mcp.registerTool(
    "send_message",
    {
      description:
        "Send a message to a Discord channel. To answer a task, use answer_task. Set reply_to to make the message a reply to a different message.",
      inputSchema: {
        bot,
        channel_id: z.string().describe("The ID of the channel. Use list_channels to find it."),
        text: z.string().describe("The message. You can use Discord Markdown."),
        reply_to: z.string().optional().describe("The ID of a message to reply to."),
        mention,
        files,
      },
    },
    ({ bot: name, channel_id, text, reply_to, mention: names, files: input }) =>
      run(async () => {
        const attachments = toAttachments(input);
        return sentReport(
          await bridges.sendMessage(name, channel_id, text, {
            ...(reply_to ? { replyTo: reply_to } : {}),
            ...(names ? { mention: names } : {}),
            ...(attachments ? { files: attachments } : {}),
          }),
        );
      }),
  );
  mcp.registerTool(
    "read_messages",
    {
      description:
        "Read the last messages of a Discord channel, oldest first. Use this tool to read the conversation before a task message.",
      inputSchema: {
        bot,
        channel_id: z.string().describe("The ID of the channel."),
        limit: z.number().int().optional().describe("The number of messages, from 1 to 100. The default is 20."),
        before: z.string().optional().describe("Read only the messages before the message with this ID."),
      },
    },
    ({ bot: name, channel_id, limit, before }) =>
      run(async () => {
        const messages = await bridges.bot(name).readMessages(channel_id, { limit: limit ?? 20, ...(before ? { before } : {}) });
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
        bot,
        channel_id: z.string().describe("The ID of the channel."),
        message_id: z.string().describe("The ID of the message."),
        emoji: z.string().describe('A Unicode emoji, for example "✅".'),
      },
    },
    ({ bot: name, channel_id, message_id, emoji }) =>
      run(async () => {
        await bridges.bot(name).addReaction(channel_id, message_id, emoji);
        return "Added.";
      }),
  );
  mcp.registerTool(
    "list_channels",
    { description: "List the Discord text channels where you can read and send messages, and the bots that can see each channel." },
    () =>
      run(async () =>
        JSON.stringify(
          (await bridges.listChannels()).map((c) => ({ id: c.id, name: c.name, server: c.guildName, bots: c.bots })),
        ),
      ),
  );
  return mcp;
}
