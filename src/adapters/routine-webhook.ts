import type { Routine } from "../application/ports";
import type { Task } from "../domain/task";

export interface RoutineWebhookOptions {
  /** The "POST to" URL of the webhook trigger of the routine. */
  url: string;
  /** The "key" of the webhook trigger. */
  key: string;
  fetch?: typeof fetch;
}

/** Sends each Task to a Grok Bot routine through its webhook trigger. */
export function createRoutineWebhook(options: RoutineWebhookOptions): Routine {
  const send = options.fetch ?? fetch;
  return {
    async handOff(task: Task) {
      const response = await send(options.url, {
        method: "POST",
        headers: { Authorization: `Bearer ${options.key}`, "Content-Type": "application/json" },
        body: JSON.stringify(toPayload(task)),
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) {
        throw new Error(`Grok Bot did not accept the Handoff (HTTP ${response.status}).`);
      }
    },
  };
}

/** The body that Grok Bot receives with the routine instruction. */
function toPayload(task: Task) {
  return {
    task_id: task.id,
    text: task.text,
    requester: task.requester,
    channel: { id: task.origin.channelId, name: task.origin.channelName },
    guild_id: task.origin.guildId,
    message_id: task.origin.messageId,
    created_at: task.createdAt.toISOString(),
    how_to_answer: `Use the answer_task tool of the Discord connector with task_id "${task.id}". The Requester sees the Answer as a reply to their message.`,
  };
}
