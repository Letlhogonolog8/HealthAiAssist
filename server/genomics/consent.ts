/**
 * Consent and access control for genomic data.
 *
 * Two rules this enforces, both of which are easy to state and easy to skip:
 *
 *  1. No genomic read happens without an unrevoked consent scope covering it.
 *     Consent is checked at the point of access, not at upload, because consent
 *     can be withdrawn after the data is already stored.
 *
 *  2. Every access attempt is logged — including the denied ones. A denial that
 *     leaves no trace is indistinguishable from an access that never happened,
 *     which makes the log useless for the thing it exists for.
 */
import { getDb } from '../db';
import { genomicConsents, genomicAccessLog } from '@shared/schema';
import { eq, and, desc } from 'drizzle-orm';

export const CONSENT_SCOPES = ['clinical_care', 'research', 'secondary_sharing'] as const;
export type ConsentScope = (typeof CONSENT_SCOPES)[number];

/** Bump when the consent text changes; grants record the version the patient saw. */
export const CURRENT_CONSENT_VERSION = '2026-08-13.v1';

export const CONSENT_DESCRIPTIONS: Record<ConsentScope, string> = {
  clinical_care:
    'Use my genetic data to help assess my own health risks, and share results ' +
    'with the clinicians treating me.',
  research:
    'Allow my de-identified genetic data to be used in research, including ' +
    'research aimed at improving how well these tools work for people of my ' +
    'ancestry.',
  secondary_sharing:
    'Allow my de-identified genetic data to be shared with external research ' +
    'partners outside this service.',
};

export type AccessAction =
  | 'upload'
  | 'read_variants'
  | 'compute_risk'
  | 'export'
  | 'delete'
  | 'read_consent';

export interface AccessContext {
  patientId: number;
  actorUserId: number | null;
  actorRole: string | null;
  action: AccessAction;
  purpose?: string;
  ipAddress?: string | null;
}

/**
 * Current state of one scope: the newest record wins, so a revocation after a
 * grant reads as revoked.
 */
export async function getConsent(
  patientId: number,
  scope: ConsentScope
): Promise<{ granted: boolean; recordedAt: Date | null; version: string | null }> {
  const db = getDb() as any;
  const rows = await db
    .select()
    .from(genomicConsents)
    .where(and(eq(genomicConsents.patientId, patientId), eq(genomicConsents.scope, scope)))
    .orderBy(desc(genomicConsents.recordedAt), desc(genomicConsents.id))
    .limit(1);

  if (!rows.length) return { granted: false, recordedAt: null, version: null };
  return {
    granted: rows[0].granted === true,
    recordedAt: rows[0].recordedAt ?? null,
    version: rows[0].consentVersion ?? null,
  };
}

export async function getAllConsents(patientId: number) {
  const out: Record<string, { granted: boolean; recordedAt: Date | null; version: string | null }> = {};
  for (const scope of CONSENT_SCOPES) {
    out[scope] = await getConsent(patientId, scope);
  }
  return out;
}

/** Records a grant or revocation. Never updates an existing row. */
export async function recordConsent(params: {
  patientId: number;
  scope: ConsentScope;
  granted: boolean;
  recordedByUserId: number | null;
  notes?: string;
}): Promise<void> {
  const db = getDb() as any;
  await db.insert(genomicConsents).values({
    patientId: params.patientId,
    scope: params.scope,
    granted: params.granted,
    consentVersion: CURRENT_CONSENT_VERSION,
    recordedByUserId: params.recordedByUserId,
    notes: params.notes ?? '',
  });
}

/** Append-only. Failures here are logged but never block the caller's error path. */
export async function logAccess(
  ctx: AccessContext,
  granted: boolean,
  consentScope: ConsentScope | null,
  denialReason?: string
): Promise<void> {
  try {
    const db = getDb() as any;
    await db.insert(genomicAccessLog).values({
      patientId: ctx.patientId,
      accessedByUserId: ctx.actorUserId,
      accessedByRole: ctx.actorRole,
      action: ctx.action,
      purpose: ctx.purpose ?? null,
      consentScope,
      granted,
      denialReason: denialReason ?? null,
      ipAddress: ctx.ipAddress ?? null,
    });
  } catch (error) {
    // A failed audit write must be loud. It is not, on its own, a reason to
    // fail the request the caller was making.
    console.error('[GENOMIC AUDIT] Failed to write access log entry:', error, ctx);
  }
}

export class ConsentDeniedError extends Error {
  readonly scope: ConsentScope;
  constructor(scope: ConsentScope, message: string) {
    super(message);
    this.name = 'ConsentDeniedError';
    this.scope = scope;
  }
}

/**
 * Gate for any genomic data access. Throws `ConsentDeniedError` when the scope
 * is not granted, and logs the attempt either way.
 *
 * `selfAccess` covers a patient reading their own data: they do not need to
 * consent to see it, but the read is still logged.
 */
export async function requireConsent(
  ctx: AccessContext,
  scope: ConsentScope,
  options: { selfAccess?: boolean } = {}
): Promise<void> {
  if (options.selfAccess && ctx.actorUserId === ctx.patientId) {
    await logAccess(ctx, true, scope);
    return;
  }

  const consent = await getConsent(ctx.patientId, scope);
  if (!consent.granted) {
    const reason =
      `Patient has not granted "${scope}" consent for genomic data` +
      (consent.recordedAt ? ' (previously granted, since revoked)' : '');
    await logAccess(ctx, false, scope, reason);
    throw new ConsentDeniedError(scope, reason);
  }

  await logAccess(ctx, true, scope);
}
