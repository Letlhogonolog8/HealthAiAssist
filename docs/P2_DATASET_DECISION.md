# P2 detection: dataset decision

Recorded 23 September 2026, before any detector work. This is a decision
record, not an implementation.

---

## Decision

**P2 preparation uses the existing LIDC-derived label pipeline. LUNA16 is not
integrated and will not be, unless a later project decision explicitly selects
it and records the reasoning.**

---

## Why

**LUNA16 is not in this repository.** `git grep LUNA16` matches one file:
`docs/AUDIT_AND_ROADMAP_2026-09-20.md`, where it appears as a plan. There is
no LUNA16 directory on disk and no manifest. It is a proposal, not an asset,
and the roadmap must not be read as evidence that it is present.

**What is present is enough to start.** `dataset/lidc-labels.csv` holds 1,703
nodules across the LIDC-IDRI collection, already reconciled across up to four
readers, already split by patient, with the median-3 indeterminate cases
excluded rather than forced to a side. 228 patients' series are on disk,
19 GB. `scripts/lidc_extract_diameters.py` now derives the per-nodule size the
localisation tolerance needs from contours that were already being parsed and
discarded — no download.

**LUNA16 is derived from LIDC-IDRI.** They are not independent collections. A
detector pretrained on LUNA16 and then evaluated on local LIDC series is
partly evaluated on its own training data, and the resulting sensitivity would
look like success while measuring memorisation. This is the single strongest
reason to keep the two apart until someone has decided deliberately to bring
them together.

**Licensing has to be verified, not assumed.** LIDC-IDRI is CC BY 3.0, and
that is recorded with its citation in
`dataset/lung_nodule_model/lung_nodule_training.json`. LUNA16 is a separate
redistribution with its own terms, and any pretrained checkpoint carries a
third set — the weight licence — plus whatever the data those weights were
trained on requires. **Licence terms must be verified before any external
dataset or model artifact is used or redistributed here.** Nothing in this
document is a legal conclusion, and none of these terms has been reviewed.

---

## If LUNA16 is selected later

These are requirements on that future work, not things done now.

**Overlap must be excluded before evaluation, on source identifiers.** The
join key is the **source** SeriesInstanceUID as it appears in the dataset
manifests — the values in `dataset/lidc-labels.csv`, not anything in the
application database.

The stored UIDs cannot be used. `inference/uid_remap.py` maps them through a
salted HMAC to a `2.25.` UUID-derived root specifically so that they are not
reversible to the source PACS. That property is the point of the de-
identification and must not be weakened to make a dataset join convenient.
The overlap check belongs entirely in the offline pipeline, on the dataset
manifests, outside the serving path.

**No placeholder overlap list.** An empty file standing in for the check is
worse than no file: it would make a leaking evaluation look audited. The list
is created when LUNA16 is actually acquired, from its actual manifest, or not
at all.

**The exclusion runs before measurement, not after.** An overlap discovered
after a figure exists is an invitation to rationalise the figure.
`docs/ML_CHANGE_PROCESS.md` requires the split and its leakage checks to be
committed before the evaluation runs.

---

## What the LIDC labels are, and are not

Worth restating because it bounds every claim P2 can make.

The labels are **radiologist impressions**, not diagnoses.
`scripts/lidc_build_labels.py` says so at length: LIDC ships malignancy
ratings from up to four readers, not biopsy or follow-up outcomes. The Patient
Diagnoses file carries genuine diagnosis-level truth for a limited subset and
is deliberately not used.

For detection specifically, a reference nodule means **a radiologist marked
something here**. The ceiling is inter-reader agreement. A detector that
approaches it agrees with readers; it says nothing about what the patient
turned out to have.

Sizes from `scripts/lidc_extract_diameters.py` are **reader-derived
measurements** from hand-drawn boundaries — not segmentation ground truth, and
not a validated measurement of anything.

---

## Related

- `docs/ML_CHANGE_PROCESS.md` — pre-registration, splits, leakage, validation states
- `docs/bars/p2.json` — the P2 pre-registration artifact
- `docs/AUDIT_AND_ROADMAP_2026-09-20.md` — Part B2, the P2 plan
- `scripts/lidc_build_labels.py` — how the labels were derived
- `scripts/lidc_extract_diameters.py` — how the sizes are derived
