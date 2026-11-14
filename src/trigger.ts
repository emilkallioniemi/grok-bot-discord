export interface IncomingMessage {
  content: string;
  authorIsBot: boolean;
  isDM: boolean;
  mentionsBot: boolean;
}

/**
 * Finds if the bot must answer a message, and finds the prompt.
 * Returns null if the bot must not answer the message.
 * If not, returns the prompt without the mentions of the bot.
 * An empty string means that the message contains only a mention of the bot.
 */
export function extractPrompt(message: IncomingMessage, botId: string): string | null {
  if (message.authorIsBot) return null;
  if (!message.isDM && !message.mentionsBot) return null;
  return message.content
    .replaceAll(`<@${botId}>`, "")
    .replaceAll(`<@!${botId}>`, "")
    .replace(/\s+/g, " ")
    .trim();
}
