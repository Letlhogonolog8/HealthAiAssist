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

async function main() {
  const db = getDb() as any;
  for (const table of ['session', 'sessions']) {
    try {
      const r = await db.execute(sql.raw(
        `SELECT COUNT(*)::int AS n FROM "${table}"`
      ));
      const n = (r.rows ?? r)[0]?.n;
      console.log(`${table}: ${n} row(s)`);
      const rows = await db.execute(sql.raw(
        `SELECT sid, sess::text AS sess FROM "${table}" ORDER BY expire DESC LIMIT 2`
      ));
      for (const row of (rows.rows ?? rows)) {
        const parsed = JSON.parse(row.sess);
        console.log(`   ${String(row.sid).slice(0, 24)}  userId=${parsed.userId ?? 'none'} user=${parsed.user ? parsed.user.username : 'none'}`);
      }
    } catch (e: any) {
      console.log(`${table}: ${e.message.split('\n')[0]}`);
    }
  }
  process.exit(0);
}
main();
