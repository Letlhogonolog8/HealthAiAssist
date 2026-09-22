/**
 * Consent for having an image read by a model, rather than only by a person.
 *
 * `external-processing.ts` covers the assistant, where the risk being consented
 * to is that text leaves the country. This covers a different risk that the same
 * table had no scope for: that a classifier — not a clinician — produces the
 * first assessment of a patient's scan, and does so with a known and published
 * error rate.
 *
 * POPIA s18 requires that a person be told the purpose of processing before it
 * happens, and the models here are automated processing of special personal
 * information (s26). Separately from the law, a screening tool that misses
 * roughly one lung cancer in five is something a person is entitled to know
 * about before it is applied to them, not after.
 *
 * ── Withholding consent does not withhold care ─────────────────────────────
 *
 * A patient who declines still gets their scan stored and queued for a human
 * radiologist. This is the same route a scan takes when no validated model
 * exists for its modality, and it is deliberate: consent that is a precondition
 * for treatment is not freely given, and a gate that blocked upload entirely
 * would make declining expensive. The only thing consent controls is whether a
 * model runs.
 *
 * ── Why the numbers are in the disclosure text ─────────────────────────────
 *
 * "An AI will help analyse your scan" describes nothing a person can weigh.
 * The measured miss rate is the fact that determines whether a reasonable
 * person would agree, so it is stated, in the same units the model card uses.
 * When those figures change, DISCLOSURE_VERSION changes with them, and existing
 * grants record the version of the text the person actually saw.
 */
import { getDb } from '../db';
import { processingConsents } from '@shared/schema';
import { eq, and, desc } from 'drizzle-orm';

export const AI_ANALYSIS_SCOPE = 'ai_image_analysis';

/**
 * Bump whenever DISCLOSURE_TEXT changes — including when the performance
 * figures in it change, because those are the substance of what was agreed to.
 */
export const DISCLOSURE_VERSION = '2026-09-21.v4';

/**
 * Shown before a model may read the person's image.
 *
 * Figures are the measured held-out values from MODEL_REGISTRY, stated as
 * frequencies rather than percentages of accuracy: "misses about 1 in 30" is
 * a claim a person can act on, "86% balanced accuracy" is not.
 *
 * v3 (2026-09-20): the lung sentence was removed, because the lung model was.
 * It was withdrawn after being found to answer real CT it had never been
 * measured on. The skin false-alarm rate is stated as well as the miss rate —
 * at the banded operating point roughly one harmless lesion in four is flagged
 * or marked uncertain, and that is a cost to the person too.
 *
 * v4 (2026-09-21): a lung model reads CT again, and it is a different one. It
 * looks only at a nodule a clinician has marked, and its figures come from 29
 * malignant nodules — so the sentence says what it does, what it missed on
 * that small set (4 of 29), and that the interval is wide. "1 in 7" is the
 * observed rate; the true rate could easily be twice that.
 */
export const DISCLOSURE_TEXT = [
  'If you agree, a computer program will look at your scan before a doctor does.',
  'It does not make a diagnosis. It sorts scans so that concerning ones are looked at sooner.',
  'A human clinician reviews every scan either way. The program cannot sign off a result.',
  'For skin images, the program looks at the whole photograph. For lung CT, it looks only at one nodule that a clinician has marked; it does not search the scan for nodules, and a chest CT uploaded without a mark is stored for a radiologist and not read by any program.',
  'It gets things wrong. For skin images it misses about 1 in 30 cancers, and flags or marks as uncertain about 1 in 4 harmless lesions. For a marked lung nodule it missed 4 of 29 malignant nodules in testing (about 1 in 7) and wrongly flagged about 1 in 3 harmless ones - and 29 is a small number, so the real rates could be noticeably worse.',
  'It has not been approved by any medical regulator, in South Africa or elsewhere.',
  'It was trained mostly on light skin. For darker skin, how well it works has not been established.',
  'For skin images, the program also estimates a rough skin-tone category from the picture. This is used only to check whether it works equally well for everyone. It is never shown to your doctor and never used to decide anything about your care.',
  'If you say no, your scan is still stored and still reviewed by a clinician. Only the automated step is skipped, and no skin-tone estimate is made.',
  'You can change your mind at any time, and it takes effect on your next scan.',
];

/**
 * True when the newest record for this person grants the scope.
 *
 * Fails closed, for the same reason the external-AI gate does: an unreachable
 * consent table is not permission. Here failing closed costs a patient nothing
 * clinically — the scan goes to a human — so there is no argument for the
 * other default.
 */
export async function hasAiAnalysisConsent(patientId: number): Promise<boolean> {
  try {
    const db = getDb() as any;
    const rows = await db
      .select()
      .from(processingConsents)
      .where(and(
        eq(processingConsents.patientId, patientId),
        eq(processingConsents.scope, AI_ANALYSIS_SCOPE)
      ))
      .orderBy(desc(processingConsents.recordedAt), desc(processingConsents.id))
      .limit(1);
    return rows[0]?.granted === true;
  } catch (error) {
    console.error('Could not read AI analysis consent; refusing automated analysis:', error);
    return false;
  }
}

/** Records a grant or withdrawal. Never updates an existing row. */
export async function recordAiAnalysisConsent(
  patientId: number,
  granted: boolean,
  notes = ''
): Promise<void> {
  const db = getDb() as any;
  await db.insert(processingConsents).values({
    patientId,
    scope: AI_ANALYSIS_SCOPE,
    granted,
    consentVersion: DISCLOSURE_VERSION,
    notes,
  });
}

/** The current decision and which version of the text produced it. */
export async function getAiAnalysisConsent(patientId: number): Promise<{
  granted: boolean;
  version: string | null;
  recordedAt: Date | null;
}> {
  try {
    const db = getDb() as any;
    const rows = await db
      .select()
      .from(processingConsents)
      .where(and(
        eq(processingConsents.patientId, patientId),
        eq(processingConsents.scope, AI_ANALYSIS_SCOPE)
      ))
      .orderBy(desc(processingConsents.recordedAt), desc(processingConsents.id))
      .limit(1);

    if (!rows[0]) return { granted: false, version: null, recordedAt: null };
    return {
      granted: rows[0].granted === true,
      version: rows[0].consentVersion ?? null,
      recordedAt: rows[0].recordedAt ?? null,
    };
  } catch (error) {
    console.error('Could not read AI analysis consent:', error);
    return { granted: false, version: null, recordedAt: null };
  }
}

/**
 * Raised when a scan may be stored but not analysed.
 *
 * Distinct from ModelUnavailableError because the remedy is different: the
 * model is fine and the input is fine, but nobody has agreed to the model
 * being used. Callers persist the scan for human review and say so.
 */
export class AnalysisConsentMissingError extends Error {
  readonly patientId: number;

  constructor(patientId: number) {
    super(`No AI analysis consent on record for patient ${patientId}`);
    this.name = 'AnalysisConsentMissingError';
    this.patientId = patientId;
  }
}
