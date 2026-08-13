# Model Cards

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

## Skin cancer — ResNet50V2 — **DISABLED**

| | |
|---|---|
| Artifact | `dataset/data/resnet50v2_skin_cancer_model.h5` |
| Task | Binary classification, `benign` vs `malignant` |
| Evaluation set | `dataset/dataset/data/test` — 360 benign / 300 malignant (held out) |
| **Balanced accuracy** | **0.50 — chance** |

**This model does not work and is not served.** Requests for skin analysis return
HTTP 503 and the scan is queued for manual review.

It was evaluated under three preprocessing schemes. None produced a usable
classifier:

| Preprocessing | Balanced acc. | Sensitivity | Specificity | Behaviour |
|---|---|---|---|---|
| Raw 0–255 | 0.500 | 0.00 | 1.00 | Calls every image benign; detects nothing |
| Divide by 255 | 0.466 | 0.87 | 0.06 | Calls almost every image malignant |
| `resnet_v2.preprocess_input` | 0.451 | 0.84 | 0.06 | Same failure, slightly worse |

The two orientations are mirror images of each other: the model separates nothing,
it only shifts where the threshold falls. It carries no usable signal.

The original training code is gone — `server/train-skin-cancer-model.py` imports a
`SkinCancerDetector` class that no longer exists in `server/skin_cancer_model.py` —
so the artifact's true preprocessing and class order cannot be recovered from the
repository. **Retraining from scratch, with the preprocessing recorded, is the only
path to re-enabling this model.**

**Re-enable only when** balanced accuracy on the held-out test set clears 0.55 by a
meaningful margin, the preprocessing is pinned in code, and this card is updated
with the measured figures. Flip `enabled` in `MODEL_REGISTRY` at that point, not
before.

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
