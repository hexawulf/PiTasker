import { exec } from "child_process";
import { promisify } from "util";
import { randomUUID } from "crypto";

const execAsync = promisify(exec);

export interface CrontabEntry {
  id: string;           // UUID for tracking
  schedule: string;     // Cron schedule (5 fields)
  command: string;      // Shell command
  comment?: string;     // Optional user comment
  isManaged: boolean;   // True if managed by PiTasker
}

export class CrontabService {
  private static readonly PITASKER_ID_PREFIX = "# PITASKER_ID:";
  private static readonly USER_COMMENT_PREFIX = "# PITASKER_COMMENT:";

  /**
   * Read the current user's crontab and parse entries
   */
  async readUserCrontab(): Promise<CrontabEntry[]> {
    try {
      const { stdout } = await execAsync("crontab -l");
      return this.parseCrontab(stdout);
    } catch (error: any) {
      // If no crontab exists, return empty array
      if (error.message?.includes("no crontab")) {
        return [];
      }
      throw new Error(`Failed to read crontab: ${error.message}`);
    }
  }

  /**
   * Write entries back to the user's crontab
   */
  async writeUserCrontab(entries: CrontabEntry[]): Promise<void> {
    try {
      const crontabContent = entries
        .map((entry) => this.formatCrontabEntry(entry))
        .join("\n");

      // Write to crontab via stdin
      await execAsync(`echo '${crontabContent.replace(/'/g, "'\\''")}' | crontab -`);
    } catch (error: any) {
      throw new Error(`Failed to write crontab: ${error.message}`);
    }
  }

  /**
   * Add a new entry to the crontab
   */
  async addCrontabEntry(entry: CrontabEntry): Promise<void> {
    const existingEntries = await this.readUserCrontab();
    
    // Check if entry with same ID already exists
    const existingIndex = existingEntries.findIndex((e) => e.id === entry.id);
    if (existingIndex !== -1) {
      throw new Error(`Crontab entry with ID ${entry.id} already exists`);
    }

    existingEntries.push(entry);
    await this.writeUserCrontab(existingEntries);
  }

  /**
   * Update an existing crontab entry by ID
   */
  async updateCrontabEntry(id: string, entry: CrontabEntry): Promise<void> {
    const existingEntries = await this.readUserCrontab();
    
    const index = existingEntries.findIndex((e) => e.id === id);
    if (index === -1) {
      throw new Error(`Crontab entry with ID ${id} not found`);
    }

    existingEntries[index] = { ...entry, id }; // Preserve ID
    await this.writeUserCrontab(existingEntries);
  }

  /**
   * Remove a crontab entry by ID
   */
  async removeCrontabEntry(id: string): Promise<void> {
    const existingEntries = await this.readUserCrontab();
    
    const filteredEntries = existingEntries.filter((e) => e.id !== id);
    
    if (filteredEntries.length === existingEntries.length) {
      throw new Error(`Crontab entry with ID ${id} not found`);
    }

    await this.writeUserCrontab(filteredEntries);
  }

  /**
   * Parse crontab content into structured entries
   */
  private parseCrontab(content: string): CrontabEntry[] {
    const lines = content.split("\n").filter((line) => line.trim() !== "");
    const entries: CrontabEntry[] = [];
    
    let currentId: string | null = null;
    let currentComment: string | null = null;

    for (const line of lines) {
      // Skip empty lines
      if (!line.trim()) {
        continue;
      }

      // Check for PiTasker ID marker
      if (line.startsWith(CrontabService.PITASKER_ID_PREFIX)) {
        currentId = line.substring(CrontabService.PITASKER_ID_PREFIX.length).trim();
        continue;
      }

      // Check for PiTasker comment marker
      if (line.startsWith(CrontabService.USER_COMMENT_PREFIX)) {
        currentComment = line.substring(CrontabService.USER_COMMENT_PREFIX.length).trim();
        continue;
      }

      // Skip other comments
      if (line.startsWith("#")) {
        continue;
      }

      // Parse cron entry
      const entry = this.parseCrontabLine(line, currentId, currentComment);
      if (entry) {
        entries.push(entry);
      }

      // Reset markers
      currentId = null;
      currentComment = null;
    }

    return entries;
  }

  /**
   * Parse a single crontab line
   */
  private parseCrontabLine(
    line: string,
    existingId: string | null,
    existingComment: string | null
  ): CrontabEntry | null {
    try {
      // Crontab format: minute hour day month weekday command
      const parts = line.trim().split(/\s+/);
      
      if (parts.length < 6) {
        console.warn(`Invalid crontab line (less than 6 fields): ${line}`);
        return null;
      }

      const schedule = parts.slice(0, 5).join(" ");
      const command = parts.slice(5).join(" ");

      // Validate schedule format
      if (!this.isValidCronSchedule(schedule)) {
        console.warn(`Invalid cron schedule: ${schedule}`);
        return null;
      }

      return {
        id: existingId || randomUUID(),
        schedule,
        command,
        comment: existingComment || undefined,
        isManaged: existingId !== null,
      };
    } catch (error) {
      console.error(`Error parsing crontab line: ${line}`, error);
      return null;
    }
  }

  /**
   * Format a crontab entry as a string
   */
  private formatCrontabEntry(entry: CrontabEntry): string {
    const lines: string[] = [];

    // Add PiTasker markers if managed
    if (entry.isManaged) {
      lines.push(`${CrontabService.PITASKER_ID_PREFIX}${entry.id}`);
      if (entry.comment) {
        lines.push(`${CrontabService.USER_COMMENT_PREFIX}${entry.comment}`);
      }
    }

    // Add the cron entry itself
    lines.push(`${entry.schedule} ${entry.command}`);

    return lines.join("\n");
  }

  /**
   * Validate a cron schedule format (5 fields)
   */
  private isValidCronSchedule(schedule: string): boolean {
    const parts = schedule.split(/\s+/);
    return parts.length === 5;
  }

  /**
   * Generate a new UUID for a crontab entry
   */
  generateId(): string {
    return randomUUID();
  }

  /**
   * Check if user has crontab access
   */
  async hasCrontabAccess(): Promise<boolean> {
    try {
      await execAsync("crontab -l");
      return true;
    } catch (error: any) {
      // "no crontab" is fine - means user has access but no crontab yet
      if (error.message?.includes("no crontab")) {
        return true;
      }
      return false;
    }
  }
}

export const crontabService = new CrontabService();
