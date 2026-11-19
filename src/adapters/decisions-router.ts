import type { Router } from "../application/ports";

export interface DecisionsRouterOptions {
  apiKey: string;
  /** The minimum probability for a bot to receive the message. */
  threshold?: number;
  /** For tests. */
  baseUrl?: string;
  fetch?: typeof fetch;
}

/** The default minimum probability for a bot to receive a message. */
export const DEFAULT_THRESHOLD = 0.6;

/**
 * Asks the OpenAI Decisions API which bots a message concerns. It asks one yes/no question for each bot,
 * because one choice question gives only one answer, and a message can concern more than one bot.
 */
export function createDecisionsRouter(options: DecisionsRouterOptions): Router {
  const send = options.fetch ?? fetch;
  const baseUrl = options.baseUrl ?? "https://api.openai.com/v1";
  const threshold = options.threshold ?? DEFAULT_THRESHOLD;

  return {
    async route(message, team) {
      const response = await send(`${baseUrl}/decisions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${options.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "gpt-6-luna",
          input: [
            {
              role: "developer",
              content: [
                {
                  type: "input_text",
                  text:
                    "A person wrote a message in a Discord channel of a team. The message does not mention a team member. " +
                    "Find which team members must act on the message or answer it, because of their role.",
                },
              ],
            },
            {
              role: "user",
              content: [
                { type: "input_json", data: { channel: message.channelName, author: message.authorName, message: message.text } },
              ],
            },
          ],
          questions: team.map((member) => ({
            type: "predicate",
            name: member.bot,
            instructions:
              `The team member "${member.bot}" has this role: ${member.role ?? "No role is set."} ` +
              `Must "${member.bot}" act on this message or answer it, because it concerns this role?`,
          })),
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        const detail = await response
          .json()
          .then((body: any) => body?.error?.message as string | undefined)
          .catch(() => undefined);
        throw new Error(`The Decisions API did not accept the request (HTTP ${response.status})${detail ? `: ${detail}` : "."}`);
      }
      const body = (await response.json()) as { answers: Array<{ type: string; name: string | null; probability?: number }> };
      return body.answers
        .filter((a) => a.type === "predicate" && a.name !== null && (a.probability ?? 0) >= threshold)
        .map((a) => a.name!);
    },
  };
}
