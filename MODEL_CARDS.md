# Model Cards

> **Artifacts are not in git.** `dataset/` is gitignored (it was stripped from
> history), so the `.h5` files these cards describe are not version-controlled and
> must be provisioned onto any machine that serves them. The skin model is
> rebuildable from source with `python scripts/train-skin-cancer-model.py`; the
> lung model is not — its training script is stale and no equivalent exists, so
> **that artifact is currently irreplaceable if lost.** Back it up.

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

## Lung cancer — ResNet50V2 — **ENABLED**

| | |
|---|---|
| Artifact | `dataset/lung_cancer_MRI_dataset/resnet50v2_lung_cancer_model.h5` |
| Task | Binary classification, `cancer` vs `no_cancer` |
| Input | RGB, resized to 224×224, divided by 255 |
| Evaluation set | `dataset/dataset/lung_cancer_MRI_dataset/validate` — 752 cancer / 492 no_cancer |
| **Balanced accuracy** | **0.75** (chance = 0.50) |
| Sensitivity (cancer detected) | 0.904 — 680 of 752 |
| Specificity (healthy cleared) | 0.596 — 293 of 492 |
| Raw accuracy | 0.782 (majority-class baseline 0.605) |

**Intended use.** Screening triage: ordering a radiologist's review queue.

**Limitations, stated plainly.**

- Measured on the *validation* split, which was in all likelihood seen during
  training. **These figures are optimistic.** No held-out test set exists for this
  model; building one is the single highest-value next step.
- Specificity of 0.596 means roughly **4 in every 10 healthy scans are flagged**.
  At population screening volumes that is a large false-positive burden, with the
  anxiety and follow-up cost that implies.
- Not clinically validated. Not cleared by any regulator.
- Trained on an MRI dataset of unrecorded provenance. The demographic composition
  of the training data is **unknown**, so performance across ancestry, sex and age
  groups is also unknown and cannot be assumed uniform.

**Out of scope.** Diagnosis. Staging. Any use without radiologist sign-off.

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
