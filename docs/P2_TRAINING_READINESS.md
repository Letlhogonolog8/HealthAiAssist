# P2 detector: training readiness

24 September 2026. Branch `fix/remove-fabricated-ai-results`, from HEAD
`3479520`.

> **Training infrastructure: READY. GPU training: NOT EXECUTED. Detector
> checkpoint: ABSENT. Detector validation: NOT PERFORMED. Clinical validation:
> ABSENT.**
>
> Everything below is infrastructure. No detector was trained, no detector
> exists, and no performance figure of any kind was produced. The harness
> refuses to train the real detector on this machine, and it did refuse.

---

## Four states, never merged

| State | Meaning | Status |
|---|---|---|
| **IMPLEMENTED** | Code exists and its tests pass | Harness, sampling, augmentation, model architecture, checkpoints, manifests |
| **READY FOR GPU EXECUTION** | Every gate passes except the environment | Yes — `--dry-run` exits 3: harness ready, environment not available |
| **NOT YET VALIDATED** | No trained checkpoint has been evaluated | Everything — there is no trained checkpoint |
| **CLINICALLY UNVALIDATED** | No clinical evidence of any kind | Everything |

And for the model itself: **MODEL ARCHITECTURE** exists (randomly initialised,
1,173,473 parameters). **TRAINED CHECKPOINT** — absent. **VALIDATED RESEARCH
MODEL** — absent. **CLINICALLY VALIDATED MODEL** — absent.

---

## How to run it

```bash
# 1. Is this machine able to train?
python scripts/check-training-environment.py          # exit 0 TRAINING READY / 1 NOT AVAILABLE

# 2. Is the split intact?
python scripts/verify-training-manifest.py            # exit 0 verified / 1 invalid

# 3. Would training start? (never trains)
python scripts/train_lung_detector.py --dry-run       # exit 0 / 2 harness not ready / 3 environment / 4 not authorised

# 4. Train. Refuses unless every gate passes, including CUDA.
python scripts/train_lung_detector.py --config training/configs/lung_nodule_detector.yaml

# Pause after N epochs of this session; resume later from the same point.
python scripts/train_lung_detector.py --stop-after-epochs 10
python scripts/train_lung_detector.py --resume artifacts/training/experiments/<id>/checkpoints/last.pt

# Exercise the loop on synthetic data (CPU permitted; outputs are TEST_ARTIFACT).
python scripts/train_lung_detector.py --synthetic --epochs 2
```

On this machine, today:

```
  configuration  PASS  fingerprint c41cd181bf275118
  governance     PASS  localisation PENDING, bar DRAFT_NOT_APPROVED (training does not depend on either)
  manifest       PASS  split f55f6cd5188ae3ee verified, patient-disjoint
  availability   PASS  229 series with pixel data
  exclusions     PASS  dataset/lidc-annotation-exclusions.csv
  model          PASS  lung-nodule-candidate-2p5d-cnn, 1173473 parameters — UNTRAINED
  checkpointing  PASS  write/reload verified (probe, deleted)
  output         PASS  artifacts/training
  environment    FAIL  TRAINING NOT AVAILABLE: Python 3.8.10 is below the training minimum 3.10 ...
                       CUDA is not available (torch 2.1.0+cpu) ...

DRY RUN FAILED — HARNESS READY, ENVIRONMENT NOT AVAILABLE. TRAINING NOT EXECUTED.   (exit 3)
```

and the real command answers `TRAINING REFUSED — environment: ...` with exit 1.

**Since 2026-09-28** an `authorisation` gate sits before the environment: the
dry run on this machine now ends `DRY RUN FAILED — HARNESS READY, TRAINING NOT
AUTHORISED` (exit 4), because the nine decisions in
`docs/decisions/p2-training-authorisation.json` are PENDING. The output above is
the record from 24 September.

---

## Training environment

