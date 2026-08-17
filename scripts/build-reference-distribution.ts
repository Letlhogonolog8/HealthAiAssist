/**
 * Derives a reference distribution for a PGS Catalog panel from the effect
 * allele frequencies the scoring file carries.
 *
 *   npx tsx scripts/build-reference-distribution.ts <condition>
 *
 * WHY THIS IS NEEDED
 *
 * A polygenic score is a weighted sum. On its own the number means nothing —
 * "1.42" is only interpretable once you know how it compares to a population.
 * The engine therefore withholds the percentile unless a reference distribution
 * is installed, and refuses to invent one.
 *
 * THE METHOD, AND WHAT IT ASSUMES
 *
 * For a score S = sum_i w_i * X_i where X_i is the count of effect alleles
 * (0, 1 or 2) at variant i with effect allele frequency p_i:
 *
 *   Under Hardy-Weinberg equilibrium, X_i ~ Binomial(2, p_i), so
 *     E[X_i]   = 2 p_i
 *     Var[X_i] = 2 p_i (1 - p_i)
 *
 *   Assuming the variants are independent:
 *     E[S]   = sum_i 2 p_i w_i
 *     Var[S] = sum_i 2 p_i (1 - p_i) w_i^2
 *
 * Both assumptions are approximations:
 *
 *  - Independence holds reasonably for a clumped score (C+T selects variants in
 *    low linkage disequilibrium with each other), and less well otherwise. Where
 *    it fails it understates the variance, which makes extreme percentiles look
 *    more extreme than they are.
 *  - Hardy-Weinberg is a population-genetics idealisation, generally close
 *    enough in large outbred cohorts.
 *  - The score is treated as approximately normal. Reasonable with tens of
 *    variants by the central limit theorem; poor with very few.
 *
 * The alternative — scoring a real reference cohort such as 1000 Genomes — is
 * more accurate and much heavier. This approximation is stated in the output so
 * nobody mistakes it for an empirical distribution.
 *
 * CRITICALLY: the frequencies in a scoring file are those of the discovery
 * population. For most PGS Catalog scores that population is European, so the
 * distribution this produces is a European reference. Ranking someone against it
 * is only meaningful if that population describes them — which is exactly what
 * server/genomics/ancestry.ts gates on.
 */
import fs from 'fs';
import path from 'path';

interface Row { rsid: string; weight: number; freq: number }

function main() {
  const condition = process.argv[2];
  if (!condition) {
    console.error('Usage: npx tsx scripts/build-reference-distribution.ts <condition>');
    process.exit(1);
  }

  const dir = path.join(process.cwd(), 'server', 'genomics', 'panels');
  const scoringFile = path.join(dir, `${condition}.txt`);
  if (!fs.existsSync(scoringFile)) {
    console.error(`No scoring file at ${scoringFile}`);
    process.exit(1);
  }

  const lines = fs.readFileSync(scoringFile, 'utf-8').split(/\r?\n/);
  const meta: Record<string, string> = {};
  let header: string[] | null = null;
  const rows: Row[] = [];
  let missingFreq = 0;

  for (const line of lines) {
    if (!line.trim()) continue;
    if (line.startsWith('#')) {
      const m = line.slice(1).match(/^([a-zA-Z_]+)=(.*)$/);
      if (m) meta[m[1].toLowerCase()] = m[2].trim();
      continue;
    }
    const cols = line.split('\t');
    if (!header) { header = cols.map((c) => c.trim().toLowerCase()); continue; }

    const get = (name: string) => {
      const i = header!.indexOf(name);
      return i === -1 ? undefined : cols[i]?.trim();
    };

    const rsid = get('rsid') || get('hm_rsid');
    const weight = Number.parseFloat(get('effect_weight') ?? '');
    const freq = Number.parseFloat(get('allelefrequency_effect') ?? '');
    if (!rsid || Number.isNaN(weight)) continue;

    if (Number.isNaN(freq) || freq <= 0 || freq >= 1) { missingFreq++; continue; }
    rows.push({ rsid, weight, freq });
  }

  if (!rows.length) {
    console.error(
      'No variants carried a usable allelefrequency_effect column, so a ' +
      'distribution cannot be derived this way. Score a reference cohort instead, ' +
      'or leave the percentile withheld.'
    );
    process.exit(1);
  }

  if (missingFreq) {
    console.error(
      `WARNING: ${missingFreq} variant(s) lacked an allele frequency and were ` +
      'excluded from the distribution. The panel still scores all of them, so ' +
      'the mean and sd below describe a slightly different score than the one ' +
      'computed at runtime.'
    );
  }

  let mean = 0;
  let variance = 0;
  for (const { weight, freq } of rows) {
    mean += 2 * freq * weight;
    variance += 2 * freq * (1 - freq) * weight * weight;
  }
  const sd = Math.sqrt(variance);

  if (!(sd > 0)) {
    console.error('Derived standard deviation is zero; cannot form a distribution.');
    process.exit(1);
  }

  const ancestry = process.env.PGS_DISCOVERY_ANCESTRY || 'unspecified (check the PGS Catalog entry)';
  const output = {
    mean: Number(mean.toFixed(6)),
    sd: Number(sd.toFixed(6)),
    population:
      `Analytic approximation for the ${meta.pgs_id ?? condition} discovery ` +
      `population (${ancestry}), derived from the effect allele frequencies in ` +
      'the scoring file. Not an empirically scored cohort.',
    source: meta.citation ?? null,
    method: {
      formula: 'mean = sum(2*p*w); var = sum(2*p*(1-p)*w^2)',
      assumptions: [
        'Hardy-Weinberg equilibrium at each variant',
        'Variants independent (approximately true for a clumped score)',
        'Score approximately normally distributed',
      ],
      variantsUsed: rows.length,
      variantsWithoutFrequency: missingFreq,
      generatedAt: new Date().toISOString(),
    },
  };

  const outPath = path.join(dir, `${condition}.reference.json`);
  fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`);

  console.log(`Wrote ${outPath}`);
  console.log(`  variants used : ${rows.length}`);
  console.log(`  mean          : ${output.mean}`);
  console.log(`  sd            : ${output.sd}`);
  console.log(`  population    : ${ancestry}`);
}

main();
