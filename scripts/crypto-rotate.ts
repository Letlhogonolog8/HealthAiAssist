/**
 * Backfill and key rotation for encrypted columns.
 *
 * One script for both jobs, because they are the same job: bring every row up to
 * the active key. A plaintext row and a row encrypted under a retired key both
 * need rewriting, and both are found the same way.
 *
 *   npm run crypto:status    what is encrypted, under which key, and what is not
 *   npm run crypto:backfill  seal plaintext and re-seal old keys (writes)
 *   npm run crypto:rotate    same thing; a separate name for the rotation case
 *
 * Safe to interrupt and safe to re-run. Each row is read, transformed and
 * written in its own statement; there is no global transaction, so stopping
 * halfway leaves a mixture of sealed and unsealed rows, which is a state the
 * application already reads correctly. That is a deliberate trade: a single
 * transaction over a large table would hold locks for the duration and would
 * have to start again from nothing.
 *
 * ── Rotating a key ─────────────────────────────────────────────────────────
 *
 *   1. node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 *   2. ENCRYPTION_KEYS=k1:<old>,k2:<new>   (keep the old key)
 *      ENCRYPTION_ACTIVE_KEY_ID=k2
 *   3. Restart. New writes use k2; existing rows still decrypt under k1.
 *   4. npm run crypto:rotate
 *   5. npm run crypto:status — when nothing remains on k1, remove k1.
 *
 * Step 5 is the only irreversible step, which is why it is gated on a count
 * rather than on elapsed time. Removing a key that still has rows makes those
 * rows permanently unreadable.
 */
import '../server/load-env';

import { pool } from '../server/db';
import { ENCRYPTED_FIELDS, EXCLUDED_FIELDS } from '../server/crypto/encrypted-fields';
import { envelopeKeyId, isEnvelope, reseal } from '../server/crypto/envelope';
import { keyringStatus, loadKeyring } from '../server/crypto/keyring';

/** Rows read per batch. Small enough to stay well inside memory on any host. */
const BATCH = 500;

interface ColumnPlan {
  table: string;
  column: string;
  why: string;
}

const PLAN: ColumnPlan[] = ENCRYPTED_FIELDS.map((field) => ({
  table: field.table,
  column: field.column,
  why: field.why,
}));

async function tableExists(table: string): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1`,
    [table]
  );
  return rows.length > 0;
}

/** Counts, per column, how many values sit in each state. */
async function inspect(): Promise<void> {
  const status = keyringStatus();
  console.log('Keyring:', status.configured
    ? `${status.keyCount} key(s), active = ${status.activeKeyId}`
    : `NOT CONFIGURED (${status.error})`);
  console.log('');

  const header = 'table.column'.padEnd(46) + 'rows'.padStart(8) + 'plaintext'.padStart(11) + '  by key';
  console.log(header);
  console.log('-'.repeat(header.length + 12));

  for (const { table, column } of PLAN) {
    if (!(await tableExists(table))) {
      console.log(`${`${table}.${column}`.padEnd(46)}${'—'.padStart(8)}  (table absent)`);
      continue;
    }

    const { rows } = await pool.query(
      `SELECT id, "${column}" AS value FROM "${table}" WHERE "${column}" IS NOT NULL AND "${column}" <> ''`
    );

    let plaintext = 0;
    const byKey = new Map<string, number>();
    for (const row of rows) {
      if (!isEnvelope(row.value)) {
        plaintext += 1;
        continue;
      }
      const keyId = envelopeKeyId(row.value) ?? 'unknown';
      byKey.set(keyId, (byKey.get(keyId) ?? 0) + 1);
    }

    const distribution = byKey.size
      ? [...byKey.entries()].map(([k, n]) => `${k}=${n}`).join(' ')
      : '—';

    console.log(
      `${`${table}.${column}`.padEnd(46)}${String(rows.length).padStart(8)}${String(plaintext).padStart(11)}  ${distribution}`
    );
  }

  console.log('');
  console.log('Deliberately NOT encrypted:');
  for (const excluded of EXCLUDED_FIELDS) {
    console.log(`  ${excluded.field}`);
    console.log(`    ${excluded.reason.replace(/\s+/g, ' ').slice(0, 300)}`);
  }
}

/** Brings every value in one column up to the active key. */
async function rewriteColumn({ table, column }: ColumnPlan): Promise<{ sealed: number; rotated: number }> {
  let sealed = 0;
  let rotated = 0;
  let lastId = 0;

  for (;;) {
    // Keyset pagination on the primary key. OFFSET would re-scan the table on
    // every batch and, worse, shift under us as rows are rewritten.
    const { rows } = await pool.query(
      `SELECT id, "${column}" AS value
         FROM "${table}"
        WHERE id > $1 AND "${column}" IS NOT NULL AND "${column}" <> ''
        ORDER BY id
        LIMIT ${BATCH}`,
      [lastId]
    );

    if (rows.length === 0) break;

    for (const row of rows) {
      lastId = row.id;

      const wasPlaintext = !isEnvelope(row.value);
      const rewritten = reseal(row.value);
      // null means it was already under the active key.
      if (rewritten === null) continue;

      await pool.query(`UPDATE "${table}" SET "${column}" = $1 WHERE id = $2`, [rewritten, row.id]);
      if (wasPlaintext) sealed += 1;
      else rotated += 1;
    }
  }

  return { sealed, rotated };
}

async function rewriteAll(): Promise<void> {
  const keyring = loadKeyring();
  console.log(`Bringing every encrypted column up to key "${keyring.active.id}".`);
  console.log('');

  let totalSealed = 0;
  let totalRotated = 0;

  for (const plan of PLAN) {
    if (!(await tableExists(plan.table))) {
      console.log(`  ${plan.table}.${plan.column}: table absent, skipped`);
      continue;
    }

    const { sealed, rotated } = await rewriteColumn(plan);
    totalSealed += sealed;
    totalRotated += rotated;

    const summary =
      sealed === 0 && rotated === 0
        ? 'already current'
        : [sealed ? `${sealed} sealed` : null, rotated ? `${rotated} rotated` : null]
            .filter(Boolean)
            .join(', ');
    console.log(`  ${`${plan.table}.${plan.column}`.padEnd(46)} ${summary}`);
  }

  console.log('');
  console.log(`Done. ${totalSealed} value(s) newly sealed, ${totalRotated} re-encrypted.`);
  console.log('Run `npm run crypto:status` to confirm nothing remains on a retired key');
  console.log('before removing it from ENCRYPTION_KEYS.');
}

async function main(): Promise<void> {
  const mode = process.argv[2] ?? 'status';

  try {
    if (mode === 'status') {
      await inspect();
    } else if (mode === 'apply') {
      if (!keyringStatus().configured) {
        console.error('No encryption key configured. Set ENCRYPTION_KEY or ENCRYPTION_KEYS.');
        process.exitCode = 1;
        return;
      }
      await rewriteAll();
    } else {
      console.error(`Unknown mode "${mode}". Use "status" or "apply".`);
      process.exitCode = 1;
    }
  } catch (error) {
    console.error('Failed:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
