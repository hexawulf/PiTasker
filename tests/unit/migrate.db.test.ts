import fs from "fs";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
// @ts-expect-error — plain ESM
import { migrate, migrationStatus, readMigrations } from "../../scripts/migrate-core.mjs";
import { connect, dbUrl, dropDb, hasPg, scratchDb } from "../setup/pg";

const V1 = fs.readFileSync(path.join(__dirname, "..", "fixtures", "v1-shape.sql"), "utf8");
const quiet = { info() {}, warn() {} };
const created: string[] = [];
afterEach(async () => {
  while (created.length) await dropDb(created.pop()!);
});
async function fresh() {
  const name = await scratchDb();
  created.push(name);
  return connect(dbUrl(name));
}

describe.skipIf(!hasPg)("migrations", () => {
  it("creates a fresh database and is idempotent", async () => {
    const c = await fresh();
    try {
      const r = await migrate(c, { log: quiet });
      expect(r).toEqual({ baselined: false, applied: readMigrations().map((m: { tag: string }) => m.tag) });
      expect(await migrate(c, { log: quiet })).toEqual({ baselined: false, applied: [] });
      const s = await migrationStatus(c);
      expect(s.pending).toEqual([]);
      const { rows } = await c.query("SELECT to_regclass('public.task_runs') t, to_regclass('public.session') s");
      expect(rows[0].t).not.toBeNull();
      expect(rows[0].s).not.toBeNull();
    } finally {
      await c.end();
    }
  });

  it("baselines a 1.x database without touching its data", async () => {
    const c = await fresh();
    try {
      await c.query(V1);
      expect((await migrationStatus(c)).baseline).toBe("needed");
      const r = await migrate(c, { log: quiet });
      expect(r.baselined).toBe(true);
      expect(r.applied).toEqual(["0001_runs_and_session"]);
      const tasks = await c.query("SELECT id, status FROM tasks ORDER BY id");
      expect(tasks.rows).toEqual([
        { id: 46, status: "running" },
        { id: 57, status: "running" },
        { id: 60, status: "success" },
      ]);
      expect((await c.query("SELECT count(*)::int n FROM session")).rows[0].n).toBe(1);
      expect((await c.query("SELECT count(*)::int n FROM users")).rows[0].n).toBe(1);
      expect((await migrationStatus(c)).baseline).toBe("none");
    } finally {
      await c.end();
    }
  });

  it("refuses a partial schema", async () => {
    const c = await fresh();
    try {
      await c.query('CREATE TABLE users (id serial primary key, username text, password text)');
      await expect(migrate(c, { log: quiet })).rejects.toThrow(/refusing to guess/);
    } finally {
      await c.end();
    }
  });
});
