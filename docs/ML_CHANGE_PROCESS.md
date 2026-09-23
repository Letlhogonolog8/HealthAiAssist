# ML change process

How a model gets from an idea to something this platform serves, and what has
to be written down **before** each step rather than after it.

Status: process document. It governs work; it is not application logic and
nothing imports it.

---

## Why this exists

The failure it prevents has already happened here once. The lung model's
out-of-distribution screen was measured against pydicom's bundled
`CT_small.dcm`, the four numbers looked decisive, and "the model refuses every
clinical acquisition" went into the model card, the application text, the
device-integration plan and the demo script. When the same screen was pointed
at real chest CT on 20 September 2026 it passed 84 of 87 slices. The model was
withdrawn the same day.

Nothing was fabricated. The measurement was real and the reasoning was
plausible. What was missing was a rule fixing *what would be measured, on what
data, against what bar* before anyone looked at a number — so that a result
could come out the wrong way and still be believed.

That is the whole purpose of this document: to make it impossible to choose
the evaluation after seeing the outcome.

---

## The rule

**Pre-registration.** For any model change, the dataset, the splits, the
metrics, the operating point and the acceptance bar are written to a versioned
file and committed **before** the evaluation runs. The evaluation then reports
against that file.

A bar that moves after a measurement is not a bar. If a pre-registered bar is
missed, the options are: do not ship, change the approach and re-register, or
record an explicit, reasoned exception naming who decided and why. Quietly
lowering the number is not among them.

`scripts/build-ood-reference.py` already works this way — it writes its
requirements into the reference and exits non-zero when they are not met, so
the failure is recorded by the script rather than by prose. That is the
pattern to follow.

---

## What must be recorded for every model change

### Identification

| Field | Meaning |
|---|---|
| Model change id | Stable identifier for this change |
| Modality / registry key | The `MODEL_REGISTRY` key it serves under, if any |
| Intended use | One sentence, in the form "given X, predicts Y" |
| What it does **not** answer | Explicit. See `lung_nodule_training.json.doesNotAnswer` |

### Data

| Field | Meaning |
|---|---|
| Dataset name and version | Including the manifest or subset identifier |
| Provenance | Where it came from, and under what licence |
| Label provenance | Who or what produced the labels, and what they mean |
| Split unit | **Patient**, unless there is a stated reason otherwise |
| Split seed and manifest | Committed, so the split is reproducible |
| Calibration split | Patient-disjoint from both train and test |
| OOD evaluation split | Patient-disjoint; both `accept` and `refuse` domains |
| Leakage checks performed | Named, with the identifier the check joined on |

Label provenance is not a formality. `dataset/lidc-labels.csv` holds
radiologist malignancy *ratings*, not diagnoses; `scripts/lidc_build_labels.py`
states the difference at length. Anything published must say which it used.

### Preprocessing

| Field | Meaning |
|---|---|
| Preprocessing version | Bumped whenever the rendering changes |
| Windowing / normalisation | Exact values, and whether training and serving share one implementation |
| Resampling | Target spacing and interpolation, or "none" |

Training and serving must go through the same code. `inference/nodule_patch.py`
exists because they did not, and `inference/tests/test_windowing_parity.py`
holds them together.

### Model

| Field | Meaning |
|---|---|
| Architecture and source | Including a pretrained checkpoint's origin |
| Artifact SHA-256 | The `model-fingerprint.ts` digest of the deployed file |
| Weight licence | For any external checkpoint |
| Training data licence | For any external checkpoint |
| Training procedure | Seed, epochs, augmentation, hardware |

### Evaluation

| Field | Meaning |
|---|---|
| Metrics | Defined precisely, including what counts as a match |
| Operating point | The threshold, and the rule that chose it |
| Chosen on | Validation. Never the test set |
| Confidence intervals | Wilson, as `server/production-performance.ts` already does |
| Subgroup breakdown | Where the data supports one; "not possible" where it does not |
| Acceptance bar | Pre-registered, with its status |

---

## Validation states

These are four different claims and must never be collapsed into one.

**Engineering complete.** The code runs, is tested, and does what its
specification says. No statement about clinical performance whatsoever.

**Research / internal validation.** Measured on a held-out split of the same
collection it was developed from, with intervals. This is where a model may
serve under `modelClass: INTERNAL_VALIDATION` and capability status
`VALIDATION`, with the evidence base and its limits stated wherever a figure
appears. The LIDC nodule characteriser is here: 97 held-out nodules, 29
malignant, a ±0.15 interval, ratings rather than histology.

**External validation.** Measured on data from a different source — a
different institution, scanner population and acquisition protocol — that
played no part in development. Nothing in this repository has reached this.

