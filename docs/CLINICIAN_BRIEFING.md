# What this tool gets wrong

A briefing for clinicians using the screening triage platform. Fifteen minutes.

Every figure below was measured on held-out data and re-verified against the
model actually deployed, on 1–2 September 2026, and revised on 20 September
2026 when the lung model was withdrawn. Nothing here is a projection.

---

## In one line

**It changes the order you look at scans. It does not tell you what they are,
and it is wrong often enough that you need to know the shape of its mistakes.**

It has **no regulatory clearance** — not from SAHPRA, not FDA, not CE. It has
never been validated in a clinical study. You are the diagnosis; it is a queue.

---

## The numbers, as frequencies

Percentages hide what matters. These are counts on the held-out test sets.

### Lung — one marked nodule, under validation terms

**As of 21 September 2026 a program reads lung CT only where you point.** You
upload the DICOM slice, mark the nodule, and it returns the probability that a
radiologist would rate that nodule malignant. It does not search the scan; a
chest CT uploaded without a mark is stored for a radiologist and not read.

Of **29 malignant nodules** in its held-out test, it flagged 25 and **missed
4**. Of **68 benign nodules**, it cleared 47 and **flagged 21**.

> **Roughly 1 malignant nodule in 7 is not flagged, and 1 benign nodule in 3
> is flagged — on a set small enough that the true miss rate could be double.**

The label it learned from is a radiologist's rating, not a biopsy, so it
cannot be more right than the readers who rated the training set. It looks at
a 64-pixel square around your mark and nothing else; a mark on soft tissue
gets a probability about soft tissue.

The web-trained lung model that served until 20 September is withdrawn:

it had been trained on web-sourced chest images, not CT, and its figures —
it missed 53 of 282 cancers on its own test set — were figures about those
images. It was withdrawn when it was found to accept real chest CT and issue
verdicts on it, with no measured performance on CT at all. A verdict with no
measured basis is a guess, and the platform's rule is to refuse rather than
guess.

If you reviewed a lung scan before 20 September, the automated result attached
to it came from that model. Treat it as you would any unvalidated opinion: it
changes nothing about your own read.


### Skin — lesion images

The skin model does not answer yes or no. It bands the result: benign,
uncertain, or malignant.

Of **300 malignant lesions**, 290 were flagged or escalated to the uncertain
band — and **10 were given an outright benign result.**

> **About 1 malignant lesion in 30 is told it is benign.**

About **1 in 6 of all skin scans** lands in the uncertain band. That is not the
model failing; it is the model declining to commit, and it is the answer you
should trust most.

---

## The part most likely to affect your patients

**The skin model has not been shown to work on dark skin.**

The test set is 96% light-skinned. Broken down by estimated skin tone, only the
two lightest groups hold enough images to say anything at all. The darkest
group holds **four images, all cancers, and no healthy controls** — so it cannot
even produce a false-positive rate.

This means:

- There is **no measured disparity** in the published figures, and that is
  *not* reassuring. It means the data cannot answer the question.
- Any result on a patient with brown or dark skin is a result from a model
  whose accuracy on that skin has never been established.

**What to do:** weight your own judgement more heavily, not less, on darker
skin. A benign result there carries less information than the same result on
light skin, and the tool cannot tell you by how much.

The platform records an estimated skin-tone category for exactly this reason —
to make the gap measurable over time. It is never shown to you, deliberately,
so that it cannot influence a clinical decision.

---

## What a result means

| The tool says | What that actually means |
|---|---|
| **Flagged** (skin) | Look sooner. Around 1 in 4 harmless lesions is flagged or marked uncertain. |
| **Not flagged** (skin) | Look anyway. Around 1 in 30 malignant lesions lands here. |
| **Uncertain** (skin) | The model declined to commit. Treat as needing review. |
| **Lung nodule — flagged** | The marked region scored at or above 0.30. Look sooner. About 1 in 3 benign nodules lands here. |
| **Lung nodule — not flagged** | Below 0.30. About 1 in 7 malignant nodules lands here on a small test set; more in truth is possible. |
| **Lung — unmarked CT** | No automated result. Queued for you, and nothing looked at it. |
| **No result produced** | Nothing was assessed. **This is not a negative.** |
| **Queued for review** | Same — nothing looked at it. |

