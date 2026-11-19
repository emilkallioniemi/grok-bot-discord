# The bots of the Bridge talk to each other as persons do, with a limit for each Conversation

Before, the Bridge ignored all messages from bots, to prevent loops between bots. With more than one Grok Bot, a team of bots must work together in Discord, as persons do. Now a bot of this Bridge can give a Task to a different bot of this Bridge: it mentions the bot, or it replies to a message of the bot. Messages from other bots stay ignored.

The Bridge does not decide when a conversation between bots is complete. Each Grok Bot decides: it can answer, ask for more information, add a reaction, or do nothing. A reaction gives no Task. Thus, a Grok Bot can end a conversation with a reaction, for example 👍. To decide well, each Task contains the Conversation before the task message: the chain of replies, a maximum of 10 messages. Grok Bot can read more with `read_messages`.

A reply to a message that gave a Task continues that Conversation. Each other message from a bot starts a new Conversation, for example a message that a Grok Bot posts from a routine on a schedule. The Bridge counts all Tasks between bots in a Conversation, also when bots reply to earlier messages. After `MAX_BOT_STEPS` Tasks (10 if you do not set it), the bot refuses with a message, and a person must give the next Task. With new Conversations, bots could avoid this limit. Thus, all bots together can start a maximum of `MAX_BOT_CONVERSATIONS_PER_HOUR` Conversations in one hour (10 if you do not set it). The Bridge keeps the counts in SQLite. Thus, the counts stay correct after a restart.

## Considered options

- **Ignore all bots.** This is safe, but the bots cannot work together.
- **Bots must write the mention in the text.** We built this first. Then a bot did not receive the Answer to its own question, and could not say thank you. Persons also continue a conversation with replies.
- **A fixed order: question, answer, thank you, end.** This is predictable, but a bot cannot ask one more question after a thank you, as a person can.
- **Only replies give Tasks between bots.** Then a Grok Bot cannot start a conversation with a different bot, for example from a routine on a schedule, or from a Task that a person gave in a direct message.
- **Link a message to a Task with a `task_id` setting of `send_message`.** Discord can deliver the message to the other bot before the Bridge knows the ID of the message. Then the link is lost.
- **Count the steps for each chain of replies.** A bot can start the count again with a reply to an earlier message. The count for each Conversation prevents this.
- **Let Grok Bot read the conversation itself.** Grok Bot does not always do it, and the last messages of a channel can contain other conversations. The reply chain is the correct conversation.

## Consequences

- Each Task between bots uses a routine run of your Grok Bot plan. A Grok Bot that answers each thank you uses more runs.
- `mention` can only ping bots of this Bridge, never persons or roles.
