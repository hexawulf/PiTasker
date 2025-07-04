import { pgTable, text, serial, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { isValidCron } from "cron-validator";

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

// Enhanced task validation schema with cron-validator
const taskValidationSchema = z.object({
  name: z
    .string()
    .min(1, "Task name is required")
    .max(100, "Task name must be less than 100 characters")
    .trim(),
  cronSchedule: z
    .string()
    .min(9, "Cron expression is required")
    .refine(
      (val) => {
        try {
          return isValidCron(val, { 
            seconds: false,
            alias: true,
            allowBlankDay: true 
          });
        } catch {
          return false;
        }
      },
      { message: "Invalid cron expression (format: minute hour day month weekday)" }
    ),
  command: z
    .string()
    .min(1, "Shell command is required")
    .max(500, "Command must be less than 500 characters")
    .trim()
    .refine(
      (val) => val.length > 0,
      { message: "Command cannot be empty or only whitespace" }
    )
});

// Export the enhanced validation schema as insertTaskSchema
export const insertTaskSchema = taskValidationSchema;

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
