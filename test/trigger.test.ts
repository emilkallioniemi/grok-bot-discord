import { expect, test } from "bun:test";
import { extractPrompt, type IncomingMessage } from "../src/trigger";

const BOT = "111";
const msg = (overrides: Partial<IncomingMessage>): IncomingMessage => ({
  content: "",
  authorIsBot: false,
  isDM: false,
  mentionsBot: false,
  ...overrides,
});

test("does not answer a channel message that does not mention the bot", () => {
  expect(extractPrompt(msg({ content: "lunch?" }), BOT)).toBeNull();
});

test("answers a direct message that has no mention", () => {
  expect(extractPrompt(msg({ content: "what's 2+2?", isDM: true }), BOT)).toBe("what's 2+2?");
});

test("does not answer other bots, also in DMs, to prevent loops between bots", () => {
  expect(extractPrompt(msg({ content: `<@${BOT}> hi`, authorIsBot: true, mentionsBot: true }), BOT)).toBeNull();
  expect(extractPrompt(msg({ content: "hi", authorIsBot: true, isDM: true }), BOT)).toBeNull();
});

test("removes the mention of the bot in the two Discord formats", () => {
  expect(extractPrompt(msg({ content: `<@${BOT}> explain DNS`, mentionsBot: true }), BOT)).toBe("explain DNS");
  expect(extractPrompt(msg({ content: `hey <@!${BOT}>, explain DNS`, mentionsBot: true }), BOT)).toBe("hey , explain DNS");
});

test("keeps the mentions of other persons", () => {
  expect(extractPrompt(msg({ content: `<@${BOT}> say hi to <@222>`, mentionsBot: true }), BOT)).toBe("say hi to <@222>");
});

test("gives an empty prompt for a message that has only a mention", () => {
  expect(extractPrompt(msg({ content: ` <@${BOT}>  `, mentionsBot: true }), BOT)).toBe("");
});
