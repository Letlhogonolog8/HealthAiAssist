# Model Changelog

One entry per artifact that has served, newest first.

**Entries record what got worse as well as what improved.** A changelog listing
only gains is a marketing document, and the regressions are the entries a future
reader most needs — they are what says whether a change was a trade or a win.

Process for adding an entry: `docs/MODEL_GOVERNANCE.md`.

---

## lung_nodule — `9faf49cdca48`

**Bound 2026-09-21, verification `re_measured`. Serving under VALIDATION terms.**

| Measure (per nodule, n = 97, 29 malignant) | Value | 95% CI |
|---|---|---|
| Sensitivity | 0.8621 (25 of 29) | 0.69–0.95 |
| Specificity | 0.6912 (47 of 68) | 0.57–0.79 |
| Balanced accuracy | 0.7767 | — |
| Threshold | 0.30 on P(malignant), chosen on validation nodules | |
| Temperature | 1.0 (fitted 1.265, not applied) | |
| Test set | LIDC-IDRI, patient-level split, all three lists in `patches.csv` | |

`scripts/verify-lung-nodule-operating-point.py` reproduced both figures
exactly against this artifact on 2026-09-21 and wrote
`dataset/lung_nodule_model/lung_nodule_verification.json`.

**What is worse than the numbers suggest.**

- **29 malignant nodules.** The sensitivity interval is a quarter wide. The
  observed miss rate of 4 in 29 could be double in truth, and the card says so.
- **Serving scores one marked slice; the figure averaged five.** Per patch the
  same set gives sensitivity 0.841 and specificity 0.662, and that interval is
  optimistic by construction.
- **The label is a radiologist's rating, not histology.** The model predicts
  what a reader would say; inter-reader agreement is its ceiling.
- **No subgroup analysis is possible** — LIDC records almost no demographics.
- **The screen checks scale and modality, not content.** A clinician who marks
  soft tissue receives a probability about soft tissue (measured: a mediastinal
  region scored 0.08 and passed the screen).
- **Specificity 0.69**: roughly one benign nodule in three is flagged for
  priority review.

**What changed to serve it.** Serving renders CT through
`inference/dicom_ingest.training_window()` — the function the training patches
were rendered with — where the previous serving path honoured the display
preset in the tags (found and fixed 2026-09-21; `test_windowing_parity` holds
serving to the training PNGs byte for byte). The crop is one implementation
(`inference/nodule_patch.py`) imported by the extractor and the service. The
de-identified DICOM object, not the upload, is what is persisted. The result
is recorded as numbers (`migrations/scan-analysis-detail.sql`) and the mark as
a row (`migrations/scan-regions.sql`). Raster input is refused. Patients
cannot submit to it.

Predecessor: the web-trained lung classifier, withdrawn 2026-09-20 (above).

---

## lung — `31315d6a059a` — **WITHDRAWN**

**Served 2026-09-02 → 2026-09-20. Withdrawn 2026-09-20.** (Its replacement, the nodule characteriser above, was bound 2026-09-21.)

**What got worse.** Whole-image lung triage is gone and does not come back
with the replacement: a `lung` upload is stored and queued for a radiologist
with no automated result, exactly as a modality with no model. What the
nodule characteriser offers is narrower — a clinician must mark the nodule —
and rests on 29 malignant test nodules.

**Why.** The card had said this model refuses every clinical acquisition,
because pydicom's bundled `CT_small.dcm` scored 22.88 against the 16.51
out-of-distribution threshold at every window tried. Measured on LIDC-IDRI
chest CT on 2026-09-20, through the serving code:

| Input | n | Passed the screen | Median score |
|---|---|---|---|
| Whole CT slices, lung window (`dataset/lidc-ood/whole-slice`) | 87 | 84 | 12.26 |
| Real DICOM objects via `dicom_to_png_bytes` | 12 | 11 | 14.2 |
| Its own web-PNG test set | 40 | 40 | 11.3 |

Real chest CT is inside this model's training distribution in feature space;
the screen cannot separate it, and a PNG export of a CT slice received a
verdict from a model with no measured performance on CT. A verdict with no
measured basis is a guess, and the rule is to refuse rather than guess.

**The record.** `python scripts/build-ood-reference.py lung --measure-only`
now includes the real-CT domain as `refuse`, measures 3.4% against a 90% bar,
and exits non-zero. `lung_model_ood.json` records the failed domain.
`tests/withdrawn-modality.test.ts` checks the registry's reason quotes the
same counts. The four-window table that supported the earlier claim is
retracted on the model card, with the reason.

