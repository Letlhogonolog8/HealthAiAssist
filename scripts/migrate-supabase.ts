/**
 * Provisions a Supabase (or any empty Postgres) database for this app.
 *
 *   1. Creates the full schema — every table, foreign key and index.
 *   2. Enables row level security and revokes the PostgREST role grants.
 *
 * Both steps are idempotent, so re-running is safe.
 *
 *   npm run db:migrate-supabase
 *
 * Reads DATABASE_URL. For Supabase that is the Postgres connection string from
 * Project Settings > Database — NOT the project URL, and NOT the anon key. Those
 * are for the PostgREST API, which this app does not use.
 */
import fs from 'fs';
import path from 'path';
import 'dotenv/config';
import { Pool } from 'pg';

const FILES = ['0000_supabase_baseline.sql', 'supabase-rls.sql'];

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set.');
    process.exit(1);
  }

  const host = url.replace(/\/\/[^@]*@/, '//<credentials>@');
  console.log(`Target: ${host}`);

  if (/localhost|127\.0\.0\.1/.test(url)) {
    console.warn(
      'WARNING: DATABASE_URL points at localhost, not Supabase. ' +
      'Update it before running this if you meant to migrate Supabase.'
    );
  }

  const pool = new Pool({
    connectionString: url,
    ssl: /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false },
    connectionTimeoutMillis: 15000,
  });

  try {
    for (const name of FILES) {
      const file = path.join(process.cwd(), 'migrations', name);
      if (!fs.existsSync(file)) {
        console.error(`Missing migration file: ${file}`);
        process.exit(1);
      }
      console.log(`Applying ${name}...`);
      await pool.query(fs.readFileSync(file, 'utf-8'));
      console.log(`  done`);
    }

    // Verify, rather than trusting that the statements did what they claim.
    const { rows: tables } = await pool.query(
      `SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname='public' ORDER BY tablename`
    );
    console.log('\nTables and row level security:');
    const unprotected: string[] = [];
    for (const row of tables) {
      console.log(`  ${row.rowsecurity ? 'RLS on ' : 'RLS OFF'}  ${row.tablename}`);
      if (!row.rowsecurity) unprotected.push(row.tablename);
    }

    if (unprotected.length) {
      console.error(
        `\nWARNING: ${unprotected.length} table(s) have RLS disabled and are ` +
        `readable through the public anon key: ${unprotected.join(', ')}`
      );
      process.exitCode = 1;
    } else {
      console.log('\nAll tables protected. The anon key cannot read them.');
    }
  } catch (error) {
    console.error('Migration failed:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
