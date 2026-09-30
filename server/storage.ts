import { and, desc, eq, inArray, lt, sql } from "drizzle-orm";
import {
  RUNS_KEEP,
  taskRuns,
  tasks,
  users,
  type InsertTask,
  type InsertUser,
  type Task,
  type TaskRun,
  type UpdateTask,
  type User,
} from "@shared/schema";
import { db, pool } from "./db";

export type RunSummary = Pick<TaskRun, "id" | "taskId" | "status" | "startedAt" | "finishedAt" | "durationMs" | "exitCode" | "trigger">;

const summaryCols = {
  id: taskRuns.id,
  taskId: taskRuns.taskId,
  status: taskRuns.status,
  startedAt: taskRuns.startedAt,
  finishedAt: taskRuns.finishedAt,
  durationMs: taskRuns.durationMs,
  exitCode: taskRuns.exitCode,
  trigger: taskRuns.trigger,
};

export class DatabaseStorage {
  async getUser(id: number): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db.insert(users).values(insertUser).returning();
    return user;
  }

  async updateUserPassword(id: number, hash: string): Promise<void> {
    await db.update(users).set({ password: hash }).where(eq(users.id, id));
  }

  /** Log a user out everywhere except the given session (after a password change). */
  async dropOtherSessions(userId: number, keepSid: string): Promise<number> {
    const r = await pool.query(
      `DELETE FROM "session" WHERE sid <> $1 AND ((sess->'user'->>'id')::int = $2 OR (sess->>'userId')::int = $2)`,
      [keepSid, userId],
    );
    return r.rowCount ?? 0;
  }

  async getAllTasks(): Promise<Task[]> {
    return db.select().from(tasks).orderBy(tasks.createdAt, tasks.id);
  }

  async getTask(id: number): Promise<Task | undefined> {
    const [task] = await db.select().from(tasks).where(eq(tasks.id, id));
    return task;
  }

  async createTask(task: InsertTask): Promise<Task> {
    const [row] = await db.insert(tasks).values(task).returning();
    return row;
  }

  async updateTask(id: number, patch: UpdateTask): Promise<Task | undefined> {
    const [row] = await db.update(tasks).set(patch).where(eq(tasks.id, id)).returning();
    return row;
  }

  async deleteTask(id: number): Promise<boolean> {
    const result = await db.delete(tasks).where(eq(tasks.id, id));
    return (result.rowCount ?? 0) > 0;
  }

  // ─── Runs ────────────────────────────────────────────────────────────────

  async createRun(taskId: number, trigger: "schedule" | "manual"): Promise<TaskRun> {
    const [row] = await db.insert(taskRuns).values({ taskId, trigger, status: "running" }).returning();
    return row;
  }

  async finishRun(id: number, patch: Partial<TaskRun>): Promise<TaskRun | undefined> {
    const [row] = await db.update(taskRuns).set(patch).where(eq(taskRuns.id, id)).returning();
    return row;
  }

  async listRuns(taskId: number, limit = RUNS_KEEP): Promise<RunSummary[]> {
    return db.select(summaryCols).from(taskRuns).where(eq(taskRuns.taskId, taskId)).orderBy(desc(taskRuns.startedAt), desc(taskRuns.id)).limit(limit);
  }

  async getRun(id: number): Promise<TaskRun | undefined> {
    const [row] = await db.select().from(taskRuns).where(eq(taskRuns.id, id));
    return row;
  }

  /** The newest run of each task. */
  async latestRuns(): Promise<Map<number, RunSummary>> {
    const r = await pool.query(
      `SELECT DISTINCT ON (task_id) id, task_id, status, started_at, finished_at, duration_ms, exit_code, trigger
         FROM task_runs ORDER BY task_id, started_at DESC, id DESC`,
    );
    const out = new Map<number, RunSummary>();
    for (const x of r.rows) {
      out.set(x.task_id, {
        id: x.id,
        taskId: x.task_id,
        status: x.status,
        startedAt: x.started_at,
        finishedAt: x.finished_at,
        durationMs: x.duration_ms,
        exitCode: x.exit_code,
        trigger: x.trigger,
      });
    }
    return out;
  }

  async pruneRuns(taskId: number, keep = RUNS_KEEP): Promise<void> {
    const keepIds = db.select({ id: taskRuns.id }).from(taskRuns).where(eq(taskRuns.taskId, taskId)).orderBy(desc(taskRuns.startedAt), desc(taskRuns.id)).limit(keep);
    await db.delete(taskRuns).where(and(eq(taskRuns.taskId, taskId), sql`${taskRuns.id} NOT IN (${keepIds})`));
  }

  /**
   * At startup nothing can be running: runs left "running" by a restart are
   * marked interrupted, task statuses stuck at "running" are reset
   * (crontab-run tasks → pending; PiTasker-run → failed with a note), and a
   * last_run in the future is cleared.
   */
  async resetStaleState(): Promise<{ runs: number; cronTasks: number; ownTasks: number; futureLastRun: number }> {
    const runs = await db
      .update(taskRuns)
      .set({ status: "interrupted", finishedAt: new Date() })
      .where(eq(taskRuns.status, "running"))
      .returning({ id: taskRuns.id });
    const cronTasks = await db
      .update(tasks)
      .set({ status: "pending" })
      .where(and(eq(tasks.status, "running"), eq(tasks.isSystemManaged, true)))
      .returning({ id: tasks.id });
    const ownTasks = await db
      .update(tasks)
      .set({ status: "failed", output: "Interrupted: PiTasker restarted while this task was running." })
      .where(and(eq(tasks.status, "running"), sql`${tasks.isSystemManaged} IS NOT TRUE`))
      .returning({ id: tasks.id });
    const future = await pool.query(`UPDATE tasks SET last_run = NULL WHERE last_run > now() + interval '1 day' RETURNING id`);
    return { runs: runs.length, cronTasks: cronTasks.length, ownTasks: ownTasks.length, futureLastRun: future.rowCount ?? 0 };
  }

  async tasksByIds(ids: number[]): Promise<Task[]> {
    if (ids.length === 0) return [];
    return db.select().from(tasks).where(inArray(tasks.id, ids));
  }

  async deleteRunsBefore(date: Date): Promise<void> {
    await db.delete(taskRuns).where(lt(taskRuns.startedAt, date));
  }
}

export const storage = new DatabaseStorage();
