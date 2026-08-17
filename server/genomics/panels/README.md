# Scoring panels

This directory holds the genomic reference data the risk engine reads. **None of
it is authored in this repository**, and that is deliberate.

Effect sizes and pathogenicity classifications are curated scientific artifacts.
A number invented here would be indistinguishable, in the output, from one taken
from a published GWAS — the reader has no way to tell. This codebase already had
that failure once, with model accuracy figures that were never measured. The rule
now is: if the engine reports a number, that number traces to a citable source or
it is flagged synthetic.

## Installed: melanoma (PGS000339)

`melanoma.txt` is a real PGS Catalog scoring file — **PGS000339**, 22 variants,
GRCh37/hg19, from Law MH et al., *Hum Mol Genet* 2020 (PMID 32716505,
`doi:10.1093/hmg/ddaa156`), method: clumping and thresholding.

Its GWAS, development and evaluation cohorts are **100% European** according to
the PGS Catalog metadata. That is not incidental — it is the concrete instance of
the transferability problem, and the reason the engine withholds a percentile for
anyone whose recorded ancestry the reference population does not describe.

## Adding another polygenic score

Download from <https://www.pgscatalog.org/> and drop it in as `<condition>.txt`;
the condition comes from the filename prefix.

```bash
curl -sL -o /tmp/score.txt.gz \
  'https://ftp.ebi.ac.uk/pub/databases/spot/pgs/scores/PGS000339/ScoringFiles/PGS000339.txt.gz'
gunzip -c /tmp/score.txt.gz > server/genomics/panels/<condition>.txt
```

Prefer a score with few variants. A 22-variant panel is well covered by consumer
genotyping arrays; a genome-wide score of millions of variants will fall below the
80% coverage floor and yield no percentile at all.

The loader reads the `#`-prefixed metadata header (`pgs_id`, `genome_build`,
`citation`) and a tab-separated table with at least `rsID` (or `hm_rsID`),
`effect_allele` and `effect_weight`.

**Check the genome build.** A GRCh38 scoring file against a GRCh37 genotype file
produces a number, silently, and it is wrong — the engine refuses that pairing.
`hg19`/`GRCh37` and `hg38`/`GRCh38` are aliases and are treated as equal.

### Reference distributions

A raw PRS is a weighted sum with no inherent meaning — it only becomes
interpretable ranked against a population. The engine reports **no percentile**
unless a reference distribution is supplied, and it will not invent one.

Generate one from the allele frequencies in the scoring file:

```bash
PGS_DISCOVERY_ANCESTRY="100% European"   npx tsx scripts/build-reference-distribution.ts melanoma
```

That derives mean and standard deviation analytically:
`mean = sum(2*p*w)`, `var = sum(2*p*(1-p)*w^2)`, assuming Hardy-Weinberg and
approximate independence between variants. For the installed melanoma panel this
was checked against a 200,000-draw Monte Carlo simulation and agreed to four
decimal places. The assumptions are recorded in the generated file.

Scoring a real reference cohort (1000 Genomes and similar) is more accurate and
much heavier. Either way, the `population` field must name whose distribution it
is — a percentile against an unnamed population cannot be interpreted.

The population this distribution came from matters as much as the numbers. A
percentile against a European reference is not a percentile for everyone — see
[`../ancestry.ts`](../ancestry.ts), which withholds percentiles where the
reference does not apply.

## Actionable variants — ClinVar

Install as `actionable-variants.json`:

```json
{
  "source": "ClinVar",
  "version": "2026-07 release",
  "synthetic": false,
  "variants": [
    {
      "rsid": "rs80357906",
      "gene": "BRCA1",
      "riskAllele": "A",
      "classification": "pathogenic",
      "condition": "Hereditary breast and ovarian cancer",
      "clinvarId": "17662",
      "inheritance": "autosomal dominant"
    }
  ]
}
```

Derive this from a ClinVar release rather than by hand. Classifications are
reclassified over time; record which release you used, because a result issued
last year may not match today's classification.

## Synthetic panels

Files with `"provenance": "synthetic"` (scores) or `"synthetic": true`
(actionable variants) are for tests and demos. Every result computed from them
carries the flag through the API, and the risk endpoints refuse to present them
as clinical output.

**`actionable-variants.json` is still synthetic.** The polygenic side now uses a
real score, but the high-penetrance variant panel does not: its classifications
are not verified against ClinVar. Because of that, every risk response still
returns `clinicalUseAllowed: false`. Replace it with a ClinVar-derived table — or
delete it, in which case the engine honestly reports "not screened" rather than
screening against invented data.
