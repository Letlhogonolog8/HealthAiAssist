# Device Integration Architecture

**Status: planned, not built.** Everything in this document that is not marked
*Implemented* is a development plan. It is written this way deliberately — see
"Why this document exists" below.

---

## Why this document exists

The 2026 SA MedTech Innovation Challenge asks (Pre-Application Guidelines §2)
that a submission demonstrate system-level integration across three components:

| Component | This platform |
|---|---|
| Hardware or device capability | **Absent.** No sensor, no instrument, no capture hardware. |
| AI-enabled functionality and decision support | Implemented. One serving evaluated classifier (skin) with calibration, out-of-distribution screening and a screening operating point; a second (lung) evaluated, served, and withdrawn by that screening on 20 September 2026; a third (LIDC-IDRI nodule characteriser) trained and awaiting a binding. See [MODEL_CARDS.md](../MODEL_CARDS.md). |
| Secure workflow integration supporting triage and referral | Implemented. Role-scoped review queues, append-only audit, POPIA §72 consent handling for cross-border processing. |

Two of three. The honest response is not to describe a device we do not have.

Guidelines §3 permits Category A applicants to demonstrate integration through
"prototypes, system architecture, development plans, or partnership
arrangements". This document is that: a specific capture path for each modality,
with named candidate hardware, an integration design, indicative costs, and what
would have to be true for it to work.

An architected plan that says what has not been built yet is worth more than an
invented capability, and it is what the clause is there for.

---

## The gap, precisely stated

The platform accepts an uploaded JPEG, PNG, TIFF, WebP or AVIF file. It does not
care where the image came from, and it has no way of knowing.

That is a real limitation, not a cosmetic one, and it shows up in the model
cards. The skin classifier was trained on dermoscopic images: polarised,
contact or near-contact, controlled illumination, lesion filling a large
fraction of the frame. A photograph taken with an unaided phone camera at arm's
length is a different distribution. The out-of-distribution detector will refuse
many such images — correctly — but "the tool refuses most of what our clinic
photographs" is a deployment failure even when every individual refusal is right.

**The device layer is not an accessory to the AI. It is what makes the AI's
training distribution reachable in a clinic.**

---

## Track A — Dermoscopic capture for the skin classifier

### The requirement

Derived from what the model was trained on, not from a product catalogue:

| Property | Requirement | Why |
|---|---|---|
| Illumination | Cross-polarised, or immersion contact | Removes surface glare; the training images have it |
| Magnification | ~10× | Matches dermoscopic field of view |
| Field of view | Lesion occupying 40–80% of frame | Outside this the OOD detector rejects |
| Resolution | ≥ 1024×1024 at the lesion | Model input is 224×224; headroom for crop and re-review |
| Colour | Fixed white balance, or a reference card in frame | ITA-based skin-tone estimation depends on it — see below |

### Candidate hardware

Clip-on dermoscope attachments for smartphones. Indicative, requiring quotation
for South African supply:

| Option | Approx. unit cost (indicative, ZAR) | Notes |
|---|---|---|
| DermLite DL1 / DL200 class | R 4 000 – R 9 000 | Clinical standard; cross-polarised; broad phone compatibility via magnetic mount |
| Generic 10× polarised clip-on macro | R 400 – R 1 200 | Materially cheaper, materially more variable. Would need its own validation before use — see below |
| Existing clinic dermatoscope + phone adapter | R 1 000 – R 2 500 for the adapter alone | Lowest cost where a dermatoscope is already on site |

Figures are indicative ranges pending supplier quotation. They are here to show
the order of magnitude of a deployment, not to be quoted as a price.

### The validation obligation this creates

A cheaper attachment is not simply a cheaper version of an expensive one. Optics
change the image distribution, and the model's measured performance is a
statement about one distribution.

**Any capture device adopted must be validated as part of the system**, by
re-measuring sensitivity and specificity on images that device produced. This is
not optional and not a formality: it is the same reasoning that made the lung
model's original figures untrustworthy — a metric measured on data the deployed
configuration never sees does not describe the deployed configuration.

Budget for this: several hundred device-captured images with confirmed outcomes,
per device model.

### The equity opportunity

The skin model's largest documented weakness is that its test set is 96%
light-skinned, and the model card states plainly that the dataset **cannot**
establish performance on Fitzpatrick V–VI skin.

A capture programme is the realistic route to closing that. Images collected
through a deployed device, in South African clinics, with recorded outcomes,
would build exactly the dataset that does not currently exist anywhere in this
project — and, given how under-represented darker skin is in public dermatology
datasets generally, would be a contribution beyond this platform.

Requiring a colour reference card in frame at capture time turns skin-tone
estimation from a pixel-based approximation (Individual Typology Angle, which
the model card notes is sensitive to lighting and white balance) into something
closer to a measurement.

---

## Track B — DICOM ingest for the lung classifier

