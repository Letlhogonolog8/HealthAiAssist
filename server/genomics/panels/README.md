# Scoring panels

This directory holds the genomic reference data the risk engine reads. **None of
it is authored in this repository**, and that is deliberate.

Effect sizes and pathogenicity classifications are curated scientific artifacts.
A number invented here would be indistinguishable, in the output, from one taken
from a published GWAS — the reader has no way to tell. This codebase already had
that failure once, with model accuracy figures that were never measured. The rule
now is: if the engine reports a number, that number traces to a citable source or
it is flagged synthetic.

## Polygenic scores — PGS Catalog

Download a scoring file from <https://www.pgscatalog.org/> and drop it in here as
`<condition>.txt`. The condition is taken from the filename prefix.

```bash
# Example: a melanoma score
curl -L -o melanoma.txt.gz \
  'https://ftp.ebi.ac.uk/pub/databases/spot/pgs/scores/PGS000356/ScoringFiles/PGS000356.txt.gz'
gunzip melanoma.txt.gz
mv melanoma.txt server/genomics/panels/
```

The loader reads the `#`-prefixed metadata header (`pgs_id`, `genome_build`,
`citation`) and a tab-separated table with at least `rsID` (or `hm_rsID`),
`effect_allele` and `effect_weight`.

**Check the genome build.** A GRCh38 scoring file against a GRCh37 genotype file
produces a number, silently, and it is wrong.

### Reference distributions

A raw PRS is a weighted sum with no inherent meaning — it only becomes
interpretable ranked against a population. The engine reports **no percentile**
unless a reference distribution is supplied, and it will not invent one.

Supply one per panel as `<condition>.reference.json`:

```json
{
  "mean": 0.0,
  "sd": 1.0,
  "population": "UK Biobank European-ancestry, n=..., PGS Catalog PGS000356",
  "source": "https://..."
}
```

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
as clinical output. `melanoma.synthetic.json` and the actionable example shipped
here are exactly that — the weights are made up.

**Delete the synthetic panels before any real deployment.** They exist so the
pipeline can be exercised end to end without shipping unverifiable science.