**What did not change.** The held-out figures in the serving entry below (sensitivity 0.8121,
specificity 0.7574 at the deployed point) are still what this artifact does on
its own test set. The binding is unchanged and still `re_measured`. Scans it
analysed before withdrawal keep their `model_version`; the explanation endpoint
refuses to re-run it over them (`model_not_serving`, state `withdrawn`).

**Replacement.** The LIDC-IDRI nodule characteriser — bound 2026-09-21 with a
registry entry, a `re_measured` binding and a card; the entry above.

---

## skin — `ed06b8a0468e`

**Bound 2026-09-01, verification `re_measured`. Currently serving.**

| Measure | Value |
|---|---|
| Sensitivity | 0.9133 |
| Specificity | 0.8139 |
| Balanced accuracy | 0.8636 |
| Test set | 360 benign / 300 malignant, held out from training |
| Preprocessing | `raw_0_255` — normalisation is fused into the model graph |

Re-running `scripts/evaluate-model.py` against this artifact on 2026-09-01
reproduced all three figures exactly, which is what makes this binding
`re_measured` rather than asserted.

**What is worse than the numbers suggest.**

- The test set is **96% light-skinned**. Only 4.3% of the 511 images with a
  measurable Individual Typology Angle are brown or darker, the Dark bin holds
  4 images, and it has no benign controls. **This dataset cannot establish
  performance on darker skin.** The absence of a measured disparity is evidence
  of an unrepresentative test set, not of fairness.
- At the deployed banded thresholds (>0.70 malignant, 0.30–0.70 uncertain,
  ≤0.30 benign) **10 of 300 malignant lesions receive an outright benign
  result**. 96.7% are flagged or escalated, and 17% of all scans land in the
  uncertain band.
- Temperature scaling was fitted and deliberately **not** applied: it did not
  improve validation ECE, so the raw output is already usable as a probability.
  Measured ECE 0.024, Brier 0.098.

Predecessor: an artifact that scored at chance. It was replaced on 2026-08-13
rather than tuned, because a model at chance is not a model.

---

## lung — `31315d6a059a`

**Bound 2026-09-02, verification `re_measured`. Served 2026-09-02 to
2026-09-20; withdrawn — see the entry above.**

| Measure | Value |
|---|---|
| Sensitivity | 0.8121 |
| Specificity | 0.757 |
| Balanced accuracy | 0.785 |
| Test AUC | 0.88 |
| Test set | 554 images (282 cancer / 272 no_cancer) |
| Preprocessing | `raw_0_255` |
| Decision threshold | 0.30 on the calibrated P(cancer), not argmax |

**Reproduced against this artifact on 2026-09-02**, at both operating points:

| Point | Sensitivity | Specificity | Balanced accuracy | Cancers missed |
|---|---|---|---|---|
| argmax | 0.6950 | 0.9816 | 0.8383 | 86 of 282 |
| deployed (T=1.125, threshold 0.30) | **0.8121** | **0.7574** | **0.7847** | **53 of 282** |

Both match the published figures exactly. The test split was rebuilt from
`lung_splits.json` with `scripts/materialise-lung-test-split.py` — 282 cancer /
272 no_cancer, as published — and the deployed point verified with
`scripts/verify-lung-operating-point.py`.

The table is the clearest statement of the trade the threshold buys: argmax has
the better balanced accuracy and misses 33 more cancers.

**Still asserted rather than checked:** the manifest records only the test list,
so the claim that those entries were excluded from training cannot be verified
by intersection. Record all three lists on the next retrain.

**What is worse than the numbers suggest.**

- **Roughly 1 in 5 cancers is missed and 1 in 4 healthy scans is flagged.**
- The threshold of 0.30 is a deliberate trade, not an optimum. Argmax scores a
  *higher* balanced accuracy (0.838) but misses 86 of 282 cancers against 53 at
  the deployed threshold. Sensitivity was bought with specificity because this
  is screening triage. Configurable via `LUNG_CANCER_THRESHOLD`.
- **Demographic composition of the training data is unrecorded.** Not
  unbalanced — unknown.
- Temperature scaling (T=1.125) **is** applied here, unlike skin: it improved
  validation ECE enough to deploy. ECE 0.019 → 0.017.

Predecessor: figures of 0.75 balanced accuracy that came from the directory used
as the validation generator during that model's own training — optimistic, and
not held out at all. No untouched data existed, which is why the 2026-08-18 work
was a retrain rather than a re-split.

---

## Not yet serving

Nothing. Every artifact in `dataset/` that is intended to serve has an entry
above; the LIDC nodule characteriser was bound on 2026-09-21.
