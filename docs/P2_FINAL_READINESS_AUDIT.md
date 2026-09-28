# P2 detector — final readiness audit

28 September 2026. Branch `fix/remove-fabricated-ai-results`. Audit started at
HEAD `b13c09c`; one defect found and fixed during it (`172017e`); this record
is committed on top.

## Training authorisation: **NO — BLOCKED**

Computed mechanically in §12. Nine methodology decisions are PENDING with no
owner assigned, and there is no CUDA device. No detector was trained, no
checkpoint or weights exist, and no detection metric, OOD result or
calibration result was produced or estimated.

Labels used: PASS, FAIL, PENDING DECISION, BLOCKED, NOT STARTED, NOT APPLICABLE.

---

## 1. Repository status

| Item | State |
|---|---|
| Branch | `fix/remove-fabricated-ai-results` |
| HEAD at start | `b13c09c` |
| Working tree at start | One modified file: `docs/pack/ip-ownership-declaration.pdf` — the applicant's filled-in copy (59 KB → 127 KB). Left uncommitted deliberately: it may carry an identity number. No other change. |
| Secrets, datasets, model files, patient data staged | None. `dataset/` and `artifacts/` are gitignored. |
| Pushed | Nothing |

## 2. Verification results

Each exit code is the process's own, written to a file as it exited — never a
following `echo`. Run at HEAD `172017e` against the disposable Postgres, with
the inference service running.

| Command | Exit | Passed | Failed | Cancelled | Skipped by design | Skipped for a missing dependency |
|---|---|---|---|---|---|---|
| `npm test` (full) | **0** | 328 | 0 | 0 | 3 (no-service paths; `INFERENCE_URL` is set) | 0 |
| `python -m pytest inference/tests` | **0** | 382 | 0 | — | 0 | 0 |
| `python -m pytest training/tests` | **0** | 167 | 0 | — | 0 | 0 |
| `npx tsc --noEmit` | **0** | — | — | — | — | — |
| `npm run build` (`vite build`) | **0** | — | — | — | — | — |
| `scripts/verify-training-manifest.py` | **0** | verified | | | | |
| `scripts/check-training-environment.py` | 1 | TRAINING NOT AVAILABLE — expected | | | | |
| `scripts/train_lung_detector.py --dry-run` | 3 | harness ready, environment not available — expected | | | | |

**Not a clean first attempt, recorded as it happened.** The first full run of
this audit was started at `b13c09c` and stopped deliberately part-way: the
auditor edited `tests/capability-claims.test.ts` and ran it by hand while the
suite was executing that file, and both used port 5099. The contaminated run
was discarded and the suite re-run from scratch at `172017e`; the table is
that run. `/healthz` measured 16–20 ms warm (182 ms on the first call).

## 3. Detector safety boundary — PASS (after one fix)

| Check | Result | Evidence |
|---|---|---|
| `lung-nodule-detection` capability | PASS — `PLANNED` | `server/capabilities.ts:206`; pinned by `tests/capability-claims.test.ts` |
| Detector checkpoint or weights | PASS — none | No detector artifact anywhere; `detector_status()` reports `available: false` |
| Registry entry enabled | PASS — none | `register_detector()` is called only from tests |
| Silent inference | PASS — none | A detection request refuses with `model_unavailable` (503) and records the run |
| `candidateCount` when nothing ran | PASS — `NULL` | `server/detection.ts` sets `candidateCount: null` on every refused and failed path |
| Refusal shown as a negative result | PASS — never | `describeRun` says a refused run "was NOT searched" and "is not a negative result"; tested |
| Clinical conclusion from the detector path | PASS — none | Closed review vocabulary; "no field in the response could hold a clinical conclusion" tested |
| Detector parameters (stride, threshold 0.5, merge radius 8 mm) | PASS — marked unselected | `inference/detection_service.py` records each as needing empirical selection |
| Claims in the client | **FAIL found, fixed in `172017e`** | See below |

