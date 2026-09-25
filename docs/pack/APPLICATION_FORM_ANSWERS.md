# Application form answers — Step 4, Product/Technology Details

2026 SA MedTech Innovation Challenge · Category A · Track 2 · Novaryx Technologie.
One section per form field, in form order, each within its word limit. Every
figure is from the repository's own measurements (`MODEL_CARDS.md`,
`docs/pack/SUBMISSION_CHECKLIST.md`, `docs/DEVICE_INTEGRATION.md`, `docs/DPIA.md`).
Text in `[square brackets]` must be replaced by the applicant before pasting.

---

## IDENTIFICATION

### Official name of the technology or product (max 20 words)

HealthAI Assistant — clinician-in-the-loop AI triage for skin lesion and lung CT imaging

---

## INNOVATION AND VALUE ADDITION

### Type of device (max 250 words)

Workflow system: software as a medical device (SaMD) for AI-assisted triage. It is not a diagnostic device and makes no diagnosis.

HealthAI Assistant is a web platform that sits behind imaging equipment clinics already have. A clinician uploads a dermoscopic skin image, or a CT study arrives as DICOM. The platform checks image quality and whether the image is the kind its models were measured on, runs a calibrated classifier where a validated one exists, and places the case in a review queue for a clinician, who makes every decision.

Primary intended use: to help clinicians decide what to read first. A calibrated probability orders the specialist's reading queue, so a concerning scan is seen sooner, while every scan is still read by a human.

Two AI components serve today:
- A skin lesion classifier (dermoscopic images).
- A lung nodule characteriser: a radiologist marks a nodule on a CT slice and receives the probability that a radiologist would rate it malignant, under validation terms.

Around them sits a secure clinical workflow: consented, de-identified image storage, a radiologist review queue, recorded clinician outcomes, audit logging, second-factor authentication and offline capture with later sync.

Breast, colon and prostate have no validated model and are not offered. Requests for them are refused and queued for a human rather than answered.

Expected regulatory classification is Class B/IIa SaMD, to be confirmed through SAHPRA pre-submission engagement. No regulatory clearance is held or claimed.

### Novelty and unique aspects, compared with current standard products (max 250 words)

The innovation is refusal by design. Most clinical AI fails in the field not because its accuracy is low, but because it answers confidently on inputs it was never validated for: the wrong modality, a blurred frame, a model that failed to load. HealthAI Assistant is built so that each of these produces a refusal and a human review, never a guess.

Distinctive, and measured rather than asserted:
- Out-of-distribution screening measured in both directions: wrong-modality images refused 100% of the time; in-distribution images wrongly refused 0.8%.
- A model with no validated basis cannot be offered: the interface only lists modalities the server will analyse; others return "no model" and queue for a clinician.
- Our own validation withdrew one of our models. Tested on 87 real chest CT slices, our web-trained lung model's input screen let 84 through. We switched it off the same day and published why.
- Calibrated probabilities with the clinical operating point and full threshold sweep published, not a bare "accuracy".
- Every result carries the exact model fingerprint, so a stored result can always be explained.
- Confirmed outcomes are recorded per scan, so a facility can measure its own real-world performance.
- A published fairness finding: public skin datasets cannot establish performance on darker skin.

Standard products typically market one accuracy figure and answer any input. This platform publishes its miss rates and declines to answer outside what was measured.

### Advantages — cost, access, accuracy (max 250 words)

Cost:
- CT path: zero capital cost per site. It reads DICOM from scanners already installed; the bottleneck is reading time, not equipment.
- Skin path: indicative R14,500–R28,500 per site (two dermoscope attachments and two mid-range Android devices), pending supplier quotation.
- Runs on one modest cloud instance shared across sites. No GPU is needed to serve: warm inference is about 0.5 seconds.

Access:
- Offline-first capture: a clinician can photograph a lesion with no signal; the image is queued on the device and uploads when connectivity returns.
- Browser-based, works on existing phones and computers, no installation.
- Audited against WCAG 2.1 AA accessibility: zero violations.

