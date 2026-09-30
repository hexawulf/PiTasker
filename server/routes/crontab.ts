// The crontab itself: view (every line, as written), import/export, validate,
// backups and restore. Writes take ?dryRun=1 / ?expectedHash= like the task routes.
import express, { type NextFunction, type Request, type Response } from "express";
import { describeCron } from "@shared/cron";
import { listJobs } from "../crontab/document";
import { listBackups, mutateCrontab, readBackup, readCrontab, type MutateOptions } from "../crontab/store";
import { cronStates, doubleRuns, exportToCrontab, importFromCrontab, jobForTask } from "../crontab/sync";
import { isAuthenticated } from "../middleware/authMiddleware";
import { storage } from "../storage";
import { invalidateCrontabCache } from "./tasks";

const router = express.Router();
router.use(isAuthenticated);

const wrap = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) =>
  fn(req, res).catch((e: Error & { status?: number }) => {
    if (e.status && e.status >= 400 && e.status < 600) return res.status(e.status).json({ message: e.message });
    console.error(`[crontab] ${req.method} ${req.path}:`, e);
    res.status(500).json({ message: e.message });
  });

function writeOpts(req: Request): MutateOptions {
  const dry = req.query.dryRun ?? req.body?.dryRun;
  const hash = req.query.expectedHash ?? req.body?.expectedHash;
  return { dryRun: dry === "1" || dry === "true" || dry === true, expectedHash: typeof hash === "string" && hash ? hash : undefined };
}

/** Every line with its kind; job lines carry their id, description and linked task. */
router.get(
  "/",
  wrap(async (_req, res) => {
    const { text, hash, doc } = await readCrontab();
    const tasks = await storage.getAllTasks();
    const jobs = new Map(listJobs(doc).map((j) => [j.index, j]));
    const taskFor = new Map<string, number>();
    for (const t of tasks) {
      if (t.isSystemManaged === false) continue;
      const j = jobForTask(doc, t);
      if (j) taskFor.set(j.id, t.id);
    }
    res.json({
      text,
      hash,
      lines: doc.lines.map((l, i) => {
        const j = jobs.get(i);
        return {
          n: i + 1,
          kind: l.kind,
          raw: l.raw,
          ...(j
            ? { id: j.id, managed: j.managed, schedule: j.schedule, command: j.command, description: describeCron(j.schedule), taskId: taskFor.get(j.id) ?? null }
            : {}),
          ...(l.kind === "env" ? { envName: l.envName } : {}),
        };
      }),
      doubleRuns: doubleRuns(doc, tasks),
    });
  }),
);

router.post(
  "/import",
  wrap(async (req, res) => {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter((x: unknown) => typeof x === "string") : undefined;
    invalidateCrontabCache();
    const r = await importFromCrontab({ ids, dryRun: writeOpts(req).dryRun });
    res.json(r);
  }),
);

router.post(
  "/export",
  wrap(async (req, res) => {
    const opts = writeOpts(req);
    const taskIds = Array.isArray(req.body?.taskIds) ? req.body.taskIds.map(Number).filter(Number.isInteger) : undefined;
    const r = await exportToCrontab({ ...opts, taskIds });
    invalidateCrontabCache();
    res.json({ dryRun: Boolean(opts.dryRun), changed: r.changed, written: r.written, before: r.before, after: r.after, hash: r.beforeHash, exported: r.exported, unchanged: r.unchanged, skipped: r.skipped, backup: r.backup });
  }),
);

router.get(
  "/validate",
  wrap(async (_req, res) => {
    const { doc } = await readCrontab();
    const tasks = await storage.getAllTasks();
    const states = cronStates(doc, tasks);
    const discrepancies: { type: string; taskId?: number; details: string }[] = [];
    for (const t of tasks) {
      const s = states.get(t.id);
      if (s === "missing") discrepancies.push({ type: "missing_in_crontab", taskId: t.id, details: `"${t.name}" runs from the crontab but has no line there` });
      if (s === "disabled") discrepancies.push({ type: "disabled_in_crontab", taskId: t.id, details: `"${t.name}" is commented out in the crontab` });
      if (s === "active") {
        const j = jobForTask(doc, t)!;
        if (j.schedule !== t.cronSchedule) discrepancies.push({ type: "schedule_mismatch", taskId: t.id, details: `DB has "${t.cronSchedule}", crontab has "${j.schedule}"` });
        if (j.command.trim() !== t.command.trim()) discrepancies.push({ type: "command_mismatch", taskId: t.id, details: `DB has "${t.command}", crontab has "${j.command}"` });
      }
    }
    for (const d of doubleRuns(doc, tasks)) discrepancies.push({ type: "runs_twice", taskId: d.taskId, details: `PiTasker and the crontab both run this command: ${d.line}` });
    res.json({ isValid: discrepancies.length === 0, discrepancies });
  }),
);

router.get(
  "/backups",
  wrap(async (_req, res) => {
    res.json(listBackups());
  }),
);

router.get(
  "/backups/:name",
  wrap(async (req, res) => {
    res.json({ name: req.params.name, text: readBackup(req.params.name) });
  }),
);

router.post(
  "/backups/:name/restore",
  wrap(async (req, res) => {
    const text = readBackup(req.params.name);
    const opts = writeOpts(req);
    const r = await mutateCrontab(() => text, opts);
    invalidateCrontabCache();
    res.json({ dryRun: Boolean(opts.dryRun), changed: r.changed, written: r.written, before: r.before, after: r.after, hash: r.beforeHash, backup: r.backup });
  }),
);

router.get(
  "/check-access",
  wrap(async (_req, res) => {
    try {
      await readCrontab();
      res.json({ hasAccess: true });
    } catch (e) {
      res.json({ hasAccess: false, error: (e as Error).message });
    }
  }),
);

export default router;
