import { ChannelType, PermissionFlagsBits, type Client, type Message } from "discord.js";
import type { ChannelSummary, DiscordGateway, DiscordMessage } from "../application/ports";
import { splitMessage } from "../split";

/** Text from Grok Bot must not mention @everyone, roles, or users. */
const NO_MENTIONS = { parse: [] as never[], repliedUser: true };

/** Does the actions of the Discord tools with discord.js, as the Bridge user. */
export function createDiscordGateway(client: Client<true>): DiscordGateway {
  async function textChannel(channelId: string) {
    const channel = await client.channels.fetch(channelId);
    if (!channel?.isTextBased() || !channel.isSendable()) {
      throw new Error(`The channel ${channelId} is not a text channel that the Bridge user can use.`);
    }
    return channel;
  }

  return {
    async sendMessage(channelId, text, options) {
      const channel = await textChannel(channelId);
      const messageIds: string[] = [];
      for (const [index, part] of splitMessage(text).entries()) {
        const reply = index === 0 && options?.replyTo ? { messageReference: options.replyTo, failIfNotExists: false } : undefined;
        const sent = await channel.send({ content: part, allowedMentions: NO_MENTIONS, ...(reply ? { reply } : {}) });
        messageIds.push(sent.id);
      }
      return { messageIds };
    },

    async readMessages(channelId, { limit, before }) {
      const channel = await textChannel(channelId);
      const messages = await channel.messages.fetch({ limit, ...(before ? { before } : {}) });
      // Discord gives the newest message first.
      return [...messages.values()].reverse().map(toDiscordMessage);
    },

    async addReaction(channelId, messageId, emoji) {
      const channel = await textChannel(channelId);
      const message = await channel.messages.fetch(messageId);
      await message.react(emoji);
    },

    async listChannels() {
      const channels: ChannelSummary[] = [];
      for (const guild of client.guilds.cache.values()) {
        const me = guild.members.me;
        for (const channel of guild.channels.cache.values()) {
          const textLike = channel.type === ChannelType.GuildText || channel.type === ChannelType.GuildAnnouncement;
          if (textLike && me && channel.permissionsFor(me).has(PermissionFlagsBits.ViewChannel)) {
            channels.push({ id: channel.id, name: channel.name, guildName: guild.name });
          }
        }
      }
      return channels;
    },
  };
}

function toDiscordMessage(message: Message): DiscordMessage {
  const attachments = [...message.attachments.values()].map((a) => `[attachment: ${a.name}] ${a.url}`);
  return {
    id: message.id,
    authorId: message.author.id,
    authorName: message.member?.displayName ?? message.author.displayName,
    text: [message.content, ...attachments].filter(Boolean).join("\n"),
    sentAt: message.createdAt,
  };
}
