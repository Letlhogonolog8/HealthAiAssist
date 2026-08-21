/**
 * Applies an additive SQL migration file.
 *
 * Defaults to migrations/genomics-tables.sql; pass a different filename as the
 * first argument (see the db:migrate-traceability, db:migrate-chatbot-privacy
 * and db:migrate-notifications scripts). The name is historical — it runs any
 * file in migrations/, not just the genomics one — and is kept because the npm
 * scripts and the deployment docs refer to it.
 *
 * Additive and idempotent — every statement is guarded, so re-running is safe.
 * Kept separate from `db:push` because push compares the whole schema and can
 * propose destructive changes against a database that predates migrations.
 */
import fs from 'fs';
import path from 'path';
import '../server/load-env';
import { pool } from '../server/db';

async function main() {
  const fileName = process.argv[2] || 'genomics-tables.sql';
  const file = path.join(process.cwd(), 'migrations', fileName);
  if (!fs.existsSync(file)) {
    console.error(`Migration file not found: ${file}`);
    process.exit(1);
  }

  const script = fs.readFileSync(file, 'utf-8');
  console.log(`Applying ${fileName}...`);

  // Straight to the pg pool, not drizzle's db.execute().
  //
  // db.execute(sql.raw(script)) sends the statement over the extended query
  // protocol, which permits exactly one statement per message. Every migration
  // file here is a script of many, so all four of them failed identically with
  // "received invalid response: 4a" — including the ones the deployment guide
  // tells you to run on a fresh database. pool.query() with a plain string uses
  // the simple protocol, which is what a multi-statement script needs, and it
  // keeps the DO $$ ... $$ blocks intact instead of splitting on semicolons.
  const client = await pool.connect();
  try {
    // One transaction: a file that fails halfway leaves nothing behind rather
    // than a schema that is neither the old shape nor the new one.
    await client.query('BEGIN');
    await client.query(script);
    await client.query('COMMIT');
    console.log('Done. Tables, columns, foreign keys and indexes are in place.');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Migration failed:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
