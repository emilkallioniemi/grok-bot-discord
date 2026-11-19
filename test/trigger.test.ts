import { expect, test } from "bun:test";
import { extractPrompt, type IncomingMessage } from "../src/trigger";

const BOT = "111";
const msg = (overrides: Partial<IncomingMessage>): IncomingMessage => ({
  content: "",
  authorIsBot: false,
  authorIsColleague: false,
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

test("does not answer bots that are not bots of this Bridge, also in DMs, to prevent loops between bots", () => {
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

test("answers a mention from a different bot of this Bridge, so that the bots can give tasks to each other", () => {
  expect(
    extractPrompt(msg({ content: `<@${BOT}> what is next?`, authorIsBot: true, authorIsColleague: true, mentionsBot: true }), BOT),
  ).toBe("what is next?");
});

test("does not answer a direct message from a different bot of this Bridge, because the conversation must be visible", () => {
  expect(extractPrompt(msg({ content: "hi", authorIsBot: true, authorIsColleague: true, isDM: true }), BOT)).toBeNull();
});

test("a reply from a different bot of this Bridge is a task, so that the bots continue a conversation as persons do", () => {
  // Discord counts a reply as a mention of the author of the first message.
  expect(
    extractPrompt(msg({ content: "Thank you! One more question: which font?", authorIsBot: true, authorIsColleague: true, mentionsBot: true }), BOT),
  ).toBe("Thank you! One more question: which font?");
});

test("a reply from a person to the bot is a task, also without a mention in the text", () => {
  expect(extractPrompt(msg({ content: "and what about the logo?", mentionsBot: true }), BOT)).toBe("and what about the logo?");
});
