import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "@shared/schema";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set. Did you forget to provision a database?");
}

// Tests must never reach a real database: under vitest/E2E only scratch
// databases (pitasker_test_* / pitasker_e2e*) are accepted.
function assertTestDatabase(url: string) {
  if (!process.env.VITEST && !process.env.PITASKER_E2E) return;
  let name = "";
  try {
    name = new URL(url).pathname.replace(/^\//, "");
  } catch {
    /* falls through to the refusal */
  }
  if (!/^pitasker_(test|e2e)/.test(name)) {
    throw new Error(`refusing database "${name}" in a test run (expected pitasker_test_* or pitasker_e2e*)`);
  }
}
assertTestDatabase(process.env.DATABASE_URL);

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
  idleTimeoutMillis: 30_000,
});

export const db = drizzle(pool, { schema });
