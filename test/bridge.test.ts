import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBridge } from "../src/application/bridge";
import { openTaskStore } from "../src/adapters/sqlite-task-store";
import { FakeDiscord, FakeRoutine } from "./support/fakes";

function setup() {
  const discord = new FakeDiscord();
  const routine = new FakeRoutine();
  let n = 0;
  const bridge = createBridge({
    discord,
    routine,
    tasks: openTaskStore(":memory:"),
    clock: () => new Date("2026-11-14T12:00:00Z"),
    newTaskId: () => `task-${++n}`,
    log: () => {},
  });
  return { bridge, discord, routine };
}

const mention = {
  messageId: "m1",
  channelId: "c1",
  channelName: "general",
  guildId: "g1",
  requester: { id: "u1", name: "Ada" },
  text: "Find the bug in issue 42",
};

describe("give a Task", () => {
  test("the Bridge sends a mention to the Routine as a Task, with its Requester and origin message", async () => {
    const { bridge, routine } = setup();

    await bridge.giveTask(mention);

    expect(routine.handoffs).toEqual([
      {
        id: "task-1",
        text: "Find the bug in issue 42",
        requester: { id: "u1", name: "Ada" },
        origin: { messageId: "m1", channelId: "c1", channelName: "general", guildId: "g1" },
        createdAt: new Date("2026-11-14T12:00:00Z"),
      },
    ]);
  });

  test("the Requester sees that Grok Bot received the Task", async () => {
    const { bridge, discord } = setup();

    await bridge.giveTask(mention);

    expect(discord.reactions).toEqual([{ channelId: "c1", messageId: "m1", emoji: "👀" }]);
  });

  test("if the Handoff fails, the Bridge tells the Requester and does not show that Grok Bot received the Task", async () => {
    const { bridge, discord, routine } = setup();
    routine.failWith = new Error("HTTP 401");

    await bridge.giveTask(mention);

    expect(discord.reactions).toEqual([]);
    expect(discord.sent).toEqual([
      { channelId: "c1", replyTo: "m1", text: "⚠️ The Bridge could not give this task to Grok Bot. Try again later." },
    ]);
  });
});

describe("answer a Task", () => {
  test("the Bridge posts an Answer in the origin channel, as a reply to the origin message", async () => {
    const { bridge, discord } = setup();
    await bridge.giveTask(mention);

    await bridge.answerTask("task-1", "The bug is in parser.ts, line 12.");

    expect(discord.sent).toEqual([{ channelId: "c1", replyTo: "m1", text: "The bug is in parser.ts, line 12." }]);
  });
});

describe("answer a Task that does not exist", () => {
  test("the Bridge refuses it with an error that shows the task ID", async () => {
    const { bridge, discord } = setup();

    expect(bridge.answerTask("task-404", "Hello")).rejects.toThrow('There is no task with the ID "task-404".');
    expect(discord.sent).toEqual([]);
  });
});

describe("Answers without text", () => {
  test("the Bridge refuses an Answer without text, because Discord cannot send an empty message", async () => {
    const { bridge, discord } = setup();
    await bridge.giveTask(mention);

    expect(bridge.answerTask("task-1", "   ")).rejects.toThrow("The message has no text.");
    expect(discord.sent).toEqual([]);
  });
});

describe("Discord tools outside a Task", () => {
  test("Grok Bot can send a message to any channel, also as a reply", async () => {
    const { bridge, discord } = setup();

    await bridge.sendMessage("c9", "Daily report is ready.");
    await bridge.sendMessage("c9", "Done.", { replyTo: "m7" });

    expect(discord.sent).toEqual([
      { channelId: "c9", text: "Daily report is ready." },
      { channelId: "c9", text: "Done.", replyTo: "m7" },
    ]);
  });

  test("the Bridge refuses a message without text", async () => {
    const { bridge } = setup();
    expect(bridge.sendMessage("c9", "")).rejects.toThrow("The message has no text.");
  });

  test("the Bridge reads a maximum of 100 of the newest messages, oldest first", async () => {
    const { bridge, discord } = setup();
    discord.history.set(
      "c1",
      Array.from({ length: 150 }, (_, i) => ({
        id: `m${i}`,
        authorId: "u1",
        authorName: "Ada",
        text: `message ${i}`,
        sentAt: new Date(Date.UTC(2026, 10, 14, 0, i)),
      })),
    );

    const messages = await bridge.readMessages("c1", { limit: 500 });

    expect(messages).toHaveLength(100);
    expect(messages[0]!.id).toBe("m50");
    expect(messages.at(-1)!.id).toBe("m149");
  });
});

describe("restart of the Bridge", () => {
  test("Grok Bot can answer a Task from before the Bridge started again", async () => {
    const file = join(mkdtempSync(join(tmpdir(), "bridge-")), "tasks.sqlite");
    const discord = new FakeDiscord();
    const deps = { discord, routine: new FakeRoutine(), clock: () => new Date(), newTaskId: () => "task-1", log: () => {} };

    await createBridge({ ...deps, tasks: openTaskStore(file) }).giveTask(mention);
    const restarted = createBridge({ ...deps, tasks: openTaskStore(file) });
    await restarted.answerTask("task-1", "Done.");

    expect(discord.sent).toEqual([{ channelId: "c1", replyTo: "m1", text: "Done." }]);
  });
});
