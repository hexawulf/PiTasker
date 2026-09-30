// "When did cron last run this?" for crontab-run tasks — PiTasker does not see
// those runs, so this is best effort and labelled with its source:
//
//   journal  PITASKER_CRON_JOURNAL=on: `journalctl -u cron` lines
//            "(zk) CMD (<command>)" from the last 2 days (needs the user in
//            systemd-journal/adm). Start time only; cron logs no exit code.
//   logfile  the job appends to a file (">> /path/x.log"): that file's mtime.
//
// Cached for 60 s; never throws.
import { execFile } from "child_process";
import fs from "fs";
import os from "os";
import type { Task } from "@shared/schema";
import { config } from "../config";

export type CronSeen = { at: string; source: "journal" | "logfile"; detail?: string };

/** The file a command's stdout is redirected to (> or >>), if it is an absolute path. */
export function redirectTarget(command: string): string | null {
  const m = /(?:^|[^0-9&>])>{1,2}\s*(\/[^\s;|&<>]+)/.exec(command);
  if (!m || m[1] === "/dev/null") return null;
  return m[1].includes("$") ? null : m[1];
}

/** Parse journalctl JSON lines into command → latest start (ms). */
export function parseCronJournal(jsonLines: string, user = os.userInfo().username): Map<string, number> {
  const out = new Map<string, number>();
  const re = new RegExp(`^\\(${user.replace(/[^\w.-]/g, "")}\\) CMD \\((.*)\\)$`);
  for (const line of jsonLines.split("\n")) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line) as { MESSAGE?: unknown; __REALTIME_TIMESTAMP?: string };
      if (typeof e.MESSAGE !== "string") continue;
      const m = re.exec(e.MESSAGE);
      if (!m) continue;
      const at = Math.floor(Number(e.__REALTIME_TIMESTAMP) / 1000);
      const cmd = m[1].trim();
      if (!out.has(cmd) || out.get(cmd)! < at) out.set(cmd, at);
    } catch {
      /* not JSON */
    }
  }
  return out;
}

let cache: { at: number; journal: Map<string, number> } | null = null;

function readJournal(): Promise<Map<string, number>> {
  return new Promise((resolve) => {
    execFile(
      "journalctl",
      ["-u", "cron", "-u", "crond", "--since", "-2d", "-o", "json", "--no-pager", "-q"],
      { timeout: 10_000, maxBuffer: 16 * 1024 * 1024 },
      (err, stdout) => resolve(err && !stdout ? new Map() : parseCronJournal(String(stdout))),
    );
  });
}

export async function cronSeenFor(tasks: Task[]): Promise<Map<number, CronSeen>> {
  const out = new Map<number, CronSeen>();
  let journal = new Map<string, number>();
  if (config.cronJournal) {
    if (!cache || Date.now() - cache.at > 60_000) cache = { at: Date.now(), journal: await readJournal() };
    journal = cache.journal;
  }
  for (const t of tasks) {
    if (t.isSystemManaged === false) continue;
    const j = journal.get(t.command.trim());
    if (j) {
      out.set(t.id, { at: new Date(j).toISOString(), source: "journal" });
      continue;
    }
    const file = redirectTarget(t.command);
    if (!file) continue;
    try {
      const st = await fs.promises.stat(file);
      out.set(t.id, { at: st.mtime.toISOString(), source: "logfile", detail: file });
    } catch {
      /* not there or not readable */
    }
  }
  return out;
}
