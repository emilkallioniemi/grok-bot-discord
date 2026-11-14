import type { OriginMessage, Requester, Task } from "../domain/task";
import type { DiscordGateway, Routine, TaskStore } from "./ports";

export interface BridgeDependencies {
  discord: DiscordGateway;
  routine: Routine;
  tasks: TaskStore;
  clock: () => Date;
  newTaskId: () => string;
  log?: (message: string, error: unknown) => void;
}

export interface Mention extends OriginMessage {
  requester: Requester;
  text: string;
}

/** The reaction that shows the Requester that Grok Bot received the Task. */
export const RECEIVED = "👀";

/** An error that the Bridge shows to Grok Bot, because Grok Bot can correct the cause. */
export class Refusal extends Error {
  override name = "Refusal";
}

/** Discord gives a maximum of 100 messages in one request. */
export const MAX_MESSAGES_PER_READ = 100;

export const HANDOFF_FAILED = "⚠️ The Bridge could not give this task to Grok Bot. Try again later.";

export function createBridge(deps: BridgeDependencies) {
  const log = deps.log ?? console.error;
  return {
    async giveTask(mention: Mention): Promise<void> {
      const { requester, text, ...origin } = mention;
      const task: Task = { id: deps.newTaskId(), text, requester, origin, createdAt: deps.clock() };
      deps.tasks.save(task);
      try {
        await deps.routine.handOff(task);
      } catch (error) {
        log(`The Handoff of task ${task.id} failed:`, error);
        await deps.discord.sendMessage(origin.channelId, HANDOFF_FAILED, { replyTo: origin.messageId });
        return;
      }
      await deps.discord.addReaction(origin.channelId, origin.messageId, RECEIVED);
    },

    async answerTask(taskId: string, text: string): Promise<{ messageIds: string[] }> {
      const task = deps.tasks.find(taskId);
      if (!task) throw new Refusal(`There is no task with the ID "${taskId}".`);
      requireText(text);
      return deps.discord.sendMessage(task.origin.channelId, text, { replyTo: task.origin.messageId });
    },

    async sendMessage(channelId: string, text: string, options?: { replyTo?: string }) {
      requireText(text);
      return deps.discord.sendMessage(channelId, text, options);
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

function requireText(text: string): void {
  if (!text.trim()) throw new Refusal("The message has no text.");
}
