# P2 lung mask — validation audit (lung-threshold-v3)

24 September 2026. HEAD at time of measurement: `c7e8880` (mask code from
`2f369e5`, not modified by the measurement).

> **Update 25 September 2026 — v4.** §12 below: the defect found here is
> fixed in `lung-threshold-v4` and re-measured on train and validation series
> only. v4 removes the engineering FAIL; approving it as the training
> constraint remains a **PENDING DECISION**. Sections 1–11 are the v3 audit
> as recorded.
>
> **Verdict (v3): FAIL as a training-region constraint.** v3 does not keep the
> mediastinum out. In 10 of 20 audited series its hole fill fills most of the
> body cross-section, because non-lung material in the aerated HU band closes
> a ring around the patient. The claim in `2f369e5` and in
> `inference/lung_mask.py` that "the mediastinum … is not filled" was checked
> only for the case where the ring is open, and is false for these series.
> **Decision required: PENDING DECISION** on a corrected mask (§11).
> No approval is given or implied here.

Research identifiers only (LIDC patient ids, nodule_index). No DICOM UID
appears in this document. The measurement scripts and raw output were kept
outside the repository; the procedure is described in full so it can be
repeated.

---

## 1. What v3 is for — and is not

A **candidate-search region constraint**: an answer to "could a candidate
here plausibly be in the lung", used (a) at serving time to restrict where
`detect_candidates` scores windows, and (b) in training, to restrict where
**negative** patches are drawn (`negatives_within_lung_mask: true`). Positive
patches are **kept even when their centre is outside the mask**
(`training/sampling.py:108-112`), so the mask does not remove labelled
nodules from training; it makes them structural misses at serving time.

It is **not** a clinical lung segmentation, **not** an anatomically accurate
segmentation, **not** a diagnostic segmentation, and must never be shown as an
organ boundary or used for a volume. The module docstring says the same.

---

## 2. Current implementation (`inference/lung_mask.py`, v3)

| Step | What the code does | Parameters |
|---|---|---|
| HU check | Refuses if `min(volume) > -100` (not Hounsfield units) | — |
| Threshold | `aerated = -950 ≤ HU ≤ -300` | `LUNG_HU_MIN/MAX` |
| Components | Per slice, 4-connected, two-pass union–find (pure Python) | 2-D only |
| Component selection | Keep components with area ≥ 0.5% of the slice **and** touching **fewer than two** frame edges | `MIN_COMPONENT_FRACTION = 0.005` |
| Plausibility | Refuse if the kept fraction of the volume is < 0.01 or > 0.70 | computed **before** hole fill and dilation |
| Hole fill | Per slice, `scipy.ndimage.binary_fill_holes` (4-connected background): fill background not connected to the slice edge | 2-D only |
| Dilation | In-plane, 3 iterations of 4-neighbour shifts (a diamond of radius 3 voxels, 1.6–2.3 mm at the spacings here) | `DILATION_VOXELS = 3` |
| Out-of-field | Remove voxels < −1100 HU (reconstruction padding) after dilation | `OUT_OF_FIELD_HU` |
| Failure | `LungMaskUnavailable(code, message)`; never an empty mask | `not_a_volume`, `empty_volume`, `not_hounsfield_units`, `implausibly_small/large_lung_region` |

Assumptions: the array is (slices, rows, columns) in HU from
`inference/volume.py`; no spacing is used anywhere — component size is a
fraction of the slice and the dilation is in voxels, so the physical dilation
varies with pixel spacing (0.55–0.78 mm here); slices are processed
independently; nothing is resampled.

**Cross-check.** The audit re-implemented the stages to observe each one, and
verified the replica against the committed `build_lung_mask` voxel-for-voxel
on the first three series (identical). A first replica diverged because adding
numpy booleans is a logical OR, so its edge count never reached two; the
committed code uses `.item()` and counts correctly. The cross-check caught
this before any number below was recorded.

---

## 3. Sample

The first 20 locally available LIDC series sorted by source UID — the same 20
used for the v1/v2/v3 comparison in `2f369e5`. 74 labelled nodules, all 74
resolved to a voxel (SOP present and slice z within 0.51 mm), 0 series
refused. Annotation XML was available for 19 of 20 series (not ordinal 5), and
every cluster reproduced the label table's identity (0 mismatches).

**Split membership — a test-protection finding.** 11 train, 3 validation,
2 calibration and **4 test** series (ordinals 4, 5, 8, 14); **14 of the 74
nodules are test-split**. The v2→v3 choice was therefore measured partly on
test data. Results are split out below; see
`docs/P2_DATASET_RATIFICATION_AUDIT.md` §8.

Scanners and reconstruction: GE (55 nodules), Siemens (10), Philips (5),
Toshiba (4); kernels STANDARD, BONE, B31f, B31s, B45f, D, FC01; slice spacing
1.0 mm (9 nodules), 1.25 (17), 2.5 (38), 3.0 (10). Nothing is claimed beyond
these.

---

## 4. The v2 failure

**Operation.** v2 added any voxel with kept lung somewhere to its left, right,
above and below in the same slice (cumulative OR along both in-plane axes, in
both directions). That is not a topological test: the heart and mediastinum
have lung on all four sides in most mid-thoracic slices while still being
connected to the chest wall, so v2 filled them.

