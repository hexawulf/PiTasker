import { CheckCircle2, CircleSlash, Clock, Loader2, Server, TerminalSquare, XCircle } from "lucide-react";
import type { TaskView } from "@shared/schema";
import { cn } from "@/lib/utils";

const pill = "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap";

export function RunStatusBadge({ status, exitCode }: { status: string; exitCode?: number | null }) {
  switch (status) {
    case "success":
      return (
        <span className={cn(pill, "status-online")}>
          <CheckCircle2 className="h-3 w-3" aria-hidden /> ok
        </span>
      );
    case "running":
      return (
        <span className={cn(pill, "bg-pi-darker text-pi-accent-text")}>
          <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> running
        </span>
      );
    case "timeout":
      return (
        <span className={cn(pill, "status-restart")}>
          <Clock className="h-3 w-3" aria-hidden /> timeout
        </span>
      );
    case "interrupted":
      return (
        <span className={cn(pill, "status-restart")}>
          <CircleSlash className="h-3 w-3" aria-hidden /> interrupted
        </span>
      );
    default:
      return (
        <span className={cn(pill, "status-offline")}>
          <XCircle className="h-3 w-3" aria-hidden /> {exitCode !== null && exitCode !== undefined ? `exit ${exitCode}` : "failed"}
        </span>
      );
  }
}

/** Who runs the task: the crontab or PiTasker. */
export function RunnerBadge({ task }: { task: Pick<TaskView, "runner" | "cronState"> }) {
  if (task.runner === "pitasker") {
    return (
      <span className={cn(pill, "border border-pi-accent text-pi-accent-text")} title="PiTasker's scheduler runs this task">
        <Server className="h-3 w-3" aria-hidden /> PiTasker
      </span>
    );
  }
  const warn = task.cronState === "missing" || task.cronState === "disabled";
  return (
    <span
      className={cn(pill, "border", warn ? "border-pi-warning text-pi-warning" : "border-pi-border text-pi-text")}
      title={task.cronState === "missing" ? "No line in the crontab: cron does not run it" : task.cronState === "disabled" ? "Commented out in the crontab" : "The crontab runs this task"}
    >
      <TerminalSquare className="h-3 w-3" aria-hidden /> cron{task.cronState === "missing" ? " · missing" : task.cronState === "disabled" ? " · disabled" : ""}
    </span>
  );
}
