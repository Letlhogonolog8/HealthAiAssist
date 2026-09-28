# P2 detector — training gate decision register

25 September 2026. Branch `fix/remove-fabricated-ai-results`, prepared on
HEAD `bdfe30b`.

> **Training authorisation: NO — BLOCKED.** Engineering has no known FAIL.
> Nine methodology decisions are **PENDING**, and the GPU environment is
> **BLOCKED**. Nothing in this register is a decision. Every "Decision
> required" line is a question for the owner, not an answer.

This is the one sheet the decision owner needs. Each section summarises the
evidence and names the question; the linked documents hold the detail. No
detector has been trained, no checkpoint exists, and no sensitivity, FROC,
false-positive or calibration figure has been produced.

---

## Required decision owner

**No named decision owner is currently recorded in the repository. An owner
must be assigned before training approval.**

The nearest documented role is the *clinical advisor* in
`docs/CLINICAL_ADVISOR_BRIEF.md`, which is a recruitment brief, not an
appointment; no advisor is recorded as appointed. `docs/P2_LOCALIZATION_METHODOLOGY.md`
names the approver only as "a project or clinical-methodology owner".

The owner needs authority over dataset methodology, localisation methodology,
evaluation criteria, training methodology and the handling of test exposure.
Implementation decisions by the developer, including the defaults recorded
below, are **not** methodological or clinical approval.

---

## Register

| # | Decision | Current state | Evidence | Decision required | Decision owner | Status |
|---|---|---|---|---|---|---|
| 1 | Lung mask v4 | `lung-threshold-v4` implemented and tested; not approved | `docs/P2_LUNG_MASK_VALIDATION.md` §8, §12 | Is v4 approved as the training candidate-search constraint? | OWNER NOT YET ASSIGNED | PENDING |
| 2 | Test-split exposure | v4 measured on train/validation only; the v3 diagnosis looked at 4 test-split series | Validation report §3; `docs/P2_DATASET_RATIFICATION_AUDIT.md` §8 | How is this exposure recorded and handled for the formal evaluation? | OWNER NOT YET ASSIGNED | PENDING |
| 3 | Dataset ratification | LIDC label pipeline in use, unratified | Ratification audit §1–§9; `docs/P2_DATASET_DECISION.md` | Is the documented LIDC-derived dataset definition approved for this experiment? | OWNER NOT YET ASSIGNED | PENDING |
| 4 | Same-reader clusters | 7 local clusters hold two readings from one reader; preserved as-is | Ratification audit §4–§5 | How are these clusters handled in the ratified dataset? | OWNER NOT YET ASSIGNED | PENDING |
| 5 | CT geometry | Native spacing, no resampling, LPS frame, refusals implemented | `inference/series.py`, `inference/volume.py`; §5 below | Is the geometry and (non-)resampling specification approved? | OWNER NOT YET ASSIGNED | PENDING |
| 6 | Detector input | 3-slice 2.5D, 64 × 64 px, HU clip −1000…400 → [0,1] | `training/configs/lung_nodule_detector.yaml`; §6 below | Is this input representation approved for the first experiment? | OWNER NOT YET ASSIGNED | PENDING |
| 7 | Sampling | 1 positive per nodule, 200 negatives per series ≥ 32 mm from any mark, inside the mask | Config; `training/sampling.py`; §7 below | Is this sampling methodology approved for the first experiment? | OWNER NOT YET ASSIGNED | PENDING |
| 8 | Localisation | No rule; evaluator refuses | `docs/P2_LOCALIZATION_DECISION_BRIEF.md`; `docs/P2_LOCALIZATION_METHODOLOGY.md` | Which documented methodology and tolerance govern formal evaluation? | OWNER NOT YET ASSIGNED | PENDING |
| 9 | Performance criterion | `DRAFT_NOT_APPROVED` | `docs/bars/p2.json` `proposedGate` | What criterion, if any, governs the first formal evaluation? | OWNER NOT YET ASSIGNED | PENDING |
| — | GPU environment | CPU only; training refused | `scripts/check-training-environment.py` exit 1; §10 below | Not a methodology decision: provide a CUDA environment | Project (compute) | BLOCKED |

---

## 1. Lung mask v4

**What the mask is.** A candidate-search region constraint: where the service
scores candidate windows, and where training draws *negative* patches.
Positives are kept even when their centre falls outside it. It is not a lung
segmentation of any kind, and none of the figures below is a segmentation
accuracy.

**The v3 problem.** Bedding and padding in the −950…−300 HU band, outside the
patient, passed the component rule and closed a ring around the body; the
hole fill then filled 55–99% of the body cross-section — heart, mediastinum,
chest wall. On 30 train/validation series only 74.1% of v3's mask was inside
the body.

