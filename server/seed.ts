// npm run db:seed — create the admin user if there is none.
//   PITASKER_ADMIN_PASSWORD set → that password (rules: server/auth.ts)
//   otherwise                   → a random one, printed once
// (1.x seeded a fixed password that was in the repository.)
import "dotenv/config";
import crypto from "crypto";
import pg from "pg";
import { hashPassword, passwordProblem } from "./auth";

async function seed() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set.");
    process.exit(1);
  }
  const username = process.env.PITASKER_ADMIN_USER || "admin";
  const given = process.env.PITASKER_ADMIN_PASSWORD;
  const password = given || crypto.randomBytes(18).toString("base64url");
  const problem = given ? passwordProblem(given, { username }) : null;
  if (problem) {
    console.error(`PITASKER_ADMIN_PASSWORD: ${problem}`);
    process.exit(1);
  }
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const { rows } = await client.query("SELECT 1 FROM users WHERE username = $1", [username]);
    if (rows.length > 0) {
      console.log(`User "${username}" already exists. Nothing to do.`);
      return;
    }
    await client.query("INSERT INTO users (username, password) VALUES ($1, $2)", [username, await hashPassword(password)]);
    console.log(`Created user "${username}".`);
    if (!given) console.log(`Password (shown once): ${password}`);
  } finally {
    await client.end();
  }
}

seed().catch((e) => {
  console.error("Seeding failed:", e.message);
  process.exit(1);
});
