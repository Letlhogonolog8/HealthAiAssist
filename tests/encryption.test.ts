/**
 * At-rest encryption: the envelope, the keyring, and rotation.
 *
 * The property that matters most is the one that is easiest to lose: ciphertext
 * has to record which key produced it. Without that, changing the key strands
 * every existing row, so in practice the key never changes and a compromised key
 * stays in service. It cannot be retrofitted either — a ciphertext written
 * without a key id has nowhere to put one. So the rotation path is tested here
 * rather than being left as a documented intention.
 *
 * These tests run in-process against the crypto modules and a scratch table.
 * They set ENCRYPTION_KEYS themselves, so they do not depend on how the machine
 * running them is configured.
 */
import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import { db } from './helpers/server.ts';

import {
  envelopeKeyId,
  isEnvelope,
  open,
  reseal,
  seal,
} from '../server/crypto/envelope.ts';
import { keyringStatus, loadKeyring, resetKeyringCache } from '../server/crypto/keyring.ts';
import { decryptRow, encryptRow } from '../server/crypto/index.ts';
import { ENCRYPTED_FIELDS, EXCLUDED_FIELDS } from '../server/crypto/encrypted-fields.ts';

const KEY_A = crypto.randomBytes(32).toString('hex');
const KEY_B = crypto.randomBytes(32).toString('hex');

/** Points the keyring at a given configuration for the next call. */
function useKeys(keys: string, activeId?: string) {
  process.env.ENCRYPTION_KEYS = keys;
  if (activeId) process.env.ENCRYPTION_ACTIVE_KEY_ID = activeId;
  else delete process.env.ENCRYPTION_ACTIVE_KEY_ID;
  delete process.env.ENCRYPTION_KEY;
  resetKeyringCache();
}

const savedEnv = {
  keys: process.env.ENCRYPTION_KEYS,
  key: process.env.ENCRYPTION_KEY,
  active: process.env.ENCRYPTION_ACTIVE_KEY_ID,
};

beforeEach(() => useKeys(`k1:${KEY_A}`));

after(() => {
  process.env.ENCRYPTION_KEYS = savedEnv.keys;
  process.env.ENCRYPTION_KEY = savedEnv.key;
  process.env.ENCRYPTION_ACTIVE_KEY_ID = savedEnv.active;
  resetKeyringCache();
});

// ---------------------------------------------------------------------------

describe('the envelope', () => {
  test('round trips, and does not repeat itself', () => {
    const secret = 'Adenocarcinoma confirmed on resection, margins clear.';

    const first = seal(secret) as string;
    const second = seal(secret) as string;

    assert.equal(open(first), secret);
    assert.notEqual(
      first,
      second,
      'identical plaintext must not produce identical ciphertext — that would reveal ' +
        'that two patients share a diagnosis without decrypting anything'
    );
  });

  test('announces itself, so a value can be classified without a key', () => {
    const sealed = seal('note') as string;
    assert.ok(isEnvelope(sealed));
    assert.ok(!isEnvelope('note'));
    assert.ok(sealed.startsWith('enc:v1:'));
  });

  test('records the key that produced it', () => {
    assert.equal(envelopeKeyId(seal('note')), 'k1');
    assert.equal(envelopeKeyId('plain text'), null);
  });

  test('null, undefined and empty pass through untouched', () => {
    assert.equal(seal(null), null);
    assert.equal(seal(undefined), undefined);
    assert.equal(seal(''), '');
    assert.equal(open(null), null);
    assert.equal(open(''), '');
  });

  test('sealing twice does not nest', () => {
    const once = seal('note') as string;
    assert.equal(seal(once), once);
  });

  test('reading tolerates plaintext', () => {
    // This is what allows encryption to be switched on over a live table without
    // rewriting it first.
    assert.equal(open('written before encryption was enabled'), 'written before encryption was enabled');
  });

  test('tampering is detected', () => {
    const sealed = seal('Adenocarcinoma confirmed.') as string;
    const parts = sealed.split(':');

    // Flip a bit in the decoded bytes, not a character in the base64url text.
    // Editing the final character is not reliably a change at all: when the
    // payload length is not a multiple of three, the last character carries
    // padding bits, so two different characters can decode to identical bytes
    // and the "tampered" ciphertext is the original. That made this test pass
    // most runs and fail some, which is the worst kind of test.
    const body = Buffer.from(parts[5], 'base64url');
    body[0] ^= 0xff;
    assert.throws(() => open([...parts.slice(0, 5), body.toString('base64url')].join(':')));

    // Relabelling the key id must fail too: the id is bound into the AAD.
    useKeys(`k1:${KEY_A},k2:${KEY_A}`, 'k1');
    assert.throws(
      () => open([parts[0], parts[1], 'k2', parts[3], parts[4], parts[5]].join(':')),
      'a ciphertext must not authenticate under a different key id'
    );
  });

  test('a wrong key is rejected rather than yielding rubbish', () => {
    const sealed = seal('Adenocarcinoma confirmed.') as string;
    useKeys(`k1:${KEY_B}`);
    assert.throws(() => open(sealed));
  });
});

