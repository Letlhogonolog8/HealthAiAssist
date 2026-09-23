# P2 → detector development: readiness report

23 September 2026. Branch `fix/remove-fabricated-ai-results`, from HEAD
`399e296`.

> **The one sentence that matters.** Everything reported here is engineering
> readiness. **No detector exists, none was trained, and not a single
> performance figure was produced.** Nothing below is evidence about how well
> anything detects nodules, and nothing below is clinical validation.

---

## 1. What this stage did and did not do

Built: patient-disjoint splitting with an independent leakage audit, an
availability inventory of what is actually on disk, the FROC evaluation
arithmetic with its refusals, and an erasure path that finally reaches the
imaging and detection tables. Measured: the collection, the hardware, and the
interval width the local test set can support.

Not built: a detector, a training run, an OOD reference, a calibration, a
candidate review UI, or a characteriser handoff. Not decided: the localisation
tolerance, the performance bar, and whether LUNA16 is ever used. Each of those
is recorded as PENDING with what a decision would need, not chosen on the
owner's behalf.

---

## 2. Dataset, re-derived rather than quoted

Every figure below was recomputed in this stage rather than copied from an
earlier report, and each reproduced its prior value exactly.

| | |
|---|---|
| Label table | `dataset/lidc-labels.csv`, 1703 nodules |
| Patients | 740 |
| Series named | 748 |
| Class split | 553 malignant / 1150 benign |
| Readers per nodule | 1: 439, 2: 386, 3: 230, 4: 643, **5: 5** |
| Median-3 indeterminate | 0 — correctly excluded, not forced to a side |
| Diameters measured | 995 nodules across 207 series |
| Not covered by a contour | 975 |
| Identity divergence | 0 |
| Measured but median-3 unlabelled | 267 |
| Unmeasurable / non-positive | 0 / 0 |

**Five** nodules carry five readers, which LIDC's four-reader protocol should
not produce. Their ratings are `4|3|5|5|4`, `4|4|4|3|2`, `1|1|1|1|1`,
`5|5|5|5|5` and `3|2|4|4|5` — two of the five would be unaffected by dropping
a duplicate and three might move. The cause is the 12 mm single-link
clustering in `scripts/lidc_build_labels.py` merging two annotations from one
reader. It is pre-existing, was not introduced by P2, and is recorded here
rather than quietly corrected: 5 nodules in 1703 is small, but the fix belongs
in the label pipeline under change control, not in a readiness report.

**Provenance, restated because it governs every claim downstream.** LIDC
labels are radiologist malignancy *impressions* and hand-drawn boundaries.
They are not histopathology, they are not clinical diagnoses, and a "reference
nodule" means only that a radiologist marked something at that location.

---

## 3. Splits and leakage control

`scripts/lidc_build_splits.py`. The unit is the **patient**, because a patient
has several series, a series has many slices and a slice can carry several
nodules — split on any of those and the same chest appears on both sides of
the line, and the resulting figure measures memorisation.

Assignment is `HMAC-SHA256(seed, source LIDC patient id) → [0,1)` against
cumulative bounds, not a seeded shuffle. Adding a patient moves that patient
and nobody else, which is what lets two training runs be compared. The
identity is the **source** LIDC patient id, never the salted production UID —
using the latter would make the split depend on a deployment secret and be
irreproducible for anyone else. A test parses the module's imports with `ast`
to prove `uid_remap` is not a dependency.

| Split | Patients | Series | Nodules | Malignant | Benign |
|---|---|---|---|---|---|
| train | 474 | 482 | 1083 | 329 | 754 |
| validation | 93 | 93 | 208 | 63 | 145 |
| calibration | 71 | 71 | 168 | 69 | 99 |
| test | 102 | 102 | 244 | 92 | 152 |

Seed `healthai-lidc-split-v1`, fingerprint `f55f6cd5188ae3ee`. Manifest
committed at `docs/splits/lidc-split-v1.json` — tracked, not under the
gitignored `dataset/`, because `scripts/materialise-lung-test-split.py` exists
precisely because an earlier split was recorded where git could not see it.

