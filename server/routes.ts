import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { findUserByUsername, findUserById, comparePassword, updateUserPassword, hashPassword } from "./auth"; // Added findUserById
import { isAuthenticated } from "./middleware/authMiddleware";
import type session from 'express-session';

// Define a custom type for the session data to include userId
interface AuthenticatedSession extends session.Session {
  userId?: number;
}
import { insertTaskSchema, updateTaskSchema } from "@shared/schema";
import { TaskScheduler } from "./services/taskScheduler";
import { TaskRunner } from "./services/taskRunner";
import { NotificationService } from "./services/notificationService";

const taskScheduler = new TaskScheduler();
const taskRunner = new TaskRunner();
const notificationService = new NotificationService();

export async function registerRoutes(app: Express): Promise<Server> {
  // Enhanced health check endpoint with uptime
  app.get("/health", (req, res) => {
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
  app.post("/login", async (req: Request, res: Response) => {
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

      // Store user ID in session
      const session = req.session as AuthenticatedSession;
      session.userId = user.id;

      return res.status(200).json({ message: "Login successful.", redirectTo: "/dashboard" });
    } catch (error) {
      console.error("Login error:", error);
      return res.status(500).json({ message: "Internal server error during login." });
    }
  });

  app.get("/logout", (req: Request, res: Response) => {
    req.session.destroy((err) => {
      if (err) {
        console.error("Logout error:", err);
        return res.status(500).json({ message: "Could not log out, please try again." });
      }
      res.clearCookie("connect.sid"); // Default session cookie name, adjust if different
      return res.status(200).json({ message: "Logout successful.", redirectTo: "/login" });
    });
  });

  app.post("/change-password", isAuthenticated, async (req: Request, res: Response) => {
    const { currentPassword, newPassword, confirmNewPassword } = req.body;
    const session = req.session as AuthenticatedSession;
    const userId = session.userId;

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
  app.get("/api/tasks/stats", isAuthenticated, async (req, res) => {
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

  // Get all tasks
  app.get("/api/tasks", isAuthenticated, async (req, res) => {
    try {
      const tasks = await storage.getAllTasks();
      res.json(tasks);
    } catch (error) {
      console.error("Error fetching tasks:", error);
      res.status(500).json({ message: "Failed to fetch tasks" });
    }
  });

  // Get task by ID
  app.get("/api/tasks/:id", isAuthenticated, async (req, res) => {
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
  app.post("/api/tasks", isAuthenticated, async (req, res) => {
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
  app.patch("/api/tasks/:id", isAuthenticated, async (req, res) => {
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
  app.delete("/api/tasks/:id", isAuthenticated, async (req, res) => {
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
  app.post("/api/tasks/:id/run", isAuthenticated, async (req, res) => {
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

  const httpServer = createServer(app);
  return httpServer;
}