Accuracy, stated honestly:
- Skin classifier on 660 held-out images: sensitivity 0.913, specificity 0.814, balanced accuracy 0.864, well calibrated (ECE 0.024). At its banded operating point about 1 in 30 malignant lesions is told benign, and uncertain cases go to a clinician.
- Lung nodule characteriser on 97 held-out LIDC-IDRI nodules (29 malignant): sensitivity 0.862 (95% CI 0.69–0.95), specificity 0.691 (0.57–0.79), against radiologist ratings, not histology.

The advantage is not higher accuracy than a specialist — we do not claim that. It is safe ordering of the reading queue, refusal outside validated conditions, and measurable real-world performance through recorded outcomes.

### Evidence of proof-of-concept or pilot testing (max 250 words)

Proof of concept is demonstrated in a laboratory setting on public datasets. No clinical pilot has been run and no patients have used the system.

Model evaluation on held-out data never used for training or model selection:
- Skin: 660 images; sensitivity 0.913, specificity 0.814, calibration error 0.024; threshold sweep published.
- Lung nodule characteriser: 97 nodules from LIDC-IDRI (a public CT research dataset), split by patient; sensitivity 0.862, specificity 0.691, with 95% confidence intervals.
- Out-of-distribution screening: wrong-modality images refused 100%; held-out in-distribution images wrongly refused 0.8%.

Safety testing: the same validation process, applied to 87 real chest CT slices, found that our earlier lung model accepted images it had never been measured on. It was withdrawn the same day — evidence that the testing catches real failures.

Software testing: 324 TypeScript and 541 Python automated tests, covering authorisation between patients and clinicians, consent, refusal paths, DICOM handling and de-identification, configured to run in continuous integration on every change.

Demonstration rehearsal on a running system: a skin result with explanation overlay; a chest image refused by the skin model; an unsupported modality refused and queued; a CT sent to the withdrawn model refused with its reason. Every figure was confirmed live.

Load test: about 2 scans per second per instance; with 30 simultaneous requests, 27 were served and 3 were deliberately shed with a retry signal rather than failing.

Every figure is reproducible from commands in the model cards.

---

## CLINICAL UTILITY & USABILITY

### Intended clinical use and target users (max 250 words)

Intended use: AI-assisted triage and decision support for skin lesions and CT-detected lung nodules. The output orders a clinician's reading queue and offers a calibrated second opinion. It does not diagnose, and no result reaches a patient without clinician review.

Users:
- Primary care clinicians and community health workers capture or upload a dermoscopic image at the point of care, including offline.
- Radiologists and dermatologists review every flagged result, sign off, and record the confirmed outcome. For lung CT, a radiologist marks a nodule and receives the characteriser's assessment.
- Patients see that their scan was received and is under review — never an unreviewed finding.
- Administrators manage access, break-glass oversight and data-subject requests.

Beneficiaries: patients waiting for a specialist read, especially in facilities where images are captured faster than they can be read; specialists, whose limited time goes to the most concerning cases first; and facilities, which gain their own measured performance data.

Setting: South African public-sector district and regional hospitals and clinics, where specialist reading capacity, not imaging capacity, is the constraint, and connectivity may be intermittent. Secondary: private practice groups with the same bottleneck.

Not intended for: autonomous diagnosis, screening without clinician review, children, or modalities without a validated model (breast, colon and prostate are refused). The skin model's performance on darker skin types cannot yet be established, and users are told so.

### Data or references supporting the clinical need (max 250 words)

The need is a reading bottleneck. Specialist radiologists and dermatologists in South Africa are few relative to the population and concentrated in urban and private settings, while images are acquired in district facilities. When capture outpaces reading, images wait, and every downstream step — referral, biopsy, treatment — waits with them. Late presentation is a dominant driver of cancer mortality, so the time between acquisition and reading matters.

Evidence from this project's own work supports two further, specific needs:

1. Equity in skin AI. We measured skin tone across our 660-image test set: only 4.3% of images are brown or darker, and the darkest group has four images and no benign controls. Public dermatology datasets cannot establish AI performance for most South African patients. A local capture programme would build the data that does not yet exist.

2. Safety of AI on real clinical images. Our web-trained lung model accepted 84 of 87 real CT slices it had never been measured on. Models trained on convenience data and deployed without input screening give confident answers on the wrong images — a documented risk this platform is built to prevent.

The platform records what is needed to measure its benefit in a pilot: time from capture to read, and confirmed outcomes per scan.

