import { mentions, Refusal, type Bridge, type Mention } from "./bridge";
import type { Attachment, Router } from "./ports";

/** The default maximum number of Tasks between bots in one Conversation. */
export const MAX_BOT_STEPS = 10;

/** The default maximum number of Conversations that bots can start in one hour, all bots together. */
export const MAX_BOT_CONVERSATIONS_PER_HOUR = 10;

const HOUR = 60 * 60 * 1000;

export const botConversationLimit = (max: number) =>
  `⚠️ The bots started ${max} conversations in the last hour. A person must give the next task, or the bots must wait.`;

export const botStepLimit = (max: number) =>
  `⚠️ The bots gave each other ${max} tasks in this conversation. A person must give the next task.`;

export interface BridgesOptions {
  /** The Discord user ID of the bot of each Bridge. */
  userIds?: Record<string, string>;
  /** The maximum number of Tasks between bots in one Conversation. */
  maxBotSteps?: number;
  /** The maximum number of Conversations that bots can start in one hour, all bots together. */
  maxBotConversationsPerHour?: number;
  clock?: () => Date;
  log?: (message: string, error: unknown) => void;
  /** More names of the bot of each Bridge, for example its Discord display name. Grok Bot can write "@name" with them. */
  displayNames?: Record<string, string[]>;
}

/**
 * All Bridges of this application, behind one set of Discord tools.
 * Grok Bot names the bot for each action. An Answer always goes through the Bridge that received the Task.
 */
