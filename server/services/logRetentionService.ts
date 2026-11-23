import fs from "fs";
import path from "path";

import { config } from "../config";

export const getLogDir = () => config.logDir;
export const LOG_PATTERN = /^([\w.-]+)-(\d{4}-\d{2}-\d{2})\.log$/;

export interface LogRetentionOptions {
  logDir?: string;
  retentionDays?: number;
  dryRun?: boolean;
  /** Clock for "today" (tests). */
  now?: () => Date;
}

export interface CleanupResult {
  scanned: number;
  deleted: number;
}

export class LogRetentionService {
  private readonly logDir: () => string;
  private readonly retentionDays: number;
  private readonly dryRun: boolean;
  private readonly now: () => Date;

  /** Settings come from server/config.ts; options override them (tests). */
  constructor(opts: LogRetentionOptions = {}) {
    this.logDir = opts.logDir !== undefined ? () => opts.logDir as string : getLogDir;
    this.retentionDays = opts.retentionDays ?? config.logRetentionDays;
    this.dryRun = opts.dryRun ?? config.logCleanupDryRun;
    this.now = opts.now ?? (() => new Date());
  }

  isWithinRetention(filename: string): boolean {
    const match = filename.match(LOG_PATTERN);
    if (!match) return true; // Keep files that don't match date pattern (e.g., active log)

    const [y, m, d] = match[2].split('-').map(Number);
    const logDate = new Date(y, m - 1, d);
    if (Number.isNaN(logDate.getTime()) || logDate.getMonth() !== m - 1) return true;

    // The last N calendar days including today (local time).
    const now = this.now();
    const cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (this.retentionDays - 1));
    return logDate >= cutoff;
  }

  async cleanup(): Promise<CleanupResult> {
    const logDir = this.logDir();
    console.log(`[LOG-CLEANUP] Starting cleanup (dir: ${logDir}, retention: ${this.retentionDays} days, dry-run: ${this.dryRun})`);
    
    try {
      if (!fs.existsSync(logDir)) {
        console.warn(`[LOG-CLEANUP] Log directory ${logDir} does not exist. Skipping cleanup.`);
        return { scanned: 0, deleted: 0 };
      }

      const files = await fs.promises.readdir(logDir);
      let scanned = 0;
      let deletedCount = 0;

      for (const file of files) {
        if (!file.endsWith('.log')) continue;
        scanned++;

        if (!this.isWithinRetention(file)) {
          const filePath = path.join(logDir, file);
          const resolvedPath = path.resolve(filePath);
          
          // Safety: ensure resolvedPath is strictly within logDir
          const resolvedLogDir = path.resolve(logDir);
          if (!resolvedPath.startsWith(resolvedLogDir + path.sep)) {
            console.warn(`[LOG-CLEANUP] Security alert: attempted to delete file outside log dir: ${resolvedPath}`);
            continue;
          }

          if (this.dryRun) {
            console.log(`[LOG-CLEANUP] [DRY-RUN] Would delete: ${file}`);
            deletedCount++;
          } else {
            await fs.promises.unlink(filePath);
            deletedCount++;
          }
        }
      }

      console.log(`[LOG-CLEANUP] Cleanup finished. Scanned: ${scanned}, ${this.dryRun ? 'Would have deleted' : 'Deleted'}: ${deletedCount}`);
      return { scanned, deleted: deletedCount };
    } catch (error) {
      console.error(`[LOG-CLEANUP] Error during cleanup:`, error);
      return { scanned: 0, deleted: 0 };
    }
  }

  startScheduledCleanup(): void {
    // Run on startup
    this.cleanup().catch(err => console.error('[LOG-CLEANUP] Startup cleanup failed:', err));

    // Run every 24 hours
    const timer = setInterval(() => {
      this.cleanup().catch(err => console.error('[LOG-CLEANUP] Interval cleanup failed:', err));
    }, 24 * 60 * 60 * 1000);
    timer.unref();
  }
}

export const logRetentionService = new LogRetentionService();
