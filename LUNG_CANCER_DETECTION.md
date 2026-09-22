# Lung Cancer Detection — historical document

**Superseded. Kept only so that links to it resolve.** Last substantive
revision July 2025; rewritten to this note on 2026-09-20.

The version this replaces described a ResNet50V2 lung classifier with a
Dense(512)/Dense(256) head, `1/255` rescaling, and "expected" performance of
~91% accuracy, ~89% sensitivity and ~93% specificity at a 70% confidence
threshold. None of those figures was measured, the architecture described is
not the one that was trained, and the rescaling described would have
double-scaled the input of the model that was.

What is true of lung analysis on this platform today is in:

- [`MODEL_CARDS.md`](MODEL_CARDS.md) — the lung card, including why the model
  that served from 2 to 20 September 2026 was **withdrawn** (it accepted real
  chest CT it had never been measured on), and the status of the LIDC-IDRI
  nodule characteriser that replaces it;
- [`docs/MODEL_CHANGELOG.md`](docs/MODEL_CHANGELOG.md) — what changed and
  what got worse;
- `GET /api/models/cards` — the live figures, bound to the deployed artifact.

Nothing in this file should be cited.
