/**
 * Detection runs: requesting one, recording what happened, and reading it back.
 *
 * ── The three outcomes ─────────────────────────────────────────────────────
 *
 * This module exists to keep these apart:
 *
 *   complete, candidateCount 0   the volume was searched and nothing scored
 *                                above the threshold
 *   refused                      the study was not searched — out of
 *                                distribution, failed the gate, no model
 *   failed                       something broke
 *
 * All three look like "no candidates" to a UI that only counts rows, and the
 * whole point of persisting a run is that a clinician can tell which happened.
 * A refusal must never be presented as a clear study.
 *
 * ── What a candidate is, and is not ────────────────────────────────────────
 *
 * A location and a score. The score answers "would a radiologist have marked
 * something here" — the only question the LIDC annotations support. Nothing
 * here produces or stores a malignancy, a risk or a priority. Characterisation
 * is a separate model with its own fingerprint, reached only after a clinician
 * has reviewed a candidate.
 *
 * ── There is no detector ───────────────────────────────────────────────────
 *
 * No trained checkpoint exists. A run therefore refuses with
 * `model_unavailable`, which is recorded on the run row like any other
 * refusal. That is deliberately indistinguishable in shape from a future real
 * refusal and completely distinguishable from a clear study.
 */
import { and, desc, eq, inArray } from 'drizzle-orm';

import { db } from './db';
import {
  detectionCandidates,
  detectionRuns,
  imagingSeries,
  type DetectionRun,
} from '@shared/schema';

/** Statuses a run can hold. Ordered from least to most finished. */
export const RUN_QUEUED = 'queued';
export const RUN_RUNNING = 'running';
export const RUN_COMPLETE = 'complete';
export const RUN_REFUSED = 'refused';
export const RUN_FAILED = 'failed';

export const IN_FLIGHT_STATUSES = [RUN_QUEUED, RUN_RUNNING];

/** What a clinician may record against a candidate. Never a diagnosis. */
export const REVIEW_DISPOSITIONS = [
  'accepted',
  'rejected',
  'uncertain',
  'missed_candidate_added',
] as const;
export type ReviewDisposition = (typeof REVIEW_DISPOSITIONS)[number];

export class DetectionConflict extends Error {
  constructor(readonly runId: number) {
    super(
      'A detection run for this series is already queued or running. Starting a second ' +
        'would write two candidate sets for one series with no way to tell which is current.'
    );
    this.name = 'DetectionConflict';
  }
}

export class SeriesNotReady extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'SeriesNotReady';
  }
}

/**
 * Whether a series can be searched at all, decided before any work starts.
 *
 * These are the P1b guarantees restated as detection preconditions. A volume
 * cannot be built without them, and finding out halfway through a job is
 * worse than refusing up front.
 */
export function seriesReadiness(series: any): { ready: boolean; code?: string; message?: string } {
  if (!series) {
    return { ready: false, code: 'series_not_found', message: 'No such series.' };
  }
  if (series.modality !== 'CT') {
    return {
      ready: false,
      code: 'wrong_modality',
      message: `Detection is for CT. This series is ${series.modality}.`,
    };
  }
  if (!series.qualityGatePassed) {
    return {
      ready: false,
      code: 'quality_gate_failed',
      message:
        'This series did not pass the CT quality gate, so it is outside the range the ' +
        'pipeline was measured on.',
    };
  }
  if (!series.orderingTrusted) {
    return {
      ready: false,
      code: 'untrusted_ordering',
      message:
        'The slice ordering of this series is not trustworthy, so a volume built from it ' +
        'could have its anatomy scrambled.',
    };
  }
  if (series.slicePolarity !== 'feet_to_head') {
    return {
      ready: false,
      code: 'indeterminate_polarity',
      message:
        'The anatomical direction of this series could not be determined, so a volume would ' +
        'not know which end of its z axis is the head. A mirrored volume is undetectable ' +
        'downstream.',
    };
  }
  if (series.imageOrientationPatient === null || series.pixelSpacingRowMm === null) {
    return {
      ready: false,
      code: 'incomplete_geometry',
      message:
        'This series was ingested before the full DICOM geometry was persisted, so a ' +
        'candidate coordinate could not be placed in the patient. Re-ingest it.',
    };
  }
  return { ready: true };
}

