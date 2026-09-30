// PiTasker's own scheduler (node-cron). A task has exactly one runner:
//
//   isSystemManaged = true   the user's crontab runs it   → never scheduled here
//   isSystemManaged = false  PiTasker runs it             → scheduled here, in the host's time zone
//
// sync(task) is the only way in: every route that creates, edits, moves or
// deletes a task calls it (or unschedule), so the in-memory schedule always
// follows the database. At fire time the task is re-read and the rule checked
// again, so a task moved to the crontab a moment ago cannot run twice.
import { schedule, type ScheduledTask } from "node-cron";
import { toFiveFields } from "@shared/cron";
import type { Task } from "@shared/schema";
import { config } from "../config";
import { storage } from "../storage";
import { taskRunner, TaskRunner } from "./taskRunner";

export function runsInPiTasker(task: Pick<Task, "isSystemManaged" | "cronSchedule">): boolean {
  return task.isSystemManaged === false && toFiveFields(task.cronSchedule) !== null;
}

type Entry = { job: ScheduledTask; expr: string; tz: string };

export class TaskScheduler {
  private entries = new Map<number, Entry>();

  constructor(
    private runner: TaskRunner = taskRunner,
    private load: (id: number) => Promise<Task | undefined> = (id) => storage.getTask(id),
  ) {}

  /** Make the schedule match the task: scheduled iff PiTasker is its runner. */
  sync(task: Task): void {
    if (!runsInPiTasker(task)) {
      this.unschedule(task.id);
      return;
    }
    const expr = toFiveFields(task.cronSchedule)!;
    const tz = config.timeZone;
    const cur = this.entries.get(task.id);
    if (cur && cur.expr === expr && cur.tz === tz) return;
    this.unschedule(task.id);
    const job = schedule(expr, () => void this.fire(task.id), { timezone: tz, name: `task-${task.id}`, noOverlap: true });
    this.entries.set(task.id, { job, expr, tz });
  }

  async fire(id: number): Promise<void> {
    const task = await this.load(id).catch(() => undefined);
    if (!task || !runsInPiTasker(task)) {
      this.unschedule(id);
      return;
    }
    if (this.runner.isRunning(id)) {
      console.warn(`[scheduler] task ${id} still running; skipped this start`);
      return;
    }
    try {
      await this.runner.start(task, "schedule");
    } catch (e) {
      console.error(`[scheduler] task ${id} did not start:`, e);
    }
  }

  unschedule(id: number): void {
    const cur = this.entries.get(id);
    if (!cur) return;
    cur.job.stop();
    cur.job.destroy();
    this.entries.delete(id);
  }

  syncAll(tasks: Task[]): void {
    const ids = new Set(tasks.map((t) => t.id));
    for (const id of [...this.entries.keys()]) if (!ids.has(id)) this.unschedule(id);
    for (const t of tasks) this.sync(t);
  }

  isScheduled(id: number): boolean {
    return this.entries.has(id);
  }

  scheduledIds(): number[] {
    return [...this.entries.keys()].sort((a, b) => a - b);
  }

  stopAll(): void {
    for (const id of [...this.entries.keys()]) this.unschedule(id);
  }
}

export const taskScheduler = new TaskScheduler();
