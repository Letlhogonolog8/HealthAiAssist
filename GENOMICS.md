# Genomics layer

Genotype ingestion, polygenic risk scoring, high-penetrance variant screening,
and fusion with the imaging models — under consent, with every access logged.

The organising principle is the same one applied to the imaging models: **the
system reports what it can actually support, and says so plainly when it cannot.**
A genomic risk score is unusually easy to fake convincingly, because the output
is a plausible-looking number either way. Most of the design below exists to make
that impossible rather than merely discouraged.

```
POST /api/genomics/consent              grant or revoke a scope
GET  /api/genomics/consent/:patientId   current consent state
GET  /api/genomics/consent/options      scopes and the text shown to the patient

POST /api/genomics/profile/upload       23andMe / AncestryDNA / VCF
GET  /api/genomics/profile/:patientId   uploaded profiles
DEL  /api/genomics/profile/:patientId   delete genotype data

POST /api/genomics/risk/:patientId      compute a fused risk band
GET  /api/genomics/risk/:patientId      past assessments

GET  /api/genomics/access-log/:patientId  who read this patient's genomic data
GET  /api/genomics/panels                 installed panels and their provenance
GET  /api/genomics/transferability        the equity table (public)
GET  /api/genomics/equity-report          known gaps (medical staff)
```

## The ancestry problem, and what this does about it

Roughly 80–90% of GWAS participants are of European ancestry. A polygenic score
built in that population does not transfer intact to another: linkage
disequilibrium patterns differ, allele frequencies differ, and effect sizes were
estimated in a different genetic background.

The damaging part is not that the score becomes obviously noisy. It is that it
keeps producing a confident-looking percentile that means much less than it
appears to. Martin et al. (*Nature Genetics* 2019, 51:584-591) found
European-derived scores lose substantial accuracy in non-European populations,
with African-ancestry individuals worst affected.

[`server/genomics/ancestry.ts`](server/genomics/ancestry.ts) encodes this as a
transferability factor per group, and the factor does three things:

1. **Widens the reported interval.** At full transferability the band is ±10
   percentile points; at 0.25 it is ±40. The visible width communicates "we do
   not know" better than a disclaimer beside a precise number.
2. **Withholds the percentile entirely** where the reference distribution does
   not describe the patient's population. A percentile against a European
   reference is not a percentile for someone of African ancestry.
3. **Excludes the polygenic component from the fused band** rather than
   down-weighting it. Weighting an uninterpretable number by 0.25 still lets it
   move the answer.

**Unknown ancestry is never treated as European.** It resolves to its own group
with percentiles withheld. Defaulting to European is precisely the assumption
that produces confident, wrong answers for most of the world.

The factors are coarse literature-derived approximations for *communicating
uncertainty*. They vary by trait and by score, they are not calibration
coefficients, and they only ever reduce confidence — never rescale a score upward.

## Panels are not authored here

Effect sizes and pathogenicity classifications come from published sources, never
from this repository. See [the panel README](server/genomics/panels/README.md).

**Installed:** `melanoma.txt` is PGS Catalog **PGS000339** — 22 variants,
GRCh37/hg19, Law MH et al., *Hum Mol Genet* 2020 (PMID 32716505). Its GWAS,
development and evaluation cohorts are **100% European**, which is the
transferability problem stated by the score's own metadata.

Its reference distribution is derived analytically from the allele frequencies in
the scoring file (`mean = sum(2*p*w)`, `var = sum(2*p*(1-p)*w^2)`), verified
against a 200,000-draw Monte Carlo simulation to four decimal places. The
assumptions — Hardy-Weinberg, approximate independence, normality — are recorded
in the generated file.

**Still synthetic:** the actionable variant panel. Its classifications are not
verified against ClinVar, so every risk response still carries
`clinicalUseAllowed: false`.