export function createBridges(bridges: Record<string, Bridge>, options: BridgesOptions = {}) {
  const names = Object.keys(bridges);
  const list = names.join(", ");
  const maxBotSteps = options.maxBotSteps ?? MAX_BOT_STEPS;
  const maxBotConversations = options.maxBotConversationsPerHour ?? MAX_BOT_CONVERSATIONS_PER_HOUR;
  const clock = options.clock ?? (() => new Date());

  function unknownBot(name: string): Refusal {
    return new Refusal(`There is no Discord bot with the name "${name}". The names are: ${list}.`);
  }

  /**
   * The Discord user IDs of the bots that get a ping: the bots in "mention", and the bots of this
   * application that the text mentions. Mentions of persons in the text do not ping.
   */
  function userIdsOf(mention: string[] = [], text = ""): string[] {
    const named = mention.map((name) => {
      const id = Object.hasOwn(bridges, name) ? options.userIds?.[name] : undefined;
      if (!id) throw unknownBot(name);
      return id;
    });
    const inText = Object.values(options.userIds ?? {}).filter((id) => mentions(text, id));
    return [...new Set([...named, ...inText])];
  }

  const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  /**
   * Grok Bot often writes a mention as "@Pia", as a person does. In Discord, that is only text.
   * This changes "@name" of a bot of this application into a real mention. E-mail addresses and longer words stay.
   */
  function linkMentions(text: string): string {
    // The longest names first: "@Pia Product" must not become a mention of "pia" and the text " Product".
    const aliases = names
      .flatMap((name) => [name, ...(options.displayNames?.[name] ?? [])].map((alias) => ({ alias, id: options.userIds?.[name] })))
      .filter((a): a is { alias: string; id: string } => a.id !== undefined && a.alias.trim() !== "")
      .sort((a, b) => b.alias.length - a.alias.length);
    let result = text;
    for (const { alias, id } of aliases) {
      const pattern = new RegExp(`(^|[^\\p{L}\\p{N}_.@<])@${escape(alias)}(?![\\p{L}\\p{N}_])`, "giu");
      result = result.replace(pattern, `$1<@${id}>`);
    }
    return result;
  }

  return {
    names,

    /** The Bridge of a bot. With only one bot, the name is optional. */
    bot(name: string | undefined): Bridge {
      if (name === undefined || name === "") {
        if (names.length === 1) return bridges[names[0]!]!;
        throw new Refusal(`Set "bot" to the name of a Discord bot: ${list}.`);
      }
      const bridge = Object.hasOwn(bridges, name) ? bridges[name] : undefined;
      if (!bridge) throw unknownBot(name);
      return bridge;
    },

    maxBotSteps,

    /**
     * A bot of this Bridge mentions the bot "to", or replies to it. A reply to a message that gave a Task continues
     * that Conversation: the Bridge counts all Tasks between bots in it, also when the replies go to earlier messages.
     * Other messages start a new Conversation. Bots can start only a limited number of Conversations in one hour.
     * Thus, they cannot avoid the limit of a Conversation with new Conversations.
     */
    async giveTaskFromBot(to: string, mention: Mention, replyTo: string | undefined): Promise<void> {
      const receiver = bridges[to];
      if (!receiver || maxBotSteps === 0) return;
      const conversationId =
        replyTo === undefined
          ? undefined
          : Object.values(bridges)
              .map((bridge) => bridge.conversationAt(replyTo))
              .find((id) => id !== undefined);
      if (conversationId === undefined) {
        if (maxBotConversations === 0) return;
        const since = new Date(clock().getTime() - HOUR);
        const started = Object.values(bridges).reduce((sum, bridge) => sum + bridge.botConversationsSince(since), 0);
        if (started >= maxBotConversations) {
          await receiver.sendMessage(mention.channelId, botConversationLimit(maxBotConversations), { replyTo: mention.messageId });
          return;
        }
        await receiver.giveTask({ ...mention, botSteps: 1 });
        return;
      }
      const before = Object.values(bridges).reduce((sum, bridge) => sum + bridge.botTasksIn(conversationId), 0);
      if (before >= maxBotSteps) {
        await receiver.sendMessage(mention.channelId, botStepLimit(maxBotSteps), { replyTo: mention.messageId });
        return;
      }
      await receiver.giveTask({ ...mention, botSteps: before + 1, conversationId });
    },

    /**
     * A message from a person that mentions no bot. The router decides which bots it concerns.
     * Each of these bots receives it as a routed Task, and its Grok Bot decides if it acts.
     */
    async routeMessage(mention: Mention, router: Router, roles: Record<string, string | undefined>): Promise<void> {
      const team = names.map((bot) => ({ bot, ...(roles[bot] ? { role: roles[bot] } : {}) }));
      let selected: string[];
      try {
        selected = await router.route(
          { text: mention.text, authorName: mention.requester.name, channelName: mention.channelName },
          team,
        );
      } catch (error) {
        (options.log ?? console.error)("The router could not decide which bots a message concerns:", error);
        return;
      }
      for (const name of new Set(selected)) {
        const bridge = Object.hasOwn(bridges, name) ? bridges[name] : undefined;
        if (bridge) await bridge.giveTask({ ...mention, routed: true });
      }
    },

    async answerTask(taskId: string, text: string, mention?: string[], files?: Attachment[]) {
      const owner = Object.values(bridges).find((bridge) => bridge.hasTask(taskId));
      if (!owner) throw new Refusal(`There is no task with the ID "${taskId}".`);
      const linked = linkMentions(text);
      return owner.answerTask(taskId, linked, { mentionUserIds: userIdsOf(mention, linked), ...(files ? { files } : {}) });
    },

    async sendMessage(
      bot: string | undefined,
      channelId: string,
      text: string,
      options: { replyTo?: string; mention?: string[]; files?: Attachment[] } = {},
    ) {
      const sender = this.bot(bot);
      const linked = linkMentions(text);
      return sender.sendMessage(channelId, linked, {
        ...(options.replyTo ? { replyTo: options.replyTo } : {}),
        mentionUserIds: userIdsOf(options.mention, linked),
        ...(options.files ? { files: options.files } : {}),
      });
    },

    /** Each channel one time, with the bots that can see it. */
    async listChannels() {
      const channels = new Map<string, { id: string; name: string; guildName: string; bots: string[] }>();
      for (const name of names) {
        for (const channel of await bridges[name]!.listChannels()) {
          const known = channels.get(channel.id) ?? { ...channel, bots: [] };
          known.bots.push(name);
          channels.set(channel.id, known);
        }
      }
      return [...channels.values()];
    },
  };
}

export type Bridges = ReturnType<typeof createBridges>;
