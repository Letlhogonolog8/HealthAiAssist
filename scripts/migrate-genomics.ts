/**
 * Applies migrations/genomics-tables.sql.
 *
 * Additive and idempotent — every statement is guarded, so re-running is safe.
 * Kept separate from `db:push` because push compares the whole schema and can
 * propose destructive changes against a database that predates migrations.
 */
import fs from 'fs';
import path from 'path';
import 'dotenv/config';
import { getDb } from '../server/db';
import { sql } from 'drizzle-orm';

async function main() {
  const file = path.join(process.cwd(), 'migrations', 'genomics-tables.sql');
  if (!fs.existsSync(file)) {
    console.error(`Migration file not found: ${file}`);
    process.exit(1);
  }

  const db = getDb() as any;
  if (!db) {
    console.error('No database connection. Is DATABASE_URL set?');
    process.exit(1);
  }

  const script = fs.readFileSync(file, 'utf-8');
  console.log('Applying genomics tables...');

  try {
    // Executed as one script so the DO $$ ... $$ blocks stay intact — splitting
    // on semicolons would cut them in half.
    await db.execute(sql.raw(script));
    console.log('Done. Tables, foreign keys and indexes are in place.');
  } catch (error) {
    console.error('Migration failed:', error instanceof Error ? error.message : error);
    process.exit(1);
  }

  process.exit(0);
}

main();
