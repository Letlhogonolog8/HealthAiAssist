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

Two models serve, under different terms, and a third was withdrawn by the
platform's own safety process:

| | Skin (dermoscopic) — **CURRENT** | Lung nodule (CT, clinician-marked) — **VALIDATION** | Lung (web-trained) — **withdrawn 20 Sep 2026** |
|---|---|---|---|
| Balanced accuracy | **0.864** | 0.777 | 0.785 |
| Sensitivity | 0.913 | 0.862 (25 of 29; 95% CI 0.69–0.95) | 0.812 |
| Specificity | 0.814 | 0.691 (47 of 68; 95% CI 0.57–0.79) | 0.757 |
| Held-out test set | 660 images | **97 LIDC-IDRI nodules, 29 malignant**, patient-level split | 554 web-sourced images — not CT |
| Calibration (ECE) | 0.024 | 0.040 | 0.017 |
| Reference standard | dataset label | radiologist rating, not histology | dataset label, provenance unrecorded |

The nodule characteriser is served under **validation terms**: a radiologist
or doctor marks one nodule on a DICOM CT slice and receives the probability
that a radiologist would rate it malignant, with the threshold, calibration,
out-of-distribution score, model fingerprint and evidence class attached. It
does not find nodules, refuses raster exports (no pixel scale), refuses whole
slices, and its interval is stated everywhere it is shown because 29 malignant
nodules is a small number.

Every figure is from a held-out split never used in training or model selection,
and every one is reproducible with a command published in the model card:

```
python scripts/evaluate-model.py <model.h5> <data_dir> <class0> <class1>
```

**Why lung was withdrawn.** The lung classifier was trained on web-sourced
chest images of unrecorded provenance, and its figures describe that data. Its
out-of-distribution screen had been believed to refuse real CT, on the strength
of one bundled test object. Measured against 87 real LIDC-IDRI chest CT slices
through the serving code, the screen passed 84 of them and the model issued
verdicts on images it had never been measured on. A verdict with no measured
basis is a guess; the platform's rule is to refuse rather than guess; the model
was switched off the same day, and the measurement that did it is committed
(`scripts/build-ood-reference.py lung --measure-only` exits non-zero). Lung
scans are now stored and queued for a radiologist with no automated result.

The replacement — the nodule characteriser above — was bound on 21 September
through the same governance step that withdrew its predecessor: figures
reproduced against the artifact by a named script, fingerprint recorded, card
written, and the serving path corrected to render CT exactly as the training
patches were rendered (the previous serving path honoured the display preset
saved in the tags, which blacks out the lung field on roughly 40% of series).

Breast, colon and prostate are **not** offered. They have no classifier;
requests for them return HTTP 503 with no diagnostic content and queue the scan
for a human. This is stated rather than concealed because a menu with dead
entries is the failure the platform is built to avoid.

### 2. How it functions

```
Image (JPEG/PNG/TIFF/WebP/AVIF, or DICOM; lung nodule: DICOM only, plus a clinician's mark)
   │
   ├─ Content verified from magic bytes, not the declared MIME type
   ├─ DICOM: rendered at the training window, de-identified (PS3.15 Basic Profile,
   │         instance UIDs replaced) — and the de-identified object is what is stored
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

**The operating point is chosen clinically, not statistically.** The skin
model bands its output (malignant above 0.70, uncertain 0.30–0.70, benign at or
below 0.30) rather than taking argmax: strict sensitivity falls from 0.91 to
0.78, but the outright-miss rate — a malignant lesion told it is benign — falls
to 3.3%, and everything in the uncertain band goes to a clinician. The lung
model, while it served, used a threshold of 0.30 on the calibrated probability
for the same reason: argmax missed 86 of 282 cancers, the deployed point 53.
Both sweeps are published.

**Out-of-distribution screening is measured in both directions, and the
measurement can fail.** PCA reconstruction error in ResNet feature space,
thresholded at the 99.5th percentile of the training features, validated
against domains the model must accept and domains it must refuse, with the bars
set before measurement. For skin: wrong-modality images flag at 100%, held-out
lesions at 0.8%. For lung the same script, pointed at real CT, measured 3.4%
against a 90% bar — and that failure is what withdrew the model.

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
| Inference | FastAPI service holding the models resident, bounded request queue; the nodule characteriser has no subprocess fallback by design |
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

**Model evaluation.** Held-out splits, calibration measured (and applied to lung
while it served, deliberately not applied to skin because it did not improve
validation ECE), out-of-distribution detection measured in both directions,
threshold sweeps published. Skin-tone performance measured by Individual
Typology Angle across 511 of 660 test images. The lung model's withdrawal is
itself evidence of testing: the failure was found by the platform's own
validation script, not by a reviewer.

**Software.** 251 automated tests across 65 suites, run in CI on every push
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
accurate than one. At its banded operating point the skin model gives 1 in 30
malignant lesions an outright benign result and sends 1 in 4 harmless lesions
to a clinician as flagged or uncertain. No lung model is serving at all.

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
| **A model found answering questions it was never measured on** → withdrawn | The OOD validation script's pre-set bar, applied to real CT | Lung: 84 of 87 LIDC-IDRI slices passed the screen; model switched off the same day |
| **Clinical DICOM to a model with no CT measurement** → refused explicitly, with the reason | Deterministic gate on the DICOM preamble, ahead of any model | Every DICOM object refused; a PNG export was not, which is why the row above exists |
| **Polygenic score that does not transfer** → no percentile shown at all | Ancestry transferability, Martin et al. 2019 | African-ancestry percentiles withheld entirely |
| **Partially translated language** → not offered | Safety-critical key gate plus human sign-off | Spanish withheld: 29 navigation keys, no clinical text |

Three of these deserve specific mention.

**The platform withdrew its own lung model, and we published that.** DICOM
ingest was built in August and pointed at one bundled test object, which the
lung classifier refused. That was read as "the model refuses every real
acquisition" and written up as a safety property. In September the same
out-of-distribution validation script was pointed at 87 real LIDC-IDRI chest CT
slices: the screen passed 84 of them, and the classifier — trained on
web-sourced images with no measured performance on CT — issued verdicts on
them. The measurement is committed and the script now exits non-zero; the model
was switched off that day; the earlier claim is retracted on the model card,
with the reason.

A system that kept that model serving because the failure was inconvenient five
days before a submission would have demonstrated better and been worthless in a
clinic. The one that switched it off is the one being submitted.

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
one. The ingest, de-identification and windowing for that path are built; the
model behind it is not yet bound, so today a DICOM upload is refused and queued
rather than scored. Dermoscopic capture is R14,500–R28,500 per site indicative,
pending quotation.

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
calibration and OOD screening measured in both directions; one model withdrawn
by that screening on 20 September 2026. No clinical validation, no patients.

**Development plan — the next twelve months:**

| Quarter | Work |
|---|---|
| Q4 2026 | DICOM series ingest with a CT quality gate and salted UID remap (P1b); pretrained nodule detector adopted and re-validated per nodule against a pre-registered bar (P2); structured clinician review with a disagreement metric (P6). Retrospective validation on one SA facility's confirmed outcomes through the existing surveillance endpoint. Reader study, 3–5 clinicians, with and without the tool. |
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
