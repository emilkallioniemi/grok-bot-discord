import { Database } from "bun:sqlite";
import type { TaskStore } from "../application/ports";
import type { Task } from "../domain/task";

/** The name of the Bridge when the configuration comes from .env. Tasks from before version 0.3 belong to it. */
export const DEFAULT_BRIDGE = "default";

/**
 * Keeps the Tasks of one Bridge in SQLite. Thus, Grok Bot can answer a Task after the Bridge starts again.
 * More than one Bridge can use the same file. Each Bridge sees only its own Tasks.
 */
export function openTaskStore(path: string, bridgeName = DEFAULT_BRIDGE): TaskStore {
  const db = new Database(path, { create: true, strict: true });
  db.transaction(() => {
    db.run(
      `CREATE TABLE IF NOT EXISTS bridge_tasks (bridge TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY (bridge, id))`,
    );
    // Version 0.2 kept the Tasks in the table "tasks", without the name of the Bridge.
    const old = db.query(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'tasks'`).get();
    if (old) {
      db.prepare(`INSERT OR IGNORE INTO bridge_tasks (bridge, id, data) SELECT $bridge, id, data FROM tasks`).run({
        bridge: DEFAULT_BRIDGE,
      });
      db.run(`DROP TABLE tasks`);
    }
  })();
  const insert = db.prepare(`INSERT OR REPLACE INTO bridge_tasks (bridge, id, data) VALUES ($bridge, $id, $data)`);
  const select = db.prepare<{ data: string }, { bridge: string; id: string }>(
    `SELECT data FROM bridge_tasks WHERE bridge = $bridge AND id = $id`,
  );
  const countBots = db.prepare<{ count: number }, { bridge: string; conversationId: string }>(
    `SELECT COUNT(*) AS count FROM bridge_tasks WHERE bridge = $bridge AND json_extract(data, '$.conversationId') = $conversationId AND json_extract(data, '$.botSteps') > 0`,
  );
  const countStarted = db.prepare<{ count: number }, { bridge: string; since: string }>(
    `SELECT COUNT(*) AS count FROM bridge_tasks WHERE bridge = $bridge AND json_extract(data, '$.requester.isBot') = 1 AND json_extract(data, '$.conversationId') = id AND json_extract(data, '$.createdAt') >= $since`,
  );
  const selectByOrigin = db.prepare<{ data: string }, { bridge: string; messageId: string }>(
    `SELECT data FROM bridge_tasks WHERE bridge = $bridge AND json_extract(data, '$.origin.messageId') = $messageId`,
  );

  return {
    save(task) {
      insert.run({ bridge: bridgeName, id: task.id, data: JSON.stringify(task) });
    },
    find(id) {
      const row = select.get({ bridge: bridgeName, id });
      return row ? fromJson(row.data) : undefined;
    },
    findByOrigin(messageId) {
      return selectByOrigin.all({ bridge: bridgeName, messageId }).map((row) => fromJson(row.data));
    },
    countBotTasks(conversationId) {
      return countBots.get({ bridge: bridgeName, conversationId })?.count ?? 0;
    },
    countBotConversationsSince(since) {
      return countStarted.get({ bridge: bridgeName, since: since.toISOString() })?.count ?? 0;
    },
  };
}

function fromJson(data: string): Task {
  const task = JSON.parse(data) as Task;
  // Tasks from before version 0.4 have no botSteps and no conversationId. A person gave them.
  return { ...task, createdAt: new Date(task.createdAt), botSteps: task.botSteps ?? 0, conversationId: task.conversationId ?? task.id };
}