Supporting documents: model cards (measurements and reproduction commands), architecture, failure-modes analysis, and the DPIA.

### Early results — lab, simulation, pilot (max 250 words)

Laboratory results on public data; no clinical pilot yet.

Skin classifier (ResNet50V2, 660 held-out images):
- Sensitivity 0.913, specificity 0.814, balanced accuracy 0.864.
- Calibration error (ECE) 0.024.
- Banded operating point: malignant above 0.70, uncertain 0.30–0.70, benign at or below 0.30. The outright-miss rate (malignant told benign) falls to 3.3%; about 1 in 6 scans lands in the uncertain band and goes to a clinician.

Lung nodule characteriser (LIDC-IDRI CT, 97 held-out nodules, 29 rated malignant, patient-level split):
- Sensitivity 0.862 (95% CI 0.69–0.95), specificity 0.691 (0.57–0.79), balanced accuracy 0.777, ECE 0.040.
- The reference is radiologist rating, not histology; the interval is wide because 29 malignant nodules is a small number, and we state that wherever the result is shown.

Safety screening:
- Out-of-distribution detection: wrong-modality images refused 100%, in-distribution wrongly refused 0.8%.
- Real-CT validation of our earlier lung model: 84 of 87 real slices passed its screen, so the model was withdrawn.

System performance:
- Warm inference about 470 ms; about 1.7 s with the explainability overlay.
- About 2 scans per second per instance; overload is shed with a retry signal, never a crash or a guessed result.

In development: a CT nodule-finding model. The training pipeline, patient-disjoint data split and evaluation method are built; no model has been trained yet.

### Expected clinical and system outcomes (max 250 words)

For patients: concerning scans read sooner, because the queue is ordered by calibrated probability rather than arrival time; no unreviewed AI finding ever shown; consent-based, de-identified handling of their images.

For healthcare professionals: specialist time directed to the cases most likely to need it; a calibrated second opinion with its known error rates stated in frequencies (for example, about 1 malignant lesion in 30 told benign by the skin model); explanation overlays showing where the model looked; clear refusals when an image is outside what the model was validated on.

For facilities: measured, local performance. Clinicians record the confirmed outcome for each scan, and the platform computes the facility's own sensitivity and specificity with confidence intervals — the basis for procurement decisions and post-market surveillance.

Workflow changes: capture can happen offline and sync later; DICOM from existing scanners feeds the same queue without new equipment; every access and decision is audited.

Equity impact: a dermatology capture programme in South African clinics would build a dataset representative of darker skin types, closing a gap our own measurement documented. Until then the system says plainly that performance on darker skin is not established.

Outcomes to be measured in a pilot, not assumed: time from capture to specialist read; proportion of high-probability scans read first; agreement between clinician and AI; confirmed outcomes against predictions.

### Usability testing and user feedback (max 250 words)

Usability testing with clinicians or patients has not yet been done, and we have not received user feedback from practice. We state this plainly rather than present rehearsal as testing.

What has been assessed:
- Accessibility: audited against WCAG 2.1 AA with an automated accessibility engine in a real browser, across the public site, patient dashboard and every tab and dialog, in both light and dark themes — zero violations after fixes (32 colour-contrast issues were found and corrected).
- Demonstration rehearsal on a running system: every step and figure in the demonstration script was verified against the live system, and the script was corrected where it overstated (for example, latency with the explanation overlay is about 1.7 s, not sub-second).
- Clinician-facing design: a one-page clinician briefing states the tool's error rates as frequencies, when to ignore it, and how to report a problem, with a comprehension check.
- Safety-critical language: interface translations are withheld unless a named fluent reviewer signs them off, so no partially translated clinical text is shown.

Planned: a reader study with 3–5 clinicians reading the same cases with and without the tool, measuring accuracy, reading time and usability, followed by a single-facility pilot with structured feedback. A clinical advisor is being recruited to lead this.

### User training requirements (max 250 words)

Training is short, because the tool changes the order of work rather than the clinical decision.

