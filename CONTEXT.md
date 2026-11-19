# Discord bridge for Grok Bot

This project connects a Discord server to Grok Bot. Discord members give work to Grok Bot, and Grok Bot reads and writes in Discord.

## Language

**Grok Bot**:
The xAI product that does work for a team. It has its own computer and uses the tools that you connect to it.
_Avoid_: Grok, the model, the AI

**Bridge**:
The connection between one Discord bot and one Grok Bot. It sends work from Discord to Grok Bot and gives Grok Bot tools to use Discord. This application operates one or more Bridges.
_Avoid_: Discord bot, relay, proxy, instance

**Bridge user**:
The Discord bot account that a Bridge uses in the server. Each Bridge has its own Bridge user.
_Avoid_: bot user, client

**Task**:
One piece of work that a member gives to Grok Bot when the member mentions the Bridge user or sends it a direct message.
_Avoid_: prompt, request, job, ticket

**Role**:
What a bot of this application does in the team, and what it does not do. Each Grok Bot sees the Roles of all bots with each Task.
_Avoid_: job, responsibility, persona

**Routed task**:
A Task from a message that mentions no bot. A router decided that the message can concern the Role of the bot. The Grok Bot decides if it acts.
_Avoid_: broadcast, ambient task, optional task

**Requester**:
The Discord member who gave a Task. It can also be a different bot of this application.
_Avoid_: user, author, sender

**Origin message**:
The Discord message that gave a Task. Answers to the Task go to the channel of this message, as replies to it.
_Avoid_: trigger message, source

**Handoff**:
The step where the Bridge sends a Task to the Routine.
_Avoid_: dispatch, forward, submission

**Routine**:
The Grok Bot routine with a webhook trigger that receives each Handoff.
_Avoid_: webhook, workflow, automation

**Answer**:
A message that Grok Bot posts in Discord for a Task.
_Avoid_: reply, response, result

**Conversation**:
The messages that follow a Task from a person: the replies to it, and the replies to those replies. All Tasks between bots in a Conversation count toward one limit.
_Avoid_: thread, chain, session

**Bot step**:
A Task that a bot of this application gives to a different bot of this application in a Conversation, with a mention or a reply.
_Avoid_: hop, loop, round

**Discord tools**:
The actions that the Bridge gives to Grok Bot: read messages, send messages, answer a Task, and add reactions.
_Avoid_: commands, functions, capabilities