**Evidence, same 20 series.** Voxels v2 adds beyond v3, before dilation:
**82.0 M, mean −74.8 HU, 90.8% above −300 HU** (per-series soft-tissue share
0.38–0.99). Measured on the final dilated masks (the figure in `2f369e5`):
74.4 M, mean −40 HU, 93.4%. Both definitions say the same thing. Total mask:
v1 186.7 M, v2 335.1 M (+79%), v3 260.7 M (+40%) voxels.

**Why v3 was expected to avoid it.** A true hole fill fills only background
that cannot reach the slice edge; the mediastinum reaches it through the
chest wall.

**Whether v3 introduces another failure mode: yes — §8.**

---

## 5. 74-centre retention — 72/74 reproduced

| | Centres inside |
|---|---|
| v1 | 55 / 74 |
| v2 | 73 / 74 |
| **v3** | **72 / 74** — reproduced exactly |
| v3, excluding centres inside only because a body-scale hole was filled (§8) | **69 / 74** |

By split:

| | n | v1 | v2 | v3 | v3 excluding body-scale fill |
|---|---|---|---|---|---|
| train + validation + calibration | 60 | 45 | 60 | 60 | 57 |
| test | 14 | 10 | 13 | 12 | 12 |

**How v3 includes the 72:** 16 centres lie in aerated lung, 49 in filled holes
(3 of them body-scale), 7 only after the dilation. Among included centres the
median in-plane distance to the mask edge is 20.4 mm; 2 are within 2 mm. The
distances are **inflated in the 10 series of §8**: where the body is filled,
the nearest mask edge is the body outline, not the lung (e.g. 79–130 mm for
LIDC-IDRI-0118 nodules 2–5, whose own holes are filled legitimately). They are
not evidence of margin.

The full per-nodule table is in the appendix.

---

## 6. The two excluded nodules

Both are in **test-split** series. Every pipeline stage was evaluated at the
centre voxel.

**LIDC-IDRI-0481, nodule 5** — "malignant" (ratings 4|4|2, 3 readings).
Voxel (383, 425, 125); patient (82.2, −81.9, −178.5) mm. Siemens B45f, 1.0 mm.

| Evidence | Value |
|---|---|
| HU at centre | 33 (soft tissue) |
| Aerated / kept / after fill / after dilation | no / no / no / no |
| Signed distance to the v3 edge | −0.86 mm |
| Background component holding the centre | reaches the slice edge; 192,255 voxels, mean −297 HU |
| Distance to edge-connected non-lung tissue | 0 mm |
| Size | eq.-area 7.6 mm, max 9.2 mm, span 4.0 mm; texture 5 (solid); calcification absent |
| Reader-contour area inside v3 | 83.9% |
| v1 / v2 | excluded / **included** |

*Why excluded:* in this slice the nodule's tissue is continuous with non-lung
tissue that reaches the slice edge, so it is not a hole and is not filled; its
centre is 0.86 mm beyond the 3-voxel dilation. *Pleural or mediastinal:* the
measurement shows contact with edge-connected tissue and does not distinguish
chest wall from mediastinum. *Juxtavascular:* not assessable without vessel
segmentation. *Expected:* yes — the juxtapleural/juxtamediastinal case the
dilation exists for, and 3 voxels is not enough for it. *Danger for
training:* none directly (positives are kept); at serving time, a guaranteed
miss.

**LIDC-IDRI-0951, nodule 0** — "benign" (ratings 1|4|1|1, 4 readings).
Voxel (32, 266, 52); patient (−117.7, 160.3, −688.8) mm. Philips D, 1.0 mm.

| Evidence | Value |
|---|---|
| HU at centre | 858 (calcific) |
| Aerated / kept / after fill / after dilation | no / no / no / no |
| Signed distance to the v3 edge | −5.19 mm |
| Background component holding the centre | reaches the slice edge; 226,393 voxels, mean −512 HU |
| Distance to edge-connected non-lung tissue | 0 mm |
| Size | eq.-area 15.5 mm, max 19.0 mm, span 16.0 mm; texture 5; calcification median 3 |
| Reader-contour area inside v3 | 45.5% |
| v1 / v2 | excluded / excluded |

*Why excluded:* a large calcified nodule, in-plane continuous with
edge-connected tissue, 5.2 mm beyond the dilation; column 32 of 512 places it
at the lateral periphery of the image. v1 and v2 excluded it too.
*Expected:* yes, for the same reason. *Danger:* a serving-time structural
miss.

**Correction to the code comment.** `inference/lung_mask.py` said the two
missed centres "sit where the lung outline is open toward the mediastinum".
That was written before this measurement. The evidence is contact with
edge-connected non-lung tissue; which tissue is not established. The comment
is corrected in the same change as this report.

**Safe algorithmic correction?** A larger dilation would include the first
(0.86 mm short) and not obviously the second, and admits more chest wall
everywhere. That is a trade-off — a methodology choice, not a safe fix.

---

## 7. Boundary and retention analysis

LIDC has no nodule segmentation ground truth, and none was invented from
diameters. What exists is each reader's drawn **contour**. "Contour area in
v3" is the fraction of the union of all readers' contour interiors, on the
slices they drew, that falls inside the mask: how much of what readers
outlined is searchable. Reader-drawn, not ground truth.

