/**
 * The set of keys this process can decrypt with, and the one it encrypts with.
 *
 * A keyring rather than a key, because the alternative is a system that cannot
 * be rotated. If ciphertext does not record which key produced it, then changing
 * the key means every existing row becomes unreadable at the instant of the
 * change — so in practice the key never changes, and a compromised or aged key
 * stays in service indefinitely. That is the failure mode this module exists to
 * prevent, and it has to be designed in before the first row is written, because
 * retrofitting a key id into ciphertext that has none is not possible.
 *
 * ── Configuration ──────────────────────────────────────────────────────────
 *
 *   ENCRYPTION_KEYS=k1:<64 hex>,k2:<64 hex>
 *   ENCRYPTION_ACTIVE_KEY_ID=k2
 *
 * Every listed key can decrypt. Only the active one encrypts. A single
 * ENCRYPTION_KEY is still honoured and is treated as key id `k1`, so an existing
 * deployment does not have to change anything to keep working.
 *
 * ── Rotating ───────────────────────────────────────────────────────────────
 *
 *   1. Generate a key:  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 *   2. Append it to ENCRYPTION_KEYS under a new id, keeping the old one.
 *   3. Point ENCRYPTION_ACTIVE_KEY_ID at the new id and restart.
 *      New writes use it immediately; old rows still decrypt under the old key.
 *   4. Run `npm run crypto:rotate` to re-encrypt existing rows.
 *   5. Once it reports zero rows remaining on the old key, remove the old key.
 *
 * Step 4 is resumable and safe to re-run. Step 5 is the only irreversible one,
 * which is why it is last and gated on a count rather than on elapsed time.
 */

export interface Key {
  id: string;
  material: Buffer;
}

export interface Keyring {
  /** The key new ciphertext is written with. */
  active: Key;
  /** Every key, by id, including the active one. Used for decryption. */
  byId: Map<string, Key>;
}

const HEX_32_BYTES = /^[0-9a-fA-F]{64}$/;
/** Ids appear inside the ciphertext envelope, so keep them unambiguous. */
const KEY_ID = /^[a-zA-Z0-9_-]{1,32}$/;

let cached: Keyring | null = null;

function parseKeys(): Key[] {
  const multi = process.env.ENCRYPTION_KEYS?.trim();

  if (multi) {
    return multi.split(',').map((entry, index) => {
      const separator = entry.indexOf(':');
      if (separator < 1) {
        throw new Error(
          `ENCRYPTION_KEYS entry ${index + 1} is not "<id>:<64 hex>". ` +
            'Ids matter: they are written into the ciphertext so it can be rotated later.'
        );
      }

      const id = entry.slice(0, separator).trim();
      const hex = entry.slice(separator + 1).trim();

      if (!KEY_ID.test(id)) {
        throw new Error(`ENCRYPTION_KEYS: "${id}" is not a valid key id ([A-Za-z0-9_-], 1-32 chars).`);
      }
      if (!HEX_32_BYTES.test(hex)) {
        throw new Error(`ENCRYPTION_KEYS: key "${id}" must be exactly 64 hex characters (32 bytes).`);
      }

      return { id, material: Buffer.from(hex, 'hex') };
    });
  }

  // Single-key configuration, kept working. Named k1 so that a later rotation
  // has something to rotate away from.
  const single = process.env.ENCRYPTION_KEY?.trim();
  if (!single) return [];
  if (!HEX_32_BYTES.test(single)) {
    throw new Error('ENCRYPTION_KEY must be exactly 64 hexadecimal characters (32 bytes) for AES-256.');
  }
  return [{ id: 'k1', material: Buffer.from(single, 'hex') }];
}

export function loadKeyring(): Keyring {
  if (cached) return cached;

  const keys = parseKeys();
  if (keys.length === 0) {
    throw new Error(
      'No encryption key configured. Set ENCRYPTION_KEY, or ENCRYPTION_KEYS for a rotatable keyring.'
    );
  }

  const byId = new Map<string, Key>();
  for (const key of keys) {
    if (byId.has(key.id)) {
      // Two keys under one id makes ciphertext undecryptable non-deterministically.
      throw new Error(`ENCRYPTION_KEYS contains duplicate key id "${key.id}".`);
    }
    byId.set(key.id, key);
  }

  const activeId = process.env.ENCRYPTION_ACTIVE_KEY_ID?.trim() || keys[keys.length - 1].id;
  const active = byId.get(activeId);
  if (!active) {
    throw new Error(
      `ENCRYPTION_ACTIVE_KEY_ID="${activeId}" is not present in the keyring ` +
        `(have: ${[...byId.keys()].join(', ')}).`
    );
  }

  cached = { active, byId };
  return cached;
}

/** Whether encryption is usable, without throwing. For health reporting. */
export function isKeyringConfigured(): boolean {
  try {
    loadKeyring();
    return true;
  } catch {
    return false;
  }
}

/** Reported by /api/ready. Ids only — never key material. */
export function keyringStatus(): {
  configured: boolean;
  activeKeyId: string | null;
  keyCount: number;
  error?: string;
} {
  try {
    const keyring = loadKeyring();
    return {
      configured: true,
      activeKeyId: keyring.active.id,
      keyCount: keyring.byId.size,
    };
  } catch (error) {
    return {
      configured: false,
      activeKeyId: null,
      keyCount: 0,
      error: (error as Error).message,
    };
  }
}

/** Tests mutate the environment; production never calls this. */
export function resetKeyringCache(): void {
  cached = null;
}
