/**
 * Harm reporting, and the trend that makes it worth reporting.
 *
 * ── Why this is separate from scan_outcomes ────────────────────────────────
 *
 * `scan_outcomes` answers "was the model right", which is a measurement.
 * This answers "did something go wrong", which is a report. The two come apart
 * in both directions: a model can be correct and still contribute to harm
 * through a review that arrived too late, and it can be wrong on a scan that
 * hurt nobody because a radiologist caught it. A confusion matrix cannot see
 * either case, and a device that cannot be told it caused harm cannot be shown
 * to be safe.
 *
 * ── The design constraint that matters most ────────────────────────────────
 *
 * Reporting must never fail silently and must never be discouraged. A form
 * that loses a submission destroys the one record of an event nobody else
 * witnessed, and a channel that is slow or interrogative gets used only for
 * incidents so severe they were going to surface anyway — which are the ones
 * least in need of a reporting system.
 *
 * So: any authenticated user may file, including patients; the only required
 * fields are a category, a severity and a description; and a failure to
 * denormalise the scan context does not fail the report.
 *
 * ── Near-misses are the point ──────────────────────────────────────────────
 *
 * `near_miss` is first in the severity list because it is the most valuable
 * and least reported class: the same latent fault as a realised harm,
 * discovered for free. A scheme that counts only harm that reached a patient
 * trains people to wait until it has.
 */
import { and, desc, eq, gte, sql, type SQL } from 'drizzle-orm';

import { getDb } from './db';
import { encryptRow, decryptRow, decryptRows } from './crypto';
import {
  adverseEvents,
  medicalScans,
  ADVERSE_EVENT_CATEGORIES,
  ADVERSE_EVENT_SEVERITIES,
  ADVERSE_EVENT_STATUSES,
  type AdverseEventCategory,
  type AdverseEventSeverity,
  type AdverseEventStatus,
} from '@shared/schema';

export interface ReportInput {
  reportedBy: number;
  reporterRole: string;
  category: AdverseEventCategory;
  severity: AdverseEventSeverity;
  description: string;
  scanId?: number | null;
  patientId?: number | null;
  occurredAt?: Date | null;
}

export class InvalidReportError extends Error {
  readonly field: string;
  readonly allowed: readonly string[];

  constructor(field: string, allowed: readonly string[]) {
    super(`${field} must be one of: ${allowed.join(', ')}`);
    this.name = 'InvalidReportError';
    this.field = field;
    this.allowed = allowed;
  }
}

/**
 * Files a report.
 *
 * Validates only the two things that have to be constrained for the reports to
 * be countable — category and severity — and lets the narrative be whatever
 * the person needs to say.
 */
export async function reportAdverseEvent(input: ReportInput) {
  if (!ADVERSE_EVENT_CATEGORIES.includes(input.category)) {
    throw new InvalidReportError('category', ADVERSE_EVENT_CATEGORIES);
  }
  if (!ADVERSE_EVENT_SEVERITIES.includes(input.severity)) {
    throw new InvalidReportError('severity', ADVERSE_EVENT_SEVERITIES);
  }
  if (!input.description || !input.description.trim()) {
    throw new InvalidReportError('description', ['a non-empty description']);
  }

  const db = getDb() as any;

  // Copy what the model said, while the scan row still says it.
  //
  // Best-effort on purpose: a scan that has been erased, or an id that does not
  // resolve, must not prevent someone reporting harm. The report is the record
  // that matters; the denormalised context is a convenience for whoever reads
  // a cluster of them later.
  let modelVersionAtEvent: string | null = null;
  let predictedPositiveAtEvent: boolean | null = null;
  let resolvedPatientId = input.patientId ?? null;

  if (input.scanId) {
    try {
      const [scan] = await db
        .select()
        .from(medicalScans)
        .where(eq(medicalScans.id, input.scanId))
        .limit(1);
      if (scan) {
        modelVersionAtEvent = scan.modelVersion ?? null;
        predictedPositiveAtEvent = scan.predictedPositive ?? null;
        resolvedPatientId = resolvedPatientId ?? scan.patientId ?? null;
      }
    } catch (error) {
      console.error('Could not read scan context for adverse event; filing anyway:', error);
    }
  }

  const [row] = await db
    .insert(adverseEvents)
    .values(
      encryptRow('adverse_events', {
        scanId: input.scanId ?? null,
        patientId: resolvedPatientId,
        reportedBy: input.reportedBy,
        reporterRole: input.reporterRole,
        category: input.category,
        severity: input.severity,
        description: input.description,
        occurredAt: input.occurredAt ?? null,
        status: 'open',
        modelVersionAtEvent,
        predictedPositiveAtEvent,
      })
    )
    .returning();

  return decryptRow('adverse_events', row);
}

