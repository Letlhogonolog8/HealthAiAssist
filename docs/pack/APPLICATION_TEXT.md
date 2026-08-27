# Application Text

Drafted against the Pre-Application Guidelines section by section, so each
answer can be pasted into the corresponding form field.

**Category A (TRL 4) · Track 2 — AI-Enabled Care and Triage**

> **Before submitting:** two facts in this document are not yet true and are
> marked `[CONFIRM]`. Do not submit with either unresolved — the entity status
> is an eligibility gate, and a named clinical advisor is the difference between
> a strong answer and a weak one on §7's team criterion.

---

## §4.2 — Product or Technology Description

### 1. A clear description, supported by available evidence

HealthAI Assistant is a **cancer screening triage platform**. It accepts a
medical image, runs a convolutional classifier over it, and routes the result to
a clinician for review. It produces no diagnosis, and no path through the system
bypasses human sign-off.

Two modalities have a trained, evaluated classifier:

| | Skin (dermoscopic) | Lung (chest imaging) |
|---|---|---|
| Balanced accuracy | **0.864** | **0.785** |
| Sensitivity | 0.913 | 0.812 |
| Specificity | 0.814 | 0.757 |
| Held-out test set | 660 images | 554 images |
| Calibration (ECE) | 0.024 | 0.017 |
| Test AUC | — | 0.88 |

Every figure is from a held-out split never used in training or model selection,
and every one is reproducible with a command published in the model card:

```
python scripts/evaluate-model.py <model.h5> <data_dir> <class0> <class1>
```

Breast, colon and prostate are **not** offered. They have no classifier;
requests for them return HTTP 503 with no diagnostic content and queue the scan
for a human. This is stated rather than concealed because a menu with dead
entries is the failure the platform is built to avoid.

### 2. How it functions

```
Image (JPEG/PNG/TIFF/WebP/AVIF, or DICOM)
   │
   ├─ Content verified from magic bytes, not the declared MIME type
   ├─ DICOM: de-identified (PS3.15 Basic Profile) and windowed before anything is stored
   │
   ├─ Pixel-level quality screen ──────────► refuse: blank, blurred, over-exposed
   ├─ Out-of-distribution screen ──────────► refuse: not the kind of image this model reads
   │
   ├─ Classifier (ResNet50V2, resident in memory, ~500 ms)
   ├─ Temperature-calibrated probability
   ├─ Screening operating point (not argmax)
   │
   ├─ Grad-CAM overlay (optional, on request)
   │
   ▼
Radiologist review queue  →  clinician sign-off  →  confirmed outcome recorded
                                                          │
                                                          ▼
                                            production performance, measurable
```

Three properties are worth drawing out:

**The operating point is chosen clinically, not statistically.** The lung
threshold is 0.30 on the calibrated probability, not argmax. Argmax scores
better on balanced accuracy (0.838 vs 0.785) and misses 86 of 282 cancers; the
deployed threshold misses 53. Trading false alarms for missed cancers is the
correct direction for screening, and the full threshold sweep is published.

**Out-of-distribution screening is measured, not asserted.** PCA reconstruction
error in ResNet feature space, thresholded at the 99.5th percentile of the
training features. Wrong-modality images flag at 100%; held-out same-modality
images at 0.8%.

**Confirmed outcomes are recorded per scan.** An append-only `scan_outcomes`
table stores what each scan turned out to be, who established it, and by what
method — histopathology through to clinical follow-up, ranked by evidentiary
strength. `GET /api/models/performance` computes a confusion matrix from those
with denominators and confidence intervals attached. This is the architecture a
post-market surveillance plan requires, built before there is anything to
surveil.

### 3. Technologies used

| Layer | Technology |
|---|---|
| Models | TensorFlow / Keras, ResNet50V2 (ImageNet trunk, frozen; trained head) |
| Inference | FastAPI service holding both models resident, bounded request queue |
| Explainability | Grad-CAM on the final convolutional feature map |
| Medical imaging | pydicom — DICOM ingest, de-identification, modality/VOI LUT windowing |
| Application | Node.js, Express, TypeScript, React, PostgreSQL (Drizzle) |
| Offline | Service worker, IndexedDB queue, background sync |
| Security | AES-GCM at rest under a rotatable keyring, TOTP second factor, append-only audit |
| Genomics | PGS Catalog scoring files, ancestry-aware reporting |
| Observability | Prometheus metrics; separated liveness and readiness probes |

**Device layer:** not built. A costed integration plan naming candidate capture
hardware and a DICOM path from installed radiology equipment is in
`docs/DEVICE_INTEGRATION.md`. Guidelines §3 permits Category A applicants to
demonstrate integration through architecture and development plans, and that is
what is offered rather than an invented capability.

### 4. Evidence of testing and validation

**Model evaluation.** Held-out splits, calibration measured (and applied to lung,
deliberately not applied to skin because it did not improve validation ECE),
out-of-distribution detection measured, threshold sweep published. Skin-tone
performance measured by Individual Typology Angle across 511 of 660 test images.

