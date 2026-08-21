/**
 * How the models are actually doing, on this deployment's patients.
 *
 * Distinct from MODEL_REGISTRY, and the distinction matters. A held-out
 * evaluation says how a model behaved on a fixed dataset at a fixed moment; it
 * is reproducible, it is the right thing to publish on a model card, and it says
 * nothing about how the model behaves here. Scanner, population, image quality
 * and case mix all differ, and a model can hold its lab numbers on one site and
 * lose ten points of sensitivity on another.
 *
 * Answering that needs a confirmed outcome per scan, which is what
 * `scan_outcomes` now records. Everything below is computed from those
 * confirmations and from nothing else.
 *
 * Two rules run through this file:
 *
 *   1. A rate is never reported without its denominator and its interval. With
 *      eight confirmed cancers, an observed sensitivity of 0.875 has a 95%
 *      interval of roughly 0.53–0.98 — the point estimate alone is close to
 *      meaningless, and printing it bare is how a screening tool acquires a
 *      reputation it has not earned.
 *   2. Nothing is estimated. Where a denominator is zero the rate is null, not
 *      zero and not a prior.
 */

export interface Interval {
  low: number;
  high: number;
}

export interface Rate {
  /** Observed proportion, or null when the denominator is zero. */
  value: number | null;
  numerator: number;
  denominator: number;
  /** Wilson score interval at 95%. Null when there is nothing to bound. */
  interval: Interval | null;
}

export interface ProductionPerformance {
  scanType: string;
  matrix: {
    truePositives: number;
    falsePositives: number;
    trueNegatives: number;
    falseNegatives: number;
  };
  /** Adjudicated as inconclusive. Excluded from every rate below. */
  indeterminate: number;
  /** Predictions still waiting on a confirmed outcome. */
  unadjudicated: number;
  /** Adjudicated scans the rates are computed from. */
  adjudicated: number;

  sensitivity: Rate;
  specificity: Rate;
  /** Of the scans it flagged, how many were cancer. */
  positivePredictiveValue: Rate;
  /** Of the scans it cleared, how many were not cancer. */
  negativePredictiveValue: Rate;
  /** Mean of sensitivity and specificity; null unless both exist. */
  balancedAccuracy: number | null;

  /**
   * Whether the sample is large enough for the rates to be worth acting on.
   *
   * Not a statistical test, and it does not pretend to be: it is a floor below
   * which the intervals are so wide that quoting the point estimate misleads.
   * The intervals are always present regardless, so a caller can make its own
   * judgement.
   */
  sufficientForInference: boolean;
  /** Evidence admitted into this calculation. */
  evidenceFloor: string;
  note: string;
}

/** Confirmed positives and confirmed negatives needed before rates are trusted. */
const MIN_PER_CLASS = 20;

/**
 * Wilson score interval — deliberately not the normal approximation.
 *
 * The textbook interval, p ± 1.96·√(p(1−p)/n), degenerates exactly where this
 * application lives: it produces bounds outside [0, 1] for extreme proportions,
 * and a zero-width interval when p is 0 or 1. A model that has correctly flagged
 * all four of its four confirmed cancers would report a sensitivity of 100%
 * ± 0%. Wilson stays inside the unit interval and keeps a sensible width at the
 * boundaries, which is the whole point of showing an interval here.
 */
export function wilsonInterval(successes: number, trials: number, z = 1.96): Interval | null {
  if (trials <= 0) return null;

  const p = successes / trials;
  const z2 = z * z;
  const denominator = 1 + z2 / trials;
  const centre = (p + z2 / (2 * trials)) / denominator;
  const spread =
    (z * Math.sqrt((p * (1 - p)) / trials + z2 / (4 * trials * trials))) / denominator;

  return {
    low: Math.max(0, Number((centre - spread).toFixed(4))),
    high: Math.min(1, Number((centre + spread).toFixed(4))),
  };
}

function rate(numerator: number, denominator: number): Rate {
  return {
    value: denominator > 0 ? Number((numerator / denominator).toFixed(4)) : null,
    numerator,
    denominator,
    interval: wilsonInterval(numerator, denominator),
  };
}

export interface MatrixCounts {
  scanType: string;
  truePositives: number;
  falsePositives: number;
  trueNegatives: number;
  falseNegatives: number;
  indeterminate: number;
  unadjudicated: number;
}

/** Turns raw counts into reportable rates. Pure — no I/O, so it is testable. */
export function summarise(counts: MatrixCounts, evidenceFloor = 'any'): ProductionPerformance {
  const { truePositives: tp, falsePositives: fp, trueNegatives: tn, falseNegatives: fn } = counts;

  const actualPositives = tp + fn;
  const actualNegatives = tn + fp;

  const sensitivity = rate(tp, actualPositives);
  const specificity = rate(tn, actualNegatives);

  const balancedAccuracy =
    sensitivity.value !== null && specificity.value !== null
      ? Number(((sensitivity.value + specificity.value) / 2).toFixed(4))
      : null;

  const adjudicated = tp + fp + tn + fn;
  const sufficient = actualPositives >= MIN_PER_CLASS && actualNegatives >= MIN_PER_CLASS;

  return {
    scanType: counts.scanType,
    matrix: { truePositives: tp, falsePositives: fp, trueNegatives: tn, falseNegatives: fn },
    indeterminate: counts.indeterminate,
    unadjudicated: counts.unadjudicated,
    adjudicated,

    sensitivity,
    specificity,
    positivePredictiveValue: rate(tp, tp + fp),
    negativePredictiveValue: rate(tn, tn + fn),
    balancedAccuracy,

    sufficientForInference: sufficient,
    evidenceFloor,
    note: sufficient
      ? 'Measured on this deployment. Intervals are Wilson score at 95%.'
      : `Too few confirmed cases for a reliable estimate (needs ${MIN_PER_CLASS} ` +
        `confirmed positives and ${MIN_PER_CLASS} confirmed negatives; has ` +
        `${actualPositives} and ${actualNegatives}). Counts and intervals are shown ` +
        `so the imprecision is visible rather than hidden.`,
  };
}

/** Formats a rate for a UI that must not print a bare point estimate. */
export function describeRate(r: Rate): string {
  if (r.value === null) return 'not measurable';
  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
  const range = r.interval ? ` (95% CI ${pct(r.interval.low)}–${pct(r.interval.high)})` : '';
  return `${pct(r.value)}${range}, n=${r.denominator}`;
}
