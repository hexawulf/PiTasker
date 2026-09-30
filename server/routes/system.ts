// Host facts for the header and the system card — read from /proc and /sys, no shell.
import fs from "fs";
import os from "os";
import express from "express";
import { config } from "../config";
import { isAuthenticated } from "../middleware/authMiddleware";
import { version } from "../version";

const router = express.Router();

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const parts: string[] = [];
  if (d) parts.push(`${d} day${d === 1 ? "" : "s"}`);
  if (h) parts.push(`${h} hour${h === 1 ? "" : "s"}`);
  parts.push(`${m} min${m === 1 ? "" : "s"}`);
  return parts.join(", ");
}

function memoryUsage(): number {
  try {
    const info = fs.readFileSync("/proc/meminfo", "utf8");
    const kb = (k: string) => Number(new RegExp(`^${k}:\\s+(\\d+)`, "m").exec(info)?.[1] ?? 0);
    const total = kb("MemTotal");
    return total ? ((total - kb("MemAvailable")) / total) * 100 : 0;
  } catch {
    return ((os.totalmem() - os.freemem()) / os.totalmem()) * 100;
  }
}

function cpuTemperature(): number | null {
  try {
    return Number(fs.readFileSync("/sys/class/thermal/thermal_zone0/temp", "utf8").trim()) / 1000;
  } catch {
    return null;
  }
}

router.get("/api/system-stats", isAuthenticated, (_req, res) => {
  const load = os.loadavg()[0];
  res.json({
    uptime: formatUptime(os.uptime()),
    cpuUsage: Math.min(100, (load / os.cpus().length) * 100),
    loadAverage: os.loadavg(),
    memoryUsage: memoryUsage(),
    cpuTemperature: cpuTemperature(),
    processRssMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
  });
});

router.get("/api/meta", isAuthenticated, (_req, res) => {
  res.json({
    version,
    hostname: config.hostname,
    user: os.userInfo().username,
    timeZone: config.timeZone,
    binDir: config.binDir,
    runTimeoutMs: config.runTimeoutMs,
    cronJournal: config.cronJournal,
  });
});

export default router;
