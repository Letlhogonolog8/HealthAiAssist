/**
 * High-penetrance actionable variant screening.
 *
 * Distinct from PRS: a pathogenic BRCA1/2 variant is not a small nudge to a
 * population risk score, it is a finding that changes management on its own and
 * carries implications for blood relatives. It is reported qualitatively, never
 * folded into a numeric score.
 *
 * WHY THERE IS NO BUILT-IN VARIANT LIST
 *
 * Pathogenicity assertions are not stable facts that can be hardcoded. They are
 * curated, versioned, and periodically reclassified — a variant called pathogenic
 * in 2019 may be a variant of uncertain significance today. Embedding a list from
 * memory or from a blog post would produce assertions that look identical to
 * curated ones. Telling someone they carry a pathogenic BRCA1 variant when they
 * do not is not a bug you find in testing; it is a person scheduling surgery.
 *
 * So the operator installs a ClinVar-derived table and the loader records which
 * release it came from. Format is documented in panels/README.md.
 *
 * IMPORTANT LIMITATION: consumer genotyping arrays assay a small, fixed set of
 * positions. Absence of a variant call is NOT evidence of absence of the variant
 * — most pathogenic BRCA variants are not on any consumer array. This module
 * reports "not assayed" separately from "assayed, not present", because
 * collapsing the two into "negative" is how false reassurance happens.
 */
import fs from 'fs';
import path from 'path';

export type Classification =
  | 'pathogenic'
  | 'likely_pathogenic'
  | 'uncertain_significance'
  | 'likely_benign'
  | 'benign';

export interface ActionableVariant {
  rsid: string;
  gene: string;
  /** Allele whose presence constitutes the finding. */
  riskAllele: string;
  classification: Classification;
  condition: string;
  /** ClinVar variation ID, for traceability. */
  clinvarId: string | null;
  /** Inheritance pattern, e.g. "autosomal dominant". */
  inheritance: string | null;
}

export interface ActionablePanel {
  source: string;
  /** ClinVar release date or equivalent version stamp. */
  version: string;
  synthetic: boolean;
  variants: ActionableVariant[];
}

export interface ActionableFinding {
  rsid: string;
  gene: string;
  classification: Classification;
  condition: string;
  clinvarId: string | null;
  inheritance: string | null;
  /** Copies of the risk allele observed: 1 = heterozygous, 2 = homozygous. */
  copies: number;
}

export interface ActionableScreenResult {
  /** Null when no panel is installed — distinct from "screened, found nothing". */
  screened: boolean;
  panelSource: string | null;
  panelVersion: string | null;
  synthetic: boolean;
  findings: ActionableFinding[];
  /** Panel variants this profile HAS a call for and which were negative. */
  assayedNegative: number;
  /**
   * Panel variants absent from the profile entirely. These are unknowns, not
   * negatives, and the count is surfaced so nobody reads a clean result as
   * "cleared".
   */
  notAssayed: string[];
  caveats: string[];
}

const PANEL_PATH = path.join(
  process.cwd(), 'server', 'genomics', 'panels', 'actionable-variants.json'
);

export function loadActionablePanel(): ActionablePanel | null {
  if (!fs.existsSync(PANEL_PATH)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(PANEL_PATH, 'utf-8')) as ActionablePanel;
    if (!Array.isArray(parsed.variants)) return null;
    return parsed;
  } catch (error) {
    console.error('Failed to load actionable variant panel:', error);
    return null;
  }
}

const REPORTABLE: Classification[] = ['pathogenic', 'likely_pathogenic'];

export function screenActionableVariants(
  genotypesByRsid: Map<string, string>,
  panel: ActionablePanel | null
): ActionableScreenResult {
  if (!panel) {
    return {
      screened: false,
      panelSource: null,
      panelVersion: null,
      synthetic: false,
      findings: [],
      assayedNegative: 0,
      notAssayed: [],
      caveats: [
        'No actionable variant panel is installed, so no screening was performed. ' +
        'This is not a negative result.'
      ],
    };
  }

  const findings: ActionableFinding[] = [];
  const notAssayed: string[] = [];
  let assayedNegative = 0;

  for (const variant of panel.variants) {
    const genotype = genotypesByRsid.get(variant.rsid);

    if (!genotype || genotype === '--') {
      notAssayed.push(variant.rsid);
      continue;
    }

    const copies = genotype
      .toUpperCase()
      .split('')
      .filter((base) => base === variant.riskAllele.toUpperCase()).length;

    if (copies > 0 && REPORTABLE.includes(variant.classification)) {
      findings.push({
        rsid: variant.rsid,
        gene: variant.gene,
        classification: variant.classification,
        condition: variant.condition,
        clinvarId: variant.clinvarId,
        inheritance: variant.inheritance,
        copies,
      });
    } else {
      assayedNegative++;
    }
  }

  const caveats: string[] = [];

  if (notAssayed.length) {
    caveats.push(
      `${notAssayed.length} of ${panel.variants.length} panel variants were not ` +
      'present in this genotype file. Those are unknown, not negative.'
    );
  }

  caveats.push(
    'This screens only the specific positions in the installed panel. Most ' +
    'pathogenic variants in these genes are not covered by consumer genotyping ' +
    'arrays. A result with no findings does NOT rule out hereditary risk, and ' +
    'does not replace diagnostic sequencing.'
  );

  if (findings.length) {
    caveats.push(
      'Any finding here requires confirmation by an accredited diagnostic ' +
      'laboratory before it is acted on. Array genotyping is not a diagnostic ' +
      'test, and false positives at individual positions occur.'
    );
    caveats.push(
      'Findings in these genes carry implications for blood relatives. Referral ' +
      'to genetic counselling is indicated before disclosure decisions are made.'
    );
  }

  if (panel.synthetic) {
    caveats.unshift(
      'The installed panel is SYNTHETIC test data. No finding here has any ' +
      'clinical meaning.'
    );
  }

  return {
    screened: true,
    panelSource: panel.source,
    panelVersion: panel.version,
    synthetic: panel.synthetic === true,
    findings,
    assayedNegative,
    notAssayed,
    caveats,
  };
}
