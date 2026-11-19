import type { HandoffContext, Routine } from "../application/ports";
import { MAX_BOT_STEPS } from "../application/bridges";
import type { Task } from "../domain/task";

export interface RoutineWebhookOptions {
  /** The "POST to" URL of the webhook trigger of the routine. */
  url: string;
  /** The "key" of the webhook trigger. */
  key: string;
  /** The name of the Discord bot of this routine. Set it when the Bridge has more than one bot. */
  bot?: string;
  /** The maximum number of Tasks between bots in one Conversation. */
  maxBotSteps?: number;
  /** All bots of the Bridge and their roles. Set it when the Bridge has more than one bot. */
  team?: Array<{ bot: string; role?: string }>;
  fetch?: typeof fetch;
}

/** Sends each Task to a Grok Bot routine through its webhook trigger. */
export function createRoutineWebhook(options: RoutineWebhookOptions): Routine {
  const send = options.fetch ?? fetch;
  return {
    async handOff(task: Task, context: HandoffContext) {
      const response = await send(options.url, {
        method: "POST",
        headers: { Authorization: `Bearer ${options.key}`, "Content-Type": "application/json" },
        body: JSON.stringify(toPayload(task, context, options, options.maxBotSteps ?? MAX_BOT_STEPS)),
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) {
        throw new Error(`Grok Bot did not accept the Handoff (HTTP ${response.status}).`);
      }
    },
  };
}

/** The body that Grok Bot receives with the routine instruction. */
/** Discord is a chat. Without this, Grok Bot writes as in an email or as a long chatbot answer. */
const CHAT_STYLE =
  "This is a Discord chat between colleagues who talk every day. Write as a person in a chat: one to three short sentences, casual, " +
  "without greetings or sign-offs. Do not use headings, bold labels, or lists, unless somebody asks for them. " +
  "Put long work, for example a design, a document, or code, in a file with the files setting, and write one short line about it.";

function toPayload(task: Task, context: HandoffContext, options: RoutineWebhookOptions, maxBotSteps: number) {
  const { bot, team } = options;
  let howToAnswer = `Use the answer_task tool of the Discord connector with task_id "${task.id}". The Requester sees the Answer as a reply to their message.`;
  if (bot) howToAnswer += ` For the other Discord tools, set bot to "${bot}".`;
  howToAnswer += ` ${CHAT_STYLE}`;
  if (bot && team) {
    howToAnswer +=
      ` You are the bot "${bot}". The team field shows each bot and its role. Give a bot only tasks that are in its role.` +
      " If this task is not in your role, say so briefly, and name the bot whose role it is.";
  }
  if (task.routed) {
    howToAnswer +=
      " This message did not mention you. A router decided that it can concern your role. Act only if it concerns your role." +
      ' If you act, first add the reaction "👀" to the message with add_reaction, so that the team sees it.' +
      " If it does not concern your role, do nothing: do not answer and do not add a reaction.";
  }
  if (task.requester.isBot) {
    howToAnswer +=
      " A different bot gave this task. You decide if the conversation continues: answer, ask for more information, add a reaction with add_reaction, or do nothing." +
      " Each answer to a bot gives that bot a task. A reaction gives no task.";
  }
  return {
    ...(bot ? { bot } : {}),
    task_id: task.id,
    ...(task.routed ? { routed: true } : {}),
    text: task.text,
    requester: { id: task.requester.id, name: task.requester.name, ...(task.requester.isBot ? { is_bot: true } : {}) },
    channel: { id: task.origin.channelId, name: task.origin.channelName },
    guild_id: task.origin.guildId,
    message_id: task.origin.messageId,
    created_at: task.createdAt.toISOString(),
    how_to_answer: howToAnswer,
    // Only with more than one bot: the number of Tasks that bots can still give each other in this conversation.
    ...(bot ? { bot_steps_left: Math.max(maxBotSteps - task.botSteps, 0) } : {}),
    ...(bot && team ? { team: team.map((m) => ({ bot: m.bot, role: m.role ?? "No role is set." })) } : {}),
    conversation: context.conversation.map((m) => ({
      id: m.id,
      author: { id: m.authorId, name: m.authorName },
      text: m.text,
      sent_at: m.sentAt.toISOString(),
    })),
  };
}
