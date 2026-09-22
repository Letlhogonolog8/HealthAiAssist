# Model Cards

> **Artifacts are not in git.** `dataset/` is gitignored (it was stripped from
> history), so the `.h5` files these cards describe are not version-controlled and
> must be provisioned onto any machine that serves them. All three are rebuildable
> from source — `scripts/train-skin-cancer-model.py`,
> `scripts/train-lung-cancer-model.py` and `scripts/train-lung-nodule-model.py`
> (after the `lidc_*` extraction) — so losing one costs a training run rather
> than the modality. Back them up anyway: `npm run backup:models`.

Every model this system can serve, what it was measured at, and what it must not
be used for. The authoritative machine-readable copy lives in
[`server/model-availability.ts`](server/model-availability.ts) and is served at
`GET /api/models/cards`.

Reproduce any figure below with:

```bash
python scripts/evaluate-model.py <model.h5> <data_dir> <class0> <class1>
```

**Balanced accuracy** (the mean of sensitivity and specificity) is the headline
metric, not raw accuracy. On an imbalanced set, a model that answers "negative"
for every image scores the majority-class rate while detecting nothing; balanced
accuracy scores that degenerate case at 0.5, which is chance.

---

## Lung cancer — ResNet50V2 — **WITHDRAWN 2026-09-20** (retrained 2026-08-18)

