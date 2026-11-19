# A router sends messages without a mention to the correct bots

A person must not have to know which bot to mention. For example, "We change the brand color from red to blue" concerns the design bot, and maybe the product bot. In the channels that you select, a router reads each message from a person that mentions no bot. It decides which bots the message concerns, from the Role of each bot. Each of these bots receives the message as a routed Task. The Grok Bot of the bot then decides if it acts. The Bridge adds no 👀 to a routed message: a Grok Bot that acts adds it.

The router is the OpenAI Decisions API with the model `gpt-6-luna`. It asks one yes/no question for each bot, because one choice question gives only one answer, and a message can concern more than one bot. A bot receives the message when the probability is `ROUTER_THRESHOLD` or more (0.6 if you do not set it). The router is a port. Thus, a different router can replace it.

## Considered options

- **Each bot receives each message, and its Grok Bot decides.** Each message uses one routine run for each bot, also when the message concerns nobody. A busy channel can use the limit of 300 routine runs in one hour.
- **Persons mention a Discord role, for example @team.** This is cheap, but persons must remember to do it.
- **A small model through the xAI API.** Then the messages go only to one company. The Decisions API is made for this type of decision, and costs little.

## Consequences

- The router sends the text, the author name, and the channel name of each message in the router channels to OpenAI. This is a second company, in addition to xAI.
- The router can be wrong. It can send a message to a bot that it does not concern, or not send it to a bot that it concerns. A mention always goes to the bot.
- Each routed message costs one Decisions API request, and one routine run for each selected bot.
- Messages from bots, direct messages, and messages that mention a bot of this Bridge do not go to the router.
