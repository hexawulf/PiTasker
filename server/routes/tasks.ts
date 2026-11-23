// Task routes. Where a change touches the crontab, the order is chosen so a
// task is never run by both cron and PiTasker, and a failed crontab write
// leaves the database as it was:
//
//   create (cron)      crontab write ─► DB insert (compensate: remove the line if the insert fails)
//   create (pitasker)  refuse if an active crontab line has the same command ─► DB insert ─► schedule
//   edit   (cron)      crontab write ─► DB update
//   delete (cron)      crontab remove ─► DB delete
//   move → pitasker    crontab remove ─► DB update ─► schedule
//   move → cron        unschedule ─► crontab write (fail: re-schedule) ─► DB update
//
// Every crontab-touching route takes ?dryRun=1 (returns { before, after, hash }
// for the diff dialog, nothing written) and ?expectedHash= (refused with 409
// if the crontab changed since the dry run).
import express, { type Request, type Response } from "express";
import { taskInputSchema, taskPatchSchema, type Task, type TaskView } from "@shared/schema";
import { cachedCrontab, invalidateCrontabCache } from "../crontab/cache";
import { DisabledLineError, listJobs } from "../crontab/document";
import { readCrontab, type MutateResult } from "../crontab/store";
import { applyTask, cronStates, jobForTask, newCrontabId, removeTask } from "../crontab/sync";
import { isAuthenticated } from "../middleware/authMiddleware";
import { cronSeenFor } from "../services/cronSeen";
import { checkCommand } from "../services/scriptCheck";
import { AlreadyRunningError, taskRunner } from "../services/taskRunner";
import { taskScheduler } from "../services/taskScheduler";
import { storage } from "../storage";
import { httpError } from "../errors";
import { wrapWith, writeOpts } from "./http";

const router = express.Router();
router.use("/api/tasks", isAuthenticated);
router.use("/api/runs", isAuthenticated);

/** Crontab/runner errors carry their status; a hand-disabled line is a 409. */
const wrap = wrapWith("tasks", (e) => (e instanceof DisabledLineError ? 409 : undefined));

const preview = (r: MutateResult) => ({ dryRun: true, changed: r.changed, before: r.before, after: r.after, hash: r.beforeHash });

function idParam(req: Request, res: Response): number | null {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ message: "Invalid task ID" });
    return null;
  }
  return id;
}

/** Update a task that may have been deleted meanwhile (another tab, a concurrent request): 404, not a crash. */
async function updateOr404(id: number, patch: Parameters<typeof storage.updateTask>[1]): Promise<Task> {
  const updated = await storage.updateTask(id, patch);
  if (!updated) throw httpError(404, "Task not found");
  return updated;
}

async function buildTaskViews(tasks: Task[]): Promise<TaskView[]> {
  const [cron, latest, seen] = await Promise.all([cachedCrontab(), storage.latestRuns(), cronSeenFor(tasks)]);
  const states = cron ? cronStates(cron.doc, tasks) : new Map();
  return tasks.map((t) => {
    const run = latest.get(t.id);
    return {
      ...t,
      runner: t.isSystemManaged === false ? "pitasker" : "cron",
      cronState: states.get(t.id) ?? null,
      lastRunInfo: run
        ? { id: run.id, status: run.status, startedAt: run.startedAt, finishedAt: run.finishedAt, durationMs: run.durationMs, exitCode: run.exitCode, trigger: run.trigger }
        : null,
      cronSeen: seen.get(t.id) ?? null,
    };
  });
}

router.get(
  "/api/tasks",
  wrap(async (_req, res) => {
    res.json(await buildTaskViews(await storage.getAllTasks()));
  }),
);

router.get(
  "/api/tasks/export",
  wrap(async (req, res) => {
    const tasks = await storage.getAllTasks();
    const out = tasks.map((t) => ({
      id: t.id,
      name: t.name,
      schedule: t.cronSchedule,
      command: t.command,
      runner: t.isSystemManaged === false ? "pitasker" : "cron",
      createdAt: t.createdAt,
    }));
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", 'attachment; filename="pitasker-tasks.json"');
    res.send(req.query.pretty === "true" ? JSON.stringify(out, null, 2) : JSON.stringify(out));
  }),
);

router.get(
  "/api/tasks/:id",
  wrap(async (req, res) => {
    const id = idParam(req, res);
    if (id === null) return;
    const task = await storage.getTask(id);
    if (!task) return res.status(404).json({ message: "Task not found" });
    res.json((await buildTaskViews([task]))[0]);
  }),
);

router.get(
  "/api/tasks/:id/runs",
  wrap(async (req, res) => {
    const id = idParam(req, res);
    if (id === null) return;
    res.json(await storage.listRuns(id));
  }),
);

