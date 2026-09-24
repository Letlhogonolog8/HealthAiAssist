# Model card — lung nodule candidate detector

**Status: NO TRAINED MODEL. The architecture and the training harness exist;
no checkpoint has been produced.**

This card exists ahead of the model it describes, so that the claims a
detector would be allowed to make are fixed before there is a result to
rationalise. It is the same reason `docs/bars/p2.json` exists.

| | Status (24 September 2026) |
|---|---|
| Architecture | **implemented** — `training/model.py`, `lung-nodule-candidate-2p5d-cnn` `arch-v1`, 1,173,473 parameters, untrained |
| Training harness | **implemented** — `training/`, `scripts/train_lung_detector.py`; `docs/P2_TRAINING_READINESS.md` |
| Checkpoint | **absent** |
| Training result | **absent** — training refused on this machine (no CUDA) |
| Clinical validation | **absent** |
| External validation | **absent** |
| Calibration result | **absent** |
| OOD result | **absent** |
| Performance result | **absent** |
| Localisation methodology | **pending** |
| Performance bar | **not approved** |

| | |
|---|---|
| Model | none trained |
| Artifact | none |
| SHA-256 fingerprint | — |
| Registry entry | none — absent from `MODEL_REGISTRY` |
| Capability status | `PLANNED` |
| Model class | — |
| Validation status | **not started** |
| Clinically validated | **no**, and nothing here may say otherwise |

---

## Why there is no model

No trained checkpoint exists in this repository, and none can be trained on
the machine it runs on: `torch.cuda.is_available()` returns `False` and there
are no CUDA devices. Training a nodule detector on CPU is not a serious
proposition, and fabricating weights or metrics to fill the gap would be worse
than the gap.

So the model is a slot. `inference/detection_service.py` defines the interface
a detector would satisfy, the registry is empty, and a detection request
**refuses** with `model_unavailable` rather than returning an empty candidate
list.

## What is built

The engineering pipeline around the empty slot, tested end to end:

| Stage | Module |
|---|---|
| Series assembly, ordering, polarity | `inference/series.py` |
| Geometry validation, voxel ↔ patient LPS | `inference/geometry.py` |
| HU volume construction | `inference/volume.py` |
| Detector preprocessing | `inference/detection_preprocess.py` |
| Lung-region constraint | `inference/lung_mask.py` |
| Candidate proposal, merging | `inference/detection_service.py` |
| Run and candidate persistence | `server/detection.ts`, `migrations/detection-runs.sql` |
| API and clinician review | `server/routes.ts` |
| Training: dataset, sampling, augmentation | `training/series_loader.py`, `training/sampling.py`, `training/augment.py` |
| Training: architecture, loop, checkpoints | `training/model.py`, `training/trainer.py`, `training/checkpoint.py` |
| Training: gates | `scripts/check-training-environment.py`, `scripts/verify-training-manifest.py`, `scripts/train_lung_detector.py --dry-run` |

An architecture is not a detector. Until a checkpoint is trained, evaluated
under an approved localisation methodology and registered through
`docs/ML_CHANGE_PROCESS.md`, nothing in this table is evidence about
detection.

## Intended use, if a model is ever registered

**Research and internal validation only.** Proposing locations in a chest CT
series that a radiologist may wish to look at, for review by a qualified
clinician who decides what, if anything, is there.

The predicted event is **P(a radiologist marked a nodule at this location)**.
That is the only question the LIDC annotations can support.

## Not intended for, and must not be described as

- autonomous diagnosis
- cancer diagnosis or detection
- malignancy determination of any kind
- risk stratification or clinical triage
- treatment decisions
- replacement or substitution of clinician review
- any use on a patient outside a research protocol

The detector produces `score_raw` and, once calibration exists,
`score_calibrated`. It does not produce and has no field for: malignancy,
cancer, risk, priority, or a diagnosis. A candidate is a hypothesis, not a
finding.

## Dataset limitations

The intended training and validation data is LIDC-IDRI, held locally as 228
patients' series under `dataset/manifest-1600709154662`.

- The labels are **radiologist-derived research impressions**, not
  histopathological diagnosis. `scripts/lidc_build_labels.py` states this at
  length and the distinction must survive into every claim.
- A reference nodule means *a radiologist marked something here*. The ceiling
  is inter-reader agreement; a detector approaching it agrees with readers,
  not with the patient's condition.
