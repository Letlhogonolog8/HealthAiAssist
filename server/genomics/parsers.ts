/**
 * Genotype file parsers.
 *
 * Two formats are supported because they are what people actually have:
 *  - Consumer raw exports (23andMe / AncestryDNA): a TSV of rsid, chrom, pos,
 *    genotype. Obtainable by anyone who has taken a consumer test.
 *  - VCF 4.x: what a sequencing lab returns.
 *
 * Both normalise to the same shape. Parsing is strict about things that would
 * silently corrupt a score — unknown build, malformed genotypes — and lenient
 * about things that would not.
 */

export interface ParsedGenotype {
  rsid: string;
  chromosome: string;
  position: number;
  /** Diploid call, alleles sorted, uppercase. "--" when no call. */
  genotype: string;
}

export interface ParseResult {
  source: '23andme' | 'ancestrydna' | 'vcf';
  genomeBuild: string | null;
  genotypes: ParsedGenotype[];
  /** Lines that could not be parsed, capped — for reporting, not for guessing. */
  skipped: number;
  warnings: string[];
}

export class GenotypeParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GenotypeParseError';
  }
}

const VALID_ALLELES = new Set(['A', 'C', 'G', 'T', 'I', 'D', '-', '0', '.']);
const MAX_VARIANTS = 2_000_000; // consumer arrays are ~600k-1.5M rows

/** Sort alleles so "GA" and "AG" compare equal. No-calls normalise to "--". */
function normaliseGenotype(raw: string): string {
  const cleaned = (raw || '').trim().toUpperCase();
  if (!cleaned || cleaned === '--' || cleaned === '00' || cleaned === '.') return '--';

  const alleles = cleaned.split('');
  if (!alleles.every((a) => VALID_ALLELES.has(a))) return '--';
  if (alleles.some((a) => a === '-' || a === '0' || a === '.')) return '--';

  return alleles.sort().join('');
}

function detectBuild(headerLines: string[]): string | null {
  const header = headerLines.join('\n');
  // 23andMe headers name the build directly; VCF uses ##reference or ##contig.
  if (/build\s*38|GRCh38|hg38/i.test(header)) return 'GRCh38';
  if (/build\s*37|GRCh37|hg19/i.test(header)) return 'GRCh37';
  if (/build\s*36|NCBI36|hg18/i.test(header)) return 'NCBI36';
  return null;
}

/**
 * Parses a 23andMe / AncestryDNA raw export.
 *
 * Format: comment lines beginning `#`, then tab-separated
 * `rsid  chromosome  position  genotype`. AncestryDNA splits the genotype across
 * two allele columns, which is handled.
 */
export function parseConsumerRawFile(content: string): ParseResult {
  const lines = content.split(/\r?\n/);
  const headerLines: string[] = [];
  const genotypes: ParsedGenotype[] = [];
  const warnings: string[] = [];
  const seen = new Set<string>();
  let skipped = 0;
  let source: '23andme' | 'ancestrydna' = '23andme';

  for (const line of lines) {
    if (!line) continue;

    if (line.startsWith('#')) {
      headerLines.push(line);
      if (/ancestry/i.test(line)) source = 'ancestrydna';
      continue;
    }

    const cols = line.split('\t');
    // Header row in AncestryDNA exports
    if (cols[0]?.toLowerCase() === 'rsid') {
      if (cols.length >= 5) source = 'ancestrydna';
      continue;
    }

    if (cols.length < 4) {
      skipped++;
      continue;
    }

    const [rsid, chromosome, positionRaw] = cols;
    // AncestryDNA: allele1 and allele2 in separate columns
    const genotypeRaw = cols.length >= 5 ? `${cols[3]}${cols[4]}` : cols[3];
    const position = Number.parseInt(positionRaw, 10);

    if (!rsid || Number.isNaN(position)) {
      skipped++;
      continue;
    }

    // Duplicate rsids occur in these files; first call wins, rather than
    // silently overwriting with a later contradictory one.
    if (seen.has(rsid)) {
      skipped++;
      continue;
    }
    seen.add(rsid);

    genotypes.push({
      rsid: rsid.trim(),
      chromosome: chromosome.trim(),
      position,
      genotype: normaliseGenotype(genotypeRaw),
    });

    if (genotypes.length > MAX_VARIANTS) {
      throw new GenotypeParseError(
        `File exceeds ${MAX_VARIANTS} variants; refusing to parse further.`
      );
    }
  }

  if (genotypes.length === 0) {
    throw new GenotypeParseError(
      'No genotype rows found. Expected a tab-separated raw export with ' +
      'rsid, chromosome, position and genotype columns.'
    );
  }

  const genomeBuild = detectBuild(headerLines);
  if (!genomeBuild) {
    warnings.push(
      'Reference build not declared in the file header. Scores requiring a ' +
      'specific build cannot be computed until the build is confirmed.'
    );
  }

  return { source, genomeBuild, genotypes, skipped, warnings };
}

