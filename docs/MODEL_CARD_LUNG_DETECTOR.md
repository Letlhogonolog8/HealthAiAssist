# Model card — lung nodule candidate detector

**Status: NOT IMPLEMENTED. There is no model.**

This card exists ahead of the model it describes, so that the claims a
detector would be allowed to make are fixed before there is a result to
rationalise. It is the same reason `docs/bars/p2.json` exists.

| | |
|---|---|
| Model | none |
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

## Blocked before any evaluation can mean anything

1. **Localisation tolerance is undefined.** Deciding whether a candidate *is*
   a given reference nodule needs a rule. The sizes now exist in three forms —
   max in-plane diameter, equivalent-area diameter, slice span — and which one
   defines the tolerance is a methodology decision nobody has made. A
   sensitivity figure quoted without it is not interpretable.
2. **The performance bar is unapproved.** `docs/bars/p2.json` records
   `≥0.85 sensitivity at ≤4 FP/scan` as `approved: false`. It appears in the
   roadmap as an example, not a derivation, and is not an established clinical
   threshold.
3. **No training infrastructure.** No GPU.
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