**Leakage audit: clean.** `audit_splits` re-derives the overlaps independently
of `build` and refuses to write a manifest that fails. No patient, series or
nodule appears in more than one split; no series is shared by two patients; no
patient is unassigned. A test deliberately breaks an assignment and asserts the
audit catches it, so the audit is not decorative.

**Four splits, not three.** Calibration is separate from validation, because
fitting a temperature on the set that chose the operating point measures the
fit rather than the model, and separate from test, which stays untouched.

**Not stratified, deliberately.** Malignant share runs 30.3% (validation) to
41.1% (calibration). Balancing labels would destroy the stability property
above. Evaluation must account for it rather than assume matched prevalence.

---

## 4. Localisation methodology — PENDING, not chosen

`docs/P2_LOCALIZATION_METHODOLOGY.md`.

Sensitivity, false positives per scan and FROC all depend on a rule that says
whether a proposed candidate *is* a given annotated nodule. No such rule has
been approved, and this stage did not choose one.

The record sets out four candidate families (fixed radius; nodule radius from
a measured diameter; radius with a floor; slice-aware anisotropic), the eight
dimensions a decision must settle (distance basis, reader aggregation, floor
and ceiling, one-to-one matching, ambiguous assignment, reader-agreement
threshold, size inclusion, exclusions), the evidence available for each, and
the evidence that is **not** available — no consensus segmentation, no
histopathology, no local inter-reader localisation study.

The decision block is empty and stays that way until an owner fills it.

---

## 5. Evaluation machinery — built, never run on a detector

`inference/detection_eval.py`, with `inference/tests/test_detection_eval.py`.

Implemented: greedy nearest-first one-to-one matching, per-nodule sensitivity
with Wilson 95% intervals, false positives per scan, the FROC sweep, operating
point selection, and stratification by any scan-level attribute.

Three refusals are built into it rather than documented beside it:

1. **No rule, no number.** `MatchRule` has no default basis, no default
   tolerance and no default duplicate policy, and `match_scan` and `froc`
   reject anything that is not a `MatchRule`. `rule_from_bar` raises
   `MethodologyUndecided` while `docs/bars/p2.json` says the tolerance is
   `BLOCKED` — which it does, today, and a test asserts it still does.
2. **Refusal is not a negative.** A scan that was refused by the OOD screen,
   refused by the quality gate, failed, or never run **was not searched**. Its
   nodules are excluded from both denominators and reported separately. The
   four states are kept distinct so an operator can tell an OOD refusal from a
   crash. An unrecognised outcome raises rather than defaulting to
   `evaluated`.
3. **No interpolation.** Every point on the curve is a threshold a candidate
   actually carried, and an unreachable false-positive budget returns nothing
   rather than a value read off a line.

A collection where nothing was searched reports no sensitivity at all — not
0.0, not 1.0. `wilson(0, 0)` returns `None`, because nothing was measured,
which is not the same as measuring none.

`scripts/validate-detector-on-lidc.py` now asks the evaluator itself whether a
rule exists rather than re-reading the bar separately, so the script and the
evaluation agree by construction. It reports **BLOCKED** on two independent
counts and exits non-zero.

---

## 6. Performance bar — proposed, not approved

`docs/bars/p2.json` remains `"status": "DRAFT_NOT_APPROVED"` with
`proposedGate.approval.approved: false`, `approvedBy: null`,
`approvedOn: null`, `justification: null`.

The 0.85 sensitivity at ≤4 FP/scan figure originates as an *example* in the
roadmap. It is not an established threshold, not regulatorily derived and not
benchmark-justified, and the file says so in three separate fields. This stage
did not approve it, and §7 gives a concrete reason it may not be the right
shape of bar for this data at all.

---

## 7. Training feasibility — measured

`docs/P2_TRAINING_FEASIBILITY.md`.

