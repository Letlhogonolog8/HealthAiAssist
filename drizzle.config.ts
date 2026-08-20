import { config as loadEnv } from "dotenv";
import { defineConfig } from "drizzle-kit";

// This file read process.env directly and never loaded .env, so drizzle-kit
// followed whatever DATABASE_URL the shell happened to carry. Pointing .env at
// a new database and running `db:push` therefore aimed the schema at the old
// one: a push meant for an empty Supabase project instead offered to truncate
// the users table of a local database holding 38 accounts.
//
// Same rule as server/index.ts: in development the file wins, and in production
// the deployment's own variables are left untouched.
if (process.env.NODE_ENV !== "production") {
  const parsed = loadEnv().parsed ?? {};
  if (parsed.DATABASE_URL) process.env.DATABASE_URL = parsed.DATABASE_URL;
}

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
