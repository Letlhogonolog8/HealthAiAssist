/** Prints which genomics tables exist and their columns. Diagnostic helper. */
/**
 * `../server/load-env` rather than `dotenv/config`.
 *
 * dotenv's default is that an already-set variable wins, so on a machine
 * carrying a Machine- or User-scope DATABASE_URL from another project this
 * script silently talked to that database instead of the one in .env — or, when
 * the credentials did not match, failed with "received invalid response: 4a"
 * from the SCRAM handshake. load-env overrides from the file in development,
 * which is what every other entry point in this project uses.
 */
import '../server/load-env';
import { getDb } from '../server/db';
import { sql } from 'drizzle-orm';

const TABLES = [
  'genomic_consents',
  'genomic_profiles',
  'genomic_variants',
  'genomic_risk_assessments',
  'genomic_access_log',
];

async function main() {
  const db = getDb() as any;
  const all = await db.execute(
    sql.raw(`SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY 1`)
  );
  const names = (all.rows ?? all).map((r: any) => r.table_name);
  console.log('All tables:', names.join(', '));

  for (const table of TABLES) {
    const cols = await db.execute(
      sql.raw(
        `SELECT column_name FROM information_schema.columns WHERE table_name='${table}' ORDER BY ordinal_position`
      )
    );
    const list = (cols.rows ?? cols).map((r: any) => r.column_name);
    console.log(`${table}: ${list.length ? list.join(', ') : '(does not exist)'}`);
  }
  process.exit(0);
}

main();
