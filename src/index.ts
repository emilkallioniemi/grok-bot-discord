import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Client, Events, GatewayIntentBits, Partials } from "discord.js";
import { createDiscordGateway } from "./adapters/discord-gateway";
import { startMcpServer } from "./adapters/mcp-server";
import { createRoutineWebhook } from "./adapters/routine-webhook";
import { openTaskStore } from "./adapters/sqlite-task-store";
import { createBridge } from "./application/bridge";
import { loadConfig, type Config } from "./config";
import { extractPrompt } from "./trigger";

let config: Config;
try {
  config = loadConfig();
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel], // This is necessary to receive DMs.
});

client.once(Events.ClientReady, (ready) => {
  if (config.databasePath !== ":memory:") mkdirSync(dirname(config.databasePath), { recursive: true });

  const bridge = createBridge({
    discord: createDiscordGateway(ready),
    routine: createRoutineWebhook({ url: config.routineUrl, key: config.routineKey }),
    tasks: openTaskStore(config.databasePath),
    clock: () => new Date(),
    newTaskId: () => crypto.randomUUID(),
  });

  const mcp = startMcpServer({ bridge, token: config.mcpToken, port: config.mcpPort, hostname: config.mcpHost });
  console.log(`Connected to Discord as ${ready.user.tag}.`);
  console.log(`The Discord tools for Grok Bot are at ${mcp.url}.`);

  client.on(Events.MessageCreate, async (message) => {
    const text = extractPrompt(
      {
        content: message.content,
        authorIsBot: message.author.bot,
        isDM: !message.inGuild(),
        mentionsBot: message.mentions.users.has(ready.user.id),
      },
      ready.user.id,
    );
    if (text === null) return;

    try {
      if (!text) {
        await message.reply({ content: "Hello. Write the task for Grok Bot after the mention.", allowedMentions: { parse: [] } });
        return;
      }
      await bridge.giveTask({
        messageId: message.id,
        channelId: message.channelId,
        channelName: message.inGuild() ? message.channel.name : "direct message",
        ...(message.guildId ? { guildId: message.guildId } : {}),
        requester: { id: message.author.id, name: message.member?.displayName ?? message.author.displayName },
        text,
      });
    } catch (error) {
      console.error("The Bridge could not process a message:", error);
    }
  });

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, async () => {
      console.log(`Received ${signal}. The Bridge stops now.`);
      mcp.stop();
      await client.destroy();
      process.exit(0);
    });
  }
});

await client.login(config.discordToken);
