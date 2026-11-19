import { afterEach, expect, test } from "bun:test";
import { createDecisionsRouter } from "../src/adapters/decisions-router";

/** A fake OpenAI Decisions API on a real HTTP port. */
function fakeDecisions(reply: (body: any) => { status?: number; json: unknown }) {
  const received: Array<{ path: string; auth: string | null; body: any }> = [];
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const body = await req.json();
      received.push({ path: new URL(req.url).pathname, auth: req.headers.get("authorization"), body });
      const { status = 200, json } = reply(body);
      return Response.json(json, { status });
    },
  });
  servers.push(server);
  return { baseUrl: `http://localhost:${server.port}/v1`, received };
}

const servers: Array<{ stop(force?: boolean): void }> = [];
afterEach(() => servers.splice(0).forEach((s) => s.stop(true)));

const team = [
  { bot: "pia", role: "Product owner: priorities and decisions." },
  { bot: "ditte", role: "Design lead: brand, colors, UI." },
];
const message = { text: "We change the brand color from red to blue.", authorName: "hyppa", channelName: "team" };
const answers = (pia: number, ditte: number) => ({
  model: "gpt-6-luna",
  answers: [
    { type: "predicate", name: "pia", probability: pia },
    { type: "predicate", name: "ditte", probability: ditte },
  ],
});

test("asks the Decisions API one question for each bot, with the roles, and the API key as a bearer token", async () => {
  const api = fakeDecisions(() => ({ json: answers(0.1, 0.9) }));
  const router = createDecisionsRouter({ apiKey: "sk-test", baseUrl: api.baseUrl });

  await router.route(message, team);

  expect(api.received).toHaveLength(1);
  expect(api.received[0]!.path).toBe("/v1/decisions");
  expect(api.received[0]!.auth).toBe("Bearer sk-test");
  const body = api.received[0]!.body;
  expect(body.model).toBe("gpt-6-luna");
  expect(body.questions.map((q: any) => ({ type: q.type, name: q.name }))).toEqual([
    { type: "predicate", name: "pia" },
    { type: "predicate", name: "ditte" },
  ]);
  expect(body.questions[1].instructions).toContain("Design lead: brand, colors, UI.");
  expect(JSON.stringify(body.input)).toContain("We change the brand color from red to blue.");
});

test("selects each bot with a probability at the threshold or higher, also more than one bot", async () => {
  const api = fakeDecisions(() => ({ json: answers(0.7, 0.95) }));

  expect(await createDecisionsRouter({ apiKey: "k", baseUrl: api.baseUrl }).route(message, team)).toEqual(["pia", "ditte"]);
  expect(await createDecisionsRouter({ apiKey: "k", baseUrl: api.baseUrl, threshold: 0.8 }).route(message, team)).toEqual(["ditte"]);
});

test("selects no bot when the message concerns nobody", async () => {
  const api = fakeDecisions(() => ({ json: answers(0.05, 0.1) }));

  expect(await createDecisionsRouter({ apiKey: "k", baseUrl: api.baseUrl }).route(message, team)).toEqual([]);
});

test("does not select a bot when the API refuses its question", async () => {
  const api = fakeDecisions(() => ({
    json: { answers: [{ type: "refusal", name: "pia" }, { type: "predicate", name: "ditte", probability: 0.9 }] },
  }));

  expect(await createDecisionsRouter({ apiKey: "k", baseUrl: api.baseUrl }).route(message, team)).toEqual(["ditte"]);
});

test("fails with the HTTP status when the API does not accept the request", async () => {
  const api = fakeDecisions(() => ({ status: 401, json: { error: { message: "Incorrect API key" } } }));

  await expect(createDecisionsRouter({ apiKey: "bad", baseUrl: api.baseUrl }).route(message, team)).rejects.toThrow(
    "The Decisions API did not accept the request (HTTP 401): Incorrect API key",
  );
});