| | |
|---|---|
| Where | `training/` — imports `inference/`; nothing in `inference/` imports it (tested) |
| Interpreter | ≥ 3.10, the separate environment of `inference/py310/README.md`. The code stays 3.8-compatible so the existing suite covers it |
| Stack | `training/requirements-training.txt`; torch installed per the host's CUDA build |
| GPU | Required. CUDA, at least one device, ≥ 8 GB (INITIAL ENGINEERING FLOOR, not a measured requirement) |
| This machine | Python 3.8.10, torch 2.1.0+cpu, no CUDA, Intel Iris Xe, 8 cores, 7.8 GB — **TRAINING NOT AVAILABLE** |
| Python 3.10 here | `py -3.10` resolves to a Microsoft Store alias Windows refuses to launch; the environment has not been instantiated on this machine |

---

## Dataset

LIDC-IDRI, through the existing label pipeline. Research data; radiologist
annotations and malignancy *impressions*; **not** histopathology, **not** a
clinical diagnostic dataset. LUNA16 is not integrated.

| | |
|---|---|
| Split | `docs/splits/lidc-split-v1.json`, fingerprint `f55f6cd5188ae3ee`, pinned in the configuration |
| Patients | train 474 / validation 93 / calibration 71 / test 102 |
| With pixel data here | 229 of 748 series; test holds 126 of 244 nodules (`docs/splits/lidc-availability.json`) |
| Split changed? | No. No patient moved, none reassigned for being absent |

### What a positive and a negative are

- **Positive:** a patch centred on a nodule in `dataset/lidc-labels.csv`
  (≥ 3 mm, median rating not indeterminate). The malignancy label is ignored;
  benign-rated and malignant-rated nodules are both positives. The target
  means *a radiologist marked a nodule here* — not cancer, not malignancy,
  not risk.
- **Negative:** a patch centred on a lung-mask voxel at least 32 mm (INITIAL
  ENGINEERING DEFAULT) from **every** location any reader marked.
- **Ignore zone:** indeterminate (median-3) nodules, sub-3 mm nodules and
  non-nodule marks are never positives and never negatives.

The ignore zone needed a new index. The label table omits those three kinds
of annotation by design — it is a malignancy table — so sampling negatives
against it alone would put "background" examples on top of real nodules.
`scripts/lidc_build_annotation_exclusions.py` reads every mark in the XML:
**77,302 points across 1,018 series** (42,160 rated-nodule ROI points, 13,338
sub-3 mm, 21,804 non-nodule), covering all 229 locally available series. It
does not add positives: whether indeterminate or small nodules should be
detection *targets* is a dataset decision, left open.

The earlier off-nodule sampling in `scripts/lidc_whole_slices.py` excluded only
label-table nodules. That is the same gap, in pre-existing code, recorded here
rather than silently changed.

---

## Data integrity

| Check | Where | Behaviour |
|---|---|---|
| Six pairwise patient intersections | `training/manifest.verify` | All 0; any non-zero fails closed |
| Series or nodule in two splits | reuses `scripts/lidc_build_splits.audit_splits` | Fails closed |
| Manifest edited since built | fingerprint recomputed from contents | Fails closed |
| Different split substituted | pinned `expected_split_fingerprint` | Fails closed |
| Patient identity | must match `^LIDC-IDRI-\d{4}$` — a salted `2.25.` UID fails | Fails closed |
| Label row missing identity fields | `patient, series_uid, nodule_index, sop_uid, cx, cy, z` | Fails closed |
| Label position ambiguous | SOP must be in the series **and** its slice z within 0.51 mm of the recorded z | Row reported unresolved, never placed |

**Test protection.** `manifest.require_split(split, purpose)` is the one gate:
fit→train, select→validation, calibrate→calibration, evaluate→test, nothing
else. `TrainingDataset(split="test")` raises before any data exists;
`PatchDataset` checks again; the trainer checks again. Calibration data
cannot enter training and cannot be used for model selection. No flag disables
any of it.

---

## Preprocessing

The service's own path, imported, not copied:

```
DICOM → series.assemble / order_slices → quality_gate.evaluate_ct_series
      → volume.build_volume (HU, validated frame) → lung_mask.build_lung_mask
      → detection_preprocess (clip −1000..400 HU, scale to [0,1])
      → detection_service._extract_patch (3 × 64 × 64)
```

