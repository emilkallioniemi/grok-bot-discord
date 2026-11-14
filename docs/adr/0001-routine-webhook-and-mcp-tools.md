# Connect to Grok Bot with a routine webhook and an MCP server

Grok Bot has no API to send it a message and receive its answer, and it has no Discord integration. The Bridge sends each Task to a Grok Bot routine through the routine webhook trigger. Grok Bot sends Answers back through Discord tools on an MCP server that the Bridge operates, which the user adds to Grok Bot as a custom connector.

## Considered Options

- **Grok Bot uses Discord in its own browser.** Rejected: Discord does not permit the automation of user accounts, and changes to the web interface can stop it.
- **A relay through a Slack Team Bot.** Rejected: it must have a Slack workspace and a Team plan only to move messages.
