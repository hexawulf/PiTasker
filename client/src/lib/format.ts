// Small display helpers (no date library: Intl does it).

export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "—";
  if (ms < 1000) return `${ms} ms`;
  const s = ms / 1000;
  if (s < 60) return `${s < 10 ? s.toFixed(1) : Math.round(s)} s`;
  const m = Math.floor(s / 60);
  const rest = Math.round(s % 60);
  if (m < 60) return rest ? `${m} min ${rest} s` : `${m} min`;
  const h = Math.floor(m / 60);
  return `${h} h ${m % 60} min`;
}

export function relativeTime(date: string | Date | null | undefined, now = Date.now()): string {
  if (!date) return "never";
  const t = new Date(date).getTime();
  if (Number.isNaN(t)) return "—";
  const diff = Math.round((t - now) / 1000);
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  if (abs < 45) return "just now"; // either side: DB and browser clocks differ by a little
  if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), "hour");
  return rtf.format(Math.round(diff / 86400), "day");
}

/** "Tue 07:04" (this week) or "Oct 3, 07:04", in the host's zone. */
export function formatRunTime(date: Date | string, timeZone: string): string {
  const d = new Date(date);
  const soon = Math.abs(d.getTime() - Date.now()) < 6 * 86400_000;
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hourCycle: "h23",
    hour: "2-digit",
    minute: "2-digit",
    ...(soon ? { weekday: "short" } : { month: "short", day: "numeric" }),
  }).format(d);
}

export function formatDateTime(date: Date | string | null | undefined, timeZone?: string): string {
  if (!date) return "—";
  return new Intl.DateTimeFormat("en-GB", { timeZone, dateStyle: "medium", timeStyle: "medium", hourCycle: "h23" }).format(new Date(date));
}