Clinicians (radiologists, dermatologists, doctors) — about one hour:
- What the result means: a calibrated probability used to order the queue, not a diagnosis.
- Known error rates, taught as frequencies: the skin model tells about 1 malignant lesion in 30 that it is benign; the lung nodule characteriser misses roughly 1 malignant nodule in 7.
- When to ignore the result: image refused, outside the intended population, or clinical suspicion regardless of score.
- Marking a nodule on CT, reading the explanation overlay, signing off, and recording the confirmed outcome.
- Reporting adverse events.
- A comprehension check at the end of the briefing.

Capture staff (nurses, community health workers) — under an hour:
- Capturing a usable dermoscopic image (focus, lighting, framing); why images get refused and how to retake.
- Offline capture and checking that queued scans have synced.
- Consent and privacy obligations under POPIA.

Administrators:
- Access management, second-factor enrolment, break-glass review, and data-subject requests such as erasure.

Materials: the clinician briefing, the demonstration script and in-app guidance. Refresher training accompanies any model change, because each change is recorded with its effect on performance.

---

## TECHNICAL SUPPORT & SECURITY ROBUSTNESS

### Current Technology Readiness Level

TRL 4 — Proof of concept and safety in laboratory or animal models

### Hardware components and functionality (max 250 words)

HealthAI Assistant is software. It is designed to use hardware facilities already own, and no custom hardware has been built.

Current hardware in the system:
- Server: one standard cloud instance runs the application, database and AI inference service. No GPU is needed to serve; the models stay loaded in memory and answer in about 0.5 seconds.
- Existing CT scanners: the platform receives DICOM, the standard format scanners already emit, so no new imaging equipment is needed for the CT path.
- User devices: any modern browser on a phone, tablet or computer. The app installs as a progressive web app and keeps working offline for capture.

Planned capture hardware (costed plan, not yet built):
- A dermoscope attachment for a smartphone (DermLite DL1/DL200 class, R4,000–R9,000), giving cross-polarised, consistently lit images of the kind the skin model was trained on.
- Mid-range Android devices where facilities lack them (R3,000–R5,000 each).
- Colour reference cards, to check lighting and colour consistency.

Cheaper generic clip-on lenses (R400–R1,200) are possible but would need their own validation before use, because image quality directly affects the model.

Level of development: server and software components are working prototypes; capture hardware is at the specification and costing stage, with UCT MedTech and the Western Cape Medical Devices Cluster identified as targets for device selection and local supply.

### Software and AI models, including functionality (max 250 words)

