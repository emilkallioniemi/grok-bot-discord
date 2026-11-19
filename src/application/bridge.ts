import type { OriginMessage, Requester, Task } from "../domain/task";
import type { Attachment, DiscordGateway, Routine, SendOptions, TaskStore } from "./ports";

export interface BridgeDependencies {
  discord: DiscordGateway;
  /** Not set until the owner of the Bridge creates the Grok Bot routine. */
  routine?: Routine;
  tasks: TaskStore;
  clock: () => Date;
  newTaskId: () => string;
  log?: (message: string, error: unknown) => void;
}

export interface Mention extends OriginMessage {
  requester: Requester;
  text: string;
  /** The number of Bot steps that led to this mention. 0 when a person wrote it. */
  botSteps?: number;
  /** The Conversation of the mention. Not set when a person starts a new Conversation. */
  conversationId?: string;
  /** True when a router decided that the message concerns the bot. Then the Grok Bot decides if it acts. */
  routed?: boolean;
}

/** The reaction that shows the Requester that Grok Bot received the Task. */
export const RECEIVED = "👀";

/** An error that the Bridge shows to Grok Bot, because Grok Bot can correct the cause. */
export class Refusal extends Error {
  override name = "Refusal";
}

/** The maximum number of earlier messages of the conversation that Grok Bot receives with a Task. */
export const CONVERSATION_MESSAGES = 10;

/** Discord accepts a maximum of 10 files in one message. */
export const MAX_FILES = 10;
/** Discord refuses larger uploads on servers without boosts. */
export const MAX_FILE_BYTES = 10 * 1024 * 1024;

/** Discord gives a maximum of 100 messages in one request. */
export const MAX_MESSAGES_PER_READ = 100;

export const NO_ROUTINE =
  "⚠️ The Bridge has no Grok Bot routine yet. The owner of the Bridge must set GROK_BOT_ROUTINE_URL and GROK_BOT_ROUTINE_KEY.";

export const HANDOFF_FAILED = "⚠️ The Bridge could not give this task to Grok Bot. Try again later.";

export function createBridge(deps: BridgeDependencies) {
  const log = deps.log ?? console.error;

  /** Puts the mentions that the text does not contain at the start of the text. Only these users get a ping. */
  function send(channelId: string, text: string, options: SendOptions) {
    const files = options.files ?? [];
    requireContent(text, files);
    const ids = options.mentionUserIds ?? [];
    const missing = ids.filter((id) => !mentions(text, id));
    const content = missing.length > 0 ? `${missing.map((id) => `<@${id}>`).join(" ")} ${text}` : text;
    return deps.discord.sendMessage(channelId, content, {
      ...(options.replyTo ? { replyTo: options.replyTo } : {}),
      ...(ids.length > 0 ? { mentionUserIds: ids } : {}),
      ...(files.length > 0 ? { files } : {}),
    });
  }
  return {
    async giveTask(mention: Mention): Promise<void> {
      const { requester, text, botSteps = 0, conversationId, routed, ...origin } = mention;
      if (!deps.routine) {
        if (routed) return; // Nobody asked this bot. Thus, a warning is only noise.
        await deps.discord.sendMessage(origin.channelId, NO_ROUTINE, { replyTo: origin.messageId });
        return;
      }
      const id = deps.newTaskId();
      const task: Task = {
        id,
        text,
        requester,
        origin,
        createdAt: deps.clock(),
        botSteps,
        conversationId: conversationId ?? id,
        ...(routed ? { routed: true } : {}),
      };
      deps.tasks.save(task);
      let conversation: Awaited<ReturnType<DiscordGateway["readReplyChain"]>> = [];
      try {
        conversation = await deps.discord.readReplyChain(origin.channelId, origin.messageId, CONVERSATION_MESSAGES);
      } catch (error) {
        log(`The Bridge could not read the conversation of task ${task.id}:`, error);
      }
      try {
        await deps.routine.handOff(task, { conversation });
      } catch (error) {
        log(`The Handoff of task ${task.id} failed:`, error);
        if (!routed) await deps.discord.sendMessage(origin.channelId, HANDOFF_FAILED, { replyTo: origin.messageId });
        return;
      }
      // For a routed message, the Grok Bot adds the reaction itself if it acts.
      if (!routed) await deps.discord.addReaction(origin.channelId, origin.messageId, RECEIVED);
    },

    /** The Conversation of the Task that a message gave, or undefined if the message gave no Task. */
    conversationAt(messageId: string): string | undefined {
      return deps.tasks.findByOrigin(messageId)[0]?.conversationId;
    },

    /** The number of Conversations that a bot started with this Bridge at this time or later. */
    botConversationsSince(since: Date): number {
      return deps.tasks.countBotConversationsSince(since);
    },

    /** The number of Tasks from bots that this Bridge received in a Conversation. */
    botTasksIn(conversationId: string): number {
      return deps.tasks.countBotTasks(conversationId);
    },

    hasTask(taskId: string): boolean {
      return deps.tasks.find(taskId) !== undefined;
    },

    async answerTask(
      taskId: string,
      text: string,
      options: { mentionUserIds?: string[]; files?: Attachment[] } = {},
    ): Promise<{ messageIds: string[] }> {
      const task = deps.tasks.find(taskId);
      if (!task) throw new Refusal(`There is no task with the ID "${taskId}".`);
      return send(task.origin.channelId, text, { replyTo: task.origin.messageId, ...options });
    },

    async sendMessage(channelId: string, text: string, options: SendOptions = {}) {
      return send(channelId, text, options);
    },

    async readMessages(channelId: string, options: { limit: number; before?: string }) {
      const limit = Math.min(Math.max(Math.trunc(options.limit), 1), MAX_MESSAGES_PER_READ);
      return deps.discord.readMessages(channelId, { ...options, limit });
    },

    async addReaction(channelId: string, messageId: string, emoji: string) {
      await deps.discord.addReaction(channelId, messageId, emoji);
    },

    async listChannels() {
      return deps.discord.listChannels();
    },
  };
}

export type Bridge = ReturnType<typeof createBridge>;

/** A message must have text or files, and Discord must accept the files. */
function requireContent(text: string, files: Attachment[]): void {
  if (!text.trim() && files.length === 0) throw new Refusal("The message has no text.");
  if (files.length > MAX_FILES) throw new Refusal(`A message can have a maximum of ${MAX_FILES} files.`);
  for (const file of files) {
    if (!file.name.trim() || /[\\/]/.test(file.name)) {
      throw new Refusal("A file name must not be empty and must not contain / or \\.");
    }
  }
  if (files.reduce((sum, f) => sum + f.data.byteLength, 0) > MAX_FILE_BYTES) {
    throw new Refusal("The files are larger than 10 MB together. Make them smaller, or send them in more than one message.");
  }
}

/** True if the text contains a Discord mention of the user, in one of the two formats. */
export function mentions(text: string, userId: string): boolean {
  return text.includes(`<@${userId}>`) || text.includes(`<@!${userId}>`);
}
