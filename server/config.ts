// Runtime settings from the environment (.env via dotenv). Every PiTasker
// variable is listed in .env.example; read them here, not ad hoc.
import os from "os";
import path from "path";
import { isValidTimeZone } from "@shared/cron";

/** The zone cron runs in on this host; PiTasker's own schedules use it too. */
export function hostTimeZone(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.PITASKER_TZ?.trim();
  if (configured && isValidTimeZone(configured)) return configured;
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

const num = (v: string | undefined, dflt: number, min: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= min ? n : dflt;
};

/** LOG_RETENTION_DAYS: whole days, at least 1; unset or invalid → 7 (invalid values are logged). */
export function parseRetentionDays(raw: string | undefined): number {
  if (raw === undefined) return 7;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    console.warn(`[LOG-CLEANUP] Invalid LOG_RETENTION_DAYS "${raw}", falling back to 7`);
    return 7;
  }
  return Math.floor(n) || 1;
}

export const config = {
  get timeZone() {
    return hostTimeZone();
  },
  /** Kill a run (its whole process group) after this long. */
  get runTimeoutMs() {
    return num(process.env.PITASKER_RUN_TIMEOUT_MS, 300_000, 1_000);
  },
  /** Bytes kept per stream (stdout, stderr) per run; the tail is kept. */
  get outputCap() {
    return num(process.env.PITASKER_OUTPUT_CAP, 64 * 1024, 1024);
  },
  /** Where cron-invoked scripts must live (operator rule; the editor warns otherwise). */
  get binDir() {
    return process.env.PITASKER_BIN_DIR || path.join(os.homedir(), "bin");
  },
  /** Read cron's journal for "last started" of crontab-run jobs (needs journal read access). */
  get cronJournal() {
    return process.env.PITASKER_CRON_JOURNAL === "on";
  },
  /** Count login attempts per CF-Connecting-IP (only behind Cloudflare, where the header is trustworthy). */
  get trustCloudflare() {
    return process.env.PITASKER_CLOUDFLARE === "1";
  },
  /** PiTasker's own log files (the Logs page reads them; cleanup prunes them). */
  get logDir() {
    return process.env.LOG_DIR || path.join(os.homedir(), "logs", "pitasker");
  },
  /** Keep dated log files from the last N calendar days, today included. */
  get logRetentionDays() {
    return parseRetentionDays(process.env.LOG_RETENTION_DAYS);
  },
  /** Log what cleanup would delete instead of deleting it. */
  get logCleanupDryRun() {
    return process.env.LOG_CLEANUP_DRY_RUN === "true";
  },
  get hostname() {
    return os.hostname();
  },
};
