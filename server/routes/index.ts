import type { Request, Response } from "express";
import { storage } from "../storage";
import { findUserByUsername, findUserById, comparePassword, updateUserPassword, hashPassword } from "../auth"; // Added findUserById
import { isAuthenticated } from "../middleware/authMiddleware";
import type session from 'express-session';
import { execSync } from 'child_process';
import os from 'os';
import express from 'express';
import pitaskerLogsRouter from './pitasker-logs';

const router = express.Router();

// Define a custom type for the session data to include userId
interface AuthenticatedSession extends session.Session {
  userId?: number;
  user?: { id: number; username: string };
}
import { insertTaskSchema, updateTaskSchema } from "../../shared/schema";
import { TaskScheduler } from "../services/taskScheduler";
import { TaskRunner } from "../services/taskRunner";
import { NotificationService } from "../services/notificationService";
import { validateCron } from "../utils/validateCron";

const taskScheduler = new TaskScheduler();
const taskRunner = new TaskRunner();
const notificationService = new NotificationService();

// PiTasker Logs
router.use('/api/pitasker-logs', pitaskerLogsRouter);

// Enhanced health check endpoint with uptime
router.get("/health", (req, res) => {
  const uptime = process.uptime() * 1000; // Convert to milliseconds
  res.json({
    status: "ok",
    uptime: `${Math.floor(uptime)}ms`,
    timestamp: new Date().toISOString(),
    nodeVersion: process.version,
    memoryUsage: {
      rss: `${Math.round(process.memoryUsage().rss / 1024 / 1024)}MB`,
      heapUsed: `${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`,
      heapTotal: `${Math.round(process.memoryUsage().heapTotal / 1024 / 1024)}MB`
    }
  });
});

// Authentication Routes
router.post("/login", async (req: Request, res: Response) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ message: "Username and password are required." });
  }

  try {
    const user = await findUserByUsername(username);
    if (!user) {
      return res.status(401).json({ message: "Invalid username or password." });
    }

    const isPasswordValid = await comparePassword(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({ message: "Invalid username or password." });
    }

    // Store user info in session
    const session = req.session as AuthenticatedSession;
    session.userId = user.id;
    session.user = { id: user.id, username: user.username };

    return res.status(200).json({ message: "Login successful.", redirectTo: "/dashboard" });
  } catch (error) {
    console.error("Login error:", error);
    return res.status(500).json({ message: "Internal server error during login." });
  }
});

router.get("/logout", (req: Request, res: Response) => {
  req.session.destroy((err) => {
    if (err) {
      console.error("Logout error:", err);
      return res.status(500).json({ message: "Could not log out, please try again." });
    }
    res.clearCookie("connect.sid"); // Default session cookie name, adjust if different
    return res.status(200).json({ message: "Logout successful.", redirectTo: "/login" });
  });
});

router.post("/change-password", isAuthenticated, async (req: Request, res: Response) => {
  const { currentPassword, newPassword, confirmNewPassword } = req.body;
  const session = req.session as AuthenticatedSession;
  const userId = session.user?.id || session.userId;

  if (!userId) {
    return res.status(401).json({ message: "User not authenticated." });
  }

  if (!currentPassword || !newPassword || !confirmNewPassword) {
    return res.status(400).json({ message: "All password fields are required." });
  }

  if (newPassword !== confirmNewPassword) {
    return res.status(400).json({ message: "New passwords do not match." });
  }

  // Basic password policy (example: min 8 chars)
  if (newPassword.length < 8) {
    return res.status(400).json({ message: "New password must be at least 8 characters long." });
  }
  // Add more complex policy checks if needed (e.g., uppercase, number, special char)


  try {
    const user = await findUserById(userId);
    if (!user) {
      // This case should ideally not happen if session is valid and user exists
      return res.status(404).json({ message: "User not found." });
    }

    const isCurrentPasswordValid = await comparePassword(currentPassword, user.password);
    if (!isCurrentPasswordValid) {
      return res.status(401).json({ message: "Incorrect current password." });
    }

    const newPasswordHash = await hashPassword(newPassword);
    await updateUserPassword(userId, newPasswordHash);

    return res.status(200).json({ message: "Password changed successfully." });
  } catch (error) {
    console.error("Change password error:", error);
    return res.status(500).json({ message: "Internal server error during password change." });
  }
});


