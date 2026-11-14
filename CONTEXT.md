# Discord bridge for Grok Bot

This project connects a Discord server to Grok Bot. Discord members give work to Grok Bot, and Grok Bot reads and writes in Discord.

## Language

**Grok Bot**:
The xAI product that does work for a team. It has its own computer and uses the tools that you connect to it.
_Avoid_: Grok, the model, the AI

**Bridge**:
This application. It sends work from Discord to Grok Bot and gives Grok Bot tools to use Discord.
_Avoid_: Discord bot, relay, proxy

**Bridge user**:
The Discord bot account that the Bridge uses in the server.
_Avoid_: bot user, client

**Task**:
One piece of work that a member gives to Grok Bot when the member mentions the Bridge user or sends it a direct message.
_Avoid_: prompt, request, job, ticket

**Requester**:
The Discord member who gave a Task.
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

**Discord tools**:
The actions that the Bridge gives to Grok Bot: read messages, send messages, answer a Task, and add reactions.
_Avoid_: commands, functions, capabilities
