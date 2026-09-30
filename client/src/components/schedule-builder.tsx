import { useId } from "react";
import { AlertCircle, CalendarClock } from "lucide-react";
import { describeCron, FIELDS, nextRuns, parseCron, PRESETS } from "@shared/cron";
import { Input } from "@/components/ui/input";
import { formatRunTime } from "@/lib/format";
import { cn } from "@/lib/utils";

const HINTS = ["0–59", "0–23", "1–31", "1–12 or jan–dec", "0–6 or sun–sat"];
const SHORT = ["Minute", "Hour", "Day", "Month", "Weekday"];

/** Presets + the expression + one input per field, with a live preview (description, next 3 runs, errors). */
export function ScheduleBuilder({
  value,
  onChange,
  timeZone,
  allowReboot,
}: {
  value: string;
  onChange: (v: string) => void;
  timeZone: string;
  allowReboot: boolean;
}) {
  const id = useId();
  const parsed = parseCron(value);
  const isMacro = value.trim().startsWith("@");
  const fields = isMacro ? null : value.trim().split(/\s+/);
  const five = fields && fields.length === 5 ? fields : null;
  const runs = parsed.ok ? nextRuns(value, timeZone, 3) : [];
  const rebootBlocked = parsed.ok && parsed.reboot && !allowReboot;

  const setField = (i: number, v: string) => {
    const cur = five ?? ["*", "*", "*", "*", "*"];
    const next = [...cur];
    next[i] = v.replace(/\s+/g, "") || "*";
    onChange(next.join(" "));
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Schedule presets">
        {PRESETS.filter((p) => allowReboot || p.expr !== "@reboot").map((p) => (
          <button
            key={p.expr}
            type="button"
            onClick={() => onChange(p.expr)}
            aria-pressed={value.trim() === p.expr}
            className={cn(
              "rounded-full border px-2.5 py-1 text-xs transition-colors",
              value.trim() === p.expr ? "border-pi-accent bg-pi-accent text-pi-on-accent" : "border-pi-border text-pi-text hover:bg-pi-card-hover",
            )}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div>
        <label htmlFor={`${id}-expr`} className="mb-1 block text-sm font-medium">
          Cron expression
        </label>
        <Input
          id={`${id}-expr`}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="*/5 * * * *"
          spellCheck={false}
          autoComplete="off"
          className="font-mono"
          aria-invalid={!parsed.ok || rebootBlocked}
          aria-describedby={`${id}-preview`}
          data-testid="cron-expr"
        />
      </div>

      {!isMacro && (
        <div className="grid grid-cols-5 gap-1.5">
          {FIELDS.map((f, i) => (
            <div key={f.name} className="min-w-0">
              <label htmlFor={`${id}-f${i}`} className="block truncate text-xs text-pi-text-muted" title={f.name}>
                {SHORT[i]}
              </label>
              <Input
                id={`${id}-f${i}`}
                value={five?.[i] ?? ""}
                onChange={(e) => setField(i, e.target.value)}
                placeholder="*"
                className="h-9 px-2 font-mono text-sm"
                spellCheck={false}
                autoComplete="off"
                title={HINTS[i]}
                aria-label={`${f.name} (${HINTS[i]})`}
              />
            </div>
          ))}
        </div>
      )}

      <div id={`${id}-preview`} aria-live="polite" className="rounded-md border border-pi-border bg-pi-darker p-3 text-sm" data-testid="cron-preview">
        {!parsed.ok ? (
          <p className="flex items-start gap-2 text-pi-error">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            {parsed.error}
          </p>
        ) : rebootBlocked ? (
          <p className="flex items-start gap-2 text-pi-error">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            @reboot runs when cron starts: choose the crontab as runner.
          </p>
        ) : (
          <>
            <p className="flex items-center gap-2 font-medium">
              <CalendarClock className="h-4 w-4 text-pi-accent-text" aria-hidden />
              {describeCron(value)} <span className="font-normal text-pi-text-muted">({timeZone})</span>
            </p>
            {runs.length > 0 && (
              <p className="mt-1 text-pi-text-muted">
                Next: {runs.map((r) => formatRunTime(r, timeZone)).join(" · ")}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
