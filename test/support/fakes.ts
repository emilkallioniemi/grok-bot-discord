import type { ChannelSummary, DiscordGateway, DiscordMessage } from "../../src/application/ports";
import type { Routine } from "../../src/application/ports";
import type { Task } from "../../src/domain/task";

/** A fake Discord at the system boundary. It records what the Bridge does in Discord. */
export class FakeDiscord implements DiscordGateway {
  sent: Array<{ channelId: string; text: string; replyTo?: string }> = [];
  reactions: Array<{ channelId: string; messageId: string; emoji: string }> = [];
  history = new Map<string, DiscordMessage[]>();
  channels: ChannelSummary[] = [];
  #nextId = 1000;

  async sendMessage(channelId: string, text: string, options?: { replyTo?: string }) {
    this.sent.push({ channelId, text, ...(options?.replyTo ? { replyTo: options.replyTo } : {}) });
    return { messageIds: [String(this.#nextId++)] };
  }

  async readMessages(channelId: string, options: { limit: number; before?: string }) {
    const all = this.history.get(channelId) ?? [];
    const end = options.before ? all.findIndex((m) => m.id === options.before) : all.length;
    return all.slice(Math.max(0, (end === -1 ? all.length : end) - options.limit), end === -1 ? all.length : end);
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
  failWith: Error | null = null;

  async handOff(task: Task) {
    if (this.failWith) throw this.failWith;
    this.handoffs.push(task);
  }
}