**Software.** 171 automated tests across 42 suites, run in CI on every push
against an ephemeral PostgreSQL instance. The authorisation matrix exists because
several `/api/doctor/*` routes were once found serving patient names and clinical
notes to anonymous callers — a regression nobody noticed because nothing ran the
checks.

**Accessibility.** Audited against WCAG 2.1 AA with axe-core through a real
browser. Zero violations across the public site, patient dashboard, all five
tabs, both dialogs, and in both themes.

**What has *not* been done, stated plainly:** no clinical validation, no
prospective data, no patients, no regulatory clearance in any jurisdiction, and
no clinician has used the system in practice. `[CONFIRM: revise if a clinical
advisor has by submission.]`

### 5. Intended users and healthcare context

| User | What they do |
|---|---|
| Primary care clinician, CHW | Captures or uploads an image at the point of care |
| Radiologist / dermatologist | Reviews every flagged result; signs off; records the confirmed outcome |
| Patient | Sees that a scan was received and is under review — never an unreviewed finding |
| Administrator | Access review, break-glass oversight, erasure requests |

**Context:** South African district and regional facilities where the constraint
is specialist reading time, not imaging capacity. A scanner that produces images
faster than anyone can read them creates a backlog; triage decides what is read
first.

The system is built for that setting rather than adapted to it: it operates
offline and syncs on reconnect, it runs on one modest instance, and it refuses
rather than guesses when conditions are outside what it was validated for.

### 6. The problem, and the value proposition

**The problem.** South Africa has very few radiologists and dermatologists
relative to population, concentrated in urban and private settings. Images are
acquired in district facilities and wait — sometimes weeks — for a reader. Late
presentation is the dominant driver of cancer mortality here, and a delay
between acquisition and reading is a delay in every downstream step.

**What we do not claim.** This does not replace a specialist, and it is not more
accurate than one. At 0.785 balanced accuracy the lung model misses roughly 1 in
5 cancers and flags 1 in 4 healthy scans.

**What it offers instead:** *ordering*. A queue read in arrival order treats an
urgent scan and a routine one identically. A queue ordered by a calibrated
probability — with every scan still read by a human, and the tool declining to
answer when it should not — puts the concerning scan in front of the specialist
sooner, without removing anyone from the loop.

That is a smaller claim than most clinical AI makes, and it is one the evidence
actually supports.

---

## §4.3 — Innovation and Differentiation

**The innovation is refusal by design.**

Most clinical AI fails in the field not because its accuracy is too low, but
because it answers confidently in situations it was never validated for. It is
handed the wrong modality and returns a verdict. It is handed a blurred frame
and returns a verdict. Its model fails to load and something downstream fills
the gap with a default. Each failure produces output indistinguishable from a
real result.

This platform is architected so that it cannot do those things, and each refusal
is measured rather than asserted:

| Refusal | Mechanism | Measured |
|---|---|---|
| **No validated model** → 503, no diagnostic content, queued for a human | Model registry gated on measured balanced accuracy | Breast, colon, prostate refused; a modality cannot be offered by the UI unless the server will analyse it |
| **Input outside training distribution** → refused, not classified | PCA reconstruction error in feature space | Wrong-modality 100%, in-distribution 0.8% |
| **Degenerate image** → refused | Pixel statistics: variance, level, Laplacian | Blank frames caught, which the feature detector scores as in-distribution |
| **Clinical DICOM to the lung model** → refused explicitly, with the reason | Deterministic gate ahead of the OOD screen | Every window tested: 20.3–30.4 against a 16.51 threshold |
| **Polygenic score that does not transfer** → no percentile shown at all | Ancestry transferability, Martin et al. 2019 | African-ancestry percentiles withheld entirely |
| **Partially translated language** → not offered | Safety-critical key gate plus human sign-off | Spanish withheld: 29 navigation keys, no clinical text |

Three of these deserve specific mention.

**The lung model refuses real DICOM, and we published that.** DICOM ingest was
built, pointed at genuine clinical objects, and immediately established that the
lung classifier — trained on web-sourced images of unrecorded provenance —
refuses every real acquisition. Correcting the windowing did not help; the
radiologically correct lung window scores *worse*. This is documented in the
model card as a blocking limitation, with retraining on a documented CT dataset
named as the first item of clinical work.

A system that accepted that CT and returned a probability would have
demonstrated better and been worthless in a clinic.

**The skin fairness finding is negative, and published.** Skin tone was measured
across the test set. The conclusion is that **the dataset cannot establish
performance on darker skin** — only 4.3% of images are brown or darker, and the
Dark bin holds four images with no benign controls. The model card states in
bold that absence of a measured disparity is evidence of an unrepresentative
test set, not of fairness.

For a South African deployment this is the most important thing in the
documentation, and publishing it rather than an encouraging aggregate is the
differentiator.

**Genomics that withholds.** Polygenic scores use a real PGS Catalog panel
(PGS000339, Law et al. 2020) rather than invented weights. For African-ancestry
patients no percentile is reported at all, because the reference distribution is
European and ranking against it would not mean what it appears to. Unknown
ancestry is never defaulted to European — that is the assumption which produces
confident wrong answers for most of the world.

