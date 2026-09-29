# P2 detector — onboarding a GPU machine, and what every run records

28 September 2026.

> **This machine cannot train.** It has no CUDA device, Python 3.8.10 and
> torch 2.1.0+cpu. `scripts/benchmark_detector_training_env.py` exits 2:
> GPU TRAINING BLOCKED — NO CUDA DEVICE. Nothing in this document changes
> that, and nothing here authorises training (`docs/decisions/README.md`).

The order is fixed:

1. **Environment** — `check-training-environment.py` → TRAINING READY.
2. **Benchmark** — `benchmark_detector_training_env.py` → exit 0, report kept.
3. **The nine owner decisions** — each APPROVED and signed in
   `docs/decisions/p2-training-authorisation.json` (`docs/decisions/README.md`).
4. **Authorisation** — `train_lung_detector.py --dry-run` → exit 0.
5. **Training** — only then, as a deliberate command.
A benchmark comes before any real run, so that the hardware choice rests on a
measurement.

---

## 1. Evidence to collect from the training machine

Every item comes from a command. None is to be copied from a specification
sheet.

| Area | Item | Source |
|---|---|---|
| Hardware | GPU model, GPU count, VRAM per GPU | benchmark JSON `environment.gpus` |
| | CPU model, core count | `environment.cpuModel`, `environment.cpus` |
| | System RAM | `environment.systemMemoryGB` |
| | Free disk at the repository | `environment.diskFreeGB` |
| Software | OS | `environment.os` |
| | Python | `environment.python` (must be ≥ 3.10) |
| | PyTorch, CUDA, cuDNN | `environment.torch`, `cudaVersion`, `cudnnVersion` |
| Benchmark | Peak GPU memory allocated and reserved, per batch size, for a training step and for inference | `measurements[]` |
| | Throughput (patches/s), training and inference | `measurements[]` |
| | Tensor shape per step | `measurements[].inputShape` |
| | Whether 8 / 12 / 16 / 24 GB hold the configured batch at 80% headroom | `sufficiency` (present only when measured) |
| | Lower-bound time per epoch and for the configured epochs | `projection` |
| Storage | Samples per epoch, sample-cache size, checkpoint size, DICOM on disk | `estimates` |

Measured on this machine, for reference only: train 30,318 and validation
5,490 samples per epoch; sample cache 2.08 GB; checkpoints 0.026 GB; DICOM
18.6 GB in 37,970 files (229 series). The rest of LIDC-IDRI, if the dataset
decision calls for it, is about 60 GB more.

**8 GB is an engineering floor in `training/environment.py`, not a measured
requirement.** Whether it is enough is what the benchmark's `sufficiency`
answers, from the peak reserved memory of the configured batch.

## 2. The procedure

On the GPU machine, from a clean checkout of the approved commit:

```bash
# 1. Environment: Python >= 3.10, CUDA torch matching the driver
python3.10 -m venv .venv-train && . .venv-train/bin/activate
python -m pip install torch --index-url https://download.pytorch.org/whl/cu121   # match the driver
python -m pip install -r training/requirements-training.txt
python scripts/check-training-environment.py          # exit 0, TRAINING READY

# 2. Data and split: copy the 229 LIDC series and the gitignored label tables
python scripts/verify-training-manifest.py            # exit 0, fingerprint f55f6cd5188ae3ee

# 3. Benchmark: random tensors only; trains nothing
python scripts/benchmark_detector_training_env.py --json benchmark.json   # exit 0

# 4. Gate check: never trains
python scripts/train_lung_detector.py --dry-run       # exit 4 until authorised; 0 when every gate passes
```

Keep `benchmark.json` with the run's records. Steps 1–4 may be done before
the decisions are made. **Training (`python scripts/train_lung_detector.py`)
happens only after step 4 exits 0**, as a deliberate command, never
automatically.

## 3. What every training run records

Each run writes an experiment manifest under the gitignored
`artifacts/training/experiments/<id>/`. Recorded automatically
(`training/experiment.py`):

| Field | Content |
|---|---|
| `git` | Commit, and whether the tree was dirty |
| `dataset_fingerprint`, `dataset` | Manifest, labels, exclusions, decision record, preprocessing and sampling, hashed together |
| `split_fingerprint` | The patient split |
| `label_version` | From the configuration |
| `training_config`, `training_config_fingerprint` | The whole configuration, and its hash |
| `preprocessing_version`, `preprocessing_fingerprint` | HU window and normalisation, matched to the service |
| `augmentation_version`, `augmentation` | Transforms and their seed |
| `model_version`, `model_spec`, `model_fingerprint` | Architecture |
| `seed` | Optimisation seed |
| `hardware` | GPUs (model, memory), CUDA version, CPU count, RAM |
| `environment`, `environment_fingerprint` | Python and package versions |
| `started`, `finished` | UTC timestamps |
| `provenance.lung_mask_version` | e.g. `lung-threshold-v4` |
| `provenance.geometry_source_sha256` | SHA-256 of `geometry.py`, `series.py`, `volume.py`, `lung_mask.py`, so any change to the geometry code shows in the record |
| `provenance.sampling_version`, `provenance.seeds` | Sampling version; sampling, augmentation and optimisation seeds |
| `provenance.authorisation` | SHA-256 of the authorisation record, and each decision's id, status, owner, role and date |
| `provenance.performance_bar` | SHA-256 of `docs/bars/p2.json`, its status, whether the gate is approved |
| `provenance.localisation_methodology` | SHA-256 of the methodology record, the tolerance status and the machine-readable rule |
| `checkpoint` | Written on completion, with status `TRAINED_UNVALIDATED` |

No completed training record exists. The provenance fields are tested on a
synthetic run (`training/tests/test_authorisation.py`), which records the real
state: every decision PENDING, the gate not approved, the tolerance BLOCKED.

## 4. After training

A trained checkpoint is **not** a detector anyone may use. It stays
`TRAINED_UNVALIDATED` until the approved evaluation has run on the test split
under the approved localisation rule and performance criterion, with detector
OOD and calibration built, and the model card, registry and governance
binding are completed under `docs/ML_CHANGE_PROCESS.md`. Serving code does
not load from the training artifact tree; a test pins that.
