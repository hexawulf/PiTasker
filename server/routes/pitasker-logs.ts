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

const MAX_TAIL_BYTES = 256 * 1024;

export const isValidLog = (name: unknown): name is string =>
  typeof name === "string" && /^[\w.-]+\.log$/.test(name) && !name.startsWith(".") && !name.startsWith("-");

/** Resolve a validated log filename inside LOG_DIR, refusing symlinks or paths escaping LOG_DIR. */
export function resolveSafeLogPath(name: string, logDir = getLogDir()): string | null {
  if (!isValidLog(name)) return null;
  const candidate = path.join(logDir, name);
  let st: fs.Stats;
  try {
    st = fs.lstatSync(candidate);
  } catch {
    return null;
  }
  if (st.isSymbolicLink() || !st.isFile()) return null;
  try {
    const realDir = fs.realpathSync(logDir);
    const realFile = fs.realpathSync(candidate);
    if (!realFile.startsWith(realDir + path.sep)) return null;
    return realFile;
  } catch {
    return null;
  }
}

router.get("/", (_req, res) => {
  const dir = getLogDir();
  fs.readdir(dir, (err, files) => {
    if (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return res.json([]);
      return res.status(500).json({ message: "Cannot list logs" });
    }
    res.json(
      files
        .filter((f) => resolveSafeLogPath(f, dir) !== null)
        .filter((f) => logRetentionService.isWithinRetention(f)),
    );
  });
});

/** ?name=<file>.log → the last 100 lines; &download=1 → the whole file. */
router.get("/file", (req, res) => {
  const name = req.query.name;
  if (!isValidLog(name)) return res.status(400).json({ message: "Invalid log file" });
  const logPath = resolveSafeLogPath(name);
  if (!logPath) return res.status(404).json({ message: "Log file not found" });
  if (req.query.download === "1") return res.download(logPath, name);
  const tail = spawn("tail", ["-n", "100", "--", logPath]);
  let output = "";
  tail.stdout.on("data", (chunk: Buffer) => {
    output += chunk.toString("utf8");
    if (output.length > MAX_TAIL_BYTES) output = output.slice(output.length - MAX_TAIL_BYTES);
  });
  tail.on("error", () => {
    if (!res.headersSent) res.status(500).json({ message: "Cannot read log" });
  });
  tail.on("close", (code) => {
    if (res.headersSent) return;
    if (code !== 0 && !output) return res.status(500).json({ message: "Cannot read log" });
    res.json({ content: output });
  });
});

export default router;
