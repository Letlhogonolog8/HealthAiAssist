/**
 * Ancestry transferability for polygenic risk scores.
 *
 * Nearly all published PRS are derived from GWAS cohorts that are overwhelmingly
 * European-ancestry — commonly cited at ~80-90% of participants (Popejoy &
 * Fullerton, Nature 2016; Sirugo, Neale & Williams, Cell 2019; Martin et al.,
 * Nat Genet 2019). A score built in one population does not transfer intact to
 * another: linkage disequilibrium patterns differ, allele frequencies differ,
 * and effect sizes are estimated in the discovery population's genetic
 * background.
 *
 * The consequence is not that a score becomes noisy in an obvious way. It is
 * that the score keeps producing a confident-looking number that means less than
 * it appears to. Martin et al. 2019 ("Clinical use of current polygenic risk
 * scores may exacerbate health disparities", Nat Genet 51:584-591) found
 * European-derived PRS achieve substantially lower prediction accuracy in
 * non-European populations, with African-ancestry individuals worst affected.
 *
 * This module makes that attenuation explicit in the output instead of hiding it.
 *
 * IMPORTANT: the factors below are coarse, literature-derived approximations for
 * *communicating uncertainty*. They vary by trait, by score, and by how ancestry
 * is defined. They are not calibration coefficients and must not be used to
 * "correct" a score back up. They only ever widen intervals and downgrade
 * confidence.
 */

export type AncestryConfidence = 'moderate' | 'low' | 'very_low' | 'unknown';

export interface Transferability {
  /** Group key this resolved to. */
  group: string;
  /**
   * Approximate accuracy retained relative to the score's discovery population,
   * 0-1. Used to widen intervals, never to rescale the score.
   */
  factor: number;
  confidence: AncestryConfidence;
  /** Whether a population percentile may be reported at all. */
  percentileReportable: boolean;
  citation: string;
  /** Plain-language explanation intended to be shown to the patient. */
  guidance: string;
}

/**
 * Coarse groupings matching how GWAS cohorts are typically stratified. Real
 * ancestry is continuous and individuals are frequently admixed; these buckets
 * are a reporting convenience, and the guidance text says so.
 */
const GROUPS: Record<string, Omit<Transferability, 'group'>> = {
  european: {
    factor: 1.0,
    confidence: 'moderate',
    percentileReportable: true,
    citation: 'Discovery population for most published PRS (Martin et al., Nat Genet 2019)',
    guidance:
      'This score was derived mainly in European-ancestry cohorts, so it applies ' +
      'to you about as well as it applies to anyone. That is still a screening ' +
      'estimate, not a diagnosis.'
  },
  south_asian: {
    factor: 0.6,
    confidence: 'low',
    percentileReportable: true,
    citation: 'Martin et al., Nat Genet 2019, 51:584-591 (approximate relative accuracy)',
    guidance:
      'This score was derived mainly in European-ancestry cohorts. It carries ' +
      'meaningfully less predictive power for people of South Asian ancestry, so ' +
      'the range shown is wider and the position within it is less certain.'
  },
  east_asian: {
    factor: 0.5,
    confidence: 'low',
    percentileReportable: true,
    citation: 'Martin et al., Nat Genet 2019, 51:584-591 (approximate relative accuracy)',
    guidance:
      'This score was derived mainly in European-ancestry cohorts. It carries ' +
      'meaningfully less predictive power for people of East Asian ancestry, so ' +
      'the range shown is wider and the position within it is less certain.'
  },
  hispanic_latino: {
    factor: 0.5,
    confidence: 'low',
    percentileReportable: true,
    citation: 'Martin et al., Nat Genet 2019, 51:584-591 (approximate relative accuracy)',
    guidance:
      'This score was derived mainly in European-ancestry cohorts. Admixed ' +
      'populations are poorly represented in that data, so the range shown is ' +
      'wider and the position within it is less certain.'
  },
  african: {
    factor: 0.25,
    confidence: 'very_low',
    // Percentiles are withheld: the reference distribution used to rank a score
    // is itself European, so a percentile against it is not interpretable here.
    percentileReportable: false,
    citation: 'Martin et al., Nat Genet 2019, 51:584-591 (approximate relative accuracy)',
    guidance:
      'This score was derived almost entirely in European-ancestry cohorts and ' +
      'transfers poorly to people of African ancestry — African genomes are the ' +
      'most under-represented in genomic research and also the most genetically ' +
      'diverse. No percentile is shown, because ranking you against a European ' +
      'reference population would not mean what it appears to mean. Treat the ' +
      'polygenic component as uninformative and rely on family history, clinical ' +
      'findings and any high-penetrance variants reported separately.'
  },
  admixed_other: {
    factor: 0.4,
    confidence: 'very_low',
    percentileReportable: false,
    citation: 'Martin et al., Nat Genet 2019, 51:584-591 (approximate relative accuracy)',
    guidance:
      'Your reported ancestry is not well represented in the cohorts this score ' +
      'was built from. No percentile is shown, because the reference distribution ' +
      'does not describe your population.'
  }
};

