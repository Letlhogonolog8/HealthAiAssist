/**
 * Polygenic risk score computation.
 *
 * Scoring panels are NOT authored here. They are loaded from PGS Catalog
 * scoring files (https://www.pgscatalog.org/), which are versioned, citable, and
 * carry their own provenance. Inventing effect sizes would produce a number that
 * looks exactly like a real one — the same failure this codebase already had
 * with fabricated model accuracy, but harder to detect.
 *
 * A panel that is not sourced from a real scoring file is marked
 * `provenance: 'synthetic'` and every score computed from it carries that flag
 * out through the API, where it must be refused for clinical display.
 *
 * See server/genomics/panels/README.md for how to install a real panel.
 */
import fs from 'fs';
import path from 'path';

export type PanelProvenance = 'pgs_catalog' | 'synthetic';

export interface PanelVariant {
  rsid: string;
  /** Allele the weight applies to. */
  effectAllele: string;
  otherAllele: string | null;
  /** Per-allele weight, typically a log odds ratio. */
  weight: number;
}

export interface ScoringPanel {
  id: string;
  condition: string;
  provenance: PanelProvenance;
  /** PGS Catalog accession, e.g. "PGS000356". Null for synthetic panels. */
  pgsId: string | null;
  genomeBuild: string | null;
  /** Population the score was derived in, as declared by the source. */
  discoveryAncestry: string | null;
  citation: string | null;
  variants: PanelVariant[];
}

export interface PrsResult {
  panelId: string;
  condition: string;
  provenance: PanelProvenance;
  /** Sum of weight x dosage over genotyped variants. */
  rawScore: number;
  /** Variants in the panel that this profile actually has a call for. */
  matchedVariants: number;
  panelSize: number;
  coveragePct: number;
  /**
   * Percentile against the panel's reference distribution, or null when
   * coverage is too low or the panel provides no reference distribution.
   */
  percentile: number | null;
  /** Why a percentile was withheld, when it was. */
  percentileWithheldReason: string | null;
  warnings: string[];
}

/** Below this, a score is dominated by which variants happen to be missing. */
export const MIN_COVERAGE_PCT = 80;

/**
 * Maps the several names each human reference assembly goes by onto one label.
 * hg19 and GRCh37 are the same coordinates; so are hg38 and GRCh38.
 * Returns null for an unrecognised or absent build, which callers treat as
 * "unknown" rather than as a mismatch.
 */
export function normaliseBuild(build: string | null | undefined): string | null {
  if (!build) return null;
  const value = build.trim().toLowerCase();
  if (/grch38|hg38/.test(value)) return 'GRCh38';
  if (/grch37|hg19|build\s*37/.test(value)) return 'GRCh37';
  if (/ncbi36|hg18|build\s*36/.test(value)) return 'NCBI36';
  return null;
}

/**
 * Counts copies of the effect allele in a diploid call.
 * Returns null for no-calls, which are excluded rather than imputed as 0 —
 * treating a missing genotype as "no risk alleles" biases every score downward.
 */
export function dosage(genotype: string, effectAllele: string): number | null {
  if (!genotype || genotype === '--') return null;
  const allele = effectAllele.toUpperCase();
  let count = 0;
  for (const base of genotype.toUpperCase()) {
    if (base === allele) count++;
  }
  return count;
}

/**
 * Parses a PGS Catalog scoring file.
 *
 * Format: `#` comment header carrying metadata, then a tab-separated table whose
 * columns include rsID (or hm_rsID), effect_allele, other_allele, effect_weight.
 */
