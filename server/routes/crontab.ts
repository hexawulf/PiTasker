import express from "express";
import { isAuthenticated } from "../middleware/authMiddleware";
import { crontabService } from "../services/crontabService";
import { crontabSyncService } from "../services/crontabSyncService";
import { storage } from "../storage";

const router = express.Router();

// Import crontab entries to database
router.post("/import", isAuthenticated, async (req, res) => {
  try {
    const result = await crontabSyncService.importFromCrontab();
    res.json(result);
  } catch (error: any) {
    console.error("Crontab import error:", error);
    res.status(500).json({ 
      message: "Failed to import from crontab",
      error: error.message 
    });
  }
});

// Export database tasks to crontab
router.post("/export", isAuthenticated, async (req, res) => {
  try {
    const { taskIds } = req.body;
    const result = await crontabSyncService.exportToCrontab(taskIds);
    res.json(result);
  } catch (error: any) {
    console.error("Crontab export error:", error);
    res.status(500).json({ 
      message: "Failed to export to crontab",
      error: error.message 
    });
  }
});

// Full bidirectional sync
router.post("/sync", isAuthenticated, async (req, res) => {
  try {
    const result = await crontabSyncService.fullSync();
    res.json(result);
  } catch (error: any) {
    console.error("Crontab sync error:", error);
    res.status(500).json({ 
      message: "Failed to sync crontab",
      error: error.message 
    });
  }
});

// Get sync status
router.get("/status", isAuthenticated, async (req, res) => {
  try {
    const tasks = await storage.getAllTasks();
    const crontabEntries = await crontabService.readUserCrontab();
    
    const syncedTasks = tasks.filter((t) => t.syncedToCrontab && t.isSystemManaged);
    const unsyncedTasks = tasks.filter((t) => !t.syncedToCrontab && t.isSystemManaged);
    const databaseOnlyTasks = tasks.filter((t) => !t.isSystemManaged);
    
    // Find most recent sync time
    const lastSync = syncedTasks.reduce((latest, task) => {
      if (!task.crontabSyncedAt) return latest;
      return !latest || task.crontabSyncedAt > latest ? task.crontabSyncedAt : latest;
    }, null as Date | null);

    res.json({
      lastSync: lastSync?.toISOString() || null,
      dbTaskCount: tasks.length,
      crontabEntryCount: crontabEntries.length,
      systemManagedCount: syncedTasks.length + unsyncedTasks.length,
      syncedCount: syncedTasks.length,
      unsyncedCount: unsyncedTasks.length,
      databaseOnlyCount: databaseOnlyTasks.length,
      managedCrontabEntries: crontabEntries.filter((e) => e.isManaged).length,
      unmanagedCrontabEntries: crontabEntries.filter((e) => !e.isManaged).length,
    });
  } catch (error: any) {
    console.error("Crontab status error:", error);
    res.status(500).json({ 
      message: "Failed to get crontab status",
      error: error.message 
    });
  }
});

// Validate sync integrity
router.get("/validate", isAuthenticated, async (req, res) => {
  try {
    const result = await crontabSyncService.validateSync();
    res.json(result);
  } catch (error: any) {
    console.error("Crontab validation error:", error);
    res.status(500).json({ 
      message: "Failed to validate crontab sync",
      error: error.message 
    });
  }
});

// Get raw crontab
router.get("/raw", isAuthenticated, async (req, res) => {
  try {
    const entries = await crontabService.readUserCrontab();
    
    // Format as raw crontab content
    const content = entries
      .map((entry) => `${entry.schedule} ${entry.command}${entry.comment ? ` # ${entry.comment}` : ""}`)
      .join("\n");
    
    res.json({ content });
  } catch (error: any) {
    console.error("Crontab read error:", error);
    res.status(500).json({ 
      message: "Failed to read crontab",
      error: error.message 
    });
  }
});

// Manual crontab edit (advanced - use with caution)
router.put("/raw", isAuthenticated, async (req, res) => {
  try {
    const { content } = req.body;
    
    if (!content || typeof content !== "string") {
      return res.status(400).json({ message: "Invalid crontab content" });
    }

    // Parse and validate the content
    const lines = content.split("\n").filter((line) => line.trim() !== "");
    
    // This is dangerous - we're allowing raw crontab editing
    // In a production environment, you might want to add more validation
    
    res.status(501).json({ 
      message: "Raw crontab editing not implemented for safety reasons",
      suggestion: "Use import/export endpoints instead"
    });
  } catch (error: any) {
    console.error("Crontab write error:", error);
    res.status(500).json({ 
      message: "Failed to write crontab",
      error: error.message 
    });
  }
});

// Remove task from crontab only (keep in database)
router.delete("/:taskId", isAuthenticated, async (req, res) => {
  try {
    const taskId = parseInt(req.params.taskId);
    if (isNaN(taskId)) {
      return res.status(400).json({ message: "Invalid task ID" });
    }

    await crontabSyncService.removeFromCrontab(taskId);
    res.json({ message: "Task removed from crontab successfully" });
  } catch (error: any) {
    console.error("Crontab remove error:", error);
    res.status(500).json({ 
      message: "Failed to remove from crontab",
      error: error.message 
    });
  }
});

// Check crontab access
router.get("/check-access", isAuthenticated, async (req, res) => {
  try {
    const hasAccess = await crontabService.hasCrontabAccess();
    res.json({ hasAccess });
  } catch (error: any) {
    console.error("Crontab access check error:", error);
    res.status(500).json({ 
      message: "Failed to check crontab access",
      error: error.message 
    });
  }
});

export default router;