**The v4 correction.** Per slice, the body is found first (largest region
above −500 HU, holes filled); the lung band is searched only inside it; the
hole fill and dilation then run as before.

**Measured comparison** — first 30 train/validation series, 106 nodules:

| | v3 | v4 |
|---|---|---|
| Nodule centres inside | 104 / 106 | 104 / 106 |
| Voxels in body-scale filled holes (≥ 5,000 mm²) | 83.5 M | 0.047 M |
| Mask inside the body outline | 74.1% | 99.9% |

**Limitations, as documented.** The same two centres are missed by both —
LIDC-IDRI-0749 nodules 2 and 4, dense nodules against the chest wall beyond
the 3-voxel dilation. A residual of 47,267 voxels in holes ≥ 5,000 mm²
remains in 4 slices of 2 series (LIDC-IDRI-0052, -0822), not characterised.
Lung touching air outside the body in a slice is dropped (pinned by a test;
not observed in the 30 series).

**Decision required:** *Is v4 approved as the training candidate-search
constraint?*

---

## 2. Test-split exposure

**Facts.**

- The lung-mask v3 audit sample (the first 20 available series by source UID)
  contained **4 test-split series, 14 of 74 nodules** (ordinals 4, 5, 8, 14).
  Their masks, nodule centres, HU values and reader contours were inspected,
  and both v3 misses were test-split nodules (LIDC-IDRI-0481 n5,
  LIDC-IDRI-0951 n0). The same sample had been used to choose v3 over v2.
- The v4 measurement used **train and validation only**; its script refuses
  any other split.
- No model was fitted to, and no threshold chosen on, any test-split data.
  The training harness cannot read the test split for anything but
  evaluation.

**Decision required:** *How should this test-set exposure be recorded and
handled for the eventual formal evaluation?* Possible treatments include
retaining the test set with the exposure documented, designating the four
affected series as exploratory and non-confirmatory, replacing them if
scientifically justified, or establishing another untouched evaluation set.
None is selected here.

---

## 3. Dataset ratification

| | Current definition |
|---|---|
| Source | LIDC-IDRI (TCIA), CC BY 3.0; 229 series with pixel data on disk (about 19 GB), 217 annotation XML files |
| Labels | `dataset/lidc-labels.csv`, 1,703 nodules, 748 series, 740 patients |
| Reader annotations | Up to four radiologists per scan mark nodules ≥ 3 mm with contours and rate malignancy 1–5 |
| Clustering | Greedy single-link on reading centroids, 12 units mixing in-plane pixels and z in mm |
| Detection target | "A radiologist marked a nodule here" — malignancy ignored for detection |
| Indeterminate | Median rating 3 excluded from the label table; kept in the negative-sampling exclusion zone with < 3 mm nodules and non-nodules (77,302 points) |
| Diameters | Reader-contour max chord and equivalent-area diameter, median across readers; 995 nodules measured |
| Split | Patient-disjoint, HMAC of source patient id, fingerprint `f55f6cd5188ae3ee`, verified; train 474 / validation 93 / calibration 71 / test 102 patients |
| Pixel data | 229 of 748 series; nodules with pixels: train 518, validation 90, calibration 88, test 126 |
| Anomalies | Same-reader clusters (decision 4) |
| Label limits | Radiologist-derived research annotations and impressions — **not** histopathology, not diagnoses; centres are one reader's contour centroid; 439 of 1,703 nodules have one reader |

Open within this decision: whether indeterminate (median 3) and < 3 mm
nodules should become detection targets.

**Decision required:** *Is the documented LIDC-derived dataset definition
approved as the training/evaluation dataset for this detector experiment?*

---

## 4. Same-reader clusters

**Evidence** (207 local series with XML; reader = reading-session position,
because `servicingRadiologistID` is `anon` in 151 of 217 files):

| Patient | Cluster | Readings | Distinct readers | In label table |
|---|---|---|---|---|
| LIDC-IDRI-0204 | 0 | 5 | 4 | yes |
| LIDC-IDRI-0481 | 0 | 6 | 4 | no (median 3) |
| LIDC-IDRI-0404 | 1 | 7 | 4 | no (median 3) |
| LIDC-IDRI-0060 | 2 | 3 | 2 | yes |
| LIDC-IDRI-0879 | 4 | 2 | 1 | yes |
| LIDC-IDRI-0707 | 4 | 2 | 1 | yes |
| LIDC-IDRI-0188 | 7 | 2 | 1 | yes |