router.get(
  "/api/runs/:id",
  wrap(async (req, res) => {
    const id = idParam(req, res);
    if (id === null) return;
    const run = await storage.getRun(id);
    if (!run) return res.status(404).json({ message: "Run not found" });
    res.json(run);
  }),
);

/** A PiTasker-run task must not share its command with an active crontab line (it would run twice). */
async function assertNotInCrontab(command: string) {
  const { doc } = await readCrontab();
  const clash = listJobs(doc).find((j) => !j.disabled && j.command.trim() === command.trim());
  if (clash) {
    throw httpError(409, `The crontab already runs this command ("${clash.schedule} ${clash.command}"): with PiTasker as runner it would run twice. Use the crontab as runner or remove the line.`);
  }
}

router.post(
  "/api/tasks",
  wrap(async (req, res) => {
    const v = taskInputSchema.safeParse(req.body);
    if (!v.success) return res.status(400).json({ message: "Validation failed", errors: v.error.issues });
    const input = v.data;
    const opts = writeOpts(req);

    if (!input.isSystemManaged) {
      await assertNotInCrontab(input.command);
      if (opts.dryRun) return res.json({ dryRun: true, changed: false });
      const task = await storage.createTask({ ...input, isSystemManaged: false, source: "pitasker", syncedToCrontab: false });
      taskScheduler.sync(task);
      return res.status(201).json((await buildTaskViews([task]))[0]);
    }

    const draft = { ...input, crontabId: newCrontabId() } as Task;
    const r = await applyTask(draft, opts);
    if (opts.dryRun) return res.json(preview(r));
    invalidateCrontabCache();
    let task: Task;
    try {
      task = await storage.createTask({
        ...input,
        isSystemManaged: true,
        source: "pitasker",
        crontabId: r.crontabId,
        syncedToCrontab: true,
        crontabSyncedAt: new Date(),
      });
    } catch (e) {
      await removeTask({ crontabId: r.crontabId, command: input.command }).catch(() => undefined);
      throw e;
    }
    taskScheduler.sync(task);
    res.status(201).json((await buildTaskViews([task]))[0]);
  }),
);

router.patch(
  "/api/tasks/:id",
  wrap(async (req, res) => {
    const id = idParam(req, res);
    if (id === null) return;
    const v = taskPatchSchema.safeParse(req.body);
    if (!v.success) return res.status(400).json({ message: "Validation failed", errors: v.error.issues });
    const existing = await storage.getTask(id);
    if (!existing) return res.status(404).json({ message: "Task not found" });
    const next = { ...existing, ...v.data } as Task;
    const opts = writeOpts(req);

    if (existing.isSystemManaged === false) {
      if (next.cronSchedule.trim().toLowerCase() === "@reboot") return res.status(400).json({ message: "@reboot needs the crontab as runner" });
      if (v.data.command !== undefined && v.data.command !== existing.command) await assertNotInCrontab(next.command);
      if (opts.dryRun) return res.json({ dryRun: true, changed: false });
      const updated = await updateOr404(id, v.data);
      taskScheduler.sync(updated);
      return res.json((await buildTaskViews([updated]))[0]);
    }

    if (!next.crontabId) {
      const { doc } = await readCrontab();
      next.crontabId = jobForTask(doc, existing)?.id ?? newCrontabId();
    }
    const r = await applyTask(next, opts, existing);
    if (opts.dryRun) return res.json(preview(r));
    invalidateCrontabCache();
    const updated = await updateOr404(id, { ...v.data, crontabId: r.crontabId, syncedToCrontab: true, crontabSyncedAt: new Date() });
    taskScheduler.sync(updated);
    res.json((await buildTaskViews([updated]))[0]);
  }),
);

router.delete(
  "/api/tasks/:id",
  wrap(async (req, res) => {
    const id = idParam(req, res);
    if (id === null) return;
    const task = await storage.getTask(id);
    if (!task) return res.status(404).json({ message: "Task not found" });
    const opts = writeOpts(req);
    // ?keepLine=1: forget the task but leave its crontab line running.
    const keepLine = req.query.keepLine === "1";
    if (task.isSystemManaged !== false && !keepLine) {
      const r = await removeTask(task, opts);
      if (opts.dryRun) return res.json(preview(r));
      invalidateCrontabCache();
    } else if (opts.dryRun) {
      return res.json({ dryRun: true, changed: false });
    }
    taskScheduler.unschedule(id);
    await storage.deleteTask(id);
    res.status(204).send();
  }),
);

