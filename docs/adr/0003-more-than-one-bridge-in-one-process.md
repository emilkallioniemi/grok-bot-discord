# One process and one connector for more than one Discord bot

A team can have more than one Grok Bot, each with a different responsibility. Each Grok Bot must have its own Discord bot, so that members see which Grok Bot they give a Task to. One process operates one Bridge for each Discord bot. All Bridges use one MCP server, one path (`/mcp`), and one connector token. Each Discord tool has a `bot` setting, and Grok Bot names the bot that must act. `answer_task` has no `bot` setting: the Answer always goes through the Bridge that received the Task. All Bridges keep their Tasks in one SQLite file, and each Bridge sees only its own Tasks.

With only `.env`, the process operates one Bridge, and the `bot` setting is optional.

## Considered options

- **One process for each Bridge.** This needs no code, but each Bridge needs its own port and its own tunnel.
- **One connector for each Bridge, each with its own path and token.** We built this first. Then we found that in Grok Bot, all Grok Bots of an account can see all connectors and routines. Thus, separate tokens do not stop one Grok Bot from acting as a different bot. Also, Grok Bot sees two sets of tools with the same names and can use the wrong set.
- **One Discord bot that sends Tasks to different routines.** Then all Grok Bots have the same name and avatar in Discord, and members cannot see which Grok Bot does the work.

## Consequences

- The routine instruction, not a token, decides which bot a Grok Bot acts as. A Grok Bot can act as each bot of the Bridge. Do not add a bot to the Bridge if a Grok Bot must not act as it.
- A tool call without `bot` does nothing when there is more than one bot. Thus, a Grok Bot cannot act as a bot that it did not name.
- The Handoff tells the routine the name of its bot.
- If the process stops, all Bridges stop. If one Bridge cannot connect to Discord, the other Bridges continue.
