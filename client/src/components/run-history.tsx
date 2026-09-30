import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { TaskRun, TaskView } from "@shared/schema";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { RunStatusBadge } from "@/components/status";
import { useHostTimeZone } from "@/hooks/use-meta";
import { formatDateTime, formatDuration } from "@/lib/format";
import { cn } from "@/lib/utils";

type RunSummary = Pick<TaskRun, "id" | "status" | "startedAt" | "finishedAt" | "durationMs" | "exitCode" | "trigger">;

/** A task's runs (newest first) and the selected run's stdout / stderr. */
export function RunHistory({ task, onOpenChange }: { task: TaskView | null; onOpenChange: (o: boolean) => void }) {
  const tz = useHostTimeZone();
  const runs = useQuery<RunSummary[]>({
    queryKey: ["/api/tasks", task?.id ?? 0, "runs"],
    enabled: task !== null,
    refetchInterval: (q) => (q.state.data?.some((r) => r.status === "running") ? 2_000 : false),
  });
  const [selected, setSelected] = useState<number | null>(null);
  const [stream, setStream] = useState<"stdout" | "stderr">("stdout");
  useEffect(() => {
    if (runs.data?.length && (selected === null || !runs.data.some((r) => r.id === selected))) setSelected(runs.data[0].id);
  }, [runs.data, selected]);
  useEffect(() => {
    if (task === null) setSelected(null);
  }, [task]);
  const run = useQuery<TaskRun>({
    queryKey: ["/api/runs", selected ?? 0],
    enabled: selected !== null,
    refetchInterval: (q) => (q.state.data?.status === "running" ? 2_000 : false),
  });
  const text = run.data ? (stream === "stdout" ? run.data.stdout : run.data.stderr) : "";

  return (
    <Dialog open={task !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] w-[calc(100%-1rem)] max-w-4xl overflow-y-auto border-pi-border bg-pi-card p-4 text-pi-text sm:p-6" data-testid="run-history">
        <DialogHeader>
          <DialogTitle>Runs — {task?.name}</DialogTitle>
          <DialogDescription className="text-pi-text-muted">
            {task?.runner === "cron"
              ? "The crontab runs this task; PiTasker only sees the runs you start with Run now."
              : "Every run PiTasker started (newest 50 kept)."}
          </DialogDescription>
        </DialogHeader>
        {runs.data && runs.data.length === 0 && <p className="text-sm text-pi-text-muted">No runs recorded yet.</p>}
        {runs.data && runs.data.length > 0 && (
          <div className="grid gap-4 md:grid-cols-[minmax(0,16rem)_minmax(0,1fr)]">
            <ul className="max-h-[50vh] space-y-1 overflow-y-auto" aria-label="Runs">
              {runs.data.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => setSelected(r.id)}
                    aria-current={r.id === selected || undefined}
                    className={cn("w-full rounded-md border px-2 py-1.5 text-left text-xs", r.id === selected ? "border-pi-accent bg-pi-darker" : "border-pi-border hover:bg-pi-card-hover")}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <RunStatusBadge status={r.status} exitCode={r.exitCode} />
                      <span className="text-pi-text-muted">{formatDuration(r.durationMs)}</span>
                    </span>
                    <span className="mt-1 block text-pi-text-muted">
                      {formatDateTime(r.startedAt, tz)} · {r.trigger === "manual" ? "manual" : "scheduled"}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <div className="min-w-0">
              <div role="tablist" aria-label="Output stream" className="mb-2 flex gap-1">
                {(["stdout", "stderr"] as const).map((s) => (
                  <button key={s} role="tab" type="button" aria-selected={stream === s} onClick={() => setStream(s)} className={cn("tab-button", stream === s && "active")}>
                    {s}
                  </button>
                ))}
                {run.data?.truncated && <span className="ml-auto self-center text-xs text-pi-warning">output truncated (tail kept)</span>}
              </div>
              <pre className="max-h-[50vh] min-h-[8rem] overflow-auto whitespace-pre-wrap break-all rounded-md bg-pi-terminal-bg p-3 font-mono text-xs text-pi-terminal-text" data-testid="run-output" tabIndex={0}>
                {text || <span className="text-pi-terminal-muted">(empty)</span>}
              </pre>
              {run.data && (
                <p className="mt-2 text-xs text-pi-text-muted">
                  exit {run.data.exitCode ?? "—"}
                  {run.data.signal ? ` (${run.data.signal})` : ""} · {formatDuration(run.data.durationMs)} · finished {formatDateTime(run.data.finishedAt, tz)}
                </p>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
