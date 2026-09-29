# P2 localisation methodology — decision record

**STATUS: PENDING.** No tolerance has been chosen, and this document does not
choose one. It sets out what the decision is, what evidence exists for it, and
what a decision would have to specify, so that the choice is made deliberately
rather than inferred from whichever number made a result look best.

Recorded 23 September 2026.

---

## The decision required

When a detector proposes a candidate location, something has to decide whether
that candidate *is* a given annotated nodule. Without that rule there is no
sensitivity, no false-positive count and no FROC curve — every one of them
depends on it, and a figure quoted without it is not interpretable.

It is a methodology decision, not an engineering one. The evaluator is built
and waiting for the rule; it will not invent one.

---

## What the repository already fixes

A candidate is a **point**, not a box or a mask:

| | |
|---|---|
| Voxel | `voxel_i`, `voxel_j`, `voxel_k` |
| Patient space | `x_mm`, `y_mm`, `z_mm`, `coordinate_system = dicom_patient_lps` |
| Reviewable slice | `position_index` |
| Score | `score_raw`, `score_calibrated` (null until calibration exists) |

A reference nodule is a **centroid plus size measurements**, from
`dataset/lidc-labels.csv` and `scripts/lidc_extract_diameters.py`:

| Measurement | Measured on 995 nodules across 207 series |
|---|---|
| `max_in_plane_diameter_mm` | min 2.59, median 7.92, max 56.11 |
| `equivalent_area_diameter_mm` | min 1.79, median 6.28, max 32.66 |
| `slice_span_mm` | min 0.00, median 4.50, max 60.00 |

All three are **reader-derived measurements** from hand-drawn boundaries, not
segmentation ground truth. Their spread across readers is preserved per nodule
rather than collapsed.

Because both sides are points in the same frame, the natural family of rules
is a distance in millimetres between the candidate centre and the nodule
centroid. What that distance should be is the open question.

---

## Candidate methodologies

None is endorsed here. Each is stated with what it would commit the project to.

**A. Fixed radius.** A candidate matches if its centre is within a constant
distance, say *r* mm, of the centroid. Simple and stable across nodule sizes.
It treats a 3 mm nodule and a 30 mm mass identically, which is generous to the
small ones and strict on the large.

**B. Nodule radius.** A candidate matches if its centre falls inside the
reference nodule, using half of one of the measured diameters. This is the
conventional LUNA16-style rule. It requires choosing *which* diameter — max
in-plane, or equivalent-area — and those differ by roughly 1.6 mm at the
median, which is not a rounding difference.

**C. Nodule radius with a floor.** As B, with a minimum so that a nodule
measured at 2.59 mm does not demand sub-millimetre localisation. Requires both
choices: the diameter and the floor.

**D. Slice-aware.** Separate in-plane and through-plane tolerances, because
LIDC slice spacing runs 1.0–3.0 mm and a candidate one slice away is a
different error from one 3 mm away in-plane. More faithful to the anisotropy;
two numbers to justify instead of one.

---

## Dimensions a decision must settle

Whichever family is chosen, the rule is incomplete until each of these is
written down:

1. **Distance basis** — fixed, or derived from which measured diameter.
2. **Aggregation across readers** — the per-nodule median is the existing
   convention for malignancy; whether size follows it is a separate choice.
3. **Floor and ceiling**, if any.
4. **One-to-one matching.** If two candidates fall inside one nodule, one is a
   hit and the other must be defined as a duplicate or a false positive —
   greedy nearest-first is the usual resolution and needs stating.
5. **One candidate near two nodules.** Which reference it is assigned to, and
   whether the other counts as missed.
6. **Reader-agreement threshold.** LIDC nodules carry `agreement` from 0.50 to
   1.00. Whether low-agreement nodules are references, excluded, or reported
   separately changes the denominator.
7. **Size inclusion.** Whether nodules below some size are references at all.
   LIDC marks nodules under 3 mm as a point with no contour, so 267 such
   median-indeterminate nodules already sit outside the label table.
8. **Exclusions** — what is removed from the denominator and why.

---

## Evidence available for the decision

- Size distribution over 995 nodules, in three measurement conventions.
- Per-reader spreads, retained rather than averaged away.
- Reader agreement per nodule.
- Slice spacing per series, 1.0–3.0 mm across the local collection.
- The published LUNA16 convention exists as a reference point but is **not**
  automatically applicable: LUNA16 is not in this repository, and adopting its
  rule is itself a decision to record.

## Evidence not available

- No consensus segmentation, so no volumetric overlap criterion.
- No histopathology; the references are radiologist impressions.
- No local inter-reader localisation study to say what tolerance readers
  themselves agree within.

---

## What happens until this is decided

`scripts/validate-detector-on-lidc.py` reports **BLOCKED** and exits non-zero.
`docs/bars/p2.json` records the tolerance as `BLOCKED`. No sensitivity or
FP/scan figure may be produced or quoted, and the detector cannot move past
`PLANNED` on the strength of a number that has no matching rule behind it.

## Known exposure of the test split — must be disclosed with any evaluation

Four test-split series — LIDC-IDRI-0481, -0447, -0951 and -0059, holding 14
nodules — were inspected during lung-mask development (v2 → v3 selection
and the v3 failure diagnosis). No model or threshold was fitted to them. How
they are treated in the formal evaluation is decision 2 of
`docs/P2_TRAINING_GATE_DECISION_REGISTER.md`, still PENDING. Until it is
decided, any evaluation protocol must name these series and state the
treatment applied.

The stages are kept distinct, and so is the use made of the test split in each:

| Stage | What it is | Test split used? |
|---|---|---|
| Exploratory inspection | Looking at images and annotations to understand the data | **Yes, once:** the 4 series above, during lung-mask work |
| Methodology development | Choosing the mask, preprocessing and sampling | v2 → v3 used them; v4 measured on train and validation only |
| Model training | Fitting weights | Never; refused in code (`require_split`) |
| Threshold and model selection | Choosing a checkpoint or operating point | Never; validation only |
| Final evaluation | One pre-registered run on the test split | Not yet performed |

## Decision

```
STATUS:        PENDING
DECIDED BY:    —
DECIDED ON:    —
METHODOLOGY:   —
JUSTIFICATION: —
```

This block is filled in by a project or clinical-methodology owner. It is not
filled in by inference from the data above, and an implementation may not
proceed on an assumed value.

---

## Related

- `docs/ML_CHANGE_PROCESS.md` — pre-registration rule
- `docs/bars/p2.json` — the machine-readable record
- `docs/P2_DATASET_DECISION.md` — dataset, also pending ratification
- `scripts/lidc_extract_diameters.py` — where the sizes come from
- `scripts/validate-detector-on-lidc.py` — what stays blocked