- **HU**, modality LUT only. Not the characteriser's 8-bit lung-window render.
- **Spacing** native: typically ~0.7 mm in plane, 1.25–3.0 mm through plane.
  No resampling — harness v1 refuses `resample_slice_spacing_mm` because it
  would require moving every label onto a new grid.
- **Coordinates**: DICOM patient LPS; voxel↔mm through the volume's
  `SeriesFrame`, checked against the PS3.3 formula in the tests.
- **Parity**: configuration validation refuses any preprocessing or patch
  value that differs from the service's `PreprocessConfig` / `DetectionConfig`,
  and a test asserts a training context is the service's own patch.

### The lung mask was excluding the nodules — v3 FAILS its own validation

> **Superseded in part by `docs/P2_LUNG_MASK_VALIDATION.md` (24 September
> 2026).** The per-nodule audit found that v3 fills 55–99% of the body
> cross-section in 10 of the 20 series below, through a ring of non-lung
> aerated-band material; the statement further down that the mediastinum "is
> not filled" is false for those series. 3 of v3's 72 retained centres depend
> on that fill (69/74 otherwise), and 14 of the 74 nodules are test-split, so
> this selection evidence also breaches test protection. v3 is **FAIL** as a
> training-region constraint. The text below is kept as the record of what
> was believed when `2f369e5` was committed.


Building the loader surfaced a defect in the committed search constraint.
The mask keeps the aerated band (−950 to −300 HU); a solid nodule is soft
tissue, so it is a **hole** in that band, and the 3-voxel dilation closes only
holes of about 4 mm. Under v1, any solid nodule wider than that had its centre
outside the mask — and `detect_candidates` never scores a window centred
outside it. On a synthetic phantom a 10 mm nodule fully inside aerated lung
had its centre excluded.

Measured on the first 20 locally available LIDC series (sorted source UID),
74 labelled nodules, 0 unresolved, 0 series refused — all three variants on the
same volumes:

| Mask | Labelled nodule centres inside | Mask voxels | vs v1 |
|---|---|---|---|
| v1 (committed before this work) | **55 / 74** (74.3%) | 186.7 M | — |
| v2 (four-direction enclosure; one commit, then replaced) | 73 / 74 (98.6%) | 335.1 M | +79% |
| **v3 (in-plane topological hole fill; current)** | **72 / 74** (97.3%) | 260.7 M | +40% |

**v2 was wrong, and the first commit said otherwise.** It filled any voxel
with lung on all four in-plane sides and claimed the mediastinum stayed out.
On the phantom it did. On real chest CT the heart often has lung in front,
behind and on both sides within one slice: the 74.4 M voxels v2 added beyond a
true hole fill averaged −40 HU and 93.4% were soft tissue. That is
mediastinum, and a search constraint that includes it has stopped
constraining. v2 was caught by this measurement before any detection run used
it.

v3 fills only background that cannot reach the slice edge through
4-connected background (`scipy.ndimage.binary_fill_holes`, per slice). A
nodule, vessel or airway wall surrounded by lung is filled; the mediastinum,
connected to the chest wall, is not. It misses two centres — one more than
v2 — where the lung outline is open toward the mediastinum; that is the price
of not searching the mediastinum, and it is stated rather than tuned away.
The 40% growth over v1 is the intrapulmonary vessels, airways and nodules
v1 had punched out of the lung; its composition was not separately measured.

Tests pin: nodules of radius 2, 5 and 8 px inside the mask (fail on v1); a
closed ring of lung is filled; **an open ring of lung around soft tissue is
not** (fails on v2 — the real-data failure, in phantom form); the space
between two separate lungs and the air outside stay out. The hole fill costs
about 1.6 s on a 133-slice series; the mask's existing pure-Python component
labelling dominates at 27–58 s depending on machine load. scipy was already
installed through scikit-learn and is now declared in
`inference/requirements.txt`. The version is persisted on every detection run
(`detection_runs.lung_mask_version`).

---

## Augmentation

`training/augment.py`, version `detect-augment-v1`, enabled for training only;
validation is never augmented.