- Sizes from `scripts/lidc_extract_diameters.py` are **reader-derived
  measurements** from hand-drawn boundaries, not segmentation ground truth.
- No demographic breakdown is possible: LIDC records sex for 29% of patients,
  age for 20%, ethnic group for 4%. This must be reported as not possible
  rather than omitted.
- LUNA16 is **not** in this repository. It is derived from LIDC, so a
  LUNA16-pretrained detector validated on local LIDC would partly measure
  memorisation. See `docs/P2_DATASET_DECISION.md`.

## Validation limitations

Nothing has been measured. There is no sensitivity, no false-positive rate, no
FROC curve, no calibration and no OOD performance, because there is no model.

When there is one, none of the following may be claimed without independent
evidence for that specific claim:

- clinical validation
- prospective validation
- histopathological validation
- radiologist-level performance
- medical-grade performance
- production readiness for clinical use

## What exists around the empty slot

None of this is evidence about a detector. It is the scaffolding that would
have to be in place before a figure could mean anything, and it is listed here
so that its presence is not mistaken for progress on the model itself.

| | |
|---|---|
| Patient-disjoint splits | `docs/splits/lidc-split-v1.json`, seed `healthai-lidc-split-v1`, fingerprint `f55f6cd5188ae3ee`, leakage audit clean |
| Local availability | `docs/splits/lidc-availability.json` — 229 of 748 series have pixel data here; the test split holds **126** nodules, not 244 |
| Evaluation arithmetic | `inference/detection_eval.py` — FROC, Wilson intervals, one-to-one matching, exclusion accounting. Never run on a detector output |
| Pre-registration | `docs/bars/p2.json`, `DRAFT_NOT_APPROVED` |

On 126 test nodules an observed sensitivity of 0.849 would carry a 95%
interval of 0.776–0.901, so **the available test split cannot demonstrate that
a 0.85 bar was met**. That is a property of the sample size, known before any
detector exists; it is not a result.

## Blocked before any evaluation can mean anything

1. **Localisation tolerance is undefined.** Deciding whether a candidate *is*
   a given reference nodule needs a rule. The sizes now exist in three forms —
   max in-plane diameter, equivalent-area diameter, slice span — and which one
   defines the tolerance is a methodology decision nobody has made. A
   sensitivity figure quoted without it is not interpretable. The options and
   the eight dimensions a decision must settle are in
   `docs/P2_LOCALIZATION_METHODOLOGY.md`, **STATUS: PENDING**.
2. **The performance bar is unapproved.** `docs/bars/p2.json` records
   `≥0.85 sensitivity at ≤4 FP/scan` as `approved: false`. It appears in the
   roadmap as an example, not a derivation, and is not an established clinical
   threshold.
3. **No training hardware.** The harness exists and its dry run passes every
   gate except the environment. No GPU: torch 2.1.0+cpu,
   `torch.cuda.is_available()` False, 0 CUDA devices, Intel Iris Xe
   integrated, 7.8 GB RAM. Measured on a 69,953-parameter toy 3D backbone at
   96³: 2.3 patches per second. A real 3D detector is two to three orders of
   magnitude more work. `docs/P2_TRAINING_FEASIBILITY.md`.
4. **No detector OOD reference.** The characteriser's cannot be reused: it is
   fitted on 224×224 RGB patch features, not volumes.
5. **No detector calibration.** A detector confidence and a malignancy
   probability are different quantities about different questions.

## Relationship to the nodule characteriser

They are separate models answering separate questions, and their outputs must
not be merged into one number.

The characteriser (`lung_nodule`, `INTERNAL_VALIDATION`, 97 held-out nodules
of which 29 malignant) answers *would a radiologist rate this marked nodule
malignant*. It runs only on a location a clinician has reviewed and chosen to
send, and keeps its own fingerprint, OOD screen and calibration.

A detected candidate must never be automatically characterised, and a
characterisation result must never be attributed to the detector.

## Governance

Registering a detector is a governance act, not a deployment step. It requires
a `MODEL_REGISTRY` entry, a `MEASUREMENT_BINDINGS` binding to the artifact's
SHA-256, a preprocessing version and fingerprint, a committed patient-disjoint
split manifest, the weight and training-data licences where a checkpoint is
adopted, and a validation record. See `docs/ML_CHANGE_PROCESS.md`.