| Group | n | v1 | v2 | v3 | Contour area in v3, median / min |
|---|---|---|---|---|---|
| eq.-area < 6 mm | 36 | 35 | 36 | 36 | 1.000 / 0.972 |
| 6–10 mm | 15 | 12 | 15 | 14 | 1.000 / 0.645 |
| ≥ 10 mm | 19 | 4 | 18 | 18 | 1.000 / 0.455 |
| no contour of ≥ 3 points | 4 | 4 | 4 | 4 | — |
| centre touching edge-connected tissue | 9 | 7 | 8 | 7 | 0.985 / 0.455 |
| 0–5 mm from it | 8 | 8 | 8 | 8 | 1.000 / 0.806 |
| 5–15 mm | 15 | 13 | 15 | 15 | 1.000 / 0.645 |
| > 15 mm | 42 | 27 | 42 | 42 | 1.000 / 0.911 |
| texture 5 (solid) | 53 | 37 | 52 | 51 | 1.000 / 0.455 |
| texture 1 (ground glass) | 3 | 3 | 3 | 3 | 1.000 / 1.000 |
| calcified (median < 6) | 14 | 12 | 13 | 13 | 1.000 / 0.455 |
| HU at centre ≥ 200 | 12 | 10 | 11 | 11 | 1.000 / 0.455 |
| slice 1.0 mm | 9 | 6 | 8 | 7 | 1.000 / 0.455 |
| slice 1.25 mm | 17 | 16 | 17 | 17 | 1.000 / 0.857 |
| slice 2.5 mm | 38 | 24 | 38 | 38 | 1.000 / 0.911 |
| slice 3.0 mm | 10 | 9 | 10 | 10 | 1.000 / 0.645 |

v1's losses were concentrated in large nodules (4 of 19 retained) and in solid
nodules away from the chest wall — the hole defect. v3's residual losses are
peripheral: both misses, and the lowest contour retention, are nodules
touching edge-connected tissue. The 1.0 mm group holds both misses but only 9
nodules from 2 series; slice thickness is confounded with series and is not a
finding. Juxtavascular status, atelectasis, scarring and abnormal anatomy are
**not identifiable** from the data used and were not assessed.

---

## 8. New failure mode: body-scale hole fill

**Observation.** In 10 of the 20 series — ordinals 0, 1, 6, 7, 10, 12, 13,
14, 16, 19 (5 train, 2 validation, 2 calibration, 1 test) — the hole fill adds
holes of 29,000–79,000 mm² (series medians) covering **55–99% of the body
cross-section**, with mean contents of about 0 to +50 HU: heart, mediastinum
and chest wall. They account for **79.5 M of the 95.7 M voxels** (83%) that
v3's fill adds across all 20 series, in 28–191 slices per affected series.
Hole sizes were measured on six series first: in two of them 87–92% of the
fill was in holes over 5,000 mm²; in the other four, all fill was in holes
under 5,000 mm² and averaged −388 to −980 HU (airways, vessels, nodules).

**Mechanism.** Component selection keeps any aerated-band component touching
fewer than two frame edges. In these slices, material in the −950…−300 HU
band that is not lung passes that test and, with the lungs, closes a ring
around the body. The enclosing components (series medians): −805 to −870 HU,
1–3 components, **5–77% of their area outside the body outline** (body = the
largest region above −500 HU, holes filled), 1–6% in the body's outer
6-pixel band. The material outside the body is consistent with padding,
blankets or clothing; this audit did not identify it and does not claim to.
v1 already kept the same components — its search region already included
non-lung material outside the patient — but without a fill they stayed thin.
The fill turns the ring into the whole body.

**Why the existing guards did not catch it.** The 0.70 plausibility ceiling is
applied to the kept region **before** the fill; the fill is unbounded. The
tests pin an open ring (not filled) and a closed ring **of lung** (filled);
none has a closed ring formed by non-lung material.

**Effect on the retention figure.** 3 of the 72 retained centres
(LIDC-IDRI-0260 nodule 3, calibration; LIDC-IDRI-0118 nodules 0 and 1,
validation) are inside only because a body-scale hole was filled. Excluding
them: 69/74, and 57/60 non-test.

**Effect on training and serving.** Negatives are sampled inside the mask, so
in these series they would come from heart, mediastinum and chest wall — no
longer a lung constraint. At serving, the search in those slices is
effectively unconstrained. This is the failure v3 was introduced to remove.

---

## 9. Failure modes

| # | Failure | Evidence | Status |
|---|---|---|---|
| F1 | Body-scale fill through a non-lung ring | §8; 10 of 20 series | **open — FAIL** |
| F2 | Juxtapleural/juxtamediastinal nodules beyond the dilation | §6; 2 of 74 | limitation; a correction is a methodology trade-off |
| F3 | Non-lung components outside the body kept by the edge rule | §8; pre-existing in v1 | open |
| F4 | Plausibility ceiling checked before fill and dilation | code; §8 | open |
| F5 | Physical dilation varies with pixel spacing | code (voxels, not mm) | limitation |
| F6 | 2-D only; no through-plane consistency | code | limitation |
| F7 | Pure-Python labelling: 30 s to 10 min per series here | timings | engineering cost |
| F8 | Selection evidence includes test-split series | §3 | **FAIL** for test protection |

---

## 10. Limitations of this audit

20 series, 4 manufacturers, local LIDC only; 74 nodules, 14 of them
test-split. Reader contours are not segmentation. Anatomical labels (pleural,
mediastinal, vascular) were not assigned because the data do not support
assigning them. Ordinal 5 has no annotation XML locally, so its 4 nodules lack
contour and characteristic columns.

