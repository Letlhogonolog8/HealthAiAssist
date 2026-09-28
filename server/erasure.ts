/**
 * Erasure requests, and the parts of them that cannot lawfully be granted.
 *
 * ── The tension this module exists to resolve ──────────────────────────────
 *
 * POPIA §24 gives a data subject the right to request deletion of personal
 * information. South African health records law substantially constrains that
 * right for clinical records specifically: the National Health Act §17 and the
 * HPCSA's guidance require patient records to be retained for at least **six
 * years from the last entry**, and longer for minors and for certain
 * occupational health records.
 *
 * These are not really in conflict. They apply to different categories, and the
 * honest system is the one that says which is which. What is dishonest — and
 * what a simple "delete my account" button would do — is to accept the request,
 * report success, and either delete a clinical record the practice is legally
 * required to hold, or quietly not delete anything while implying otherwise.
 *
 * So a request is assessed per category, and the outcome states what was erased,
 * what was retained, and on what basis. **A refusal with a citation is a better
 * answer than silence, and a far better answer than a deletion that did not
 * happen.**
 *
 * ── Erasure is tombstoning, not DELETE ─────────────────────────────────────
 *
 * Rows referenced by a clinical record stay, with their personal fields
 * replaced. Deleting a `users` row outright would orphan every scan, appointment
 * and audit event pointing at it — which destroys the clinical record this
 * module is trying to preserve, and breaks the audit trail that demonstrates the
 * erasure was performed properly.
 *
 * `audit_events` is never touched. An audit trail that can be erased on request
 * is not an audit trail, and POPIA §19's accountability requirement is the
 * reason it exists. Its `detail` column is already constrained to
 * non-identifying context by design.
 */
import { and, eq, notInArray, sql } from 'drizzle-orm';
import { db } from './db';
import {
  adverseEvents,
  chatMessages,
  detectionCandidates,
  detectionRuns,
  genomicConsents,
  genomicProfiles,
  genomicVariants,
  imagingInstances,
  imagingSeries,
  imagingStudies,
  medicalScans,
  notifications,
  riskAssessments,
  users,
} from '@shared/schema';
import { removeStoredObjects, type RemovalOutcome } from './object-store';

/**
 * A category whose stored objects did not all go.
 *
 * Objects before rows, and a row goes only once its object has. The rows that
 * stay are the record of what remains; the category is reported as retained,
 * with a count, and the locations go to the audit trail for an administrator —
 * not into the outcome, which the data subject reads.
 */
async function recordRetainedObjects(
  assessment: ErasureAssessment,
  patientId: number,
  category: string,
  failed: RemovalOutcome[],
  total: number
): Promise<void> {
  if (!failed.length) return;
  const outcome = assessment.categories.find((c) => c.category === category);
  if (outcome) {
    outcome.disposition = 'retained';
    outcome.reason =
      `${failed.length} of ${total} stored object(s) could not be removed, so they and ` +
      `the records pointing at them were kept. This data has NOT been fully erased. ` +
      `This requires an administrator to resolve before the request can be reported ` +
      `as complete.`;
  }
  const { recordAuditEvent } = await import('./security-middleware');
  await recordAuditEvent({
    action: 'ERASURE_OBJECTS_RETAINED',
    detail:
      `patient ${patientId} ${category}: ` +
      failed.map((f) => `${f.uri} (${'reason' in f ? f.reason : 'unknown'})`).join('; '),
  });
  console.error(
    'Erasure could not remove %d stored object(s) for patient %d (%s)',
    failed.length,
    patientId,
    category
  );
}

/** Minimum retention for a clinical record, from the last entry. */
export const CLINICAL_RETENTION_YEARS = 6;

/**
 * Named once. The execution gates on a category string matching the
 * assessment's, so a typo in one of them would silently skip an erasure while
 * reporting it as done.
 */
export const IMAGING_CATEGORY = 'CT imaging series and detection candidates';
export const SCANS_CATEGORY = 'Screening scans and findings';

export type ErasureDisposition = 'erased' | 'retained' | 'not_applicable';

