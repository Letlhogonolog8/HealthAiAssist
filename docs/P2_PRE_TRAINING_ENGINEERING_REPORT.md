# P2 detector — pre-training engineering report

28 September 2026. Branch `fix/remove-fabricated-ai-results`. Started at HEAD
`e9c8c38`. Nothing pushed.

## Training authorisation: **NO — BLOCKED**

Engineering that could proceed without an owner decision is done. What
remains is nine owner decisions and a CUDA machine. No detector was trained;
no checkpoint, weights, metric, OOD artifact or calibration artifact exists.

---

## What this phase changed

| Commit | Change |
|---|---|
| `77426fc` | **A missing guard.** The harness said "training does not depend on" the pending decisions; only the absent GPU stopped training. A new `authorisation` gate reads `docs/decisions/p2-training-authorisation.json` and refuses real training unless all nine decisions are APPROVED with a named owner, role, date and decision text. Enforced in the CLI (dry run now exits 4) and in `trainer.check_run`. No override path |
| `3c53df4` | GPU benchmark: `scripts/benchmark_detector_training_env.py`. Synthetic tensors only; trains nothing; exits 2 without CUDA |
| `1bc5a95` | Erasure retry endpoint (admin, re-assessed, one deletion path, audited) and a report-only orphan audit tool with no deletion code |
| `37fd7fb` | Tests pinning that the detector does not exist |
| `dd95ea3` | Decision register: missing evidence and required sign-off content per decision; how an approval becomes real. Test-split exposure disclosed in the evaluation protocol and the bar |

---

## COMPLETE

| Item | Evidence |
|---|---|
| Detector safety boundary | `PLANNED`; empty slot; `register_detector` called only in tests; refusals recorded with `candidateCount` NULL; no clinical conclusion possible — `inference/tests/test_detector_absent.py`, `tests/detection-candidates.test.ts` |
| No model binary tracked, no detector measurement bound | `test_detector_absent.py` |
| Pre-registration records nothing as done | Bar `DRAFT_NOT_APPROVED`, `approved: false`, tolerance `BLOCKED`, OOD `NOT YET BUILT`, calibration `NOT YET PERFORMED`, checkpoint `ABSENT` — pinned |
| Training refuses without authorisation | `training/tests/test_authorisation.py` (placeholder owners, missing dates, REJECTED/DEFERRED, missing or duplicate entries, direct trainer calls) |
| Training refuses on CPU, below Python 3.10, on the test split, with a bad manifest | Existing harness tests, re-run |
| Patient-disjoint split intact | `verify-training-manifest.py` exit 0; fingerprint `f55f6cd5188ae3ee`; manifest unchanged |
| Candidate coordinate provenance | Voxel (i, j, k), patient mm in `dicom_patient_lps`, `position_index`, linked to a series storing orientation, both pixel spacings and per-instance positions |
| GPU benchmark procedure | Script, 8 tests; estimates measured here: 30,318 train and 5,490 validation samples per epoch, sample cache 2.08 GB, checkpoints 0.026 GB, DICOM 18.6 GB (37,970 files) |
| Erasure retry | `POST /api/admin/erasure-requests/:id/retry-objects`; 7 tests; all 29 erasure tests pass |
| Orphan audit tool | `scripts/audit-stored-objects.ts`; 11 tests; procedure in `docs/ERASURE_ORPHAN_AUDIT.md` |
| Test-split exposure disclosed | Register §2, `P2_LOCALIZATION_METHODOLOGY.md`, `docs/bars/p2.json` `splits.knownTestSplitExposure` |
| Claims sweep | No fabricated user-visible claim found beyond those fixed in `172017e` (below) |

### Claims sweep classification

| Occurrence | Class |
|---|---|
| `server/model-availability.ts` "off-nodule parenchyma 99.2%" | Legitimate: the characteriser's measured OOD acceptance rate |
| `AnalysisResultsDisplay.tsx` comment on "99.2% Accuracy" | Documentation of the removed claim |
| `docs/bars/p2.json` `prohibitedClaims`; `ML_CHANGE_PROCESS.md`; model card lists | Documented prohibitions |
| Admin dashboard "Mean AI Confidence" tiles | Correctly labelled. The underlying field in one endpoint (`server/routes.ts`) is still named `aiAccuracy`, contradicting its own comment; not user-visible; left for a separate rename |
| Admin "AI Detection Accuracy" card | Shows measured balanced accuracy of the two served models, read from the model cards |
| `skin sensitivity 0.9133` | Legitimate, bound to its artifact |
| Malignant/benign/risk/cancer in the characteriser and genomics paths | Legitimate terminology of existing, separately governed models; not reachable from the detector path |
| Fabricated or unapproved claims | None remaining after `172017e` |

