import { pgTable, text, serial, integer, boolean, timestamp, varchar, json, index } from "drizzle-orm/pg-core";
import { z } from "zod";
import { parseCron } from "./cron";

// Schema changes go through migrations/ (npm run db:generate, then
// npm run db:migrate) — never `db:push` against a live database.

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

/**
 * A task is run by exactly one runner:
 *   isSystemManaged = true  → the user's crontab runs it (PiTasker only keeps the line in sync)
 *   isSystemManaged = false → PiTasker's scheduler runs it (node-cron, host time zone)
 */
export const tasks = pgTable("tasks", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  cronSchedule: text("cron_schedule").notNull(),
  command: text("command").notNull(),
  // Result of the last run PiTasker itself started: pending, running, success, failed.
  status: text("status").notNull().default("pending"),
  lastRun: timestamp("last_run"),
  output: text("output"),
  createdAt: timestamp("created_at").defaultNow().notNull(),

  crontabId: text("crontab_id").unique(),
  syncedToCrontab: boolean("synced_to_crontab").default(false),
  crontabSyncedAt: timestamp("crontab_synced_at"),
  source: text("source").default("pitasker"), // "pitasker" | "crontab" | "imported"
  isSystemManaged: boolean("is_system_managed").default(true),
});

/** One row per run PiTasker started (scheduled or manual). Newest RUNS_KEEP per task are kept. */
export const taskRuns = pgTable(
  "task_runs",
  {
    id: serial("id").primaryKey(),
    taskId: integer("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    trigger: text("trigger").notNull(), // "schedule" | "manual"
    status: text("status").notNull(), // "running" | "success" | "failed" | "timeout" | "interrupted"
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    durationMs: integer("duration_ms"),
    exitCode: integer("exit_code"),
    signal: text("signal"),
    stdout: text("stdout"),
    stderr: text("stderr"),
    truncated: boolean("truncated").notNull().default(false),
  },
  (t) => [index("task_runs_task_started_idx").on(t.taskId, t.startedAt)],
);

/** connect-pg-simple's table (created by hand on older installs; migration 0001 uses IF NOT EXISTS). */
export const session = pgTable(
  "session",
  {
    sid: varchar("sid").primaryKey(),
    sess: json("sess").notNull(),
    expire: timestamp("expire", { precision: 6 }).notNull(),
  },
  (t) => [index("IDX_session_expire").on(t.expire)],
);

export const RUNS_KEEP = 50;

// ─── Validation ────────────────────────────────────────────────────────────

export const cronScheduleSchema = z
  .string()
  .trim()
  .superRefine((val, ctx) => {
    const p = parseCron(val);
    if (!p.ok) ctx.addIssue({ code: z.ZodIssueCode.custom, message: p.error });
  });

export const commandSchema = z
  .string()
  .trim()
  .min(1, "Command is required")
  .max(1000, "Command must be at most 1000 characters")
  .refine((v) => !/[\r\n]/.test(v), "Command must be a single line");

export const taskInputSchema = z
  .object({
    name: z.string().trim().min(1, "Task name is required").max(100, "Task name must be less than 100 characters"),
    cronSchedule: cronScheduleSchema,
    command: commandSchema,
    /** true = the crontab runs it (default), false = PiTasker runs it. */
    isSystemManaged: z.boolean().optional().default(true),
  })
  .superRefine((t, ctx) => {
    if (!t.isSystemManaged && t.cronSchedule.trim().toLowerCase() === "@reboot") {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["cronSchedule"], message: "@reboot needs the crontab as runner" });
    }
  });

export const taskPatchSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    cronSchedule: cronScheduleSchema,
    command: commandSchema,
  })
  .partial()
  .strict();

/** Kept for existing imports: the create schema. */
export const insertTaskSchema = taskInputSchema;
/** Kept for existing imports: the edit schema. */
export const updateTaskSchema = taskPatchSchema;

export const insertUserSchema = z.object({ username: z.string().min(1), password: z.string().min(1) });

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type TaskInput = z.input<typeof taskInputSchema>;
export type InsertTask = typeof tasks.$inferInsert;
export type UpdateTask = Partial<Omit<typeof tasks.$inferInsert, "id">>;
export type Task = typeof tasks.$inferSelect;
export type TaskRun = typeof taskRuns.$inferSelect;
export type RunStatus = "running" | "success" | "failed" | "timeout" | "interrupted";

/** What GET /api/tasks returns per task: the row plus where it stands. */
export type TaskView = Task & {
  runner: "cron" | "pitasker";
  /** cron runner: the line in the crontab — active, disabled by hand, or missing. */
  cronState: "active" | "disabled" | "missing" | null;
  lastRunInfo: Pick<TaskRun, "id" | "status" | "startedAt" | "finishedAt" | "durationMs" | "exitCode" | "trigger"> | null;
  /** cron runner: the latest start cron logged (journal) or the job's log file changed, where known. */
  cronSeen: { at: string; source: "journal" | "logfile"; detail?: string } | null;
};