export interface CategoryOutcome {
  category: string;
  disposition: ErasureDisposition;
  /** Rows affected, or rows held back. */
  count: number;
  /** Why. Shown to the data subject verbatim, so it has to be readable. */
  reason: string;
}

export interface ErasureAssessment {
  patientId: number;
  categories: CategoryOutcome[];
  /** The earliest date the clinical record could lawfully be erased. */
  clinicalHoldUntil: string | null;
}

function yearsFromNow(date: Date, years: number): Date {
  const out = new Date(date);
  out.setFullYear(out.getFullYear() + years);
  return out;
}

/**
 * What could and could not be erased, without erasing anything.
 *
 * Runs before execution so the data subject can be told the outcome before it
 * happens, and so an administrator reviewing the request sees the same
 * adjudication the execution will perform rather than a summary of it.
 */
export async function assessErasure(patientId: number): Promise<ErasureAssessment> {
  const categories: CategoryOutcome[] = [];

  // --- Clinical records: held ---------------------------------------------
  const scans = await (db as any)
    .select({ id: medicalScans.id, createdAt: medicalScans.createdAt })
    .from(medicalScans)
    .where(eq(medicalScans.patientId, patientId));

  // A CT series is a clinical record in its own right and can exist without a
  // medical_scans row: the DICOM ingest path writes imaging_series directly.
  // Computing the hold from scans alone would let a patient with imaging and
  // no scan fall through with no clinical hold at all, and would date the hold
  // from an old scan while a newer series sat unerased. "Last entry" in the
  // National Health Act sense means the last entry in the record, not the last
  // row in one table.
  const series = await (db as any)
    .select({ id: imagingSeries.id, createdAt: imagingSeries.createdAt })
    .from(imagingSeries)
    .where(eq(imagingSeries.patientId, patientId));

  const entryDates = [...scans, ...series].map((row: any) => new Date(row.createdAt));

  let clinicalHoldUntil: Date | null = null;
  if (entryDates.length) {
    const lastEntry = entryDates.reduce((latest: Date, current: Date) =>
      current > latest ? current : latest
    );
    clinicalHoldUntil = yearsFromNow(lastEntry, CLINICAL_RETENTION_YEARS);
  }

  const holdExpired = clinicalHoldUntil !== null && clinicalHoldUntil <= new Date();

  categories.push({
    category: SCANS_CATEGORY,
    disposition: scans.length === 0 ? 'not_applicable' : holdExpired ? 'erased' : 'retained',
    count: scans.length,
    reason:
      scans.length === 0
        ? 'No scans are held for this account.'
        : holdExpired
          ? 'The statutory retention period has passed, so these records were erased.'
          : `Health records must be kept for at least ${CLINICAL_RETENTION_YEARS} years from the last entry ` +
            `(National Health Act §17 and HPCSA guidance). These are retained until ` +
            `${clinicalHoldUntil!.toISOString().slice(0, 10)}.`,
  });

  // --- Imaging and detection: same hold, previously unreached --------------
  //
  // DPIA R-23. None of these rows holds a direct identifier — the UIDs are
  // salted HMAC remaps, the stored objects are de-identified, and a candidate
  // is a coordinate and a score. But every one of them is linked to a
  // patient_id and a candidate coordinate is derived from one person's
  // anatomy, so they are personal information and an erasure request has to
  // reach them. Until this was added, it did not.
  const [candidateCount] = await (db as any)
    .select({ count: sql<number>`count(*)::int` })
    .from(detectionCandidates)
    .where(eq(detectionCandidates.patientId, patientId));

  const [runCount] = await (db as any)
    .select({ count: sql<number>`count(*)::int` })
    .from(detectionRuns)
    .where(eq(detectionRuns.patientId, patientId));

  const imagingRows = series.length + (runCount?.count ?? 0) + (candidateCount?.count ?? 0);

  categories.push({
    category: IMAGING_CATEGORY,
    disposition: imagingRows === 0 ? 'not_applicable' : holdExpired ? 'erased' : 'retained',
    count: imagingRows,
    reason:
      imagingRows === 0
        ? 'No imaging series or detection candidates are held for this account.'
        : holdExpired
          ? 'Erased with the clinical record whose retention period has passed, including ' +
            'the stored de-identified image objects.'
          : `CT imaging forms part of the health record and is retained on the same basis ` +
            `as the scans, until ${clinicalHoldUntil!.toISOString().slice(0, 10)}. This ` +
            `covers ${series.length} imaging series, ${runCount?.count ?? 0} detection runs ` +
            `and ${candidateCount?.count ?? 0} candidate locations.`,
  });

  // --- Clinical correspondence: same hold ----------------------------------
  const [messageCount] = await (db as any)
    .select({ count: sql<number>`count(*)::int` })
    .from(chatMessages)
    .where(
      sql`${chatMessages.senderId} = ${patientId} OR ${chatMessages.receiverId} = ${patientId}`
    );

  categories.push({
    category: 'Messages with clinicians',
    disposition: messageCount?.count ? (holdExpired ? 'erased' : 'retained') : 'not_applicable',
    count: messageCount?.count ?? 0,
    reason: messageCount?.count
      ? holdExpired
        ? 'Erased with the clinical record whose retention period has passed.'
        : 'Clinical correspondence forms part of the health record and is retained on the same basis.'
      : 'No clinician correspondence is held.',
  });

  // --- Genomic data: consent-based, erasable -------------------------------
  const [profileCount] = await (db as any)
    .select({ count: sql<number>`count(*)::int` })
    .from(genomicProfiles)
    .where(eq(genomicProfiles.patientId, patientId));

  categories.push({
    category: 'Genomic data and polygenic scores',
    disposition: profileCount?.count ? 'erased' : 'not_applicable',
    count: profileCount?.count ?? 0,
    reason: profileCount?.count
      ? 'Held under consent rather than a statutory retention duty, so it is erased in full. ' +
        'Genomic data cannot be reissued if it leaks and implicates blood relatives who never consented.'
      : 'No genomic data is held.',
  });

  // --- Notifications: erasable ---------------------------------------------
  const [notificationCount] = await (db as any)
    .select({ count: sql<number>`count(*)::int` })
    .from(notifications)
    .where(eq(notifications.recipientId, patientId));

  categories.push({
    category: 'Notifications',
    disposition: notificationCount?.count ? 'erased' : 'not_applicable',
    count: notificationCount?.count ?? 0,
    reason: notificationCount?.count
      ? 'Operational messages with no retention duty.'
      : 'No notifications are held.',
  });

  // --- Contact details: erasable, identity tombstoned ----------------------
  categories.push({
    category: 'Contact details (address, phone, emergency contact)',
    disposition: 'erased',
    count: 1,
    reason:
      'Not required to maintain the clinical record, so removed. The account is ' +
      'deactivated and its name replaced with a placeholder; the row itself is ' +
      'kept because deleting it would orphan the retained clinical record and the ' +
      'audit trail.',
  });

  // --- Audit trail: never ---------------------------------------------------
  categories.push({
    category: 'Audit trail',
    disposition: 'retained',
    count: 0,
    reason:
      'Records of who accessed what, retained under POPIA §19 accountability. An ' +
      'audit trail that can be erased on request is not an audit trail. It holds ' +
      'no clinical content and no contact details.',
  });

  return {
    patientId,
    categories,
    clinicalHoldUntil: clinicalHoldUntil ? clinicalHoldUntil.toISOString() : null,
  };
}

