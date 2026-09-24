# P2 detector — training gate

24–25 September 2026. Branch `fix/remove-fabricated-ai-results`. Audit started
at HEAD `c7e8880`; this record is committed on top of `47c9375`.

## Is HealthAI Assistant ready to execute the first real lung-nodule detector training run?

**NO — BLOCKED.**

Blocking gates: **Lung mask (FAIL)**, **Test protection (FAIL)**, **Training
environment (BLOCKED)**, and six PENDING DECISIONs — dataset definition, CT
geometry, detector input, sampling, localisation methodology, performance
bar. No gate was relaxed to reach this answer, and none should be relaxed to
change it.

No detector was trained. No detector checkpoint exists. No detection metric
was computed or estimated.

---

## Gate table

| Gate | Status | Evidence | Blocking? |
|---|---|---|---|
| Dataset definition | PENDING DECISION | Label pipeline verified and unmodified; LIDC dataset decision awaits ratification; 5 label-table nodules merge two readings from one reader, 3 of them "2-reader" nodules that are one reader; whether indeterminate and < 3 mm nodules are targets is undecided — `docs/P2_DATASET_RATIFICATION_AUDIT.md` §5, §10 | Yes |
| Patient-disjoint split | PASS | `verify-training-manifest.py` exit 0; fingerprint `f55f6cd5188ae3ee` recomputed and pinned; 0 patient, series or label overlap, recomputed independently — ratification audit §6 | No |
| Pixel availability | PASS | 229 / 748 series; train 149 series / 518 nodules, validation 27 / 90, calibration 21 / 88, test 32 / 126 — measured and matching the bar. Sufficient to run training; the test sample cannot separate 0.85 from 0.90 sensitivity, which limits claims, not training — ratification audit §7 | No (for training) |
| Lung mask | **FAIL** | v3 fills 55–99% of the body cross-section in 10 of 20 series (heart, mediastinum, chest wall; 83% of all fill); 72/74 reproduced, 69/74 without the body-scale fill; both misses peripheral — `docs/P2_LUNG_MASK_VALIDATION.md` | Yes |
| CT geometry | PENDING DECISION | Native spacing kept, no resampling (`resample_slice_spacing_mm: null`); the bar records resample spacing as REQUIRES EMPIRICAL SELECTION; slice spacing 1.0–3.0 mm across the data | Yes |
| Detector input | PENDING DECISION | HU clip −1000…400 → [0,1], 3 adjacent slices, 64 × 64 px — explicit and checked against the service (MATCHES_SERVICE), but every value is an UNVALIDATED ENGINEERING DEFAULT; the bar lists patch size and stride as REQUIRES EMPIRICAL SELECTION | Yes |
| Sampling | PENDING DECISION | Positives: 1 per labelled nodule, ± 4 px jitter; negatives: 200 per series, ≥ 32 mm from every mark of any kind, **inside the lung mask** — so they inherit the mask FAIL; target definition depends on the open dataset decision | Yes |
| Localization methodology | PENDING DECISION | `docs/P2_LOCALIZATION_METHODOLOGY.md` status PENDING; bar tolerance BLOCKED; options set out without ranking in `docs/P2_LOCALIZATION_DECISION_BRIEF.md`; greedy assignment not ratified | Yes — for freezing the specification. The repository's rule requires it before evaluation, not before training |
| Performance bar | PENDING DECISION | `docs/bars/p2.json` status DRAFT_NOT_APPROVED; the 0.85 / 4 FP gate is an example from a roadmap, not benchmark- or regulation-derived; not approved, not optimised toward | Yes — for freezing the specification; required before evaluation |
| Training environment | BLOCKED | `check-training-environment.py` exit 1: Python 3.8.10 (< 3.10), torch 2.1.0+cpu, no CUDA, 0 GPUs (Intel Iris Xe), 8 CPUs (i7-1165G7), 7.78 GB RAM; disk C: 0.5 GB free, D: 479.9 GB free | Yes |
| Reproducibility | PASS | Same seed, config and synthetic data → identical weight fingerprint and per-epoch losses; different seed → different weights; resume equals an uninterrupted run; sampling and augmentation deterministic (3 targeted tests passed; full training suite 167 passed). CPU only — GPU determinism not verifiable here | No |
| Security | PASS | Full `npm test` exited 1 on one patient-isolation test that failed closed on an infrastructure error; re-run alone it passed (see Verification). No authentication, authorisation, patient-isolation, audit, de-identification or retention code changed in this phase (the only non-doc change is a comment in `inference/lung_mask.py` and tests in `inference/tests/test_detection_eval.py`). Training manifests exclude UIDs, patient ids and paths, and a test scans for them; console output prints gate status and losses only; caches are hash-named under gitignored `artifacts/`. Care relationship remains shadow mode (`CARE_RELATIONSHIP_ENFORCE` unset in `.env`, the shell and CI; DPIA R-02 open, pre-existing) | No |
| DPIA | PENDING | R-23: erasure reaches `imaging_studies`, `imaging_series`, `imaging_instances`, `detection_runs`, `detection_candidates` and stored objects, and the clinical hold is the later of scans and series (verified in `server/erasure.ts:98-129, 331-381`). **Residual gap:** when an object delete fails, the rows pointing to it are still deleted and the failed paths are neither persisted nor logged (only a count), so the administrator the message asks for has no record of which objects remain. R-02 open (shadow mode) | No (for training); open for release |
| Test protection | **FAIL** | Code level passes: one `require_split` gate, fit → train, select → validation, calibrate → calibration, evaluate → test, with refusal tests. **Methodology:** the evidence that chose lung-mask v3 used 4 test-split series (14 of 74 nodules) — ratification audit §8 | Yes |