**Origin.** The existing clustering compares each reading to each cluster's
first reading only and has no one-reading-per-reader constraint, so two marks
from one radiologist can merge. The XML does not say whether they are two
lesions or one recorded twice.

**Implications.** `n_readers` and `agreement` are overstated for these
nodules — three "2-reader" nodules are one reader — and any agreement
threshold inherits that. Changing the clustering can split or merge clusters,
renumber `nodule_index`, change `n_readers`, `agreement` and possibly the
label, and break the join to the diameter table; it would be a new label
version (`lidc-labels-median-rating-v1` today) and needs the full-archive XML
(not on this machine) to apply to all 1,703 nodules. The split is by patient
and would not move. Reproducibility is preserved either way if the chosen
version is pinned.

**Decision required:** *How should these clusters be handled in the ratified
dataset?* (Preserve, exclude from positives and denominators, or re-derive
under a corrected clustering as a new label version.)

---

## 5. CT geometry

| | Current specification | Kind |
|---|---|---|
| Frame | DICOM patient coordinates, LPS, millimetres | implemented, fixed by DICOM |
| Orientation | One `ImageOrientationPatient` per series within 1e-3; else refused | implemented |
| Slice order | Projection onto the slice normal; polarity must be determinable, else refused | implemented |
| Voxel ↔ patient | Per-slice origin and direction cosines (`voxel_to_patient`, `patient_to_voxel`) | implemented, tested |
| Spacing | Native: ~0.55–0.78 mm in plane, 1.0–3.0 mm between slices in the local data | engineering default |
| Non-uniform spacing | Recorded as a warning (> 0.5 mm from median); missing slices left to the quality gate | implemented |
| Resampling | **None** (`resample_slice_spacing_mm: null`); the bar lists resample spacing as REQUIRES EMPIRICAL SELECTION | engineering default |
| Refusals | 14 codes incl. `invalid_geometry`, `duplicate_slice_position`, `untrusted_ordering`, `indeterminate_polarity`, `quality_gate_failed` | implemented |

**Decision required:** *Is the current CT geometry and resampling
specification approved for detector training?*

---

## 6. Detector input

| | Value | Kind |
|---|---|---|
| Representation | Hounsfield units via the modality LUT — not the characteriser's 8-bit lung-window render | IMPLEMENTED ENGINEERING DEFAULT |
| Architecture | `lung-nodule-candidate-2p5d-cnn` arch-v1, 1,173,473 parameters, one logit | IMPLEMENTED ENGINEERING DEFAULT |
| Channels | 3 adjacent slices (2.5D) | IMPLEMENTED ENGINEERING DEFAULT |
| Patch | 64 × 64 px in plane | IMPLEMENTED ENGINEERING DEFAULT |
| Normalisation | Clip −1000…400 HU, scale to [0, 1]; no per-volume z-scoring | IMPLEMENTED ENGINEERING DEFAULT |
| Spacing | Native — patches cover different physical sizes on different scanners | IMPLEMENTED ENGINEERING DEFAULT |
| Consistency | Values checked against the serving path at load (`MATCHES_SERVICE`); preprocessing fingerprint in every manifest | implemented |
| Region constraint | Lung mask (decision 1) | METHODOLOGY DECISION |
| Whether any of the above is fit for the first experiment | — | METHODOLOGY DECISION |

None of these values was selected by measurement.

**Decision required:** *Is this input representation approved for the first
detector experiment?*

---

## 7. Sampling

| | Value |
|---|---|
| Positive | One patch per labelled nodule, centre jittered ± 4 px; kept even if outside the mask |
| Negative | 200 per series, centre inside the lung mask, ≥ 32 mm (3-D) from every mark of any kind |
| Ratio | About 200 negatives per series against 1–9 positives; balanced in the loss by `pos_weight` |
| Exclusions | Every rated, indeterminate, < 3 mm and non-nodule mark (77,302 points) |
| Augmentation | Shift ≤ 4 px, rotation ≤ 10°, HU offset ≤ 20, contrast ≤ 5%, noise σ 10 HU; flips and scaling forbidden; target moved with every geometric transform |
| Seeds | Sampling 20260924, augmentation 20260925, optimisation 20260926 |
| Split boundaries | Fit reads train only; selection reads validation only (by loss); calibration only calibration; test only evaluation — enforced in code and tested |

All values are UNVALIDATED ENGINEERING DEFAULTS. Nothing was tuned on the
test split.

**Decision required:** *Is this sampling methodology approved for the first
detector experiment?*

---

## 8. Localisation

Status: **PENDING**; the evaluator refuses without an approved rule, and the
bar records the tolerance as BLOCKED.