**Found during this audit.** `AnalysisResultsDisplay`, shown by the doctor
portal, the patient portal and the scanner, displayed a hardcoded **"99.2%
Accuracy"** beside every analysis result — a figure no model has measured. The
`/about` page called the platform "production-ready" with "clinical-grade AI
models", quoted 0.785 for the lung model withdrawn on 2026-09-20, and
advertised features that do not exist. Neither is the detector, but both are
fabricated clinical-performance claims. The claims test had swept three named
components; it now sweeps every client file (comments stripped) for
prohibited claims and for literal percentages beside a metric name. Its two
new tests failed on exactly these four lines and pass after the fix. A sweep of
`server/`, `shared/` and `inference/` found no comparable claim; the one match,
skin sensitivity 0.9133, is the measured and bound figure.

**Caveat.** The end-to-end refusal tests in `tests/detection-candidates.test.ts`
need the LIDC data and the inference service; CI has neither and skips them.
They ran and passed on this machine.

## 4. Dataset status — PENDING DECISION

| Check | Result |
|---|---|
| Patient-disjoint split | PASS — `verify-training-manifest.py` exit 0; all six pairwise intersections 0 |
| Seed and method | PASS — HMAC-SHA256 of the source LIDC id, seed `healthai-lidc-split-v1` |
| Fingerprint | PASS — `f55f6cd5188ae3ee`, recomputed and matching the pinned value |
| Assignments | train 474 / validation 93 / calibration 71 / test 102 patients |
| Split manifest tracked | PASS — `docs/splits/lidc-split-v1.json`, `docs/splits/lidc-availability.json` |
| Dataset ratified | **PENDING DECISION** — `docs/P2_DATASET_DECISION.md` unratified; same-reader clusters and indeterminate/< 3 mm targets undecided |
| LUNA16 | NOT APPLICABLE — not integrated, not downloaded |

## 5. Test-split exposure — PENDING DECISION

**What happened.** The lung-mask audit sample (first 20 locally available
series by source UID) contained 4 test-split series — patients LIDC-IDRI-0481,
-0447, -0951 and -0059 — with 14 of its 74 nodules.

| Question | Answer |
|---|---|
| What test data was inspected | CT volumes of those 4 series; for each of the 14 nodules: centre voxel and patient coordinates, HU at the centre, mask membership under v1/v2/v3, distance to the mask edge, reader-contour area inside the mask, reader characteristics |
| What was measured | Lung-mask behaviour only — centre retention, fill composition, boundary distance. No detector output, no score, no threshold |
| Did it influence v2/v3/v4 selection | **Yes, v2 → v3.** The v3 choice (`2f369e5`) used this sample, and both v3 misses were test nodules (LIDC-IDRI-0481 n5, LIDC-IDRI-0951 n0). The v3 failure diagnosis that motivated v4 used the same sample. v4's own measurement used train and validation series only |
| Any model trained on it | No |
| Any threshold selected on it | No |
| Can the test set still be the final untouched set | That is the decision. The detector's evaluation population has not been seen by any model; the mask that bounds the search was shaped partly by looking at four of its series |

**Options for the methodology owner** — not selected here:

| Option | Consequence |
|---|---|
| Retain the test set, exposure documented | Keeps 126 test nodules; reported results carry a stated limitation that the search constraint was partly developed on 4 test series |
| Mark the 4 series exploratory, exclude them from confirmatory evaluation | Test nodules fall from 126 to 112; confidence intervals widen; evaluation population no longer contains anything that was inspected |
| Replace the 4 series | Requires new pixel data for the same split rules; changes the test population and the split fingerprint; a new split version must be committed before evaluation |
| Establish a new untouched evaluation set | Strongest separation; needs more LIDC data downloaded (about 60 GB for the rest of the collection) or an external set, and its own pre-registration |

## 6. Lung-mask status — PENDING OWNER/METHODOLOGY DECISION

