// Collects one host's snapshot for the fleet view (read-only). Shared by the
// agent (dist/agent.mjs, on piapps2/3/4 and hwca-ap02) and the hub (piapps,
// in-process). Only reads; every program runs through runTool (fixed argv).
//
//   timedatectl show -p Timezone --value   → host zone (→ /etc/timezone → $TZ → Etc/UTC)
//   crontab -l                              → zk crontab
//   $PITASKER_ROOT_CRON_SNAPSHOT            → root crontab (written by the root-owned
//                                             pitasker-root-cron-snapshot unit; no sudo)
//   /etc/crontab, /etc/cron.d/*             → system crontabs (user field)
//   /etc/cron.{hourly,daily,weekly,monthly} → run-parts scripts
//   systemctl [--user] list-timers --all -o json + two `systemctl show` calls
//   journalctl (cron, 2 days, MESSAGE + timestamp only) → last start per command
//   git --no-optional-locks -C /home/zk/bin rev-parse / status / ls-files → bin HEAD, tracked, dirty
//
// A failing source adds an entry to errors[]; the snapshot still comes back.
// Every command, line and env value is redacted here, before it leaves.
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { isValidTimeZone, nextRuns } from "@shared/cron";
import type { CrontabSource, Entry, EnvLine, FileSource, RunPartsSource, ScriptInfo, Snapshot, TimerSource } from "@shared/fleet";
import { parseCrontab, type CronLine } from "../crontab/document";
import { redact, redactEnv } from "./redact";
import { fleetPaths, runTool, type FleetPaths } from "./tools";

export type CollectOptions = { paths?: FleetPaths; now?: Date; version: string };

const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
const RUN_PARTS = ["cron.hourly", "cron.daily", "cron.weekly", "cron.monthly"] as const;
/** run-parts' own rule: only [A-Za-z0-9_-] names run (so *.dpkg-old, foo~, .placeholder don't). */
const RUN_PARTS_NAME = /^[A-Za-z0-9_-]+$/;
const UNIT_NAME = /^[A-Za-z0-9:_.@\\-]{1,200}\.(timer|service|target)$/;

// ─── time zone ─────────────────────────────────────────────────────────────

export async function hostTimeZone(p: FleetPaths): Promise<string> {
  const tz = await runTool("timedatectl", ["show", "-p", "Timezone", "--value"], { timeoutMs: 5_000 })
    .then((s) => s.trim())
    .catch(() => "");
  if (tz && isValidTimeZone(tz)) return tz;
  try {
    const f = fs.readFileSync(path.join(p.etcDir, "timezone"), "utf8").trim();
    if (f && isValidTimeZone(f)) return f;
  } catch {
    /* next */
  }
  const env = process.env.TZ?.replace(/^:/, "");
  return env && isValidTimeZone(env) ? env : "Etc/UTC";
}

// ─── scripts and bin.git ───────────────────────────────────────────────────

const WRAPPERS = new Set(["bash", "sh", "zsh", "dash", "python", "python3", "node", "perl", "env", "nice", "ionice", "flock", "timeout", "nohup", "chronic"]);

/**
 * The script a command runs: the first word (after `cd … &&`/`cd …;`, VAR=value
 * assignments and wrappers like bash/python3/nice/flock/timeout) when it is an
 * absolute path or starts with ~/ or $HOME/. Bare program names → null.
 */
