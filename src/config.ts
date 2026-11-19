import { readFileSync } from "node:fs";

/** The settings of one Bridge: one Discord bot and its Grok Bot routine. */
export interface BridgeConfig {
  /** The name that Grok Bot uses in the "bot" setting of the Discord tools. */
  name: string;
  discordToken: string;
  /** Not set until you create the Grok Bot routine. */
  routine?: { url: string; key: string };
  /** What the bot does in the team. The other Grok Bots see it with each Task. */
  role?: string;
}

export interface Config {
  bridges: BridgeConfig[];
  /** One connector token for all Bridges. */
  mcpToken: string;
  mcpPort: number;
  mcpHost: string;
  databasePath: string;
  /** The maximum number of Tasks between bots in one Conversation. 0 means that bots cannot give each other Tasks. */
  maxBotSteps: number;
  /** The maximum number of Conversations that bots can start in one hour, all bots together. */
  maxBotConversationsPerHour: number;
  /** Not set when the router is off. */
  router?: RouterConfig;
}

/** The router sends messages that mention no bot to the bots that they concern. */
export interface RouterConfig {
  apiKey: string;
  /** The names or IDs of the channels where the router reads the messages, or "all". */
  channels: string[] | "all";
  /** The minimum probability for a bot to receive a message. */
  threshold: number;
}

type Settings = Record<string, unknown>;

const BRIDGE_SETTINGS = ["DISCORD_TOKEN", "GROK_BOT_ROUTINE_URL", "GROK_BOT_ROUTINE_KEY"] as const;
const MIN_TOKEN_LENGTH = 20;
const NAME = /^[a-z0-9][a-z0-9-]*$/;

/**
 * Reads the configuration from environment variables. Bun loads the .env file automatically.
 * If BRIDGES_FILE is set, the settings of each Bridge come from that JSON file.
 */
export function loadConfig(
  env: Record<string, string | undefined> = Bun.env,
  readFile: (path: string) => string = (path) => readFileSync(path, "utf8"),
): Config {
  const value = (name: string) => env[name]?.trim() ?? "";
  const bridgesFile = value("BRIDGES_FILE");

  const missing = [...(bridgesFile ? [] : ["DISCORD_TOKEN"]), "MCP_TOKEN"].filter((name) => !value(name));
  if (missing.length > 0) {
    throw new Error(
      `These environment variables are necessary, but they are not set: ${missing.join(", ")}. Copy .env.example to .env, then write the values in .env.`,
    );
  }
  if (value("MCP_TOKEN").length < MIN_TOKEN_LENGTH) {
    throw new Error(`MCP_TOKEN must have ${MIN_TOKEN_LENGTH} characters or more. Use a random value.`);
  }

  const bridges = bridgesFile ? readBridgesFile(bridgesFile, env, readFile) : [{ name: "default", ...readBridge(env) }];

  const mcpPort = Number(value("MCP_PORT") || 3000);
  if (!Number.isInteger(mcpPort) || mcpPort < 1 || mcpPort > 65535) {
    throw new Error(`MCP_PORT must be an integer from 1 to 65535. The current value is "${env.MCP_PORT}".`);
  }

  const count = (name: string, fallback: number) => {
    const result = Number(value(name) || fallback);
    if (!Number.isInteger(result) || result < 0) {
      throw new Error(`${name} must be an integer, 0 or more. The current value is "${env[name]}".`);
    }
    return result;
  };
  const maxBotSteps = count("MAX_BOT_STEPS", 10);
  const maxBotConversationsPerHour = count("MAX_BOT_CONVERSATIONS_PER_HOUR", 10);

  const apiKey = value("OPENAI_API_KEY");
  const routerChannels = value("ROUTER_CHANNELS");
  if (routerChannels && !apiKey) throw new Error("ROUTER_CHANNELS is set, but OPENAI_API_KEY is not set.");
  if (apiKey && !routerChannels) throw new Error("OPENAI_API_KEY is set, but ROUTER_CHANNELS is not set.");
  const threshold = Number(value("ROUTER_THRESHOLD") || 0.6);
  if (!(threshold >= 0 && threshold <= 1)) {
    throw new Error(`ROUTER_THRESHOLD must be a number from 0 to 1. The current value is "${env.ROUTER_THRESHOLD}".`);
  }
  const router: RouterConfig | undefined = apiKey
    ? {
        apiKey,
        channels: routerChannels === "*" ? "all" : routerChannels.split(",").map((c) => c.trim()).filter(Boolean),
        threshold,
      }
    : undefined;

  return {
    bridges,
    mcpToken: value("MCP_TOKEN"),
    mcpPort,
    mcpHost: value("MCP_HOST") || "0.0.0.0",
    databasePath: value("DATABASE_PATH") || "data/tasks.sqlite",
    maxBotSteps,
    maxBotConversationsPerHour,
    ...(router ? { router } : {}),
  };
}

