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
};

test("a Handoff is a JSON POST to the routine URL with the routine key as a bearer token", async () => {
  const grokBot = fakeGrokBot();
  const routine = createRoutineWebhook({ url: grokBot.url, key: "routine-key" });

  await routine.handOff(task);

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
  await createRoutineWebhook({ url: grokBot.url, key: "k" }).handOff(task);

  expect(grokBot.received[0]!.body).toEqual({
    task_id: "task-1",
    text: "Find the bug in issue 42",
    requester: { id: "u1", name: "Ada" },
    channel: { id: "c1", name: "general" },
    guild_id: "g1",
    message_id: "m1",
    created_at: "2026-11-14T12:00:00.000Z",
    how_to_answer:
      'Use the answer_task tool of the Discord connector with task_id "task-1". The Requester sees the Answer as a reply to their message.',
  });
});

test("a Handoff that Grok Bot does not accept fails with the HTTP status", async () => {
  const grokBot = fakeGrokBot(401);
  const routine = createRoutineWebhook({ url: grokBot.url, key: "wrong-key" });

  expect(routine.handOff(task)).rejects.toThrow("Grok Bot did not accept the Handoff (HTTP 401).");
});