**Distinguishing features versus existing technologies:** calibration measured
and reported; a screening operating point chosen on clinical grounds with the
full sweep published; per-scan model provenance derived from a hash of the
artifact so a stored result can always be explained; and an outcome-recording
loop that makes production performance measurable rather than assumed.

---

## §4.4 — Market and Impact

### Target market and end users

**Primary:** South African public-sector district and regional hospitals, where
imaging capacity exceeds specialist reading capacity. Entry through a single
facility pilot with a named radiology or dermatology department.

**Secondary:** private practice groups and pathology networks with the same
bottleneck and faster procurement.

**Adjacent:** the same constraint holds across much of sub-Saharan Africa, and
the offline-first design was built for it rather than retrofitted.

Deliberately not quantified here. Earlier versions of this project's material
carried a total addressable market and facility counts that were not derived
from anything, and they have been removed rather than re-estimated. A number we
cannot source is worth less than the admission that we do not have one.

### Anticipated impact

**Health outcomes.** The mechanism is time-to-read, not accuracy. Whether
ordering a reading queue by calibrated probability shortens time-to-diagnosis
for the scans where it matters is a measurable question, and the platform
already records what is needed to answer it. We would rather measure it in a
pilot than assert it in an application.

**Access.** Offline capture and sync means a facility with intermittent
connectivity can use the system, and a clinician can photograph a lesion in a
ward with no signal and have it upload later. Nothing is analysed offline and
nothing pretends to be.

**Cost.** The DICOM path is the striking figure: **zero capital cost per site**,
because the scanner is already installed and already emitting the protocol. It
is not being read promptly, which is a workflow problem rather than an equipment
one. Dermoscopic capture is R14,500–R28,500 per site indicative, pending
quotation.

**System-level.** Confirmed outcomes recorded against predictions give a
facility its own measured performance rather than a vendor's brochure figure —
which is what a procurement decision and a post-market surveillance plan both
actually need.

**Social impact in resource-limited settings.** The honest version: this
platform's own documentation shows that its skin model cannot be shown to work
on darker skin, because the public datasets it was trained on are 96%
light-skinned. That is a statement about the field, not only about us. A capture
programme in South African clinics would build precisely the dataset that does
not currently exist — a contribution beyond this platform, and the reason the
dermatology partnership is the first item on our roadmap rather than a later
one.

---

## §6 — Operational and Implementation Readiness

Category A is assessed on technical feasibility, validation progress and future
development plans.

**Feasibility — demonstrated.** Working prototype: 171 tests green in CI, warm
inference ~500 ms behind a bounded queue, offline capture and sync, DICOM ingest
with de-identification, second factor, POPIA-compliant cross-border consent.

**Validation progress — partial and stated.** Held-out evaluation with
calibration and OOD screening measured. No clinical validation, no patients.

**Development plan — the next twelve months:**

| Quarter | Work |
|---|---|
| Q4 2026 | Retrain lung on a documented CT dataset (LIDC-IDRI/NLST), patient-level splits. Retrospective validation on one SA facility's confirmed outcomes through the existing surveillance endpoint. Reader study, 3–5 clinicians, with and without the tool. |
| Q1 2027 | SAHPRA pre-submission engagement; IMDRF SaMD risk classification; ISO 14971 risk file; IEC 62304 lifecycle records. FHIR R4 conformance. Independent penetration test. |
| Q2 2027 | Prospective clinical investigation under an approved protocol. Fitzpatrick V–VI dataset acquisition with a dermatology partner. |
| Q3 2027 | Multi-site pilot; ISO 13485 QMS. |

**Regulatory position, stated rather than implied.** Software informing a
clinical decision is a medical device under the Medicines and Related Substances
Act. We hold no SAHPRA registration, have made no submission, and make no
compliance claim. Expected classification is Class B/IIa software as a medical
device, to be confirmed at pre-submission.

---

## Team

`[CONFIRM]` — complete before submission.

| Role | Status |
|---|---|
| Technical lead | Named |
| Clinical advisor (radiologist or dermatologist) | **Outstanding.** See `docs/CLINICAL_ADVISOR_BRIEF.md`. |
| Regulatory adviser | Outstanding |
| Entity | **[CONFIRM]** CIPC-registered SMME or institutional affiliation |

Guidelines §4.1 rewards multidisciplinary teams and §7 scores clinical utility.
Both weaknesses are real and neither is disguised here.

---

## Supporting documents

| Document | Covers |
|---|---|
| `docs/pack/model-cards.pdf` | Every figure, with reproduction commands and every limitation |
| `docs/pack/architecture.pdf` | The three §2 components and the refusal paths |
| `docs/DEVICE_INTEGRATION.md` | Device layer plan, costed, with partner targets |
| `docs/DPIA.md` | POPIA assessment; 16 risks including six unmet conditions |
| `docs/RETENTION.md` | Retention schedule and erasure, with what is not yet implemented |
| `docs/ACCESSIBILITY.md` | WCAG 2.1 AA audit and what it does not cover |
| `docs/pack/FAILURE_MODES.md` | What happens when each part fails, and who is accountable |
| `docs/pack/DEMO_SCRIPT.md` | Demonstration, including the refusal paths |
