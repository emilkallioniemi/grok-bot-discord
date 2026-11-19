import { afterEach, expect, test } from "bun:test";
import { createRoutineWebhook } from "../src/adapters/routine-webhook";
import type { Task } from "../src/domain/task";

/** A fake Grok Bot webhook endpoint on a real HTTP port. */
function fakeGrokBot(status = 200) {
  const received: Array<{ method: string; path: string; auth: string | null; type: string | null; body: unknown }> = [];
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      received.push({
        method: req.method,
        path: new URL(req.url).pathname,
        auth: req.headers.get("authorization"),
        type: req.headers.get("content-type"),
        body: await req.json(),
      });
      return new Response(status === 200 ? "ok" : "denied", { status });
    },
  });
  servers.push(server);
  return { url: `http://localhost:${server.port}/hooks/routine-abc`, received };
}

const servers: Array<{ stop(force?: boolean): void }> = [];
afterEach(() => servers.splice(0).forEach((s) => s.stop(true)));

const task: Task = {
  id: "task-1",
  text: "Find the bug in issue 42",
  requester: { id: "u1", name: "Ada" },
  origin: { messageId: "m1", channelId: "c1", channelName: "general", guildId: "g1" },
  createdAt: new Date("2026-11-14T12:00:00Z"),
  botSteps: 0,
  conversationId: "task-1",
};
const none = { conversation: [] };

test("a Handoff is a JSON POST to the routine URL with the routine key as a bearer token", async () => {
  const grokBot = fakeGrokBot();
  const routine = createRoutineWebhook({ url: grokBot.url, key: "routine-key" });

  await routine.handOff(task, none);

  expect(grokBot.received).toHaveLength(1);
  expect(grokBot.received[0]).toMatchObject({
    method: "POST",
    path: "/hooks/routine-abc",
    auth: "Bearer routine-key",
    type: "application/json",
  });
});

test("the Handoff tells Grok Bot the Task, the Requester, the channel, and how to answer the Task", async () => {
  const grokBot = fakeGrokBot();
  await createRoutineWebhook({ url: grokBot.url, key: "k" }).handOff(task, none);

  expect(grokBot.received[0]!.body).toEqual({
    task_id: "task-1",
    text: "Find the bug in issue 42",
    requester: { id: "u1", name: "Ada" },
    channel: { id: "c1", name: "general" },
    guild_id: "g1",
    message_id: "m1",
    created_at: "2026-11-14T12:00:00.000Z",
    how_to_answer:
      'Use the answer_task tool of the Discord connector with task_id "task-1". The Requester sees the Answer as a reply to their message. ' +
      "This is a Discord chat between colleagues who talk every day. Write as a person in a chat: one to three short sentences, casual, without greetings or sign-offs. Do not use headings, bold labels, or lists, unless somebody asks for them. Put long work, for example a design, a document, or code, in a file with the files setting, and write one short line about it.",
    conversation: [],
  });
});

test("a Handoff that Grok Bot does not accept fails with the HTTP status", async () => {
  const grokBot = fakeGrokBot(401);
  const routine = createRoutineWebhook({ url: grokBot.url, key: "wrong-key" });

  await expect(routine.handOff(task, none)).rejects.toThrow("Grok Bot did not accept the Handoff (HTTP 401).");
});

test("with more than one bot, the Handoff tells Grok Bot the name of the bot for the other Discord tools", async () => {
  const grokBot = fakeGrokBot();
  await createRoutineWebhook({ url: grokBot.url, key: "k", bot: "ditte" }).handOff(task, none);

  expect(grokBot.received[0]!.body).toMatchObject({
    bot: "ditte",
    how_to_answer: expect.stringContaining('For the other Discord tools, set bot to "ditte".'),
  });
});

test("with more than one bot, the Handoff tells Grok Bot if a bot gave the Task, and how many Tasks between bots are left", async () => {
  const grokBot = fakeGrokBot();
  const fromDitte: Task = { ...task, requester: { id: "ditte-user", name: "Ditte", isBot: true }, botSteps: 4 };
  const routine = createRoutineWebhook({ url: grokBot.url, key: "k", bot: "pia", maxBotSteps: 10 });

  await routine.handOff(task, none);
  await routine.handOff(fromDitte, none);

  expect(grokBot.received[0]!.body).toMatchObject({ requester: { id: "u1", name: "Ada" }, bot_steps_left: 10 });
  expect(grokBot.received[1]!.body).toMatchObject({ requester: { id: "ditte-user", name: "Ditte", is_bot: true }, bot_steps_left: 6 });
});

test("a Task from a bot tells Grok Bot that it decides if the conversation continues", async () => {
  const grokBot = fakeGrokBot();
  const fromDitte: Task = { ...task, requester: { id: "ditte-user", name: "Ditte", isBot: true }, botSteps: 1 };

  await createRoutineWebhook({ url: grokBot.url, key: "k", bot: "pia" }).handOff(fromDitte, none);

  expect((grokBot.received[0]!.body as { how_to_answer: string }).how_to_answer).toContain(
    "A different bot gave this task. You decide if the conversation continues: answer, ask for more information, add a reaction with add_reaction, or do nothing. " +
      "Each answer to a bot gives that bot a task. A reaction gives no task.",
  );
});

test("with more than one bot, the Handoff tells Grok Bot the team and the role of each bot, so that it gives tasks only to the correct bot", async () => {
  const grokBot = fakeGrokBot();
  const team = [
    { bot: "pia", role: "Product owner: priorities, hypotheses, decisions." },
    { bot: "ditte", role: "Design lead: brand, UI/UX, style guides." },
  ];

  await createRoutineWebhook({ url: grokBot.url, key: "k", bot: "ditte", team }).handOff(task, none);

  const body = grokBot.received[0]!.body as { team: unknown; how_to_answer: string };
  expect(body.team).toEqual(team);
  expect(body.how_to_answer).toContain(
    'You are the bot "ditte". The team field shows each bot and its role. Give a bot only tasks that are in its role. ' +
      "If this task is not in your role, say so briefly, and name the bot whose role it is.",
  );
});

test("the Handoff contains the conversation before the task message, oldest first", async () => {
  const grokBot = fakeGrokBot();
  const conversation = [
    { id: "m0", authorId: "u2", authorName: "Bob", text: "Which product first?", sentAt: new Date("2026-11-14T11:58:00Z") },
  ];

  await createRoutineWebhook({ url: grokBot.url, key: "k" }).handOff(task, { conversation });

  expect(grokBot.received[0]!.body).toMatchObject({
    conversation: [{ id: "m0", author: { id: "u2", name: "Bob" }, text: "Which product first?", sent_at: "2026-11-14T11:58:00.000Z" }],
  });
});

test("a routed Task tells Grok Bot that the message did not mention it, and that it acts only if the message concerns its role", async () => {
  const grokBot = fakeGrokBot();

  await createRoutineWebhook({ url: grokBot.url, key: "k", bot: "ditte" }).handOff({ ...task, routed: true }, none);

  const body = grokBot.received[0]!.body as { routed: boolean; how_to_answer: string };
  expect(body.routed).toBe(true);
  expect(body.how_to_answer).toContain(
    "This message did not mention you. A router decided that it can concern your role. Act only if it concerns your role. " +
      'If you act, first add the reaction "👀" to the message with add_reaction, so that the team sees it. ' +
      "If it does not concern your role, do nothing: do not answer and do not add a reaction.",
  );
});
