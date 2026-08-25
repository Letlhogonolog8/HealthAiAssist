/**
 * Whether this clinician may open this patient's record.
 *
 * `requireMedicalAccess` answered a different question — "is this account a
 * clinician?" — and treated the answer as sufficient. Every doctor, radiologist
 * and admin could read every patient in the system. The reads were audited,
 * which POPIA §19 does not accept as a substitute for minimality at the point of
 * access: an audit trail tells you afterwards that a record was opened
 * inappropriately, and the person whose record it was is no better off.
 *
 * ── Relationships are mostly derived, not declared ─────────────────────────
 *
 * A clinician with an appointment booked with a patient is treating that
 * patient. So is the radiologist assigned to read their scan, and the doctor
 * the scan is assigned to. Those facts already exist in `appointments` and
 * `medical_scans`, and deriving from them means:
 *
 *   - no backfill, and no migration that has to guess at historical care;
 *   - no second bookkeeping system that can drift away from the appointments it
 *     is supposed to describe;
 *   - no clinician locked out of a patient they are demonstrably treating,
 *     which is the failure that makes access control get worked around.
 *
 * The `care_relationships` table holds only what cannot be derived: an explicit
 * administrative grant, and break-glass.
 *
 * ── Shadow mode ────────────────────────────────────────────────────────────
 *
 * Enforcement is off by default, and that is a rollout property rather than a
 * weak default — the same reasoning as MFA_ENFORCE. Switching it on blind would
 * deny access on relationships the derivation does not yet cover, in a clinical
 * setting, with no measurement of how often that happens.
 *
 * With CARE_RELATIONSHIP_ENFORCE unset the check still runs and still writes an
 * audit event, recording what it *would* have refused. Run for a week, read
 * `SELECT detail FROM audit_events WHERE action = 'CARE_RELATIONSHIP_WOULD_BLOCK'`,
 * find out whether the derivation is right, then enforce.
 */
import { and, eq, isNull, or, sql } from 'drizzle-orm';
import { db } from './db';
import { appointments, careRelationships, medicalScans, BREAK_GLASS_TTL_MS } from '@shared/schema';

export type AccessBasis =
  | 'self'
  | 'administrator'
  | 'appointment'
  | 'scan_assignment'
  | 'assigned'
  | 'break_glass'
  | 'none';

export interface AccessDecision {
  allowed: boolean;
  basis: AccessBasis;
}

export function careRelationshipEnforced(): boolean {
  return (process.env.CARE_RELATIONSHIP_ENFORCE || '').toLowerCase() === 'true';
}

/**
 * Is there an appointment between these two, ever?
 *
 * Not restricted to today or to the future. A follow-up conversation about a
 * result happens after the appointment, a report is written afterwards, and a
 * clinician reviewing what they did last month is doing their job. Cancelled
 * appointments are excluded: a booking that never happened establishes nothing.
 */
async function hasAppointment(clinicianId: number, patientId: number): Promise<boolean> {
  const rows = await (db as any)
    .select({ id: appointments.id })
    .from(appointments)
    .where(
      and(
        eq(appointments.doctorId, clinicianId),
        eq(appointments.patientId, patientId),
        sql`${appointments.status} <> 'cancelled'`
      )
    )
    .limit(1);
  return rows.length > 0;
}

/** Is this clinician the assigned reader or owner of any of the patient's scans? */
async function hasScanAssignment(clinicianId: number, patientId: number): Promise<boolean> {
  const rows = await (db as any)
    .select({ id: medicalScans.id })
    .from(medicalScans)
    .where(
      and(
        eq(medicalScans.patientId, patientId),
        or(
          eq(medicalScans.radiologistId, clinicianId),
          eq(medicalScans.doctorId, clinicianId)
        )
      )
    )
    .limit(1);
  return rows.length > 0;
}

/** An explicit grant that has not been ended and has not expired. */
async function hasExplicitGrant(
  clinicianId: number,
  patientId: number
): Promise<'assigned' | 'break_glass' | null> {
  const rows = await (db as any)
    .select({ basis: careRelationships.basis })
    .from(careRelationships)
    .where(
      and(
        eq(careRelationships.clinicianId, clinicianId),
        eq(careRelationships.patientId, patientId),
        isNull(careRelationships.endedAt),
        or(
          isNull(careRelationships.expiresAt),
          sql`${careRelationships.expiresAt} > now()`
        )
      )
    )
    .limit(1);

  if (!rows.length) return null;
  return rows[0].basis === 'break_glass' ? 'break_glass' : 'assigned';
}

/**
 * The access decision, with the basis that produced it.
 *
 * The basis is returned rather than just a boolean because it is what makes the
 * audit trail worth reading: "allowed" tells an access review nothing, and
 * "allowed, break_glass" tells it where to look.
 */
export async function evaluateAccess(
  actorId: number,
  actorRole: string,
  patientId: number
): Promise<AccessDecision> {
  if (actorId === patientId) return { allowed: true, basis: 'self' };

  // Administrators keep system-wide access. Narrowing it would mean nobody can
  // investigate an incident, restore a mis-assigned scan, or answer a subject
  // access request. The control on this role is that every read is audited and
  // the role is held by few people, not that the reach is small.
  if (actorRole === 'admin') return { allowed: true, basis: 'administrator' };

  if (actorRole !== 'doctor' && actorRole !== 'radiologist') {
    return { allowed: false, basis: 'none' };
  }

  if (await hasAppointment(actorId, patientId)) {
    return { allowed: true, basis: 'appointment' };
  }
  if (await hasScanAssignment(actorId, patientId)) {
    return { allowed: true, basis: 'scan_assignment' };
  }

  const grant = await hasExplicitGrant(actorId, patientId);
  if (grant) return { allowed: true, basis: grant };

  return { allowed: false, basis: 'none' };
}

/**
 * Opens a time-boxed break-glass grant.
 *
 * The justification is stored verbatim and is not validated beyond being
 * non-trivial. Judging whether a stated reason is good enough is a clinical
 * governance decision made by a person reviewing the audit trail, not something
 * a regular expression should attempt at the moment of an emergency.
 */
export async function openBreakGlass(
  clinicianId: number,
  patientId: number,
  justification: string
): Promise<{ expiresAt: Date }> {
  const expiresAt = new Date(Date.now() + BREAK_GLASS_TTL_MS);

  await (db as any).insert(careRelationships).values({
    patientId,
    clinicianId,
    basis: 'break_glass',
    justification: justification.trim(),
    establishedBy: clinicianId,
    expiresAt,
  });

  return { expiresAt };
}

/** Currently open break-glass grants, for an administrator's review screen. */
export async function listActiveBreakGlass(): Promise<any[]> {
  return (db as any)
    .select()
    .from(careRelationships)
    .where(
      and(
        eq(careRelationships.basis, 'break_glass'),
        isNull(careRelationships.endedAt),
        sql`${careRelationships.expiresAt} > now()`
      )
    );
}
