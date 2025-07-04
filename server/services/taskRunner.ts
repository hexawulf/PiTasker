import { exec } from "child_process";
import { DateTime } from "luxon";
import { Task } from "@shared/schema";
import { storage } from "../storage";
import { NotificationService } from "./notificationService";

export class TaskRunner {
  private runningTasks: Set<number> = new Set();
  private notificationService: NotificationService;

  constructor() {
    this.notificationService = new NotificationService();
  }

  async runTask(task: Task): Promise<void> {
    if (this.runningTasks.has(task.id)) {
      console.log(`Task ${task.id} is already running`);
      return;
    }

    this.runningTasks.add(task.id);

    try {
      // Update task status to running with UTC timestamp
      const startTime = DateTime.utc().toJSDate();
      await storage.updateTask(task.id, {
        status: "running",
        lastRun: startTime,
      });

      console.log(`Executing task ${task.id}: ${task.command}`);

      // Execute the command
      exec(task.command, { timeout: 300000 }, async (error, stdout, stderr) => {
        this.runningTasks.delete(task.id);

        const output = stdout || stderr || "";
        const isSuccess = !error;
        const status = isSuccess ? "success" : "failed";

        try {
          // Update task with results
          await storage.updateTask(task.id, {
            status,
            output: output.slice(0, 10000), // Limit output size
          });

          // Send notification
          await this.notificationService.sendTaskNotification(task, status, output);

          console.log(`Task ${task.id} completed with status: ${status}`);
        } catch (updateError) {
          console.error(`Error updating task ${task.id} after execution:`, updateError);
        }
      });
    } catch (error) {
      this.runningTasks.delete(task.id);
      console.error(`Error starting task ${task.id}:`, error);

      // Update task status to failed
      try {
        const errorMessage = error instanceof Error ? error.message : String(error);
        await storage.updateTask(task.id, {
          status: "failed",
          output: `Error starting task: ${errorMessage}`,
        });

        // Send failure notification
        await this.notificationService.sendTaskNotification(task, "failed", errorMessage);
      } catch (updateError) {
        console.error(`Error updating task ${task.id} after start failure:`, updateError);
      }
    }
  }

  isTaskRunning(taskId: number): boolean {
    return this.runningTasks.has(taskId);
  }

  getRunningTasksCount(): number {
    return this.runningTasks.size;
  }
}
