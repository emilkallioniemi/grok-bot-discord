import { Database } from "bun:sqlite";
import type { TaskStore } from "../application/ports";
import type { Task } from "../domain/task";

/** Keeps the Tasks in SQLite. Thus, Grok Bot can answer a Task after the Bridge starts again. */
export function openTaskStore(path: string): TaskStore {
  const db = new Database(path, { create: true, strict: true });
  db.run(`CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, data TEXT NOT NULL)`);
  const insert = db.prepare(`INSERT OR REPLACE INTO tasks (id, data) VALUES ($id, $data)`);
  const select = db.prepare<{ data: string }, { id: string }>(`SELECT data FROM tasks WHERE id = $id`);

  return {
    save(task) {
      insert.run({ id: task.id, data: JSON.stringify(task) });
    },
    find(id) {
      const row = select.get({ id });
      if (!row) return undefined;
      const task = JSON.parse(row.data) as Task;
      return { ...task, createdAt: new Date(task.createdAt) };
    },
  };
}