/** Reports, newest first. Filters are optional and combine with AND. */
export async function listAdverseEvents(filters: {
  status?: AdverseEventStatus;
  severity?: AdverseEventSeverity;
  limit?: number;
} = {}) {
  const db = getDb() as any;
  const conditions: SQL[] = [];
  if (filters.status) conditions.push(eq(adverseEvents.status, filters.status));
  if (filters.severity) conditions.push(eq(adverseEvents.severity, filters.severity));

  const rows = await db
    .select()
    .from(adverseEvents)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(adverseEvents.reportedAt))
    .limit(Math.min(filters.limit ?? 100, 500));

  return decryptRows('adverse_events', rows);
}

export async function getAdverseEvent(id: number) {
  const db = getDb() as any;
  const [row] = await db
    .select()
    .from(adverseEvents)
    .where(eq(adverseEvents.id, id))
    .limit(1);
  return row ? decryptRow('adverse_events', row) : null;
}

/**
 * Records a review.
 *
 * Only the review columns move. The reported category, severity and narrative
 * are never rewritten — an incident log that can be edited after the fact is
 * not evidence, and the pressure to soften a severity grade once an
 * investigation concludes is exactly what it has to resist. A reviewer who
 * believes the grade is wrong files their reasoning in the notes, where it is
 * visible beside the original.
 */
export async function reviewAdverseEvent(params: {
  id: number;
  reviewerId: number;
  status: AdverseEventStatus;
  reviewNotes: string;
}) {
  if (!ADVERSE_EVENT_STATUSES.includes(params.status)) {
    throw new InvalidReportError('status', ADVERSE_EVENT_STATUSES);
  }

  const db = getDb() as any;
  const [row] = await db
    .update(adverseEvents)
    .set(
      encryptRow('adverse_events', {
        status: params.status,
        reviewedBy: params.reviewerId,
        reviewedAt: new Date(),
        reviewNotes: params.reviewNotes,
      })
    )
    .where(eq(adverseEvents.id, params.id))
    .returning();

  return row ? decryptRow('adverse_events', row) : null;
}

/**
 * Counts over a window, which is the only form in which reports are useful.
 *
 * A list of incidents is an archive. What tells you whether the device is
 * getting more dangerous is the rate, split by severity and category, against
 * the previous comparable window — so both are returned and the caller is not
 * left to infer a trend from a single number.
 *
 * No aggregate "safety score". The counts are the finding.
 */
export async function adverseEventTrend(windowDays = 30) {
  const db = getDb() as any;
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
  const previousSince = new Date(Date.now() - 2 * windowDays * 24 * 60 * 60 * 1000);

  const tally = async (from: Date, to: Date | null) => {
    const rows = await db
      .select({
        severity: adverseEvents.severity,
        category: adverseEvents.category,
        n: sql<number>`count(*)::int`,
      })
      .from(adverseEvents)
      .where(
        to
          ? and(gte(adverseEvents.reportedAt, from), sql`${adverseEvents.reportedAt} < ${to}`)
          : gte(adverseEvents.reportedAt, from)
      )
      .groupBy(adverseEvents.severity, adverseEvents.category);

    const bySeverity: Record<string, number> = {};
    const byCategory: Record<string, number> = {};
    let total = 0;
    for (const r of rows) {
      bySeverity[r.severity] = (bySeverity[r.severity] ?? 0) + r.n;
      byCategory[r.category] = (byCategory[r.category] ?? 0) + r.n;
      total += r.n;
    }
    return { total, bySeverity, byCategory };
  };

  const [current, previous, openCount] = await Promise.all([
    tally(since, null),
    tally(previousSince, since),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(adverseEvents)
      .where(sql`${adverseEvents.status} <> 'closed'`),
  ]);

  return {
    windowDays,
    since: since.toISOString(),
    current,
    previous,
    stillOpen: openCount[0]?.n ?? 0,
    // Said explicitly because a reader will otherwise supply the assumption
    // themselves, and it is the wrong one.
    note:
      'Counts of what was reported, not of what happened. Under-reporting is the ' +
      'normal state of every incident system, so a fall in these numbers is not ' +
      'evidence of improved safety.',
  };
}
