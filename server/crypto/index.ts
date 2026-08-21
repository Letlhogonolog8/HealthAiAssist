/**
 * The storage layer's view of encryption: two functions, applied per row.
 *
 * Row-level rather than call-site-level on purpose. The alternative — remembering
 * to wrap each sensitive property everywhere it is written or read — fails the
 * first time somebody adds a query, and it fails silently, by writing plaintext
 * into a column everything else treats as encrypted. Driving it from the
 * manifest means adding a field is one edit and a backfill, not an audit of
 * every handler.
 *
 * Both functions are no-ops when no key is configured, so a development machine
 * or a deployment that has opted out via ALLOW_UNENCRYPTED_AT_REST behaves
 * exactly as before. That is what makes this safe to introduce over a live
 * table: reads already tolerate plaintext, so nothing has to be rewritten before
 * writes start being sealed.
 */
import { isKeyringConfigured } from './keyring';
import { open, seal } from './envelope';
import { encryptedProperties } from './encrypted-fields';

export { isKeyringConfigured, keyringStatus, loadKeyring, resetKeyringCache } from './keyring';
export { isEnvelope, envelopeKeyId, open, seal, reseal } from './envelope';
export {
  ENCRYPTED_FIELDS,
  EXCLUDED_FIELDS,
  ENCRYPTED_TABLES,
  encryptedProperties,
} from './encrypted-fields';

/**
 * Seals the encrypted properties of a row on its way into the database.
 *
 * Returns a copy; the caller's object is not mutated, because these are often
 * request bodies that other code reads afterwards.
 */
export function encryptRow<T extends Record<string, any>>(table: string, row: T): T {
  const properties = encryptedProperties(table);
  if (properties.length === 0 || !isKeyringConfigured()) return row;

  const output: Record<string, any> = { ...row };
  for (const property of properties) {
    // `in` rather than a truthiness check: a partial update that does not mention
    // a property must leave it alone, and an explicit null must stay null.
    if (property in output) output[property] = seal(output[property]);
  }
  return output as T;
}

/**
 * Opens the encrypted properties of a row on its way out.
 *
 * Tolerates plaintext, so rows written before encryption was switched on read
 * back normally. A row that cannot be decrypted throws rather than returning the
 * ciphertext: silently handing a clinician a base64 blob where a note should be
 * is worse than an error, because it looks like the note was empty.
 */
export function decryptRow<T extends Record<string, any>>(table: string, row: T): T;
export function decryptRow<T extends Record<string, any>>(table: string, row: T | null | undefined): T | null | undefined;
export function decryptRow<T extends Record<string, any>>(
  table: string,
  row: T | null | undefined
): T | null | undefined {
  if (!row) return row;

  const properties = encryptedProperties(table);
  if (properties.length === 0 || !isKeyringConfigured()) return row;

  const output: Record<string, any> = { ...row };
  for (const property of properties) {
    if (property in output) output[property] = open(output[property]);
  }
  return output as T;
}

/** decryptRow over a result set. */
export function decryptRows<T extends Record<string, any>>(table: string, rows: T[]): T[] {
  const properties = encryptedProperties(table);
  if (properties.length === 0 || !isKeyringConfigured() || !Array.isArray(rows)) return rows;
  return rows.map((row) => decryptRow(table, row));
}
