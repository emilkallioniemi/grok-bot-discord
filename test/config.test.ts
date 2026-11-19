import { describe, expect, test } from "bun:test";
import { loadConfig } from "../src/config";

const required = {
  DISCORD_TOKEN: "discord-token",
  GROK_BOT_ROUTINE_URL: "https://example.test/hooks/routine",
  GROK_BOT_ROUTINE_KEY: "routine-key",
  MCP_TOKEN: "a-long-random-connector-token",
};

test("shows all missing secrets in one error", () => {
  expect(() => loadConfig({})).toThrow("DISCORD_TOKEN, MCP_TOKEN");
  expect(() => loadConfig({ ...required, MCP_TOKEN: "   " })).toThrow("MCP_TOKEN");
});

test("uses the default values when only the secrets are set", () => {
  expect(loadConfig(required)).toEqual({
    bridges: [
      { name: "default", discordToken: "discord-token", routine: { url: "https://example.test/hooks/routine", key: "routine-key" } },
    ],
    mcpToken: "a-long-random-connector-token",
    mcpPort: 3000,
    mcpHost: "0.0.0.0",
    databasePath: "data/tasks.sqlite",
    maxBotSteps: 10,
    maxBotConversationsPerHour: 10,
  });
});

test("uses the optional settings instead of the default values", () => {
  const config = loadConfig({ ...required, MCP_PORT: "8080", MCP_HOST: "127.0.0.1", DATABASE_PATH: "/var/lib/bridge.sqlite" });
  expect(config).toMatchObject({ mcpPort: 8080, mcpHost: "127.0.0.1", databasePath: "/var/lib/bridge.sqlite" });
});

test("gives an error when the routine URL is not a URL", () => {
  expect(() => loadConfig({ ...required, GROK_BOT_ROUTINE_URL: "routine-abc" })).toThrow("GROK_BOT_ROUTINE_URL");
});

test("gives an error when the connector token is short, because a person who knows the token can use Discord as Grok Bot", () => {
  expect(() => loadConfig({ ...required, MCP_TOKEN: "secret" })).toThrow("MCP_TOKEN must have 20 characters or more");
});

test.each(["0", "70000", "http"])("gives an error for MCP_PORT=%p", (value) => {
  expect(() => loadConfig({ ...required, MCP_PORT: value })).toThrow("MCP_PORT");
});

test("starts without the routine settings, so that you can add the connector to Grok Bot before you create the routine", () => {
  const { GROK_BOT_ROUTINE_URL, GROK_BOT_ROUTINE_KEY, ...withoutRoutine } = required;
  expect(loadConfig(withoutRoutine).bridges[0]!.routine).toBeUndefined();
});

test.each([
  ["GROK_BOT_ROUTINE_KEY", { GROK_BOT_ROUTINE_KEY: "" }],
  ["GROK_BOT_ROUTINE_URL", { GROK_BOT_ROUTINE_URL: "" }],
])("gives an error when only one routine setting is set (%s is missing)", (missing, change) => {
  expect(() => loadConfig({ ...required, ...change })).toThrow(`${missing} is not set`);
});

test("uses MAX_BOT_STEPS as the maximum number of tasks between bots in one conversation", () => {
  expect(loadConfig({ ...required, MAX_BOT_STEPS: "4" }).maxBotSteps).toBe(4);
  expect(loadConfig({ ...required, MAX_BOT_STEPS: "0" }).maxBotSteps).toBe(0);
});

test.each(["-1", "two", "1.5"])("gives an error for MAX_BOT_STEPS=%p", (value) => {
  expect(() => loadConfig({ ...required, MAX_BOT_STEPS: value })).toThrow("MAX_BOT_STEPS");
});

test("uses MAX_BOT_CONVERSATIONS_PER_HOUR as the maximum number of conversations that bots can start in one hour", () => {
  expect(loadConfig({ ...required, MAX_BOT_CONVERSATIONS_PER_HOUR: "3" }).maxBotConversationsPerHour).toBe(3);
  expect(() => loadConfig({ ...required, MAX_BOT_CONVERSATIONS_PER_HOUR: "-2" })).toThrow("MAX_BOT_CONVERSATIONS_PER_HOUR");
});

describe("router", () => {
  test("is off when the router settings are not set", () => {
    expect(loadConfig(required).router).toBeUndefined();
  });

  test("routes the messages of the channels in ROUTER_CHANNELS, with the OpenAI API key", () => {
    expect(loadConfig({ ...required, OPENAI_API_KEY: "sk-x", ROUTER_CHANNELS: " team, 123456 ,beslut" }).router).toEqual({
      apiKey: "sk-x",
      channels: ["team", "123456", "beslut"],
      threshold: 0.6,
    });
  });

  test("routes the messages of all channels with ROUTER_CHANNELS=*", () => {
    expect(loadConfig({ ...required, OPENAI_API_KEY: "sk-x", ROUTER_CHANNELS: "*" }).router?.channels).toBe("all");
  });

  test("uses ROUTER_THRESHOLD, from 0 to 1", () => {
    expect(loadConfig({ ...required, OPENAI_API_KEY: "sk-x", ROUTER_CHANNELS: "*", ROUTER_THRESHOLD: "0.8" }).router?.threshold).toBe(0.8);
    expect(() => loadConfig({ ...required, OPENAI_API_KEY: "sk-x", ROUTER_CHANNELS: "*", ROUTER_THRESHOLD: "2" })).toThrow(
      "ROUTER_THRESHOLD",
    );
  });

  test("gives an error when only one of the two router settings is set", () => {
    expect(() => loadConfig({ ...required, ROUTER_CHANNELS: "team" })).toThrow("ROUTER_CHANNELS is set, but OPENAI_API_KEY is not set.");
    expect(() => loadConfig({ ...required, OPENAI_API_KEY: "sk-x" })).toThrow("OPENAI_API_KEY is set, but ROUTER_CHANNELS is not set.");
  });
});

