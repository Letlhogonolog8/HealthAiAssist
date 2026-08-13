/**
 * Reports what DATABASE_URL actually points at, whether it connects, and — on
 * Supabase — whether the public anon key can read your tables.
 *
 *   npm run db:check
 *
 * The anon-key probe is the important part. A Supabase table without RLS is
 * readable by anyone holding that key, and the key is public by design.
 */
import 'dotenv/config';
import { Pool } from 'pg';

function redact(url: string): string {
  return url.replace(/\/\/([^:]+):([^@]*)@/, '//$1:<redacted>@');
}

async function probeAnonExposure(): Promise<void> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    console.log('\nAnon-key exposure probe skipped (SUPABASE_URL / key not set).');
    return;
  }

  const tables = ['users', 'medical_scans', 'genomic_variants', 'genomic_profiles'];
  console.log('\nProbing whether the public anon key can read your tables:');
  let exposed = 0;

  for (const table of tables) {
    try {
      const res = await fetch(`${url}/rest/v1/${table}?select=*&limit=1`, {
        headers: { apikey: key, Authorization: `Bearer ${key}` },
      });
      if (res.ok) {
        const body = (await res.json()) as unknown[];
        console.log(`  EXPOSED  ${table} — anon key returned ${body.length} row(s)`);
        exposed++;
      } else {
        console.log(`  blocked  ${table} (HTTP ${res.status})`);
      }
    } catch {
      console.log(`  blocked  ${table} (request failed)`);
    }
  }

  if (exposed) {
    console.error(
      `\nCRITICAL: ${exposed} table(s) are readable with the public anon key. ` +
      'Run: npm run db:migrate-supabase'
    );
    process.exitCode = 1;
  } else {
    console.log('  No table was readable with the anon key.');
  }
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set.');
    process.exit(1);
  }

  console.log(`DATABASE_URL: ${redact(url)}`);
  const isLocal = /localhost|127\.0\.0\.1/.test(url);
  const isSupabase = /supabase\.(co|com)/.test(url);
  console.log(`Target looks like: ${isSupabase ? 'Supabase' : isLocal ? 'local Postgres' : 'remote Postgres'}`);

  const pool = new Pool({
    connectionString: url,
    ssl: isLocal ? false : { rejectUnauthorized: false },
    connectionTimeoutMillis: 15000,
  });

  try {
    const { rows } = await pool.query(
      `SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname='public' ORDER BY tablename`
    );
    console.log(`\nConnected. ${rows.length} table(s) in public schema:`);
    for (const row of rows) {
      console.log(`  ${row.rowsecurity ? 'RLS on ' : 'RLS OFF'}  ${row.tablename}`);
    }
  } catch (error) {
    console.error(`\nConnection FAILED: ${error instanceof Error ? error.message : error}`);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }

  await probeAnonExposure();
}

main();