| Check | Result | Evidence |
|---|---|---|
| Body constraint implemented as documented | PASS | `_body_region`: per slice, `binary_fill_holes(array > -500 HU)`, largest connected region |
| Aerated band restricted to the body before components | PASS | `aerated = in_band & body` |
| Bedding cannot become lung through the fill | PASS | Wrapped-body tests fail on v3 and pass on v4 |
| Chest-wall limitation documented | PASS | F2 in `docs/P2_LUNG_MASK_VALIDATION.md`: dense juxtapleural nodules beyond the 3-voxel dilation (LIDC-IDRI-0749 n2, n4) |
| Open-lung limitation documented | PASS | Pinned by `test_lung_open_to_the_air_outside_the_body_is_not_searched` |
| v4 evaluated only on permitted data | PASS | 30 series, train 25 / validation 5; measurement script refuses other splits |
| Test results incorporated into v4 approval | PASS — none; there is no approval | Register decision 1: PENDING |
| Residual | 47,267 voxels of body-scale fill in 4 slices of 2 series, uncharacterised |

## 7. DICOM geometry — PASS (engineering); resampling PENDING DECISION

| Check | Result |
|---|---|
| ImageOrientationPatient | Validated: unit, orthogonal, one orientation per series (tolerance 1e-3); malformed or degenerate refused |
| ImagePositionPatient | Required per slice; missing or malformed refused |
| Row / column spacing | Applied separately; anisotropic spacing tested as not interchangeable |
| Slice ordering and polarity | Projection on the slice normal; indeterminate polarity refused by default |
| LPS coordinates | DICOM patient frame, millimetres |
| voxel ↔ patient | Round trip within 1e-9 voxel, on sub-voxel positions and every slice of a long series |
| Irregular spacing | Reported, not smoothed; resolves to the right slice |
| Duplicate positions | Refused |
| Real data | A real LIDC series assembles and orders; label coordinates follow the DICOM formula |
| Tests | `test_geometry.py`, `test_volume.py`, `test_series_assembly.py`: 70 passed, 0 skipped |
| Resampling | None — native spacing. Whether to resample is **PENDING DECISION** (register decision 5) |

## 8. DPIA / erasure — PASS for the implemented behaviour; two items open

| Check | Result |
|---|---|
| Reaches imaging studies, series, instances | PASS |
| Reaches detection runs and candidates | PASS |
| Removes stored scan images and CT objects | PASS since `4acae2d` (scan images were previously never removed) |
| Object deleted before its row | PASS |
| Row kept if its object cannot be deleted | PASS (with its series and study) |
| Data subject told a count, not a location | PASS — tested |
| Location recorded for administrators only | PASS — `ERASURE_OBJECTS_RETAINED` audit event |
| Clinical retention hold | PASS — later of scans and series |

**Historical orphans.** This audit has no access to, and did not query, any
live or production database or bucket, so it cannot say whether erasures were
executed there before `4acae2d`. **Historical orphan check required if prior
live erasure requests occurred.**

**Retry.** **No administrative retry mechanism currently implemented.** A
retained object stays recorded in its row and the audit trail; an executed
request cannot be executed twice, by design.

Other DPIA items open and unrelated to training: R-01 (no Information
Officer), R-02 and R-07 (care-relationship and MFA enforcement in shadow mode),
R-09, R-10, R-11.

## 9. Training infrastructure — BLOCKED

| Requirement | Required by the harness | This machine |
|---|---|---|
| Python | ≥ 3.10 | 3.8.10 |
| PyTorch | CUDA build matching the driver | 2.1.0+cpu |
| CUDA | required — LIDC training refused on non-CUDA devices | not available, 0 devices (Intel Iris Xe) |
| GPU memory | ≥ 8 GB — an engineering floor, TO BE BENCHMARKED | — |
| System RAM | TO BE BENCHMARKED | 7.78 GB |
| Dataset | 229 series on disk (~19 GB); full LIDC-IDRI ~60 GB more | 229 series |
| Sample cache | TO BE BENCHMARKED | — |
| Throughput / duration | TO BE BENCHMARKED on a GPU | CPU: ~2.3 patches/s for a toy model |
| `check-training-environment.py` | must print TRAINING READY | exit 1, TRAINING NOT AVAILABLE |
| `train_lung_detector.py --dry-run` | must print DRY RUN SUCCESS | exit 3 at this audit; exit 4 (not authorised) since `77426fc` |

