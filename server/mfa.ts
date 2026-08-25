/**
 * Second factor for accounts that can read patient records.
 *
 * TOTP generation and verification already existed in `advanced-security.ts`,
 * with `qrcode` already a dependency. Nothing enrolled anyone and nothing
 * challenged anyone, so every doctor, radiologist and admin account — each of
 * which can currently read any patient's record — was protected by a password
 * alone.
 *
 * ── Two decisions worth stating ────────────────────────────────────────────
 *
 * **Backup codes are consumed on use.** The existing helper verified a code by
 * running `bcrypt.compareSync` across the whole array inside `.some()`, which
 * returns a boolean and therefore cannot tell the caller *which* code matched.
 * A code that cannot be identified cannot be removed, so every recovery code
 * stayed valid forever — a permanent second-factor bypass, written on whatever
 * the user wrote it on. `consumeBackupCode` returns the remaining set instead.
 *
 * **Enrolment does not enable.** The secret is stored when enrolment begins and
 * `mfaEnabled` stays false until a generated code verifies against it. Enabling
 * on enrolment locks out anyone whose authenticator failed to scan the QR, which
 * is the single commonest way self-service MFA goes wrong and the one that
 * produces a clinician who cannot reach a patient record.
 */
import crypto from 'crypto';
import speakeasy from 'speakeasy';
import QRCode from 'qrcode';
import bcrypt from 'bcrypt';

/** Roles for which a second factor is expected. */
export function mfaRequiredRoles(): string[] {
  const configured = process.env.MFA_REQUIRED_ROLES;
  if (configured !== undefined) {
    return configured.split(',').map((role) => role.trim()).filter(Boolean);
  }
  return ['doctor', 'radiologist', 'admin'];
}

export function roleRequiresMfa(role: string | undefined | null): boolean {
  return !!role && mfaRequiredRoles().includes(role);
}

/**
 * Whether an un-enrolled privileged account is blocked from clinical data, or
 * merely told to enrol.
 *
 * Default off, and that is a deliberate rollout property rather than a weak
 * default. Switching hard enforcement on in the same deploy that introduces
 * enrolment locks every existing clinician out of the system simultaneously,
 * including whoever would have to fix it. The intended sequence is: deploy,
 * let staff enrol (the flag on the login response drives the prompt), confirm
 * with the query in migrations/mfa.sql that the privileged roles are covered,
 * then set MFA_ENFORCE=true.
 *
 * Leaving it off indefinitely means MFA is available but optional, which should
 * be recorded as an accepted risk rather than assumed to be temporary.
 */
export function mfaEnforced(): boolean {
  return (process.env.MFA_ENFORCE || '').toLowerCase() === 'true';
}

/** How long a password-verified session may wait before producing a code. */
export const MFA_CHALLENGE_TTL_MS = 5 * 60 * 1000;

const BACKUP_CODE_COUNT = 8;

export interface EnrolmentOffer {
  /** base32 seed. Store encrypted; never log. */
  secret: string;
  /** otpauth:// URI, for manual entry. */
  otpauthUrl: string;
  /** PNG data URL of the otpauth URI. */
  qrDataUrl: string;
  /** Plaintext recovery codes. Shown once and never recoverable afterwards. */
  backupCodes: string[];
  /** bcrypt hashes of the above, for storage. */
  hashedBackupCodes: string[];
}

/**
 * Formats a recovery code as two groups of five.
 *
 * Readability is a security property here: these are transcribed by hand, under
 * pressure, by someone who has already lost their phone. An unbroken run of
 * characters is transcribed wrongly more often, and a failed recovery attempt
 * ends at a support process that bypasses the second factor entirely.
 */
function generateBackupCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no O/0, I/1
  const chars = Array.from({ length: 10 }, () => alphabet[crypto.randomInt(alphabet.length)]);
  return `${chars.slice(0, 5).join('')}-${chars.slice(5).join('')}`;
}

export async function createEnrolmentOffer(email: string): Promise<EnrolmentOffer> {
  const secret = speakeasy.generateSecret({
    name: `HealthAI (${email})`,
    issuer: 'HealthAI Assistant',
    length: 32,
  });

  const otpauthUrl = secret.otpauth_url || '';
  const qrDataUrl = await QRCode.toDataURL(otpauthUrl);

  const backupCodes = Array.from({ length: BACKUP_CODE_COUNT }, generateBackupCode);
  const hashedBackupCodes = await Promise.all(
    backupCodes.map((code) => bcrypt.hash(code, 10))
  );

  return {
    secret: secret.base32,
    otpauthUrl,
    qrDataUrl,
    backupCodes,
    hashedBackupCodes,
  };
}

/**
 * Verifies a six-digit code against a stored secret.
 *
 * `window: 1` accepts the adjacent time steps, so ±30 seconds of clock skew.
 * The previous helper used `window: 2` — ±60 seconds, which is four valid codes
 * at any instant instead of three. Tolerance is a replay surface, and phone
 * clocks are NTP-synchronised; 30 seconds is ample.
 */
export function verifyTotp(token: string, secret: string): boolean {
  if (!/^\d{6}$/.test((token || '').trim())) return false;
  return speakeasy.totp.verify({
    secret,
    encoding: 'base32',
    token: token.trim(),
    window: 1,
  });
}

export interface BackupCodeResult {
  ok: boolean;
  /** The set to persist when ok — the used code removed. */
  remaining: string[];
}

/**
 * Verifies a recovery code and returns the set with that code removed.
 *
 * Sequential rather than parallel: bcrypt is deliberately slow, and running
 * eight comparisons concurrently means eight simultaneous CPU-bound hashes on
 * the request path. Short-circuiting on the match keeps the common case to one.
 */
export async function consumeBackupCode(
  supplied: string,
  hashedCodes: string[]
): Promise<BackupCodeResult> {
  const normalized = (supplied || '').trim().toUpperCase();
  if (!normalized) return { ok: false, remaining: hashedCodes };

  for (let index = 0; index < hashedCodes.length; index += 1) {
    if (await bcrypt.compare(normalized, hashedCodes[index])) {
      const remaining = hashedCodes.slice();
      remaining.splice(index, 1);
      return { ok: true, remaining };
    }
  }

  return { ok: false, remaining: hashedCodes };
}

/** Parses the stored JSON array, tolerating null and malformed values. */
export function parseBackupCodes(stored: string | null | undefined): string[] {
  if (!stored) return [];
  try {
    const parsed = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed.filter((entry) => typeof entry === 'string') : [];
  } catch {
    return [];
  }
}

export function serializeBackupCodes(codes: string[]): string {
  return JSON.stringify(codes);
}
