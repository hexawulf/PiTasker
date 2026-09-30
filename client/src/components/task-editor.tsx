import { useEffect, useId, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Loader2 } from "lucide-react";
import { parseCron } from "@shared/cron";
import type { TaskView } from "@shared/schema";
import { isCancelled, useCrontabWrite } from "@/components/diff-dialog";
import { ScheduleBuilder } from "@/components/schedule-builder";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useHostTimeZone, useMeta } from "@/hooks/use-meta";
import { TASKS_KEY } from "@/hooks/use-tasks";
import { useToast } from "@/hooks/use-toast";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

type ScriptWarning = { code: string; message: string };

/** Debounced check of the command against the bin.git rule (server: /api/scripts/check). */
function useScriptWarnings(command: string): ScriptWarning[] {
  const [warnings, setWarnings] = useState<ScriptWarning[]>([]);
  useEffect(() => {
    const cmd = command.trim();
    if (!cmd) {
      setWarnings([]);
      return;
    }
    const t = setTimeout(() => {
      api<{ warnings: ScriptWarning[] }>("GET", `/api/scripts/check?command=${encodeURIComponent(cmd)}`)
        .then((r) => setWarnings(r.warnings))
        .catch(() => setWarnings([]));
    }, 400);
    return () => clearTimeout(t);
  }, [command]);
  return warnings;
}

/** Create or edit a task: name, command, runner, schedule (builder + preview). */
export function TaskEditor({ open, onOpenChange, task }: { open: boolean; onOpenChange: (o: boolean) => void; task: TaskView | null }) {
  const id = useId();
  const tz = useHostTimeZone();
  const binDir = useMeta().data?.binDir ?? "/home/zk/bin";
  const write = useCrontabWrite();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [command, setCommand] = useState("");
  const [schedule, setSchedule] = useState("*/5 * * * *");
  const [runner, setRunner] = useState<"cron" | "pitasker">("cron");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const warnings = useScriptWarnings(command);

  useEffect(() => {
    if (!open) return;
    setName(task?.name ?? "");
    setCommand(task?.command ?? "");
    setSchedule(task?.cronSchedule ?? "*/5 * * * *");
    setRunner(task?.runner ?? "cron");
    setError(null);
  }, [open, task]);

  const parsed = parseCron(schedule);
  const scheduleOk = parsed.ok && !(parsed.reboot && runner === "pitasker");
  const valid = name.trim() !== "" && command.trim() !== "" && !/[\r\n]/.test(command) && scheduleOk;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    setSaving(true);
    setError(null);
    try {
      if (task) {
        const patch: Record<string, string> = {};
        if (name.trim() !== task.name) patch.name = name.trim();
        if (command.trim() !== task.command) patch.command = command.trim();
        if (schedule.trim() !== task.cronSchedule) patch.cronSchedule = schedule.trim();
        if (Object.keys(patch).length) {
          await write({ method: "PATCH", url: `/api/tasks/${task.id}`, body: patch, title: `Save "${name.trim()}"`, confirmLabel: "Write crontab" });
        }
        if (runner !== task.runner) {
          await write({
            method: "POST",
            url: `/api/tasks/${task.id}/runner`,
            body: { runner },
            title: runner === "cron" ? "Hand the task to the crontab" : "Take the task out of the crontab",
            confirmLabel: "Write crontab",
          });
        }
        toast({ title: "Task saved" });
      } else {
        await write({
          method: "POST",
          url: "/api/tasks",
          body: { name: name.trim(), command: command.trim(), cronSchedule: schedule.trim(), isSystemManaged: runner === "cron" },
          title: `Add "${name.trim()}" to the crontab`,
          confirmLabel: "Write crontab",
        });
        toast({ title: "Task created" });
      }
      await qc.invalidateQueries({ queryKey: TASKS_KEY });
      onOpenChange(false);
    } catch (err) {
      if (!isCancelled(err)) setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !saving && onOpenChange(o)}>
      <DialogContent className="max-h-[92vh] w-[calc(100%-1rem)] max-w-2xl overflow-y-auto border-pi-border bg-pi-card p-4 text-pi-text sm:p-6" data-testid="task-editor">
        <DialogHeader>
          <DialogTitle>{task ? "Edit task" : "New task"}</DialogTitle>
          <DialogDescription className="text-pi-text-muted">
            A task runs from your crontab <em>or</em> from PiTasker — never both.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={save} className="space-y-4">
          <div>
            <label htmlFor={`${id}-name`} className="mb-1 block text-sm font-medium">Name</label>
            <Input id={`${id}-name`} value={name} onChange={(e) => setName(e.target.value)} maxLength={100} required data-testid="task-name" />
          </div>
          <div>
            <label htmlFor={`${id}-cmd`} className="mb-1 block text-sm font-medium">Command</label>
            <Input
              id={`${id}-cmd`}
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              maxLength={1000}
              required
              spellCheck={false}
              autoComplete="off"
              className="font-mono"
              placeholder={`${binDir}/my-job >> /home/zk/logs/my-job.log 2>&1`}
              aria-describedby={`${id}-cmd-help`}
              data-testid="task-command"
            />
            <p id={`${id}-cmd-help`} className="mt-1 text-xs text-pi-text-muted">
              Crontab syntax: a literal % is written <code>\%</code> (an unescaped % starts the job's input).
            </p>
            {warnings.length > 0 && (
              <ul className="mt-2 space-y-1" data-testid="script-warnings">
                {warnings.map((w) => (
                  <li key={w.code} className="flex items-start gap-2 rounded-md border border-pi-warning bg-pi-warning-soft px-2 py-1 text-xs text-pi-text">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-pi-warning" aria-hidden />
                    {w.message}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <fieldset>
            <legend className="mb-1 text-sm font-medium">Runs from</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {(
                [
                  ["cron", "The crontab", "cron runs it; PiTasker keeps the line in sync"],
                  ["pitasker", "PiTasker", "PiTasker's scheduler runs it and records every run"],
                ] as const
              ).map(([value, label, help]) => (
                <label
                  key={value}
                  className={cn(
                    "flex cursor-pointer items-start gap-2 rounded-md border p-3 text-sm",
                    runner === value ? "border-pi-accent bg-pi-darker" : "border-pi-border hover:bg-pi-card-hover",
                  )}
                >
                  <input type="radio" name={`${id}-runner`} value={value} checked={runner === value} onChange={() => setRunner(value)} className="mt-1" data-testid={`runner-${value}`} />
                  <span>
                    <span className="block font-medium">{label}</span>
                    <span className="text-xs text-pi-text-muted">{help}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend className="mb-2 text-sm font-medium">Schedule</legend>
            <ScheduleBuilder value={schedule} onChange={setSchedule} timeZone={tz} allowReboot={runner === "cron"} />
          </fieldset>

          {error && (
            <p role="alert" className="rounded-md border border-pi-error bg-pi-error-soft px-3 py-2 text-sm text-pi-text">
              {error}
            </p>
          )}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" className="border-pi-border bg-transparent text-pi-text hover:bg-pi-card-hover" onClick={() => onOpenChange(false)} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" disabled={!valid || saving} className="bg-pi-accent text-pi-on-accent hover:bg-pi-accent-hover" data-testid="task-save">
              {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              {task ? "Save" : "Create task"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
