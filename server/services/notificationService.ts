import type { Task } from "@shared/schema";

// Server-side: one log line per finished run (pm2 logs pitasker). The browser
// shows its own notifications from the task list (client/src/lib/notify.ts).
export class NotificationService {
  async sendTaskNotification(task: Task, status: string, output: string): Promise<void> {
    const mark = status === "success" ? "ok" : "FAILED";
    const tail = output ? ` — ${output.replace(/\s+/g, " ").slice(0, 200)}` : "";
    console.log(`[run] task ${task.id} "${task.name}" ${mark} at ${new Date().toISOString()}${tail}`);
  }
}