- **Polygenic scores** load from [PGS Catalog](https://www.pgscatalog.org/)
  scoring files, which are versioned and citable.
- **Actionable variants** load from a ClinVar-derived table the operator installs.
  Pathogenicity classifications get revised; the loader records which release was
  used.

A panel not sourced that way is marked `synthetic`, and the flag propagates all
the way out: `clinicalUseAllowed: false` on the risk response, and a caveat at
the top of the list. That is currently what the actionable panel does — replace
it with a ClinVar-derived table, or delete it so the engine reports "not
screened" instead of screening against invented data.

Inventing weights would have produced a working demo indistinguishable from a
real one. That is exactly the failure this codebase already had with fabricated
model accuracy, and it is harder to detect here.

## Things that are deliberately refused

| Situation | Behaviour |
|---|---|
| Genome build mismatch | No percentile. Coordinates differ between builds, so a GRCh38 panel against GRCh37 genotypes would produce a confident wrong answer. |
| Panel coverage below 80% | No percentile. A partial-panel score is driven by which variants happen to be missing. |
| No reference distribution installed | No percentile. A raw weighted sum has no meaning unranked. |
| Ancestry unknown or non-transferable | No percentile; polygenic component excluded from the band. |
| Genotype is a no-call (`--`) | Excluded from the score, not counted as zero copies. Counting it as zero biases every score downward. |
| No actionable panel installed | Reports "not screened" — never a clean result. |
| Panel position not in the genotype file | Counted as **unknown**, reported separately from "assayed, negative". |
| Any synthetic input | `clinicalUseAllowed: false`. |
| Nothing informative available | Band is `indeterminate`, explicitly *not* `low`. |

## Fusion rules

[`server/genomics/fusion.ts`](server/genomics/fusion.ts) emits a **triage band**,
not a probability. There is no validated model for fusing a lesion classifier, a
PRS of uncertain transferability, and self-reported clinical factors — anything
emitting a calibrated probability from those inputs would be inventing one. So
the rules are transparent and a clinician can disagree with them:

- **Imaging dominates.** It observed the actual lesion; a PRS describes a population.
- **The polygenic score can raise a band, never lower one.** A reassuring PRS must
  not talk anyone out of a suspicious mole. This is enforced and tested.
- **A pathogenic variant raises the band to high on its own.**
- **Every missing input is named** in `missingInputs`.
- **Every result requires clinician review.** There is no path that sets this false.

## Consent and audit

Three revocable scopes: `clinical_care`, `research`, `secondary_sharing`.
Consent rows are append-only, so history is reconstructable, and consent is
checked **at each access** rather than at upload — revocation takes effect
immediately on data already stored.

Every access is written to `genomic_access_log`, **including denials**. A denial
that leaves no trace is indistinguishable from an access that never happened.

Patients can read their own access log. Deleting genomic data removes the
genotypes but **retains the access log** — who read your genome while it existed
is the thing you most need to be able to check afterwards.

Only variants an installed panel actually uses are persisted. A consumer array
carries ~600k calls; storing all of them multiplies the blast radius of a breach
for data nothing will ever read.

## Running it

```bash
npm run db:migrate-genomics   # additive, idempotent
npm run test:genomics         # 41 unit tests, no database needed
npm run smoke:genomics -- http://localhost:5000   # 27 end-to-end checks

# Demonstrates the ancestry gate: identical genotypes, three ancestries
npx tsx scripts/check-ancestry-gating.ts http://localhost:5000
```

With the real panel installed, that last script produces:

| Self-reported ancestry | Transferability | Percentile |
|---|---|---|
| European | 1.0 | 100th, interval 90–100 |
| Black South African | 0.25 | **withheld** |
| (not stated) | 0.4 | **withheld** |

Same genotypes, same raw score, 100% panel coverage in all three cases.

**Schema note:** the risk table is `genomic_risk_assessments`, not
`risk_assessments`. The target database already contains an unrelated
`risk_assessments` table belonging to a different application. Do not rename it
back.

**Port note:** the smoke test uses `fetch`, which enforces the WHATWG blocked-port
list. Ports like 5060 are unreachable and fail with an unhelpful "bad port".

## Known gaps

- Ancestry is self-reported and never inferred from the genotype data. Inferring
  it is a separate, consequential claim that would need its own validation.
- Transferability groups are coarse buckets; real ancestry is continuous and
  admixture is common.
- The melanoma reference distribution is an analytic approximation, not an
  empirically scored cohort. Scoring 1000 Genomes would be more accurate.
- The installed score is 22 variants, which is a modest predictor. Larger scores
  exist but fall below the coverage floor on consumer arrays.
- No imputation. Only directly genotyped positions are scored, so consumer arrays
  will fall below the coverage floor for large panels.
