export const DISCORD_MESSAGE_LIMIT = 2000;

const CLOSING_FENCE = "\n```";

/**
 * Divides text into parts that fit in one Discord message.
 * If possible, the function divides the text at a paragraph break.
 * If not, it divides the text at a line break, then at a space.
 * If a part ends in a code block, the function closes the code block at the end of that part.
 * Then it opens the code block again, with the same language tag, at the start of the next part.
 * The function removes only the separator at each division. Thus, the indentation does not change.
 */
export function splitMessage(text: string, limit = DISCORD_MESSAGE_LIMIT): string[] {
  const chunks: string[] = [];
  let rest = text.trim();
  let openFence: string | null = null;

  while (rest.length > 0) {
    const prefix = openFence ? `${openFence}\n` : "";
    if (prefix.length + rest.length <= limit) {
      chunks.push(prefix + rest);
      break;
    }

    // Always keep space for a closing fence. At this step, the function does not know if the part must have one.
    const room = limit - prefix.length - CLOSING_FENCE.length;
    if (room < 1) throw new Error(`The code fence "${openFence}" is too long. The text cannot be divided into parts of ${limit} characters.`);

    const { at, skip } = findBreak(rest, room);
    const piece = rest.slice(0, at);
    rest = rest.slice(at + skip);

    openFence = trailingOpenFence(prefix + piece);
    chunks.push(openFence ? prefix + piece + CLOSING_FENCE : prefix + piece);
  }

  return chunks.filter((c) => c.trim().length > 0);
}

/** Finds the position of the division, and the number of separator characters to remove. */
function findBreak(text: string, max: number): { at: number; skip: number } {
  for (const sep of ["\n\n", "\n", " "]) {
    // The function removes the separator. Thus, the separator can go past the limit.
    const idx = text.slice(0, max + sep.length).lastIndexOf(sep);
    if (idx > max * 0.5 && idx <= max) return { at: idx, skip: sep.length };
  }
  return { at: max, skip: 0 };
}

/** If the text ends in a code block, returns the opening fence line (for example, "```ts"). */
function trailingOpenFence(text: string): string | null {
  let open: string | null = null;
  for (const match of text.matchAll(/^```[^\n`]*$/gm)) {
    open = open ? null : match[0];
  }
  return open;
}
