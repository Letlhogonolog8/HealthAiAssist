# Clinical Advisor — Brief and Outreach

**Purpose:** recruiting a practising South African clinician as a named advisor.

Pre-Application Guidelines §4.1 rewards multidisciplinary teams, and §7 scores
"clinical utility and usability" — a criterion that cannot be evidenced at all
by a team with no clinician in it. This is the largest single scoring gain
available in the build plan, and it needs no engineering.

Two things are being asked for, and deliberately only two:

1. A **30-minute walkthrough** of the tool.
2. A **one-page letter** that can accompany the application.

Anything beyond that is a conversation to have later, not an ask that should
stand between a busy clinician and saying yes.

---

## Who to approach

| Route | Why | How |
|---|---|---|
| **UCT MedTech** | A Challenge partner. Closest South African concentration of medical-device and clinical-AI expertise. | Departmental enquiry; mention the Challenge by name |
| University dermatology department | Directly relevant to the skin classifier, and the route to the Fitzpatrick V–VI dataset the model card says is missing | Head of department, or a registrar with a research interest |
| University radiology department | Directly relevant to the lung classifier and the DICOM workflow | As above |
| Radiological Society of South Africa | Member network | Enquiry to the society |
| Dermatology Society of Southern Africa | Member network | Enquiry to the society |

**Prefer someone who will actually use it over someone with the most senior
title.** A registrar who spends twenty minutes uploading images and tells you
what is wrong with the interface is worth more to the application — and to the
product — than a professor who lends a name.

---

## Outreach email

> **Subject:** 30 minutes of a clinician's time — AI screening triage tool, SA MedTech Challenge
>
> Dear Dr [Name],
>
> I am developing a cancer screening triage platform and am entering it into the
> 2026 South Africa MedTech Innovation Challenge. I am looking for a practising
> clinician willing to look at it critically.
>
> It is a working prototype, not a product. Two image classifiers — skin and lung
> — produce a calibrated probability and route every result to a clinician. It
> makes no diagnosis and no path through it bypasses human review.
>
> I want to be straightforward about what it is and is not, because I would
> rather you decline than feel misled:
>
> - Measured balanced accuracy is **0.86 for skin** and **0.79 for lung**, on
>   held-out test sets. Respectable for the stage; not competitive with published
>   literature, and I do not claim otherwise.
> - It has **no clinical validation and no regulatory clearance** in any
>   jurisdiction.
> - The skin test set is **96% light-skinned**, and I have published the finding
>   that it therefore cannot establish performance on darker skin. That is the
>   limitation I would most like a dermatologist's view on.
> - Training data provenance for the lung model is weak, and I say so in the
>   documentation.
>
> What I am asking for is 30 minutes: upload a few images, tell me where the
> workflow is wrong, and tell me what would make it unusable in a real clinic. If
> after that you are willing to be named as a clinical advisor and write a short
> letter for the application, that would be valuable — but the walkthrough is
> useful to me either way, and there is no obligation to the second part.
>
> The model documentation, including every limitation, is at [link]. I am happy
> to come to you.
>
> Kind regards,
> [Name]
> [Contact]

**Why the email leads with the weaknesses:** a clinician who has been pitched
health AI before has heard the accuracy claims and discounted them. Opening with
what the tool cannot do is both accurate and, in that audience, more persuasive
than a number. It also means the walkthrough starts from a shared understanding
rather than a correction.

---

## One-page brief for the advisor

*Give this at the walkthrough. It is written for a clinician, not an engineer.*

### What it does

Accepts a skin or chest image, runs a convolutional classifier, and returns a
probability with a screening-oriented decision threshold. Every result is queued
for clinician review and sign-off. It records what each scan **turned out to
be**, so its real-world performance becomes measurable rather than assumed.

### What it deliberately will not do

- **It will not guess when a model is unavailable.** No validated model, no
  diagnostic output — the scan is queued for a human and the response carries
  nothing. An earlier version filled that gap with random values.
- **It will not classify an image it does not recognise.** A chest image sent to
  the skin classifier is *refused*, not classified. Measured: wrong-modality
  images flag at 100%, held-out same-modality images at 0.8%.
- **It will not report what it did not measure.** No tumour stage, no grade, no
  BI-RADS or PI-RADS, no biomarker panel, no lesion dimensions. A binary
  classifier returns a label and a probability.
- **It will not rank a patient against a population that is not theirs.** Where a
  polygenic score does not transfer to a patient's ancestry, no percentile is
  shown at all.

### Measured performance

| | Skin | Lung |
|---|---|---|
| Balanced accuracy | 0.864 | 0.785 |
| Sensitivity | 0.913 | 0.812 |
| Specificity | 0.814 | 0.757 |
| Test set | 660 held-out images | 554 held-out images |
| Calibration (ECE) | 0.024 | 0.017 |

The lung threshold is 0.30, not argmax. Argmax scores better on balanced
accuracy (0.838) and misses 86 of 282 cancers; the deployed threshold misses 53.
That trade is deliberate for screening.

**Roughly 1 in 5 lung cancers is still missed and 1 in 4 healthy scans is still
flagged.** For skin, 3.3% of malignant lesions receive an outright benign
result — the only outcome that actively reassures someone who has cancer.

### What I most want your opinion on

1. **Is the refusal behaviour right?** When the tool declines to answer, is that
   useful or is it just friction?
2. **Where does this sit in a real pathway?** Who uploads, who reviews, what
   happens to a flagged scan overnight?
3. **The skin-tone gap.** The test set cannot establish performance on
   Fitzpatrick V–VI. Is there a realistic route to a representative dataset?
4. **Is the language safe?** Would any wording in the result screen mislead a
   patient reading it without a clinician present?
5. **What would stop you using this?**

### What I am not asking for

Endorsement of clinical accuracy. The evidence does not support it, and a letter
that claimed it would damage both of us.

---

## What the letter needs to say

Short. Specific. Signed. Something along these lines is enough:

> I am a [specialty] practising at [institution]. I reviewed the HealthAI
> Assistant screening triage platform on [date], including uploading test images
> and examining the result and review workflow.
>
> [One or two sentences of genuine assessment — including reservations.]
>
> I have agreed to act as clinical advisor to this project, and to advise on
> [clinical workflow design / validation study design / dataset acquisition].
>
> [Name, qualifications, HPCSA registration number, institution]

**Reservations in the letter are a strength, not a weakness.** An evaluator who
has read this project's own model cards will trust a letter that contains a
caveat considerably more than one that does not.

---

## Follow-through

If they say yes, the two things worth asking about next — both from build plan
Phase 5, both requiring a clinician:

- **Retrospective validation:** a few hundred de-identified scans from one
  facility with confirmed outcomes, run through the surveillance endpoint that
  already exists. The single highest-value piece of clinical work available.
- **Reader study:** three to five clinicians read the same set with and without
  the tool; measure sensitivity, specificity and reading time.

Offer co-authorship on both. That is the honest exchange for the time being
asked, and it is what turns an advisor into a collaborator.
