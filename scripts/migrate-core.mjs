// Author:      0xWulf (zk@hexawulf.dev)
// Description: PiTasker schema migrations (docs/plans/2.0.md › P1 bug 9), the
//              same approach as PiDeck 2.5 M0. Applies drizzle-kit's
//              migrations/ (journal + SQL) with drizzle-orm's bookkeeping —
//              table public.__drizzle_migrations (id, hash = sha256 of the
//              file, created_at = the journal's "when") — plus:
//                • a session advisory lock (concurrent runs serialise),
//                • one transaction per migration,
//                • a baseline mark for databases created by `drizzle-kit
//                  push` (PiTasker 1.x): app tables present, no migrations
//                  table → record 0000 as applied WITHOUT running it.
//                  The existing database is never re-created.
//              Used by scripts/migrate.mjs (npm run db:migrate), the server
//              at startup (migrationStatus, read-only) and the test setup.
// Modified:    2026-09-30
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const MIGRATIONS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "migrations");
export const MIGRATIONS_TABLE = "__drizzle_migrations";
/** Tables (and columns) every 1.x database has — what migrations/0000 creates. */
export const BASELINE_TABLES = ["users", "tasks"];
export const BASELINE_COLUMNS = { tasks: ["crontab_id", "is_system_managed", "synced_to_crontab", "source"] };
/** pg_advisory_lock key ("PiTask migrate"). */
export const MIGRATE_LOCK_KEY = 0x5069546173;

export function readMigrations(dir = MIGRATIONS_DIR) {
  const journal = JSON.parse(fs.readFileSync(path.join(dir, "meta", "_journal.json"), "utf8"));
  return journal.entries.map((e) => {
    const sql = fs.readFileSync(path.join(dir, `${e.tag}.sql`), "utf8");
    return {
      idx: e.idx,
      tag: e.tag,
      when: e.when,
      hash: crypto.createHash("sha256").update(sql).digest("hex"),
      statements: sql.split("--> statement-breakpoint").map((s) => s.trim()).filter(Boolean),
    };
  });
}

async function tableExists(client, name) {
  const { rows } = await client.query("SELECT to_regclass($1) AS t", [`public."${name}"`]);
  return rows[0].t !== null;
}

async function columnsOf(client, table) {
  const { rows } = await client.query(
    "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1",
    [table],
  );
  return new Set(rows.map((r) => r.column_name));
}

/**
 * Read-only: what migrate() would do.
 * { tracked, baseline: "none"|"needed"|"partial", applied, pending: [tag], edited: [tag] }
 */
export async function migrationStatus(client, { dir = MIGRATIONS_DIR } = {}) {
  const migrations = readMigrations(dir);
  const tracked = await tableExists(client, MIGRATIONS_TABLE);
  const present = [];
  for (const t of BASELINE_TABLES) if (await tableExists(client, t)) present.push(t);
  let baseline = "none";
  if (!tracked && present.length === BASELINE_TABLES.length) {
    baseline = "needed";
    for (const [table, cols] of Object.entries(BASELINE_COLUMNS)) {
      const have = await columnsOf(client, table);
      if (cols.some((c) => !have.has(c))) baseline = "partial";
    }
  } else if (!tracked && present.length > 0) baseline = "partial";

  let applied = [];
  if (tracked) {
    const { rows } = await client.query(`SELECT hash, created_at FROM public."${MIGRATIONS_TABLE}" ORDER BY created_at`);
    applied = rows.map((r) => ({ hash: r.hash, created_at: Number(r.created_at) }));
  }
  let last = applied.length ? Math.max(...applied.map((a) => a.created_at)) : -Infinity;
  if (baseline === "needed") last = migrations[0]?.when ?? last;
  const pending = migrations.filter((m) => m.when > last).map((m) => m.tag);
  const hashes = new Set(applied.map((a) => a.hash));
  const edited = migrations.filter((m) => m.when <= last && tracked && !hashes.has(m.hash)).map((m) => m.tag);
  return { tracked, baseline, applied, pending, edited };
}

const say = (log, level, msg) => (log?.[level] ?? console[level])(msg);

/** Apply every pending migration (see the header). Returns { baselined, applied: [tag] }. */
export async function migrate(client, { dir = MIGRATIONS_DIR, log = console } = {}) {
  const migrations = readMigrations(dir);
  await client.query("SELECT pg_advisory_lock($1)", [MIGRATE_LOCK_KEY]);
  try {
    const status = await migrationStatus(client, { dir });
    if (status.baseline === "partial") {
      throw new Error(
        `the database has some PiTasker tables/columns but not all (${BASELINE_TABLES.join(", ")}; tasks.${BASELINE_COLUMNS.tasks.join(", tasks.")}) ` +
          `and no ${MIGRATIONS_TABLE}: refusing to guess. Restore it from a backup or fix it by hand.`,
      );
    }
    for (const tag of status.edited) {
      say(log, "warn", `[migrate] WARNING: ${tag}.sql differs from what was applied — never edit an applied migration; add a new one.`);
    }
    let baselined = false;
    if (!status.tracked) {
      await client.query(`CREATE TABLE IF NOT EXISTS public."${MIGRATIONS_TABLE}" (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint)`);
    }
    if (status.baseline === "needed") {
      const base = migrations[0];
      await client.query(`INSERT INTO public."${MIGRATIONS_TABLE}" (hash, created_at) VALUES ($1, $2)`, [base.hash, base.when]);
      baselined = true;
      say(log, "warn", `[migrate] BASELINE: existing PiTasker tables found (${BASELINE_TABLES.join(", ")}) and no migration history.`);
      say(log, "warn", `[migrate] Recorded ${base.tag} as applied WITHOUT running it (no schema change).`);
    }
    const applied = [];
    for (const m of migrations.filter((x) => status.pending.includes(x.tag))) {
      await client.query("BEGIN");
      try {
        for (const stmt of m.statements) await client.query(stmt);
        await client.query(`INSERT INTO public."${MIGRATIONS_TABLE}" (hash, created_at) VALUES ($1, $2)`, [m.hash, m.when]);
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        const e = new Error(`migration ${m.tag} failed and was rolled back: ${err instanceof Error ? err.message : String(err)}`);
        e.cause = err;
        throw e;
      }
      applied.push(m.tag);
      say(log, "info", `[migrate] applied ${m.tag}`);
    }
    return { baselined, applied };
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [MIGRATE_LOCK_KEY]).catch(() => {});
  }
}
