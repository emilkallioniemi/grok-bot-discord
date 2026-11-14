import type { Task } from "../domain/task";

export interface DiscordMessage {
  id: string;
  authorId: string;
  authorName: string;
  text: string;
  sentAt: Date;
}

export interface ChannelSummary {
  id: string;
  name: string;
  guildName: string;
}

/** The actions that the Bridge does in Discord. */
export interface DiscordGateway {
  sendMessage(channelId: string, text: string, options?: { replyTo?: string }): Promise<{ messageIds: string[] }>;
  readMessages(channelId: string, options: { limit: number; before?: string }): Promise<DiscordMessage[]>;
  addReaction(channelId: string, messageId: string, emoji: string): Promise<void>;
  listChannels(): Promise<ChannelSummary[]>;
}

/** The Grok Bot routine that receives each Handoff. */
export interface Routine {
  handOff(task: Task): Promise<void>;
}

export interface TaskStore {
  save(task: Task): void;
  find(id: string): Task | undefined;
}
