# What this tool gets wrong

A briefing for clinicians using the screening triage platform. Fifteen minutes.

Every figure below was measured on held-out data and re-verified against the
model actually deployed, on 1–2 September 2026. Nothing here is a projection.

---

## In one line

**It changes the order you look at scans. It does not tell you what they are,
and it is wrong often enough that you need to know the shape of its mistakes.**

It has **no regulatory clearance** — not from SAHPRA, not FDA, not CE. It has
never been validated in a clinical study. You are the diagnosis; it is a queue.

---

## The numbers, as frequencies

Percentages hide what matters. These are counts on the held-out test sets.

### Lung — CT nodule patches

Of **282 cancers**, the model flagged 229 and **missed 53**.

> **Roughly one lung cancer in five is not flagged.**

Of **272 healthy scans**, it cleared 206 and flagged 66.

> **Roughly one healthy scan in four is flagged anyway.**

That trade is deliberate. At its default setting the model would have a *better*
overall score — and would have missed **86** cancers instead of 53. Sensitivity
was bought with specificity on purpose, because a missed cancer and a false
alarm are not the same cost. The false alarms are the price, and you pay it.

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
| **Flagged** | Look sooner. Around 1 in 4 flagged lung scans is healthy. |
| **Not flagged** | Look anyway. Around 1 in 5 lung cancers land here. |
| **Uncertain** (skin) | The model declined to commit. Treat as needing review. |
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

1. It misses about **1 lung cancer in 5**.
2. It flags about **1 healthy lung scan in 4**.
3. **"No result" is not "negative."**
4. **Performance on dark skin is unknown**, not equal.
5. **No regulator has cleared it.** You are the diagnosis.

---

## Comprehension check

Not a formality. Anyone who cannot answer these should not be acting on the
tool's output.

1. A lung scan comes back **not flagged**. Your patient has a persistent cough
   and a smoking history. What does the result change?
   <details><summary>Answer</summary>Very little. Roughly 1 in 5 cancers are not
   flagged. A negative result is weak evidence and does not offset clinical
   suspicion.</details>

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
- `scripts/verify-lung-operating-point.py` — reproduces the lung figures above

If a figure here ever disagrees with `/api/models/cards`, **the endpoint is
right and this document is stale.** Report it.