// API Routes (Protected by isAuthenticated middleware)
// Get task statistics (moved before specific ID routes)
router.get("/api/tasks/stats", isAuthenticated, async (req, res) => {
  try {
    const tasks = await storage.getAllTasks();
    const stats = {
      totalTasks: tasks.length,
      runningTasks: tasks.filter(t => t.status === "running").length,
      successfulTasks: tasks.filter(t => t.status === "success").length,
      failedTasks: tasks.filter(t => t.status === "failed").length,
      pendingTasks: tasks.filter(t => t.status === "pending").length,
    };
    res.json(stats);
  } catch (error) {
    console.error("Error fetching stats:", error);
    res.status(500).json({ message: "Failed to fetch statistics" });
  }
});

// System statistics for dashboard
router.get("/api/system-stats", isAuthenticated, async (_req, res) => {
  try {
    // Uptime
    const uptimeSeconds = os.uptime();
    const days = Math.floor(uptimeSeconds / 86400);
    const hours = Math.floor((uptimeSeconds % 86400) / 3600);
    const minutes = Math.floor((uptimeSeconds % 3600) / 60);
    const parts: string[] = [];
    if (days) parts.push(`${days} day${days === 1 ? "" : "s"}`);
    if (hours) parts.push(`${hours} hour${hours === 1 ? "" : "s"}`);
    parts.push(`${minutes} min${minutes === 1 ? "" : "s"}`);
    const uptime = parts.join(", ");

    // CPU usage percentage
    const cpuUsageCmd = "top -bn1 | grep 'Cpu(s)' | awk '{print $2 + $4}'";
    const cpuUsageStr = execSync(cpuUsageCmd).toString().trim();
    const cpuUsage = parseFloat(cpuUsageStr) || 0;

    // Memory usage percentage
    const memCmd = "free | grep Mem | awk '{print $3/$2 * 100.0}'";
    const memUsageStr = execSync(memCmd).toString().trim();
    const memoryUsage = parseFloat(memUsageStr) || 0;

    // CPU temperature in Celsius
    let cpuTemperature = 0;
    try {
      const tempCmd = "sensors | grep -E 'temp1|CPU Temperature|Package id 0' | head -n 1 | awk '{for(i=1;i<=NF;i++) if ($i ~ /^[+0-9]/) print $i}' | tr -d '+°C'";
      const tempStr = execSync(tempCmd).toString().trim();
      cpuTemperature = parseFloat(tempStr) || 0;
    } catch { }

    res.json({ uptime, cpuUsage, memoryUsage, cpuTemperature });
  } catch (error) {
    console.error("Error fetching system stats:", error);
    res.status(500).json({ message: "Failed to fetch system statistics" });
  }
});

// Get all tasks
router.get("/api/tasks", isAuthenticated, async (req, res) => {
  try {
    const tasks = await storage.getAllTasks();
    res.json(tasks);
  } catch (error) {
    console.error("Error fetching tasks:", error);
    res.status(500).json({ message: "Failed to fetch tasks" });
  }
});

// Export all tasks as downloadable JSON
router.get("/api/tasks/export", isAuthenticated, async (req, res) => {
  try {
    const tasks = await storage.getAllTasks();
    const exportTasks = tasks.map((t) => ({
      id: t.id,
      name: t.name,
      schedule: t.cronSchedule,
      command: t.command,
      createdAt: t.createdAt,
      updatedAt: (t as any).updatedAt ?? t.createdAt,
    }));

    const pretty = String(req.query.pretty) === "true";
    const json = pretty
      ? JSON.stringify(exportTasks, null, 2)
      : JSON.stringify(exportTasks);

    res.setHeader("Content-Type", "application/json");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="pitasker-tasks.json"'
    );
    res.send(json);
  } catch (error) {
    console.error("Error exporting tasks:", error);
    res.status(500).json({ message: "Failed to export tasks" });
  }
});