This decision governs candidate-to-nodule matching, and so every true- and
false-positive count, sensitivity, the FROC curve and any localisation claim.

Documented options (`docs/P2_LOCALIZATION_DECISION_BRIEF.md`, unranked):

- **A. Fixed radius** — match within a constant *r* mm.
- **B. Nodule radius** — within half a measured diameter; which diameter must
  be chosen (max chord and equivalent-area differ by about 1.6 mm at the
  median).
- **C. Nodule radius with a floor** (and optional ceiling).
- **D. Slice-aware** — separate in-plane and through-plane tolerances; not
  implemented.

Also open inside this decision: greedy nearest-first vs maximum-matching
assignment; duplicate policy; reader-agreement and size thresholds; whether
nodules outside the lung mask count as misses or are reported separately.

**Decision required:** *Which documented localisation methodology and
tolerance should govern the formal detector evaluation?*

---

## 9. Performance criterion

As documented in `docs/bars/p2.json`, unchanged:

| | |
|---|---|
| Status | `DRAFT_NOT_APPROVED` |
| Proposed gate | per-nodule sensitivity 0.85 at 4 false positives per scan |
| Source | an example ("e.g.") in `docs/AUDIT_AND_ROADMAP_2026-09-20.md` Part B2 |
| Recorded as | not an established threshold, not regulatorily derived, not benchmark-justified |
| If missed | do not ship candidates |

**What it measures:** per-nodule sensitivity at a stated false-positive rate,
on the FROC curve, with Wilson intervals. **Population:** the test split's
available series — 32 series, 126 nodules — subject to decisions 2, 3, 4 and
8, each of which changes the denominator (exclusions, reader-agreement and
size thresholds, nodules outside the mask). **Sample size:** on 126 nodules an
observed 0.849 carries a 95% interval of 0.776–0.901, so the test set cannot
separate 0.85 from 0.90. **Timing:** `docs/ML_CHANGE_PROCESS.md` requires the
criterion to be fixed before evaluation; a bar that moves after a measurement
is not a bar.

**Decision required:** *What performance criterion, if any, should govern the
first formal detector evaluation?* To be approved independently of any
observed result.

---

## 10. GPU environment — BLOCKED

Engineering, not methodology.

| | Current | Required by the harness |
|---|---|---|
| Python | 3.8.10 | ≥ 3.10 (`MIN_TRAINING_PYTHON`) |
| PyTorch | 2.1.0+cpu | CUDA build matching the host driver; `training/requirements-training.txt` shows torch 2.3.1 / cu121 as an example, not a pin |
| CUDA | not available, 0 devices (Intel Iris Xe) | required — LIDC training refused on any non-CUDA device |
| GPU memory | — | ≥ 8 GB, an INITIAL ENGINEERING FLOOR; actual need TO BE BENCHMARKED |
| System memory | 7.78 GB | TO BE BENCHMARKED (the CPU machine hit memory errors during this work) |
| Dataset storage | 229 series, about 19 GB, on D: (479.9 GB free) | the full LIDC-IDRI adds about 60 GB (`docs/P2_TRAINING_FEASIBILITY.md`) |
| Sample cache | — | TO BE BENCHMARKED (cached under gitignored `artifacts/training`) |
| Throughput / run time | 2.3 patches/s on CPU for a toy model | TO BE BENCHMARKED on the GPU |

**Real detector training: NOT EXECUTED.** `check-training-environment.py`
must print TRAINING READY and `train_lung_detector.py --dry-run` must print
DRY RUN SUCCESS on the new machine before a run.

---

## What each decision still needs

For each decision: the evidence that does not exist yet, and what a sign-off
must state to be usable. A sign-off that does not state these cannot be
implemented without someone else guessing, and a guess is not a decision.