export function parsePgsScoringFile(content: string, condition: string): ScoringPanel {
  const lines = content.split(/\r?\n/);
  const meta: Record<string, string> = {};
  let headerCols: string[] | null = null;
  const variants: PanelVariant[] = [];

  for (const line of lines) {
    if (!line.trim()) continue;

    if (line.startsWith('#')) {
      const match = line.slice(1).match(/^([a-zA-Z_]+)=(.*)$/);
      if (match) meta[match[1].toLowerCase()] = match[2].trim();
      continue;
    }

    const cols = line.split('\t');

    if (!headerCols) {
      headerCols = cols.map((c) => c.trim().toLowerCase());
      continue;
    }

    const get = (name: string): string | undefined => {
      const idx = headerCols!.indexOf(name);
      return idx === -1 ? undefined : cols[idx]?.trim();
    };

    const rsid = get('rsid') || get('hm_rsid');
    const effectAllele = get('effect_allele');
    const weightRaw = get('effect_weight');
    if (!rsid || !effectAllele || weightRaw === undefined) continue;

    const weight = Number.parseFloat(weightRaw);
    if (Number.isNaN(weight)) continue;

    variants.push({
      rsid,
      effectAllele: effectAllele.toUpperCase(),
      otherAllele: (get('other_allele') || '').toUpperCase() || null,
      weight,
    });
  }

  if (variants.length === 0) {
    throw new Error(
      'No usable variants in scoring file. Expected tab-separated columns ' +
      'including rsID, effect_allele and effect_weight.'
    );
  }

  return {
    id: meta.pgs_id || 'unknown',
    condition,
    provenance: 'pgs_catalog',
    pgsId: meta.pgs_id || null,
    genomeBuild: meta.genome_build || null,
    // PGS Catalog scoring-file headers do not carry the discovery-cohort
    // ancestry; it lives in the REST metadata. Recorded in the reference
    // distribution's `population` field instead, which is where it matters.
    discoveryAncestry: meta.ancestry || null,
    citation: meta.citation || meta.pgs_name || null,
    variants,
  };
}

const PANEL_DIR = path.join(process.cwd(), 'server', 'genomics', 'panels');

/** Files in the panel directory that are not polygenic scoring panels. */
const NOT_A_SCORING_PANEL = new Set(['actionable-variants.json']);

export interface ReferenceDistribution {
  mean: number;
  sd: number;
  /** Which population this distribution describes. Required — a percentile is
   *  only interpretable relative to a named population. */
  population: string;
  source?: string;
}

/** Loads every installed panel. Missing directory is not an error — just none. */
export function loadPanels(): ScoringPanel[] {
  if (!fs.existsSync(PANEL_DIR)) return [];

  const panels: ScoringPanel[] = [];
  for (const file of fs.readdirSync(PANEL_DIR)) {
    if (NOT_A_SCORING_PANEL.has(file) || file.endsWith('.reference.json')) continue;
    const full = path.join(PANEL_DIR, file);

    try {
      if (file.endsWith('.json')) {
        // Synthetic/test panels carry their own declaration.
        const parsed = JSON.parse(fs.readFileSync(full, 'utf-8')) as ScoringPanel;
        if (!parsed.id || !Array.isArray(parsed.variants)) continue;
        panels.push(parsed);
      } else if (file.endsWith('.txt') || file.endsWith('.tsv')) {
        // PGS Catalog scoring file; condition comes from the filename prefix.
        const condition = file.replace(/\.(txt|tsv)$/, '').split('.')[0];
        panels.push(parsePgsScoringFile(fs.readFileSync(full, 'utf-8'), condition));
      }
    } catch (error) {
      console.error(`Failed to load scoring panel ${file}:`, error);
    }
  }
  return panels;
}

/**
 * Loads `<condition>.reference.json`, if the operator installed one.
 *
 * Returns null when absent, which causes `computePrs` to withhold the
 * percentile. That is the correct behaviour: without a reference population
 * there is nothing to be a percentile *of*.
 */
export function loadReferenceDistribution(condition: string): ReferenceDistribution | null {
  const file = path.join(PANEL_DIR, `${condition.toLowerCase()}.reference.json`);
  if (!fs.existsSync(file)) return null;

  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as ReferenceDistribution;
    if (typeof parsed.mean !== 'number' || typeof parsed.sd !== 'number' || !(parsed.sd > 0)) {
      console.error(`Reference distribution for ${condition} is malformed; ignoring.`);
      return null;
    }
    if (!parsed.population) {
      console.error(
        `Reference distribution for ${condition} does not name its population; ignoring. ` +
        'An unattributed percentile cannot be interpreted.'
      );
      return null;
    }
    return parsed;
  } catch (error) {
    console.error(`Failed to load reference distribution for ${condition}:`, error);
    return null;
  }
}

