import { crontabService, CrontabEntry } from "./crontabService";
import { storage } from "../storage";
import { Task, InsertTask } from "@shared/schema";

export interface SyncResult {
  imported: number;
  updated: number;
  exported: number;
  failed: number;
  errors: string[];
}

export interface ImportResult {
  imported: number;
  updated: number;
  skipped: number;
  errors: string[];
}

export interface ValidationResult {
  isValid: boolean;
  discrepancies: Discrepancy[];
}

export interface Discrepancy {
  type: "missing_in_crontab" | "missing_in_db" | "schedule_mismatch" | "command_mismatch";
  taskId?: number;
  crontabId?: string;
  details: string;
}

export class CrontabSyncService {
  /**
   * Import crontab entries to database
   */
  async importFromCrontab(): Promise<ImportResult> {
    const result: ImportResult = {
      imported: 0,
      updated: 0,
      skipped: 0,
      errors: [],
    };

    try {
      const crontabEntries = await crontabService.readUserCrontab();
      
      for (const entry of crontabEntries) {
        try {
          // Check if this entry already exists in database
          const existingTask = await this.findTaskByCrontabId(entry.id);

          if (existingTask) {
            // Update if entry has changed
            const hasChanged = 
              existingTask.cronSchedule !== entry.schedule ||
              existingTask.command !== entry.command;

            if (hasChanged) {
              await storage.updateTask(existingTask.id, {
                cronSchedule: entry.schedule,
                command: entry.command,
                crontabSyncedAt: new Date(),
              });
              result.updated++;
            } else {
              result.skipped++;
            }
          } else {
            // Import as new task
            const newTask: InsertTask = {
              name: entry.comment || `Imported: ${entry.command.substring(0, 50)}`,
              cronSchedule: entry.schedule,
              command: entry.command,
            };

            const createdTask = await storage.createTask(newTask);
            
            // Update with crontab metadata
            await storage.updateTask(createdTask.id, {
              crontabId: entry.id,
              syncedToCrontab: true,
              crontabSyncedAt: new Date(),
              source: entry.isManaged ? "pitasker" : "crontab",
              isSystemManaged: true,
            });

            result.imported++;
          }
        } catch (error: any) {
          result.errors.push(`Failed to import entry ${entry.id}: ${error.message}`);
          result.skipped++;
        }
      }
    } catch (error: any) {
      result.errors.push(`Failed to read crontab: ${error.message}`);
    }

    return result;
  }

  /**
   * Export database tasks to crontab
   */
  async exportToCrontab(taskIds?: number[]): Promise<SyncResult> {
    const result: SyncResult = {
      imported: 0,
      updated: 0,
      exported: 0,
      failed: 0,
      errors: [],
    };

    try {
      // Get tasks to export
      let tasksToExport: Task[];
      if (taskIds && taskIds.length > 0) {
        tasksToExport = [];
        for (const id of taskIds) {
          const task = await storage.getTask(id);
          if (task) {
            tasksToExport.push(task);
          }
        }
      } else {
        const allTasks = await storage.getAllTasks();
        tasksToExport = allTasks.filter((t) => t.isSystemManaged);
      }

      // Read current crontab
      const currentCrontab = await crontabService.readUserCrontab();

      // Process each task
      for (const task of tasksToExport) {
        try {
          const entry: CrontabEntry = {
            id: task.crontabId || crontabService.generateId(),
            schedule: task.cronSchedule,
            command: task.command,
            comment: task.name,
            isManaged: true,
          };

          if (task.crontabId) {
            // Update existing entry
            await crontabService.updateCrontabEntry(task.crontabId, entry);
          } else {
            // Add new entry
            await crontabService.addCrontabEntry(entry);
            
            // Update task with crontab ID
            await storage.updateTask(task.id, {
              crontabId: entry.id,
            });
          }

          // Update sync status
          await storage.updateTask(task.id, {
            syncedToCrontab: true,
            crontabSyncedAt: new Date(),
          });

          result.exported++;
        } catch (error: any) {
          result.errors.push(`Failed to export task ${task.id}: ${error.message}`);
          result.failed++;
        }
      }
    } catch (error: any) {
      result.errors.push(`Export failed: ${error.message}`);
    }

    return result;
  }