**Clinical validation.** A prospective investigation under an approved
protocol, with ethics approval, a pre-specified endpoint, and a reader study
where the claim involves assisting readers. Nothing here is close.

**Prohibited.** No model may be described as *clinically validated*,
*clinically safe*, *production-ready for clinical use*, *medical-grade* or
*radiologist-level* unless this repository contains the evidence for that
state. Absence of a negative finding is not evidence. Passing engineering
tests is not evidence.

---

## P2 detection: the proposed evaluation framework

P2 is **not implemented**. This section fixes how it would be evaluated, so
that the criteria exist before any number does.

### What is being predicted

**P(a radiologist marked a nodule at this location | this candidate).** That
is the only event the LIDC annotations support.

It is not sensitivity, not false positives per scan, and not malignancy. A
detection confidence and a malignancy probability are different quantities
about different questions, and the detector must never produce the second.

### Task

Candidate proposal with patient-space coordinates, for radiologist review. The
detector is a candidate generator for the existing characteriser, not a
verdict and not a diagnosis.

### Splits

Patient-level, committed as a manifest with its seed. Train, validation,
calibration and test are mutually patient-disjoint. The existing label
pipeline already splits by patient before any patch is written.

### Metrics

| Metric | Definition |
|---|---|
| Per-nodule sensitivity | A reference nodule is found if a candidate centre falls within the localisation tolerance |
| False positives per scan | Candidates not matching any reference, divided by scans |
| FROC | Sensitivity as a function of FP/scan |
| Localisation tolerance | **Requires the diameter work** — see below |
| Confidence intervals | Wilson, on every reported proportion |

Stratification where the data supports it: nodule size, slice thickness,
reconstruction kernel, and central versus peripheral. Where it does not — LIDC
records sex for 29% of patients, age for 20%, ethnic group for 4% — the report
must say "not possible from this dataset" rather than omitting it.

### Localisation tolerance

The conventional LUNA16 rule counts a detection as a hit when its centre lies
within the reference nodule's radius. That requires a per-nodule diameter.
`dataset/lidc-labels.csv` carries centroids and no diameter;
`scripts/lidc_extract_diameters.py` derives one from the reader contours that
`scripts/lidc_build_labels.py` already parses and discards.

Until diameters are available and their convention agreed, the localisation
tolerance is **undefined**, and any sensitivity figure quoted without one is
not interpretable.

### Proposed gate

> ≥0.85 per-nodule sensitivity at ≤4 false positives per scan

**Status: PROPOSED — REQUIRES PROJECT DECISION OR EXTERNAL BENCHMARK
JUSTIFICATION.**

This figure appears in `docs/AUDIT_AND_ROADMAP_2026-09-20.md` as an example
("e.g."), not as a derivation. It is **not** an established clinical
threshold, **not** taken from a regulatory standard, and **not** yet justified
against a published benchmark. It is recorded here so that a bar exists to
argue about before a measurement exists to rationalise.

Before it is used as an acceptance criterion, someone must either cite a
benchmark that justifies it or decide it deliberately and record who decided.
See `docs/bars/p2.json`.

### Leakage

LUNA16 is a subset of LIDC-IDRI. A LUNA16-pretrained detector evaluated on
local LIDC series is evaluated partly on its own training data, and the
resulting figure would be meaningless in a way that looks like success.

If LUNA16 is ever used, overlapping series must be excluded **before**
evaluation, joined on **source** SeriesInstanceUIDs from the dataset
manifests. The platform's stored UIDs are salted HMAC remaps
(`inference/uid_remap.py`) and are deliberately not reversible, so they cannot
be the join key. No overlap list exists in this repository, and an empty one
must not be created to stand in for the check.

### Ceiling

The reference standard is what radiologists marked. A detector cannot exceed
inter-reader agreement on this data, and a figure approaching it indicates
agreement with readers, not with the patient's condition.

---

## Reproducibility

Every published figure must be reproducible from the repository: the command,
the artifact digest, the dataset version and the split manifest. The model
cards already carry reproduction commands and `MEASUREMENT_BINDINGS` binds
published figures to the deployed artifact's SHA-256, failing closed on drift.
A figure that cannot be reproduced is withdrawn, not footnoted.

---

## Related

- `docs/MODEL_GOVERNANCE.md` — registry, bindings, promotion
- `docs/MODEL_CHANGELOG.md` — what changed, including what got worse
- `docs/REGULATORY_PATHWAY.md` — intended use and the regulatory position
- `docs/AUDIT_AND_ROADMAP_2026-09-20.md` — the phase plan
- `docs/bars/p2.json` — the P2 pre-registration artifact
