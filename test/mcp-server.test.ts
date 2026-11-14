import { afterEach, describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createBridge } from "../src/application/bridge";
import { openTaskStore } from "../src/adapters/sqlite-task-store";
import { startMcpServer } from "../src/adapters/mcp-server";
import { FakeDiscord, FakeRoutine } from "./support/fakes";

const TOKEN = "connector-token";
const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

function setup() {
  const discord = new FakeDiscord();
  const bridge = createBridge({
    discord,
    routine: new FakeRoutine(),
    tasks: openTaskStore(":memory:"),
    clock: () => new Date("2026-11-14T12:00:00Z"),
    newTaskId: () => "task-1",
    log: () => {},
  });
  const server = startMcpServer({ bridge, token: TOKEN, port: 0 });
  cleanups.push(() => server.stop());
  return { bridge, discord, url: server.url };
}

/** Connects a real MCP client, as Grok Bot does when it uses the custom connector. */
async function connect(url: URL, token = TOKEN) {
  const client = new Client({ name: "test-grok-bot", version: "1.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(url, { requestInit: { headers: { Authorization: `Bearer ${token}` } } }),
  );
  cleanups.push(() => client.close());
  return client;
}

describe("connector access", () => {
  test("the MCP server refuses a request without the connector token", async () => {
    const { url } = setup();

    const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });

    expect(response.status).toBe(401);
  });
});

describe("Discord tools", () => {
  test("Grok Bot sees the Discord tools", async () => {
    const { url } = setup();
    const client = await connect(url);

    const { tools } = await client.listTools();

    expect(tools.map((t) => t.name).sort()).toEqual([
      "add_reaction",
      "answer_task",
      "list_channels",
      "read_messages",
      "send_message",
    ]);
  });
});

const mention = {
  messageId: "m1",
  channelId: "c1",
  channelName: "general",
  guildId: "g1",
  requester: { id: "u1", name: "Ada" },
  text: "Find the bug",
};

function textOf(result: Awaited<ReturnType<Client["callTool"]>>): string {
  return (result.content as Array<{ type: string; text: string }>).map((c) => c.text).join("");
}

describe("answer_task", () => {
  test("posts the Answer as a reply to the origin message", async () => {
    const { bridge, discord, url } = setup();
    await bridge.giveTask(mention);
    const client = await connect(url);

    const result = await client.callTool({ name: "answer_task", arguments: { task_id: "task-1", text: "Fixed." } });

    expect(result.isError).toBeFalsy();
    expect(discord.sent).toEqual([{ channelId: "c1", replyTo: "m1", text: "Fixed." }]);
  });

  test("tells Grok Bot what is wrong when the Task does not exist", async () => {
    const { url } = setup();
    const client = await connect(url);

    const result = await client.callTool({ name: "answer_task", arguments: { task_id: "nope", text: "Fixed." } });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe('There is no task with the ID "nope".');
  });
});

describe("send_message", () => {
  test("sends a message to any channel, also as a reply, and returns the new message IDs", async () => {
    const { discord, url } = setup();
    const client = await connect(url);

    const plain = await client.callTool({ name: "send_message", arguments: { channel_id: "c9", text: "Report ready." } });
    await client.callTool({ name: "send_message", arguments: { channel_id: "c9", text: "Done.", reply_to: "m7" } });

    expect(discord.sent).toEqual([
      { channelId: "c9", text: "Report ready." },
      { channelId: "c9", text: "Done.", replyTo: "m7" },
    ]);
    expect(textOf(plain)).toBe("Sent. Message IDs: 1000");
  });
});

describe("read_messages", () => {
  test("returns the messages of a channel as JSON, oldest first", async () => {
    const { discord, url } = setup();
    discord.history.set("c1", [
      { id: "m1", authorId: "u1", authorName: "Ada", text: "Is the build green?", sentAt: new Date("2026-11-14T09:00:00Z") },
      { id: "m2", authorId: "u2", authorName: "Bob", text: "No, test 3 fails.", sentAt: new Date("2026-11-14T09:01:00Z") },
    ]);
    const client = await connect(url);

    const result = await client.callTool({ name: "read_messages", arguments: { channel_id: "c1", limit: 10 } });

    expect(JSON.parse(textOf(result))).toEqual([
      { id: "m1", author: { id: "u1", name: "Ada" }, text: "Is the build green?", sent_at: "2026-11-14T09:00:00.000Z" },
      { id: "m2", author: { id: "u2", name: "Bob" }, text: "No, test 3 fails.", sent_at: "2026-11-14T09:01:00.000Z" },
    ]);
  });
});

describe("add_reaction and list_channels", () => {
  test("add_reaction adds an emoji to a message", async () => {
    const { discord, url } = setup();
    const client = await connect(url);

    await client.callTool({ name: "add_reaction", arguments: { channel_id: "c1", message_id: "m5", emoji: "✅" } });

    expect(discord.reactions).toEqual([{ channelId: "c1", messageId: "m5", emoji: "✅" }]);
  });

  test("list_channels shows the channels where Grok Bot can act", async () => {
    const { discord, url } = setup();
    discord.channels = [{ id: "c1", name: "general", guildName: "Team" }];
    const client = await connect(url);

    const result = await client.callTool({ name: "list_channels", arguments: {} });

    expect(JSON.parse(textOf(result))).toEqual([{ id: "c1", name: "general", server: "Team" }]);
  });
});

describe("Discord errors", () => {
  test("sends a Discord error to Grok Bot as a tool error, with the Discord message", async () => {
    const { discord, url } = setup();
    discord.sendMessage = async () => {
      throw new Error("Missing Permissions");
    };
    const client = await connect(url);

    const result = await client.callTool({ name: "send_message", arguments: { channel_id: "c1", text: "Hi" } });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe("Discord did not do the action: Missing Permissions");
  });
});
