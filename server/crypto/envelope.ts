/**
 * The on-disk ciphertext format.
 *
 *   enc:v1:<keyId>:<nonce>:<tag>:<ciphertext>
 *
 * with the three binary parts base64url-encoded.
 *
 * Three properties, each load-bearing:
 *
 * **It announces itself.** The `enc:v1:` prefix means a value can be classified
 * without a key. That is what makes an incremental rollout possible: a column
 * can hold plaintext written before encryption was enabled and ciphertext
 * written after, and reads handle both without a schema migration or a
 * maintenance window. It is also what makes the backfill resumable — it can tell
 * what it has already done.
 *
 * **It records the key.** Ciphertext that does not name its key cannot be
 * rotated: changing the key would strand every existing row, so in practice the
 * key never changes. The key id has to be here from the first row written,
 * because it cannot be added to ciphertext that lacks it.
 *
 * **It is versioned.** `v1` is not decoration. Changing the algorithm later
 * without a version marker means guessing at read time.
 *
 * base64url rather than hex: the same bytes in two thirds of the characters,
 * which matters when the column is a clinical note stored per row, and it is
 * URL- and JSON-safe without escaping.
 */
import crypto from 'crypto';

import { loadKeyring } from './keyring';

const PREFIX = 'enc';
const VERSION = 'v1';
const ALGORITHM = 'aes-256-gcm';
/** GCM's standard nonce length. */
const NONCE_BYTES = 12;
/**
 * Bound into the authentication tag.
 *
 * The version and key id are carried in the AAD as well as in the envelope, so
 * an attacker cannot relabel a ciphertext as belonging to a different key or a
 * different format version and have it still authenticate.
 */
function aad(keyId: string): Buffer {
  return Buffer.from(`${PREFIX}:${VERSION}:${keyId}`, 'utf8');
}

const b64 = (buffer: Buffer) => buffer.toString('base64url');
const unb64 = (value: string) => Buffer.from(value, 'base64url');

/** Whether a value is already in this format. Requires no key. */
export function isEnvelope(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(`${PREFIX}:${VERSION}:`);
}

/** The key id a ciphertext was written under, or null if it is not ciphertext. */
export function envelopeKeyId(value: unknown): string | null {
  if (!isEnvelope(value)) return null;
  return value.split(':')[2] ?? null;
}

/** Encrypts under the active key. Empty and null pass through unchanged. */
export function seal(plaintext: string | null | undefined): string | null | undefined {
  if (plaintext === null || plaintext === undefined || plaintext === '') return plaintext;
  // Already sealed: re-sealing would nest envelopes and double the storage.
  if (isEnvelope(plaintext)) return plaintext;

  const { active } = loadKeyring();
  const nonce = crypto.randomBytes(NONCE_BYTES);

  const cipher = crypto.createCipheriv(ALGORITHM, active.material, nonce);
  cipher.setAAD(aad(active.id));

  const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [PREFIX, VERSION, active.id, b64(nonce), b64(tag), b64(body)].join(':');
}

/**
 * Decrypts, tolerating plaintext.
 *
 * A value that is not an envelope is returned unchanged. That is deliberate: it
 * is what lets encryption be switched on over a live table without rewriting it
 * first, and what lets the backfill run gradually. The cost is that this cannot
 * tell "written before encryption" from "someone wrote plaintext into an
 * encrypted column", which is what `assertSealed` in the audit script is for.
 */
export function open(value: string | null | undefined): string | null | undefined {
  if (value === null || value === undefined || value === '') return value;
  if (!isEnvelope(value)) return value;

  const parts = value.split(':');
  if (parts.length !== 6) {
    throw new Error('Malformed ciphertext envelope: expected 6 colon-separated parts');
  }

  const [, , keyId, nonce, tag, body] = parts;
  const { byId } = loadKeyring();
  const key = byId.get(keyId);

  if (!key) {
    // The most likely cause by far: a key was retired from ENCRYPTION_KEYS
    // before the rotation finished re-encrypting rows written under it.
    throw new Error(
      `Ciphertext was written under key "${keyId}", which is not in the keyring. ` +
        'Restore that key and run `npm run crypto:rotate` before retiring it.'
    );
  }

  const decipher = crypto.createDecipheriv(ALGORITHM, key.material, unb64(nonce));
  decipher.setAAD(aad(keyId));
  // A wrong key, a tampered body, a tampered tag, or a relabelled key id all
  // fail in final() rather than yielding plausible-looking rubbish.
  decipher.setAuthTag(unb64(tag));

  return Buffer.concat([decipher.update(unb64(body)), decipher.final()]).toString('utf8');
}

/**
 * Re-encrypts under the active key, if it is not already.
 *
 * Returns null when nothing needed doing, so the rotation script can count real
 * work instead of rewriting every row on every pass.
 */
export function reseal(value: string | null | undefined): string | null {
  if (!isEnvelope(value)) {
    // Plaintext in an encrypted column: seal it. This is the backfill case.
    return value === null || value === undefined || value === '' ? null : (seal(value) as string);
  }

  const { active } = loadKeyring();
  if (envelopeKeyId(value) === active.id) return null;

  return seal(open(value) as string) as string;
}