const UNKNOWN: Omit<Transferability, 'group'> = {
  factor: 0.4,
  confidence: 'unknown',
  percentileReportable: false,
  citation: 'No ancestry recorded',
  guidance:
    'No ancestry was recorded, so how well this score applies to you cannot be ' +
    'assessed. No percentile is shown. Ancestry is deliberately NOT assumed — ' +
    'defaulting to European is the assumption that produces confident, wrong ' +
    'answers for most of the world.'
};

/** Free-text ancestry to group key. Deliberately conservative on near-misses. */
const ALIASES: Array<[RegExp, string]> = [
  [/\b(european|white|caucasian|afrikaner|ashkenazi|jewish)\b/i, 'european'],
  [/\b(south[\s_-]?asian|indian|pakistani|bangladeshi|sri[\s_-]?lankan)\b/i, 'south_asian'],
  [/\b(east[\s_-]?asian|chinese|japanese|korean|vietnamese)\b/i, 'east_asian'],
  [/\b(hispanic|latino|latina|latinx)\b/i, 'hispanic_latino'],
  [/\b(african|black|nigerian|ghanaian|kenyan|zulu|xhosa|sotho|tswana|yoruba)\b/i, 'african'],
  [/\b(mixed|admixed|coloured|multiracial|other)\b/i, 'admixed_other'],
];

export function resolveAncestryGroup(selfReported: string | null | undefined): string | null {
  if (!selfReported || !selfReported.trim()) return null;
  const value = selfReported.trim();
  if (GROUPS[value.toLowerCase()]) return value.toLowerCase();
  for (const [pattern, group] of ALIASES) {
    if (pattern.test(value)) return group;
  }
  return null;
}

export function getTransferability(selfReported: string | null | undefined): Transferability {
  const group = resolveAncestryGroup(selfReported);
  if (!group) return { group: 'unknown', ...UNKNOWN };
  return { group, ...GROUPS[group] };
}

/**
 * Widens a percentile into a plausible range given transferability.
 *
 * A score with factor 1.0 gets a narrow band; factor 0.25 gets a band so wide it
 * is visibly uninformative. That visible width is the point — it communicates
 * "we do not know" better than any disclaimer sitting next to a precise number.
 */
export function percentileInterval(
  percentile: number,
  factor: number
): { low: number; high: number; widthPct: number } {
  // At factor 1.0 the half-width is 10 points; it grows as accuracy falls.
  const halfWidth = Math.min(50, 10 / Math.max(factor, 0.05));
  const low = Math.max(0, Math.round(percentile - halfWidth));
  const high = Math.min(100, Math.round(percentile + halfWidth));
  return { low, high, widthPct: high - low };
}

/** Every group and its factor — for the equity dashboard and model cards. */
export function transferabilityTable(): Array<Transferability & { group: string }> {
  return [
    ...Object.entries(GROUPS).map(([group, v]) => ({ group, ...v })),
    { group: 'unknown', ...UNKNOWN }
  ];
}