| Transform | Bound | Target handling |
|---|---|---|
| In-plane shift | ±4 px, ≤ positive jitter (refused otherwise) | Target moves with the crop |
| In-plane rotation | ±10° (> 20° refused) | Target rotated with the same matrix as the pixels |
| HU offset / contrast / noise | ±20 HU / ±5% / σ 10 HU | Intensity only |
| Flip | **refused** — mirrors anatomy | — |
| Scale | **refused** — changes physical size | — |

All channels (adjacent slices) get one identical geometric transform. The
random stream per sample is derived from (seed, epoch, index) by hashing, so
it does not depend on batch order. Measured: over 400 random transforms the
bright-spot centroid sat within **0.007 px** of the returned target.

---

## Model

`training/model.py` — `lung-nodule-candidate-2p5d-cnn`, `arch-v1`: four
conv-BN-ReLU×2 + max-pool blocks (widths 32/64/128/256), global average pool,
dropout 0.2, one logit. **1,173,473 parameters.** Input (N, 3, 64, 64) — the
service's `score_batch` contract. Output: a *candidate score* (sigmoid of the
logit), uncalibrated. Not a probability of cancer, malignancy or anything
clinical.

The architecture fingerprint (`190fd102a78f7387…` for the shipped
configuration) covers the specification and parameter shapes, not the
weights.

---

## Training configuration

`training/configs/lung_nodule_detector.yaml`, `status:
INITIAL_ENGINEERING_DEFAULT`. **No value in it was selected by measurement.**
AdamW, lr 3e-4, weight decay 1e-4, cosine schedule, batch 128, 40 epochs,
early stopping patience 8, class balancing by `pos_weight`, 200 negatives per
series. Validation refuses: an unknown key, any governance claim the
repository does not record, LUNA16, a split other than train/validation, a
flip, a scale, a rotation above 20°, a shift above the jitter, preprocessing
that differs from the service, resampling, a target meaning that mentions
malignancy/cancer/risk/diagnosis, and any selection metric other than
validation loss. It contains no localisation tolerance of any kind.

Model selection is by **validation loss** only. Patch-level numbers are not
detection metrics and are not computed.

---

## Checkpoints and fingerprints

| | |
|---|---|
| Format | `healthai-lung-detector-checkpoint-v1`, `torch.save` dict |
| Contents | model, optimizer, scheduler and RNG state; metadata |
| Metadata (required) | `git_commit, dataset_fingerprint, split_fingerprint, model_fingerprint, preprocessing_fingerprint, training_config_fingerprint, environment_fingerprint, seed, epoch` |
| Identity | SHA-256 over every tensor's name, dtype, shape and bytes — recomputed on load, mismatch refused |
| File hash | SHA-256 in a sidecar `<name>.sha256.json` |
| Status | `TRAINED_UNVALIDATED` (real run) or `TEST_ARTIFACT` (synthetic). The harness cannot write, and by default refuses to load, `VALIDATED_RESEARCH_MODEL` or `CLINICALLY_VALIDATED` |
| Loading | `weights_only=True` — a tampered file cannot execute code |
| Location | `artifacts/training/experiments/<id>/checkpoints/{best,last}.pt`, gitignored along with `*.pt *.pth *.ckpt *.onnx`; back up with `npm run backup:models`, identify by fingerprint |
| Registration | **None.** The service's detector slot stays empty after training (tested); `lung-nodule-detection` stays PLANNED |

**Experiment manifest** (`…/<id>/manifest.json`, written at start, updated per
epoch, closed with the outcome): experiment id, git commit and dirty flag,
dataset / split / model / preprocessing / config / environment fingerprints,
label and augmentation versions, full configuration, seed, hardware,
per-epoch losses, checkpoint sidecars. It carries no patient ids, no UIDs
(series are a hash and a count), no coordinates, no host name — a test scans
for them.

The epoch count comes from the configuration only, so the recorded
configuration fingerprint is always the one trained under; a fingerprint that
does not match the configuration is refused.

---

## Reproducibility

Python, NumPy and torch seeded; `torch.use_deterministic_algorithms(True)`;
cuDNN autotuning off; each epoch's shuffle re-seeded from (seed, epoch).
Verified on CPU, synthetic data:

- same seed, same data → identical weights fingerprint and identical losses;
- different seed → different weights;
- a run paused after epoch 1 and resumed ends **bit-identical** to one run
  straight through.

That last property was broken in the first draft (see below) and is now
pinned. **Not claimed:** bitwise determinism on GPU. Some CUDA kernels have no
deterministic implementation; with deterministic algorithms requested, torch
raises rather than silently using one. Close agreement across GPU runs is
expected, identical results are not guaranteed.

---

## Boundaries — unchanged and enforced

| | Status |
|---|---|
| Detector evaluation | **Not performed.** `inference/detection_eval.rule_from_bar` still raises `MethodologyUndecided` |
| Localisation methodology | **PENDING** — `docs/P2_LOCALIZATION_METHODOLOGY.md` untouched |
| Performance bar | **DRAFT_NOT_APPROVED**, `approved: false` |
| Calibration | **Not performed** — no checkpoint. `training/calibration.py` fits temperature on the calibration split only; no record → `calibrated_score` is `None`, never the raw score |
| Detector OOD | **Not built.** `training/ood.py` defines the interface and four distinct outcomes — `OOD_REFUSED`, `INFERENCE_FAILED`, `ZERO_CANDIDATES`, `CANDIDATES_PROPOSED` — mapped onto the evaluator's scan states |
| Legacy lung model | Not touched, not referenced by any training file (tested) |

---

## Defects found and fixed while building this

1. **Lung mask excluded nodule centres** (`inference/lung_mask.py`). v1
   missed 19 of 74 on real data. My first fix (v2) recovered them but filled
   the mediastinum, which the same measurement exposed; v3 replaces it. Above.
2. **The `--epochs` override bypassed the configuration fingerprint.** A
   checkpoint could record a configuration it was not trained under, and a
   resumed run followed a different learning-rate schedule. Removed for real
   runs; `--stop-after-epochs` pauses without changing the schedule.
3. **Loader memory.** Holding every pixel-bearing DICOM object alongside the
   float32 volume roughly doubled peak memory; a background measurement died
   silently on a 260-slice series on this 7.8 GB machine. The objects are now
   released as soon as the volume exists.

---

## Verification (24 September 2026, HEAD `2f369e5`)

| Check | Result |
|---|---|
| Inference Python suite | 363 passed |
| Training harness suite | 167 passed |
| `npx tsc --noEmit` | exit 0 |
| `npx vite build` | exit 0 |
| `npm test` (disposable Postgres, `INFERENCE_URL` set) | 321 passed, 0 failed, 3 skipped by design (they cover the no-service path) |

`npm test` did not pass in one run. The full run exited 1: the first file,
`tests/adverse-events.test.ts`, had its registration hook return 500 after
117 s. The disposable database had just come back from a Docker VM restart
caused by memory pressure (0.3 GB free of 7.8 GB), and the hook's failure
cancelled that file's 14 tests. The remaining 307 passed. Re-run alone, the
file passed 14 of 14. The adverse-event path does not touch the lung mask.
The table above combines the two runs; it is not a single clean run.

---

## Remaining blockers

- **Compute:** no CUDA device; training interpreter not instantiated here.
- **Scientific / methodology:** localisation methodology PENDING; whether
  indeterminate and sub-3 mm nodules are detection targets is undecided; every
  configuration value is an engineering default.
- **Data:** 229 of 748 series on disk; 126 test nodules cannot demonstrate a
  0.85 bar (`docs/P2_TRAINING_FEASIBILITY.md`).
- **Governance:** performance bar not approved; dataset decision PENDING;
  LUNA16 not decided; licence review for any external weights.
- **Clinical:** none of the evidence a clinical claim needs exists.

## Follow-ups, deliberately out of scope

- `/healthz` still re-hashes about 276 MB of characteriser artifacts per call.
  The training harness does not touch the health path, so caching the digest
  on (path, mtime, size) was not done here. It remains a recorded follow-up.
- Mask construction costs 27–58 s per LIDC series (load-dependent), almost all of it the pure-Python component labelling; the v3 hole fill adds ~1.6 s. Sample sets
  are cached by definition fingerprint, so a GPU run pays it once.
