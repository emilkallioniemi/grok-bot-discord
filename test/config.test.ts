import { expect, test } from "bun:test";
import { loadConfig } from "../src/config";

const required = {
  DISCORD_TOKEN: "discord-token",
  GROK_BOT_ROUTINE_URL: "https://example.test/hooks/routine",
  GROK_BOT_ROUTINE_KEY: "routine-key",
  MCP_TOKEN: "a-long-random-connector-token",
};

test("shows all missing secrets in one error", () => {
  expect(() => loadConfig({})).toThrow("DISCORD_TOKEN, GROK_BOT_ROUTINE_URL, GROK_BOT_ROUTINE_KEY, MCP_TOKEN");
  expect(() => loadConfig({ ...required, MCP_TOKEN: "   " })).toThrow("MCP_TOKEN");
});

test("uses the default values when only the secrets are set", () => {
  expect(loadConfig(required)).toEqual({
    discordToken: "discord-token",
    routineUrl: "https://example.test/hooks/routine",
    routineKey: "routine-key",
    mcpToken: "a-long-random-connector-token",
    mcpPort: 3000,
    mcpHost: "0.0.0.0",
    databasePath: "data/tasks.sqlite",
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
