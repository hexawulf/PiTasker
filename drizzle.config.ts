import { defineConfig } from "drizzle-kit";
import { pgTable } from "drizzle-orm/pg-core";
// not from "drizzle-orm/neon-serverless"

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

export default defineConfig({
  out: "./migrations",
  schema: "./shared/schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
});