Status vocabulary: PASS, FAIL, PENDING DECISION, BLOCKED, READY. "PENDING" for
the DPIA row means a documented residual that is neither closed nor blocking
training.

---

## Training specification — what is defined

| Area | Item | Defined? | Status |
|---|---|---|---|
| Dataset | Split fingerprint | `f55f6cd5188ae3ee`, pinned | verified |
| | Label version | `lidc-labels-median-rating-v1` | defined; ratification pending |
| | Dataset fingerprint | computed from manifest, labels, exclusions, decision record and preprocessing (`training/manifest.dataset_fingerprint`) | defined |
| Input | HU conversion | modality LUT only (`inference/volume.py`) | defined |
| | Spacing / resampling | native, none | UNVALIDATED ENGINEERING DEFAULT |
| | Orientation | validated frame from the series pipeline; patches in voxel space | defined |
| | Patch | 64 × 64 px, 3 adjacent slices as channels | UNVALIDATED ENGINEERING DEFAULT |
| | Normalisation | clip −1000…400 HU, scale to [0,1] | UNVALIDATED ENGINEERING DEFAULT |
| Sampling | Positive | labelled nodule centre, ± 4 px | UNVALIDATED ENGINEERING DEFAULT |
| | Negative | 200 per series, ≥ 32 mm from any mark, inside the lung mask | UNVALIDATED ENGINEERING DEFAULT; mask FAIL |
| | Balancing | `pos_weight` | UNVALIDATED ENGINEERING DEFAULT |
| | Exclusions | every rated, indeterminate, < 3 mm and non-nodule mark (77,302 points) | defined |
| Augmentation | Transforms | shift ≤ 4 px, rotation ≤ 10°, HU offset ≤ 20, contrast ≤ 5%, noise σ 10 HU; flips and scaling forbidden | UNVALIDATED ENGINEERING DEFAULT |
| | Coordinates | target moved with every geometric transform | defined, tested |
| | Seeds | sampling 20260924, augmentation 20260925, optimisation 20260926 | defined |
| Model | Architecture | `lung-nodule-candidate-2p5d-cnn` arch-v1, widths 32/64/128/256, dropout 0.2 | UNVALIDATED ENGINEERING DEFAULT |
| | Parameters | 1,173,473 | measured |
| | Input / output | 3 × 64 × 64 → one logit ("a radiologist marked a nodule here") | defined |
| Training | Loss | binary cross-entropy with `pos_weight` | UNVALIDATED ENGINEERING DEFAULT |
| | Optimiser / LR / schedule | AdamW, 3e-4, weight decay 1e-4, cosine | UNVALIDATED ENGINEERING DEFAULT |
| | Batch / epochs / patience | 128 / 40 / 8 | UNVALIDATED ENGINEERING DEFAULT |
| | Checkpoint selection | best validation loss, plus last | defined; no detection metric used |

