// Fleet page model: one flat list of rows from every host's snapshot, the
// filters (kept in the URL) and plain-language schedules. Pure functions.
import { describeCron } from "@shared/cron";
import type { Entry, FleetHost, FleetResponse, HintKind, Source, TimerSource } from "@shared/fleet";
import { entryKey, sourceGroup, sourceLabel, timerKey, type SourceGroup } from "@shared/fleet-view";

export type Row = {
  key: string;
  hostId: string;
  hostLabel: string;
  hostTz: string;
  hostLocal: boolean;
  /** Offline / auth-error / version-mismatch: shown from the saved snapshot, greyed. */
  hostDown: boolean;
  source: string;
  group: SourceGroup;
  /** "crontab" source of the hub's zk crontab (links to the Crontab tab). */
  editableHere: boolean;
  schedule: string;
  scheduleRaw: string;
  next: string | null;
  last: { at: string; source: string } | null;
  command: string;
  user: string | null;
  disabled: boolean;
  result: string | null;
  hints: { kind: HintKind; message: string }[];
};

export const UP = new Set(["online", "stale"]);

const RUN_PARTS_WHEN: Record<string, string> = {
  "cron.hourly": "hourly (run-parts)",
  "cron.daily": "daily (run-parts / anacron)",
  "cron.weekly": "weekly (run-parts / anacron)",
  "cron.monthly": "monthly (run-parts / anacron)",
};

/** systemd OnCalendar=/OnUnitActiveSec=… → short text ("daily 00:00", "every 15min"). */
export function describeTimer(spec: string): string {
  const eq = spec.indexOf("=");
  const key = spec.slice(0, eq);
  const v = spec.slice(eq + 1).trim();
  if (key === "OnUnitActiveSec" || key === "OnUnitInactiveSec") return `every ${v}`;
  if (key === "OnBootSec") return `${v} after boot`;
  if (key === "OnStartupSec") return `${v} after start`;
  if (key !== "OnCalendar") return spec;
  if (/^(minutely|hourly|daily|weekly|monthly|yearly|annually|quarterly|semiannually)$/.test(v)) return v;
  let m = /^\*-\*-\* (\d\d):(\d\d)(?::00)?$/.exec(v);
  if (m) return `daily ${m[1]}:${m[2]}`;
  m = /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)(?:\.\.(Mon|Tue|Wed|Thu|Fri|Sat|Sun))? \*-\*-\* (\d\d):(\d\d)(?::00)?$/.exec(v);
  if (m) return `${m[2] ? `${m[1]}–${m[2]}` : m[1]} ${m[3]}:${m[4]}`;
  m = /^\*-\*-\* (\d\d(?:,\d\d)+):(\d\d)(?::00)?$/.exec(v);
  if (m) return `daily at ${m[1].split(",").map((h) => `${h}:${m![2]}`).join(", ")}`;
  return v;
}

function entryRow(h: FleetHost, src: Source, e: Entry, hintsFor: (k: string) => Row["hints"]): Row {
  const key = entryKey(h.id, e.id);
  return {
    key,
    hostId: h.id,
    hostLabel: h.label,
    hostTz: e.env?.tz ?? h.tz ?? "UTC",
    hostLocal: h.local,
    hostDown: !UP.has(h.status),
    source: sourceLabel(src),
    group: sourceGroup(src),
    editableHere: h.local && src.kind === "crontab" && src.owner === "zk",
    schedule: e.schedule === "@reboot" ? "at boot" : describeCron(e.schedule),
    scheduleRaw: e.schedule,
    next: e.nextRuns[0] ?? null,
    last: e.lastRun ?? null,
    command: e.command,
    user: e.user ?? null,
    disabled: e.disabled,
    result: null,
    hints: hintsFor(key),
  };
}

