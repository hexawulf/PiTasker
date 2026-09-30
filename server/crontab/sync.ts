// Tasks ⇄ the user's crontab.
//
//   import  crontab → DB only. Never writes the crontab (so an unchanged
//           crontab stays byte-identical). Active lines become crontab-run
//           tasks; disabled lines are listed, not imported; a line whose
//           command a PiTasker-run task also has is reported as a conflict
//           (it would run twice) and left alone.
//   export  crontab-run tasks → crontab, as ONE write (one backup). A task
//           whose line already says the same is left byte-for-byte alone.
//   task ops (create/edit/delete/move runner) go through applyTask/removeTask.
//
// Ids: a line's id is its PITASKER_ID marker, else derivedId(command) (the
// id 1.x gave unmarked lines, see cd77a22). Import links a task by id, then by
// exact command. Markers are only written when PiTasker changes or adds a line.
import { randomUUID } from "crypto";
import path from "path";
import type { Task } from "@shared/schema";
import { storage } from "../storage";
import {
  DisabledLineError,
  findJob,
  listJobs,
  removeJob,
  upsertJob,
  type CrontabDoc,
  type Job,
  type JobSpec,
} from "./document";
import { mutateCrontab, readCrontab, type MutateOptions, type MutateResult } from "./store";

export const newCrontabId = () => randomUUID();

export function specFor(task: Pick<Task, "crontabId" | "cronSchedule" | "command" | "name">, id?: string): JobSpec {
  return { id: id ?? task.crontabId ?? newCrontabId(), schedule: task.cronSchedule, command: task.command, name: task.name };
}

/** The line in the crontab for a task: by its crontab id, else an unmarked line with the same command. */
export function jobForTask(doc: CrontabDoc, task: Pick<Task, "crontabId" | "command">): Job | undefined {
  return findJob(doc, task.crontabId, task.command);
}

/** A name for an imported line: its PiTasker name, else the script's file name. */
export function nameForJob(job: Job): string {
  if (job.name) return job.name.slice(0, 100);
  const first = job.command.trim().split(/\s+/)[0] ?? "job";
  const base = path.basename(first).replace(/[^\w.@-]+/g, "") || "job";
  return `${base}${job.schedule === "@reboot" ? " (boot)" : ""}`.slice(0, 100);
}

/** Put (or keep) the task's line in the crontab. `previous` = the task before an edit, to find its old line. */
export function applyTask(task: Task, opts: MutateOptions = {}, previous?: Task): Promise<MutateResult & { crontabId: string }> {
  const id = task.crontabId ?? newCrontabId();
  return mutateCrontab((doc) => upsertJob(doc, specFor(task, id), (previous ?? task).command), opts).then((r) => ({ ...r, crontabId: id }));
}

/** Remove the task's active line (a line disabled by hand is left in place). */
export function removeTask(task: Pick<Task, "crontabId" | "command">, opts: MutateOptions = {}): Promise<MutateResult> {
  return mutateCrontab((doc) => {
    const job = jobForTask(doc, task);
    if (!job || job.disabled) return doc;
    return removeJob(doc, job.id);
  }, opts);
}

export type ImportItem = { id: string; schedule: string; command: string; name: string; action: "import" | "update" | "unchanged" | "conflict" | "disabled"; taskId?: number; reason?: string };
export type ImportResult = { imported: number; updated: number; skipped: number; missing: number[]; items: ImportItem[]; errors: string[] };

/** Which task (if any) a crontab line belongs to. */
function matchTask(job: Job, tasks: Task[]): Task | undefined {
  return tasks.find((t) => t.crontabId === job.id) ?? tasks.find((t) => t.command.trim() === job.command.trim() && (!t.crontabId || t.crontabId === job.id));
}

