import { afterEach, describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createBridge } from "../src/application/bridge";
import { createBridges } from "../src/application/bridges";
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
  const server = startMcpServer({ bridges: createBridges({ default: bridge }), token: TOKEN, port: 0 });
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

describe("files", () => {
  test("answer_task attaches text files and binary files, so that long work goes in a file", async () => {
    const { bridge, discord, url } = setup();
    await bridge.giveTask(mention);
    const client = await connect(url);

    const result = await client.callTool({
      name: "answer_task",
      arguments: {
        task_id: "task-1",
        text: "Sign ready.",
        files: [
          { name: "sign.svg", content: "<svg/>" },
          { name: "note.txt", content_base64: Buffer.from("hej").toString("base64") },
        ],
      },
    });

    expect(result.isError).toBeFalsy();
    expect(discord.sent).toEqual([
      {
        channelId: "c1",
        replyTo: "m1",
        text: "Sign ready.",
        files: [
          { name: "sign.svg", text: "<svg/>" },
          { name: "note.txt", text: "hej" },
        ],
      },
    ]);
  });

  test("tells Grok Bot what is wrong when a file has no content or two contents", async () => {
    const { url } = setup();
    const client = await connect(url);

    const none = await client.callTool({ name: "send_message", arguments: { channel_id: "c1", text: "x", files: [{ name: "a.svg" }] } });
    const two = await client.callTool({
      name: "send_message",
      arguments: { channel_id: "c1", text: "x", files: [{ name: "a.svg", content: "<svg/>", content_base64: "PHN2Zy8+" }] },
    });

    expect(textOf(none)).toBe('The file "a.svg" must have content or content_base64, not both and not none.');
    expect(textOf(two)).toBe('The file "a.svg" must have content or content_base64, not both and not none.');
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

    expect(JSON.parse(textOf(result))).toEqual([{ id: "c1", name: "general", server: "Team", bots: ["default"] }]);
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

describe("more than one Discord bot", () => {
  function setupTwo() {
    const discords = { pia: new FakeDiscord(), ditte: new FakeDiscord() };
    const bridgeFor = (name: "pia" | "ditte") =>
      createBridge({
        discord: discords[name],
        routine: new FakeRoutine(),
        tasks: openTaskStore(":memory:", name),
        clock: () => new Date(),
        newTaskId: () => `${name}-task`,
        log: () => {},
      });
    const bridges = { pia: bridgeFor("pia"), ditte: bridgeFor("ditte") };
    const server = startMcpServer({
      bridges: createBridges(bridges, { userIds: { pia: "pia-user", ditte: "ditte-user" } }),
      token: TOKEN,
      port: 0,
    });
    cleanups.push(() => server.stop());
    return { discords, bridges, url: server.url };
  }

  test("each tool acts as the Discord bot that Grok Bot names", async () => {
    const { discords, url } = setupTwo();
    const client = await connect(url);

    await client.callTool({ name: "send_message", arguments: { bot: "pia", channel_id: "c1", text: "From Pia" } });
    await client.callTool({ name: "add_reaction", arguments: { bot: "ditte", channel_id: "c1", message_id: "m1", emoji: "✅" } });

    expect(discords.pia.sent).toEqual([{ channelId: "c1", text: "From Pia" }]);
    expect(discords.pia.reactions).toEqual([]);
    expect(discords.ditte.sent).toEqual([]);
    expect(discords.ditte.reactions).toEqual([{ channelId: "c1", messageId: "m1", emoji: "✅" }]);
  });

  test("Grok Bot sees the names of the Discord bots in the tools", async () => {
    const { url } = setupTwo();
    const client = await connect(url);

    const { tools } = await client.listTools();
    const send = tools.find((t) => t.name === "send_message")!;

    expect((send.inputSchema.properties as Record<string, { description: string }>).bot!.description).toContain("pia, ditte");
  });

  test("a tool call without a bot does nothing, because the Bridge cannot know which bot must act", async () => {
    const { discords, url } = setupTwo();
    const client = await connect(url);

    const result = await client.callTool({ name: "send_message", arguments: { channel_id: "c1", text: "Hi" } });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe('Set "bot" to the name of a Discord bot: pia, ditte.');
    expect(discords.pia.sent).toEqual([]);
    expect(discords.ditte.sent).toEqual([]);
  });

  test("tells Grok Bot the correct names when a bot does not exist", async () => {
    const { url } = setupTwo();
    const client = await connect(url);

    const result = await client.callTool({ name: "read_messages", arguments: { bot: "Pia", channel_id: "c1" } });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe('There is no Discord bot with the name "Pia". The names are: pia, ditte.');
  });

  test("answer_task posts the Answer as the bot that received the Task, without a bot setting", async () => {
    const { discords, bridges, url } = setupTwo();
    await bridges.ditte.giveTask(mention);
    const client = await connect(url);

    const result = await client.callTool({ name: "answer_task", arguments: { task_id: "ditte-task", text: "Done." } });

    expect(result.isError).toBeFalsy();
    expect(discords.ditte.sent).toEqual([{ channelId: "c1", replyTo: "m1", text: "Done." }]);
    expect(discords.pia.sent).toEqual([]);
  });

  test("answer_task and send_message can mention a different bot, so that the bots can give each other tasks", async () => {
    const { discords, bridges, url } = setupTwo();
    await bridges.ditte.giveTask(mention);
    const client = await connect(url);

    await client.callTool({ name: "answer_task", arguments: { task_id: "ditte-task", text: "what is next?", mention: ["pia"] } });
    await client.callTool({ name: "send_message", arguments: { bot: "pia", channel_id: "c1", text: "a logo?", mention: ["ditte"] } });

    expect(discords.ditte.sent).toEqual([
      { channelId: "c1", replyTo: "m1", text: "<@pia-user> what is next?", mentions: ["pia-user"] },
    ]);
    expect(discords.pia.sent).toEqual([{ channelId: "c1", text: "<@ditte-user> a logo?", mentions: ["ditte-user"] }]);
  });

  test("list_channels shows which bots can see each channel", async () => {
    const { discords, url } = setupTwo();
    discords.pia.channels = [
      { id: "c1", name: "general", guildName: "Team" },
      { id: "c2", name: "support", guildName: "Team" },
    ];
    discords.ditte.channels = [{ id: "c1", name: "general", guildName: "Team" }];
    const client = await connect(url);

    const result = await client.callTool({ name: "list_channels", arguments: {} });

    expect(JSON.parse(textOf(result))).toEqual([
      { id: "c1", name: "general", server: "Team", bots: ["pia", "ditte"] },
      { id: "c2", name: "support", server: "Team", bots: ["pia"] },
    ]);
  });
});
