/**
 * Prints the most recent audit events. Diagnostic helper — confirms the trail is
 * actually being written, which is the whole point of moving it off console.log.
 *
 *   npx tsx scripts/show-audit-log.ts [limit]
 */
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
import { auditEvents } from '@shared/schema';
import { desc } from 'drizzle-orm';

async function main() {
  const limit = Number.parseInt(process.argv[2] ?? '20', 10);
  const db = getDb() as any;

  const rows = await db
    .select()
    .from(auditEvents)
    .orderBy(desc(auditEvents.occurredAt))
    .limit(limit);

  if (!rows.length) {
    console.log('No audit events recorded yet.');
    process.exit(0);
  }

  console.log(`${rows.length} most recent audit event(s):\n`);
  for (const row of rows) {
    const actor = row.actorUsername ?? 'anonymous';
    const status = row.statusCode ?? '?';
    console.log(
      `  ${new Date(row.occurredAt).toISOString()}  ${String(status).padEnd(3)}  ` +
      `${row.action.padEnd(24)} ${actor.padEnd(14)} ${row.method} ${row.path}`
    );
  }
  process.exit(0);
}

main();