/** The run in flight for a series, if there is one. */
export async function inFlightRun(seriesId: number): Promise<DetectionRun | null> {
  const [run] = await (db as any)
    .select()
    .from(detectionRuns)
    .where(and(eq(detectionRuns.seriesId, seriesId), inArray(detectionRuns.status, IN_FLIGHT_STATUSES)))
    .limit(1);
  return run ?? null;
}

/**
 * Starts a run, or reports why not.
 *
 * The row is written before any work happens, so that a crash mid-search
 * leaves a `running` run to investigate rather than no trace at all.
 */
export async function requestDetection(options: {
  seriesId: number;
  requestedBy: number;
}): Promise<DetectionRun> {
  const { seriesId, requestedBy } = options;

  const [series] = await (db as any)
    .select()
    .from(imagingSeries)
    .where(eq(imagingSeries.id, seriesId))
    .limit(1);

  const readiness = seriesReadiness(series);
  if (!readiness.ready) {
    throw new SeriesNotReady(readiness.code!, readiness.message!);
  }

  const existing = await inFlightRun(seriesId);
  if (existing) throw new DetectionConflict(existing.id);

  const [run] = await (db as any)
    .insert(detectionRuns)
    .values({
      seriesId,
      patientId: series.patientId,
      status: RUN_QUEUED,
      requestedBy,
      volumeSlices: series.instanceCount,
      volumeRows: series.rows,
      volumeColumns: series.columns,
      sliceSpacingMm: series.medianSpacingMm,
      slicePolarity: series.slicePolarity,
    })
    .returning();

  return run;
}

/**
 * Records a refusal.
 *
 * Separate from `failRun` because the two mean different things to a reader:
 * a refusal is the pipeline declining to answer, a failure is the pipeline
 * breaking. Both are distinct from a completed search.
 */
export async function refuseRun(
  runId: number,
  code: string,
  detail: string,
  extra: Record<string, unknown> = {}
): Promise<void> {
  await (db as any)
    .update(detectionRuns)
    .set({
      status: RUN_REFUSED,
      failureCode: code,
      failureDetail: detail,
      // Deliberately left null. A refused run searched nothing, and writing 0
      // here would make it read as a clear study in any count-based view.
      candidateCount: null,
      completedAt: new Date(),
      ...extra,
    })
    .where(eq(detectionRuns.id, runId));
}

export async function failRun(runId: number, code: string, detail: string): Promise<void> {
  await (db as any)
    .update(detectionRuns)
    .set({
      status: RUN_FAILED,
      failureCode: code,
      failureDetail: detail,
      candidateCount: null,
      completedAt: new Date(),
    })
    .where(eq(detectionRuns.id, runId));
}

/**
 * Records a completed search and its candidates, in one transaction.
 *
 * Candidates and the count are written together so a reader can never see a
 * complete run whose candidate rows have not landed yet — which would look
 * exactly like a clear study.
 */
export async function completeRun(options: {
  runId: number;
  seriesId: number;
  patientId: number;
  candidates: Array<Record<string, any>>;
  provenance: Record<string, unknown>;
}): Promise<void> {
  const { runId, seriesId, patientId, candidates, provenance } = options;

  await (db as any).transaction(async (tx: any) => {
    if (candidates.length) {
      await tx.insert(detectionCandidates).values(
        candidates.map((candidate) => ({
          runId,
          seriesId,
          patientId,
          voxelI: candidate.voxelI,
          voxelJ: candidate.voxelJ,
          voxelK: candidate.voxelK,
          xMm: candidate.xMm,
          yMm: candidate.yMm,
          zMm: candidate.zMm,
          coordinateSystem: candidate.coordinateSystem ?? 'dicom_patient_lps',
          positionIndex: candidate.positionIndex,
          scoreRaw: candidate.scoreRaw,
          // Never a copy of the raw score. Null until a calibration artifact
          // exists, because an uncalibrated number presented as a probability
          // is what calibration exists to prevent.
          scoreCalibrated: candidate.scoreCalibrated ?? null,
          mergedFrom: candidate.mergedFrom ?? 1,
        }))
      );
    }

    await tx
      .update(detectionRuns)
      .set({
        status: RUN_COMPLETE,
        candidateCount: candidates.length,
        failureCode: null,
        failureDetail: null,
        completedAt: new Date(),
        ...provenance,
      })
      .where(eq(detectionRuns.id, runId));
  });
}