export function findPanel(panels: ScoringPanel[], condition: string): ScoringPanel | null {
  const target = condition.toLowerCase();
  return panels.find((p) => p.condition.toLowerCase() === target) ?? null;
}

/**
 * Computes a raw PRS.
 *
 * `referenceDistribution` maps a raw score onto a percentile. Without one, no
 * percentile is reported — a raw weighted sum has no meaning on its own, and
 * inventing a distribution to rank it against would be fabrication.
 */
export function computePrs(
  panel: ScoringPanel,
  genotypesByRsid: Map<string, string>,
  referenceDistribution?: { mean: number; sd: number } | null,
  profileGenomeBuild?: string | null
): PrsResult {
  const warnings: string[] = [];
  let rawScore = 0;
  let matched = 0;

  // A scoring file built on one reference assembly applied to genotypes called
  // on another produces a number, silently, and it is wrong: coordinates and in
  // some cases strand differ between builds. Refuse rather than report.
  //
  // Compared after normalisation, because the same assembly has two common
  // names: PGS Catalog files say "hg19" where a 23andMe header says "build 37",
  // and treating those as different would reject a perfectly valid pairing.
  const panelBuild = normaliseBuild(panel.genomeBuild);
  const profileBuild = normaliseBuild(profileGenomeBuild);
  const buildMismatch = !!panelBuild && !!profileBuild && panelBuild !== profileBuild;

  if (buildMismatch) {
    warnings.push(
      `Genome build mismatch: the panel is ${panel.genomeBuild} (${panelBuild}) but ` +
      `this genotype file is ${profileGenomeBuild} (${profileBuild}). The score ` +
      'below is not valid and no percentile is reported.'
    );
  } else if (panel.genomeBuild && !profileGenomeBuild) {
    warnings.push(
      `The genotype file did not declare a reference build; the panel expects ` +
      `${panel.genomeBuild}. Build compatibility could not be confirmed.`
    );
  }

  for (const variant of panel.variants) {
    const genotype = genotypesByRsid.get(variant.rsid);
    if (!genotype) continue;

    const copies = dosage(genotype, variant.effectAllele);
    if (copies === null) continue;

    rawScore += variant.weight * copies;
    matched++;
  }

  const coveragePct = panel.variants.length
    ? Math.round((matched / panel.variants.length) * 100)
    : 0;

  let percentile: number | null = null;
  let percentileWithheldReason: string | null = null;

  if (buildMismatch) {
    percentileWithheldReason =
      `Genome build mismatch (panel ${panelBuild} vs genotypes ${profileBuild}). ` +
      'Positions are not comparable across builds.';
  } else if (coveragePct < MIN_COVERAGE_PCT) {
    percentileWithheldReason =
      `Only ${coveragePct}% of the panel's ${panel.variants.length} variants were ` +
      `genotyped (minimum ${MIN_COVERAGE_PCT}%). A score over a partial panel is ` +
      'driven by which variants happen to be missing.';
  } else if (!referenceDistribution) {
    percentileWithheldReason =
      'No reference distribution is installed for this panel, so the raw score ' +
      'cannot be ranked against a population.';
  } else {
    const z = (rawScore - referenceDistribution.mean) / referenceDistribution.sd;
    percentile = Math.round(normalCdf(z) * 100);
  }

  if (panel.provenance === 'synthetic') {
    warnings.push(
      'This panel uses synthetic weights and is for testing only. The resulting ' +
      'score has no clinical meaning whatsoever.'
    );
  }

  return {
    panelId: panel.id,
    condition: panel.condition,
    provenance: panel.provenance,
    rawScore,
    matchedVariants: matched,
    panelSize: panel.variants.length,
    coveragePct,
    percentile,
    percentileWithheldReason,
    warnings,
  };
}

/** Abramowitz & Stegun 7.1.26 approximation to the standard normal CDF. */
function normalCdf(z: number): number {
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t +
      0.254829592) *
      t *
      Math.exp(-x * x);
  return 0.5 * (1 + sign * y);
}