/**
 * A patient's scan rows and the images they point at: images first, a row only
 * once its image is gone, and any that could not be removed kept and recorded.
 * Shared by the first erasure and by a retry, so there is one deletion path.
 */
async function eraseScanRows(assessment: ErasureAssessment, patientId: number): Promise<void> {
  // The images first. Until 2026-09-28 the rows were deleted and the images
  // they pointed at were left in storage (tests/erasure-objects.test.ts).
  const scans = await (db as any)
    .select({ id: medicalScans.id, imagePath: medicalScans.imagePath })
    .from(medicalScans)
    .where(eq(medicalScans.patientId, patientId));
  const scanRemoval = await removeStoredObjects(
    scans.map((scan: any) => scan.imagePath as string | null)
  );
  const unremovedScans = new Set(scanRemoval.failed.map((f) => f.uri));
  const keptScanIds = scans
    .filter((scan: any) => scan.imagePath && unremovedScans.has(scan.imagePath))
    .map((scan: any) => scan.id as number);

  await (db as any)
    .delete(medicalScans)
    .where(
      keptScanIds.length
        ? and(eq(medicalScans.patientId, patientId), notInArray(medicalScans.id, keptScanIds))
        : eq(medicalScans.patientId, patientId)
    );
  await recordRetainedObjects(assessment, patientId, SCANS_CATEGORY, scanRemoval.failed, scans.length);
}