function readBridgesFile(path: string, env: Settings, readFile: (path: string) => string): BridgeConfig[] {
  const inEnv = BRIDGE_SETTINGS.filter((name) => typeof env[name] === "string" && env[name].trim());
  if (inEnv.length > 0) {
    throw new Error(
      `BRIDGES_FILE is set. Remove ${inEnv.join(", ")} from .env, and write the settings of each Bridge in the Bridges file.`,
    );
  }

  let text: string;
  try {
    text = readFile(path);
  } catch (error) {
    throw new Error(`Cannot read the Bridges file "${path}": ${error instanceof Error ? error.message : error}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`The Bridges file is not valid JSON (${path}).`);
  }
  if (!isObject(parsed)) {
    throw new Error(`The Bridges file must be a JSON object, with the name of each Bridge and its settings.`);
  }

  const bridges = Object.entries(parsed).map(([name, settings]) => {
    if (!NAME.test(name)) {
      throw new Error(
        `The name of a Bridge must have only lowercase letters, digits, and "-", and must start with a letter or a digit. The name "${name}" is not correct.`,
      );
    }
    if (!isObject(settings)) throw new Error(`Bridge "${name}": the settings must be a JSON object.`);
    try {
      if ("MCP_TOKEN" in settings) {
        throw new Error("MCP_TOKEN is not a setting of a Bridge. Write one MCP_TOKEN in .env for all Bridges.");
      }
      const role = typeof settings.ROLE === "string" ? settings.ROLE.trim() : "";
      return {
        name,
        ...readBridge(settings, "These settings are necessary, but they are not set: {}."),
        ...(role ? { role } : {}),
      };
    } catch (error) {
      throw new Error(`Bridge "${name}": ${error instanceof Error ? error.message : error}`);
    }
  });
  if (bridges.length === 0) throw new Error(`The Bridges file has no Bridges.`);

  const seen = new Map<string, string>();
  for (const bridge of bridges) {
    const first = seen.get(bridge.discordToken);
    if (first) {
      throw new Error(`The Bridges "${first}" and "${bridge.name}" use the same DISCORD_TOKEN. Each Bridge must have its own Discord bot.`);
    }
    seen.set(bridge.discordToken, bridge.name);
  }
  return bridges;
}

function readBridge(settings: Settings, missingMessage?: string): Omit<BridgeConfig, "name"> {
  const value = (name: string) => {
    const v = settings[name];
    return typeof v === "string" ? v.trim() : "";
  };

  if (missingMessage && !value("DISCORD_TOKEN")) throw new Error(missingMessage.replace("{}", "DISCORD_TOKEN"));

  const routineUrl = value("GROK_BOT_ROUTINE_URL");
  const routineKey = value("GROK_BOT_ROUTINE_KEY");
  if (routineUrl && !routineKey) throw new Error("GROK_BOT_ROUTINE_URL is set, but GROK_BOT_ROUTINE_KEY is not set.");
  if (routineKey && !routineUrl) throw new Error("GROK_BOT_ROUTINE_KEY is set, but GROK_BOT_ROUTINE_URL is not set.");
  if (routineUrl && !URL.canParse(routineUrl)) {
    throw new Error("GROK_BOT_ROUTINE_URL must be the full URL of the webhook trigger, for example https://….");
  }

  return {
    discordToken: value("DISCORD_TOKEN"),
    ...(routineUrl ? { routine: { url: routineUrl, key: routineKey } } : {}),
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
