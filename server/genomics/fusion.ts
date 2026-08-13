/**
 * Combines imaging, polygenic and clinical signals into one risk band.
 *
 * The honest framing matters here. There is no published, validated model for
 * fusing *these specific* inputs — a ResNet on a lesion photo, a PRS of unknown
 * transferability, and a handful of self-reported clinical factors. Anything
 * that emitted a calibrated probability from that would be inventing one.
 *
 * So this does not emit a probability. It emits a **triage band** plus a full
 * account of what drove it, under transparent rules that a clinician can read
 * and disagree with. The output is a queue ordering, not a risk estimate.
 *
 * Design rules:
 *  - Imaging dominates. It observes the actual lesion; a PRS describes a
 *    population.
 *  - The polygenic component can raise a band, never lower one. A reassuring
 *    PRS must not talk anyone out of a suspicious mole.
 *  - A PRS with low ancestry transferability contributes nothing at all, rather
 *    than contributing a discounted amount. Weighting an uninterpretable number
 *    by 0.25 still lets it move the answer.
 *  - Every input that was missing is named in the output.
 */
import type { Transferability } from './ancestry';
import type { PrsResult } from './prs';
import type { ActionableScreenResult } from './actionable-variants';

export type RiskBand = 'low' | 'moderate' | 'high' | 'indeterminate';

export interface ImagingSignal {
  scanId: number | null;
  /** True when the classifier flagged the scan. */
  flagged: boolean;
  /** Classifier confidence, 0-100. */
  confidence: number;
  /** 'low' | 'medium' | 'high' from the imaging pipeline. */
  riskLevel: string;
}

export interface ClinicalSignal {
  age?: number | null;
  familyHistory?: boolean | null;
  /** e.g. heavy sun exposure, immunosuppression, prior malignancy. */
  knownRiskFactors?: string[];
}

export interface FusionInput {
  condition: string;
  imaging?: ImagingSignal | null;
  prs?: PrsResult | null;
  transferability?: Transferability | null;
  actionable?: ActionableScreenResult | null;
  clinical?: ClinicalSignal | null;
}

export interface FusionResult {
  condition: string;
  band: RiskBand;
  /** Ordered, human-readable account of what moved the band. */
  contributions: Array<{ source: string; effect: string; detail: string }>;
  /** Inputs that were absent, and what their absence means. */
  missingInputs: string[];
  caveats: string[];
  requiresClinicianReview: boolean;
  /** True when any component was synthetic — blocks clinical presentation. */
  containsSyntheticData: boolean;
}

const ORDER: RiskBand[] = ['low', 'moderate', 'high'];

function raise(current: RiskBand, to: RiskBand): RiskBand {
  if (current === 'indeterminate') return to;
  return ORDER.indexOf(to) > ORDER.indexOf(current) ? to : current;
}

