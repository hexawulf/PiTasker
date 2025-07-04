import { pgTable, text, serial, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

export const tasks = pgTable("tasks", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  cronSchedule: text("cron_schedule").notNull(),
  command: text("command").notNull(),
  status: text("status").notNull().default("pending"), // pending, running, success, failed
  lastRun: timestamp("last_run"),
  output: text("output"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

// Custom cron validation function
const validateCron = (cron: string): boolean => {
  // Basic cron format: minute hour day month weekday
  const cronParts = cron.trim().split(/\s+/);
  if (cronParts.length !== 5) return false;
  
  const [minute, hour, day, month, weekday] = cronParts;
  
  // Validate each field
  const validateField = (value: string, min: number, max: number): boolean => {
    if (value === '*') return true;
    if (value.includes('/')) {
      const [range, step] = value.split('/');
      if (range === '*') return !isNaN(parseInt(step)) && parseInt(step) > 0;
      return validateField(range, min, max) && !isNaN(parseInt(step));
    }
    if (value.includes('-')) {
      const [start, end] = value.split('-');
      return !isNaN(parseInt(start)) && !isNaN(parseInt(end)) && 
             parseInt(start) >= min && parseInt(end) <= max && parseInt(start) <= parseInt(end);
    }
    if (value.includes(',')) {
      return value.split(',').every(v => validateField(v, min, max));
    }
    const num = parseInt(value);
    return !isNaN(num) && num >= min && num <= max;
  };
  
  return validateField(minute, 0, 59) && 
         validateField(hour, 0, 23) && 
         validateField(day, 1, 31) && 
         validateField(month, 1, 12) && 
         validateField(weekday, 0, 7); // 0 and 7 both represent Sunday
};

export const insertTaskSchema = createInsertSchema(tasks).pick({
  name: true,
  cronSchedule: true,
  command: true,
}).extend({
  name: z.string().min(1, "Task name is required").max(100, "Task name too long"),
  cronSchedule: z.string().refine(validateCron, {
    message: "Invalid cron format. Use: minute hour day month weekday (e.g., '0 2 * * *')"
  }),
  command: z.string().min(1, "Command is required"),
});

export const updateTaskSchema = insertTaskSchema.partial().extend({
  status: z.enum(["pending", "running", "success", "failed"]).optional(),
  lastRun: z.date().optional(),
  output: z.string().optional(),
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type InsertTask = z.infer<typeof insertTaskSchema>;
export type UpdateTask = z.infer<typeof updateTaskSchema>;
export type Task = typeof tasks.$inferSelect;