The last two matter most. When the model cannot run — the artifact is missing,
the image is unreadable, the patient declined automated analysis — the platform
refuses rather than guessing, and says so explicitly. **A refusal is never a
clean scan.** If you see "no result was produced", nothing has been ruled out.

---

## When to ignore it entirely

- **Whenever your own read disagrees.** There is no scenario where the tool
  overrides you. It has no clearance and no clinical validation.
- **On images unlike what it was trained on** — unusual capture conditions, a
  new scanner, a modality it was not built for. It screens for this and refuses
  most of them, but the screen is not perfect.
- **On darker skin**, per above.
- **When you are already worried.** A "not flagged" result should never be the
  reason you stop investigating a patient who concerns you.

---

## If something goes wrong, report it

Any user can file — you do not need permission and it is not a complaint
process.

**Report near-misses too.** A wrong result you caught before it reached the
patient is the most useful thing you can file: same underlying fault, no harm
done, and it is the class people skip. The severity scale puts `near_miss`
first for that reason.

What happens: the report is stored immutably, a severe-harm report pages
someone straight away, and **no reviewer can edit your severity grade or your
description afterwards.** They can add findings alongside; they cannot soften
what you wrote.

---

## Five things to remember

1. It gives about **1 malignant skin lesion in 30** an outright benign result.
2. **A lung result is about the nodule you marked**, and about 1 in 7 malignant ones is not flagged.
3. **"No result" is not "negative."**
4. **Performance on dark skin is unknown**, not equal.
5. **No regulator has cleared it.** You are the diagnosis.

---

## Comprehension check

Not a formality. Anyone who cannot answer these should not be acting on the
tool's output.

1. You mark a nodule and the tool returns **0.18, not flagged**. Your patient
   has a persistent cough and a smoking history. What has been ruled out?
   <details><summary>Answer</summary>Nothing. On its test set the model missed
   4 of 29 malignant nodules, and 29 is small enough that the true rate could
   be double. A below-threshold estimate is weak evidence and does not offset
   clinical suspicion. The rest of the scan was not read at all.</details>

2. A skin lesion on a patient with dark skin comes back **benign**. How much
   weight does that carry?
   <details><summary>Answer</summary>Less than the published figures suggest,
   and by an unknown amount. Performance on dark skin has not been
   established — the test set had four dark-skin images and no healthy
   controls.</details>

3. The platform returns **"no result was produced; queued for review."** Has
   anything been ruled out?
   <details><summary>Answer</summary>No. Nothing was assessed. This is not a
   negative finding.</details>

4. You catch a wrong result before it reaches the patient. Do you report it?
   <details><summary>Answer</summary>Yes — that is a near miss, the most
   valuable category. Same fault, no harm, and it is the one least often
   filed.</details>

5. The tool flags a scan you are confident is normal. Who decides?
   <details><summary>Answer</summary>You do. It has no clearance and no
   clinical validation; it orders your queue and nothing else.</details>

---

## Where the numbers come from

- `docs/MODEL_CHANGELOG.md` — per-model figures and what is worse than they suggest
- `GET /api/models/cards` — live figures, bound to the deployed artifact
- `GET /api/models/fairness` — skin-tone breakdown with counts and intervals
- `docs/REGULATORY_PATHWAY.md` — clearance status
- `docs/MODEL_GOVERNANCE.md` — how figures are tied to the model actually running
- `scripts/measure-skin-bands.py` — reproduces the banded skin figures above
- `scripts/verify-lung-nodule-operating-point.py` — reproduces the nodule figures above
- `scripts/verify-lung-operating-point.py` — reproduces the withdrawn lung model's figures
- `scripts/build-ood-reference.py lung --measure-only` — the measurement that withdrew it

If a figure here ever disagrees with `/api/models/cards`, **the endpoint is
right and this document is stale.** Report it.