**Compute.** torch 2.1.0+cpu, `torch.cuda.is_available()` **False**, 0 CUDA
devices, Intel Iris Xe integrated graphics, 8 logical cores, 7.8 GB RAM. A
69,953-parameter toy 3D backbone managed **2.3 patches per second** on 96³
patches — about 39 hours for a modest schedule, for a model roughly 400× too
small. A real 3D detector is two to three orders of magnitude more work.
Training is not slow here; it is unavailable.

**Data.** The split assigns all 748 series. Only **229 have pixel data on this
machine** (37,970 objects, all CT, all named in the label table, no orphans in
either direction):

| Split | Series assigned → available | Nodules assigned → available |
|---|---|---|
| train | 482 → **149** | 1083 → **518** |
| validation | 93 → **27** | 208 → **90** |
| calibration | 71 → **21** | 168 → **88** |
| test | 102 → **32** | 244 → **126** |

Recorded in `docs/splits/lidc-availability.json`, carrying the split
fingerprint so an availability report can never be read against a different
split than the one it was computed for.

**The consequence for the bar.** Interval width is a property of sample size
and is knowable now. On 126 test nodules, an observed sensitivity of 0.849
carries a 95% interval of 0.776–0.901, and even an observed 0.897 carries
0.832–0.939. **The available test split cannot demonstrate that a 0.85 bar was
met.** It could rule it out; it could not distinguish 0.85 from considerably
worse. (Those are the intervals a hypothetical count would carry. No detector
exists and none of those numbers is a result.)

That is an argument for acquiring the rest of the collection, or for stating
the bar in terms this data supports, or for saying plainly that a local figure
is an internal check. It is not an argument for quoting a point estimate
without its interval.

---

## 8. Detector, OOD and calibration — status unchanged

| | |
|---|---|
| Detector checkpoint | **None.** `registered_detector()` returns `None`; a run refuses with `model_unavailable` rather than returning an empty candidate list |
| `lung-nodule-detection` capability | **PLANNED** |
| Detector OOD reference | **NOT YET BUILT** — the characteriser's is fitted on 224×224 RGB patch features and cannot be reused for volumes |
| Detector calibration | **NOT YET PERFORMED**; `score_calibrated` stays null |
| LUNA16 | **NOT CURRENTLY IN REPOSITORY**; `REQUIRES PROJECT DECISION` |
| Python ≥3.10 environment | Specified, **not instantiated** |

The empty-list/refusal distinction is the load-bearing one: an empty candidate
list means the volume was searched and nothing scored above threshold; a
refusal means no search happened. `candidateCount` is NULL rather than 0 on
every path that did not search.

---

## 9. Characteriser handoff and candidate UI — deliberately not built

Both were in scope and both were declined, with reasons.

**Handoff (accepted candidate → `lung_nodule` characteriser).** The API side
already exists from the previous stage: candidates persist, and
`PATCH /api/candidates/:id/review` records `accepted | rejected | uncertain |
missed_candidate_added` with audit. What does not exist is any candidate to
hand over, because there is no detector. Wiring the handoff now would produce
a path that cannot be exercised, cannot be tested end to end, and whose first
real execution would be in front of a patient.

**Candidate review UI.** `CLAUDE.md` is explicit: do not create UI elements for
functionality that does not exist. A review interface for a detector that
cannot be trained on this hardware is a demo feature, and the project's stated
preference is real functionality over demo features.

Both become available work the moment a detector exists and the localisation
rule is settled. Neither is blocked by anything in this repository.

---

## 10. Privacy

**DPIA R-23 — closed.** `server/erasure.ts` previously contained no reference
to `imaging_studies`, `imaging_series`, `imaging_instances`, `detection_runs`
or `detection_candidates`. A data subject could have been told their request
was executed while their CT series, its stored objects and every candidate
coordinate derived from their anatomy stayed where they were.

Two defects, not one:

- **The missing deletion.** Now a category of its own, `CT imaging series and
  detection candidates`, erasing children before parents and removing the
  stored objects *before* their rows — a row deleted first leaves pixel data
  on disk with nothing pointing at it.
- **The hold was computed from `medical_scans` alone.** A patient with a CT
  series and no scan row therefore had **no clinical hold at all**, and their
  imaging would have been erased on request; a patient with an old scan and a
  recent series would have had the hold dated from the scan. "Last entry"
  under the National Health Act means the last entry in the record, so the
  hold is now the later of the two.

