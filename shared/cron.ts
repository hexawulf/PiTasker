// Cron expressions as Vixie/Debian cron reads them — shared by the server
// (validation, the internal scheduler's guard) and the client (editor preview,
// task list). No dependencies: the client bundle carries it.
//
//   "m h dom mon dow"  five fields, or one of MACROS ("@daily" …)
//   field item:  *   */n   a   a-b   a-b/n        (lists: item,item)
//   names:       jan–dec (month), sun–sat (dow), single or in ranges
//   dow 7 = 0 (Sunday)
//   day rule:    dom and dow both restricted → a day matches if EITHER matches
//
// Everything here is pure; time zones go through Intl (no luxon on the client).

export const MACROS: Record<string, string | null> = {
  "@reboot": null, // no time: runs when cron starts
  "@yearly": "0 0 1 1 *",
  "@annually": "0 0 1 1 *",
  "@monthly": "0 0 1 * *",
  "@weekly": "0 0 * * 0",
  "@daily": "0 0 * * *",
  "@midnight": "0 0 * * *",
  "@hourly": "0 * * * *",
};

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

type FieldSpec = { name: string; min: number; max: number; names?: string[]; namesBase?: number };
export const FIELDS: FieldSpec[] = [
  { name: "minute", min: 0, max: 59 },
  { name: "hour", min: 0, max: 23 },
  { name: "day of month", min: 1, max: 31 },
  { name: "month", min: 1, max: 12, names: MONTHS, namesBase: 1 },
  { name: "day of week", min: 0, max: 7, names: DAYS, namesBase: 0 },
];

export type ParsedField = { values: Set<number>; star: boolean; source: string };
export type ParsedCron =
  | { ok: true; macro: string | null; reboot: boolean; fields: ParsedField[] | null; expr: string }
  | { ok: false; error: string };

function parseValue(s: string, spec: FieldSpec): number | null {
  if (/^\d+$/.test(s)) return Number(s);
  if (spec.names) {
    const i = spec.names.indexOf(s.toLowerCase());
    if (i >= 0) return i + (spec.namesBase ?? 0);
  }
  return null;
}

export function parseField(src: string, spec: FieldSpec): ParsedField | string {
  const values = new Set<number>();
  if (src === "") return `${spec.name}: empty`;
  for (const item of src.split(",")) {
    const m = /^([^/]+)(?:\/(\d+))?$/.exec(item);
    if (!m) return `${spec.name}: "${item}" is not valid`;
    const [, range, stepStr] = m;
    const step = stepStr === undefined ? 1 : Number(stepStr);
    if (step < 1) return `${spec.name}: step must be ≥ 1`;
    let lo: number;
    let hi: number;
    if (range === "*") {
      lo = spec.min;
      hi = spec.name === "day of week" ? 6 : spec.max;
    } else {
      const parts = range.split("-");
      if (parts.length > 2) return `${spec.name}: "${range}" is not a range`;
      const a = parseValue(parts[0], spec);
      const b = parts.length === 2 ? parseValue(parts[1], spec) : a;
      if (a === null || b === null) return `${spec.name}: "${range}" is not a number`;
      // "5/10" (a value with a step) is rejected by Vixie cron; so do we.
      if (parts.length === 1 && stepStr !== undefined) return `${spec.name}: a step needs * or a range ("${item}")`;
      lo = a;
      hi = b;
    }
    if (lo < spec.min || hi > spec.max) return `${spec.name}: ${range} is outside ${spec.min}–${spec.max}`;
    if (lo > hi) return `${spec.name}: range ${range} runs backwards`;
    for (let v = lo; v <= hi; v += step) values.add(spec.name === "day of week" && v === 7 ? 0 : v);
  }
  return { values, star: src === "*" || /^\*\/1$/.test(src), source: src };
}

export function parseCron(expr: string): ParsedCron {
  const e = expr.trim();
  if (e === "") return { ok: false, error: "The schedule is empty" };
  if (e.startsWith("@")) {
    const key = e.toLowerCase();
    if (!(key in MACROS)) return { ok: false, error: `Unknown macro ${e} (use ${Object.keys(MACROS).join(", ")})` };
    const five = MACROS[key];
    if (five === null) return { ok: true, macro: key, reboot: true, fields: null, expr: e };
    const inner = parseCron(five);
    return inner.ok ? { ...inner, macro: key, expr: e } : inner;
  }
  const parts = e.split(/\s+/);
  if (parts.length !== 5) return { ok: false, error: `Expected 5 fields (minute hour day month weekday), got ${parts.length}` };
  const fields: ParsedField[] = [];
  for (let i = 0; i < 5; i++) {
    const f = parseField(parts[i], FIELDS[i]);
    if (typeof f === "string") return { ok: false, error: f };
    fields.push(f);
  }
  return { ok: true, macro: null, reboot: false, fields, expr: e };
}

export function isValidCron(expr: string): boolean {
  return parseCron(expr).ok;
}

/** The five-field form node-cron understands (macros expanded); null for @reboot/invalid. */
export function toFiveFields(expr: string): string | null {
  const e = expr.trim();
  if (e.startsWith("@")) return MACROS[e.toLowerCase()] ?? null;
  return isValidCron(e) ? e.split(/\s+/).join(" ") : null;
}

// ─── Time zones (Intl) ─────────────────────────────────────────────────────

type Wall = { year: number; month: number; day: number; hour: number; minute: number; dow: number };
const fmtCache = new Map<string, Intl.DateTimeFormat>();
function formatter(tz: string) {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      weekday: "short",
    });
    fmtCache.set(tz, f);
  }
  return f;
}

