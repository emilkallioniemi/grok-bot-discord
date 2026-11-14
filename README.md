# grok-bot-discord

This project connects [Grok Bot](https://x.ai/bot) to Discord. Grok Bot operates in Slack and Microsoft Teams. With this project, your team can use Grok Bot in Discord too.

- **Give work to Grok Bot from Discord.** Mention the bot in a channel, or send it a direct message (DM). Grok Bot receives the task and does the work with its own computer and tools.
- **Grok Bot answers in Discord.** When the work is complete, the Answer shows as a reply to the message that gave the task.
- **Grok Bot uses Discord.** Grok Bot can read the conversation in a channel, send messages, and add reactions. It can also do this from routines, for example to post a report each morning.

> xAI does not make or support this project. You operate the Bridge yourself. Grok Bot uses your Grok Bot plan for each task.

## How it works

Grok Bot has no Discord integration and no API to send it messages. This project, the **Bridge**, connects the two with features that Grok Bot has:

```text
 Discord member                 Bridge                         Grok Bot
 ──────────────                 ──────                         ────────
 "@Grok Bot fix issue 42" ──▶  1. Records the task
                               2. Sends it to the routine ──▶  Routine (webhook trigger)
                                  webhook                      starts work
 👀 on the message      ◀───── 3. Shows that Grok Bot
                                  received the task
                                                               Does the work
 Reply with the Answer  ◀───── 4. MCP server: answer_task ◀──  Calls the Discord tools
                                  (custom connector)
```

1. A member mentions the Bridge bot or sends it a DM. That message gives a **task**.
2. The Bridge sends the task to a Grok Bot **routine** with a webhook trigger.
3. Grok Bot does the work. It uses the **Discord tools** on the MCP server of the Bridge, which you add to Grok Bot as a custom connector.
4. Grok Bot posts the **Answer** with the `answer_task` tool.

[CONTEXT.md](CONTEXT.md) defines the terms. [docs/adr](docs/adr) records the important decisions.

## Discord tools

| Tool | What Grok Bot can do |
| --- | --- |
| `answer_task` | Post the Answer to a task, as a reply to the message that gave the task |
| `send_message` | Send a message to a channel, also as a reply to a message |
| `read_messages` | Read the last messages of a channel (a maximum of 100 in one call) |
| `add_reaction` | Add an emoji reaction to a message |
| `list_channels` | List the text channels that the Bridge bot can see |

The Bridge does not let messages from Grok Bot mention @everyone, roles, or users. If a message has more than 2,000 characters, the Bridge divides it into more than one Discord message.

## Requirements

- [Bun](https://bun.sh) 1.2 or later
- A Grok Bot plan that includes routines and custom connectors
- A Discord server where you have permission to add bots
- A public HTTPS URL for the MCP server of the Bridge. Grok Bot must be able to connect to it. Use a server, or a tunnel to your computer.

## Setup

### 1. Create the Discord bot

1. Open the [Discord Developer Portal](https://discord.com/developers/applications). Click **New Application**.
2. Go to the **Bot** page. Click **Reset Token**, then copy the token. Keep the token secret.
3. On the same page, set **Message Content Intent** to on. The Bridge must have this intent to read the tasks.
4. Go to the **OAuth2 → URL Generator** page. Select the scope `bot`. Then select these bot permissions:
   - View Channels
   - Send Messages
   - Send Messages in Threads
   - Read Message History
   - Add Reactions
5. Open the URL that the page shows. Add the bot to your server.

Grok Bot can act in all channels that the bot can see (see [ADR 0002](docs/adr/0002-grok-bot-acts-anywhere-the-bridge-user-can-see.md)). Give the bot access only to the channels where Grok Bot must work.

### 2. Start the Bridge

```bash
git clone https://github.com/<your-username>/grok-bot-discord.git
cd grok-bot-discord
bun install
cp .env.example .env
```

In `.env`, write `DISCORD_TOKEN`. For `MCP_TOKEN`, write a long random value. This command makes one:

```bash
openssl rand -hex 32
```

You write the routine values in step 4.

### 3. Add the Discord tools to Grok Bot

In Grok Bot, add a custom connector:

- **Type:** Remote HTTPS
- **Server URL:** the public URL of the Bridge, with the path `/mcp`. For example: `https://bridge.example.com/mcp`
- **HTTP header:** `Authorization` with the value `Bearer <your MCP_TOKEN>`

### 4. Create the routine

In Grok Bot, create a routine and add a webhook trigger to it. Use an instruction such as this one:

> You receive tasks from Discord as JSON. Do the work in the `text` field. If more information is necessary, read the conversation with `read_messages` in the channel of the task. When the work is complete, post the result with `answer_task` and the `task_id`. If you cannot do the task, tell the person with `answer_task`.

Copy the **POST to** URL into `GROK_BOT_ROUTINE_URL`, and the **key** into `GROK_BOT_ROUTINE_KEY`. Then start the Bridge:

```bash
bun start
```

When the Bridge starts, it shows `Connected to Discord as <bot name>` and the URL of the Discord tools.

### 5. Test the connection

In Discord, mention the bot with a small task, for example `@Grok Bot what is in this channel?`. The 👀 reaction shows that Grok Bot received the task. The Answer shows as a reply when Grok Bot completes the work.

If Grok Bot asks for approval before it uses a tool, the Answer waits until you approve it in Grok Bot.

## Configuration

The settings are environment variables. Bun reads them from the `.env` file automatically.

| Variable | Necessary | Default value | Description |
| --- | --- | --- | --- |
| `DISCORD_TOKEN` | Yes | | The token of your Discord bot |
| `GROK_BOT_ROUTINE_URL` | Yes | | The **POST to** URL of the webhook trigger of the routine |
| `GROK_BOT_ROUTINE_KEY` | Yes | | The **key** of the webhook trigger |
| `MCP_TOKEN` | Yes | | The bearer token that Grok Bot sends to the MCP server. It must have 20 characters or more. |
| `MCP_PORT` | No | `3000` | The port of the MCP server |
| `MCP_HOST` | No | `0.0.0.0` | The network address of the MCP server |
| `DATABASE_PATH` | No | `data/tasks.sqlite` | The SQLite file that keeps the tasks. Thus, Grok Bot can answer a task after the Bridge starts again. |

## Limits

- Grok Bot runs each routine a maximum of 200 times in an hour, and all routines together a maximum of 300 times in an hour.
- Each task uses your Grok Bot plan.
- Each member who can see the bot can give tasks.

## Security

- **Keep `MCP_TOKEN` secret.** A person with this token can read and send messages in Discord as the bot.
- **Grok Bot can act in all channels that the bot can see.** Text that Grok Bot reads can try to make it do something bad. Use Discord permissions to limit the channels of the bot.
- **Use HTTPS.** Put the MCP server behind HTTPS, for example with a reverse proxy or a tunnel.

## Privacy

The Bridge sends this data to Grok Bot for each task:

- The text of the task
- The name and Discord ID of the person who gave the task
- The ID and name of the channel

Grok Bot can also read the messages of each channel that the bot can see. The Bridge keeps the tasks in its SQLite file. If you add the bot to a server, tell the members of the server about Grok Bot.

## Deployment

**One executable file.** Bun is not necessary on the computer that operates the Bridge.

```bash
bun run build          # This command creates dist/grok-bot.
./dist/grok-bot        # The Bridge reads .env from the current directory.
```

**Docker:**

```bash
docker build -t grok-bot-discord .
docker run -d --restart unless-stopped --env-file .env -p 3000:3000 -v grok-bot-data:/app/data grok-bot-discord
```

## Development

```bash
bun run dev        # Start the Bridge again after each change to a file.
bun test           # Do the tests.
bun run typecheck  # Do the TypeScript check.
```

The project contains these files:

```text
src/
  domain/task.ts                 The Task
  application/bridge.ts          The use cases: give a task, answer a task, and the Discord tools
  application/ports.ts           The interfaces to Discord, Grok Bot, and the task store
  adapters/routine-webhook.ts    Sends tasks to the Grok Bot routine
  adapters/mcp-server.ts         Gives the Discord tools to Grok Bot (MCP over HTTP)
  adapters/discord-gateway.ts    Does the Discord tools with discord.js
  adapters/sqlite-task-store.ts  Keeps the tasks in SQLite
  split.ts                       Divides long messages into parts that fit in Discord
  trigger.ts                     Finds if a message gives a task
  config.ts                      Reads the environment variables
  index.ts                       Starts the Bridge
test/                            The tests (bun:test)
```

The tests examine the use cases with a fake Discord and a fake routine, and a real SQLite database. They examine the MCP server with a real MCP client over HTTP, and the routine webhook with a real HTTP server.

## Contributions

You can open issues and pull requests. Before you open a pull request, do `bun test` and `bun run typecheck`.

## License

[MIT](LICENSE)
