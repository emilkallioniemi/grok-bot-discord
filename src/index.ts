import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Client, Events, GatewayIntentBits, Partials, type Message } from "discord.js";
import { createDiscordGateway } from "./adapters/discord-gateway";
import { startMcpServer } from "./adapters/mcp-server";
import { createDecisionsRouter } from "./adapters/decisions-router";
import { createRoutineWebhook } from "./adapters/routine-webhook";
import { openTaskStore } from "./adapters/sqlite-task-store";
import { createBridge, type Bridge } from "./application/bridge";
import { createBridges, type Bridges } from "./application/bridges";
import { loadConfig, type BridgeConfig, type Config } from "./config";
import { extractPrompt } from "./trigger";

let config: Config;
try {
  config = loadConfig();
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}

if (config.databasePath !== ":memory:") mkdirSync(dirname(config.databasePath), { recursive: true });

/** The Discord user ID of the bot of each Bridge that is connected, and all Bridges together. */
const botNames = new Map<string, string>();
let bridges: Bridges | undefined;

const router = config.router ? createDecisionsRouter(config.router) : undefined;
const roles = Object.fromEntries(config.bridges.map((b) => [b.name, b.role]));
/** Each bot receives the same message. Only the first bot that receives it sends it to the router. */
const routedMessages = new Set<string>();

/** Sends a message from a person that mentions no bot of this Bridge to the router, in the router channels. */
async function routeIfUnaddressed(message: Message): Promise<void> {
  if (!router || !config.router || !bridges || message.author.bot || !message.inGuild() || !message.content.trim()) return;
  const { channels } = config.router;
  if (channels !== "all" && !channels.includes(message.channel.name) && !channels.includes(message.channelId)) return;
  if ([...botNames.keys()].some((id) => message.mentions.users.has(id))) return; // That bot receives it as a mention.
  if (routedMessages.has(message.id)) return;
  routedMessages.add(message.id);
  if (routedMessages.size > 1000) routedMessages.delete(routedMessages.values().next().value!);
  try {
    await bridges.routeMessage(
      {
        messageId: message.id,
        channelId: message.channelId,
        channelName: message.channel.name,
        guildId: message.guildId,
        requester: { id: message.author.id, name: message.member?.displayName ?? message.author.displayName },
        text: message.content,
      },
      router,
      roles,
    );
  } catch (error) {
    console.error("The Bridge could not route a message:", error);
  }
}

/** Connects one Bridge to Discord. If the connection fails, the other Bridges continue. */
async function startBridge(settings: BridgeConfig): Promise<{ name: string; bridge: Bridge; client: Client; displayNames: string[] } | null> {
  const several = config.bridges.length > 1;
  const label = several ? `[${settings.name}] ` : "";
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

  let ready: Client<true>;
  try {
    const isReady = new Promise<Client<true>>((resolve) => client.once(Events.ClientReady, resolve));
    await client.login(settings.discordToken);
    ready = await isReady;
  } catch (error) {
    console.error(`${label}The Bridge could not connect to Discord:`, error instanceof Error ? error.message : error);
    await client.destroy();
    return null;
  }

  const bridge = createBridge({
    discord: createDiscordGateway(ready),
    ...(settings.routine
      ? {
          routine: createRoutineWebhook({
            ...settings.routine,
            ...(several ? { bot: settings.name, team: config.bridges.map((b) => ({ bot: b.name, ...(b.role ? { role: b.role } : {}) })) } : {}),
            maxBotSteps: config.maxBotSteps,
          }),
        }
      : {}),
    tasks: openTaskStore(config.databasePath, settings.name),
    clock: () => new Date(),
    newTaskId: () => crypto.randomUUID(),
    log: (message, error) => console.error(`${label}${message}`, error),
  });

  botNames.set(ready.user.id, settings.name);
  console.log(`${label}Connected to Discord as ${ready.user.tag}.`);
  if (!settings.routine) {
    console.warn(
      `${label}There is no Grok Bot routine yet. Members cannot give tasks until you set GROK_BOT_ROUTINE_URL and GROK_BOT_ROUTINE_KEY, then start the Bridge again.`,
    );
  }

  client.on(Events.MessageCreate, async (message) => {
    const text = extractPrompt(
      {
        content: message.content,
        authorIsBot: message.author.bot,
        authorIsColleague: message.author.id !== ready.user.id && botNames.has(message.author.id),
        isDM: !message.inGuild(),
        mentionsBot: message.mentions.users.has(ready.user.id),
      },
      ready.user.id,
    );
    if (text === null) {
      await routeIfUnaddressed(message);
      return;
    }
    const fromColleague = message.author.bot;

    try {
      if (fromColleague) {
        if (!text || !bridges) return;
        await bridges.giveTaskFromBot(
          settings.name,
          {
            messageId: message.id,
            channelId: message.channelId,
            channelName: message.inGuild() ? message.channel.name : "direct message",
            ...(message.guildId ? { guildId: message.guildId } : {}),
            requester: { id: message.author.id, name: message.member?.displayName ?? message.author.displayName, isBot: true },
            text,
          },
          message.reference?.messageId,
        );
        return;
      }
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
      console.error(`${label}The Bridge could not process a message:`, error);
    }
  });

  const displayNames = [ready.user.username, ready.user.globalName].filter((n): n is string => Boolean(n));
  return { name: settings.name, bridge, client, displayNames };
}

const started = (await Promise.all(config.bridges.map(startBridge))).filter((s) => s !== null);
if (started.length === 0) {
  console.error("No Bridge could connect to Discord. The Bridge stops now.");
  process.exit(1);
}

bridges = createBridges(Object.fromEntries(started.map((s) => [s.name, s.bridge])), {
  userIds: Object.fromEntries([...botNames].map(([id, name]) => [name, id])),
  maxBotSteps: config.maxBotSteps,
  maxBotConversationsPerHour: config.maxBotConversationsPerHour,
  displayNames: Object.fromEntries(started.map((s) => [s.name, s.displayNames])),
});
const mcp = startMcpServer({
  bridges,
  token: config.mcpToken,
  port: config.mcpPort,
  hostname: config.mcpHost,
});
console.log(`The Discord tools for Grok Bot are at ${mcp.url}.`);
if (config.router) {
  const where = config.router.channels === "all" ? "all channels" : `these channels: ${config.router.channels.join(", ")}`;
  console.log(`The router sends messages that mention no bot to the bots that they concern, in ${where}.`);
}
if (started.length > 1) console.log(`Grok Bot can act as these bots: ${started.map((s) => s.name).join(", ")}.`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    console.log(`Received ${signal}. The Bridge stops now.`);
    mcp.stop();
    await Promise.all(started.map((s) => s.client.destroy()));
    process.exit(0);
  });
}