### The requirement

Lung imaging is not photographed. It is produced by installed hardware — CT, CR,
DR — which already emits DICOM to a PACS. The device integration here is not new
hardware. It is speaking the protocol the existing hardware already speaks.

**The half of this that does not need a clinic network is built.** A CT series
can be ingested, quality-gated and stored de-identified today (roadmap P1b,
2026-09-22); what remains is the receiver that would let a modality send one
without a human exporting it.

### Design

```
  CT / CR modality
        │  DICOM C-STORE
        ▼
  ┌───────────────────┐
  │  DICOM receiver   │   pynetdicom SCP, inside the clinic network
  │  (Storage SCP)    │
  └─────────┬─────────┘
            │  1. De-identify  (PS3.15 Basic Application Level
            │                   Confidentiality Profile)
            │  2. Window/level from tags → 8-bit RGB
            │  3. Resize to 224×224
            ▼
  ┌───────────────────┐
  │ Inference service │   already built — inference/server.py
  │  resident models  │   ~500 ms, bounded queue
  └─────────┬─────────┘
            │  calibrated probability + OOD verdict
            ▼
  ┌───────────────────┐
  │ Review queue      │   already built — radiologist worklist,
  │  + audit trail    │   append-only audit, outcome recording
  └───────────────────┘
```

De-identification happens **before** anything leaves the clinic network in the
receiver design above, and — since 2026-09-21 — before anything is stored in
the upload path that exists today: `inference/dicom_ingest.py` de-identifies
the object (identifiers, private tags, dates to the year) and hands it back,
and `server/routes.ts` persists that object, never the upload. If the service
is unavailable the object is not stored at all.

Since **2026-09-22** the same rule covers a whole series, with one change: the
study, series and instance UIDs are **remapped** rather than replaced with
fresh ones. Replacing them destroys the tree that makes a pile of objects a
series, so nothing could be assembled or compared with a prior. The remap is a
salted HMAC emitted under the `2.25.` UUID-derived root, which keeps the
grouping and is not invertible without `DICOM_UID_SALT`
(`inference/uid_remap.py`, DPIA R-22). The identified uploads themselves live
only in a per-request staging directory that is removed whatever happens to the
request (DPIA R-21).

The de-identifier remains a best-effort PS3.15 Basic Profile implementation,
not a validated one (DPIA R-19).

### Built, what it appeared to reveal, and what it actually revealed

DICOM ingest is implemented (`inference/dicom_ingest.py`): detection from the
DICM preamble rather than a filename or Content-Type, de-identification of the
rendered object, modality LUT then VOI LUT windowing in the order the standard
fixes, MONOCHROME1 inversion, and multi-frame handling.

**In August** the first object put through it — pydicom's bundled
`CT_small.dcm`, a 128×128 GE acquisition from the 1990s — scored 22.88 against
the lung model's 16.51 out-of-distribution threshold and was refused. This
document, the model card and the application text concluded that **the lung
model refuses real clinical objects** and that the pipeline was complete but
the model trained on the wrong thing.

**On 20 September** the same measurement was made on what a chest CT actually
looks like — 87 LIDC-IDRI slices rendered at the lung window by this module,
and 12 LIDC DICOM objects through `dicom_to_png_bytes`. The screen passed 84 of
87 and 11 of 12 (median scores 12.3 and 14.2, the same range as the model's
own web-sourced test set), and the model issued cancer / no_cancer verdicts on
them. Real chest CT is inside that model's training distribution in feature
space; a reconstruction-error screen cannot separate it. The model was trained
on web-scraped chest imagery and had **no measured performance on CT**, so
those verdicts were guesses. It was withdrawn from serving the same day
(`MODEL_CARDS.md`, `docs/MODEL_CHANGELOG.md`).

Three consequences for this plan:

1. Track B is **unblocked on the engineering and blocked on the model**, as
   before — but the model that was serving was not a safe placeholder while
   the replacement was built. It is now off.
2. The replacement exists: the LIDC-IDRI nodule characteriser in
   `dataset/lung_nodule_model/`, trained on patient-level splits, calibrated,
   with an OOD reference validated in both directions that refuses whole
   slices at 90.8%. It answers a narrower question — the malignancy of a
   nodule a clinician has marked — and it must be served with the same
   windowing it was trained on (`training_window()` in `dicom_ingest.py`),
   which the serving path does not yet apply. Binding it is the first
   engineering item after this submission.
3. The input screening is not decorative — it is what found the problem, once
   pointed at the right domain. The lesson recorded in the model card is that a
   refuse-domain measured on a convenience object is not a measurement, and
   every future reference is validated against real acquisitions of the
   modality it exists to refuse.

### Why this closes the §2 gap credibly