export function isValidTimeZone(tz: string): boolean {
  try {
    formatter(tz);
    return true;
  } catch {
    return false;
  }
}

export function wallClock(date: Date, tz: string): Wall {
  const parts: Record<string, string> = {};
  for (const p of formatter(tz).formatToParts(date)) parts[p.type] = p.value;
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
    dow: DAY_LABELS.indexOf(parts.weekday),
  };
}

function dayMatches(f: ParsedField[], w: Wall): boolean {
  const [, , dom, , dow] = f;
  const domOk = dom.values.has(w.day);
  const dowOk = dow.values.has(w.dow);
  if (!dom.star && !dow.star) return domOk || dowOk;
  return domOk && dowOk;
}

/** The next `count` run times strictly after `from`, in the host's zone `tz`. [] for @reboot/invalid. */
export function nextRuns(expr: string, tz: string, count = 3, from: Date = new Date()): Date[] {
  const p = parseCron(expr);
  if (!p.ok || !p.fields) return [];
  const f = p.fields;
  const out: Date[] = [];
  const MIN = 60_000;
  let t = Math.floor(from.getTime() / MIN) * MIN + MIN;
  let lastWall = "";
  // Bounded: a day-level skip is ≤ 1 step/day, so 5 years of days + hours + minutes.
  for (let guard = 0; guard < 200_000 && out.length < count; guard++) {
    const w = wallClock(new Date(t), tz);
    if (!f[3].values.has(w.month) || !dayMatches(f, w)) {
      t += ((24 - w.hour) * 60 - w.minute) * MIN; // next local midnight
      continue;
    }
    if (!f[1].values.has(w.hour)) {
      t += (60 - w.minute) * MIN;
      continue;
    }
    if (!f[0].values.has(w.minute)) {
      t += MIN;
      continue;
    }
    // A repeated wall-clock hour (DST ends) runs once, as in cron.
    const key = `${w.year}-${w.month}-${w.day} ${w.hour}:${w.minute}`;
    if (key !== lastWall) out.push(new Date(t));
    lastWall = key;
    t += MIN;
  }
  return out;
}

// ─── Plain language ────────────────────────────────────────────────────────

const pad = (n: number) => String(n).padStart(2, "0");
const sorted = (s: Set<number>) => [...s].sort((a, b) => a - b);

function stepOf(src: string): number | null {
  const m = /^\*\/(\d+)$/.exec(src);
  return m ? Number(m[1]) : null;
}

function single(f: ParsedField): number | null {
  return f.values.size === 1 && !f.star ? [...f.values][0] : null;
}

function daysLabel(dow: ParsedField): string {
  const v = sorted(dow.values).join(",");
  if (v === "1,2,3,4,5") return "weekdays";
  if (v === "0,6") return "weekends";
  return sorted(dow.values).map((d) => DAY_LABELS[d]).join(", ");
}

/**
 * "every 5 min", "hourly at :15", "daily 07:04", "weekdays 08:00",
 * "Mon 03:00", "monthly on the 1st 00:00", "at boot" … Falls back to the
 * expression itself when no short phrase is exact.
 */
export function describeCron(expr: string): string {
  const p = parseCron(expr);
  if (!p.ok) return "invalid schedule";
  if (p.reboot) return "at boot";
  const [mi, hr, dom, mon, dow] = p.fields!;
  const allDays = dom.star && mon.star && dow.star;
  const m1 = single(mi);
  const hours = hr.star ? null : sorted(hr.values);
  const at = (h: number[]) => h.map((x) => `${pad(x)}:${pad(m1!)}`).join(", ");

  if (allDays) {
    if (mi.star && hr.star) return "every minute";
    const ms = stepOf(mi.source);
    if (ms !== null && hr.star) return `every ${ms} min`;
    if (m1 !== null && hr.star) return m1 === 0 ? "hourly" : `hourly at :${pad(m1)}`;
    const hs = stepOf(hr.source);
    if (m1 !== null && hs !== null) return `every ${hs} h at :${pad(m1)}`;
    if (m1 !== null && hours) return `daily ${at(hours)}`;
    if (hours && mi.values.size > 1 && !mi.star) return `daily at ${hours.map(pad).join(", ")}h, min ${sorted(mi.values).join(",")}`;
  }
  if (m1 !== null && hours && hours.length <= 4) {
    if (dom.star && mon.star && !dow.star) return `${daysLabel(dow)} ${at(hours)}`;
    const d1 = single(dom);
    if (d1 !== null && mon.star && dow.star) return `monthly on day ${d1} at ${at(hours)}`;
    const mo = single(mon);
    if (d1 !== null && mo !== null && dow.star) return `yearly on ${MONTH_LABELS[mo - 1]} ${d1} at ${at(hours)}`;
  }
  if (dom.star && mon.star && !dow.star && stepOf(mi.source) !== null && hr.star) {
    return `every ${stepOf(mi.source)} min on ${daysLabel(dow)}`;
  }
  return p.expr;
}

/** Common schedules for the editor. */
export const PRESETS: { label: string; expr: string }[] = [
  { label: "Every 5 minutes", expr: "*/5 * * * *" },
  { label: "Every 15 minutes", expr: "*/15 * * * *" },
  { label: "Hourly", expr: "0 * * * *" },
  { label: "Daily 03:00", expr: "0 3 * * *" },
  { label: "Weekdays 08:00", expr: "0 8 * * 1-5" },
  { label: "Weekly (Sun 04:00)", expr: "0 4 * * 0" },
  { label: "Monthly (1st, 05:00)", expr: "0 5 1 * *" },
  { label: "At boot", expr: "@reboot" },
];
