import cron from "node-cron";
import { Task } from "@shared/schema";
import { TaskRunner } from "./taskRunner";

export class TaskScheduler {
  private scheduledTasks: Map<number, cron.ScheduledTask> = new Map();
  private taskRunner: TaskRunner;

  constructor() {
    this.taskRunner = new TaskRunner();
  }

  scheduleTask(task: Task): void {
    try {
      // Validate cron expression
      if (!cron.validate(task.cronSchedule)) {
        console.error(`Invalid cron schedule for task ${task.id}: ${task.cronSchedule}`);
        return;
      }

      // Unschedule existing task if it exists
      this.unscheduleTask(task.id);

      // Schedule new task
      const scheduledTask = cron.schedule(task.cronSchedule, () => {
        console.log(`Running scheduled task: ${task.name} (ID: ${task.id})`);
        this.taskRunner.runTask(task);
      }, {
        scheduled: true,
        timezone: "UTC"
      });

      this.scheduledTasks.set(task.id, scheduledTask);
      console.log(`Scheduled task: ${task.name} (ID: ${task.id}) with schedule: ${task.cronSchedule}`);
    } catch (error) {
      console.error(`Error scheduling task ${task.id}:`, error);
    }
  }

  unscheduleTask(taskId: number): void {
    const scheduledTask = this.scheduledTasks.get(taskId);
    if (scheduledTask) {
      scheduledTask.stop();
      scheduledTask.destroy();
      this.scheduledTasks.delete(taskId);
      console.log(`Unscheduled task ID: ${taskId}`);
    }
  }

  getScheduledTasksCount(): number {
    return this.scheduledTasks.size;
  }

  stopAllTasks(): void {
    for (const [taskId, scheduledTask] of this.scheduledTasks) {
      scheduledTask.stop();
      scheduledTask.destroy();
    }
    this.scheduledTasks.clear();
    console.log("Stopped all scheduled tasks");
  }
}
