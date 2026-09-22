/**
 * Operational metrics per registered modality, counted from the scans it
 * produced.
 *
 * This is the one function worth keeping from server/ai-engine.ts, which is
 * gone. That file declared four models — "skin-cancer-detection 2.1.0",
 * "lung-cancer-detection 1.8.0", "breast-cancer-detection 1.5.0" and
 * "eye-disease-detection 1.3.0" — at paths that existed on no machine, built
 * TensorFlow.js stand-ins whose `predict` returned `Math.random()` when the
 * files were absent, and reported those four names as the platform's model
 * status through the admin analytics endpoint. The prediction path had been
 * fenced off; the names had not. A clinician reading the analytics page saw a
 * breast model and an eye model that never existed.
 *
 * Modalities here come from MODEL_REGISTRY and nowhere else.
 */
import { MODEL_REGISTRY } from './model-availability';
import { allGovernanceStatuses } from './model-governance';

export interface ModalityOperationalMetrics {
  totalPredictions: number | null;
  averageConfidence: number | null;
  averageProcessingTime: number | null;
  /** Accuracy over adjudicated scans. Null until a scan has both a call and an outcome. */
  accuracyRate: number | null;
  adjudicatedCount: number;
  instrumented: boolean;
  note: string;
}

/**
 * Volume, mean confidence and mean latency are recorded on every row that
 * medical_scans stores, so they are measured rather than returned as nulls.
 *
 * accuracyRate is computed from adjudicated scans — `scan_outcomes` records
 * what each scan turned out to be, so the comparison has a second operand. It
 * stays null until at least one scan has both a prediction and a confirmed
 * outcome, and the breakdown that matters in screening (sensitivity,
 * specificity, predictive values, intervals) is at /api/models/performance,
 * because a single accuracy number hides the asymmetry between a missed cancer
 * and a false alarm.
 */
export async function operationalMetrics(scanType: string): Promise<ModalityOperationalMetrics> {
  try {
    const { pool } = await import('./db');
    const { rows } = await pool.query(
      `SELECT count(*)::int AS total,
              avg(nullif(replace(ai_confidence, '%', ''), '')::numeric) AS avg_confidence_pct,
              avg(processing_time_ms)::numeric AS avg_processing_ms
         FROM medical_scans
        WHERE scan_type = $1
          AND predicted_positive IS NOT NULL`,
      [scanType]
    );
    const row = rows[0];
    const total = row?.total ?? 0;

    const { rows: adjudicated } = await pool.query(
      `WITH latest AS (
         SELECT DISTINCT ON (o.scan_id) o.scan_id, o.outcome
           FROM scan_outcomes o
          ORDER BY o.scan_id, o.recorded_at DESC, o.id DESC
       )
       SELECT count(*)::int AS n,
              count(*) FILTER (
                WHERE s.predicted_positive = (l.outcome = 'malignant')
              )::int AS correct
         FROM medical_scans s
         JOIN latest l ON l.scan_id = s.id
        WHERE s.scan_type = $1
          AND s.predicted_positive IS NOT NULL
          AND l.outcome IN ('malignant', 'benign')`,
      [scanType]
    );
    const n = adjudicated[0]?.n ?? 0;
    const correct = adjudicated[0]?.correct ?? 0;

    return {
      totalPredictions: total,
      averageConfidence:
        total > 0 && row.avg_confidence_pct !== null ? Number(row.avg_confidence_pct) / 100 : null,
      averageProcessingTime:
        total > 0 && row.avg_processing_ms !== null ? Number(row.avg_processing_ms) : null,
      accuracyRate: n > 0 ? Number((correct / n).toFixed(4)) : null,
      adjudicatedCount: n,
      instrumented: total > 0,
      note:
        n > 0
          ? `Accuracy over ${n} adjudicated scan(s). A single accuracy figure hides the ` +
            'difference between missing a cancer and raising a false alarm; see ' +
            '/api/models/performance for sensitivity, specificity and intervals.'
          : 'Confidence and latency are observed in production. No scan of this type has ' +
            'a confirmed outcome yet, so accuracy is not yet measurable.',
    };
  } catch (error) {
    return {
      totalPredictions: null,
      averageConfidence: null,
      averageProcessingTime: null,
      accuracyRate: null,
      adjudicatedCount: 0,
      instrumented: false,
      note: 'Metrics unavailable: ' + (error as Error).message,
    };
  }
}

/**
 * Every registered modality, with whether it is serving and what it has done.
 * Names are registry keys — a modality that is not in the registry does not
 * exist, and does not appear here under any name.
 */
export async function allOperationalMetrics(): Promise<{
  models: Record<string, ModalityOperationalMetrics & { enabled: boolean; serving: boolean; modelClass: string }>;
  totalModels: number;
  servingModels: number;
}> {
  const governance = Object.fromEntries((await allGovernanceStatuses()).map((g) => [g.modality, g]));
  const models: Record<string, any> = {};
  let serving = 0;
  for (const [scanType, entry] of Object.entries(MODEL_REGISTRY)) {
    const isServing = entry.enabled && governance[scanType]?.mayServe === true;
    if (isServing) serving += 1;
    models[scanType] = {
      ...(await operationalMetrics(scanType)),
      enabled: entry.enabled,
      serving: isServing,
      modelClass: entry.modelClass,
    };
  }
  return { models, totalModels: Object.keys(MODEL_REGISTRY).length, servingModels: serving };
}
