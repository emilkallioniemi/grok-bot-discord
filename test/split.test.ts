import { describe, expect, test } from "bun:test";
import { DISCORD_MESSAGE_LIMIT, splitMessage } from "../src/split";

// A small limit keeps the inputs easy to read and the expected outputs exact.
const LIMIT = 40;

describe("splitMessage", () => {
  test("returns text that fits as one part, without spaces at the start and end", () => {
    expect(splitMessage("  hello world \n")).toEqual(["hello world"]);
    expect(splitMessage("x".repeat(DISCORD_MESSAGE_LIMIT))).toHaveLength(1);
  });

  test("divides at a paragraph break before a line break or a space", () => {
    const text = "first paragraph is here.\nstill first\n\nsecond paragraph";
    expect(splitMessage(text, LIMIT)).toEqual(["first paragraph is here.\nstill first", "second paragraph"]);
  });

  test("divides at a line break, then at a space, if there is no paragraph break", () => {
    expect(splitMessage("aaaa aaaa aaaa aaaa aaaa aaaa\nbbbb bbbb bbbb", LIMIT)).toEqual([
      "aaaa aaaa aaaa aaaa aaaa aaaa",
      "bbbb bbbb bbbb",
    ]);
    expect(splitMessage("one two three four five six seven eight nine", LIMIT)).toEqual([
      "one two three four five six seven",
      "eight nine",
    ]);
  });

  test("divides a word that is longer than the limit, and keeps all characters", () => {
    const word = "abcdefghij".repeat(10);
    const chunks = splitMessage(word, LIMIT);
    expect(chunks.join("")).toBe(word);
  });

  test("closes a divided code block, then opens it again with the same language", () => {
    const text = "```ts\nconst a = 1;\nconst b = 2;\nconst c = 3;\nconst d = 4;\n```";
    const chunks = splitMessage(text, LIMIT);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0]).toEndWith("\n```");
    for (const chunk of chunks.slice(1)) expect(chunk).toStartWith("```ts\n");
    for (const chunk of chunks) expect(chunk.match(/^```/gm)?.length).toBe(2);
  });

  test("keeps the indentation of a code line at the start of a new part", () => {
    const lines = Array.from({ length: 12 }, (_, i) => `    step_${i}()`);
    const chunks = splitMessage("```py\n" + lines.join("\n") + "\n```", 60);
    const output = chunks.flatMap((c) => c.split("\n"));
    for (const line of lines) expect(output).toContain(line);
  });

  // These tests examine typical text at the real Discord limit.
  // Each line has a number. Thus, the test finds a line that is missing or that occurs two times.
  const numbered = (n: number, make: (i: number) => string, sep = "\n") => Array.from({ length: n }, (_, i) => make(i)).join(sep);
  const samples: Record<string, string> = {
    prose: numbered(900, (i) => `word${i}`, " "),
    paragraphs: numbered(40, (i) => `Paragraph ${i}. ${"lorem ipsum ".repeat(15)}`, "\n\n"),
    "unbroken text": numbered(450, (i) => String(i).padStart(10, "z"), ""),
    "mixed code and prose": `Intro\n\n\`\`\`typescript\n${numbered(150, (i) => `  const v${i} = compute(${i});`)}\n\`\`\`\n\nOutro ${numbered(300, (i) => `t${i}`, " ")}`,
    "long fence language": "```" + "l".repeat(60) + "\n" + numbered(500, (i) => `x${i} = ${i}`) + "\n```",
  };

  for (const [name, text] of Object.entries(samples)) {
    test(`${name}: each part fits and no text is missing`, () => {
      const chunks = splitMessage(text);
      for (const c of chunks) expect(c.length).toBeLessThanOrEqual(DISCORD_MESSAGE_LIMIT);

      // Remove the fences that the function adds. An added pair is a closing fence at the end of a part
      // and an opening fence at the start of the next part. Each sample has a maximum of one code block.
      const fence = text.match(/^```[^\n]*/m)?.[0];
      const restored = chunks.map((c) => c);
      for (let i = 0; fence && i < restored.length - 1; i++) {
        if (restored[i]!.endsWith("\n```") && restored[i + 1]!.startsWith(fence + "\n")) {
          restored[i] = restored[i]!.slice(0, -4);
          restored[i + 1] = restored[i + 1]!.slice(fence.length + 1);
        }
      }
      // Only the whitespace at the divisions can be different.
      expect(restored.join("").replace(/\s+/g, "")).toBe(text.replace(/\s+/g, ""));
    });
  }
});
