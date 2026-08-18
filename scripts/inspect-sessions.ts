import 'dotenv/config';
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
