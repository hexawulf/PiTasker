// One copyable line for bug reports (About → Diagnostics), like PiDeck's.
export type DiagnosticsInput = {
  version?: string;
  user?: string;
  hostname?: string;
  timeZone?: string;
  tasks?: { total: number; cron: number; pitasker: number };
  cronJournal?: boolean;
  rssMb?: number;
  theme?: string;
  viewport?: { width: number; height: number };
};

const or = (v: string | number | undefined) => (v === undefined || v === "" ? "?" : String(v));

export function diagnosticsLine(d: DiagnosticsInput): string {
  return [
    `PiTasker v${or(d.version)}`,
    d.user || d.hostname ? `${or(d.user)}@${or(d.hostname)}` : "?@?",
    or(d.timeZone),
    d.tasks ? `tasks ${d.tasks.total} (cron ${d.tasks.cron}, PiTasker ${d.tasks.pitasker})` : "tasks ?",
    `journal ${d.cronJournal === undefined ? "?" : d.cronJournal ? "on" : "off"}`,
    `RSS ${d.rssMb === undefined ? "?" : `${d.rssMb} MB`}`,
    or(d.theme),
    d.viewport ? `${d.viewport.width}×${d.viewport.height}` : "?",
  ].join(" · ");
}
