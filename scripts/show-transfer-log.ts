/**
 * Shows recorded cross-border transfers to the external AI processor.
 *
 *   npx tsx scripts/show-transfer-log.ts
 *
 * This is the record a POPIA impact assessment is written against: who, when,
 * what category of content, and what was stripped before it left.
 */
import 'dotenv/config';
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
