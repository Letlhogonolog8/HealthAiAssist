/** Prints which genomics tables exist and their columns. Diagnostic helper. */
import 'dotenv/config';
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
