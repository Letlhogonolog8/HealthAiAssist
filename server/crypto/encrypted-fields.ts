/**
 * Which columns are encrypted at rest, and why the others are not.
 *
 * The set is declared here rather than scattered through the storage layer,
 * because which fields warrant encryption is a clinical and legal judgement that
 * will be revisited by people who are not going to read every query. Changing
 * the set is an edit to this file plus a backfill run.
 *
 * ── The constraint that shapes everything below ────────────────────────────
 *
 * An encrypted column cannot be searched, sorted, or matched. AES-GCM is
 * randomised, so equal plaintexts produce different ciphertexts — which is the
 * property that stops the database revealing that two patients share a
 * diagnosis, and simultaneously the property that makes `WHERE email = ?`
 * impossible. Anything on a lookup path therefore cannot be encrypted this way;
 * it needs a blind index, which is a different design with its own leakage.
 *
 * So the rule applied here is: encrypt free text that is written and read but
 * never queried. That covers most of what is actually sensitive, and the
 * exclusions are listed explicitly below rather than left as an absence.
 */

export interface EncryptedField {
  table: string;
  /** Property name on the storage-layer object, not necessarily the column. */
  property: string;
  column: string;
  why: string;
}

/**
 * Encrypted.
 *
 * Every entry is free text with clinical or personal content, written once and
 * read back whole, never filtered or joined on.
 */
export const ENCRYPTED_FIELDS: EncryptedField[] = [
  {
    table: 'chat_messages',
    property: 'message',
    column: 'message',
    why: 'Clinical conversation between a patient and a clinician. Never queried by content.',
  },
  {
    table: 'medical_scans',
    property: 'notes',
    column: 'notes',
    why: 'The findings string the analysis pipeline wrote. Read whole, never matched.',
  },
  {
    table: 'medical_scans',
    property: 'findings',
    column: 'findings',
    why: 'Radiologist findings, entered free-text at report submission.',
  },
  {
    table: 'medical_scans',
    property: 'recommendations',
    column: 'recommendations',
    why: 'Clinical recommendation attached to a report.',
  },
  {
    table: 'scan_outcomes',
    property: 'notes',
    column: 'notes',
    why: 'Adjudication notes: why a scan was called malignant or benign.',
  },
  {
    table: 'users',
    property: 'address',
    column: 'address',
    why: 'Home address. Read on the profile screen; nothing queries it.',
  },
  {
    table: 'users',
    property: 'phone',
    column: 'phone',
    why:
      'Read by the SMS and voice paths, which decrypt it in memory at the point of ' +
      'use. Nothing looks a patient up by phone number.',
  },
  {
    table: 'users',
    property: 'emergencyContact',
    column: 'emergency_contact',
    why: 'A third party\'s name and number, held about someone who never used this system.',
  },
  {
    table: 'users',
    property: 'mfaSecret',
    column: 'mfa_secret',
    why:
      'A base32 TOTP seed is a bearer credential: anyone holding it can generate ' +
      'valid second factors indefinitely. A database dump of this column is a set ' +
      'of working authenticators for every clinical account. Written once at ' +
      'enrolment, read whole at every challenge, never queried.',
  },
  {
    table: 'genomic_risk_assessments',
    property: 'caveats',
    column: 'caveats',
    why: 'Limitations attached to a specific genomic result, and therefore about a specific person.',
  },
  {
    table: 'genomic_risk_assessments',
    property: 'contributions',
    column: 'contributions',
    why: 'JSON naming which genomic inputs drove a risk band. Read whole, never queried.',
  },
];

/**
 * Not encrypted, deliberately.
 *
 * Written down because "why isn't this encrypted" is the question an auditor
 * asks, and an undocumented omission is indistinguishable from an oversight.
 */
export const EXCLUDED_FIELDS: Array<{ field: string; reason: string }> = [
  {
    field: 'users.email, users.username',
    reason:
      'Both are equality lookups on the authentication path — getUserByEmail and ' +
      'getUserByUsername run on every login and every registration. Randomised ' +
      'encryption makes those queries impossible. Protecting them needs a blind ' +
      'index (a keyed hash in a second column), which leaks equality by design and ' +
      'is a separate decision.',
  },
  {
    field: 'medical_scans.result',
    reason:
      'Currently both a clinical statement and a status flag: countCriticalScans ' +
      'matches it with ILIKE, and several handlers test `result = \'Processing\'` ' +
      'even though a `status` column exists. It is encryptable, but only after ' +
      'those queries move to predicted_positive, risk_level and status. Worth ' +
      'doing; not worth doing in the same change as introducing encryption.',
  },
  {
    field: 'genomic_variants.genotype',
    reason:
      'The wrong tool at this scale. A consumer genotype file is 500,000-900,000 ' +
      'rows, each holding a two-character call; an AES-GCM envelope is roughly 90 ' +
      'characters, so this would inflate the largest table in the system by more ' +
      'than fortyfold and force a decrypt of every row on every polygenic score. ' +
      'Genomic data is the most sensitive thing here and deserves protection — but ' +
      'volume or tablespace encryption, or a single sealed blob per profile, not ' +
      'per-column encryption of a wide narrow table.',
  },
  {
    field: 'audit_events.detail',
    reason:
      'Already constrained to non-identifying context by design — the column ' +
      'comment says so and the writers honour it. An audit log that contains the ' +
      'data it audits has multiplied the exposure; the fix there is to keep it out, ' +
      'not to encrypt it in place.',
  },
  {
    field: 'medical_scans.image_path',
    reason:
      'A storage locator, not content. The image itself is private in both ' +
      'backends and served only through an authorised, audited endpoint.',
  },
];

/** Property names to encrypt for a given table. */
const BY_TABLE = new Map<string, string[]>();
for (const field of ENCRYPTED_FIELDS) {
  const existing = BY_TABLE.get(field.table) ?? [];
  existing.push(field.property);
  BY_TABLE.set(field.table, existing);
}

export function encryptedProperties(table: string): string[] {
  return BY_TABLE.get(table) ?? [];
}

export const ENCRYPTED_TABLES = [...BY_TABLE.keys()];
