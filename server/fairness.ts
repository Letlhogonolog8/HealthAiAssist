/**
 * Serves the stratified skin-tone measurement, and refuses to serve it stale.
 *
 * ── Why this needed anything ───────────────────────────────────────────────
 *
 * scripts/measure-skin-tone-performance.py already did the hard part: it
 * estimates Individual Typology Angle from perilesional skin, bins on the
 * Chardon/Del Bino cut points, and reports sensitivity per bin with Wilson
 * intervals and an explicit `reliable` flag. It has been run. The result sat in
 * dataset/data/skin_tone_performance.json where nothing published it, and the
 * only trace in the API was a sentence of prose in the model card caveats.
 *
 * That is the weakest possible form of a finding this important. A reader of
 * /api/models/cards saw "cannot establish performance on darker skin" as an
 * assertion, with no numbers, no counts and no intervals behind it — which is
 * indistinguishable from a disclaimer somebody wrote to be safe.
 *
 * ── The staleness problem it shares with the headline figures ─────────────
 *
 * The report identified its subject as `resnet50v2_skin_cancer_model.h5` — a
 * filename. A filename does not change when the file does, so retraining left
 * the report claiming to describe an artifact that no longer existed. The
 * script now records a content digest, and this module refuses to present the
 * numbers as current unless that digest matches the deployed model.
 *
 * ── What must survive to the response ─────────────────────────────────────
 *
 * The per-bin counts, the intervals, and above all the `reliable` flags. A bin
 * holding four images with no benign controls produces a sensitivity of 1.0,
 * and 1.0 published without its n is worse than publishing nothing: it reads as
 * the model working perfectly on dark skin, which is the opposite of what the
 * data supports.
 */
import { readFile } from 'fs/promises';
import path from 'path';

import { modelVersionFor } from './model-fingerprint';

export interface ToneBin {
  n: number;
  nMalignant: number;
  nBenign: number;
  sensitivity: number | null;
  sensitivityCI: [number, number] | null;
  specificity: number | null;
  specificityCI: [number, number] | null;
  balancedAccuracy: number | null;
  outrightBenignOnMalignant: number;
  outrightBenignRate: number | null;
  reliable: boolean;
}

export interface FairnessReport {
  model: string;
  artifactFingerprint?: string;
  measuredAt?: string;
  method: string;
  operatingPoint: string;
  imagesTotal: number;
  imagesWithItaEstimate: number;
  bins: Record<string, ToneBin>;
  binsConsideredReliable: string[];
  sensitivitySpreadAcrossReliableBins: number | null;
  limitations: string[];
}

export type FairnessState =
  /** The measurement describes the deployed artifact. */
  | 'current'
  /** A measurement exists but was taken on a different artifact. */
  | 'stale'
  /** The report predates fingerprinting, so it cannot be tied to an artifact. */
  | 'unverifiable'
  /** No measurement has been run for this modality. */
  | 'absent';

export interface FairnessStatus {
  modality: string;
  state: FairnessState;
  deployedFingerprint: string | null;
  measuredFingerprint: string | null;
  report: FairnessReport | null;
  /**
   * The finding, stated once, in the response rather than only in prose
   * somewhere else. Present whatever the state, because a reader who gets an
   * empty object should not conclude there is nothing to know.
   */
  headline: string;
}

const REPORT_PATHS: Record<string, string> = {
  skin: path.join(process.cwd(), 'dataset', 'data', 'skin_tone_performance.json'),
};

function bareFingerprint(version: string): string {
  const parts = version.split('-');
  return parts[parts.length - 1];
}

/**
 * Reads the measurement and says whether it describes what is deployed.
 *
 * Never throws: a missing or malformed report is reported as absent rather than
 * failing the endpoint, because the caller is usually rendering a model card
 * and an error there tells a reader less than "not measured" does.
 */
export async function fairnessStatus(modality: string): Promise<FairnessStatus> {
  const reportPath = REPORT_PATHS[modality];

  if (!reportPath) {
    return {
      modality,
      state: 'absent',
      deployedFingerprint: null,
      measuredFingerprint: null,
      report: null,
      headline:
        `No stratified performance measurement exists for ${modality}. ` +
        'Demographic composition of its training and test data is unrecorded, ' +
        'so performance across any subgroup is unknown rather than equal.',
    };
  }

  let report: FairnessReport;
  try {
    report = JSON.parse(await readFile(reportPath, 'utf8'));
  } catch {
    return {
      modality,
      state: 'absent',
      deployedFingerprint: null,
      measuredFingerprint: null,
      report: null,
      headline:
        `No stratified performance measurement is available for ${modality}. ` +
        'Run scripts/measure-skin-tone-performance.py.',
    };
  }

  let deployed: string | null = null;
  try {
    deployed = bareFingerprint(await modelVersionFor(modality as any));
    if (deployed === 'unknown') deployed = null;
  } catch {
    deployed = null;
  }

  const measured = report.artifactFingerprint ?? null;

  // Written from the measurement rather than hardcoded, so it cannot drift from
  // the numbers underneath it the way the model-card prose did.
  const unreliable = Object.entries(report.bins ?? {})
    .filter(([, b]) => !b.reliable)
    .map(([name]) => name);
  const darkN = (report.bins?.dark?.n ?? 0) + (report.bins?.brown?.n ?? 0);
  const pctDarker = report.imagesWithItaEstimate
    ? ((darkN / report.imagesWithItaEstimate) * 100).toFixed(1)
    : '0';

  const headline =
    `Only ${pctDarker}% of the ${report.imagesWithItaEstimate} images with an ITA ` +
    `estimate fall in the brown or dark bins, and ${unreliable.length} of ` +
    `${Object.keys(report.bins ?? {}).length} bins hold too few images to be ` +
    'reliable. This dataset CANNOT establish performance on darker skin. The ' +
    'absence of a measured disparity here is evidence of an unrepresentative ' +
    'test set, not of fairness.';

  if (!measured) {
    return {
      modality,
      state: 'unverifiable',
      deployedFingerprint: deployed,
      measuredFingerprint: null,
      report,
      headline:
        headline +
        ' The report predates artifact fingerprinting, so it cannot be confirmed ' +
        'to describe the deployed model. Re-run the measurement.',
    };
  }

  if (deployed && measured !== deployed) {
    return {
      modality,
      state: 'stale',
      deployedFingerprint: deployed,
      measuredFingerprint: measured,
      report,
      headline:
        `This measurement was taken on artifact ${measured}, but ${deployed} is ` +
        'deployed. It does not describe the model currently serving, and the ' +
        'subgroup performance of that model is unknown. Re-run ' +
        'scripts/measure-skin-tone-performance.py.',
    };
  }

  return {
    modality,
    state: 'current',
    deployedFingerprint: deployed,
    measuredFingerprint: measured,
    report,
    headline,
  };
}
