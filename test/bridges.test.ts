import { describe, expect, test } from "bun:test";
import { createBridge } from "../src/application/bridge";
import { createBridges } from "../src/application/bridges";
import { openTaskStore } from "../src/adapters/sqlite-task-store";
import { FakeDiscord, FakeRouter, FakeRoutine } from "./support/fakes";

function setup(
  options: { maxBotSteps?: number; maxBotConversationsPerHour?: number; displayNames?: Record<string, string[]> } = {},
) {
  const time = { now: new Date("2026-11-14T12:00:00Z") };
  const discord = { pia: new FakeDiscord(), ditte: new FakeDiscord() };
  const routine = { pia: new FakeRoutine(), ditte: new FakeRoutine() };
  const bridgeFor = (name: "pia" | "ditte") => {
    let n = 0;
    return createBridge({
      discord: discord[name],
      routine: routine[name],
      tasks: openTaskStore(":memory:", name),
      clock: () => time.now,
      newTaskId: () => `${name}-task-${++n}`,
      log: () => {},
    });
  };
  const bridge = { pia: bridgeFor("pia"), ditte: bridgeFor("ditte") };
  const bridges = createBridges(bridge, {
    userIds: { pia: "pia-user", ditte: "ditte-user" },
    clock: () => time.now,
    log: () => {},
    ...options,
  });
  return { discord, routine, bridge, bridges, time };
}

const PIA = { id: "pia-user", name: "Pia", isBot: true };
const DITTE = { id: "ditte-user", name: "Ditte", isBot: true };

/** A person gives a Task to Ditte with the message "m1". */
async function personGivesTaskToDitte(bridge: ReturnType<typeof setup>["bridge"]) {
  await bridge.ditte.giveTask({
    messageId: "m1",
    channelId: "c1",
    channelName: "general",
    requester: { id: "u1", name: "hyppa" },
    text: "Ask Pia what to design first",
  });
}

const fromBot = (requester: typeof PIA, messageId: string, text = "What is next?") => ({
  messageId,
  channelId: "c1",
  channelName: "general",
  requester,
  text,
});

describe("Tasks between bots", () => {
  test("a bot gives a Task to a different bot with a reply in the conversation of a Task", async () => {
    const { bridge, bridges, routine, discord } = setup();
    await personGivesTaskToDitte(bridge);

    await bridges.giveTaskFromBot("pia", fromBot(DITTE, "d1"), "m1");

    expect(routine.pia.handoffs).toEqual([
      {
        id: "pia-task-1",
        text: "What is next?",
        requester: { id: "ditte-user", name: "Ditte", isBot: true },
        origin: { messageId: "d1", channelId: "c1", channelName: "general" },
        createdAt: new Date("2026-11-14T12:00:00Z"),
        botSteps: 1,
        conversationId: "ditte-task-1",
      },
    ]);
    expect(discord.pia.reactions).toEqual([{ channelId: "c1", messageId: "d1", emoji: "👀" }]);
  });

  test("a bot message that is not a reply in the conversation of a Task starts a new Conversation, as a message from a person does", async () => {
    const { bridges, routine } = setup();

    await bridges.giveTaskFromBot("pia", fromBot(DITTE, "d1"), undefined);
    await bridges.giveTaskFromBot("pia", fromBot(DITTE, "d2"), "a-message-without-a-task");

    expect(routine.pia.handoffs.map((t) => ({ id: t.id, conversationId: t.conversationId, botSteps: t.botSteps }))).toEqual([
      { id: "pia-task-1", conversationId: "pia-task-1", botSteps: 1 },
      { id: "pia-task-2", conversationId: "pia-task-2", botSteps: 1 },
    ]);
  });

  test("the first Task of a Conversation that a bot starts counts toward the limit of the Conversation", async () => {
    const { bridges, routine, discord } = setup({ maxBotSteps: 2 });
    await bridges.giveTaskFromBot("pia", fromBot(DITTE, "d1"), undefined); // step 1
    await bridges.giveTaskFromBot("ditte", fromBot(PIA, "p1"), "d1"); // step 2

    await bridges.giveTaskFromBot("pia", fromBot(DITTE, "d2"), "p1"); // step 3

    expect(routine.pia.handoffs).toHaveLength(1);
    expect(discord.pia.sent.at(-1)?.text).toContain("2 tasks");
  });

  test("after the maximum number of Tasks between bots in a conversation, the bot refuses the next Task, so that bots cannot give each other Tasks without end", async () => {
    const { bridge, bridges, routine, discord } = setup({ maxBotSteps: 3 });
    await personGivesTaskToDitte(bridge);
    await bridges.giveTaskFromBot("pia", fromBot(DITTE, "d1"), "m1"); // step 1
    await bridges.giveTaskFromBot("ditte", fromBot(PIA, "p1"), "d1"); // step 2
    await bridges.giveTaskFromBot("pia", fromBot(DITTE, "d2"), "p1"); // step 3

    await bridges.giveTaskFromBot("ditte", fromBot(PIA, "p2"), "d2"); // step 4

    expect(routine.pia.handoffs.map((t) => t.botSteps)).toEqual([1, 3]);
    expect(routine.ditte.handoffs.map((t) => t.botSteps)).toEqual([0, 2]);
    expect(discord.ditte.sent).toEqual([
      {
        channelId: "c1",
        replyTo: "p2",
        text: "⚠️ The bots gave each other 3 tasks in this conversation. A person must give the next task.",
      },
    ]);
  });
});

