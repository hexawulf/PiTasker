// "When did cron last run this?" for crontab-run tasks — PiTasker does not see
// those runs, so this is best effort and labelled with its source:
//
//   journal  PITASKER_CRON_JOURNAL=on: `journalctl` short-unix lines
//            "(zk) CMD (<command>)" from the last 2 days (needs the user in
//            systemd-journal/adm). Start time only; cron logs no exit code.
//   logfile  the job appends to a file (">> /path/x.log"): that file's mtime.
//
// Cached for 60 s; never throws.
import fs from "fs";
import os from "os";
import type { Task } from "@shared/schema";
import { config } from "../config";
import { runTool } from "../fleet/tools";

export type CronSeen = { at: string; source: "journal" | "logfile"; detail?: string };

/** The file a command's stdout is redirected to (> or >>), if it is an absolute path. */
export function redirectTarget(command: string): string | null {
  const m = /(?:^|[^0-9&>])>{1,2}\s*(\/[^\s;|&<>]+)/.exec(command);
  if (!m || m[1] === "/dev/null") return null;
  return m[1].includes("$") ? null : m[1];
}

const SHORT_UNIX_CMD = /^(\d{1,12})\.(\d{1,6}) \S+ [^:\s]+: \(([^)\s]+)\) CMD \((.*)\)$/;

/** Parse journalctl short-unix or JSON lines into command → latest start (ms) for `user`. */
export function parseCronJournal(lines: string, user = os.userInfo().username): Map<string, number> {
  const out = new Map<string, number>();
  const cleanUser = user.replace(/[^\w.-]/g, "");
  const jsonRe = new RegExp(`^\\(${cleanUser}\\) CMD \\((.*)\\)$`);
  for (const line of lines.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const sm = SHORT_UNIX_CMD.exec(trimmed);
    if (sm) {
      if (sm[3] !== cleanUser) continue;
      const at = Number(sm[1]) * 1000 + Math.floor(Number(sm[2].padEnd(6, "0")) / 1000);
      if (!Number.isFinite(at)) continue;
      const cmd = sm[4].trim();
      if (!out.has(cmd) || out.get(cmd)! < at) out.set(cmd, at);
      continue;
    }
    if (trimmed.startsWith("{")) {
      try {
        const e = JSON.parse(trimmed) as { MESSAGE?: unknown; __REALTIME_TIMESTAMP?: string };
        if (typeof e.MESSAGE !== "string") continue;
        const m = jsonRe.exec(e.MESSAGE);
        if (!m) continue;
        const at = Math.floor(Number(e.__REALTIME_TIMESTAMP) / 1000);
        const cmd = m[1].trim();
        if (!out.has(cmd) || out.get(cmd)! < at) out.set(cmd, at);
      } catch {
        /* not JSON */
      }
    }
  }
  return out;
}

let cache: { at: number; journal: Map<string, number> } | null = null;
let inflight: Promise<Map<string, number>> | null = null;

async function readJournal(): Promise<Map<string, number>> {
  try {
    const stdout = await runTool(
      "journalctl",
      ["--since=-2d", "-o", "short-unix", "--no-pager", "-q", "--grep=^\\(\\S+\\) CMD \\(", "SYSLOG_IDENTIFIER=CRON", "_SYSTEMD_UNIT=cron.service"],
      { timeoutMs: 10_000, maxBytes: 4 * 1024 * 1024 },
    );
    return parseCronJournal(stdout);
  } catch {
    return new Map();
  }
}

export async function cronSeenFor(tasks: Task[]): Promise<Map<number, CronSeen>> {
  const out = new Map<number, CronSeen>();
  let journal = new Map<string, number>();
  if (config.cronJournal) {
    if (!cache || Date.now() - cache.at > 60_000) {
      inflight ??= readJournal()
        .then((j) => {
          cache = { at: Date.now(), journal: j };
          return j;
        })
        .finally(() => {
          inflight = null;
        });
      journal = await inflight;
    } else {
      journal = cache.journal;
    }
  }
  await Promise.all(
    tasks.map(async (t) => {
      if (t.isSystemManaged === false) return;
      const j = journal.get(t.command.trim());
      if (j) {
        out.set(t.id, { at: new Date(j).toISOString(), source: "journal" });
        return;
      }
      const file = redirectTarget(t.command);
      if (!file) return;
      try {
        const st = await fs.promises.stat(file);
        out.set(t.id, { at: st.mtime.toISOString(), source: "logfile", detail: file });
      } catch {
        /* not there or not readable */
      }
    }),
  );
  return out;
}
