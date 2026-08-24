/**
 * Shows recorded cross-border transfers to the external AI processor.
 *
 *   npx tsx scripts/show-transfer-log.ts
 *
 * This is the record a POPIA impact assessment is written against: who, when,
 * what category of content, and what was stripped before it left.
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
import { desc, eq } from 'drizzle-orm';

async function main() {
  const db = getDb() as any;
  const rows = await db
    .select()
    .from(auditEvents)
    .where(eq(auditEvents.action, 'EXTERNAL_AI_TRANSFER'))
    .orderBy(desc(auditEvents.occurredAt))
    .limit(Number.parseInt(process.argv[2] ?? '10', 10));

  if (!rows.length) {
    console.log('No external transfers recorded.');
    process.exit(0);
  }

  console.log(`${rows.length} transfer(s), most recent first:\n`);
  for (const row of rows) {
    const d = row.detail ? JSON.parse(row.detail) : {};
    console.log(
      `  ${new Date(row.occurredAt).toISOString()}  user=${row.actorUserId ?? '?'}  ` +
      `-> ${d.recipient}  model=${d.model}  msgs=${d.messages}  ` +
      `redacted=[${(d.redacted ?? []).join(', ') || 'none'}]  ` +
      `clinicalContext=${d.clinicalContextIncluded}`
    );
  }
  process.exit(0);
}
main();