---

## 11. Training-use recommendation and decision required

**v3 must not be used as the training negative-sampling region or the serving
search constraint as it stands.** Status: **FAIL**.

A methodology owner will need to decide whether a *corrected* mask is approved
as the candidate-search constraint. That decision needs, and does not yet
have:

1. A corrected component selection or fill that cannot enclose the body. Candidate
   engineering fixes, none implemented: discard kept components lying mostly
   outside the body outline; fill holes within each lung component rather
   than across the kept set; apply the plausibility ceiling to the filled
   mask. A closed non-lung ring must be a failing test first.
2. Selection evidence measured on **train and validation series only**, with
   the test-inclusive measurement in `2f369e5` recorded as superseded.
3. A stated position on F2 (dilation radius against chest-wall admission).

`MASK_VERSION` stays `lung-threshold-v3` until then. No detection run and no
training run has used it: there is no detector, and training has not been
executed.

---

## 12. v4 — the fix, measured on train and validation only

**Change** (`inference/lung_mask.py`, `MASK_VERSION = "lung-threshold-v4"`).
Before components are found, the aerated band is restricted to the patient's
body, per slice: the largest region above −500 HU with its holes filled
(`_body_region`, `BODY_HU`). Lung is enclosed by the chest wall and so lies
inside it; bedding and padding lie outside it and can no longer form a ring.
Everything else — threshold, component rule, hole fill, dilation, padding
removal — is unchanged.

**Tests first.** A body wrapped in a ring of −800 HU material, touching the
skin or 1 voxel off it: under v3 the mediastinum and chest wall were filled
and the ring itself searched (4 tests fail on v3); under v4 neither. Guards:
both lungs survive the wrap, and a nodule inside a wrapped lung is still
filled. The phantom's lung discs were reduced from radius 12 to 10 because at
12 they broke through the 1-voxel body margin into outside air — a chest with
no lateral wall — and the ceiling test gained a chest wall so that it still
reaches the ceiling rather than the floor. Neither changes what is asserted.

**New limitation, pinned by a test.** Lung that touches air outside the body
in a slice — a missing chest wall, or the reconstruction circle cutting the
chest — is treated as outside the patient and dropped
(`test_lung_open_to_the_air_outside_the_body_is_not_searched`). Not observed
in the 30 series below (no centre lost; the voxels dropped are at the skin),
but those are 30 series.

**Evidence.** The first 30 locally available series whose patients are in
**train (25) or validation (5)**, sorted by source UID; the script refuses any
other split. 106 nodules, all resolved. The v3 and v4 replicas used for
measurement were checked voxel-for-voxel against the real builders on the
first two series.

| | v3 | v4 |
|---|---|---|
| Nodule centres inside | 104 / 106 | **104 / 106** (the same two) |
| Series with fill holes ≥ 5,000 mm² | 15 | 2 |
| Voxels in such holes | 83.5 M | **0.047 M** (4 slices) |
| Mask voxels | 352.8 M | 171.1 M (48.5%) |
| Share of the mask inside the body outline | 74.1% | **99.9%** (lowest series 99.5%) |
| Mean HU of the mask | −589 | −754 |
| Fill contents | — | 12.7 M voxels, mean −819 HU, 17% above −300 HU |

A quarter of v3's mask — and of v1's, which kept the same components — was
outside the patient. v4 is about half v3's size mostly for that reason.

**What v4 drops inside the body** (kept by v3, not by v4), by depth below the
body surface, on the four series with the largest per-slice loss
(LIDC-IDRI-0052, -0366, -0824, -0006): 63–86% within 2 mm of the skin and
≥ 98% within 10 mm, mean −400 to −470 HU — skin and subcutaneous partial
volume, not lung (about −800 HU). At most 3,425 voxels (0.8%, LIDC-IDRI-0052)
lie 10–20 mm deep, mean −479 HU; they are fragments below the size floor that
v3 kept only because they were joined to the outer ring. What they are
anatomically was not established.

**The two centres both versions miss** are LIDC-IDRI-0749 nodules 2 and 4
(train), at 161 and 1,859 HU — dense or calcified, inside the body outline,
outside the dilated mask. That is limitation F2 (§6, §9): juxtapleural or
juxtamediastinal nodules beyond a 3-voxel dilation.

**Residual.** 47,267 voxels of fill in holes ≥ 5,000 mm² remain in 4 slices of
2 series (LIDC-IDRI-0052, -0822). Not characterised here.

**Status after v4.**

| Failure (§9) | After v4 |
|---|---|
| F1 body-scale fill | fixed on this evidence; residual 0.047 M voxels |
| F3 non-lung components outside the body | fixed (99.9% of the mask inside the body) |
| F4 ceiling checked before the fill | unchanged; no longer load-bearing for F1 |
| F2, F5, F6, F7 | unchanged |
| F8 test-contaminated selection evidence | v4 selection evidence is train + validation only; the v3 diagnosis that motivated it saw 4 test series |
| new: lung open to outside air is dropped | pinned by a test; not observed here |

**Decision still required — PENDING DECISION:** whether v4 is approved as the
candidate-search and negative-sampling constraint, with F2 (dilation radius)
and the open-lung limitation stated. No approval is given here.

---

## Appendix — per-nodule table (v3 audit, 20-series sample)

