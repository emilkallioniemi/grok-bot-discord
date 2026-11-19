import type { ChannelSummary, DiscordGateway, DiscordMessage, SendOptions } from "../../src/application/ports";
import type { HandoffContext, Routine, Router, UnaddressedMessage } from "../../src/application/ports";
import type { Task } from "../../src/domain/task";

/** A fake Discord at the system boundary. It records what the Bridge does in Discord. */
export class FakeDiscord implements DiscordGateway {
  sent: Array<{
    channelId: string;
    text: string;
    replyTo?: string;
    mentions?: string[];
    files?: Array<{ name: string; text: string }>;
  }> = [];
  reactions: Array<{ channelId: string; messageId: string; emoji: string }> = [];
  history = new Map<string, DiscordMessage[]>();
  channels: ChannelSummary[] = [];
  /** The messages that each message replies to, oldest first. */
  replyChains = new Map<string, DiscordMessage[]>();
  replyChainRequests: Array<{ channelId: string; messageId: string; limit: number }> = [];
  #nextId = 1000;

  async sendMessage(channelId: string, text: string, options?: SendOptions) {
    this.sent.push({
      channelId,
      text,
      ...(options?.replyTo ? { replyTo: options.replyTo } : {}),
      ...(options?.mentionUserIds?.length ? { mentions: options.mentionUserIds } : {}),
      ...(options?.files?.length ? { files: options.files.map((f) => ({ name: f.name, text: new TextDecoder().decode(f.data) })) } : {}),
    });
    return { messageIds: [String(this.#nextId++)] };
  }

  async readMessages(channelId: string, options: { limit: number; before?: string }) {
    const all = this.history.get(channelId) ?? [];
    const end = options.before ? all.findIndex((m) => m.id === options.before) : all.length;
    return all.slice(Math.max(0, (end === -1 ? all.length : end) - options.limit), end === -1 ? all.length : end);
  }

  async readReplyChain(channelId: string, messageId: string, limit: number) {
    this.replyChainRequests.push({ channelId, messageId, limit });
    return (this.replyChains.get(messageId) ?? []).slice(-limit);
  }

  async addReaction(channelId: string, messageId: string, emoji: string) {
    this.reactions.push({ channelId, messageId, emoji });
  }

  async listChannels() {
    return this.channels;
  }
}

/** A fake Grok Bot routine at the system boundary. */
export class FakeRoutine implements Routine {
  handoffs: Task[] = [];
  contexts: HandoffContext[] = [];
  failWith: Error | null = null;

  async handOff(task: Task, context: HandoffContext) {
    if (this.failWith) throw this.failWith;
    this.handoffs.push(task);
    this.contexts.push(context);
  }
}

/** A fake router at the system boundary. It selects the bots in "selects". */
export class FakeRouter implements Router {
  selects: string[] = [];
  failWith: Error | null = null;
  calls: Array<{ message: UnaddressedMessage; team: Array<{ bot: string; role?: string }> }> = [];

  async route(message: UnaddressedMessage, team: Array<{ bot: string; role?: string }>) {
    this.calls.push({ message, team });
    if (this.failWith) throw this.failWith;
    return this.selects;
  }
}