// Get task by ID
router.get("/api/tasks/:id", isAuthenticated, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ message: "Invalid task ID" });
    }

    const task = await storage.getTask(id);
    if (!task) {
      return res.status(404).json({ message: "Task not found" });
    }

    res.json(task);
  } catch (error) {
    console.error("Error fetching task:", error);
    res.status(500).json({ message: "Failed to fetch task" });
  }
});

// Create new task
router.post("/api/tasks", isAuthenticated, async (req, res) => {
  try {
    const validation = insertTaskSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({
        message: "Validation failed",
        errors: validation.error.errors
      });
    }

    const task = await storage.createTask(validation.data);

    // Schedule the task
    taskScheduler.scheduleTask(task);

    res.status(201).json(task);
  } catch (error) {
    console.error("Error creating task:", error);
    res.status(500).json({ message: "Failed to create task" });
  }
});

// Update task
router.patch("/api/tasks/:id", isAuthenticated, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ message: "Invalid task ID" });
    }

    const validation = updateTaskSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({
        message: "Validation failed",
        errors: validation.error.errors
      });
    }

    const existingTask = await storage.getTask(id);
    if (!existingTask) {
      return res.status(404).json({ message: "Task not found" });
    }

    const updatedTask = await storage.updateTask(id, validation.data);
    if (!updatedTask) {
      return res.status(404).json({ message: "Task not found" });
    }

    // Reschedule if cron schedule changed
    if (validation.data.cronSchedule) {
      taskScheduler.unscheduleTask(id);
      taskScheduler.scheduleTask(updatedTask);
    }

    res.json(updatedTask);
  } catch (error) {
    console.error("Error updating task:", error);
    res.status(500).json({ message: "Failed to update task" });
  }
});

// Delete task
router.delete("/api/tasks/:id", isAuthenticated, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ message: "Invalid task ID" });
    }

    const success = await storage.deleteTask(id);
    if (!success) {
      return res.status(404).json({ message: "Task not found" });
    }

    // Unschedule the task
    taskScheduler.unscheduleTask(id);

    res.status(204).send();
  } catch (error) {
    console.error("Error deleting task:", error);
    res.status(500).json({ message: "Failed to delete task" });
  }
});

// Run task manually
router.post("/api/tasks/:id/run", isAuthenticated, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ message: "Invalid task ID" });
    }

    const task = await storage.getTask(id);
    if (!task) {
      return res.status(404).json({ message: "Task not found" });
    }

    if (task.status === "running") {
      return res.status(409).json({ message: "Task is already running" });
    }

    // Run task manually
    taskRunner.runTask(task);

    res.json({ message: "Task execution started" });
  } catch (error) {
    console.error("Error running task:", error);
    res.status(500).json({ message: "Failed to run task" });
  }
});

// Import multiple cronjobs from JSON
router.post("/api/import-cronjobs", isAuthenticated, async (req, res) => {
  if (!Array.isArray(req.body)) {
    return res.status(400).json({ message: "Invalid payload" });
  }

  let imported = 0;
  let failed = 0;

  for (const [index, job] of req.body.entries()) {
    const { name, schedule, command } = job || {};
    if (!name || !schedule || !command) {
      console.error(`Import error at index ${index}: missing fields`);
      failed++;
      continue;
    }

    if (typeof command !== "string" || command.length > 1024) {
      console.error(`Import error at index ${index}: command too long`);
      failed++;
      continue;
    }

    if (!validateCron(schedule)) {
      console.error(`Import error at index ${index}: invalid schedule`);
      failed++;
      continue;
    }

    try {
      const newTask = await storage.createTask({
        name,
        cronSchedule: schedule,
        command,
      });
      taskScheduler.scheduleTask(newTask);
      imported++;
    } catch (error) {
      console.error(`Import error at index ${index}:`, error);
      failed++;
    }
  }

  res.status(200).json({ imported, failed });
});



// Initialize scheduled tasks
const initializeTasks = async () => {
  try {
    const tasks = await storage.getAllTasks();
    for (const task of tasks) {
      if (task.status !== "running") {
        taskScheduler.scheduleTask(task);
      }
    }
    console.log(`Initialized ${tasks.length} scheduled tasks`);
  } catch (error) {
    console.error("Error initializing tasks:", error);
  }
};

// Initialize tasks on startup
initializeTasks();

export default router;