"How v3 includes it": *aerated lung* — centre in a kept aerated component;
*hole fill* — in a filled hole of ordinary size; **body-scale hole** — only
inside a hole covering most of the body (§8); *dilation only* — only after the
3-voxel dilation. HU at the centre voxel. Eq.-area diameter is the median
across readers of reader-drawn contours. Texture and calcification are median
LIDC reader characteristics (texture 1 = ground glass … 5 = solid;
calcification 6 = absent). "Contour area in v3" is defined in §7. The
4 nodules of ordinal 5 (no local annotation XML) show — in the
contour-derived columns.

| # | Patient | Nod. | Split | Label | Readings | Voxel (i,j,k) | Patient mm (x,y,z) | HU | Eq.-area mm | Texture | Calc. | Slice mm | v1 | v2 | v3 | How v3 includes it | Signed dist. to v3 edge mm | Contour area in v3 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | LIDC-IDRI-0182 | 0 | train | benign | 4 | (353, 290, 77) | (80.6, 56.0, -149.0) | 13 | 10.4 | 5.0 | 6.0 | 2.5 | **no** | yes | yes | hole fill | 15.4 | 1.000 |
| 2 | LIDC-IDRI-0182 | 1 | train | benign | 2 | (139, 291, 57) | (-69.9, 56.7, -199.0) | 49 | 6.9 | 5.0 | 6.0 | 2.5 | **no** | yes | yes | hole fill | 18.9 | 1.000 |
| 3 | LIDC-IDRI-0182 | 2 | train | benign | 1 | (160, 366, 55) | (-55.1, 109.4, -204.0) | -111 | 6.0 | 5 | 6 | 2.5 | yes | yes | yes | hole fill | 20.4 | 1.000 |
| 4 | LIDC-IDRI-0187 | 0 | validation | malignant | 4 | (353, 280, 121) | (104.1, 20.6, -92.0) | -9 | 21.0 | 5.0 | 6.0 | 2.5 | **no** | yes | yes | hole fill | 99.2 | 1.000 |
| 5 | LIDC-IDRI-0187 | 1 | validation | benign | 2 | (382, 307, 95) | (129.0, 43.8, -157.0) | -408 | 9.1 | 1.0 | 6.0 | 2.5 | yes | yes | yes | aerated lung | 92.8 | 1.000 |
| 6 | LIDC-IDRI-0187 | 3 | validation | benign | 1 | (148, 332, 97) | (-72.1, 65.3, -152.0) | -617 | 5.4 | 5 | 6 | 2.5 | yes | yes | yes | aerated lung | 99.5 | 1.000 |
| 7 | LIDC-IDRI-0334 | 0 | train | benign | 2 | (121, 274, 106) | (-100.7, 11.8, 660.0) | -209 | 5.6 | 5.0 | 6.0 | 3.0 | yes | yes | yes | dilation only | 7.1 | 1.000 |
| 8 | LIDC-IDRI-0334 | 3 | train | benign | 2 | (133, 210, 73) | (-91.7, -36.2, 561.0) | -372 | 5.9 | 3.0 | 6.0 | 3.0 | yes | yes | yes | aerated lung | 31.4 | 1.000 |
| 9 | LIDC-IDRI-0334 | 4 | train | malignant | 3 | (203, 265, 58) | (-39.2, 5.0, 516.0) | -179 | 10.3 | 4 | 6 | 3.0 | yes | yes | yes | hole fill | 8.0 | 0.966 |
| 10 | LIDC-IDRI-0334 | 5 | train | benign | 2 | (123, 396, 53) | (-99.2, 103.2, 501.0) | -312 | 6.9 | 3.5 | 6.0 | 3.0 | yes | yes | yes | aerated lung | 5.2 | 1.000 |
| 11 | LIDC-IDRI-0721 | 0 | train | benign | 2 | (307, 291, 78) | (35.7, 26.7, -140.2) | -355 | 4.7 | 3.5 | 6.0 | 2.5 | yes | yes | yes | aerated lung | 5.8 | 1.000 |
| 12 | LIDC-IDRI-0721 | 2 | train | benign | 1 | (75, 287, 85) | (-141.0, 23.6, -122.7) | -127 | 4.2 | 5 | 6 | 2.5 | yes | yes | yes | dilation only | 2.3 | 1.000 |
| 13 | LIDC-IDRI-0721 | 3 | train | benign | 1 | (390, 267, 89) | (99.0, 8.4, -112.7) | -552 | 4.6 | 5 | 6 | 2.5 | yes | yes | yes | aerated lung | 20.0 | 1.000 |
| 14 | LIDC-IDRI-0481 | 1 | test | benign | 3 | (413, 263, 81) | (100.4, -180.0, -222.5) | 43 | 6.4 | 5 | 6 | 1.0 | yes | yes | yes | hole fill | 22.5 | 1.000 |
| 15 | LIDC-IDRI-0481 | 2 | test | benign | 3 | (170, 450, 96) | (-46.8, -66.7, -207.5) | 79 | 5.0 | 5 | 6 | 1.0 | yes | yes | yes | hole fill | 7.7 | 1.000 |
| 16 | LIDC-IDRI-0481 | 3 | test | malignant | 4 | (132, 427, 113) | (-69.8, -80.7, -190.5) | -76 | 9.8 | 4.5 | 6.0 | 1.0 | yes | yes | yes | hole fill | 15.4 | 1.000 |
| 17 | LIDC-IDRI-0481 | 5 | test | malignant | 3 | (383, 425, 125) | (82.2, -81.9, -178.5) | 33 | 7.6 | 5 | 6 | 1.0 | **no** | yes | **no** | **excluded** | -0.9 | 0.839 |
| 18 | LIDC-IDRI-0447 | 0 | test | malignant | 4 | (434, 275, 68) | (50.5, 42.6, -109.0) | -471 | � | � | � | 1.25 | yes | yes | yes | aerated lung | 7.2 | � |
| 19 | LIDC-IDRI-0447 | 2 | test | benign | 1 | (102, 268, 98) | (-131.7, 38.8, -71.5) | -689 | � | � | � | 1.25 | yes | yes | yes | aerated lung | 6.7 | � |
| 20 | LIDC-IDRI-0447 | 3 | test | benign | 1 | (380, 293, 133) | (20.9, 52.5, -27.8) | 54 | � | � | � | 1.25 | yes | yes | yes | hole fill | 13.3 | � |
| 21 | LIDC-IDRI-0447 | 4 | test | benign | 1 | (411, 199, 71) | (37.9, 0.9, -105.2) | 1113 | � | � | � | 1.25 | yes | yes | yes | dilation only | 4.7 | � |
| 22 | LIDC-IDRI-0772 | 0 | calibration | malignant | 3 | (333, 326, 113) | (47.3, 36.1, -101.2) | 34 | 29.6 | 5 | 6 | 2.5 | **no** | yes | yes | hole fill | 31.6 | 0.911 |
| 23 | LIDC-IDRI-0772 | 1 | calibration | malignant | 4 | (197, 194, 114) | (-59.0, -67.0, -98.8) | 19 | 18.5 | 4.5 | 6.0 | 2.5 | **no** | yes | yes | hole fill | 22.6 | 1.000 |
| 24 | LIDC-IDRI-0124 | 0 | train | benign | 1 | (427, 253, 52) | (126.1, -2.3, -181.2) | -401 | 3.7 | 1 | 6 | 2.5 | yes | yes | yes | aerated lung | 7.0 | 1.000 |
| 25 | LIDC-IDRI-0124 | 2 | train | benign | 4 | (130, 233, 83) | (-105.9, -18.0, -103.8) | -138 | 5.9 | 5.0 | 6.0 | 2.5 | yes | yes | yes | hole fill | 87.8 | 1.000 |
| 26 | LIDC-IDRI-0124 | 3 | train | benign | 1 | (202, 304, 76) | (-49.7, 37.5, -121.2) | -449 | 4.3 | 5 | 6 | 2.5 | yes | yes | yes | aerated lung | 116.4 | 1.000 |
| 27 | LIDC-IDRI-0124 | 4 | train | benign | 4 | (320, 328, 91) | (42.5, 56.2, -83.8) | 7 | 6.3 | 5.0 | 6.0 | 2.5 | **no** | yes | yes | hole fill | 114.9 | 1.000 |
| 28 | LIDC-IDRI-0124 | 5 | train | benign | 3 | (89, 228, 64) | (-138.0, -21.9, -151.2) | -198 | 4.7 | 5 | 6 | 2.5 | yes | yes | yes | hole fill | 7.7 | 1.000 |
| 29 | LIDC-IDRI-0124 | 9 | train | benign | 2 | (371, 216, 81) | (82.3, -31.2, -108.8) | -83 | 5.1 | 5.0 | 6.0 | 2.5 | yes | yes | yes | hole fill | 64.0 | 1.000 |
| 30 | LIDC-IDRI-0124 | 10 | train | benign | 4 | (393, 287, 70) | (99.5, 24.2, -136.2) | -156 | 10.1 | 5.0 | 6.0 | 2.5 | yes | yes | yes | hole fill | 53.9 | 1.000 |
| 31 | LIDC-IDRI-0124 | 12 | train | benign | 1 | (134, 349, 58) | (-102.8, 72.7, -166.2) | -400 | 4.7 | 5 | 6 | 2.5 | yes | yes | yes | aerated lung | 18.6 | 1.000 |
| 32 | LIDC-IDRI-0124 | 13 | train | benign | 1 | (356, 281, 86) | (70.6, 19.5, -96.2) | -189 | 4.0 | 5 | 6 | 2.5 | yes | yes | yes | hole fill | 28.2 | 1.000 |
| 33 | LIDC-IDRI-0951 | 0 | test | benign | 4 | (32, 266, 52) | (-117.7, 160.3, -688.8) | 858 | 15.5 | 5.0 | 3.0 | 1.0 | **no** | **no** | **no** | **excluded** | -5.2 | 0.455 |
| 34 | LIDC-IDRI-0951 | 1 | test | benign | 2 | (52, 225, 140) | (-105.6, 135.4, -600.8) | -142 | 3.4 | 5.0 | 4.5 | 1.0 | yes | yes | yes | hole fill | 4.9 | 1.000 |
| 35 | LIDC-IDRI-0951 | 2 | test | benign | 1 | (157, 398, 229) | (-41.8, 240.5, -511.8) | 42 | 3.1 | 5 | 3 | 1.0 | yes | yes | yes | dilation only | 1.2 | 0.990 |
| 36 | LIDC-IDRI-0951 | 3 | test | benign | 1 | (111, 225, 147) | (-69.7, 135.4, -593.8) | 2199 | 5.0 | 5 | 3 | 1.0 | **no** | yes | yes | hole fill | 20.3 | 1.000 |
| 37 | LIDC-IDRI-0951 | 4 | test | benign | 1 | (64, 214, 132) | (-98.3, 128.7, -608.8) | 99 | 2.5 | 5 | 6 | 1.0 | yes | yes | yes | hole fill | 11.7 | 1.000 |
| 38 | LIDC-IDRI-0998 | 0 | train | malignant | 4 | (147, 293, 60) | (-80.5, -127.2, -180.5) | -130 | 9.5 | 4.0 | 6.0 | 3.0 | yes | yes | yes | hole fill | 33.3 | 1.000 |
| 39 | LIDC-IDRI-0998 | 1 | train | malignant | 4 | (317, 290, 56) | (45.6, -129.4, -192.5) | -17 | 10.5 | 5.0 | 6.0 | 3.0 | **no** | yes | yes | hole fill | 7.8 | 0.904 |
| 40 | LIDC-IDRI-0998 | 5 | train | benign | 1 | (384, 345, 41) | (95.4, -88.6, -237.5) | -119 | 4.9 | 4 | 6 | 3.0 | yes | yes | yes | hole fill | 11.3 | 1.000 |
| 41 | LIDC-IDRI-0998 | 6 | train | benign | 2 | (370, 345, 42) | (85.0, -88.6, -234.5) | -105 | 6.4 | 4.5 | 6.0 | 3.0 | yes | yes | yes | hole fill | 15.5 | 1.000 |
| 42 | LIDC-IDRI-0998 | 7 | train | benign | 2 | (395, 365, 39) | (103.5, -73.7, -243.5) | -33 | 8.5 | 4.5 | 6.0 | 3.0 | yes | yes | yes | hole fill | 5.8 | 0.806 |
| 43 | LIDC-IDRI-0260 | 0 | calibration | malignant | 4 | (126, 318, 48) | (-94.1, 60.4, -260.5) | 50 | 14.2 | 5.0 | 6.0 | 2.5 | **no** | yes | yes | hole fill | 34.3 | 1.000 |
| 44 | LIDC-IDRI-0260 | 1 | calibration | malignant | 4 | (185, 316, 59) | (-54.9, 59.0, -233.0) | 67 | 15.0 | 5.0 | 6.0 | 2.5 | **no** | yes | yes | hole fill | 88.5 | 1.000 |
| 45 | LIDC-IDRI-0260 | 2 | calibration | benign | 2 | (125, 254, 119) | (-94.8, 17.9, -83.0) | -70 | 5.0 | 5.0 | 6.0 | 2.5 | yes | yes | yes | dilation only | 2.4 | 0.972 |
| 46 | LIDC-IDRI-0260 | 3 | calibration | malignant | 2 | (227, 195, 57) | (-27.1, -21.3, -238.0) | 52 | 12.3 | 5.0 | 6.0 | 2.5 | **no** | yes | yes | **body-scale hole** | 62.4 | 1.000 |
| 47 | LIDC-IDRI-0031 | 0 | train | malignant | 4 | (155, 355, 89) | (-86.8, 49.9, -156.5) | -50 | 10.5 | 5.0 | 6.0 | 2.5 | **no** | yes | yes | hole fill | 34.9 | 1.000 |
| 48 | LIDC-IDRI-0031 | 1 | train | malignant | 4 | (351, 316, 113) | (81.6, 16.4, -96.5) | -2 | 15.3 | 4.5 | 6.0 | 2.5 | **no** | yes | yes | hole fill | 22.1 | 1.000 |
| 49 | LIDC-IDRI-0031 | 2 | train | benign | 4 | (185, 355, 113) | (-61.0, 49.9, -96.5) | -63 | 7.0 | 5.0 | 6.0 | 2.5 | yes | yes | yes | hole fill | 12.3 | 1.000 |
| 50 | LIDC-IDRI-0031 | 3 | train | benign | 1 | (367, 334, 56) | (95.4, 31.8, -239.0) | -124 | 5.9 | 5 | 6 | 2.5 | yes | yes | yes | dilation only | 1.9 | 0.979 |
| 51 | LIDC-IDRI-0031 | 4 | train | benign | 1 | (172, 392, 55) | (-72.2, 81.7, -241.5) | -192 | 5.4 | 5 | 6 | 2.5 | yes | yes | yes | hole fill | 21.6 | 1.000 |
| 52 | LIDC-IDRI-0459 | 0 | train | benign | 1 | (129, 334, 130) | (-82.6, 53.3, -82.8) | 1067 | 3.7 | 5 | 3 | 1.25 | yes | yes | yes | hole fill | 17.9 | 1.000 |
| 53 | LIDC-IDRI-0459 | 1 | train | benign | 1 | (372, 202, 45) | (83.5, -36.9, -189.0) | 812 | 4.8 | 5 | 3 | 1.25 | yes | yes | yes | hole fill | 78.9 | 1.000 |
| 54 | LIDC-IDRI-0459 | 2 | train | benign | 1 | (130, 327, 86) | (-81.9, 48.5, -137.8) | 1321 | 4.4 | 5 | 3 | 1.25 | yes | yes | yes | hole fill | 72.8 | 1.000 |
| 55 | LIDC-IDRI-0459 | 3 | train | benign | 1 | (407, 172, 65) | (107.4, -57.4, -164.0) | 1016 | 3.9 | 5 | 3 | 1.25 | yes | yes | yes | hole fill | 46.5 | 1.000 |
| 56 | LIDC-IDRI-0052 | 0 | train | benign | 4 | (348, 233, 84) | (43.9, -7.3, -249.5) | -18 | 8.1 | 5.0 | 6.0 | 1.25 | yes | yes | yes | hole fill | 79.6 | 1.000 |
| 57 | LIDC-IDRI-0052 | 1 | train | malignant | 3 | (153, 306, 226) | (-100.8, 46.9, -72.0) | 5 | 16.9 | 5 | 6 | 1.25 | **no** | yes | yes | hole fill | 22.4 | 1.000 |
| 58 | LIDC-IDRI-0052 | 2 | train | malignant | 1 | (172, 308, 238) | (-86.7, 48.4, -57.0) | -971 | 31.5 | 5 | 6 | 1.25 | yes | yes | yes | hole fill | 12.6 | 0.857 |
| 59 | LIDC-IDRI-0059 | 0 | test | malignant | 4 | (322, 380, 101) | (32.9, 87.2, -100.8) | 27 | 10.3 | 4.5 | 6.0 | 2.5 | **no** | yes | yes | hole fill | 37.9 | 1.000 |
| 60 | LIDC-IDRI-0148 | 0 | validation | malignant | 4 | (140, 304, 83) | (-99.4, 37.5, -169.2) | -4 | 12.2 | 5.0 | 6.0 | 2.5 | **no** | yes | yes | hole fill | 23.3 | 1.000 |
| 61 | LIDC-IDRI-0148 | 1 | validation | malignant | 4 | (167, 341, 83) | (-78.3, 66.4, -169.2) | -30 | 14.2 | 5.0 | 6.0 | 2.5 | **no** | yes | yes | hole fill | 18.2 | 1.000 |
| 62 | LIDC-IDRI-0148 | 2 | validation | benign | 1 | (401, 350, 62) | (104.5, 73.4, -221.8) | -105 | 4.1 | 5 | 6 | 2.5 | yes | yes | yes | dilation only | 2.2 | 1.000 |
| 63 | LIDC-IDRI-0118 | 0 | validation | benign | 3 | (204, 222, 94) | (-31.9, -30.0, -219.0) | 1012 | 5.5 | 5 | 3 | 1.25 | yes | yes | yes | **body-scale hole** | 111.9 | 1.000 |
| 64 | LIDC-IDRI-0118 | 1 | validation | benign | 4 | (133, 336, 67) | (-94.6, 70.6, -252.8) | 758 | 5.2 | 5.0 | 3.0 | 1.25 | yes | yes | yes | **body-scale hole** | 43.1 | 1.000 |
| 65 | LIDC-IDRI-0118 | 2 | validation | benign | 3 | (392, 273, 143) | (134.1, 15.0, -157.8) | 76 | 6.2 | 5 | 3 | 1.25 | yes | yes | yes | hole fill | 78.7 | 1.000 |
| 66 | LIDC-IDRI-0118 | 3 | validation | benign | 1 | (379, 245, 157) | (122.6, -9.7, -140.2) | 968 | 5.2 | 5 | 3 | 1.25 | yes | yes | yes | hole fill | 89.0 | 1.000 |
| 67 | LIDC-IDRI-0118 | 4 | validation | benign | 3 | (221, 314, 159) | (-16.9, 51.2, -137.8) | 685 | 5.5 | 5 | 3 | 1.25 | yes | yes | yes | hole fill | 129.8 | 1.000 |
| 68 | LIDC-IDRI-0118 | 5 | validation | benign | 2 | (205, 335, 70) | (-31.0, 69.7, -249.0) | 784 | 5.3 | 5.0 | 3.0 | 1.25 | yes | yes | yes | hole fill | 101.6 | 1.000 |
| 69 | LIDC-IDRI-0586 | 0 | train | benign | 4 | (78, 266, 38) | (-107.8, 9.4, -229.3) | -636 | 4.9 | 5.0 | 6.0 | 2.5 | yes | yes | yes | aerated lung | 12.3 | 1.000 |
| 70 | LIDC-IDRI-0586 | 1 | train | benign | 4 | (425, 274, 43) | (92.2, 14.0, -216.8) | -619 | 4.6 | 5.0 | 6.0 | 2.5 | yes | yes | yes | aerated lung | 15.0 | 1.000 |
| 71 | LIDC-IDRI-0586 | 3 | train | benign | 1 | (129, 327, 70) | (-78.4, 44.5, -149.3) | -314 | 3.4 | 3 | 6 | 2.5 | yes | yes | yes | aerated lung | 35.7 | 1.000 |
| 72 | LIDC-IDRI-0484 | 1 | train | malignant | 1 | (122, 271, 37) | (-73.1, -157.1, -247.0) | -543 | 8.8 | 5 | 6 | 3.0 | yes | yes | yes | aerated lung | 7.4 | 0.645 |
| 73 | LIDC-IDRI-0006 | 0 | train | benign | 1 | (191, 340, 55) | (-38.0, 46.8, -194.0) | -386 | 5.7 | 4 | 6 | 2.5 | yes | yes | yes | aerated lung | 7.5 | 1.000 |
| 74 | LIDC-IDRI-0006 | 3 | train | benign | 1 | (364, 358, 71) | (70.1, 58.1, -154.0) | -216 | 10.8 | 1 | 6 | 2.5 | yes | yes | yes | hole fill | 20.8 | 1.000 |