  /**
   * Full bidirectional sync
   */
  async fullSync(): Promise<SyncResult> {
    const result: SyncResult = {
      imported: 0,
      updated: 0,
      exported: 0,
      failed: 0,
      errors: [],
    };

    try {
      // Step 1: Import from crontab
      const importResult = await this.importFromCrontab();
      result.imported = importResult.imported;
      result.updated = importResult.updated;
      result.errors.push(...importResult.errors);

      // Step 2: Export to crontab
      const exportResult = await this.exportToCrontab();
      result.exported = exportResult.exported;
      result.failed = exportResult.failed;
      result.errors.push(...exportResult.errors);
    } catch (error: any) {
      result.errors.push(`Full sync failed: ${error.message}`);
    }

    return result;
  }

  /**
   * Remove task from crontab
   */
  async removeFromCrontab(taskId: number): Promise<void> {
    const task = await storage.getTask(taskId);
    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }

    if (!task.crontabId) {
      throw new Error(`Task ${taskId} is not synced to crontab`);
    }

    try {
      await crontabService.removeCrontabEntry(task.crontabId);
      
      // Update database
      await storage.updateTask(taskId, {
        crontabId: null as any,
        syncedToCrontab: false,
        crontabSyncedAt: null as any,
      });
    } catch (error: any) {
      throw new Error(`Failed to remove from crontab: ${error.message}`);
    }
  }

  /**
   * Validate sync status
   */
  async validateSync(): Promise<ValidationResult> {
    const discrepancies: Discrepancy[] = [];

    try {
      // Get all tasks and crontab entries
      const tasks = await storage.getAllTasks();
      const crontabEntries = await crontabService.readUserCrontab();

      // Check tasks that should be in crontab
      for (const task of tasks.filter((t) => t.isSystemManaged)) {
        if (!task.crontabId) {
          discrepancies.push({
            type: "missing_in_crontab",
            taskId: task.id,
            details: `Task "${task.name}" (ID: ${task.id}) is marked as system-managed but has no crontab ID`,
          });
          continue;
        }

        const crontabEntry = crontabEntries.find((e) => e.id === task.crontabId);
        if (!crontabEntry) {
          discrepancies.push({
            type: "missing_in_crontab",
            taskId: task.id,
            crontabId: task.crontabId,
            details: `Task "${task.name}" (ID: ${task.id}) has crontab ID but entry not found in crontab`,
          });
          continue;
        }

        // Check for mismatches
        if (crontabEntry.schedule !== task.cronSchedule) {
          discrepancies.push({
            type: "schedule_mismatch",
            taskId: task.id,
            crontabId: task.crontabId,
            details: `Schedule mismatch: DB has "${task.cronSchedule}", crontab has "${crontabEntry.schedule}"`,
          });
        }

        if (crontabEntry.command !== task.command) {
          discrepancies.push({
            type: "command_mismatch",
            taskId: task.id,
            crontabId: task.crontabId,
            details: `Command mismatch: DB has "${task.command}", crontab has "${crontabEntry.command}"`,
          });
        }
      }

      // Check crontab entries that should be in database
      const managedCrontabEntries = crontabEntries.filter((e) => e.isManaged);
      for (const entry of managedCrontabEntries) {
        const task = await this.findTaskByCrontabId(entry.id);
        if (!task) {
          discrepancies.push({
            type: "missing_in_db",
            crontabId: entry.id,
            details: `Crontab entry "${entry.command}" (ID: ${entry.id}) not found in database`,
          });
        }
      }
    } catch (error: any) {
      discrepancies.push({
        type: "missing_in_crontab",
        details: `Validation error: ${error.message}`,
      });
    }

    return {
      isValid: discrepancies.length === 0,
      discrepancies,
    };
  }

  /**
   * Find task by crontab ID
   */
  private async findTaskByCrontabId(crontabId: string): Promise<Task | null> {
    const allTasks = await storage.getAllTasks();
    const task = allTasks.find((t) => t.crontabId === crontabId);
    return task || null;
  }
}

export const crontabSyncService = new CrontabSyncService();