describe("the limit of a conversation", () => {
  test("a reply to an earlier message of the conversation does not start the count again", async () => {
    const { bridge, bridges, routine, discord } = setup({ maxBotSteps: 2 });
    await personGivesTaskToDitte(bridge);
    await bridges.giveTaskFromBot("pia", fromBot(DITTE, "d1"), "m1"); // step 1
    await bridges.giveTaskFromBot("ditte", fromBot(PIA, "p1"), "d1"); // step 2

    await bridges.giveTaskFromBot("pia", fromBot(DITTE, "d2"), "m1"); // a reply to the first message again

    expect(routine.pia.handoffs.map((t) => t.botSteps)).toEqual([1]);
    expect(discord.pia.sent).toEqual([
      { channelId: "c1", replyTo: "d2", text: "⚠️ The bots gave each other 2 tasks in this conversation. A person must give the next task." },
    ]);
  });

  test("a new Task from a person starts a new conversation with a new count", async () => {
    const { bridge, bridges, routine } = setup({ maxBotSteps: 1 });
    await personGivesTaskToDitte(bridge);
    await bridges.giveTaskFromBot("pia", fromBot(DITTE, "d1"), "m1");
    await bridge.ditte.giveTask({ messageId: "m2", channelId: "c1", channelName: "general", requester: { id: "u1", name: "hyppa" }, text: "Again" });

    await bridges.giveTaskFromBot("pia", fromBot(DITTE, "d2"), "m2");

    expect(routine.pia.handoffs.map((t) => t.conversationId)).toEqual(["ditte-task-1", "ditte-task-2"]);
  });

  test("with a limit of 0, bots cannot give each other Tasks, and the Bridge shows no warning", async () => {
    const { bridge, bridges, routine, discord } = setup({ maxBotSteps: 0 });
    await personGivesTaskToDitte(bridge);

    await bridges.giveTaskFromBot("pia", fromBot(DITTE, "d1"), "m1");

    expect(routine.pia.handoffs).toEqual([]);
    expect(discord.pia.sent).toEqual([]);
  });

  test("the bots can give each other 10 Tasks in a conversation if you do not set a different limit", async () => {
    const { bridge, bridges, routine, discord } = setup();
    await personGivesTaskToDitte(bridge);
    let replyTo = "m1";
    for (let step = 1; step <= 11; step++) {
      const [to, from] = step % 2 === 1 ? (["pia", DITTE] as const) : (["ditte", PIA] as const);
      await bridges.giveTaskFromBot(to, fromBot(from, `b${step}`), replyTo);
      replyTo = `b${step}`;
    }

    expect(routine.pia.handoffs.length + routine.ditte.handoffs.length - 1).toBe(10);
    expect(discord.pia.sent.at(-1)?.text).toContain("10 tasks");
  });
});

