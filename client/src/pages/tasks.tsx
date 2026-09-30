import { useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeftRight, History, Pencil, Play, Plus, Search, Trash2 } from "lucide-react";
import { describeCron, nextRuns } from "@shared/cron";
import type { TaskView } from "@shared/schema";
import { isCancelled, useCrontabWrite } from "@/components/diff-dialog";
import { RunHistory } from "@/components/run-history";
import { RunnerBadge, RunStatusBadge } from "@/components/status";
import { TaskEditor } from "@/components/task-editor";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useHostTimeZone } from "@/hooks/use-meta";
import { TASKS_KEY, useTasks } from "@/hooks/use-tasks";
import { useToast } from "@/hooks/use-toast";
import { useShortcutAction } from "@/shortcuts/use-shortcuts";
import { api, ApiError } from "@/lib/api";
import { formatDuration, formatRunTime, relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";

type RunnerFilter = "all" | "cron" | "pitasker";
type StatusFilter = "all" | "failing" | "ok" | "never" | "attention";

const selectCls = "h-10 rounded-md border border-pi-border bg-pi-input px-2 text-sm text-pi-text";
const iconBtn = "h-8 border-pi-border bg-transparent px-2 text-pi-text hover:bg-pi-card-hover";

function matchesStatus(t: TaskView, f: StatusFilter): boolean {
  const s = t.lastRunInfo?.status;
  switch (f) {
    case "failing":
      return s === "failed" || s === "timeout";
    case "ok":
      return s === "success";
    case "never":
      return !t.lastRunInfo;
    case "attention":
      return t.cronState === "missing" || t.cronState === "disabled" || s === "failed" || s === "timeout";
    default:
      return true;
  }
}

function LastRun({ task, tz }: { task: TaskView; tz: string }) {
  const r = task.lastRunInfo;
  const own = r && (
    <span className="flex flex-wrap items-center gap-1.5">
      <RunStatusBadge status={r.status} exitCode={r.exitCode} />
      <span title={new Date(r.startedAt).toLocaleString()}>{relativeTime(r.startedAt)}</span>
      {r.durationMs !== null && <span className="text-pi-text-muted">· {formatDuration(r.durationMs)}</span>}
      {r.trigger === "manual" && <span className="text-pi-text-muted">· manual</span>}
    </span>
  );
  if (task.runner === "pitasker") return own || <span className="text-pi-text-muted">never run</span>;
  return (
    <span className="flex flex-col gap-0.5">
      <span className="text-pi-text-muted">
        run by cron
        {task.cronSeen
          ? ` · ${task.cronSeen.source === "journal" ? "last started" : "log written"} ${relativeTime(task.cronSeen.at)}`
          : ""}
      </span>
      {own && <span className="text-xs">Run now: {own}</span>}
      {task.cronState === "missing" && <span className="text-pi-warning">No line in the crontab — cron does not run it.</span>}
      {task.cronState === "disabled" && <span className="text-pi-warning">Commented out in the crontab.</span>}
    </span>
  );
}

function TaskCard({
  task,
  tz,
  onEdit,
  onHistory,
  onDelete,
  onMove,
  onRun,
}: {
  task: TaskView;
  tz: string;
  onEdit: () => void;
  onHistory: () => void;
  onDelete: () => void;
  onMove: () => void;
  onRun: () => void;
}) {
  const runs = useMemo(() => nextRuns(task.cronSchedule, tz, 3), [task.cronSchedule, tz]);
  const running = task.lastRunInfo?.status === "running";
  return (
    <li className="min-w-0 rounded-xl border border-pi-border bg-pi-card p-4 shadow-sm" data-testid="task-card" data-task-id={task.id}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate font-semibold" title={task.name}>
            {task.name}
          </h3>
          <p className="mt-0.5 text-sm">
            <span className="font-medium">{describeCron(task.cronSchedule)}</span>{" "}
            <span className="text-pi-text-muted">
              {tz} · <code className="text-xs">{task.cronSchedule}</code>
            </span>
          </p>
        </div>
        <RunnerBadge task={task} />
      </div>
      <code className="mt-2 block truncate rounded bg-pi-darker px-2 py-1 font-mono text-xs" title={task.command}>
        {task.command}
      </code>
      <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
        <div>
          <div className="text-xs uppercase tracking-wide text-pi-text-muted">Last run</div>
          <LastRun task={task} tz={tz} />
        </div>
        <div>
          <div className="text-xs uppercase tracking-wide text-pi-text-muted">Next runs</div>
          {runs.length ? (
            <span data-testid="next-runs">{runs.map((d) => formatRunTime(d, tz)).join(" · ")}</span>
          ) : (
            <span className="text-pi-text-muted">{task.cronSchedule.trim() === "@reboot" ? "at the next boot" : "—"}</span>
          )}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        <Button variant="outline" size="sm" className={iconBtn} onClick={onRun} disabled={running} aria-label={`Run ${task.name} now`}>
          <Play /> Run now
        </Button>
        <Button variant="outline" size="sm" className={iconBtn} onClick={onHistory} aria-label={`Runs of ${task.name}`}>
          <History /> Runs
        </Button>
        <Button variant="outline" size="sm" className={iconBtn} onClick={onEdit} aria-label={`Edit ${task.name}`}>
          <Pencil /> Edit
        </Button>
        <Button
          variant="outline"
          size="sm"
          className={iconBtn}
          onClick={onMove}
          aria-label={task.runner === "cron" ? `Let PiTasker run ${task.name}` : `Let the crontab run ${task.name}`}
          title={task.runner === "cron" ? "Let PiTasker run it (removes the crontab line)" : "Let the crontab run it (adds a crontab line)"}
        >
          <ArrowLeftRight /> {task.runner === "cron" ? "To PiTasker" : "To crontab"}
        </Button>
        <Button variant="outline" size="sm" className={cn(iconBtn, "text-pi-error")} onClick={onDelete} aria-label={`Delete ${task.name}`}>
          <Trash2 />
        </Button>
      </div>
    </li>
  );
}

export default function TasksPage() {
  const tasks = useTasks();
  const tz = useHostTimeZone();
  const write = useCrontabWrite();
  const qc = useQueryClient();
  const { toast } = useToast();
  const searchRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [runner, setRunner] = useState<RunnerFilter>("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [editing, setEditing] = useState<TaskView | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [history, setHistory] = useState<TaskView | null>(null);
  const [deleting, setDeleting] = useState<TaskView | null>(null);
  const [keepLine, setKeepLine] = useState(false);
  const [busy, setBusy] = useState(false);

  const openNew = () => {
    setEditing(null);
    setEditorOpen(true);
  };
  useShortcutAction("new-task", openNew);
  useShortcutAction("search", () => searchRef.current?.focus());

  const refresh = () => qc.invalidateQueries({ queryKey: TASKS_KEY });
  const fail = (e: unknown) => {
    if (!isCancelled(e)) toast({ title: "Failed", description: (e as Error).message, variant: "destructive" });
  };

  const run = async (t: TaskView) => {
    try {
      await api("POST", `/api/tasks/${t.id}/run`);
      toast({ title: "Started", description: t.name });
      await refresh();
    } catch (e) {
      fail(e);
    }
  };

  const move = async (t: TaskView) => {
    const to = t.runner === "cron" ? "pitasker" : "cron";
    try {
      await write({
        method: "POST",
        url: `/api/tasks/${t.id}/runner`,
        body: { runner: to },
        title: to === "pitasker" ? `Let PiTasker run "${t.name}"` : `Let the crontab run "${t.name}"`,
        confirmLabel: "Write crontab",
      });
      toast({ title: to === "pitasker" ? "PiTasker runs it now" : "The crontab runs it now", description: t.name });
      await refresh();
    } catch (e) {
      fail(e);
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    const t = deleting;
    setBusy(true);
    setDeleting(null);
    try {
      await write({
        method: "DELETE",
        url: `/api/tasks/${t.id}${keepLine ? "?keepLine=1" : ""}`,
        title: `Delete "${t.name}"`,
        confirmLabel: "Remove line and delete",
        destructive: true,
      });
      toast({ title: "Task deleted", description: t.name });
      await refresh();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (tasks.data ?? []).filter(
      (t) =>
        (runner === "all" || t.runner === runner) &&
        matchesStatus(t, status) &&
        (!q || t.name.toLowerCase().includes(q) || t.command.toLowerCase().includes(q) || t.cronSchedule.includes(q)),
    );
  }, [tasks.data, query, runner, status]);

  const counts = useMemo(() => {
    const all = tasks.data ?? [];
    return {
      total: all.length,
      cron: all.filter((t) => t.runner === "cron").length,
      pitasker: all.filter((t) => t.runner === "pitasker").length,
      failing: all.filter((t) => matchesStatus(t, "failing")).length,
      attention: all.filter((t) => t.cronState === "missing" || t.cronState === "disabled").length,
    };
  }, [tasks.data]);

  return (
    <section aria-labelledby="tasks-heading" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="tasks-heading" className="text-2xl font-bold text-pi-text">
            Tasks
          </h2>
          <p className="text-sm text-pi-text-muted" data-testid="task-counts">
            {counts.total} tasks · {counts.cron} by cron · {counts.pitasker} by PiTasker
            {counts.failing ? ` · ${counts.failing} failing` : ""}
            {counts.attention ? ` · ${counts.attention} need attention` : ""}
          </p>
        </div>
        <Button onClick={openNew} className="bg-pi-accent text-pi-on-accent hover:bg-pi-accent-hover" data-testid="new-task">
          <Plus /> New task
        </Button>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center" role="search">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-pi-text-muted" aria-hidden />
          <Input ref={searchRef} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name, command, schedule  ( / )" aria-label="Search tasks" className="border-pi-border bg-pi-input pl-9 text-pi-text" data-testid="task-search" />
        </div>
        <div className="flex gap-2">
          <select aria-label="Runner" value={runner} onChange={(e) => setRunner(e.target.value as RunnerFilter)} className={cn(selectCls, "flex-1 sm:flex-none")} data-testid="filter-runner">
            <option value="all">All runners</option>
            <option value="cron">Crontab</option>
            <option value="pitasker">PiTasker</option>
          </select>
          <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)} className={cn(selectCls, "flex-1 sm:flex-none")} data-testid="filter-status">
            <option value="all">Any status</option>
            <option value="failing">Failing</option>
            <option value="ok">Last run ok</option>
            <option value="never">Never run by PiTasker</option>
            <option value="attention">Needs attention</option>
          </select>
        </div>
      </div>

      {tasks.isLoading && (
        <div className="space-y-3">
          <Skeleton className="h-36 w-full bg-pi-card" />
          <Skeleton className="h-36 w-full bg-pi-card" />
        </div>
      )}
      {tasks.isError && <p className="text-pi-error">Could not load tasks: {(tasks.error as ApiError).message}</p>}
      {tasks.data && list.length === 0 && (
        <p className="rounded-xl border border-dashed border-pi-border p-6 text-center text-pi-text-muted">
          {counts.total === 0 ? "No tasks yet. Import your crontab (Crontab tab) or create one." : "No task matches the filters."}
        </p>
      )}
      <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2" aria-label="Tasks">
        {list.map((t) => (
          <TaskCard
            key={t.id}
            task={t}
            tz={tz}
            onRun={() => run(t)}
            onEdit={() => {
              setEditing(t);
              setEditorOpen(true);
            }}
            onHistory={() => setHistory(t)}
            onMove={() => move(t)}
            onDelete={() => {
              setKeepLine(false);
              setDeleting(t);
            }}
          />
        ))}
      </ul>

      <TaskEditor open={editorOpen} onOpenChange={setEditorOpen} task={editing} />
      <RunHistory task={history} onOpenChange={(o) => !o && setHistory(null)} />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete "${deleting?.name ?? ""}"?`}
        destructive
        pending={busy}
        confirmLabel="Delete"
        onConfirm={confirmDelete}
        description={
          deleting?.runner === "cron" ? (
            <span className="block space-y-2">
              <span className="block">Its line is removed from the crontab (you will see the change first). Its run history is deleted.</span>
              <label className="flex items-center gap-2 text-pi-text">
                <input type="checkbox" checked={keepLine} onChange={(e) => setKeepLine(e.target.checked)} />
                Keep the crontab line (only forget the task in PiTasker)
              </label>
            </span>
          ) : (
            "PiTasker stops running it and its run history is deleted."
          )
        }
      />
    </section>
  );
}
