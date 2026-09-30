// A crontab as a list of lines, each kept byte-for-byte (`raw`) and classified.
// serialize(parse(text)) === text for ANY input, so an unchanged crontab
// round-trips byte-identically; edits touch only the lines they are about.
//
//   # ── audit header ──         comment
//   MAILTO=""                    env
//   # PITASKER_ID:<uuid>         marker  ┐ PiTasker's own markers, attached to
//   # PITASKER_COMMENT:<name>    marker  ┘ the job line directly below them
//   */5 * * * * /home/zk/bin/x   job     (id = marker id, else derived from the command)
//   # DISABLED 2026-05-01: 0 3 * * * /home/zk/bin/y    disabled (a job, commented out)
//   @reboot /home/zk/bin/z       job
//   (blank)                      blank
//
// Only jobs are imported as tasks. Disabled lines are shown, never re-enabled
// by an export (see upsertJob).
//
// System mode ({ system: true }: /etc/crontab, /etc/cron.d/*) — every job has a
// user field between the schedule and the command:
//   17 * * * * root cd / && run-parts --report /etc/cron.hourly   → user "root"
//   @reboot    root /usr/local/bin/x                              → user "root"
// The fleet view (server/fleet/collector.ts) reads those; nothing writes them.
import { createHash } from "crypto";
import { parseCron } from "@shared/cron";

export const ID_MARKER = "# PITASKER_ID:";
export const NAME_MARKER = "# PITASKER_COMMENT:";

export type LineKind = "blank" | "comment" | "marker" | "env" | "job" | "disabled" | "invalid";

export type CronLine = {
  raw: string;
  kind: LineKind;
  /** job/disabled: schedule (five fields or a macro such as "@daily") and the command exactly as written. */
  schedule?: string;
  command?: string;
  /** job/disabled: PITASKER_ID of the markers attached above it, if any. */
  markerId?: string;
  markerName?: string;
  /** marker: which marker and its value. */
  marker?: "id" | "name";
  value?: string;
  /** env: variable name. */
  envName?: string;
  /** job/disabled in system mode: the user field. */
  user?: string;
};

export type ParseMode = { system?: boolean };

export type CrontabDoc = { lines: CronLine[]; trailingNewline: boolean };

export type Job = {
  /** Index of the job line in doc.lines. */
  index: number;
  id: string;
  managed: boolean;
  name?: string;
  schedule: string;
  command: string;
  disabled: boolean;
  /** Indexes of the marker lines attached to this job. */
  markerIdx: number[];
};

const ENV_RE = /^\s*[A-Za-z_][A-Za-z0-9_]*\s*=/;
const FIVE_RE = /^\s*(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S.*)$/;
const MACRO_RE = /^\s*(@[A-Za-z]+)\s+(\S.*)$/;
const SYS_FIVE_RE = /^\s*(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S.*)$/;
const SYS_MACRO_RE = /^\s*(@[A-Za-z]+)\s+(\S+)\s+(\S.*)$/;
const USER_RE = /^[A-Za-z_][A-Za-z0-9_.-]*\$?$/;

type JobText = { schedule: string; command: string; user?: string };

/** Parse "schedule [user] command" (a job line without comment prefix); null if it isn't one. */
export function parseJobText(text: string, mode: ParseMode = {}): JobText | null {
  const t = text.replace(/\r$/, "");
  if (mode.system) {
    const macro = SYS_MACRO_RE.exec(t);
    if (macro) return parseCron(macro[1]).ok && USER_RE.test(macro[2]) ? { schedule: macro[1], user: macro[2], command: macro[3] } : null;
    const m = SYS_FIVE_RE.exec(t);
    if (!m || !USER_RE.test(m[6])) return null;
    const schedule = m.slice(1, 6).join(" ");
    return parseCron(schedule).ok ? { schedule, user: m[6], command: m[7] } : null;
  }
  const macro = MACRO_RE.exec(t);
  if (macro) {
    return parseCron(macro[1]).ok ? { schedule: macro[1], command: macro[2] } : null;
  }
  const m = FIVE_RE.exec(t);
  if (!m) return null;
  const schedule = m.slice(1, 6).join(" ");
  return parseCron(schedule).ok ? { schedule, command: m[6] } : null;
}

