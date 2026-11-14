export interface Requester {
  id: string;
  name: string;
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
}
