// PiTasker server bootstrap.
//   env check ─► schema check (refuses to start with pending migrations)
//   ─► reset stale run state ─► schedule PiTasker-run tasks ─► listen
import "dotenv/config";
import path from "path";
import { fileURLToPath } from "url";
import connectPgSimple from "connect-pg-simple";
import session from "express-session";
import { createApp, findStaticDir } from "./app";
import { config } from "./config";
import { pool } from "./db";
import { logRetentionService } from "./services/logRetentionService";
import { taskScheduler } from "./services/taskScheduler";
import { storage } from "./storage";
import { version } from "./version";
// @ts-expect-error — plain ESM shared with scripts/migrate.mjs
import { migrationStatus } from "../scripts/migrate-core.mjs";

const fatal = (msg: string): never => {
  console.error(`FATAL: ${msg}`);
  process.exit(1);
};

if (process.env.PITASKER_MODE === "agent") fatal("PITASKER_MODE=agent: the agent is dist/agent.mjs (scripts/install-agent.sh), not the hub's dist/index.js");

const secret = process.env.SESSION_SECRET ?? "";
if (!secret) fatal("SESSION_SECRET is not set (.env). Generate one: openssl rand -hex 32");
if (secret.length < 16) fatal("SESSION_SECRET is too short (min 16 characters; use openssl rand -hex 32)");
if (secret.length < 32) console.warn("[server] SESSION_SECRET is shorter than 32 characters; consider openssl rand -hex 32");
const PORT = Number(process.env.PORT);
if (!PORT) fatal("PORT is not set (.env)");

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const client = await pool.connect();
  try {
    const s = await migrationStatus(client);
    if (s.pending.length || s.baseline !== "none") {
      fatal(`database schema is not up to date (${s.baseline === "needed" ? "baseline mark + " : s.baseline === "partial" ? "PARTIAL schema; " : ""}pending: ${s.pending.join(", ") || "none"}). Run: npm run db:migrate`);
    }
  } finally {
    client.release();
  }

  const stale = await storage.resetStaleState();
  if (stale.runs || stale.cronTasks || stale.ownTasks || stale.futureLastRun) {
    console.warn(`[server] reset stale state: ${stale.runs} run(s) interrupted, ${stale.cronTasks} crontab task(s) and ${stale.ownTasks} PiTasker task(s) no longer "running", ${stale.futureLastRun} future last_run cleared`);
  }

  const tasks = await storage.getAllTasks();
  taskScheduler.syncAll(tasks);
  console.log(`[scheduler] time zone ${config.timeZone}; PiTasker runs ${taskScheduler.scheduledIds().length} task(s), the crontab runs ${tasks.filter((t) => t.isSystemManaged !== false).length}`);

  logRetentionService.startScheduledCleanup();

  const PgSession = connectPgSimple(session);
  const staticDir = findStaticDir(__dirname);
  if (!staticDir) console.warn("[server] no frontend build found (npm run build)");
  const app = createApp({ sessionStore: new PgSession({ pool, pruneSessionInterval: 60 * 60 }), staticDir });
  const host = process.env.HOST || "0.0.0.0";
  app.listen(PORT, host, () => console.log(`[express] PiTasker ${version} on ${host}:${PORT}`));
}

main().catch((err) => {
  console.error("[server] failed to start:", err);
  process.exit(1);
});
