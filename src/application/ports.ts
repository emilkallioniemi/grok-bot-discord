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

/** A file that Grok Bot attaches to a message. */
export interface Attachment {
  name: string;
  data: Uint8Array;
}

export interface SendOptions {
  replyTo?: string;
  /** The users that get a ping. The Bridge does not let other mentions in the text ping. */
  mentionUserIds?: string[];
  files?: Attachment[];
}

/** The actions that the Bridge does in Discord. */
export interface DiscordGateway {
  sendMessage(channelId: string, text: string, options?: SendOptions): Promise<{ messageIds: string[] }>;
  readMessages(channelId: string, options: { limit: number; before?: string }): Promise<DiscordMessage[]>;
  /** The messages that a message replies to, one after the other, oldest first. Not the message itself. */
  readReplyChain(channelId: string, messageId: string, limit: number): Promise<DiscordMessage[]>;
  addReaction(channelId: string, messageId: string, emoji: string): Promise<void>;
  listChannels(): Promise<ChannelSummary[]>;
}

/** What Grok Bot receives with a Task, in addition to the Task. */
export interface HandoffContext {
  /** The messages that the origin message replies to, oldest first. */
  conversation: DiscordMessage[];
}

/** The Grok Bot routine that receives each Handoff. */
export interface Routine {
  handOff(task: Task, context: HandoffContext): Promise<void>;
}

export interface TaskStore {
  save(task: Task): void;
  find(id: string): Task | undefined;
  /** The Tasks that the message with this ID gave. */
  findByOrigin(messageId: string): Task[];
  /** The number of Tasks from bots in a Conversation. */
  countBotTasks(conversationId: string): number;
  /** The number of Conversations that a bot started at this time or later. */
  countBotConversationsSince(since: Date): number;
}

/** A message from a person that does not mention a bot. */
export interface UnaddressedMessage {
  text: string;
  authorName: string;
  channelName: string;
}

/** Decides which bots of the team a message concerns. */
export interface Router {
  /** The names of the bots that the message concerns. Can be empty. */
  route(message: UnaddressedMessage, team: Array<{ bot: string; role?: string }>): Promise<string[]>;
}
