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
| `answer_task` | Post the Answer to a task, as a reply to the message that gave the task, also with files |
| `send_message` | Send a message to a channel, also as a reply to a message, and also with files |
| `read_messages` | Read the last messages of a channel (a maximum of 100 in one call) |
| `add_reaction` | Add an emoji reaction to a message |
| `list_channels` | List the text channels that the Bridge bot can see |

With more than one Discord bot, each tool except `answer_task` has a `bot` setting, and `answer_task` and `send_message` have a `mention` setting to give tasks to a different bot. See [More than one Grok Bot](#more-than-one-grok-bot).

`answer_task` and `send_message` can attach files: a maximum of 10 files, and 10 MB together. Grok Bot sends text files, for example SVG, Markdown, or code, as `content`, and binary files, for example PDF or PNG, as `content_base64`. Each task tells Grok Bot to put long work in a file and to write one short line about it, as a person does in Discord.

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

Then start the Bridge:

```bash
bun start
```

The Bridge starts without the routine values. You write them in step 4. Until then, the Bridge tells members who give a task that the routine is not set up.

Grok Bot must connect to the Bridge through a public HTTPS URL. On a server, use a reverse proxy with HTTPS. On your computer, use a tunnel. For example, start one of these tunnels in a second terminal:

```bash
bunx localtunnel --port 3000
```

```bash
cloudflared tunnel --url http://localhost:3000
```

The tunnel shows a public URL. If you restart the tunnel, the URL can change. Then you must change the URL of the connector in Grok Bot too.

### 3. Add the Discord tools to Grok Bot

In Grok Bot, add a custom connector:

- **Type:** Remote HTTPS
- **Server URL:** the public URL of the Bridge, with the path `/mcp`. For example: `https://bridge.example.com/mcp`
- **HTTP header:** `Authorization` with the value `Bearer <your MCP_TOKEN>`
- **Only for localtunnel:** the HTTP header `bypass-tunnel-reminder` with the value `true`. Without this header, localtunnel can show a warning page to Grok Bot.

### 4. Create the routine

In Grok Bot, create a routine and add a webhook trigger to it. Use an instruction such as this one:

> You receive tasks from Discord as JSON. Do the work in the `text` field. If more information is necessary, read the conversation with `read_messages` in the channel of the task. When the work is complete, post the result with `answer_task` and the `task_id`. If you cannot do the task, tell the person with `answer_task`.

Copy the **POST to** URL into `GROK_BOT_ROUTINE_URL`, and the **key** into `GROK_BOT_ROUTINE_KEY`. Then stop the Bridge and start it again. Do not stop the tunnel.

When the Bridge starts, it shows `Connected to Discord as <bot name>` and the URL of the Discord tools.

### 5. Test the connection

In Discord, mention the bot with a small task, for example `@Grok Bot what is in this channel?`. The 👀 reaction shows that Grok Bot received the task. The Answer shows as a reply when Grok Bot completes the work.

If Grok Bot asks for approval before it uses a tool, the Answer waits until you approve it in Grok Bot.

## More than one Grok Bot

You can connect more than one Grok Bot to Discord, for example one Grok Bot for support and one for operations. Each Grok Bot gets its own Discord bot, so members see which Grok Bot they give a task to. One Bridge process, one port, one tunnel, and one connector are sufficient for all of them (see [ADR 0003](docs/adr/0003-more-than-one-bridge-in-one-process.md)).

1. For each Grok Bot, do step 1 again: create one more Discord application and add its bot to your server.
2. Copy `bridges.example.json` to `bridges.json`. For each Discord bot, write a name and its `DISCORD_TOKEN`. The name must have only lowercase letters, digits, and `-`. Also write a `ROLE`: what the bot does, and what it does not do. Each Grok Bot sees the roles of all bots with each task. Thus, a Grok Bot gives a task only to the correct bot, and refuses a task that is not in its role.
3. In `.env`, set `BRIDGES_FILE=bridges.json`. Remove `DISCORD_TOKEN`, `GROK_BOT_ROUTINE_URL`, and `GROK_BOT_ROUTINE_KEY` from `.env`. Keep `MCP_TOKEN`.
4. Start the Bridge. Add the connector to Grok Bot one time (step 3). All Grok Bots of your account can use it.
5. For each Grok Bot, create a routine (step 4). In the instruction, write which bot it is, for example: "You are Ditte. For the Discord tools, set `bot` to `ditte`." Copy the URL and the key of the routine into the entry of that bot in `bridges.json`. Then start the Bridge again.

Each Discord tool has a `bot` setting. With more than one bot, a tool call without `bot` does nothing. `answer_task` does not need `bot`: the Answer always comes from the bot that received the task. The Bridge also tells each routine the name of its bot in each task.

In Grok Bot, all Grok Bots of an account can use all connectors. Thus, each Grok Bot can act as each bot of the Bridge. The routine instruction, not a token, decides which bot a Grok Bot acts as.

### Tasks between bots

The bots talk to each other in Discord as persons do. For example, Ditte works on a task and must ask Pia a question:

1. Ditte answers with a mention of Pia. Ditte can write `@Pia` in the text, as a person does, or use `mention: ["pia"]`. The Bridge changes `@name` of each bot of this Bridge into a real Discord mention. The name of the Bridge and the Discord name of the bot both work, in each case.
2. Pia receives a task from Ditte. Pia answers as a reply to Ditte.
3. Ditte receives the answer as a task, because it is a reply to her message. Ditte can continue her work, ask more, say thank you, or add a 👍 reaction.

Each task tells the Grok Bot that Discord is a chat: short and casual messages, without greetings or sign-offs. With more than one bot, each task also contains the `team`: each bot and its `ROLE`.

Each Grok Bot decides if the conversation continues. A reaction gives no task, so a reaction is a good way to end a conversation. Each task contains the conversation before it: the chain of replies, a maximum of 10 messages.

To prevent loops, these rules apply (see [ADR 0004](docs/adr/0004-bots-of-the-bridge-give-each-other-tasks.md)):

- A reply continues a conversation. `answer_task` always makes a reply. A message from a bot that is not a reply starts a new conversation, for example a message from a routine on a schedule.
- After `MAX_BOT_STEPS` tasks between bots in one conversation (10 if you do not set it), the bot refuses the next task. Then a person must give a task. Replies to earlier messages of the conversation count too.
- All bots together can start a maximum of `MAX_BOT_CONVERSATIONS_PER_HOUR` conversations in one hour (10 if you do not set it). Then the bot refuses until the hour is complete.
- Only the bots of this Bridge can give tasks. The Bridge ignores other bots.
- `mention` can only ping bots of this Bridge, never persons or roles.

Each task between bots uses a routine run of your Grok Bot plan. In each routine instruction, you can tell the Grok Bot how to end a conversation, for example: "When a bot thanks you, add a 👍 reaction and do not answer."

### Messages to the whole team

You do not have to know which bot to mention. In the channels that you select, a router reads each message from a person that mentions no bot, for example "We change the brand color from red to blue". The router decides which bots the message concerns, from the `ROLE` of each bot, and sends the message to them. The Grok Bot of each bot then decides if it acts. A Grok Bot that acts adds 👀 to the message. The others do nothing.

The router is the [OpenAI Decisions API](https://developers.openai.com/api/docs/guides/decisions) (see [ADR 0005](docs/adr/0005-a-router-sends-messages-without-a-mention-to-the-correct-bots.md)). To use it, set `OPENAI_API_KEY` and `ROUTER_CHANNELS` in `.env`. Start with one channel, for example `ROUTER_CHANNELS=team`, and look at the decisions before you add more channels.

The router can be wrong. A mention always goes to the bot.

`.gitignore` contains `bridges.json`, because the file contains tokens. With Docker, mount the file into the container, for example `-v ./bridges.json:/app/bridges.json:ro`.

## Configuration

The settings are environment variables. Bun reads them from the `.env` file automatically.

| Variable | Necessary | Default value | Description |
| --- | --- | --- | --- |
| `DISCORD_TOKEN` | Yes, if `BRIDGES_FILE` is not set | | The token of your Discord bot |
| `GROK_BOT_ROUTINE_URL` | No | | The **POST to** URL of the webhook trigger of the routine. Members can give tasks only when you set this value and `GROK_BOT_ROUTINE_KEY`. |
| `GROK_BOT_ROUTINE_KEY` | No | | The **key** of the webhook trigger. Set it together with `GROK_BOT_ROUTINE_URL`. |
| `MCP_TOKEN` | Yes | | The bearer token that Grok Bot sends to the MCP server. It must have 20 characters or more. |
| `MCP_PORT` | No | `3000` | The port of the MCP server |
| `MCP_HOST` | No | `0.0.0.0` | The network address of the MCP server |
| `BRIDGES_FILE` | No | | The path of a JSON file with the Discord token and the routine of each bot. See [More than one Grok Bot](#more-than-one-grok-bot). If you set it, do not set `DISCORD_TOKEN` or the routine settings in `.env`. |
| `MAX_BOT_STEPS` | No | `10` | The maximum number of tasks that bots can give each other in one conversation. `0` means that bots cannot give each other tasks. |
| `MAX_BOT_CONVERSATIONS_PER_HOUR` | No | `10` | The maximum number of conversations that bots can start in one hour, all bots together. `0` means that only persons can start conversations. |
| `OPENAI_API_KEY` | No | | The API key for the router. Set it together with `ROUTER_CHANNELS`. |
| `ROUTER_CHANNELS` | No | | The names or IDs of the channels where the router reads messages, separated by commas. `*` means all channels. |
| `ROUTER_THRESHOLD` | No | `0.6` | The minimum probability, from 0 to 1, for a bot to receive a message from the router. |
| `DATABASE_PATH` | No | `data/tasks.sqlite` | The SQLite file that keeps the tasks. Thus, Grok Bot can answer a task after the Bridge starts again. |

## Limits

- Grok Bot runs each routine a maximum of 200 times in an hour, and all routines together a maximum of 300 times in an hour. If more than one Grok Bot uses the same Grok Bot account, the limit of 300 is for all of them together.
- Each task uses your Grok Bot plan.
- Each member who can see the bot can give tasks.
- Bots can give each other a maximum of `MAX_BOT_STEPS` tasks in one conversation (10 if you do not set it).

## Security

- **Keep `MCP_TOKEN` secret.** A person with this token can read and send messages in Discord as each bot of the Bridge.
- **Grok Bot can act in all channels that the bot can see.** Text that Grok Bot reads can try to make it do something bad. Use Discord permissions to limit the channels of the bot.
- **Use HTTPS.** Put the MCP server behind HTTPS, for example with a reverse proxy or a tunnel.

## Privacy

The Bridge sends this data to Grok Bot for each task:

- The text of the task
- The name and Discord ID of the person who gave the task
- The ID and name of the channel

If you use the router, the Bridge also sends the text, the author name, and the channel name of each message in the router channels to OpenAI.

Grok Bot can also read the messages of each channel that the bot can see. The Bridge keeps the tasks in its SQLite file. If you add the bot to a server, tell the members of the server about Grok Bot.

## Deployment

**One executable file.** Bun is not necessary on the computer that operates the Bridge.

```bash
bun run build              # This command creates dist/grok-bot-discord.
./dist/grok-bot-discord    # The Bridge reads .env from the current directory.
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
  application/bridge.ts          The use cases of one bot: give a task, answer a task, and the Discord tools
  application/bridges.ts         All bots behind one set of Discord tools
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