/**
 * A commented-out job: "#*\/5 * * * * cmd", "# 0 3 * * * cmd",
 * "# DISABLED 2026-05-01 (reason): 0 3 * * * cmd". For DISABLED lines the job
 * may start after any word boundary; the earliest valid parse wins.
 */
function parseDisabled(raw: string, mode: ParseMode): JobText | null {
  const body = raw.replace(/^\s*#+\s*/, "");
  if (body.startsWith("PITASKER_")) return null;
  const direct = parseJobText(body, mode);
  if (direct) return direct;
  if (!/^DISABLED\b/i.test(body)) return null;
  for (let i = 8; i < body.length; i++) {
    const prev = body[i - 1];
    if (!(prev === " " || prev === ":" || prev === "\t")) continue;
    if (!/[\d*@]/.test(body[i])) continue;
    const j = parseJobText(body.slice(i), mode);
    if (j) return j;
  }
  return null;
}

export function classify(raw: string, mode: ParseMode = {}): CronLine {
  const t = raw.replace(/\r$/, "");
  if (t.trim() === "") return { raw, kind: "blank" };
  const trimmed = t.trimStart();
  if (trimmed.startsWith(ID_MARKER)) return { raw, kind: "marker", marker: "id", value: trimmed.slice(ID_MARKER.length).trim() };
  if (trimmed.startsWith(NAME_MARKER)) return { raw, kind: "marker", marker: "name", value: trimmed.slice(NAME_MARKER.length).trim() };
  if (trimmed.startsWith("#")) {
    const d = parseDisabled(t, mode);
    return d ? { raw, kind: "disabled", ...d } : { raw, kind: "comment" };
  }
  if (ENV_RE.test(t)) return { raw, kind: "env", envName: t.split("=")[0].trim() };
  const j = parseJobText(t, mode);
  return j ? { raw, kind: "job", ...j } : { raw, kind: "invalid" };
}

/** Attach each run of marker lines to the job/disabled line directly below it. */
function attachMarkers(lines: CronLine[]): void {
  let pending: CronLine[] = [];
  for (const l of lines) {
    if (l.kind === "marker") {
      pending.push(l);
      continue;
    }
    if (l.kind === "job" || l.kind === "disabled") {
      for (const m of pending) {
        if (m.marker === "id") l.markerId = m.value;
        else l.markerName = m.value;
      }
    }
    pending = [];
  }
}

export function parseCrontab(text: string, mode: ParseMode = {}): CrontabDoc {
  if (text === "") return { lines: [], trailingNewline: false };
  const trailingNewline = text.endsWith("\n");
  const body = trailingNewline ? text.slice(0, -1) : text;
  const lines = body.split("\n").map((l) => classify(l, mode));
  attachMarkers(lines);
  return { lines, trailingNewline };
}

export function serializeCrontab(doc: CrontabDoc): string {
  if (doc.lines.length === 0) return "";
  return doc.lines.map((l) => l.raw).join("\n") + (doc.trailingNewline ? "\n" : "");
}

/**
 * The id PiTasker has always given a line without markers: md5 of the
 * trimmed command, UUID-formatted (stable across imports; unchanged since
 * cd77a22 so existing tasks keep matching).
 */
export function derivedId(command: string): string {
  const h = createHash("md5").update(command.trim()).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

/** Every job and disabled line with its id. A repeated command gets an id from schedule + command. */
export function listJobs(doc: CrontabDoc): Job[] {
  const jobs: Job[] = [];
  const seen = new Set<string>();
  doc.lines.forEach((l, index) => {
    if (l.kind !== "job" && l.kind !== "disabled") return;
    let id = l.markerId;
    if (!id) {
      id = derivedId(l.command!);
      if (seen.has(id)) id = derivedId(`${l.schedule} ${l.command}`);
    }
    seen.add(id);
    const markerIdx: number[] = [];
    for (let i = index - 1; i >= 0 && doc.lines[i].kind === "marker"; i--) markerIdx.unshift(i);
    jobs.push({
      index,
      id,
      managed: Boolean(l.markerId),
      name: l.markerName,
      schedule: l.schedule!,
      command: l.command!,
      disabled: l.kind === "disabled",
      markerIdx,
    });
  });
  return jobs;
}

export type JobSpec = { id: string; schedule: string; command: string; name?: string };

const oneLine = (s: string) => s.replace(/[\r\n]+/g, " ").trim();

export function jobLineText(spec: Pick<JobSpec, "schedule" | "command">): string {
  return `${spec.schedule.trim()} ${spec.command.trim()}`;
}

function markerLines(spec: JobSpec): CronLine[] {
  const out = [classify(`${ID_MARKER}${spec.id}`)];
  if (spec.name) out.push(classify(`${NAME_MARKER}${oneLine(spec.name)}`));
  return out;
}

/** Find the line for a task: by id first, then (unmarked lines only) by exact command. */
export function findJob(doc: CrontabDoc, id: string | null | undefined, command?: string): Job | undefined {
  const jobs = listJobs(doc);
  if (id) {
    const byId = jobs.find((j) => j.id === id);
    if (byId) return byId;
  }
  if (command !== undefined) {
    const c = command.trim();
    return jobs.find((j) => !j.managed && j.command.trim() === c);
  }
  return undefined;
}

export class DisabledLineError extends Error {
  constructor(public job: Job) {
    super(`The crontab line for this task is disabled (commented out) by hand: "${job.schedule} ${job.command}". Re-enable it in the crontab, not from PiTasker.`);
  }
}

function clone(doc: CrontabDoc): CrontabDoc {
  return { lines: doc.lines.map((l) => ({ ...l })), trailingNewline: doc.trailingNewline };
}

/**
 * Make the crontab contain `spec`. Returns a new doc (the input is untouched).
 *  - line found and already equal (schedule + command, and name if managed) → same doc, no markers added
 *  - line found → that line (and its markers) rewritten in place, with PiTasker markers
 *  - not found  → appended at the end with markers
 *  - found but disabled → DisabledLineError (never re-enable a line someone commented out)
 */
export function upsertJob(doc: CrontabDoc, spec: JobSpec, matchCommand?: string): CrontabDoc {
  const job = findJob(doc, spec.id, matchCommand ?? spec.command);
  if (job?.disabled) throw new DisabledLineError(job);
  const lineText = jobLineText(spec);
  if (job) {
    const cur = doc.lines[job.index];
    const sameJob = cur.schedule === parseJobText(lineText)?.schedule && cur.command!.trim() === spec.command.trim();
    const sameMarkers = !job.managed || (job.id === spec.id && (job.name ?? "") === oneLine(spec.name ?? ""));
    if (sameJob && sameMarkers) return doc;
    const next = clone(doc);
    const first = job.markerIdx.length ? job.markerIdx[0] : job.index;
    const replacement = [...markerLines(spec), sameJob ? { ...cur } : classify(lineText)];
    next.lines.splice(first, job.index - first + 1, ...replacement);
    attachMarkers(next.lines);
    return next;
  }
  const next = clone(doc);
  next.lines.push(...markerLines(spec), classify(lineText));
  next.trailingNewline = true;
  attachMarkers(next.lines);
  return next;
}

/** Remove the task's line and its markers. Returns the same doc when there is nothing to remove. */
export function removeJob(doc: CrontabDoc, id: string | null | undefined, command?: string): CrontabDoc {
  const job = findJob(doc, id, command);
  if (!job) return doc;
  const next = clone(doc);
  const first = job.markerIdx.length ? job.markerIdx[0] : job.index;
  next.lines.splice(first, job.index - first + 1);
  if (next.lines.length === 0) next.trailingNewline = false;
  return next;
}

/** Cron needs a final newline; any text PiTasker writes gets one. */
export function withFinalNewline(text: string): string {
  return text === "" || text.endsWith("\n") ? text : `${text}\n`;
}