| # | Evidence still missing | A sign-off must state |
|---|---|---|
| 1 Lung mask v4 | Measurement on more than 30 series; characterisation of the 47,267-voxel residual; an assessment of how often lung touching air outside the body occurs | Approved or rejected; the accepted limitations (F2 dilation radius, open-lung drop); whether v4 constrains negative sampling, the serving search, or both |
| 2 Test-split exposure | None: the facts are complete (§2) | Which treatment (retain with disclosure, exploratory, replace, new set); if replaced or re-split, the new split version to commit before evaluation |
| 3 Dataset ratification | Full-archive XML to measure anomalies across all 1,703 nodules (only 207 series' XML is local) | Approved definition, including whether indeterminate (median 3) and < 3 mm nodules are targets, and the label version |
| 4 Same-reader clusters | The same full-archive XML | Preserve, exclude, or re-derive; if re-derived, the new label version and that `nodule_index` identities change |
| 5 CT geometry | Any measurement of the effect of native versus resampled spacing (none exists) | Native or resampled; if resampled, the target spacing and interpolation |
| 6 Detector input | Any comparison of alternatives (none exists) | Accept the current 2.5D, 3 × 64 × 64, HU −1000…400 → [0,1] as the first experiment's input, or the replacement |
| 7 Sampling | Any comparison of alternatives (none exists) | Accept or replace positives per nodule, 200 negatives per series, 32 mm exclusion radius and `pos_weight` balancing |
| 8 Localisation | A local inter-reader localisation study (none exists) | Basis (fixed or which diameter), floor and ceiling, greedy or maximum matching, duplicate policy, reader-agreement and size thresholds, treatment of nodules outside the mask. Recorded both in `docs/P2_LOCALIZATION_METHODOLOGY.md` and as a machine-readable `rule` in `docs/bars/p2.json` |
| 9 Performance criterion | A justification for any threshold (the current 0.85 at 4 FP/scan is an example from a roadmap) | The criterion, the population and denominator, and that it was fixed before any evaluation |

## How an approval becomes real

The register is read by people; the harness reads
`docs/decisions/p2-training-authorisation.json`. Training runs only when
every one of the nine entries there is `APPROVED` with an owner (a person,
not "OWNER NOT YET ASSIGNED" or "TBD"), a role, a `YYYY-MM-DD` date and the
decision written out (`training/authorisation.py`; refused in both
`scripts/train_lung_detector.py` and the trainer itself; tested in
`training/tests/test_authorisation.py`). There is no override.

An approval is recorded in one change that updates, together: the JSON
entry, the sign-off block below, and
`training/tests/test_authorisation.py::test_every_decision_in_the_repository_is_still_pending`,
which fails on purpose until it is edited. Writing APPROVED in this document
alone authorises nothing.

## Training authorisation rule

```
Engineering readiness
+ Methodology approval        (decisions 1, 5, 6, 7)
+ Dataset approval            (decisions 3, 4)
+ Evaluation approval         (decisions 8, 9)
+ Test-exposure disposition   (decision 2)
+ GPU availability
= Training authorisation
```

Engineering readiness alone is **not** authorisation. Every term must be
recorded before the first real training run; a missing term means NO.

---

## Verification for this register

| Check | Exit code | Result |
|---|---|---|
| `pytest inference/tests` | 0 | 374 passed |
| `pytest training/tests` | 0 | 167 passed |
| TypeScript `detection-candidates` + `dicom-series` (disposable Postgres, `INFERENCE_URL` set) | 0 | 46 passed, 1 skipped by design |
| `npx tsc --noEmit` | 0 | no output |
| `npx vite build` | 0 | built |
| **Full `npm test`** | — | **NOT RUN in this phase.** |

The most recent full `npm test` (methodology-gate phase, before v4) exited
**1**: 320 passed, 1 failed, 3 skipped. The failure was a patient-isolation
test that got a 500 instead of a 422 while the inference service was out of
memory; the file passed alone. The earlier run (readiness phase) exited 1
with 14 tests cancelled in `tests/adverse-events.test.ts`, which passed
14/14 alone.

**Update 28 September 2026:** the first single clean full run is recorded, with v4 in place — `npm test` exit **0**, 325 passed, 0 failed, 0 cancelled, 3 skipped by design, at `11599a1`, after the `/healthz` digest cache (`dc5c2ef`) and a larger per-file test budget. Inference 382 passed, training 167 passed.

---

## Decision Sign-Off

```text
Decision owner:
Role:
Date:

Dataset methodology:
[ ] Approved
[ ] Rejected
[ ] Deferred

Lung-mask v4:
[ ] Approved
[ ] Rejected
[ ] Deferred

Test-set exposure treatment:
[ ] Approved
[ ] Rejected
[ ] Deferred

Same-reader cluster treatment:
[ ] Approved
[ ] Rejected
[ ] Deferred

CT geometry:
[ ] Approved
[ ] Rejected
[ ] Deferred

Detector input:
[ ] Approved
[ ] Rejected
[ ] Deferred

Sampling methodology:
[ ] Approved
[ ] Rejected
[ ] Deferred

Localization methodology:
[ ] Approved
[ ] Rejected
[ ] Deferred

Performance criterion:
[ ] Approved
[ ] Rejected
[ ] Deferred

GPU environment:
[ ] Available
[ ] Not available
[ ] Benchmark required

Overall authorization to begin detector training:
[ ] YES
[ ] NO

Owner comments:
```