router.post(
  "/api/tasks/:id/run",
  wrap(async (req, res) => {
    const id = idParam(req, res);
    if (id === null) return;
    const task = await storage.getTask(id);
    if (!task) return res.status(404).json({ message: "Task not found" });
    try {
      const { run } = await taskRunner.start(task, "manual");
      res.status(202).json({ message: "Task execution started", runId: run.id });
    } catch (e) {
      if (e instanceof AlreadyRunningError) return res.status(409).json({ message: e.message });
      throw e;
    }
  }),
);

async function moveRunner(req: Request, res: Response, task: Task, to: "cron" | "pitasker") {
  const id = task.id;
  const opts = writeOpts(req);
  const current = task.isSystemManaged === false ? "pitasker" : "cron";
  if (current === to) return res.json(opts.dryRun ? { dryRun: true, changed: false } : (await buildTaskViews([task]))[0]);

  if (to === "pitasker") {
    if (task.cronSchedule.trim().toLowerCase() === "@reboot") return res.status(400).json({ message: "@reboot needs the crontab as runner" });
    const r = await removeTask(task, opts);
    if (opts.dryRun) return res.json(preview(r));
    invalidateCrontabCache();
    const updated = await updateOr404(id, { isSystemManaged: false, crontabId: null, syncedToCrontab: false, crontabSyncedAt: null });
    taskScheduler.sync(updated);
    return res.json((await buildTaskViews([updated]))[0]);
  }

  // → cron: stop PiTasker's schedule first; if the crontab write fails, put it back.
  const target = { ...task, isSystemManaged: true, crontabId: task.crontabId ?? newCrontabId() } as Task;
  if (!opts.dryRun) taskScheduler.unschedule(id);
  let r;
  try {
    r = await applyTask(target, opts);
  } catch (e) {
    if (!opts.dryRun) taskScheduler.sync(task);
    throw e;
  }
  if (opts.dryRun) return res.json(preview(r));
  invalidateCrontabCache();
  const updated = await updateOr404(id, { isSystemManaged: true, crontabId: r.crontabId, syncedToCrontab: true, crontabSyncedAt: new Date() });
  taskScheduler.sync(updated);
  return res.json((await buildTaskViews([updated]))[0]);
}

router.post(
  "/api/tasks/:id/runner",
  wrap(async (req, res) => {
    const id = idParam(req, res);
    if (id === null) return;
    const to = req.body?.runner;
    if (to !== "cron" && to !== "pitasker") return res.status(400).json({ message: 'runner must be "cron" or "pitasker"' });
    const task = await storage.getTask(id);
    if (!task) return res.status(404).json({ message: "Task not found" });
    await moveRunner(req, res, task, to);
  }),
);

// 1.x route: flips the runner.
router.post(
  "/api/tasks/:id/toggle-system-managed",
  wrap(async (req, res) => {
    const id = idParam(req, res);
    if (id === null) return;
    const task = await storage.getTask(id);
    if (!task) return res.status(404).json({ message: "Task not found" });
    await moveRunner(req, res, task, task.isSystemManaged === false ? "cron" : "pitasker");
  }),
);

// JSON import (the file GET /api/tasks/export writes): PiTasker-run tasks.
// Skips jobs whose command an existing task or an active crontab line already has.
router.post(
  "/api/import-cronjobs",
  isAuthenticated,
  wrap(async (req, res) => {
    if (!Array.isArray(req.body) || req.body.length > 500) return res.status(400).json({ message: "Invalid payload" });
    const existing = await storage.getAllTasks();
    const { doc } = await readCrontab();
    const inCrontab = new Set(listJobs(doc).filter((j) => !j.disabled).map((j) => j.command.trim()));
    const known = new Set(existing.map((t) => t.command.trim()));
    let imported = 0;
    let failed = 0;
    const skipped: string[] = [];
    for (const job of req.body as { name?: unknown; schedule?: unknown; command?: unknown }[]) {
      const v = taskInputSchema.safeParse({ name: job?.name, cronSchedule: job?.schedule, command: job?.command, isSystemManaged: false });
      if (!v.success) {
        failed++;
        continue;
      }
      const cmd = v.data.command.trim();
      if (known.has(cmd) || inCrontab.has(cmd)) {
        skipped.push(v.data.name);
        continue;
      }
      const task = await storage.createTask({ ...v.data, isSystemManaged: false, source: "imported" });
      known.add(cmd);
      taskScheduler.sync(task);
      imported++;
    }
    res.json({ imported, failed, skipped });
  }),
);

router.get(
  "/api/scripts/check",
  isAuthenticated,
  wrap(async (req, res) => {
    const command = typeof req.query.command === "string" ? req.query.command : "";
    if (!command.trim() || command.length > 1000) return res.status(400).json({ message: "command is required" });
    res.json(await checkCommand(command));
  }),
);

export default router;