/** crontab → database (never writes the crontab). `ids` limits the import to those lines. */
export async function importFromCrontab(opts: { ids?: string[]; dryRun?: boolean } = {}): Promise<ImportResult> {
  const { doc } = await readCrontab();
  const tasks = await storage.getAllTasks();
  const result: ImportResult = { imported: 0, updated: 0, skipped: 0, missing: [], items: [], errors: [] };
  const wanted = opts.ids && opts.ids.length ? new Set(opts.ids) : null;
  const seenTaskIds = new Set<number>();

  for (const job of listJobs(doc)) {
    const task = matchTask(job, tasks);
    if (task) seenTaskIds.add(task.id);
    const item: ImportItem = { id: job.id, schedule: job.schedule, command: job.command, name: task?.name ?? nameForJob(job), action: "unchanged", taskId: task?.id };
    if (job.disabled) {
      item.action = "disabled";
      item.reason = "commented out in the crontab";
    } else if (task && task.isSystemManaged === false) {
      item.action = "conflict";
      item.reason = "PiTasker also runs this command: it would run twice. Move the task to the crontab or remove the line.";
    } else if (task) {
      const changed = task.cronSchedule !== job.schedule || task.command !== job.command || task.crontabId !== job.id || !task.syncedToCrontab;
      item.action = changed ? "update" : "unchanged";
    } else {
      item.action = "import";
    }
    result.items.push(item);
    if (wanted && !wanted.has(job.id)) continue;
    if (opts.dryRun) continue;

    try {
      if (item.action === "import") {
        await storage.createTask({
          name: item.name,
          cronSchedule: job.schedule,
          command: job.command,
          crontabId: job.id,
          syncedToCrontab: true,
          crontabSyncedAt: new Date(),
          source: job.managed ? "pitasker" : "crontab",
          isSystemManaged: true,
        });
        result.imported++;
      } else if (item.action === "update" && task) {
        await storage.updateTask(task.id, {
          cronSchedule: job.schedule,
          command: job.command,
          crontabId: job.id,
          syncedToCrontab: true,
          crontabSyncedAt: new Date(),
        });
        result.updated++;
      } else {
        result.skipped++;
      }
    } catch (e) {
      result.errors.push(`${job.schedule} ${job.command}: ${(e as Error).message}`);
    }
  }

  // Crontab-run tasks whose line is gone: flag them (not deleted: the operator decides).
  for (const t of tasks) {
    if (t.isSystemManaged !== false && !seenTaskIds.has(t.id)) {
      result.missing.push(t.id);
      if (!opts.dryRun && t.syncedToCrontab) await storage.updateTask(t.id, { syncedToCrontab: false });
    }
  }
  return result;
}

export type ExportResult = MutateResult & { exported: number; unchanged: number; skipped: { taskId: number; reason: string }[] };

/** Crontab-run tasks → crontab in one write. Only lines that differ are touched. */
export async function exportToCrontab(opts: MutateOptions & { taskIds?: number[] } = {}): Promise<ExportResult> {
  const all = await storage.getAllTasks();
  const chosen = (opts.taskIds?.length ? all.filter((t) => opts.taskIds!.includes(t.id)) : all).filter((t) => t.isSystemManaged !== false);
  const skipped: ExportResult["skipped"] = [];
  const ids = new Map<number, string>();
  let exported = 0;
  let unchanged = 0;

  const r = await mutateCrontab((doc) => {
    let cur = doc;
    for (const t of chosen) {
      const id = t.crontabId ?? jobForTask(cur, t)?.id ?? newCrontabId();
      try {
        const next = upsertJob(cur, specFor(t, id), t.command);
        if (next === cur) unchanged++;
        else exported++;
        cur = next;
        ids.set(t.id, id);
      } catch (e) {
        if (e instanceof DisabledLineError) skipped.push({ taskId: t.id, reason: "line is disabled in the crontab" });
        else throw e;
      }
    }
    return cur;
  }, opts);

  if (!opts.dryRun) {
    for (const [taskId, crontabId] of ids) {
      await storage.updateTask(taskId, { crontabId, syncedToCrontab: true, crontabSyncedAt: new Date() });
    }
  }
  return { ...r, exported, unchanged, skipped };
}

export type CronState = "active" | "disabled" | "missing";

/** Where each crontab-run task stands in `doc`. */
export function cronStates(doc: CrontabDoc, tasks: Task[]): Map<number, CronState> {
  const out = new Map<number, CronState>();
  for (const t of tasks) {
    if (t.isSystemManaged === false) continue;
    const job = jobForTask(doc, t);
    out.set(t.id, !job ? "missing" : job.disabled ? "disabled" : "active");
  }
  return out;
}

/** Active crontab lines that a PiTasker-run task also runs (would run twice). */
export function doubleRuns(doc: CrontabDoc, tasks: Task[]): { taskId: number; line: string }[] {
  const active = listJobs(doc).filter((j) => !j.disabled);
  const out: { taskId: number; line: string }[] = [];
  for (const t of tasks) {
    if (t.isSystemManaged !== false) continue;
    const j = active.find((x) => x.command.trim() === t.command.trim());
    if (j) out.push({ taskId: t.id, line: `${j.schedule} ${j.command}` });
  }
  return out;
}
