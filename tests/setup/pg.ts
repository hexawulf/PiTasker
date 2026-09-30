// Real-Postgres helpers for *.db.test.ts. Every scratch database is named
// pitasker_test_* and dropped by the test that created it.
import pg from "pg";

export const ADMIN_URL = process.env.PITASKER_TEST_PG_URL ?? "";
export const hasPg = ADMIN_URL !== "";

export function dbUrl(name: string) {
  const u = new URL(ADMIN_URL);
  u.pathname = `/${name}`;
  return u.toString();
}

export async function connect(url: string) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  return c;
}

let n = 0;
export async function scratchDb(): Promise<string> {
  const name = `pitasker_test_${process.pid}_${Date.now().toString(36)}_${n++}`;
  const admin = await connect(ADMIN_URL);
  try {
    await admin.query(`CREATE DATABASE "${name}"`);
  } finally {
    await admin.end();
  }
  return name;
}

export async function dropDb(name: string) {
  const admin = await connect(ADMIN_URL);
  try {
    await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  } finally {
    await admin.end();
  }
}
