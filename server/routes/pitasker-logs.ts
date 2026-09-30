// PiTasker's own log files (LOG_DIR). The file name travels as ?name=, never
// in the path: nginx answers 403 to any URL path ending in .log.
import express from "express";
import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { logRetentionService, getLogDir } from "../services/logRetentionService";
import { isAuthenticated } from "../middleware/authMiddleware";

const router = express.Router();
router.use(isAuthenticated);

export const isValidLog = (name: unknown): name is string => typeof name === "string" && /^[\w.-]+\.log$/.test(name) && !name.startsWith(".");

router.get("/", (_req, res) => {
  fs.readdir(getLogDir(), (err, files) => {
    if (err) return res.status(500).json({ message: "Cannot list logs" });
    res.json(files.filter(isValidLog).filter((f) => logRetentionService.isWithinRetention(f)));
  });
});

/** ?name=<file>.log → the last 100 lines; &download=1 → the whole file. */
router.get("/file", (req, res) => {
  const name = req.query.name;
  if (!isValidLog(name)) return res.status(400).json({ message: "Invalid log file" });
  const logPath = path.join(getLogDir(), name);
  if (!fs.existsSync(logPath)) return res.status(404).json({ message: "Log file not found" });
  if (req.query.download === "1") return res.download(logPath);
  const tail = spawn("tail", ["-n", "100", logPath]);
  let output = "";
  tail.stdout.on("data", (chunk) => (output += chunk));
  tail.on("error", () => res.status(500).json({ message: "Cannot read log" }));
  tail.on("close", () => res.json({ content: output }));
});

export default router;