**Residual, stated rather than closed.** The Cloud Storage delete permission
is a different IAM grant from the write permission the upload path uses, so a
deployment can be able to store objects and unable to remove them.
`deleteScanObject` reports that failure instead of swallowing it, and the
erasure then reports the imaging category as `retained` naming the count of
objects that could not be removed, rather than showing a completed erasure.
That state needs an administrator.

**Care relationship — unchanged, still shadow mode.** `CARE_RELATIONSHIP_ENFORCE`
is unset, so the check records without blocking, and the detection endpoints
inherit that. DPIA R-02 stays open. Not changed here: flipping it globally is
a deployment decision affecting every clinical route, not a side effect of a
detector-readiness stage.

**Unchanged and verified:** authentication, patient isolation, audit logging,
de-identification, refusal behaviour. No safety mechanism outside the scope
above was modified.

---

## 11. Safety invariants re-verified

| | |
|---|---|
| Legacy web-PNG lung model | Still `enabled: false`, withdrawn, `INTERNAL_VALIDATION`, no intended use. Nothing in the detection path routes to it |
| Vocabulary | Candidates carry `score_raw` / `score_calibrated`; there is no field a malignancy could be written into |
| Malignancy terminology | Not used for candidate proposals anywhere in this stage |
| LIDC labels | Described as radiologist impressions, never as clinical diagnoses or histopathology |
| Fabricated artefacts | None. No weights, no metrics, no FROC, no sensitivity, no specificity, no calibration, no OOD result, no benchmark |
| LUNA16 | Not downloaded, not integrated, not referenced as an asset |
| Shared Supabase | Not touched. Tests ran against a disposable `postgres:16-alpine` on port **5434** |
| AEGIS containers | Not touched — they hold 5433 and 6379 and were left running throughout |
| Remote | Nothing pushed |

---

## 12. Tests

**Python — 354 passed, 0 failed** (`python -m pytest inference/tests -q`, 91 s).
Baseline was 286; the 68 new tests are 15 for the split builder, 43 for the
evaluator and 10 for the availability index.

**TypeScript — 324 tests across 83 suites: 321 passed, 0 failed, 0 cancelled,
3 skipped.** Baseline was 318 / 315 / 0 / 0 / 3, so this is exactly the
baseline plus the six new tests in `tests/erasure-imaging.test.ts`. `tsc
--noEmit` and `npm run build` both exit 0.

**Two earlier runs are worth recording, because neither was clean and neither
was a code problem.**

- The first reported 29 *cancelled*. Cause: I ran the Python suite
  concurrently on an 8-core machine and starved the server's before-hooks. A
  second run with nothing else competing gave 0 cancelled. Nothing in the code
  changed between them.
- Both of those runs reported **34 skipped**, against a baseline of 3. Every
  one said `SKIP INFERENCE_URL is not set` — the resident FastAPI service was
  not running, so the DICOM ingest, detection-run and refusal suites skipped
  themselves rather than failing. Starting `uvicorn inference.server:app` and
  setting `INFERENCE_URL` brought the count back to 3.

The second point is the one that matters operationally: **a suite that skips
itself when a dependency is absent still reports a green run.** 31 tests
covering de-identification, series ingest, detection refusal and patient
isolation were not executed, and the summary line said `fail 0` throughout.
The figures quoted above are from the run where they did execute.

Ran against a disposable `postgres:16-alpine` on port **5434**, built from
scratch for this stage. The shared Supabase database was not used; the AEGIS
containers on 5433 and 6379 were left alone.

---

## Reproduce

```bash
python scripts/lidc_build_splits.py --audit-only
python scripts/lidc_series_availability.py --check
python scripts/validate-detector-on-lidc.py --check   # exits 1, BLOCKED
python -m pytest inference/tests -q
npx tsc --noEmit
TEST_DATABASE_URL=<disposable> HEALTHAI_TEST_HARNESS=true npm test
```
