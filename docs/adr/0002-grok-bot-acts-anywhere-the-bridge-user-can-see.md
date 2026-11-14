# Grok Bot can act in all channels that the Bridge user can see

The Discord tools do not limit Grok Bot to the channel of a Task. Grok Bot can read and send messages in each channel that the Bridge user can see, also without a Task, so routines can post on a schedule. The Discord role permissions of the Bridge user are the only limit. Thus, server owners control the reach of Grok Bot in Discord, not the Bridge.

## Consequences

If text that Grok Bot reads tells it to do something bad, it can post in each channel that the Bridge user can see. Give the Bridge user access only to the channels where Grok Bot must work.