describe("Conversations that bots start", () => {
  test("after the maximum number of new Conversations from bots in one hour, the bot refuses, so that bots cannot avoid the limit of a Conversation", async () => {
    const { bridges, routine, discord } = setup({ maxBotConversationsPerHour: 2 });
    await bridges.giveTaskFromBot("pia", fromBot(DITTE, "d1"), undefined);
    await bridges.giveTaskFromBot("ditte", fromBot(PIA, "p1"), undefined);

    await bridges.giveTaskFromBot("pia", fromBot(DITTE, "d2"), undefined);

    expect(routine.pia.handoffs).toHaveLength(1);
    expect(routine.ditte.handoffs).toHaveLength(1);
    expect(discord.pia.sent).toEqual([
      {
        channelId: "c1",
        replyTo: "d2",
        text: "⚠️ The bots started 2 conversations in the last hour. A person must give the next task, or the bots must wait.",
      },
    ]);
  });

  test("Conversations from more than one hour ago do not count", async () => {
    const { bridges, routine, time } = setup({ maxBotConversationsPerHour: 1 });
    await bridges.giveTaskFromBot("pia", fromBot(DITTE, "d1"), undefined);
    time.now = new Date("2026-11-14T13:00:01Z");

    await bridges.giveTaskFromBot("pia", fromBot(DITTE, "d2"), undefined);

    expect(routine.pia.handoffs).toHaveLength(2);
  });

  test("replies in a Conversation do not count as new Conversations", async () => {
    const { bridge, bridges, routine } = setup({ maxBotConversationsPerHour: 1 });
    await personGivesTaskToDitte(bridge);
    await bridges.giveTaskFromBot("pia", fromBot(DITTE, "d1"), "m1");

    await bridges.giveTaskFromBot("pia", fromBot(DITTE, "d2"), undefined);

    expect(routine.pia.handoffs.map((t) => t.conversationId)).toEqual(["ditte-task-1", "pia-task-2"]);
  });

  test("with a limit of 0, bots cannot start Conversations, and the Bridge shows no warning", async () => {
    const { bridges, routine, discord } = setup({ maxBotConversationsPerHour: 0 });

    await bridges.giveTaskFromBot("pia", fromBot(DITTE, "d1"), undefined);

    expect(routine.pia.handoffs).toEqual([]);
    expect(discord.pia.sent).toEqual([]);
  });
});

