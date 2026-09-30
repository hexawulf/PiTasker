// Runs a task once (scheduled by PiTasker or "Run now") and records the run.
//   task_runs row (running) ─► execCommand ─► row finished (exit code, duration, stdout, stderr)
//                                           └► tasks.status / last_run / output (latest summary)
import type { Task, TaskRun } from "@shared/schema";
import { config } from "../config";
import { storage } from "../storage";
import { readCrontab } from "../crontab/store";
import { crontabEnvVars, execCommand, type ExecResult } from "./exec";
import { NotificationService } from "./notificationService";

export class AlreadyRunningError extends Error {
  status = 409;
  constructor() {
    super("Task is already running");
  }
}

/** Short text for tasks.output: both streams, labelled, capped. */
export function summarizeOutput(r: Pick<ExecResult, "stdout" | "stderr" | "status" | "exitCode" | "signal">, cap = 10_000): string {
  const parts: string[] = [];
  if (r.stdout) parts.push(r.stdout.trimEnd());
  if (r.stderr) parts.push(`[stderr]\n${r.stderr.trimEnd()}`);
  if (r.status === "timeout") parts.push("[timed out: process group killed]");
  else if (r.exitCode !== 0) parts.push(`[exit ${r.exitCode ?? "?"}${r.signal ? `, ${r.signal}` : ""}]`);
  const s = parts.join("\n");
  return s.length > cap ? s.slice(s.length - cap) : s;
}

export class TaskRunner {
  private running = new Set<number>();
  private notifications = new NotificationService();

  isRunning(taskId: number): boolean {
    return this.running.has(taskId);
  }

  runningCount(): number {
    return this.running.size;
  }

  /**
   * Start a run. Resolves with the run row as soon as it is recorded;
   * `finished` resolves when the command is done.
   */
  async start(task: Task, trigger: "schedule" | "manual"): Promise<{ run: TaskRun; finished: Promise<TaskRun | undefined> }> {
    if (this.running.has(task.id)) throw new AlreadyRunningError();
    this.running.add(task.id);
    let run: TaskRun;
    try {
      run = await storage.createRun(task.id, trigger);
      await storage.updateTask(task.id, { status: "running", lastRun: run.startedAt });
    } catch (e) {
      this.running.delete(task.id);
      throw e;
    }
    const finished = this.execute(task, run);
    return { run, finished };
  }

  private async execute(task: Task, run: TaskRun): Promise<TaskRun | undefined> {
    try {
      // The crontab's SHELL=/PATH=… lines apply to PiTasker's runs too (a task may move between runners).
      const crontabEnv = await readCrontab().then((c) => crontabEnvVars(c.doc.lines)).catch(() => ({}));
      const r = await execCommand(task.command, { timeoutMs: config.runTimeoutMs, cap: config.outputCap, crontabEnv });
      const row = await storage.finishRun(run.id, {
        status: r.status,
        finishedAt: new Date(),
        durationMs: r.durationMs,
        exitCode: r.exitCode,
        signal: r.signal,
        stdout: r.stdout,
        stderr: r.stderr,
        truncated: r.truncated,
      });
      const status = r.status === "success" ? "success" : "failed";
      await storage.updateTask(task.id, { status, output: summarizeOutput(r) });
      await storage.pruneRuns(task.id);
      await this.notifications.sendTaskNotification(task, status, summarizeOutput(r, 200));
      return row;
    } catch (e) {
      console.error(`[runner] task ${task.id} run ${run.id} could not be recorded:`, e);
      await storage.finishRun(run.id, { status: "failed", finishedAt: new Date(), stderr: String(e) }).catch(() => undefined);
      await storage.updateTask(task.id, { status: "failed" }).catch(() => undefined);
      return undefined;
    } finally {
      this.running.delete(task.id);
    }
  }
}

export const taskRunner = new TaskRunner();