**The specification is not frozen.** Freezing waits on: dataset methodology,
a corrected and approved lung mask, localisation methodology, input geometry,
sampling strategy (which inherits the mask), and evaluation methodology.

---

## Verification run for this gate

Recorded as each process exited — not through a later `echo $?`.

| Check | Exit code | Result |
|---|---|---|
| `pytest inference/tests` | 0 | 367 passed (363 before this phase + 4 matcher tests added) |
| `pytest training/tests` | 0 | 167 passed |
| `npx tsc --noEmit` | 0 | no output |
| `npx vite build` | 0 | built |
| `npm test` (disposable Postgres, `INFERENCE_URL` set) | **1** | 320 passed, **1 failed**, 3 skipped (by design), 0 cancelled — **not a clean run** |
| `tests/dicom-series.test.ts` re-run alone | 0 | 26 passed, 0 failed, 1 skipped (by design) |
| `scripts/verify-training-manifest.py` | 0 | verified |
| `scripts/check-training-environment.py` | 1 | TRAINING NOT AVAILABLE (expected) |

**The full `npm test` did not pass.** The one failure was
`tests/dicom-series.test.ts` › "a study already filed for another patient
refuses a new series": expected 422, got
`500 {"error":"The series could not be ingested. Nothing was stored.","detail":"fetch failed"}`
after 2 s. The request never reached the inference service (no log line for
it). In the same window the service's `/healthz` raised `MemoryError` twice
while re-hashing a ~276 MB model artifact on the request path — the
already-recorded follow-up in `docs/P2_TRAINING_READINESS.md`, now observed
producing 500s under memory pressure on this 7.8 GB machine. The server
failed closed (500, nothing stored), so no isolation guarantee was violated,
but the test did not exercise the check it exists for. Re-run alone, the file
passed, including that test. Across the two runs: 321 passed, 0 failed,
3 skipped. That is two runs, not one clean run, and is recorded as such.
Nothing in this phase changed server code; the failure is environmental, and
the `/healthz` re-hash is a reliability defect to fix, not an explanation to
lean on.

The previous phase's TypeScript result was **not** one clean run either: the full
suite exited 1 with 14 tests in `tests/adverse-events.test.ts` cancelled after
its registration hook returned 500 (~117 s, database just restarted); that file
then passed 14/14 alone, for 321 passed / 0 failed / 3 skipped across the two
runs. That record stands as written in `docs/P2_TRAINING_READINESS.md`.

---

## Executive status

```text
Repository:               HealthAiAssist2
Branch:                   fix/remove-fabricated-ai-results
HEAD:                     see `git log` — this record's commit, on 47c9375
Working tree:             clean after commit

Lung mask:                FAIL — v3 fills the body in 10/20 series; decision PENDING on a corrected mask
Dataset:                  PENDING DECISION — ratification; same-reader clusters; indeterminate/<3 mm targets
Localization methodology: PENDING DECISION — no rule chosen; evaluator refuses
Performance bar:          DRAFT_NOT_APPROVED
Training harness:         IMPLEMENTED — READY FOR GPU EXECUTION — NOT EXECUTED
GPU:                      NONE (torch 2.1.0+cpu, no CUDA)
DPIA:                     R-23 residual open (failed object paths unrecorded); R-02 open (shadow mode)
Care relationship:        SHADOW — CARE_RELATIONSHIP_ENFORCE unset
Clinical validation:      ABSENT
Real detector checkpoint: ABSENT
```

## Blocking decisions

1. **Lung mask** — a corrected mask that cannot fill the body, measured on
   train and validation only, then approved or rejected by a methodology
   owner.
2. **Dataset** — ratify the LIDC label pipeline; decide preserve / exclude /
   re-derive for same-reader clusters; decide whether indeterminate and
   < 3 mm nodules are targets.
3. **Localisation methodology and performance bar** — decided and recorded
   before the specification is frozen and before any evaluation.
4. **Input geometry** — spacing policy and patch size, which the bar already
   marks as requiring empirical selection.
5. **Compute** — a CUDA machine with the Python ≥ 3.10 training environment.

## Safe next action

Fix the lung mask's body-scale fill: first add a failing test for a closed ring
formed by non-lung aerated-band material, then correct the component
selection, and re-measure centre retention and fill composition on **train
and validation series only**. That removes the one FAIL that is engineering
work rather than a decision, and replaces the test-contaminated selection
evidence.