/**
 * Parses a VCF 4.x file, single sample.
 *
 * Only the first sample column is read; multi-sample VCFs are rejected rather
 * than guessed at, because picking the wrong column silently attributes someone
 * else's genome to this patient.
 */
export function parseVcf(content: string): ParseResult {
  const lines = content.split(/\r?\n/);
  const headerLines: string[] = [];
  const genotypes: ParsedGenotype[] = [];
  const warnings: string[] = [];
  let skipped = 0;
  let sawColumnHeader = false;

  for (const line of lines) {
    if (!line) continue;

    if (line.startsWith('##')) {
      headerLines.push(line);
      continue;
    }

    if (line.startsWith('#CHROM')) {
      sawColumnHeader = true;
      const cols = line.split('\t');
      const sampleCount = cols.length - 9;
      if (sampleCount > 1) {
        throw new GenotypeParseError(
          `VCF contains ${sampleCount} samples. Only single-sample VCFs are accepted — ` +
          'attributing the wrong column to a patient is not a recoverable error.'
        );
      }
      if (sampleCount < 1) {
        throw new GenotypeParseError('VCF has no sample column; nothing to genotype.');
      }
      continue;
    }

    const cols = line.split('\t');
    if (cols.length < 10) {
      skipped++;
      continue;
    }

    const [chrom, posRaw, id, ref, altRaw, , , , format, sample] = cols;
    const position = Number.parseInt(posRaw, 10);
    if (Number.isNaN(position)) {
      skipped++;
      continue;
    }

    // Only variants carrying an rsID are usable against rsID-keyed panels.
    if (!id || id === '.' || !id.startsWith('rs')) {
      skipped++;
      continue;
    }

    const gtIndex = format.split(':').indexOf('GT');
    if (gtIndex === -1) {
      skipped++;
      continue;
    }

    const gtField = sample.split(':')[gtIndex];
    if (!gtField || gtField.includes('.')) {
      genotypes.push({ rsid: id, chromosome: chrom, position, genotype: '--' });
      continue;
    }

    const alts = altRaw.split(',');
    const alleles = gtField.split(/[/|]/).map((indexRaw) => {
      const index = Number.parseInt(indexRaw, 10);
      if (Number.isNaN(index)) return null;
      if (index === 0) return ref;
      const alt = alts[index - 1];
      return alt ?? null;
    });

    // Indels and multi-base alleles do not fit a two-character diploid call.
    const usable = alleles.every((a) => a !== null && a.length === 1);
    genotypes.push({
      rsid: id,
      chromosome: chrom,
      position,
      genotype: usable ? normaliseGenotype(alleles.join('')) : '--',
    });

    if (genotypes.length > MAX_VARIANTS) {
      throw new GenotypeParseError(
        `File exceeds ${MAX_VARIANTS} variants; refusing to parse further.`
      );
    }
  }

  if (!sawColumnHeader) {
    throw new GenotypeParseError('Not a VCF: no #CHROM header line found.');
  }
  if (genotypes.length === 0) {
    throw new GenotypeParseError('VCF contained no usable rsID-tagged variants.');
  }

  const genomeBuild = detectBuild(headerLines);
  if (!genomeBuild) {
    warnings.push('Reference build not declared in the VCF header (##reference).');
  }

  return { source: 'vcf', genomeBuild, genotypes, skipped, warnings };
}

/** Dispatches on file shape rather than filename, which users get wrong. */
export function parseGenotypeFile(content: string): ParseResult {
  const head = content.slice(0, 4096);
  if (head.startsWith('##fileformat=VCF') || /^#CHROM\t/m.test(head)) {
    return parseVcf(content);
  }
  return parseConsumerRawFile(content);
}