describe("Bridges file", () => {
  const MCP_TOKEN = "one-long-random-connector-token";
  const pia = {
    DISCORD_TOKEN: "pia-discord-token",
    GROK_BOT_ROUTINE_URL: "https://example.test/hooks/pia",
    GROK_BOT_ROUTINE_KEY: "pia-routine-key",
  };
  const ditte = { DISCORD_TOKEN: "ditte-discord-token" };
  const fromFile = (bridges: unknown, env: Record<string, string> = { MCP_TOKEN }) =>
    loadConfig({ BRIDGES_FILE: "bridges.json", ...env }, (path) => {
      expect(path).toBe("bridges.json");
      return typeof bridges === "string" ? bridges : JSON.stringify(bridges);
    });

  test("runs one Bridge for each name in the file, and all Bridges use the one connector token of .env", () => {
    expect(fromFile({ pia, ditte }, { MCP_TOKEN, MCP_PORT: "4000" })).toEqual({
      bridges: [
        { name: "pia", discordToken: "pia-discord-token", routine: { url: "https://example.test/hooks/pia", key: "pia-routine-key" } },
        { name: "ditte", discordToken: "ditte-discord-token" },
      ],
      mcpToken: MCP_TOKEN,
      mcpPort: 4000,
      mcpHost: "0.0.0.0",
      databasePath: "data/tasks.sqlite",
      maxBotSteps: 10,
      maxBotConversationsPerHour: 10,
    });
  });

  test("each Bridge can have a role, so that the other Grok Bots know what the bot does", () => {
    const config = fromFile({ pia: { ...pia, ROLE: " Product owner: priorities and decisions. " }, ditte });
    expect(config.bridges.map((b) => b.role)).toEqual(["Product owner: priorities and decisions.", undefined]);
  });

  test("the connector token is necessary in .env", () => {
    expect(() => fromFile({ pia }, {})).toThrow("MCP_TOKEN");
    expect(() => fromFile({ pia }, { MCP_TOKEN: "short" })).toThrow("MCP_TOKEN must have 20 characters or more");
  });

  test("tells which Bridge has the error", () => {
    expect(() => fromFile({ pia, ditte: {} })).toThrow('Bridge "ditte": These settings are necessary, but they are not set: DISCORD_TOKEN.');
    expect(() => fromFile({ pia, ditte: { ...ditte, GROK_BOT_ROUTINE_URL: "x" } })).toThrow('Bridge "ditte": GROK_BOT_ROUTINE_URL');
  });

  test("gives an error when a Bridge has its own MCP_TOKEN, because one connector is for all bots", () => {
    expect(() => fromFile({ pia: { ...pia, MCP_TOKEN: "another-long-random-token" } })).toThrow(
      'Bridge "pia": MCP_TOKEN is not a setting of a Bridge. Write one MCP_TOKEN in .env for all Bridges.',
    );
  });

  test("gives an error when two Bridges use the same Discord bot, because then each mention gives two Tasks", () => {
    expect(() => fromFile({ pia, ditte: { DISCORD_TOKEN: pia.DISCORD_TOKEN } })).toThrow(
      'The Bridges "pia" and "ditte" use the same DISCORD_TOKEN',
    );
  });

  test.each(["Pia", "my bot", "", "-pia", "../x"])("gives an error for the Bridge name %p, because Grok Bot must write the name exactly", (name) => {
    expect(() => fromFile({ [name]: pia })).toThrow("The name of a Bridge");
  });

  test.each([
    ["no Bridges", {}, "The Bridges file has no Bridges"],
    ["not JSON", "{ pia: ", "The Bridges file is not valid JSON"],
    ["a list", [pia], "The Bridges file must be a JSON object"],
    ["a Bridge that is not an object", { pia: "token" }, 'Bridge "pia": the settings must be a JSON object'],
  ])("gives an error for a file with %s", (_, content, message) => {
    expect(() => fromFile(content)).toThrow(message);
  });

  test("gives an error when .env also sets the settings of a Bridge, because then it is not clear which Bridge to start", () => {
    expect(() => fromFile({ pia }, { MCP_TOKEN, DISCORD_TOKEN: "x" })).toThrow("Remove DISCORD_TOKEN");
  });

  test("gives an error that shows the path when the file cannot be read", () => {
    expect(() =>
      loadConfig({ BRIDGES_FILE: "missing.json", MCP_TOKEN }, () => {
        throw new Error("ENOENT");
      }),
    ).toThrow('Cannot read the Bridges file "missing.json"');
  });
});
