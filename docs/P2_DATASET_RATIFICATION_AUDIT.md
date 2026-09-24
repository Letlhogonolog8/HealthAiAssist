# P2 dataset — ratification audit

24 September 2026. HEAD at time of writing: `c7e8880`.

> **Dataset methodology: PENDING DECISION.** The label table, split and
> leakage controls are verified below. Two label-identity questions (§5)
> and ratification of the dataset decision itself (`docs/P2_DATASET_DECISION.md`;
> listed as "also pending ratification" in `docs/P2_LOCALIZATION_METHODOLOGY.md`)
> need an owner's decision. Nothing in this audit modified the
> label pipeline, the label table or the split.

Research identifiers only: LIDC patient ids (`LIDC-IDRI-nnnn`). No DICOM UID
appears in this document.

---

## 1. Dataset source

| | |
|---|---|
| Collection | LIDC-IDRI (TCIA), CC BY 3.0 — citation in `dataset/lung_nodule_model/lung_nodule_training.json` |
| Local copy | `dataset/manifest-1600709154662`: 229 CT series with pixel data, 228 patients, 217 annotation XML files |
| Label table | `dataset/lidc-labels.csv`: 1,703 nodules, 748 series, 740 patients |
| Built from | The full TCIA annotation download (1,319 XML files, 1,018 annotated series). **That download is not on this machine**; only the 217 XML files alongside the local DICOM are. Whole-table reader statistics below are therefore quoted from `docs/P2_DETECTOR_READINESS_REPORT.md`, and the local re-derivation covers 207 series |
| LUNA16 | Not present, not integrated (`docs/P2_DATASET_DECISION.md`) |

---

## 2. Label methodology (`scripts/lidc_build_labels.py`, unmodified)

| Item | What the code does |
|---|---|
| Source annotations | `unblindedReadNodule` entries with a `characteristics` block and malignancy 1–5, from each XML's four `readingSession`s |
| Nodules < 3 mm | No characteristics in LIDC → skipped (not treated as benign) |
| Non-nodules | Not in the label table. Indexed separately, with < 3 mm nodules and rated-nodule ROI points, by `scripts/lidc_build_annotation_exclusions.py` (77,302 points) for negative sampling |
| One file per series | Byte-identical copies collapsed; a file named as a correction supersedes; any other disagreement is taken as the fullest file and reported as AMBIGUOUS |
| Per-reading centroid | Mean over that reading's ROIs of each ROI's edge-point mean; z is the mean ROI z |
| Nodule identity | **Greedy single-link clustering against each cluster's first reading**, threshold 12 on a distance mixing in-plane pixels with z in mm (§4) |
| Label | Median of the cluster's ratings: > 3 "malignant", < 3 "benign", = 3 excluded |
| `n_readers` | Number of **readings** in the cluster — not distinct readers (§5) |
| `agreement` | Fraction of readings on the median's side of 3 |
| Stored centre | **One reader's** contour centroid on that reader's middle slice — the reading with the most ROI slices. Not a consensus centre |

**Diameters** (`scripts/lidc_extract_diameters.py`, unmodified) reuse the same
parser filters and clustering, so `nodule_index` joins exactly (identity
divergence 0, per the readiness report). Per reading: longest chord of any
contour (`max_in_plane_diameter`), diameter of a circle with the area of the
largest contour (`equivalent_area_diameter`), and the z range of contours
(`slice_span_mm`, not a diameter). Aggregated by median across readings. mm
only when PixelSpacing was read from the DICOM; never assumed. 995 nodules
measured across 207 series. **Reader-drawn measurements, not segmentation
ground truth.**

---

## 3. Ground-truth language