The Challenge's own problem statement is about modernising *mechanical, analogue
and legacy* diagnostic systems. A CT scanner that emits DICOM to a PACS nobody
reads for three weeks is precisely a legacy diagnostic workflow. Adding an
AI-triaged queue behind it — without replacing the scanner — is the
modernisation the Challenge describes, and it requires no new hardware at all.

---

## What is already implemented

Not everything here is future work. The following exist today and are what the
device layer would connect to:

| Capability | Where |
|---|---|
| DICOM ingest: training-window render, de-identification, and the de-identified object is what is persisted | `inference/dicom_ingest.py`, `server/routes.ts` |
| Lung nodule characterisation on a clinician-marked DICOM slice, under VALIDATION terms | `inference/lung_nodule_service.py`, `client/src/components/lung-nodule-tool.tsx` |
| Grad-CAM explanation overlays, refused where the model refused | `inference/gradcam.py` |
| Resident-model inference, ~500 ms, bounded queue | `inference/server.py` |
| Out-of-distribution refusal, validated in both directions with pre-set bars — and able to fail, which withdrew the lung model | `server/skin_cancer_model.py`, `scripts/build-ood-reference.py` |
| Calibrated probabilities and a screening operating point | [MODEL_CARDS.md](../MODEL_CARDS.md) |
| Model provenance recorded per scan, hashed from the artifact | `server/model-fingerprint.ts` |
| Private object storage for images, signed short-lived reads | `server/google-cloud-service.ts` |
| Role-scoped review queue and sign-off | `server/routes.ts`, radiologist dashboard |
| Append-only audit trail | `shared/schema.ts` — `audit_events` |
| Outcome recording and production performance measurement | `GET /api/models/performance` |

The device layer is the missing input stage of a pipeline whose remaining stages
are built and tested.

---

## Partnership targets

Named because §3 asks for partnership arrangements, and because a plan with no
named counterparty is a wish.

| Target | What we would ask for | Why them |
|---|---|---|
| **UCT MedTech** | Device selection guidance; access to a validation cohort | A Challenge partner, and the closest South African concentration of medical-device engineering expertise |
| A university dermatology department | Dermoscope-captured images with confirmed outcomes, with meaningful Fitzpatrick V–VI representation | The only route to closing the documented fairness gap |
| A district or regional hospital radiology unit | A DICOM feed from one modality, in a pilot | Track B needs one real PACS to be real |
| **Western Cape Medical Devices Cluster** | Local supply and manufacturing routes for the capture attachment | A Challenge partner; local supply matters for cost and support |

---

## Indicative cost per deployed site

| Item | Indicative (ZAR) |
|---|---|
| Dermoscope attachment × 2 | R 8 000 – R 18 000 |
| Android device × 2 (mid-range, if not already present) | R 6 000 – R 10 000 |
| Colour reference cards, consumables | R 500 |
| DICOM receiver — software only, existing hardware | R 0 capital |
| **Capital per site** | **R 14 500 – R 28 500** |

Recurring cost is hosting and the inference instance, shared across sites rather
than per-site.

The DICOM path is the striking figure here: **zero capital cost**, because the
hardware is already installed and already emitting the protocol. That is the
strongest argument for the modernisation framing — the device exists, it is just
not connected to anything that reads its output promptly.

---

## Honest summary

- **Not built:** dermoscopic capture, device validation, and the DICOM
  receiver itself — nothing listens for a C-STORE association or queries a
  DICOMweb endpoint, so a study still reaches this platform because somebody
  exported it (declared in the capability manifest as `dicom-network-receive`,
  PLANNED). Series ingest itself is listed as IN_DEVELOPMENT rather than
  CURRENT: that status is reserved for a measured, fingerprint-bound model, and
  ingesting a study involves no model at all.
- **Built:** single-object DICOM ingest with de-identification and windowing;
  and, since 2026-09-22, **series ingest with a CT quality gate** — a study is
  assembled by `SeriesInstanceUID`, ordered by projecting
  `ImagePositionPatient` onto the slice normal, checked against bars measured
  on 30 LIDC-IDRI series, and stored de-identified with its study/series/
  instance tree intact (`POST /api/dicom/series`). Ingest is not
  interpretation: no model reads a series yet. Everything downstream of a
  single image — inference, refusal, review, audit, outcome measurement —
  remains as built.
- **Serving under validation terms:** the LIDC-IDRI nodule characteriser,
  bound 21 September 2026 — a clinician marks one nodule on a DICOM CT slice
  and receives a calibrated probability with its evidence attached. The
  web-trained lung model it replaces was withdrawn on 20 September when the
  refusal machinery, pointed at real CT, found it answering.
- **Required before clinical use of any capture device:** re-measurement of
  sensitivity and specificity on images that device produced. A device changes
  the input distribution, and the published figures describe one distribution.

This is a Category A submission at TRL 4. The device layer is a development plan
with named hardware, a named protocol, named partners and an indicative budget —
which is what Guidelines §3 asks Category A applicants to provide, and what we
have.
