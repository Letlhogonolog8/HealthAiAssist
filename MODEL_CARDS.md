# Model Cards

> **Artifacts are not in git.** `dataset/` is gitignored (it was stripped from
> history), so the `.h5` files these cards describe are not version-controlled and
> must be provisioned onto any machine that serves them. Both are now rebuildable
> from source — `scripts/train-skin-cancer-model.py` and
> `scripts/train-lung-cancer-model.py` — so losing one costs a training run rather
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

## Lung cancer — ResNet50V2 — **ENABLED** (retrained 2026-08-18)

| | |
|---|---|
| Artifact | `dataset/lung_cancer_MRI_dataset/resnet50v2_lung_cancer_model.h5` |
| Architecture | ResNet50V2 ImageNet trunk, **frozen**; trained Dense(256)+Dropout head |
| Input | Raw RGB 0–255, 224×224. Normalisation **fused into the graph** |
| Splits | 2575 train / 551 validation / **554 test**, stratified, seed 4242 |
| Evaluation set | 554 images (282 cancer / 272 no_cancer), **never used in training or model selection** |
| Test AUC | **0.88** |
| **Deployed operating point** | threshold 0.28 on P(cancer) — *not* argmax |
| Sensitivity @ 0.28 | **0.812** — 229 of 282 |
| Specificity @ 0.28 | **0.772** — 210 of 272 |
| Balanced accuracy @ 0.28 | **0.792** |

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
| **0.28 (deployed)** | **0.812** | **0.772** | 0.792 | **53** | 62 |
| 0.25 | 0.826 | 0.654 | 0.740 | 49 | 94 |
| 0.19 | 0.911 | 0.474 | 0.693 | 25 | 143 |

Argmax has the best balanced accuracy and is the wrong choice: it misses 86 of
282 cancers. The deployed point trades 57 extra false alarms for 33 fewer missed
cancers. Override with `LUNG_CANCER_THRESHOLD`.

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

- **No input screening for this modality.** Unlike the skin model, an unrelated
  image will still be classified. The OOD detector has not been built for lung.
- Calibration has not been measured for this model.
- Demographic composition of the training data is unrecorded.
- Not clinically validated. Not cleared by any regulator.

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

- **Performance across skin tones is unknown.** The dataset's provenance and
  demographic composition are unrecorded. Dermoscopy sets of this vintage are
  typically light-skin dominant, so sensitivity on darker skin should be assumed
  *worse than reported* until measured. Measuring it requires Fitzpatrick labels
  the dataset does not carry.
- Not clinically validated. Not cleared by any regulator.
- The trunk is frozen, so the model relies on generic ImageNet features rather
  than dermatology-specific ones. Fine-tuning the upper blocks would likely help;
  it was not attempted here because the training box is CPU-only with ~1 GB free.
- 660 test images is a small evaluation set. The confidence interval on 0.864 is
  wide — roughly ±0.03.

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