Checked across `docs/`, `docs/bars/p2.json`, `MODEL_CARDS.md`, `README.md` and
`client/src`. Every mention of histopathology, biopsy, diagnosis or ground
truth in connection with LIDC is a negation ("not histopathology", "not a
clinical diagnosis", "not segmentation ground truth"). The mentions in
`client/src/components/outcome-review-panel.tsx` are the clinician
outcome-recording form, which is where real diagnostic outcomes are meant to
be entered — not LIDC. **PASS.**

The description used throughout, and the one to keep: *radiologist-derived
research annotations and malignancy impressions.* A "reference nodule" means a
radiologist marked something at that location.

---

## 4. Reader clustering

The clustering compares each reading only to the **first** reading of each
existing cluster, and accepts it within 12 units, where the units are pixels
in-plane and millimetres in z. Consequences, observed on the local 207 series:

- A cluster's members can be up to about twice the threshold apart from each
  other; the largest spread seen is 19.1 (LIDC-IDRI-0404, cluster 1).
- Nothing stops two readings from the **same reader** joining one cluster.
- Results depend on reading order, which is the order in the XML.

The code states the pixel/mm mix openly (`cluster`, docstring) and
`--match-mm` must match between the label and diameter scripts or identity
diverges.

---

## 5. Multi-reader anomalies

**Where the 5 / 6 / 7 figures come from.** Readings per cluster on the local
207 series (`servicingRadiologistID` is `anon` in 151 of 217 files, so the
reader is identified by reading-session position — every local file has
exactly four sessions):

| Readings in cluster | All clusters | Label-table clusters |
|---|---|---|
| 1 | 298 | 196 |
| 2 | 189 | 160 |
| 3 | 159 | 92 |
| 4 | 346 | 279 |
| 5 | 1 | 1 |
| 6 | 1 | 0 |
| 7 | 1 | 0 |

The 6- and 7-reading clusters have median rating 3 and are excluded from the
label table; they exist only among all clusters. Whole-table (1,703 nodules,
from the readiness report): 1: 439, 2: 386, 3: 230, 4: 643, **5: 5**; no 6 or 7.

**Every cluster with more than four readings, and four with fewer, holds two
readings from one reading session** — seven clusters locally:

| Patient | Cluster | Readings | Distinct readers | In label table | Ratings | Median | Max spread |
|---|---|---|---|---|---|---|---|
| LIDC-IDRI-0204 | 0 | 5 | 4 | yes | 4\|3\|5\|5\|4 | 4 | 13.8 |
| LIDC-IDRI-0481 | 0 | 6 | 4 | no (median 3) | 1\|3\|3\|3\|3\|2 | 3 | 11.6 |
| LIDC-IDRI-0404 | 1 | 7 | 4 | no (median 3) | 5\|3\|3\|4\|4\|3\|2 | 3 | 19.1 |
| LIDC-IDRI-0060 | 2 | 3 | 2 | yes | 5\|4\|5 | 5 | 14.1 |
| LIDC-IDRI-0879 | 4 | 2 | **1** | yes | 2\|1 | 1.5 | 12.0 |
| LIDC-IDRI-0707 | 4 | 2 | **1** | yes | 2\|2 | 2 | 10.7 |
| LIDC-IDRI-0188 | 7 | 2 | **1** | yes | 2\|2 | 2 | 8.1 |

**What they are.** Inherited from the existing clustering, not from the XML:
each reader marked the lesions separately, and the 12-unit single-link rule
merged two of one reader's marks. Two readings from one reader in one cluster
is either two nearby lesions merged into one identity, or one lesion that
reader recorded twice. The XML alone does not say which, and this audit does
not guess.

The three rows with **one** distinct reader are the ones the existing
"5 readers" check could not see: they appear in the table as 2-reader nodules
with `agreement` computed over two ratings that are one radiologist's. The
five-reader row reported earlier is one of seven, not the whole problem.

**Would changing the clustering change established identity?** Yes. Any fix
(one reading per reader per cluster; a true mm distance; complete-link) can
split or merge clusters, which renumbers `nodule_index` within a series,
changes `n_readers`, `agreement` and possibly the median label, and changes
which nodules exist. `nodule_index` is the join key to the diameters and to
anything keyed on it. The split is patient-level and would not move.

**Decision required — PENDING DECISION.** For the affected nodules, whether
the training and evaluation datasets:

1. **preserve** them as the label table has them (current behaviour);
2. **exclude** them from positives and from the evaluation denominator, keeping
   them in the negative-sampling exclusion zone;
3. **re-derive** identity under a corrected clustering, as a new label version
   (`label_version` is `lidc-labels-median-rating-v1` in the training
   configuration), with the full-archive XML re-acquired to do it.

Scope of the effect in the local data: 5 of 728 label-table clusters on the
207 series with XML here. The full-table count needs the full XML download.

---

## 6. Patient-disjoint split

`docs/splits/lidc-split-v1.json`, HMAC-SHA256 of the source LIDC patient id,
seed `healthai-lidc-split-v1`. Not regenerated, not modified.

`python scripts/verify-training-manifest.py` — exit 0:

```
fingerprint     f55f6cd5188ae3ee (recomputed f55f6cd5188ae3ee, pinned f55f6cd5188ae3ee)
patient intersections: all six pairs 0
MANIFEST VERIFIED — patient-disjoint, fingerprint pinned, identities are source LIDC ids
```

Independently recomputed from the manifest and the label table for this
audit: 0 series in more than one split, 0 duplicate `(series, nodule_index)`
keys, 0 label-table patients without an assignment. **PASS.**

---

## 7. Pixel-data availability

Recomputed from `docs/splits/lidc-availability.json` and the label table;
matches `docs/bars/p2.json` exactly.

| Split | Patients | Series | With pixels | Without | Nodules | Nodules with pixels |
|---|---|---|---|---|---|---|
| train | 474 | 482 | 149 | 333 | 1,083 | 518 |
| validation | 93 | 93 | 27 | 66 | 208 | 90 |
| calibration | 71 | 71 | 21 | 50 | 168 | 88 |
| test | 102 | 102 | 32 | 70 | 244 | 126 |
| **total** | **740** | **748** | **229** | **519** | **1,703** | **822** |

No series with pixel data is outside the label table. This is a data
limitation, not a detector result. The split was **not** changed to enlarge
any set. The consequence already recorded in the bar stands: 126 test nodules
cannot distinguish an observed sensitivity near 0.85 from one near 0.90 at
95% confidence. That is a statement about the sample, not about a detector.

---

## 8. Leakage controls

| Path | Control | Evidence |
|---|---|---|
| Training reads train only | `manifest.require_split(split, "fit")` → `{train}` | `training/dataset.py:135`, `training/trainer.py:82` |
| Model selection reads validation only | `require_split(split, "select")` → `{validation}` | `training/trainer.py:86`; selection metric is validation loss |
| Calibration | `require_split(split, "calibrate")` → `{calibration}` | `training/calibration.py:75` |
| Test | Reachable only for `"evaluate"` | `training/manifest.py:56-61`; refusals tested in `training/tests/test_safety.py` and `training/tests/test_manifest.py` |
| Augmentation | Operates on samples already produced by a split-gated dataset | `training/dataset.py:96,175,257` re-check the split |
| Negative sampling | Per loaded series of the gated split; exclusion points are looked up by series | `training/sampling.py` |
| Threshold selection | None exists in the harness; `detection_eval.operating_point` is evaluation machinery and has never been run | `docs/bars/p2.json` `evaluationMachinery.hasEverBeenRunOnADetectorOutput = false` |

**Code-level test protection: PASS.**

**Methodology-level finding: FAIL.** The lung-mask measurement that chose v3
over v2 (commit `2f369e5`) used the first 20 locally available series sorted
by source UID, without regard to split. **4 of those 20 series (14 of the 74
nodules) belong to test-split patients.** No model was fitted to them and no
threshold was chosen on them, but a preprocessing decision that governs where
the detector searches was measured partly on test data, which
`docs/ML_CHANGE_PROCESS.md` does not permit. `docs/P2_LUNG_MASK_VALIDATION.md`
reports the non-test and test results separately. Remediation, stated not
performed: repeat the mask selection evidence on train and validation series
only, and record the test-inclusive measurement as superseded.

---

## 9. Ground-truth limitations

- Malignancy labels are reader impressions; no histopathology is used.
- Presence labels are "a radiologist marked this"; the ceiling is inter-reader
  agreement, and 1-reader nodules are 439 of 1,703.
- Centres are one reader's contour centroid, not a consensus position.
- Sizes are reader-drawn boundaries, not segmentation.
- Demographics: sex 29%, age 20%, ethnic group 4% of patients
  (`docs/bars/p2.json`); no demographic stratification is possible.

---

## 10. Open decisions

| Decision | Status |
|---|---|
| Ratify LIDC label pipeline as the P2 dataset (`docs/P2_DATASET_DECISION.md`) | PENDING DECISION |
| Handling of same-reader clusters (§5): preserve, exclude, or re-derive | PENDING DECISION |
| Whether indeterminate (median-3) and < 3 mm nodules are detection targets | PENDING DECISION (recorded in `docs/P2_TRAINING_READINESS.md`) |
| Re-derivation of mask-selection evidence without test-split series | PENDING — engineering action, see §8 |
| LUNA16 | NOT INTEGRATED; any use requires a decision and an overlap exclusion |
