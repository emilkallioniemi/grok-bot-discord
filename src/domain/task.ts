export interface Requester {
  id: string;
  name: string;
  /** True when a different bot of this Bridge gave the Task. */
  isBot?: boolean;
}

export interface OriginMessage {
  messageId: string;
  channelId: string;
  channelName: string;
  /** Not set for a direct message. */
  guildId?: string;
}

/** One piece of work that a member gives to Grok Bot. */
export interface Task {
  id: string;
  text: string;
  requester: Requester;
  origin: OriginMessage;
  createdAt: Date;
  /** The number of Bot steps that led to this Task. 0 when a person gave the Task. */
  botSteps: number;
  /** The ID of the Task from a person that started the Conversation. For that Task, its own ID. */
  conversationId: string;
  /** True when the message did not mention the bot, and a router decided that it concerns the bot. */
  routed?: boolean;
}
