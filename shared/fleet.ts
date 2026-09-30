// The fleet view (docs/plans/2.1-fleet-view.md, P3): what a host has
// scheduled, as the agent (or the hub's own collector) reports it. Read-only.
//
//   Snapshot ── sources[] ── crontab (zk | root)      entries[] + hash (for P4)
//            │            ├─ etc-crontab / cron.d     entries[] (with a user field)
//            │            ├─ run-parts                scripts[] (cron.daily …)
//            │            └─ timer (system | user)    next / last from systemd
//            └─ errors[]  one per failed source; never fails the whole snapshot
//
// The hub validates every agent answer with SnapshotSchema (zod). The agent
// imports only the types (`import type`), so zod never reaches dist/agent.mjs.
import { z } from "zod";

const iso = z.string().max(40);
const short = (n: number) => z.string().max(n);

export const ScriptInfoSchema = z.object({
  path: short(512),
  exists: z.boolean(),
  /** Under the bin.git checkout (/home/zk/bin). */
  inBin: z.boolean(),
  /** In bin.git (git ls-files); null when bin/ isn't a git repo or the script isn't in it. */
  tracked: z.boolean().nullable(),
  /** Uncommitted changes (git status --porcelain). */
  dirty: z.boolean().nullable(),
});

export const LastRunSchema = z.object({ at: iso, source: z.enum(["journal", "logfile", "systemd"]) });

export const EntrySchema = z.object({
  /** Stable: source + line text hash. */
  id: short(64),
  /** The line as written (redacted). */
  line: short(4000),
  schedule: short(200),
  user: short(64).optional(),
  /** Redacted. */
  command: short(4000),
  disabled: z.boolean(),
  /** CRON_TZ / TZ in effect for this line, if any. */
  env: z.object({ tz: short(64) }).optional(),
  /** ISO, computed in the host's zone (or CRON_TZ/TZ); [] for @reboot. */
  nextRuns: z.array(iso).max(3),
  lastRun: LastRunSchema.optional(),
  script: ScriptInfoSchema.optional(),
});

const EnvLineSchema = z.object({ name: short(128), value: short(2000) });

export const CrontabSourceSchema = z.object({
  kind: z.literal("crontab"),
  owner: z.enum(["zk", "root"]),
  /** sha256 of the raw text (P4 will write with it as the expected hash). Never the text itself. */
  hash: short(64).nullable(),
  /** root: when the root-owned snapshot file was written. */
  snapshotAt: iso.optional(),
  /** Env lines (SHELL, PATH, MAILTO, CRON_TZ …); secrets redacted. */
  envLines: z.array(EnvLineSchema).max(200).optional(),
  entries: z.array(EntrySchema).max(2000),
});

export const FileSourceSchema = z.object({
  kind: z.enum(["etc-crontab", "cron.d"]),
  file: short(256),
  envLines: z.array(EnvLineSchema).max(200).optional(),
  entries: z.array(EntrySchema).max(2000),
});

export const RunPartsSourceSchema = z.object({
  kind: z.literal("run-parts"),
  dir: z.enum(["cron.hourly", "cron.daily", "cron.weekly", "cron.monthly"]),
  scripts: z.array(short(256)).max(500),
});

export const TimerSourceSchema = z.object({
  kind: z.literal("timer"),
  scope: z.enum(["system", "user"]),
  unit: short(256),
  activates: short(256),
  /** OnCalendar= / OnUnitActiveSec= … as systemd reports them. */
  calendar: z.array(short(256)).max(20),
  next: iso.nullable(),
  last: iso.nullable(),
  /** The service's last Result= (success, exit-code …) and ExecMainStatus. */
  result: short(64).nullable(),
  exitStatus: z.number().int().nullable(),
  user: short(64).nullable(),
  /** ExecStart argv (redacted). */
  command: short(4000).nullable(),
  script: ScriptInfoSchema.optional(),
});

export const SourceSchema = z.discriminatedUnion("kind", [CrontabSourceSchema, FileSourceSchema, RunPartsSourceSchema, TimerSourceSchema]);

export const SnapshotSchema = z.object({
  host: short(128),
  tz: short(64),
  generatedAt: iso,
  agentVersion: short(32),
  bin: z.object({ head: short(64).nullable(), dirty: z.boolean(), path: short(512) }).nullable(),
  sources: z.array(SourceSchema).max(1000),
  errors: z.array(z.object({ source: short(128), message: short(500) })).max(100),
});

export const AgentHealthSchema = z.object({
  version: short(32),
  host: short(128),
  tz: short(64),
  capabilities: z.object({ cron: z.literal(true), write: z.literal(false) }),
});

export type ScriptInfo = z.infer<typeof ScriptInfoSchema>;
export type Entry = z.infer<typeof EntrySchema>;
export type CrontabSource = z.infer<typeof CrontabSourceSchema>;
export type FileSource = z.infer<typeof FileSourceSchema>;
export type RunPartsSource = z.infer<typeof RunPartsSourceSchema>;
export type TimerSource = z.infer<typeof TimerSourceSchema>;
export type Source = z.infer<typeof SourceSchema>;
export type Snapshot = z.infer<typeof SnapshotSchema>;
export type AgentHealth = z.infer<typeof AgentHealthSchema>;
export type EnvLine = z.infer<typeof EnvLineSchema>;

// ─── Hub → browser ─────────────────────────────────────────────────────────

/**
 * online           answered with a valid snapshot
 * offline          no answer (refused, timeout, DNS) — last saved snapshot shown
 * auth-error       401/403/429 — wrong or missing token
 * version-mismatch agent's major version differs from the hub's
 * stale            answered, but the snapshot is older than 10 min (agent clock or cache stuck)
 */
export type FleetHostStatus = "online" | "offline" | "auth-error" | "version-mismatch" | "stale";

export type FleetHost = {
  id: string;
  label: string;
  local: boolean;
  production: boolean;
  status: FleetHostStatus;
  lastSeen: string | null;
  version: string | null;
  tz: string | null;
  binHead: string | null;
  /** When the shown snapshot was made (for offline hosts: the saved one). */
  asOf: string | null;
  snapshot: Snapshot | null;
};

export type HintKind = "same-job" | "not-in-bin" | "bin-differs" | "disabled";

export type Hint = {
  kind: HintKind;
  /** Short text for a badge/tooltip. */
  message: string;
  /** hostId:entryId (or hostId:timer:unit) the hint is about; for bin-differs the host id. */
  targets: string[];
};

export type FleetResponse = { generatedAt: string; binMaster: string | null; hosts: FleetHost[]; hints: Hint[] };

export { entryKey, sourceGroup, sourceLabel, timerKey, type SourceGroup } from "./fleet-view";