function timerRow(h: FleetHost, t: TimerSource, hintsFor: (k: string) => Row["hints"]): Row {
  const key = timerKey(h.id, t);
  return {
    key,
    hostId: h.id,
    hostLabel: h.label,
    hostTz: h.tz ?? "UTC",
    hostLocal: h.local,
    hostDown: !UP.has(h.status),
    source: sourceLabel(t),
    group: "timer",
    editableHere: false,
    schedule: t.calendar.length ? t.calendar.map(describeTimer).join(" · ") : "(no schedule)",
    scheduleRaw: t.calendar.join("; "),
    next: t.next,
    last: t.last ? { at: t.last, source: "systemd" } : null,
    command: t.command ?? t.activates,
    user: t.user,
    disabled: false,
    result: t.result && t.result !== "success" ? `${t.result}${t.exitStatus ? ` (exit ${t.exitStatus})` : ""}` : t.last ? "ok" : null,
    hints: hintsFor(key),
  };
}

export function buildRows(data: FleetResponse): Row[] {
  const byTarget = new Map<string, Row["hints"]>();
  for (const hint of data.hints) {
    for (const t of hint.targets) byTarget.set(t, [...(byTarget.get(t) ?? []), { kind: hint.kind, message: hint.message }]);
  }
  const hintsFor = (k: string) => byTarget.get(k) ?? [];
  const rows: Row[] = [];
  for (const h of data.hosts) {
    for (const src of h.snapshot?.sources ?? []) {
      if (src.kind === "crontab" || src.kind === "etc-crontab" || src.kind === "cron.d") for (const e of src.entries) rows.push(entryRow(h, src, e, hintsFor));
      else if (src.kind === "timer") rows.push(timerRow(h, src, hintsFor));
      else if (src.kind === "run-parts") {
        for (const script of src.scripts) {
          rows.push({
            key: `${h.id}:${src.dir}:${script}`,
            hostId: h.id,
            hostLabel: h.label,
            hostTz: h.tz ?? "UTC",
            hostLocal: h.local,
            hostDown: !UP.has(h.status),
            source: src.dir,
            group: "system",
            editableHere: false,
            schedule: RUN_PARTS_WHEN[src.dir] ?? src.dir,
            scheduleRaw: src.dir,
            next: null,
            last: null,
            command: `/etc/${src.dir}/${script}`,
            user: "root",
            disabled: false,
            result: null,
            hints: [],
          });
        }
      }
    }
  }
  return rows;
}

// ─── filters (URL query) ───────────────────────────────────────────────────

export type View = "hosts" | "jobs";
export type Filters = { view: View; host: string; source: SourceGroup | ""; hint: HintKind | ""; q: string };

const SOURCES = new Set(["zk", "root", "system", "timer"]);
const HINTS = new Set(["same-job", "not-in-bin", "bin-differs", "disabled"]);

export function parseFilters(search: string): Filters {
  const p = new URLSearchParams(search);
  const source = p.get("source") ?? "";
  const hint = p.get("hint") ?? "";
  return {
    view: p.get("view") === "jobs" ? "jobs" : "hosts",
    host: (p.get("host") ?? "").slice(0, 32),
    source: SOURCES.has(source) ? (source as SourceGroup) : "",
    hint: HINTS.has(hint) ? (hint as HintKind) : "",
    q: (p.get("q") ?? "").slice(0, 200),
  };
}

export function filtersToSearch(f: Filters): string {
  const p = new URLSearchParams();
  if (f.view !== "hosts") p.set("view", f.view);
  if (f.host) p.set("host", f.host);
  if (f.source) p.set("source", f.source);
  if (f.hint) p.set("hint", f.hint);
  if (f.q) p.set("q", f.q);
  const s = p.toString();
  return s ? `?${s}` : "";
}

export function applyFilters(rows: Row[], f: Filters, hostsWithBinHint: Set<string>): Row[] {
  const q = f.q.trim().toLowerCase();
  return rows.filter(
    (r) =>
      (!f.host || r.hostId === f.host) &&
      (!f.source || r.group === f.source) &&
      (!f.hint || (f.hint === "bin-differs" ? hostsWithBinHint.has(r.hostId) : r.hints.some((h) => h.kind === f.hint))) &&
      (!q || r.command.toLowerCase().includes(q) || r.schedule.toLowerCase().includes(q) || r.scheduleRaw.toLowerCase().includes(q) || r.source.toLowerCase().includes(q)),
  );
}

export const HINT_LABEL: Record<HintKind, string> = {
  "same-job": "on 2+ hosts",
  "not-in-bin": "not in bin.git",
  "bin-differs": "bin differs",
  disabled: "disabled",
};