export function scriptPath(command: string, home: string | null): string | null {
  let c = command.trim();
  for (let i = 0; i < 3; i++) {
    const m = /^cd\s+("[^"]*"|'[^']*'|\S+)\s*(&&|;)\s*/.exec(c);
    if (!m) break;
    c = c.slice(m[0].length);
  }
  const words = c.split(/\s+/);
  let i = 0;
  while (i < words.length) {
    const w = words[i];
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(w)) {
      i++;
      continue;
    }
    const base = path.basename(w.replace(/^["']|["']$/g, ""));
    if (WRAPPERS.has(base)) {
      i++;
      while (i < words.length && (words[i].startsWith("-") || /^\d+[smhd]?$/.test(words[i]))) i++;
      if (base === "flock" && i < words.length - 1) i++; // the lock file
      continue;
    }
    break;
  }
  const w = (words[i] ?? "").replace(/^["']|["']$/g, "").replace(/[;&|)]+$/, "");
  if (!w) return null;
  if (w.startsWith("/")) return path.normalize(w);
  if (home && (w.startsWith("~/") || w.startsWith("$HOME/") || w.startsWith("${HOME}/"))) {
    return path.join(home, w.replace(/^(~|\$HOME|\$\{HOME\})\//, ""));
  }
  return null;
}

export type BinState = { head: string | null; dirty: boolean; tracked: Set<string> | null; dirtyFiles: Set<string> };

export async function binState(binDir: string): Promise<BinState | null> {
  if (!fs.existsSync(binDir)) return null;
  // --no-optional-locks: `git status` must never try to refresh .git/index (the
  // agent's home is read-only, and it only reads).
  const git = (args: string[]) => runTool("git", ["--no-optional-locks", "-C", binDir, ...args], { timeoutMs: 8_000 });
  const head = await git(["rev-parse", "HEAD"]).then((s) => s.trim()).catch(() => null);
  if (!head) return { head: null, dirty: false, tracked: null, dirtyFiles: new Set() };
  const [ls, status] = await Promise.all([git(["ls-files", "-z"]).catch(() => ""), git(["status", "--porcelain=v1", "-z"]).catch(() => "")]);
  const tracked = new Set(ls.split("\0").filter(Boolean));
  const dirtyFiles = new Set(
    status
      .split("\0")
      .filter((x) => x.length > 3)
      .map((x) => x.slice(3)),
  );
  return { head: /^[0-9a-f]{7,64}$/.test(head) ? head : null, dirty: dirtyFiles.size > 0, tracked, dirtyFiles };
}

export function scriptInfo(p: string, binDir: string, bin: BinState | null): ScriptInfo {
  const root = path.resolve(binDir);
  const inBin = p === root || p.startsWith(root + path.sep);
  const rel = inBin ? path.relative(root, p) : null;
  let exists = false;
  try {
    exists = fs.statSync(p).isFile();
  } catch {
    /* missing or unreadable */
  }
  return {
    path: p,
    exists,
    inBin,
    tracked: rel !== null && bin?.tracked ? bin.tracked.has(rel) : null,
    dirty: rel !== null && bin?.tracked ? bin.dirtyFiles.has(rel) : null,
  };
}

// ─── cron journal ──────────────────────────────────────────────────────────

/** journalctl -o json lines → user → command → newest start (ms). */
export function parseJournal(jsonLines: string): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>();
  for (const line of jsonLines.split("\n")) {
    if (!line.trim()) continue;
    let e: { MESSAGE?: unknown; __REALTIME_TIMESTAMP?: unknown };
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof e.MESSAGE !== "string") continue;
    const m = /^\(([^)\s]+)\) CMD \((.*)\)$/s.exec(e.MESSAGE);
    if (!m) continue;
    const at = Math.floor(Number(e.__REALTIME_TIMESTAMP) / 1000);
    if (!Number.isFinite(at)) continue;
    const byCmd = out.get(m[1]) ?? new Map<string, number>();
    const cmd = m[2].trim();
    if ((byCmd.get(cmd) ?? 0) < at) byCmd.set(cmd, at);
    out.set(m[1], byCmd);
  }
  return out;
}

async function readJournal(): Promise<Map<string, Map<string, number>>> {
  const out = await runTool(
    "journalctl",
    ["--since=-2d", "-o", "json", "--output-fields=MESSAGE,__REALTIME_TIMESTAMP", "--no-pager", "-q", "SYSLOG_IDENTIFIER=CRON", "_SYSTEMD_UNIT=cron.service"],
    { timeoutMs: 10_000, maxBytes: 8 * 1024 * 1024 },
  );
  return parseJournal(out);
}

/** The file a command's stdout is appended/written to (absolute, no variables). */
export function redirectTarget(command: string): string | null {
  const m = /(?:^|[^0-9&>])>{1,2}\s*(\/[^\s;|&<>]+)/.exec(command);
  if (!m || m[1] === "/dev/null" || m[1].includes("$")) return null;
  return m[1];
}

// ─── crontabs ──────────────────────────────────────────────────────────────

type Ctx = {
  tz: string;
  now: Date;
  paths: FleetPaths;
  bin: BinState | null;
  journal: Map<string, Map<string, number>>;
};

const unquote = (v: string) => v.trim().replace(/^(["'])(.*)\1$/, "$2");

function homeOf(user: string | undefined, p: FleetPaths): string | null {
  if (!user || user === p.user || user === "zk") return p.homeDir;
  if (user === "root") return "/root";
  return null;
}

function lastRunFor(command: string, user: string | undefined, ctx: Ctx): Entry["lastRun"] {
  const j = user ? ctx.journal.get(user)?.get(command.trim()) : undefined;
  if (j) return { at: new Date(j).toISOString(), source: "journal" };
  const file = redirectTarget(command);
  if (!file) return undefined;
  try {
    return { at: fs.statSync(file).mtime.toISOString(), source: "logfile" };
  } catch {
    return undefined;
  }
}

/** Entries + env lines of one crontab text. `user` = the owner (user crontab) or null (system: per line). */
export function crontabEntries(sourceKey: string, text: string, system: boolean, owner: string | null, ctx: Ctx): { entries: Entry[]; envLines: EnvLine[] } {
  const doc = parseCrontab(text, { system });
  const entries: Entry[] = [];
  const envLines: EnvLine[] = [];
  const seen = new Map<string, number>();
  let tz: string | null = null;
  let cronTz: string | null = null;
  for (const l of doc.lines as CronLine[]) {
    if (l.kind === "env") {
      const eq = l.raw.indexOf("=");
      const name = l.raw.slice(0, eq).trim();
      const value = l.raw.slice(eq + 1).replace(/\r$/, "").trim();
      envLines.push({ name: name.slice(0, 128), value: redactEnv(name, value).slice(0, 2000) });
      const v = unquote(value);
      if (name === "CRON_TZ" && isValidTimeZone(v)) cronTz = v;
      if (name === "TZ" && isValidTimeZone(v)) tz = v;
      continue;
    }
    if (l.kind !== "job" && l.kind !== "disabled") continue;
    const n = seen.get(l.raw) ?? 0;
    seen.set(l.raw, n + 1);
    const user = system ? l.user : (owner ?? undefined);
    const zone = cronTz ?? tz;
    const disabled = l.kind === "disabled";
    const sp = scriptPath(l.command!, homeOf(user, ctx.paths));
    const e: Entry = {
      id: sha256(`${sourceKey}\0${l.raw}\0${n}`).slice(0, 16),
      line: redact(l.raw).slice(0, 4000),
      schedule: l.schedule!,
      command: redact(l.command!).slice(0, 4000),
      disabled,
      nextRuns: disabled ? [] : nextRuns(l.schedule!, zone ?? ctx.tz, 3, ctx.now).map((d) => d.toISOString()),
    };
    if (user) e.user = user;
    if (zone) e.env = { tz: zone };
    if (!disabled) {
      const last = lastRunFor(l.command!, user, ctx);
      if (last) e.lastRun = last;
    }
    if (sp) e.script = scriptInfo(sp, ctx.paths.binDir, ctx.bin);
    entries.push(e);
  }
  return { entries, envLines };
}

async function zkCrontab(ctx: Ctx): Promise<CrontabSource> {
  let text = "";
  try {
    text = await runTool("crontab", ["-l"], { timeoutMs: 8_000 });
  } catch (e) {
    const err = e as { stderr?: string };
    if (!/no crontab for/i.test(err.stderr ?? "")) throw e;
  }
  const { entries, envLines } = crontabEntries(`crontab:${ctx.paths.user}`, text, false, ctx.paths.user, ctx);
  return { kind: "crontab", owner: "zk", hash: sha256(text), envLines, entries };
}

async function rootCrontab(ctx: Ctx): Promise<CrontabSource> {
  let st: fs.Stats;
  try {
    st = await fs.promises.stat(ctx.paths.rootSnapshot);
  } catch {
    throw new Error("no root crontab snapshot (install the pitasker-root-cron-snapshot units)");
  }
  const text = await fs.promises.readFile(ctx.paths.rootSnapshot, "utf8");
  const { entries, envLines } = crontabEntries("crontab:root", text, false, "root", ctx);
  return { kind: "crontab", owner: "root", hash: sha256(text), snapshotAt: st.mtime.toISOString(), envLines, entries };
}

async function systemFiles(ctx: Ctx): Promise<FileSource[]> {
  const out: FileSource[] = [];
  const etcCrontab = path.join(ctx.paths.etcDir, "crontab");
  if (fs.existsSync(etcCrontab)) {
    const text = await fs.promises.readFile(etcCrontab, "utf8");
    const r = crontabEntries("etc-crontab", text, true, null, ctx);
    out.push({ kind: "etc-crontab", file: "crontab", ...r });
  }
  const dir = path.join(ctx.paths.etcDir, "cron.d");
  const names = fs.existsSync(dir) ? (await fs.promises.readdir(dir)).filter((n) => RUN_PARTS_NAME.test(n)).sort() : [];
  for (const name of names) {
    const f = path.join(dir, name);
    if (!(await fs.promises.stat(f)).isFile()) continue;
    const text = await fs.promises.readFile(f, "utf8");
    out.push({ kind: "cron.d", file: name, ...crontabEntries(`cron.d:${name}`, text, true, null, ctx) });
  }
  return out;
}

async function runParts(ctx: Ctx): Promise<RunPartsSource[]> {
  const out: RunPartsSource[] = [];
  for (const dir of RUN_PARTS) {
    const d = path.join(ctx.paths.etcDir, dir);
    if (!fs.existsSync(d)) continue;
    const scripts: string[] = [];
    for (const name of (await fs.promises.readdir(d)).sort()) {
      if (!RUN_PARTS_NAME.test(name)) continue;
      try {
        const st = await fs.promises.stat(path.join(d, name));
        if (st.isFile() && st.mode & 0o111) scripts.push(name);
      } catch {
        /* vanished */
      }
    }
    out.push({ kind: "run-parts", dir, scripts });
  }
  return out;
}

// ─── systemd timers ────────────────────────────────────────────────────────

/** `systemctl show` output → Id → key → values (a key can repeat). */
export function parseShow(text: string): Map<string, Map<string, string[]>> {
  const out = new Map<string, Map<string, string[]>>();
  for (const block of text.split(/\n\s*\n/)) {
    const props = new Map<string, string[]>();
    for (const line of block.split("\n")) {
      const eq = line.indexOf("=");
      if (eq <= 0) continue;
      const k = line.slice(0, eq);
      props.set(k, [...(props.get(k) ?? []), line.slice(eq + 1)]);
    }
    const id = props.get("Id")?.[0];
    if (id) out.set(id, props);
  }
  return out;
}

/** "{ OnCalendar=*-*-* 06:00:00 ; next_elapse=… }" → "OnCalendar=*-*-* 06:00:00"; OnUnitActiveUSec → OnUnitActiveSec. */
export function timerSpecs(values: string[] = []): string[] {
  const out: string[] = [];
  for (const v of values) {
    for (const m of v.matchAll(/\{\s*(On[A-Za-z]+)=(.*?)\s*;\s*(?:next_elapse|last_trigger|\})/g)) {
      out.push(`${m[1].replace(/USec$/, "Sec")}=${m[2].trim()}`);
    }
  }
  return out;
}

/** "{ path=/usr/bin/x ; argv[]=/usr/bin/x -a ; ignore_errors=no ; … }" → "/usr/bin/x -a". */
export function execStartArgv(values: string[] = []): string | null {
  for (const v of values) {
    const m = /argv\[\]=(.*?)\s;\s(?:ignore_errors|start_time|stop_time|pid|code|status)=/.exec(v);
    if (m) return m[1].trim();
  }
  return null;
}

/**
 * µs since the epoch → ISO; 0 / null / missing → null. Only `next` and `last`
 * are used: `left`/`passed` are absolute timestamps too on systemd 255 and 259
 * (left == next), not durations.
 */
export function usecToIso(v: unknown): string | null {
  const n = typeof v === "number" ? v : typeof v === "string" && /^\d+$/.test(v) ? Number(v) : 0;
  return n > 0 ? new Date(Math.floor(n / 1000)).toISOString() : null;
}

type TimerRow = { unit?: unknown; activates?: unknown; next?: unknown; last?: unknown };

async function timers(scope: "system" | "user", ctx: Ctx): Promise<TimerSource[]> {
  const base = scope === "user" ? ["--user"] : [];
  const env = scope === "user" ? { XDG_RUNTIME_DIR: `/run/user/${ctx.paths.uid}` } : undefined;
  const sc = (args: string[]) => runTool("systemctl", [...base, ...args], { env, timeoutMs: 8_000, maxBytes: 2 * 1024 * 1024 });
  const rows = JSON.parse(await sc(["list-timers", "--all", "-o", "json", "--no-pager"])) as TimerRow[];
  if (!Array.isArray(rows)) throw new Error("list-timers: not a JSON array");
  const list = rows.filter((r) => typeof r.unit === "string" && UNIT_NAME.test(r.unit) && (typeof r.activates !== "string" || UNIT_NAME.test(r.activates)));
  if (list.length === 0) return [];
  const units = list.map((r) => r.unit as string);
  const services = [...new Set(list.map((r) => r.activates).filter((a): a is string => typeof a === "string"))];
  const [tShow, sShow] = await Promise.all([
    sc(["show", "-p", "Id,TimersCalendar,TimersMonotonic", "--", ...units]).then(parseShow),
    services.length ? sc(["show", "-p", "Id,ExecStart,User,Result,ExecMainStatus", "--", ...services]).then(parseShow) : Promise.resolve(new Map()),
  ]);
  return list.map((r) => {
    const unit = r.unit as string;
    const activates = typeof r.activates === "string" ? r.activates : "";
    const t = tShow.get(unit);
    const s = sShow.get(activates);
    const rawCmd = execStartArgv(s?.get("ExecStart"));
    const user = (s?.get("User")?.[0] || (scope === "user" ? ctx.paths.user : "root")) as string;
    const status = s?.get("ExecMainStatus")?.[0];
    const src: TimerSource = {
      kind: "timer",
      scope,
      unit,
      activates,
      calendar: [...timerSpecs(t?.get("TimersCalendar")), ...timerSpecs(t?.get("TimersMonotonic"))],
      next: usecToIso(r.next),
      last: usecToIso(r.last),
      result: s?.get("Result")?.[0] || null,
      exitStatus: status && /^-?\d+$/.test(status) ? Number(status) : null,
      user,
      command: rawCmd ? redact(rawCmd).slice(0, 4000) : null,
    };
    const sp = rawCmd ? scriptPath(rawCmd, homeOf(user, ctx.paths)) : null;
    if (sp) src.script = scriptInfo(sp, ctx.paths.binDir, ctx.bin);
    return src;
  });
}

// ─── the snapshot ──────────────────────────────────────────────────────────

export async function collectSnapshot(opts: CollectOptions): Promise<Snapshot> {
  const paths = opts.paths ?? fleetPaths();
  const now = opts.now ?? new Date();
  const errors: Snapshot["errors"] = [];
  const guard = async <T>(source: string, fn: () => Promise<T>, fallback: T): Promise<T> => {
    try {
      return await fn();
    } catch (e) {
      errors.push({ source, message: String((e as Error).message ?? e).replace(/[\u0000-\u001f]/g, " ").slice(0, 300) });
      return fallback;
    }
  };

  const [tz, bin, journal] = await Promise.all([
    hostTimeZone(paths),
    guard("bin", () => binState(paths.binDir), null),
    guard("journal", readJournal, new Map<string, Map<string, number>>()),
  ]);
  const ctx: Ctx = { tz, now, paths, bin, journal };

  const [zk, root, files, parts, sysTimers, userTimers] = await Promise.all([
    guard("zk crontab", () => zkCrontab(ctx), null),
    guard("root crontab", () => rootCrontab(ctx), null),
    guard("/etc/crontab + cron.d", () => systemFiles(ctx), [] as FileSource[]),
    guard("run-parts", () => runParts(ctx), [] as RunPartsSource[]),
    guard("system timers", () => timers("system", ctx), [] as TimerSource[]),
    guard("user timers", () => timers("user", ctx), [] as TimerSource[]),
  ]);

  return {
    host: os.hostname().slice(0, 128),
    tz,
    generatedAt: now.toISOString(),
    agentVersion: opts.version.slice(0, 32),
    bin: bin ? { head: bin.head, dirty: bin.dirty, path: paths.binDir } : null,
    sources: [...(zk ? [zk] : []), ...(root ? [root] : []), ...files, ...parts, ...sysTimers, ...userTimers],
    errors,
  };
}

/** A collector with a cache (the agent: 30 s; the hub's local host: 60 s). One run at a time. */
export function cachedCollector(opts: CollectOptions & { ttlMs: number }) {
  let last: { at: number; snap: Snapshot } | null = null;
  let inflight: Promise<Snapshot> | null = null;
  return (force = false): Promise<Snapshot> => {
    if (!force && last && Date.now() - last.at < opts.ttlMs) return Promise.resolve(last.snap);
    inflight ??= collectSnapshot(opts)
      .then((snap) => {
        last = { at: Date.now(), snap };
        return snap;
      })
      .finally(() => (inflight = null));
    return inflight;
  };
}