**GPU TRAINING BLOCKED — NO CUDA DEVICE.** No benchmark was possible.

**GPU readiness checklist** — in order, on the GPU machine:

1. Create the Python ≥ 3.10 environment (`inference/py310/README.md`).
2. Install the CUDA build of torch matching the driver, then
   `training/requirements-training.txt`.
3. `python scripts/check-training-environment.py` → TRAINING READY; record GPU
   model, VRAM, CUDA version and the environment fingerprint.
4. Copy the 229 LIDC series and the split artefacts; `verify-training-manifest.py` → verified.
5. `python scripts/train_lung_detector.py --dry-run` → DRY RUN SUCCESS.
6. **Benchmark, not training**: `--synthetic --epochs 1`, then measure peak
   VRAM on a representative forward/backward pass at the configured batch
   size, sample-cache size, patches per second, and projected time per epoch.
7. Record the benchmark. Full training starts only when the register is fully
   approved (§12) — never automatically.

## 10. Decision register

No named decision owner is recorded in the repository.

| # | Decision | Current status | Evidence | Owner | Blocking? |
|---|---|---|---|---|---|
| 1 | Lung mask v4 as the candidate-search constraint | PENDING DECISION | `P2_LUNG_MASK_VALIDATION.md` §12 | OWNER NOT ASSIGNED | Yes |
| 2 | Handling of test-split exposure | PENDING DECISION | §5 above | OWNER NOT ASSIGNED | Yes |
| 3 | Dataset ratification | PENDING DECISION | `P2_DATASET_RATIFICATION_AUDIT.md` | OWNER NOT ASSIGNED | Yes |
| 4 | Same-reader cluster methodology | PENDING DECISION | Ratification audit §5 | OWNER NOT ASSIGNED | Yes |
| 5 | CT geometry / resampling policy | PENDING DECISION | §7 above | OWNER NOT ASSIGNED | Yes |
| 6 | Detector input representation | PENDING DECISION | Decision register §6 | OWNER NOT ASSIGNED | Yes |
| 7 | Sampling methodology | PENDING DECISION | Decision register §7 | OWNER NOT ASSIGNED | Yes |
| 8 | Localisation methodology and tolerance | PENDING DECISION | `P2_LOCALIZATION_DECISION_BRIEF.md`; bar tolerance `BLOCKED` | OWNER NOT ASSIGNED | Yes |
| 9 | Performance criterion | PENDING DECISION | `docs/bars/p2.json` `DRAFT_NOT_APPROVED`, `approved: false` | OWNER NOT ASSIGNED | Yes |
| 10 | GPU / training environment | BLOCKED | §9 above | Project (compute) | Yes |

No `approved` flag was changed. Nothing was approved by inference from the
existence of documentation.

## 11. Remaining blockers

1. Nine methodology decisions PENDING, and no owner assigned to make them.
2. No CUDA device; Python 3.8; no benchmark.
3. DPIA R-01 (no Information Officer) — not a training blocker, but open.

## 12. Conditions required before training

| Condition | Status |
|---|---|
| Engineering checks pass | PASS (see §2) |
| Dataset decision explicitly ratified | PENDING DECISION |
| Test-split exposure decision recorded | PENDING DECISION |
| Lung-mask methodology approved | PENDING DECISION |
| CT geometry methodology approved | PENDING DECISION |
| Detector input representation approved | PENDING DECISION |
| Sampling methodology approved | PENDING DECISION |
| Localisation rule approved | PENDING DECISION |
| Performance bar approved | PENDING DECISION |
| Required governance documentation complete | PENDING DECISION — decision owner not assigned |
| DPIA requirements satisfied for training | PASS for the training data path (public research data, de-identified); platform DPIA items open |
| Required training infrastructure exists | BLOCKED |
| No safety blocker remains | PASS after `172017e` |

**Training authorisation: NO — BLOCKED.** Ten of the thirteen conditions are
not met; one unmet condition is enough.