export async function getRun(runId: number): Promise<DetectionRun | null> {
  const [run] = await (db as any)
    .select()
    .from(detectionRuns)
    .where(eq(detectionRuns.id, runId))
    .limit(1);
  return run ?? null;
}

export async function latestRunForSeries(seriesId: number): Promise<DetectionRun | null> {
  const [run] = await (db as any)
    .select()
    .from(detectionRuns)
    .where(eq(detectionRuns.seriesId, seriesId))
    .orderBy(desc(detectionRuns.createdAt))
    .limit(1);
  return run ?? null;
}

export async function candidatesForSeries(seriesId: number) {
  return (db as any)
    .select()
    .from(detectionCandidates)
    .where(eq(detectionCandidates.seriesId, seriesId))
    .orderBy(desc(detectionCandidates.scoreRaw));
}

export async function getCandidate(candidateId: number) {
  const [candidate] = await (db as any)
    .select()
    .from(detectionCandidates)
    .where(eq(detectionCandidates.id, candidateId))
    .limit(1);
  return candidate ?? null;
}

/**
 * Records a clinician's disposition on a candidate.
 *
 * The vocabulary is closed and contains no clinical conclusion: a clinician
 * says whether the proposal is worth looking at, not what it is. Deciding
 * what a nodule *is* requires the characteriser and its own evidence.
 */
export async function reviewCandidate(options: {
  candidateId: number;
  disposition: ReviewDisposition;
  note?: string | null;
  reviewerId: number;
}) {
  const { candidateId, disposition, note, reviewerId } = options;
  if (!REVIEW_DISPOSITIONS.includes(disposition)) {
    throw new Error(`Unknown review disposition: ${disposition}`);
  }
  const [updated] = await (db as any)
    .update(detectionCandidates)
    .set({
      reviewDisposition: disposition,
      reviewNote: note ?? null,
      reviewedBy: reviewerId,
      reviewedAt: new Date(),
    })
    .where(eq(detectionCandidates.id, candidateId))
    .returning();
  return updated ?? null;
}

/**
 * The shape a run takes on the wire.
 *
 * `interpretation` is a sentence rather than a field a UI has to assemble,
 * because the difference between "searched and clear" and "not searched" is
 * exactly the thing a hurried reader collapses.
 */
export function describeRun(run: DetectionRun): Record<string, unknown> {
  let interpretation: string;
  if (run.status === RUN_COMPLETE && (run.candidateCount ?? 0) === 0) {
    interpretation =
      'The series was searched and no location scored above the detector threshold. This is ' +
      'NOT a statement that the study is clear: the detector proposes locations for review ' +
      'and has no validated sensitivity.';
  } else if (run.status === RUN_COMPLETE) {
    interpretation =
      `${run.candidateCount} location(s) are proposed for review. A candidate is a detector ` +
      'hypothesis, not a finding, and says nothing about malignancy.';
  } else if (run.status === RUN_REFUSED) {
    interpretation =
      'This series was NOT searched. A refusal is not a negative result and must not be ' +
      'read as an absence of findings.';
  } else if (run.status === RUN_FAILED) {
    interpretation =
      'The detection run failed. Nothing was searched, and no conclusion about the study ' +
      'follows from it.';
  } else {
    interpretation = 'The run has not finished. No conclusion follows from it yet.';
  }

  return {
    id: run.id,
    seriesId: run.seriesId,
    status: run.status,
    candidateCount: run.candidateCount,
    failureCode: run.failureCode,
    failureDetail: run.failureDetail,
    detector: {
      version: run.detectorVersion,
      fingerprint: run.detectorFingerprint,
      preprocessingVersion: run.preprocessingVersion,
      preprocessingFingerprint: run.preprocessingFingerprint,
      configFingerprint: run.detectionConfigFingerprint,
      lungMaskVersion: run.lungMaskVersion,
    },
    ood: { status: run.oodStatus, score: run.oodScore, threshold: run.oodThreshold },
    calibration: { status: run.calibrationStatus, version: run.calibrationVersion },
    volume: {
      slices: run.volumeSlices,
      rows: run.volumeRows,
      columns: run.volumeColumns,
      sliceSpacingMm: run.sliceSpacingMm,
      slicePolarity: run.slicePolarity,
    },
    requestedAt: run.createdAt,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    interpretation,
  };
}