export function fuseRisk(input: FusionInput): FusionResult {
  const contributions: FusionResult['contributions'] = [];
  const missingInputs: string[] = [];
  const caveats: string[] = [];
  let band: RiskBand = 'indeterminate';
  let containsSyntheticData = false;

  // ---- Imaging: the primary signal --------------------------------------
  if (input.imaging) {
    const { flagged, confidence, riskLevel } = input.imaging;
    if (flagged) {
      band = raise(band, riskLevel === 'high' ? 'high' : 'moderate');
      contributions.push({
        source: 'imaging',
        effect: `set band to ${band}`,
        detail: `Classifier flagged the scan at ${confidence.toFixed(1)}% confidence.`,
      });
    } else {
      band = raise(band, 'low');
      contributions.push({
        source: 'imaging',
        effect: 'set band to low',
        detail: `Classifier did not flag the scan (${confidence.toFixed(1)}% confidence).`,
      });
    }
  } else {
    missingInputs.push(
      'No imaging result. The band below rests on genomic and clinical inputs ' +
      'only, which describe population risk rather than any observed lesion.'
    );
  }

  // ---- Actionable variants: can independently drive the band up ---------
  if (input.actionable?.screened) {
    if (input.actionable.synthetic) containsSyntheticData = true;

    if (input.actionable.findings.length) {
      band = raise(band, 'high');
      const genes = [...new Set(input.actionable.findings.map((f) => f.gene))].join(', ');
      contributions.push({
        source: 'actionable_variants',
        effect: 'raised band to high',
        detail:
          `${input.actionable.findings.length} pathogenic or likely-pathogenic ` +
          `finding(s) in ${genes}. Requires confirmatory diagnostic sequencing ` +
          'and genetic counselling referral.',
      });
    } else {
      contributions.push({
        source: 'actionable_variants',
        effect: 'no change',
        detail:
          `No reportable findings among ${input.actionable.assayedNegative} assayed ` +
          `panel positions; ${input.actionable.notAssayed.length} positions were not ` +
          'assayed and remain unknown.',
      });
    }
    caveats.push(...input.actionable.caveats);
  } else {
    missingInputs.push('No actionable variant screening was performed.');
  }

  // ---- Polygenic score: raises only, and only when interpretable --------
  if (input.prs) {
    if (input.prs.provenance === 'synthetic') containsSyntheticData = true;

    const transfer = input.transferability;
    const interpretable =
      transfer !== null &&
      transfer !== undefined &&
      transfer.percentileReportable &&
      input.prs.percentile !== null;

    if (!interpretable) {
      const why =
        input.prs.percentile === null
          ? input.prs.percentileWithheldReason ?? 'No percentile available.'
          : `Score does not transfer to the recorded ancestry group ` +
            `("${transfer?.group}"), so it carries no usable information here.`;

      contributions.push({
        source: 'polygenic_score',
        effect: 'excluded',
        detail: `${why} Excluded entirely rather than down-weighted — a number that ` +
          'cannot be interpreted should not move the result at all.',
      });
      caveats.push(transfer?.guidance ?? why);
    } else {
      const percentile = input.prs.percentile as number;
      if (percentile >= 90) {
        band = raise(band, 'moderate');
        contributions.push({
          source: 'polygenic_score',
          effect: band === 'high' ? 'no change (already high)' : 'raised band to moderate',
          detail:
            `Polygenic score at the ${percentile}th percentile of the reference ` +
            `population (panel ${input.prs.panelId}, ${input.prs.coveragePct}% coverage).`,
        });
      } else {
        contributions.push({
          source: 'polygenic_score',
          effect: 'no change',
          detail:
            `Polygenic score at the ${percentile}th percentile — not elevated. ` +
            'A non-elevated score cannot lower the band: it describes population ' +
            'risk and says nothing about this individual lesion.',
        });
      }
      if (transfer) caveats.push(transfer.guidance);
    }
  } else {
    missingInputs.push('No polygenic score (no genomic profile, or no panel installed).');
  }

  // ---- Clinical factors: raise only -------------------------------------
  if (input.clinical) {
    const factors: string[] = [];
    if (input.clinical.familyHistory) factors.push('family history');
    if (typeof input.clinical.age === 'number' && input.clinical.age >= 65) {
      factors.push('age 65+');
    }
    if (input.clinical.knownRiskFactors?.length) {
      factors.push(...input.clinical.knownRiskFactors);
    }

    if (factors.length >= 2) {
      band = raise(band, 'moderate');
      contributions.push({
        source: 'clinical',
        effect: band === 'high' ? 'no change (already high)' : 'raised band to moderate',
        detail: `Multiple clinical risk factors: ${factors.join(', ')}.`,
      });
    } else if (factors.length === 1) {
      contributions.push({
        source: 'clinical',
        effect: 'no change',
        detail: `One clinical risk factor noted: ${factors[0]}.`,
      });
    }
  } else {
    missingInputs.push('No clinical history supplied.');
  }

  if (band === 'indeterminate') {
    caveats.push(
      'No input carried enough information to place this in a band. This is not ' +
      'a low-risk result.'
    );
  }

  caveats.push(
    'This is a triage band produced by transparent rules, not a validated risk ' +
    'model, and not a probability. It orders review; it does not diagnose.'
  );

  if (containsSyntheticData) {
    caveats.unshift(
      'THIS RESULT INCLUDES SYNTHETIC TEST DATA and must not be shown to a ' +
      'patient or used for any clinical decision.'
    );
  }

  return {
    condition: input.condition,
    band,
    contributions,
    missingInputs,
    caveats,
    requiresClinicianReview: true,
    containsSyntheticData,
  };
}