## BLOCKED BY OWNER DECISION

No decision owner is assigned. All nine decisions are PENDING in both the
register and `docs/decisions/p2-training-authorisation.json`:

1. Lung mask v4 as the search and negative-sampling constraint
2. Treatment of the four exposed test-split series (LIDC-IDRI-0481, -0447, -0951, -0059; 14 nodules)
3. Dataset ratification
4. Same-reader clusters
5. CT geometry and resampling
6. Detector input representation
7. Sampling methodology
8. Localisation rule and tolerance
9. Performance criterion

## BLOCKED BY INFRASTRUCTURE

| Item | State |
|---|---|
| CUDA device | **GPU TRAINING BLOCKED — NO CUDA DEVICE** (Intel Iris Xe) |
| Training interpreter | Python 3.8.10 here; ≥ 3.10 required |
| GPU memory need, throughput, epoch time | TO BE BENCHMARKED — run the benchmark on the GPU machine first |

**GPU procedure** (on the GPU machine, in order):

1. Python ≥ 3.10 environment; CUDA torch matching the driver; `training/requirements-training.txt`.
2. `python scripts/check-training-environment.py` → TRAINING READY.
3. `python scripts/verify-training-manifest.py` → verified.
4. `python scripts/benchmark_detector_training_env.py` → exit 0; keep the JSON
   report (written under the gitignored `artifacts/training/benchmarks/`). It
   records peak allocated and reserved VRAM per batch size, throughput, which
   of 8/12/16/24 GB hold the configured batch at 80% headroom, and a
   lower-bound epoch time.
5. `python scripts/train_lung_detector.py --dry-run` → exit 4 until the
   decisions are approved; exit 0 only when every gate passes.
6. Training begins only after step 5 exits 0. Never automatically.

## NOT STARTED

| Item | Why |
|---|---|
| Historical orphan check on a live system | Needs the live reference list and storage inventory; this repository cannot tell whether live erasures occurred before `4acae2d`. **Historical orphan check required if prior live erasure requests occurred.** |
| Detector OOD reference | NOT YET BUILT — needs a detector |
| Detector calibration | NOT YET PERFORMED — needs a detector |
| Characteriser handoff | Intentionally unwired: no detector exists |
| Candidate review UI | Not built; the client has no detection-candidate view, so nothing implies a detector exists |
| `CARE_RELATIONSHIP_ENFORCE` | Unchanged: shadow mode (unset). DPIA R-02 open |

## Verification

Run at HEAD `dd95ea3`, disposable Postgres, inference service running for
`npm test`. Each exit code is the process's own, captured as it exited.

| Command | Exit | Result |
|---|---|---|
| `npm test` (full) | **0** | 346 passed, 0 failed, 0 cancelled, 3 skipped by design (no-service paths; `INFERENCE_URL` set) |
| `python -m pytest inference/tests` | **0** | 387 passed, 0 skipped |
| `python -m pytest training/tests` | **0** | 203 passed, 0 skipped |
| `npx tsc --noEmit` | **0** | clean |
| `npm run build` | **0** | built |
| `scripts/verify-training-manifest.py` | **0** | verified, fingerprint `f55f6cd5188ae3ee` |
| `scripts/check-training-environment.py` | 1 | TRAINING NOT AVAILABLE — expected |
| `scripts/train_lung_detector.py --dry-run` | 4 | HARNESS READY, TRAINING NOT AUTHORISED — expected |
| `scripts/benchmark_detector_training_env.py` | 2 | GPU TRAINING BLOCKED — NO CUDA DEVICE — expected |

Counts rose from the previous audit (328 / 382 / 167) by the tests added in
this phase: 18 TypeScript, 5 inference, 36 training.

## Training authorisation

| Condition | Status |
|---|---|
| Engineering checks pass | PASS — see Verification |
| All nine methodology decisions approved by a named owner | **NO** — nine PENDING, no owner |
| Training infrastructure | **NO** — no CUDA device |

**NO — BLOCKED.**
