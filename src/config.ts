export interface Config {
  discordToken: string;
  routineUrl: string;
  routineKey: string;
  mcpToken: string;
  mcpPort: number;
  mcpHost: string;
  databasePath: string;
}

const REQUIRED = ["DISCORD_TOKEN", "GROK_BOT_ROUTINE_URL", "GROK_BOT_ROUTINE_KEY", "MCP_TOKEN"] as const;
const MIN_TOKEN_LENGTH = 20;

/** Reads the configuration from environment variables. Bun loads the .env file automatically. */
export function loadConfig(env: Record<string, string | undefined> = Bun.env): Config {
  const value = (name: string) => env[name]?.trim() ?? "";

  const missing = REQUIRED.filter((name) => !value(name));
  if (missing.length > 0) {
    throw new Error(
      `These environment variables are necessary, but they are not set: ${missing.join(", ")}. Copy .env.example to .env, then write the values in .env.`,
    );
  }

  if (!URL.canParse(value("GROK_BOT_ROUTINE_URL"))) {
    throw new Error("GROK_BOT_ROUTINE_URL must be the full URL of the webhook trigger, for example https://….");
  }

  if (value("MCP_TOKEN").length < MIN_TOKEN_LENGTH) {
    throw new Error(`MCP_TOKEN must have ${MIN_TOKEN_LENGTH} characters or more. Use a random value.`);
  }

  const mcpPort = Number(value("MCP_PORT") || 3000);
  if (!Number.isInteger(mcpPort) || mcpPort < 1 || mcpPort > 65535) {
    throw new Error(`MCP_PORT must be an integer from 1 to 65535. The current value is "${env.MCP_PORT}".`);
  }

  return {
    discordToken: value("DISCORD_TOKEN"),
    routineUrl: value("GROK_BOT_ROUTINE_URL"),
    routineKey: value("GROK_BOT_ROUTINE_KEY"),
    mcpToken: value("MCP_TOKEN"),
    mcpPort,
    mcpHost: value("MCP_HOST") || "0.0.0.0",
    databasePath: value("DATABASE_PATH") || "data/tasks.sqlite",
  };
}