describe("mentions of a different bot", () => {
  test("an Answer can mention a different bot: the message starts with the mention, and only that bot gets a ping", async () => {
    const { bridge, bridges, discord } = setup();
    await personGivesTaskToDitte(bridge);

    await bridges.answerTask("ditte-task-1", "what must I design first?", ["pia"]);

    expect(discord.ditte.sent).toEqual([
      { channelId: "c1", replyTo: "m1", text: "<@pia-user> what must I design first?", mentions: ["pia-user"] },
    ]);
  });

  test("a message can mention a different bot", async () => {
    const { bridges, discord } = setup();

    await bridges.sendMessage("ditte", "c1", "the logo is ready.", { replyTo: "m9", mention: ["pia"] });

    expect(discord.ditte.sent).toEqual([
      { channelId: "c1", replyTo: "m9", text: "<@pia-user> the logo is ready.", mentions: ["pia-user"] },
    ]);
  });

  test("a mention of a different bot that Grok Bot writes in the text also pings that bot", async () => {
    const { bridge, bridges, discord } = setup();
    await personGivesTaskToDitte(bridge);

    await bridges.answerTask("ditte-task-1", "I will ask Pia.\n\n<@pia-user> what must I design first?");

    expect(discord.ditte.sent).toEqual([
      { channelId: "c1", replyTo: "m1", text: "I will ask Pia.\n\n<@pia-user> what must I design first?", mentions: ["pia-user"] },
    ]);
  });

  test("a mention in the text does not get two times into the message when Grok Bot also sets mention", async () => {
    const { bridges, discord } = setup();

    await bridges.sendMessage("ditte", "c1", "<@pia-user> hi", { mention: ["pia"] });

    expect(discord.ditte.sent).toEqual([{ channelId: "c1", text: "<@pia-user> hi", mentions: ["pia-user"] }]);
  });

  test("a mention of a person in the text does not ping the person", async () => {
    const { bridges, discord } = setup();

    await bridges.sendMessage("ditte", "c1", "<@u1> the logo is ready.");

    expect(discord.ditte.sent).toEqual([{ channelId: "c1", text: "<@u1> the logo is ready." }]);
  });

  test("a mention that Grok Bot writes as @name becomes a real mention of that bot, in each case", async () => {
    const { bridges, discord } = setup();

    await bridges.sendMessage("ditte", "c1", "@pia what is the priority?");
    await bridges.sendMessage("ditte", "c1", "ok. @Pia, and the flow?");

    expect(discord.ditte.sent).toEqual([
      { channelId: "c1", text: "<@pia-user> what is the priority?", mentions: ["pia-user"] },
      { channelId: "c1", text: "ok. <@pia-user>, and the flow?", mentions: ["pia-user"] },
    ]);
  });

  test("Grok Bot can also write the Discord name of a bot, when it is different from the name of the Bridge", async () => {
    const { bridges, discord } = setup({ displayNames: { pia: ["Pia Product"] } });

    await bridges.sendMessage("ditte", "c1", "@Pia Product, the priority?");

    expect(discord.ditte.sent).toEqual([{ channelId: "c1", text: "<@pia-user>, the priority?", mentions: ["pia-user"] }]);
  });

  test("an e-mail address, a longer word, or the name of a person does not become a mention", async () => {
    const { bridges, discord } = setup();

    await bridges.sendMessage("ditte", "c1", "write to emil@pia.se, ask @piano and @bob");

    expect(discord.ditte.sent).toEqual([{ channelId: "c1", text: "write to emil@pia.se, ask @piano and @bob" }]);
  });

  test("refuses a mention of a bot that does not exist, and sends nothing", async () => {
    const { bridge, bridges, discord } = setup();
    await personGivesTaskToDitte(bridge);

    await expect(bridges.answerTask("ditte-task-1", "hi", ["bob"])).rejects.toThrow(
      'There is no Discord bot with the name "bob". The names are: pia, ditte.',
    );
    expect(discord.ditte.sent).toEqual([]);
  });
});