/** The same for CT: instances, then empty series and studies; derived results always. */
async function eraseImagingRows(assessment: ErasureAssessment, patientId: number): Promise<void> {
  // Children before parents, because every one of these is a real foreign
  // key: candidates reference runs and series, runs reference series,
  // instances reference series, series reference studies.
  //
  // The stored objects go first. A row deleted before its object leaves the
  // pixel data on disk with nothing left pointing at it, which is the worst
  // of both outcomes — unerased and unfindable.
  const instances = await (db as any)
    .select({ id: imagingInstances.id, objectPath: imagingInstances.objectPath })
    .from(imagingInstances)
    .innerJoin(imagingSeries, eq(imagingInstances.seriesId, imagingSeries.id))
    .where(eq(imagingSeries.patientId, patientId));

  const removal = await removeStoredObjects(
    instances.map((instance: any) => instance.objectPath as string | null)
  );
  const unremoved = new Set(removal.failed.map((f) => f.uri));
  const keptInstanceIds = instances
    .filter((instance: any) => instance.objectPath && unremoved.has(instance.objectPath))
    .map((instance: any) => instance.id as number);

  // Derived results go regardless: they hold no pixels, only coordinates in
  // this person's anatomy, and nothing in storage depends on them.
  await (db as any)
    .delete(detectionCandidates)
    .where(eq(detectionCandidates.patientId, patientId));
  await (db as any).delete(detectionRuns).where(eq(detectionRuns.patientId, patientId));

  // An instance whose object could not be removed keeps its row, and so its
  // series and study keep theirs: they are the record of what remains.
  await (db as any)
    .delete(imagingInstances)
    .where(
      keptInstanceIds.length
        ? and(
            sql`${imagingInstances.seriesId} IN (SELECT id FROM imaging_series WHERE patient_id = ${patientId})`,
            notInArray(imagingInstances.id, keptInstanceIds)
          )
        : sql`${imagingInstances.seriesId} IN (SELECT id FROM imaging_series WHERE patient_id = ${patientId})`
    );
  await (db as any)
    .delete(imagingSeries)
    .where(
      and(
        eq(imagingSeries.patientId, patientId),
        sql`NOT EXISTS (SELECT 1 FROM imaging_instances i WHERE i.series_id = ${imagingSeries.id})`
      )
    );
  await (db as any)
    .delete(imagingStudies)
    .where(
      and(
        eq(imagingStudies.patientId, patientId),
        sql`NOT EXISTS (SELECT 1 FROM imaging_series s WHERE s.study_id = ${imagingStudies.id})`
      )
    );

  await recordRetainedObjects(assessment, patientId, IMAGING_CATEGORY, removal.failed, instances.length);
}

/**
 * Retry the stored objects an executed erasure could not remove.
 *
 * Re-assesses first, exactly as execution does: a category is retried only if
 * it is erasable now, so a clinical hold that has come back into force (a new
 * entry in the record) still protects it. Only the patient's own scan and CT
 * rows are touched, only the objects those rows point at are deleted, a row
 * goes only once its object has, and anything that still fails stays recorded
 * in its row and the audit trail. Nothing else the first execution did is
 * repeated.
 */
