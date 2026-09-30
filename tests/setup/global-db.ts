// Once per `vitest run`: a scratch database for the *.db.test.ts suites.
//   PITASKER_TEST_PG_URL = an admin URL allowed to CREATE/DROP DATABASE, e.g.
//   postgres://postgres:postgres@127.0.0.1:5432/postgres
// The scratch database is always named pitasker_test_* (server/db.ts refuses
// anything else under VITEST) and is dropped afterwards.
import pg from "pg";
// @ts-expect-error — plain ESM helper shared with scripts/migrate.mjs
import { migrate } from "../../scripts/migrate-core.mjs";

let name = "";

function withDb(url: string, db: string) {
  const u = new URL(url);
  u.pathname = `/${db}`;
  return u.toString();
}

export async function setup() {
  const admin = process.env.PITASKER_TEST_PG_URL;
  if (!admin) {
    console.warn("[db-tests] PITASKER_TEST_PG_URL is not set: database suites are skipped");
    return;
  }
  name = `pitasker_test_${process.pid}_${Date.now().toString(36)}`;
  const c = new pg.Client({ connectionString: admin });
  await c.connect();
  await c.query(`CREATE DATABASE "${name}"`);
  await c.end();
  const url = withDb(admin, name);
  const m = new pg.Client({ connectionString: url });
  await m.connect();
  await migrate(m, { log: { info() {}, warn() {} } });
  await m.end();
  process.env.PITASKER_TEST_DATABASE_URL = url;
}

export async function teardown() {
  const admin = process.env.PITASKER_TEST_PG_URL;
  if (!admin || !name) return;
  const c = new pg.Client({ connectionString: admin });
  await c.connect();
  await c.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  await c.end();
}
