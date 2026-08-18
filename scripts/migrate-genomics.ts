/**
 * Applies an additive SQL migration file.
 *
 * Defaults to migrations/genomics-tables.sql; pass a different filename as the
 * first argument (see the db:migrate-traceability script).
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
  const fileName = process.argv[2] || 'genomics-tables.sql';
  const file = path.join(process.cwd(), 'migrations', fileName);
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
  console.log(`Applying ${fileName}...`);

  try {
    // Executed as one script so the DO $$ ... $$ blocks stay intact — splitting
    // on semicolons would cut them in half.
    await db.execute(sql.raw(script));
    console.log('Done. Tables, columns, foreign keys and indexes are in place.');
  } catch (error) {
    console.error('Migration failed:', error instanceof Error ? error.message : error);
    process.exit(1);
  }

  process.exit(0);
}

main();
