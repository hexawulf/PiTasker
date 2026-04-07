import fs from 'fs';
import path from 'path';
import { DateTime } from 'luxon';
import { z } from 'zod';

export const LOG_DIR = '/home/zk/logs/pitasker';
export const LOG_PATTERN = /^([\w.-]+)-(\d{4}-\d{2}-\d{2})\.log$/;

const envSchema = z.object({
  LOG_RETENTION_DAYS: z.coerce.number().positive().default(7),
  LOG_CLEANUP_DRY_RUN: z.preprocess((val) => val === 'true', z.boolean()).default(false),
});

export class LogRetentionService {
  private retentionDays: number;
  private dryRun: boolean;

  constructor() {
    const rawRetention = process.env.LOG_RETENTION_DAYS;
    if (rawRetention !== undefined && (isNaN(Number(rawRetention)) || Number(rawRetention) <= 0)) {
        console.warn(`[LOG-CLEANUP] Invalid LOG_RETENTION_DAYS "${rawRetention}", falling back to 7`);
    }

    const config = envSchema.parse({
      LOG_RETENTION_DAYS: process.env.LOG_RETENTION_DAYS,
      LOG_CLEANUP_DRY_RUN: process.env.LOG_CLEANUP_DRY_RUN,
    });
    this.retentionDays = config.LOG_RETENTION_DAYS;
    this.dryRun = config.LOG_CLEANUP_DRY_RUN;
  }

  isWithinRetention(filename: string): boolean {
    const match = filename.match(LOG_PATTERN);
    if (!match) return true; // Keep files that don't match pattern for safety

    const dateStr = match[2];
    const logDate = DateTime.fromISO(dateStr);
    if (!logDate.isValid) return true;

    // Last 7 days including today (7 calendar days back)
    const cutoff = DateTime.now().startOf('day').minus({ days: this.retentionDays - 1 });
    return logDate >= cutoff;
  }

  async cleanup(): Promise<void> {
    console.log(`[LOG-CLEANUP] Starting cleanup (retention: ${this.retentionDays} days, dry-run: ${this.dryRun})`);
    
    try {
      if (!fs.existsSync(LOG_DIR)) {
        console.warn(`[LOG-CLEANUP] Log directory ${LOG_DIR} does not exist. skipping.`);
        return;
      }

      const files = await fs.promises.readdir(LOG_DIR);
      let scanned = 0;
      let deletedCount = 0;

      for (const file of files) {
        if (!LOG_PATTERN.test(file)) continue;
        scanned++;

        if (!this.isWithinRetention(file)) {
          const filePath = path.join(LOG_DIR, file);
          const resolvedPath = path.resolve(filePath);
          
          // Safety: ensure resolvedPath is within LOG_DIR
          if (!resolvedPath.startsWith(path.resolve(LOG_DIR))) {
            console.warn(`[LOG-CLEANUP] Security alert: attempted to delete file outside log dir: ${resolvedPath}`);
            continue;
          }

          if (this.dryRun) {
            console.log(`[LOG-CLEANUP] [DRY-RUN] Would delete: ${file}`);
          } else {
            await fs.promises.unlink(filePath);
            deletedCount++;
          }
        }
      }

      console.log(`[LOG-CLEANUP] Cleanup finished. Scanned: ${scanned}, ${this.dryRun ? 'Would have deleted' : 'Deleted'}: ${deletedCount}`);
    } catch (error) {
      console.error(`[LOG-CLEANUP] Error during cleanup:`, error);
    }
  }

  startScheduledCleanup(): void {
    // Run on startup
    this.cleanup();

    // Run every 24 hours
    setInterval(() => {
      this.cleanup();
    }, 24 * 60 * 60 * 1000);
  }
}

export const logRetentionService = new LogRetentionService();