AI models:
- Skin lesion classifier: ResNet50V2 convolutional network (ImageNet backbone, trained classification head), temperature-calibrated, with a clinically chosen banded operating point. Grad-CAM explanation overlays show where the model looked.
- Lung nodule characteriser: trained on LIDC-IDRI CT; a radiologist marks a nodule and receives a calibrated probability that a radiologist would rate it malignant. Served under validation terms, DICOM only.
- Input safety screens: pixel-quality checks (blank, blurred, over-exposed) and out-of-distribution detection (PCA reconstruction error in the model's feature space), which refuse images the model was not measured on.
- In development: a lung nodule candidate detector. Training pipeline and evaluation built; not trained.

Inference service: Python FastAPI, models resident in memory, bounded request queue that sheds overload with a retry signal.

Medical imaging: DICOM ingestion with de-identification (DICOM PS3.15 basic profile), identifier remapping, CT series assembly and a CT quality gate that refuses incomplete or inconsistent studies.

Clinical platform: Node.js/TypeScript server, React web app, PostgreSQL. Radiologist review queue, clinician sign-off, recorded confirmed outcomes, and a performance endpoint computing real-world sensitivity and specificity with confidence intervals.

Security and privacy: field encryption (AES-GCM, rotatable keys), second-factor authentication, role-based access with care-relationship checks and audited break-glass, versioned consent, erasure with retention holds, append-only audit log.

Offline: service worker, on-device queue and background sync.

Operations: Prometheus metrics, health probes, 865 automated tests in continuous integration.

### Key risks — technical, clinical, operational (max 250 words)

Clinical:
- Missed cancers: the skin model tells about 1 malignant lesion in 30 it is benign. Mitigation: every scan is reviewed by a clinician; error rates are disclosed to users.
- Unmeasured performance on darker skin: public data are 96% lighter skin types. Mitigation: disclosed; a local dermatology data partnership is the first roadmap item.
- Small lung validation set (29 malignant nodules), with radiologist rating rather than histology as the reference. Mitigation: served only under validation terms, with intervals shown.
- Automation bias. Mitigation: training, a result never shown to patients unreviewed, and recording of clinician disagreement.

Technical:
- A model answering on inputs it was never measured on. Mitigation: input screens; one model already withdrawn by this process.
- Model drift in new settings. Mitigation: outcome recording and per-facility performance monitoring.
- Service outage. Mitigation: overload shed safely; scans queue for human review; offline capture.

Operational and regulatory:
- No clinical validation or regulatory clearance yet; SAHPRA classification to be confirmed.
- No named accountable clinician, turnaround target or out-of-hours cover for the review queue yet.
- Information Officer not yet registered under POPIA.
- Small team; no clinical advisor appointed yet.

Commercial and scaling:
- Procurement cycles in the public sector; dependence on partner facilities for pilot data.

Each risk is documented with its mitigation and status in the supporting documents.

### Data security and POPIA compliance (max 250 words)

We have completed a Data Protection Impact Assessment (supporting document) covering every processing operation, its lawful basis and residual risk. We make no compliance claim: the DPIA lists the conditions not yet met.

In place:
- Consent: explicit, versioned, scoped and revocable, recorded append-only. Automated image analysis has its own consent; declining still gets the scan reviewed by a clinician.
- Health data processed under POPIA §27 consent and the §32 healthcare authorisation.
- Encryption: clinical free text encrypted at rest (AES-GCM, rotatable keys); encryption in transit.
- De-identification: DICOM images de-identified before storage; the identified original is never kept; study identifiers are remapped.
- Access control: role-based access, patient isolation tested by an automated authorisation matrix, second-factor authentication, care-relationship checks and audited break-glass access.
- Audit: append-only log of access and clinical actions.
- Data-subject rights: erasure implemented, respecting statutory clinical retention periods; a published retention schedule.
- Cross-border: data hosted in Ireland (EU) and the optional AI assistant's transfer to the US are recorded under §72 with explicit consent.

Not yet in place, and on our plan:
- Information Officer registration (§55).
- Second-factor and care-relationship enforcement are running in monitoring mode before being switched on, to avoid locking clinicians out.
- A written breach-notification procedure with a named responsible person.
- Encryption of some remaining fields, including genomic data.
- Automatic expiry of records past their retention period.

### Ethical considerations — safety, fairness (max 250 words)

Safety:
- Human in the loop by design: no path bypasses clinician sign-off, and no unreviewed finding is shown to a patient.
- Refuse rather than guess: images outside what a model was measured on are refused and queued; modalities without a validated model are not offered.
- Known error rates are disclosed to clinicians and in the patient consent.
- We withdrew our own lung model when our validation showed it was answering on real CT it had never been measured on.

Fairness:
- We measured skin tone across the test set and found only 4.3% of images brown or darker. We publish that performance on darker skin cannot be established, rather than an encouraging average. For South Africa this is the most important limitation, and it shapes the roadmap: a dermatology partnership to build representative data.
- Polygenic risk scores are withheld for African-ancestry patients, because the reference populations are European and a percentile would mislead.
- Language: translations are offered only when a fluent reviewer has signed off the clinical text.

Honesty in claims: labels from research datasets are radiologist impressions, not biopsy results, and we say so. We removed earlier marketing figures that were not measured.

Consent and autonomy: explicit, revocable consent for image analysis, genomics and the AI assistant, each separately.

Research ethics: public datasets used under their licences with attribution; any prospective study will go through ethics committee approval.

---

## SCALABILITY & HEALTH-SYSTEM INTEGRATION IMPACT

### Connectivity features — offline, wireless, integration (max 250 words)

Offline-first capture: the app is a progressive web app. With no signal, a clinician can still capture and queue a scan; images are held in an on-device queue (IndexedDB) and upload automatically through background sync when connectivity returns. The queue is visible and cancellable. Nothing is analysed offline and no cached or estimated result is ever shown — the scan is analysed and reviewed once it arrives.

Wireless and low bandwidth: works over mobile data or Wi-Fi in a standard browser, with no app-store install. Only the image and minimal metadata are uploaded.

Integration:
- DICOM ingestion from existing CT scanners: series assembly, quality gate, de-identification and identifier remapping before storage.
- Web API for scans, review queue, outcomes and model information.
- Real-time updates to the clinician's review queue.
- Result-ready notifications by SMS without clinical content in the message.

Data exchange and storage: images and records are stored in an encrypted PostgreSQL database and object storage; all access passes through authenticated, role-checked APIs and is audited. Data are hosted in the EU (Ireland), a recorded cross-border decision under POPIA §72.

Not yet built: HL7 FHIR interfaces for hospital information systems and results sent back to PACS. FHIR R4 conformance is on the Q1 2027 roadmap.

### Estimated cost per unit (ZAR)

R14,500 – R28,500 capital per site for skin capture (indicative, pending quotation); R0 capital for the CT/DICOM path

### Affordability in public healthcare settings (max 250 words)

The design principle is to reuse what facilities already own.

Current costs:
- CT path: zero capital per site — it reads DICOM from installed scanners.
- Skin capture: R14,500–R28,500 per site indicative, for two dermoscope attachments, two mid-range Android devices where needed, and colour reference cards. Existing phones reduce this.
- Recurring: hosting and one inference instance, shared across all sites rather than paid per site. The models run on a standard CPU, with no GPU needed to serve.

Anticipated costs as the technology matures: clinical validation studies, regulatory submission and quality-management certification, security testing, and support staff. These are one-off or shared costs that fall per site as the number of sites grows.

Factors that influence cost: number of sites sharing infrastructure; dermoscope choice; data hosting location; the scale of validation required by SAHPRA.

Affordability strategies:
- Shared multi-site hosting.
- Validating a cheaper capture attachment (R400–R1,200) so it can replace the R4,000–R9,000 clinical standard — only once it is shown to work.
- Local supply and manufacture through the Western Cape Medical Devices Cluster.
- Browser-based, so no licensed client software or per-device installation.
- Ordering existing specialists' reading queues rather than replacing staff or equipment.

Cost-effectiveness will be measured in a pilot as time to specialist read and use of specialist time, rather than assumed.

### Main cost drivers and reduction strategies (max 250 words)

Development: clinical validation (reader study, retrospective study on South African data, then a prospective study), model development compute (GPU for training), and the regulatory pathway (SAHPRA submission, ISO 14971 risk management, IEC 62304 software lifecycle, eventually ISO 13485). Reduction: use existing records and the outcome-recording built into the platform for retrospective validation; rent GPU time rather than buy; build regulatory documentation into development now (the risk, failure-mode and change-control records already exist).

Production and implementation: capture hardware per skin site and on-site training. Reduction: validate cheaper attachments; reuse existing phones; zero-capital DICOM path for CT; short, structured training materials already written.

Operation: cloud hosting, storage of images, security monitoring and support. Reduction: one shared multi-site instance; CPU-only inference; overload shed rather than over-provisioned; retention schedule so data are not kept longer than required.

Scaling: data-protection obligations per facility, integration with each hospital's systems, and support coverage. Reduction: standards-based integration (DICOM now, FHIR planned) instead of bespoke interfaces; partnering with provincial health departments and existing networks rather than site-by-site sales.

The largest single driver is clinical validation, and it is also what makes the product usable — it will be funded and done before deployment, not skipped.

### Potential for scaling in South Africa (max 250 words)

The bottleneck the product addresses — images captured faster than specialists can read them — exists across the country's public district and regional hospitals, and also in private practice groups and pathology networks.

Why it can scale:
- It uses what facilities already have: installed CT scanners (zero capital) and phones, with a low-cost dermoscope attachment for skin.
- It is browser-based, runs on one shared cloud instance and needs no GPU to serve, so adding a site adds little infrastructure.
- It is built for intermittent connectivity, which is typical of rural and district facilities.
- Each facility gets its own measured performance from recorded outcomes, which supports provincial procurement decisions.

Pathway:
1. One district or regional hospital pilot with a named radiology or dermatology department, measuring time to read and performance against confirmed outcomes.
2. Expansion within the same province, through the provincial health department and referral networks.
3. National scale aligned with health-department digital-health programmes, and with private groups whose procurement is faster.

Beyond South Africa, the same constraints hold across much of sub-Saharan Africa, and the offline-first design was built for them.

Scale follows validation: we will not deploy beyond a pilot until clinical validation and regulatory review support it. A dermatology data partnership in South African clinics would also make the skin model fit for the population it serves.

### Integration with existing health systems (max 250 words)

The product was designed to fit into existing care pathways rather than create new ones.

Radiology: CT scanners already send DICOM. The platform receives DICOM, checks the study is complete and consistent, de-identifies it, and places it in the radiologist's review queue. For a CT-detected nodule, the radiologist marks it and receives the characteriser's assessment within their normal reading. No scanner change is needed.

Primary care and dermatology referral: a clinician or community health worker captures the lesion at the clinic (offline if needed); it is queued for the dermatologist, who reviews and records the outcome. This mirrors the existing refer-and-review path, with the order of reading improved.

Clinical workflow already built: role-based access for clinicians, radiologists, patients and administrators; clinician sign-off; confirmed-outcome recording; adverse-event reporting; audit trail; notifications; appointment scheduling.

Integration requirements considered during development: DICOM de-identification to the standard profile; statutory retention of clinical records before erasure; POPIA consent; care-relationship access controls; staged enforcement so clinicians are not locked out during rollout.

Credible pathway to adoption: a single-facility pilot using its existing PACS feed; then HL7 FHIR R4 interfaces (planned Q1 2027) so results flow into hospital information systems; then provincial rollout. Partnership targets include a district hospital radiology unit, a university dermatology department, UCT MedTech and the Western Cape Medical Devices Cluster.

### Infrastructure needs — power, connectivity (max 250 words)

Current requirements, based on testing:
- Facility side: any device with a modern browser — a phone, tablet or computer. Normal device charging is the only power need; no dedicated power supply or equipment.
- Connectivity: intermittent is acceptable. Capture works fully offline and syncs later. Uploads need only enough bandwidth to send one compressed image or a CT study; there is no continuous streaming.
- CT path: a network connection from the facility's scanner or PACS to send DICOM.
- Server side: one standard cloud instance (application, database, inference). Measured about 2 scans per second per instance, with no GPU needed.

Anticipated requirements for a pilot:
- A dermoscope attachment and mid-range Android devices per skin-capture site.
- A secure network route from the pilot hospital's PACS for DICOM.
- A clinician workstation or tablet for the review queue.

Anticipated for scale-up:
- Additional shared server instances as volume grows; the service sheds overload safely rather than failing.
- Hosting location review: data are currently hosted in the EU under a recorded POPIA cross-border decision; South African hosting will be considered as providers make it available.
- Load-shedding resilience: offline capture means power or network interruptions delay upload rather than losing scans; server-side reliability through the cloud provider.
- A GPU is needed only for training new models, not for running the service.

### Barriers to adoption or scale (max 250 words)

Clinical evidence: no clinical validation yet. The lung validation set is small (97 nodules, 29 malignant) and uses radiologist ratings rather than histology. Skin performance on darker skin types cannot yet be established from public data.

Regulatory: no SAHPRA registration or submission yet; expected classification as Class B/IIa software as a medical device, which requires a quality-management system and clinical evidence.

Trust and workflow: clinicians may distrust AI or, conversely, over-rely on it. Adding any step to a busy reading workflow meets resistance.

Integration: hospital information systems and PACS vary between facilities; HL7 FHIR interfaces are not yet built.

Data protection: POPIA obligations per facility, including an Information Officer, operator agreements and incident procedures, some of which are not yet in place.

Organisational: a small team without an appointed clinical advisor; long public-sector procurement cycles; the need for accountable clinicians, turnaround targets and out-of-hours cover for the review queue.

Infrastructure: intermittent connectivity and power in some facilities; the cost of capture hardware for skin.

Commercial: funding for validation studies and regulatory work before revenue.

### Strategies to overcome barriers (max 250 words)

Clinical evidence: retrospective validation on de-identified South African data with confirmed outcomes, using the outcome-recording already built; a reader study with 3–5 clinicians with and without the tool; then a prospective study under ethics approval. A dermatology department partnership to collect images with good representation of darker skin types.

Regulatory: SAHPRA pre-submission engagement and formal risk classification (Q1 2027); ISO 14971 risk file and IEC 62304 lifecycle records, building on the failure-mode, change-control and model-governance records that already exist; ISO 13485 quality system before market.

Trust: publish error rates as frequencies; train clinicians on when to ignore the result; record clinician disagreement as a monitored metric; keep humans responsible for every decision.

Integration: DICOM now; HL7 FHIR R4 interfaces next; start with one facility's existing PACS.

Data protection: register an Information Officer; execute operator agreements; finalise the breach procedure with a named owner; switch on second-factor and care-relationship enforcement after the monitoring period.

Organisation: appoint a clinical advisor (a brief and outreach are prepared) and a regulatory adviser; agree accountable reviewers and turnaround targets with the pilot site; work with provincial health departments and challenge partners such as UCT MedTech and the Western Cape Medical Devices Cluster.

Infrastructure and cost: offline capture; shared hosting; validate cheaper capture hardware.

Funding: prize funding and grants directed first at clinical validation.

---

## TEAM

### Team members' details, expertise and roles (max 250 words)

[Full name] — Founder, Novaryx Technologie; technical lead. [Qualifications and experience.] Designed and built the platform end to end: the AI models and their evaluation, the inference service, DICOM ingestion and de-identification, the clinical workflow, security and POPIA controls, and the documentation — model cards, DPIA, failure-mode analysis and model change control.

Demonstrated ability to execute: a working prototype with two AI components serving under stated terms, 865 automated tests, measured performance with published reproduction commands, and a validation process strong enough to withdraw one of our own models when real CT exposed a flaw.

Roles being filled, stated openly:
- Clinical advisor (radiologist or dermatologist): outstanding. The brief and outreach are prepared. The role: advise on the clinical use case, lead the reader study and pilot design, and review clinical claims.
- Regulatory adviser: outstanding. The role: SAHPRA classification and pre-submission, quality-management system.
- Information Officer under POPIA: to be registered.

Plan: with challenge support, appoint the clinical and regulatory advisers first, then engage a pilot facility's radiology or dermatology department.

[Add any other team members, with name, expertise and role.]

### Partners and collaborators (max 250 words)

No formal partnership agreements are in place yet. We name our targets and what we would ask of each, rather than claim partnerships that do not exist.

Targets:
- UCT MedTech (challenge partner): guidance on capture-device selection and access to a validation cohort.
- Western Cape Medical Devices Cluster (challenge partner): local supply and manufacturing routes for the dermoscope attachment, to keep cost and support local.
- A university dermatology department: dermoscopic images with confirmed outcomes and meaningful representation of darker skin types — the only route to closing our documented fairness gap.
- A district or regional hospital radiology unit: a DICOM feed from one CT scanner for a single-site pilot.
- A practising South African radiologist or dermatologist as clinical advisor.

Data and technology used:
- LIDC-IDRI lung CT collection (The Cancer Imaging Archive, CC BY 3.0), used with attribution for lung model training and evaluation.
- PGS Catalog (published polygenic score PGS000339) for genomic risk scoring.
- Open-source software including TensorFlow, pydicom, FastAPI, Node.js, React and PostgreSQL.

### Governance and decision-making structure (max 250 words)

Novaryx Technologie is the lead applicant and owns the technology. [Director name(s)] hold final decision-making authority.

Governance already built into development:
- Model change control: every model change is pre-registered — dataset, patient-level splits, metrics and acceptance criteria are committed before evaluation — so results cannot be tuned after the fact. A model changelog records what changed and what got worse.
- Model registry: a model can only serve with measured performance bound to its exact file fingerprint; models without validation are not offered.
- A decision register separates engineering work from methodology and clinical approval. For example, our next AI model will not be trained until named decisions on dataset, evaluation method and acceptance criteria are recorded by an accountable owner.
- Risk management: a DPIA with 16 risks and their status, a failure-mode and escalation analysis, and an incident-response plan.
- Accountability: append-only audit logs, clinician sign-off on every result, recorded outcomes, and adverse-event reporting.
- Quality: automated tests in continuous integration, independent reproduction commands for every published figure.

Gaps and plan: appoint a clinical advisor to approve clinical methodology and claims; a regulatory adviser for SAHPRA and quality management; register an Information Officer; name accountable reviewers with turnaround targets at the pilot site; and establish an advisory group of clinical, regulatory and data-protection members as the team grows.
