# Model Changelog

One entry per artifact that has served, newest first.

**Entries record what got worse as well as what improved.** A changelog listing
only gains is a marketing document, and the regressions are the entries a future
reader most needs — they are what says whether a change was a trade or a win.

Process for adding an entry: `docs/MODEL_GOVERNANCE.md`.

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

**Bound 2026-09-01, verification `asserted_at_introduction`. Currently serving.**

| Measure | Value |
|---|---|
| Sensitivity | 0.8121 |
| Specificity | 0.757 |
| Balanced accuracy | 0.785 |
| Test AUC | 0.88 |
| Test set | 554 images (282 cancer / 272 no_cancer) |
| Preprocessing | `raw_0_255` |
| Decision threshold | 0.30 on the calibrated P(cancer), not argmax |

**These figures have not been reproduced against this artifact.** The cited test
split is not present in this working copy — only `train/` and `validate/` — so
the `reproduce` command published on `/api/models/cards` does not currently work
for lung. The binding records the deployed fingerprint so future drift is
detectable; it does not confirm the figures describe this file. Restoring the
split and re-measuring is the outstanding governance task.

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

### lung nodule (LIDC-IDRI) — `dataset/lung_nodule_model/`

A separate model trained on LIDC-IDRI CT nodule patches, distinct from the
served lung classifier above. Not bound, not registered, and not serving.

Recorded here because its OOD reference has been built and validated, and
because it is the intended replacement for the current lung artifact:

- Whole CT slices (right modality, wrong scale) refused at 90.8%
- Skin lesions (wrong modality) refused at 92.5%
- Held-out benign nodule patches accepted, flagged at only 3.3%
- Off-nodule lung parenchyma flagged at 0.8%

Before it can serve it needs a `MODEL_REGISTRY` entry with measured figures, a
`MEASUREMENT_BINDINGS` entry, and an entry here.