describe("files", () => {
  const svg = { name: "napoli-sign-A6.svg", data: new TextEncoder().encode("<svg/>") };

  test("an Answer can have files, so that Grok Bot puts long work in a file and not in the text", async () => {
    const { bridge, bridges, discord } = setup();
    await personGivesTaskToDitte(bridge);

    await bridges.answerTask("ditte-task-1", "Napoli sign ready, A6.", undefined, [svg]);

    expect(discord.ditte.sent).toEqual([
      { channelId: "c1", replyTo: "m1", text: "Napoli sign ready, A6.", files: [{ name: "napoli-sign-A6.svg", text: "<svg/>" }] },
    ]);
  });

  test("a message can have only files, without text", async () => {
    const { bridges, discord } = setup();

    await bridges.sendMessage("ditte", "c1", "", { files: [svg] });

    expect(discord.ditte.sent).toEqual([{ channelId: "c1", text: "", files: [{ name: "napoli-sign-A6.svg", text: "<svg/>" }] }]);
  });

  test("refuses more than 10 files, because Discord accepts a maximum of 10 files in one message", async () => {
    const { bridges, discord } = setup();
    const files = Array.from({ length: 11 }, (_, i) => ({ name: `f${i}.txt`, data: new Uint8Array(1) }));

    await expect(bridges.sendMessage("ditte", "c1", "x", { files })).rejects.toThrow("A message can have a maximum of 10 files.");
    expect(discord.ditte.sent).toEqual([]);
  });

  test("refuses files that are larger than 10 MB together, because Discord refuses them", async () => {
    const { bridges } = setup();
    const big = { name: "big.pdf", data: new Uint8Array(10 * 1024 * 1024 + 1) };

    await expect(bridges.sendMessage("ditte", "c1", "x", { files: [big] })).rejects.toThrow(
      "The files are larger than 10 MB together. Make them smaller, or send them in more than one message.",
    );
  });

  test.each(["", "../secret.txt", "a/b.svg", "c:\\x.svg"])("refuses the file name %p", async (name) => {
    const { bridges } = setup();

    await expect(bridges.sendMessage("ditte", "c1", "x", { files: [{ name, data: new Uint8Array(1) }] })).rejects.toThrow(
      "A file name must not be empty and must not contain / or \\.",
    );
  });
});

describe("messages to the whole team", () => {
  const announcement = {
    messageId: "m5",
    channelId: "c2",
    channelName: "team",
    requester: { id: "u1", name: "hyppa" },
    text: "We change the brand color from red to blue.",
  };
  const roles = { pia: "Product owner.", ditte: "Design lead." };

  test("the router decides which bots a message from a person concerns, and only those bots receive it", async () => {
    const router = new FakeRouter();
    router.selects = ["ditte"];
    const { bridges, routine } = setup();

    await bridges.routeMessage(announcement, router, roles);

    expect(router.calls).toEqual([
      {
        message: { text: "We change the brand color from red to blue.", authorName: "hyppa", channelName: "team" },
        team: [
          { bot: "pia", role: "Product owner." },
          { bot: "ditte", role: "Design lead." },
        ],
      },
    ]);
    expect(routine.pia.handoffs).toEqual([]);
    expect(routine.ditte.handoffs.map((t) => ({ text: t.text, routed: t.routed }))).toEqual([
      { text: "We change the brand color from red to blue.", routed: true },
    ]);
  });

  test("the Bridge does not add 👀 to a routed message, because the Grok Bot decides if it acts", async () => {
    const router = new FakeRouter();
    router.selects = ["pia", "ditte"];
    const { bridges, discord, routine } = setup();

    await bridges.routeMessage(announcement, router, roles);

    expect(routine.pia.handoffs).toHaveLength(1);
    expect(routine.ditte.handoffs).toHaveLength(1);
    expect(discord.pia.reactions).toEqual([]);
    expect(discord.ditte.reactions).toEqual([]);
  });

  test("when the router selects nobody, or fails, nothing happens in Discord", async () => {
    const nobody = new FakeRouter();
    const failing = new FakeRouter();
    failing.failWith = new Error("HTTP 500");
    const { bridges, discord, routine } = setup();

    await bridges.routeMessage(announcement, nobody, roles);
    await bridges.routeMessage(announcement, failing, roles);

    expect(routine.pia.handoffs).toEqual([]);
    expect(routine.ditte.handoffs).toEqual([]);
    expect(discord.pia.sent).toEqual([]);
    expect(discord.ditte.sent).toEqual([]);
  });

  test("a name from the router that is not a bot of this Bridge is ignored", async () => {
    const router = new FakeRouter();
    router.selects = ["bob", "pia"];
    const { bridges, routine } = setup();

    await bridges.routeMessage(announcement, router, roles);

    expect(routine.pia.handoffs).toHaveLength(1);
  });
});