export async function retryRetainedObjects(
  patientId: number
): Promise<{ assessment: ErasureAssessment; retried: string[] }> {
  const assessment = await assessErasure(patientId);
  const erasable = new Set(
    assessment.categories.filter((c) => c.disposition === 'erased').map((c) => c.category)
  );
  const retried: string[] = [];
  if (erasable.has(SCANS_CATEGORY)) {
    await eraseScanRows(assessment, patientId);
    retried.push(SCANS_CATEGORY);
  }
  if (erasable.has(IMAGING_CATEGORY)) {
    await eraseImagingRows(assessment, patientId);
    retried.push(IMAGING_CATEGORY);
  }
  return { assessment, retried };
}

/**
 * Performs the erasure the assessment permits, and nothing beyond it.
 *
 * Re-assesses rather than trusting a stored assessment: a request approved last
 * week may have had a scan added since, which extends the clinical hold, and
 * acting on a stale adjudication would erase something now protected.
 */
export async function executeErasure(patientId: number): Promise<ErasureAssessment> {
  const assessment = await assessErasure(patientId);
  const erasable = new Set(
    assessment.categories.filter((c) => c.disposition === 'erased').map((c) => c.category)
  );

  if (erasable.has('Genomic data and polygenic scores')) {
    // Children before parents: variants and assessments reference the profile.
    const profiles = await (db as any)
      .select({ id: genomicProfiles.id })
      .from(genomicProfiles)
      .where(eq(genomicProfiles.patientId, patientId));

    for (const profile of profiles) {
      await (db as any).delete(genomicVariants).where(eq(genomicVariants.profileId, profile.id));
    }
    await (db as any).delete(riskAssessments).where(eq(riskAssessments.patientId, patientId));
    await (db as any).delete(genomicProfiles).where(eq(genomicProfiles.patientId, patientId));

    // Consent rows are append-only and are the record that consent was given and
    // then withdrawn. Kept: they demonstrate the erasure was lawful, and they
    // carry a scope and a version rather than genomic content.
    await (db as any)
      .insert(genomicConsents)
      .values({
        patientId,
        scope: 'clinical_care',
        granted: false,
        consentVersion: 'erasure-request',
        notes: 'Withdrawn by erasure request; genomic data deleted.',
      });
  }

  if (erasable.has('Notifications')) {
    await (db as any).delete(notifications).where(eq(notifications.recipientId, patientId));
  }

  if (erasable.has(SCANS_CATEGORY)) {
    // Safety reports outlive the scans they concern.
    //
    // adverse_events holds no foreign key precisely so this is possible: the
    // personal references are nulled and the report survives. A harm report
    // that disappears with the record it is about cannot support the trend
    // analysis it exists for, and the device-safety obligation to keep it does
    // not end because the patient asked to be forgotten — the same reasoning
    // that retains audit_events under POPIA §19 accountability.
    //
    // The description is clinical narrative and IS erased, since that is the
    // personal content; what remains is the category, severity, timing and the
    // model version, which is what a trend is computed from.
    await (db as any)
      .update(adverseEvents)
      .set({
        patientId: null,
        scanId: null,
        description: '[Erased at data subject request]',
        reviewNotes: null,
      })
      .where(eq(adverseEvents.patientId, patientId));

    await eraseScanRows(assessment, patientId);
  }

  if (erasable.has(IMAGING_CATEGORY)) {
    await eraseImagingRows(assessment, patientId);
  }

  if (erasable.has('Messages with clinicians')) {
    await (db as any)
      .delete(chatMessages)
      .where(
        sql`${chatMessages.senderId} = ${patientId} OR ${chatMessages.receiverId} = ${patientId}`
      );
  }

  // Identity tombstone. The username stays unique and non-reusable, the account
  // cannot authenticate, and the clinical record retains a stable reference.
  await (db as any)
    .update(users)
    .set({
      fullName: 'Erased at data subject request',
      email: `erased+${patientId}@invalid.local`,
      phone: null,
      address: null,
      emergencyContact: null,
      isActive: false,
      resetToken: null,
      resetTokenExpiry: null,
      mfaSecret: null,
      mfaBackupCodes: null,
      mfaEnabled: false,
    })
    .where(eq(users.id, patientId));

  return assessment;
}