> **This model no longer serves.** It was withdrawn after being found to
> accept real chest CT — which it had never been measured on — and to issue
> verdicts on it. The account is in
> [This model cannot read real clinical imaging](#this-model-cannot-read-real-clinical-imaging-and-was-withdrawn-when-that-turned-out-to-be-the-wrong-way-round)
> below; the short version is that the earlier claim on this card, that the
> out-of-distribution screen refused every clinical acquisition, was measured
> on the wrong object and is false for chest CT. `lung` scans are stored and
> queued for a radiologist with no automated result. Its replacement, the
> LIDC-IDRI nodule characteriser, was bound on 2026-09-21 and has its own card
> below; it answers a narrower question and only for a clinician-marked nodule.
>
> The figures below are unchanged. They are true of this artifact on its own
> held-out set. They were never true of CT, and that is the point.

| | |
|---|---|
| Artifact | `dataset/lung_cancer_MRI_dataset/resnet50v2_lung_cancer_model.h5` |
| Architecture | ResNet50V2 ImageNet trunk, **frozen**; trained Dense(256)+Dropout head |
| Input | Raw RGB 0–255, 224×224. Normalisation **fused into the graph** |
| Splits | 2575 train / 551 validation / **554 test**, stratified, seed 4242 |
| Evaluation set | 554 images (282 cancer / 272 no_cancer), **never used in training or model selection** |
| Test AUC | **0.88** |
| Calibration | ECE 0.019 → **0.017** with temperature scaling (T=1.125), **applied** |
| **Deployed operating point** | threshold 0.30 on the *calibrated* P(cancer) — *not* argmax |
| Sensitivity @ 0.30 | **0.812** — 229 of 282 |
| Specificity @ 0.30 | **0.757** |
| Balanced accuracy @ 0.30 | **0.785** |

Reproduce: `python scripts/train-lung-cancer-model.py` then
`python scripts/choose-lung-threshold.py`

### Why the threshold is not argmax

Argmax implicitly says a missed cancer and a false alarm cost the same. They do
not in screening. The full sweep on the held-out set:

| Threshold | Sensitivity | Specificity | Balanced acc. | **Missed cancers** | False alarms |
|---|---|---|---|---|---|
| 0.50 (argmax) | 0.695 | 0.982 | **0.838** | **86** | 5 |
| 0.40 | 0.730 | 0.941 | 0.836 | 76 | 16 |
| 0.35 | 0.762 | 0.901 | 0.832 | 67 | 27 |
| **0.30 (deployed, calibrated)** | **0.812** | **0.757** | 0.785 | **53** | 66 |
| 0.25 | 0.826 | 0.654 | 0.740 | 49 | 94 |
| 0.19 | 0.911 | 0.474 | 0.693 | 25 | 143 |

Argmax has the best balanced accuracy and is the wrong choice: it misses 86 of
282 cancers. The deployed point trades extra false alarms for 33 fewer missed
cancers. Override with `LUNG_CANCER_THRESHOLD`.

The threshold is selected on **calibrated** probabilities and applied to
calibrated probabilities at inference. Temperature scaling is monotonic so it
cannot change the ranking, but it does move where a given numeric cut point sits
— selecting 0.28 on raw output and then applying T at inference would silently
shift the operating point. The sweep above pre-dates calibration; the deployed
row is post-calibration.

Note what the table shows about the model itself: there is no region with both
high sensitivity and high specificity. **Roughly 1 in 5 cancers is still missed
and 1 in 4 healthy scans is still flagged.**

### Why it was retrained rather than just re-measured

The previous figures — 0.75 balanced accuracy, 0.904 sensitivity — came from
`lung_cancer_MRI_dataset/validate`, which was the validation generator during
that model's own training. The model had been selected against it, so the numbers
were optimistic. No untouched data existed anywhere in the repository, so a
"held-out test set" could only be created by pooling both directories and
re-splitting. The test file list is recorded in `lung_splits.json` so the claim
is auditable.

The honest comparison is therefore *not* 0.904 → 0.812. The old sensitivity was
measured on data the model had been tuned on and never meant what it said.

### Limitations

- Input screening: PCA reconstruction error in feature space flags skin images
  at **100%**, held-out chest images at **0.8%** — and **real CT slices at only
  3.4%**, which is why the model was withdrawn (next section). Pixel checks
  catch blank and blurred frames, which the feature detector scores as
  in-distribution.
- **No measured performance on CT.** The training and test images are web
  PNGs of unrecorded provenance. Nothing above says anything about how this
  model behaves on a scanner's output.
- Demographic composition of the training data is unrecorded.
- Not clinically validated. Not cleared by any regulator.

### This model cannot read real clinical imaging — and was withdrawn when that turned out to be the wrong way round

**What this card said until 2026-09-20.** DICOM ingestion was added in August
2026, and the first object put through it — pydicom's bundled `CT_small.dcm` —
scored 22.88 against the 16.51 out-of-distribution threshold and was refused.
Re-windowing it did not change that (lung window 25.04, mediastinal 30.35,
bone 20.32). This card, the application text, the device-integration plan and
the demo script all concluded from those four numbers that **the model refuses
every clinical acquisition**, that the DICOM gate in the inference service was
belt-and-braces, and that the lung modality was therefore safe to leave
serving until a CT-trained model replaced it.

**What was actually measured on 2026-09-20.** `CT_small.dcm` is a 128×128 GE
RHAPSODE acquisition from the 1990s. It is not what a chest CT looks like. The
LIDC-IDRI series in `dataset/` are, and run through the serving code they give
a different answer:

| Input, through the serving path | n | Passed the screen | Median score (threshold 16.51) | Verdicts issued |
|---|---|---|---|---|
| Whole LIDC CT slices, lung window, 224×224 (`dataset/lidc-ood/whole-slice`) | 87 | **84 (96.6%)** | **12.26** (min 9.9, max 18.0) | cancer and no_cancer, roughly evenly |
| Real LIDC DICOM objects via `inference/dicom_ingest.dicom_to_png_bytes` | 12 | **11** | 14.2 (min 9.4, max 17.2) | 3 cancer / 8 no_cancer |
| Its own held-out web-PNG test set, for comparison | 40 | 40 | 11.3 | — |

Real chest CT sits **inside** this model's training distribution in feature
space — the training set is web-scraped chest imagery, and a windowed CT slice
resembles it well enough — so a screen built on reconstruction error has
nothing to separate. Raising the threshold would not be a fix; it would be
tuning the safety check to defeat itself, and the bar in
`scripts/build-ood-reference.py` was set before measurement precisely so that
it could not be moved to wherever the result landed.

The record is machine-checked, not prose:

```
python scripts/build-ood-reference.py lung --measure-only
  held-out chest images (same modality)                n=120  median 10.579  flagged   0.8%  expect accept  PASS
  skin lesions (wrong modality)                        n=120  median 29.740  flagged 100.0%  expect refuse  PASS
  real CT slices, LIDC-IDRI (no measured performance)  n= 87  median 12.258  flagged   3.4%  expect refuse  FAIL
1 requirement(s) NOT met  →  exit 1
```

`dataset/lung_cancer_MRI_dataset/lung_model_ood.json` records the failed
domain, and `tests/withdrawn-modality.test.ts` checks that the registry's
withdrawal reason quotes the same counts.

**What this means.** The only thing that stopped a DICOM object was the
explicit DICOM-file gate in `inference/server.py`. Nothing stopped a PNG or
JPEG export of the same slice — the ordinary way an image leaves a PACS viewer
— and such an image received a cancer / no_cancer verdict from a model with
**no measured performance on CT at all**. That is a guess presented as a
result. The rule this project runs on is to refuse rather than guess, so the
model was withdrawn from serving the day this was measured, by setting
`MODEL_REGISTRY.lung.enabled = false` with the measurement as the reason.
Governance reports the modality as `withdrawn`; scans are stored and queued for
a radiologist with no automated result, exactly as for a modality that has no
model.

The earlier windowing correction stands on its own merits: rendering a CT
across its full stored range was wrong regardless of what any model did with
the result. But the sentence that used to follow it here — that the correct
window "scores worse", so windowing could not be the cause — was reasoning
from a single unrepresentative object, and it is retracted.

**What stays true.** The pipeline around the model — ingest, de-identify,
window, screen, classify, explain, review, adjudicate — works end to end.
The model at the end of it was the wrong model for the input, and the
platform's own safety machinery is what found that out: the OOD script's
both-direction bar, applied to the domain it should have been applied to in
August. Retraining on a documented CT dataset with patient-level splits was
already the first item of clinical work; it is now the only route by which a
lung result can be produced at all. That work exists —
`dataset/lung_nodule_model/`, trained on LIDC-IDRI, calibrated, with a
both-direction OOD reference that *does* refuse whole slices at 90.8% — and it
was bound and given its own card on 2026-09-21 (next section).

**Lesson recorded for the next modality.** A refuse-domain measured on a
convenience sample is not a measurement. Every future OOD reference is
validated against real acquisitions of the modality it is meant to refuse, from
the dataset the replacement model will be trained on, before the model behind
it is allowed to serve.

---

## Lung nodule characteriser — ResNet50V2 on LIDC-IDRI — **VALIDATION** (bound 2026-09-21)

> **Research / internal validation.** Serving under validation terms: the
> evidence is real and small, every figure carries the interval that 29
> malignant nodules imply, and every result goes to a radiologist. Not
> clinically validated. Not cleared by any regulator.

| | |
|---|---|
| Model name / version | `resnet50v2-lung_nodule-9faf49cdca48` |
| Artifact | `dataset/lung_nodule_model/resnet50v2_lung_nodule_model.h5` |
| Evidence class | `INTERNAL_VALIDATION` — held-out internal test set only |
| Intended use | Characterise **one nodule a clinician has marked** on a chest CT slice, as the probability that a radiologist would rate it malignant, to inform the order of review. Route 1 of `scripts/lidc_extract_patches.py`. |
| Does not do | Find nodules. Read a whole slice (refused by its OOD screen at 90.8%). Check that the marked region contains a nodule. Diagnose. |
| Input | The **DICOM object** of one CT slice plus a marked centre (pixels). Rendered at the lung window (WC −600 / WW 1500) by `inference/dicom_ingest.training_window`, 64 px crop centred on the mark (`inference/nodule_patch.crop`), bicubic to 224×224, raw RGB 0–255. **Raster exports are refused**: a PNG carries no pixel scale, and the crop's physical size is what the model was trained on. |
| Architecture | ResNet50V2 ImageNet trunk, **frozen**; trained Dense head; normalisation fused into the graph |
| Training data | LIDC-IDRI (TCIA, CC BY 3.0). 229 series / 228 patients downloaded of 1,010. Labels: median malignancy rating across up to four radiologists, median exactly 3 excluded — **a rating is an impression, not histology**. `scripts/lidc_build_labels.py`; duplicates and the superseded annotation handled as recorded there. |
| Split | **By patient, before extraction.** Train 160 patients / 580 nodules (192 malignant), val 39 / 145 (41), test 29 / 97 (29). Five slices per nodule. All three lists recorded in `dataset/lidc-ct/patches.csv`, so exclusion is checkable by intersection. |
| Operating point | Threshold **0.30** on P(malignant), chosen on validation nodules as the most specific threshold reaching 0.85 sensitivity. Temperature scaling fitted (T = 1.265) and **not applied** — validation ECE 0.061 → 0.059, not a meaningful gain. |
| **Test, per nodule** (mean over slices; the published figure) | **Sensitivity 0.862 (25/29), 95% CI 0.69–0.95. Specificity 0.691 (47/68), 95% CI 0.57–0.79. Balanced accuracy 0.777.** n = 97 nodules. |
| Test, per patch (closer to single-slice serving; interval optimistic) | Sensitivity 0.841, specificity 0.662, n = 485 patches |
| Test at argmax (not deployed) | Sensitivity 0.724, specificity 0.853 |
| Calibration | ECE 0.040, Brier 0.153 on the held-out set (`lung_nodule_model_calibration.json`) |
| OOD reference | PCA reconstruction error, 64 components, threshold 23.87 at the 99.5th percentile of training features. **Validated in both directions** with bars set before measurement: held-out benign patches accepted (3.3% flagged), off-nodule parenchyma accepted (0.8%), whole CT slices refused (90.8%), skin lesions refused (92.5%). |
| Quality gate | Pixel floors measured on the training patches (std ≥ 4.0, Laplacian variance ≥ 1.0, level 15–240), below the training minimum so no valid crop is refused by them. |
| Subgroups | **None possible.** LIDC records sex for 29% of patients, age for 20%, ethnic group for 4%. There is no equivalent of the skin-tone analysis, and for a South African deployment that is a gap this dataset cannot close. |
| Failure modes | A region marked away from a nodule receives a probability about that region (the screen checks scale and modality, not content). A miss rate of 4 in 29 on the test set could be double that in truth. A single marked slice is scored where the published figure averaged five. Inter-reader agreement is the ceiling. |
| Binding | `MEASUREMENT_BINDINGS.lung_nodule`, `re_measured` 2026-09-21 by `scripts/verify-lung-nodule-operating-point.py`, which reproduced the per-nodule figures exactly and wrote `lung_nodule_verification.json`. |
| Validation status | Internal held-out only. No external test set, no clinical study, no regulator. |

Reproduce: `python scripts/verify-lung-nodule-operating-point.py` (per-nodule and
per-patch, at the deployed operating point). Rebuild: the `lidc_*` scripts then
`scripts/train-lung-nodule-model.py`, `scripts/calibrate-model.py lung_nodule`,
`scripts/build-ood-reference.py lung_nodule`.

### What a clinician receives

Not a badge. The probability, the threshold it was compared to, the temperature
(1.0) and whether calibration was applied, the OOD score against its threshold,
the quality-gate outcome, the artifact fingerprint, the evidence class, and the
sentence "clinical validation: NOT ESTABLISHED" — recorded as numbers on the
scan row (`calibrated_probability`, `decision_threshold`, `ood_score`, …) and
rendered by `client/src/components/ai-result-summary.tsx`. The mark itself is
recorded in `scan_regions`, because the probability is about that region.

### Why this replaces the withdrawn model, and what it does not replace

The withdrawn model answered "does this chest image contain cancer" from web
images. This one answers a narrower question from real CT, and only when
somebody qualified points. The lung modality has therefore gone from a
whole-image screen with no CT evidence to a marked-region characteriser with a
small amount of CT evidence. That is a smaller claim and a better-founded one.
A detector that proposes the candidates a clinician marks today is roadmap P2,
and is not implied by anything here.

---

## Skin cancer — ResNet50V2 — **ENABLED** (retrained 2026-08-13)

| | |
|---|---|
| Artifact | `dataset/data/resnet50v2_skin_cancer_model.h5` |
| Task | Binary classification, `benign` (index 0) vs `malignant` (index 1) |
| Architecture | ResNet50V2 ImageNet trunk, **frozen**; trained Dense(256)+Dropout head |
| Input | Raw RGB 0–255, 224×224. Normalisation is **fused into the graph** as a `Rescaling` layer |
| Training set | `dataset/dataset/data/train` — 2241 images (1224 benign / 1017 malignant) after a 15% validation holdout, ×3 with flip/rotation augmentation |
| Evaluation set | `dataset/dataset/data/test` — 360 benign / 300 malignant, **never touched during training or model selection** |
| **Balanced accuracy** | **0.864** (chance = 0.50) |
| Sensitivity @ argmax | 0.913 — 274 of 300 |
| Specificity @ argmax | 0.814 — 293 of 360 |
| Raw accuracy | 0.859 (majority-class baseline 0.545) |
| Validation balanced accuracy | 0.873 — close to test, so not overfit to the split |

Reproduce: `python scripts/train-skin-cancer-model.py` then
`python scripts/evaluate-model.py dataset/data/resnet50v2_skin_cancer_model.h5 dataset/dataset/data/test benign malignant raw_0_255`

### The deployed operating point

The service does not use argmax. It bands the malignant probability, and **these are
the numbers that describe what a user actually receives**:

| Truth | → "benign" (≤0.30) | → "uncertain" (0.30–0.70) | → "malignant" (>0.70) |
|---|---|---|---|
| Malignant (300) | **10 (3.3%)** | 56 | 234 |
| Benign (360) | 268 | 57 | 35 |

- **3.3% of malignant lesions receive an outright benign result.** This is the
  number to care about: it is the only outcome that actively reassures someone who
  has cancer.
- 96.7% of malignant lesions are either flagged or escalated to `uncertain`, and
  both paths route to a clinician.
- 74.4% of benign lesions are cleared; 17% of all scans land in `uncertain`.
- Banding trades label precision for safety: strict "malignant" sensitivity is
  0.78, but outright-miss rate falls to 0.033.

### Limitations

- **Performance on darker skin cannot be established from this dataset.** See
  the section below — this was measured, and the measurement's finding is that
  the data cannot answer the question.
- Not clinically validated. Not cleared by any regulator.
- The trunk is frozen, so the model relies on generic ImageNet features rather
  than dermatology-specific ones. Fine-tuning the upper blocks would likely help;
  it was not attempted here because the training box is CPU-only with ~1 GB free.
- 660 test images is a small evaluation set. The confidence interval on 0.864 is
  wide — roughly ±0.03.

### Performance across skin tones

The dataset carries no Fitzpatrick labels, so skin tone was estimated with
**Individual Typology Angle** — the standard proxy in dermatology-AI fairness
work — computed from the healthy skin surrounding each lesion:

```
ITA = arctan((L* - 50) / b*)     python scripts/measure-skin-tone-performance.py
```

Usable estimates for **511 of 660** test images; the remaining 149 had no
identifiable perilesional skin in frame (dermoscope vignetting, or the lesion
filling the field) and are excluded rather than guessed at.

| Tone (ITA bin) | n | Malignant | Sensitivity | 95% CI | Specificity | Outright benign |
|---|---|---|---|---|---|---|
| Dark | 4 | 4 | 1.000 | 0.51–1.00 | — | 0/4 |
| Brown | 18 | 12 | 1.000 | 0.76–1.00 | 0.667 | 0/12 |
| Tan | 42 | 31 | 0.968 | 0.84–0.99 | 0.909 | 1/31 |
| Intermediate | 45 | 21 | 1.000 | 0.85–1.00 | 0.875 | 0/21 |
| **Light** | 86 | 34 | **0.882** | 0.73–0.95 | 0.942 | 2/34 |
| **Very light** | 316 | 128 | **0.938** | 0.88–0.97 | 0.835 | 3/128 |

**The finding is the representation, not the sensitivities.**

Only **22 of 511 images (4.3%)** are brown or darker. A bin is treated as
reliable only with at least 30 malignant *and* 30 benign images, and on that test
**just two bins qualify — Light and Very light. Both are light skin.**

So the honest statement is not "the model performs equally well across skin
tones". It is: **this dataset cannot tell you how the model performs on darker
skin.** The Dark bin contains four images and no benign controls at all; its
sensitivity of 1.000 has a confidence interval running from 0.51 to 1.00, which
is another way of saying nothing is known.

Across the two reliable bins sensitivity differs by 0.055, with overlapping
intervals — no detectable disparity *among light skin tones*, which is not the
question that matters.

**Do not read the absence of a measured disparity as evidence of fairness.** It
is evidence that the evaluation set is 96% light-skinned. Closing this requires
data, not modelling: a test set with meaningful representation of Fitzpatrick
V–VI, ideally with recorded labels rather than an estimate from pixels.

Caveats on the method: ITA is a proxy, not a Fitzpatrick score. It is affected by
lighting, white balance and dermoscopy artefacts, and tanning shifts a
light-skinned subject darker. It is adequate to detect a large disparity; it is
not a substitute for labelled data.

### History

The previous artifact scored **0.50 balanced accuracy — exactly chance** — on this
same test set, under all three preprocessing schemes tried (raw 0–255 called every
image benign; div255 and `resnet_v2.preprocess_input` flagged nearly everything
malignant at specificity 0.06). Its training code no longer existed, so its
preprocessing and class order could not be recovered, and it was rebuilt from
scratch. The app had been advertising that model at "96% accuracy".

Preprocessing is now fused into the saved graph specifically so that inference
cannot silently disagree with training about normalisation again.

---

## Modalities with no model

Breast, colon and prostate are named in the UI but **have no trained classifier**.
Requests return HTTP 503 and queue the scan for manual review. Until an artifact
exists and passes evaluation, they should be removed from the interface rather
than presented as capabilities.

## Serving status, in one place

| Modality | Status | Since | What a request gets |
|---|---|---|---|
| skin | **Serving** | 2026-08-13 | A banded result, reviewed by a clinician |
| lung | **Withdrawn** | 2026-09-20 | 503, stored and queued for a radiologist — see the lung card |
| lung_nodule (LIDC-IDRI) | **Serving — VALIDATION** | 2026-09-21 | A calibrated probability for one clinician-marked nodule on a DICOM CT slice, with the structured record; raster and unmarked input refused; reviewed by a radiologist |
| breast, colon, prostate | **No model** | — | 503, stored and queued |

---

## What a 503 means

When automated analysis cannot run, the API returns 503 with no diagnostic content
and records the scan with status `pending_manual_review`. This is deliberate:

> **A 503 is not a negative result.** It means no model produced an opinion.

Earlier versions of this system filled that gap with `Math.random()` — including a
lung path that defaulted to `no_cancer` at 0.5 confidence whenever the model failed
to load, which it always did, because the model path pointed at a directory that
did not exist on any deployed machine. Nothing in the response distinguished that
fabricated negative from a real one.
