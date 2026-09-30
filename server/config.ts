// Runtime settings from the environment (.env via dotenv). Every PiTasker
// variable is listed in .env.example; read them here, not ad hoc.
import os from "os";
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
    return process.env.PITASKER_BIN_DIR || "/home/zk/bin";
  },
  /** Read cron's journal for "last started" of crontab-run jobs (needs journal read access). */
  get cronJournal() {
    return process.env.PITASKER_CRON_JOURNAL === "on";
  },
  /** Count login attempts per CF-Connecting-IP (only behind Cloudflare, where the header is trustworthy). */
  get trustCloudflare() {
    return process.env.PITASKER_CLOUDFLARE === "1";
  },
  get hostname() {
    return os.hostname();
  },
};