describe('the keyring', () => {
  test('rejects malformed keys instead of stretching them', () => {
    useKeys('k1:abc');
    assert.throws(() => loadKeyring(), /64 hex/);
  });

  test('rejects duplicate key ids', () => {
    useKeys(`k1:${KEY_A},k1:${KEY_B}`);
    assert.throws(() => loadKeyring(), /duplicate/);
  });

  test('rejects an active id that is not in the ring', () => {
    useKeys(`k1:${KEY_A}`, 'k9');
    assert.throws(() => loadKeyring(), /not present/);
  });

  test('a single ENCRYPTION_KEY still works, as key k1', () => {
    delete process.env.ENCRYPTION_KEYS;
    delete process.env.ENCRYPTION_ACTIVE_KEY_ID;
    process.env.ENCRYPTION_KEY = KEY_A;
    resetKeyringCache();

    assert.equal(loadKeyring().active.id, 'k1');
    assert.equal(envelopeKeyId(seal('note')), 'k1');
  });

  test('status reports ids, never key material', () => {
    useKeys(`k1:${KEY_A},k2:${KEY_B}`, 'k2');
    const status = keyringStatus();

    assert.equal(status.configured, true);
    assert.equal(status.activeKeyId, 'k2');
    assert.equal(status.keyCount, 2);
    assert.ok(!JSON.stringify(status).includes(KEY_A), 'key material must not appear in status');
    assert.ok(!JSON.stringify(status).includes(KEY_B), 'key material must not appear in status');
  });
});

describe('rotation', () => {
  test('an old key still decrypts after the active key changes', () => {
    const sealed = seal('Confirmed on histopathology.') as string;
    assert.equal(envelopeKeyId(sealed), 'k1');

    // The rotation state: both keys present, the new one active.
    useKeys(`k1:${KEY_A},k2:${KEY_B}`, 'k2');

    assert.equal(open(sealed), 'Confirmed on histopathology.', 'old rows must stay readable');
    assert.equal(envelopeKeyId(seal('new note')), 'k2', 'new writes use the new key');
  });

  test('reseal moves a value to the active key and is idempotent', () => {
    const underK1 = seal('Granuloma.') as string;
    useKeys(`k1:${KEY_A},k2:${KEY_B}`, 'k2');

    const moved = reseal(underK1);
    assert.ok(moved, 'a value on an old key needs rewriting');
    assert.equal(envelopeKeyId(moved!), 'k2');
    assert.equal(open(moved!), 'Granuloma.');

    assert.equal(reseal(moved!), null, 'a value already on the active key needs no work');
  });

  test('reseal seals plaintext, which is the backfill case', () => {
    const sealed = reseal('a note written before encryption existed');
    assert.ok(sealed && isEnvelope(sealed));
    assert.equal(open(sealed), 'a note written before encryption existed');
  });

  test('retiring a key that still has rows fails loudly', () => {
    const underK1 = seal('Adenocarcinoma.') as string;
    // k1 removed before the rotation finished.
    useKeys(`k2:${KEY_B}`, 'k2');

    assert.throws(
      () => open(underK1),
      /not in the keyring/,
      'the error must name the missing key and say what to do'
    );
  });
});

describe('the field manifest', () => {
  test('every encrypted field names why', () => {
    for (const field of ENCRYPTED_FIELDS) {
      assert.ok(field.why.length > 20, `${field.table}.${field.column} needs a reason`);
    }
  });

  test('every exclusion is justified, not merely absent', () => {
    // An undocumented omission is indistinguishable from an oversight, and this
    // is the list an auditor reads first.
    assert.ok(EXCLUDED_FIELDS.length > 0);
    for (const excluded of EXCLUDED_FIELDS) {
      assert.ok(excluded.reason.length > 40, `${excluded.field} needs a reason`);
    }
  });

  test('the login lookup columns are not encrypted', () => {
    // Encrypting these would break getUserByUsername / getUserByEmail, which run
    // on every login. If someone adds them, this fails before production does.
    const encrypted = ENCRYPTED_FIELDS.map((f) => `${f.table}.${f.column}`);
    assert.ok(!encrypted.includes('users.username'));
    assert.ok(!encrypted.includes('users.email'));
  });

  test('row helpers only touch properties that are present', () => {
    // A partial update must not null out a column it never mentioned.
    const partial = encryptRow('users', { fullName: 'Thandi Mokoena' });
    assert.deepEqual(Object.keys(partial), ['fullName']);
    assert.equal(partial.fullName, 'Thandi Mokoena', 'fullName is not an encrypted field');

    const withAddress = encryptRow('users', { address: '12 Long Street' });
    assert.ok(isEnvelope(withAddress.address));
    assert.equal(decryptRow('users', withAddress).address, '12 Long Street');
  });

  test('an explicit null stays null rather than becoming ciphertext', () => {
    const cleared = encryptRow('users', { address: null });
    assert.equal(cleared.address, null);
  });
});

describe('through the database', () => {
  const TABLE = 'zz_crypto_probe';

  before(async () => {
    const pool = db();
    try {
      await pool.query(`CREATE TABLE IF NOT EXISTS ${TABLE} (id serial PRIMARY KEY, notes text)`);
      await pool.query(`TRUNCATE ${TABLE}`);
    } finally {
      await pool.end();
    }
  });

  after(async () => {
    const pool = db();
    try {
      await pool.query(`DROP TABLE IF EXISTS ${TABLE}`);
    } finally {
      await pool.end();
    }
  });

  test('what lands on disk is ciphertext, and it comes back as plaintext', async () => {
    const pool = db();
    try {
      const note = 'Spiculated mass, upper left lobe. Biopsy scheduled.';
      await pool.query(`INSERT INTO ${TABLE} (notes) VALUES ($1)`, [seal(note)]);

      const { rows } = await pool.query(`SELECT notes FROM ${TABLE}`);
      const stored = rows[0].notes as string;

      // The assertion that matters: someone reading the table directly, with a
      // database credential and no application key, learns nothing.
      assert.ok(!stored.includes('Spiculated'));
      assert.ok(!stored.includes('Biopsy'));
      assert.ok(isEnvelope(stored));

      assert.equal(open(stored), note);
    } finally {
      await pool.end();
    }
  });
});
