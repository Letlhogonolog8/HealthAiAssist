# HealthAI Assistant — Technical Audit and Implementation Plan

> Source of truth for the technical roadmap. Approved 2026-09-20. Kept in the
> repository so the phases, their file lists and their status travel with the
> code. The **Progress** block below is updated as phases land.

Audit date: 2026-09-20. Branch `fix/remove-fabricated-ai-results`, HEAD `ff722fd`, tree clean apart from the untracked `CLAUDE.md`. Submission deadline for the 2026 SA MedTech Innovation Challenge: **25 Sep 2026** (5 days).

Every claim below was checked by reading the file named or by running the code. Where a finding contradicts the repository's own documents, the measurement that contradicts it is given.

---

## Context

The repository is a clinician-in-the-loop screening-triage prototype: two ResNet50V2 image classifiers (skin, lung) served by a resident FastAPI inference service, an Express/TypeScript backend with governance, consent, audit, outcome recording and adverse-event channels, a React/Vite client with four role dashboards, and a separate genomics track. A third model — a LIDC-IDRI CT nodule characteriser — has been trained, calibrated and OOD-screened but is not wired to anything.

The request is a read-only audit and a roadmap toward the target pipeline (DICOM → quality gate → OOD → detection → segmentation → localisation → characterisation → multimodal context → calibration → triage → clinician review → outcome → monitoring), in the priority order P1 lung DICOM/CT → P13 medical video, without implementing anything yet.

### Decisions already taken (from the two questions asked during planning)

- **D1 — The web-PNG lung model is withdrawn from serving now.** Reason: measured today, it accepts real chest CT content and issues verdicts on it (§A5.1). "Refuse rather than guess" decides this. Lung shows "No model" until the LIDC nodule characteriser is promoted through `docs/MODEL_GOVERNANCE.md`'s process.
- **D2 — P2–P4 assume CPU-only compute.** Detection/segmentation/3D adopt open pretrained models and are re-validated on the local LIDC subset per nodule. No local volumetric training. A Python ≥3.10 environment is added alongside the existing 3.8 one.
- **Route 1 for the nodule model** (clinician marks the nodule, model characterises) was decided on 2026-08-31 and is not relitigated here; P2 is what turns it into route 2.

---

## Progress

- **Phase 0 — implemented 2026-09-20/21, committed `ece4bf9`.** Registry withdrawal
  with the measured reason; `withdrawn` governance state; registry check ahead
  of governance in `handleScanAnalysis`; explanation refuses a withdrawn
  model before the transport check; disclosure v3; `build-ood-reference.py
  --measure-only` with the real-CT refuse domain (exit 1 on record); homepage
  and analysis-page copy driven by the registry; tests re-pointed to skin plus
  `tests/withdrawn-modality.test.ts`; every document in §A5 corrected, pack
  HTML re-rendered and both PDFs reprinted (`architecture.html` is
  hand-authored — no Markdown source). `tsc` clean, `vite build` clean.
- **P0 remainder — implemented 2026-09-21.** Server-driven capability manifest
  (`server/capabilities.ts`, `GET /api/capabilities`; cards carry `status`,
  `modelClass`, `clinicallyValidated: false`); homepage Coverage, Workflow and
  hero sections render the manifest and name no modality in source
  (`tests/capability-claims.test.ts`); `server/ai-engine.ts`, `ai-routes.ts`
  (which WAS mounted at `/api/advanced/ai/*`) and `enhanced-medical-analysis.ts`
  deleted, `@tensorflow/tfjs-node` uninstalled, analytics keyed on the registry
  (`server/model-operational-metrics.ts`); `riskAssessment` removed from the
  response and every "X RISK" badge replaced by triage wording (`client/src/lib/triage.ts`).
- **P1a — implemented 2026-09-21.** Nodule characteriser registered
  (`lung_nodule`, `INTERNAL_VALIDATION`, capability status VALIDATION), bound
  `re_measured` (`9faf49cdca48`) by the new
  `scripts/verify-lung-nodule-operating-point.py`; served by
  `inference/lung_nodule_service.py` at `POST /infer/lung_nodule` (DICOM +
  clinician mark only, raster refused, clinician roles only); serving render
  goes through `training_window()` and the crop through the shared
  `inference/nodule_patch.py` (parity with the training PNGs proven byte for
  byte); the de-identified object — instance UIDs replaced, private tags and
  identifiers removed — is what is persisted on every path, never the upload
  (DPIA R-19 mitigated); structured numeric result columns
  (`migrations/scan-analysis-detail.sql`) and the mark
  (`migrations/scan-regions.sql`) applied to the development database;
  `POST /api/dicom/preview` for the clinician to see the slice; the
  `LungNoduleTool` and `AiResultSummary` components; explanation re-runs over
  the recorded mark; consent disclosure v4; `inference/tests/` (pytest, 29
  tests; CI step added) and `tests/lung-nodule.test.ts`. Model card, changelog
  and every pack document updated.
- **P1b — implemented 2026-09-22.** A CT series is ingested as a study:
  assembled by `SeriesInstanceUID` (`inference/series.py`), ordered by
  projecting `ImagePositionPatient` onto the slice normal, put through a CT
  quality gate whose every bar was measured on 30 LIDC-IDRI series
  (`inference/quality_gate.py`), de-identified with the study/series/instance
  tree remapped through a salted HMAC rather than deleted
  (`inference/uid_remap.py`), streamed back as NDJSON
  (`POST /ingest/series`), and stored — objects first, rows last in one
  transaction — behind `POST /api/dicom/series`
  (`server/dicom-series.ts`, `migrations/imaging-series.sql`, three new tables
  in `shared/schema.ts`). Uploads stream to one per-request staging directory
  outside `uploads/` that is removed whatever happens to the request. Read
  back at `GET /api/dicom/series/:id`, clinician roles only, care-relationship
  gated. Capability manifest: `dicom-ingest` stays IN_DEVELOPMENT with its
  evidence rewritten — CURRENT is a claim about a measured, fingerprint-bound
  model and series ingest has no model in it — plus a new
  `dicom-network-receive` PLANNED row. 62 new Python tests
  (`test_uid_remap.py`, `test_series_assembly.py`, `test_quality_gate.py`,
  `test_server_app.py`) and `tests/dicom-series.test.ts`. What it does not do
  is anything clinical: no model reads a series, and `ingestStatus` is a
  statement about file handling. Decisions and limits: PART F, Phase 1b.
- **Deferred from P1a**: nothing. **Deferred from P1b**: nothing of the
  ingest scope; volume assembly stays P4 and PACS/DICOMweb receive stays
  P1b+ (declared PLANNED, not implied). **Deferred to P6**: structured
  agree/disagree review fields.

# PART A — AUDIT

## A1. Executive assessment

**What this is.** A prototype whose engineering discipline is unusually high for its stage — byte-sniffed uploads, a governance gate that fingerprints the deployed artifact against its published figures, consent that gates the model and not the care, refusal shapes that say "this is NOT a negative finding", outcome recording with Wilson intervals, a published skin-tone analysis that reports its own inadequacy, promtool-tested alerts, and 15 integration suites (~4,800 lines) that boot the real server. `npx tsc --noEmit` is clean.

**What it is not.** It is not a CT/DICOM system. The serving lung model was trained on web-scraped PNGs; the DICOM ingest is a single-frame converter behind a 10 MB single-file upload; there is no detector, no segmenter, no 3D path, no series/study model in the database, no PACS/HL7/FHIR interface, and no Python test suite covering the DICOM, windowing, de-identification, OOD or Grad-CAM code.

**The finding that changes the plan.** The repository's central published lung claim — "the lung model refuses every real clinical acquisition; every window tested scores 20.3–30.4 against a 16.51 threshold" (`MODEL_CARDS.md`, `docs/pack/APPLICATION_TEXT.md`, `docs/DEVICE_INTEGRATION.md`, `docs/pack/DEMO_SCRIPT.md`, comment in `inference/server.py:infer_lung`) — is **false for real chest CT**. It was measured on pydicom's bundled `CT_small.dcm` (128×128, GE RHAPSODE, 1990s) and `MR_small.dcm`. Measured today on the LIDC-IDRI data in `dataset/`:

| Input (through the serving code) | n | Passed OOD | OOD median (threshold 16.51) | Verdicts issued |
|---|---|---|---|---|
| LIDC whole CT slices, lung window, 224×224 (`dataset/lidc-ood/whole-slice`) | 40 | **38** | 12.2 (min 9.9, max 18.0) | 17 cancer / 21 no_cancer |
| Real LIDC DICOMs via `inference/dicom_ingest.dicom_to_png_bytes` (the serving conversion) | 12 | **11** | 14.2 (min 9.4, max 17.2) | 3 cancer / 8 no_cancer |
| Model's own web-PNG test set (`dataset/lung_cancer_MRI_dataset/test`) | 40 | 40 | 11.3 | — |

Real CT is *in-distribution* for this model in ResNet feature space; the PCA reconstruction detector cannot separate it, and raising the threshold would not help because there is nothing to separate. The only thing standing between a real CT and an unvalidated verdict is the explicit `if acquisition is not None: raise 422` gate in `inference/server.py` — which fires on DICOM *files* only. A PNG or JPEG export of the same slice (how most clinicians would get an image out of a PACS viewer) passes straight through. The OOD reference for `lung` was validated in one direction only: `dataset/lung_cancer_MRI_dataset/lung_model_ood.json` has `wrongModality` = skin images and nothing from real CT; `scripts/build-ood-reference.py` lines 88–90 list only those two domains for `lung`.

This does not mean the OOD detector is broken. It means the premise in the request — "the existing OOD detector currently refuses real radiology inputs" — is only true of the DICOM-file gate, and the correct response is the one decided in D1, not a threshold change.

**Overall.** The scaffolding around the models is closer to deployable than the models are. The roadmap therefore front-loads (P1) replacing the lung model with one whose input is real CT, and (P0) correcting the published claim before it is submitted to a panel that can check it.

## A2. Implemented and functional (verified)

| Area | Evidence | Verified how |
|---|---|---|
| Resident inference service, bounded queue, warm-up, per-model `/healthz` | `inference/server.py` | Read; `MAX_QUEUE_DEPTH`, `_Admission`, `_inference_lock`, `warm_models` |
| Byte-level upload verification incl. DICM preamble | `server/upload-validation.ts` `verifyUpload` | Read; used at `server/routes.ts` `handleScanAnalysis` |
| DICOM read, single-frame select, modality LUT → VOI LUT, MONOCHROME1, best-effort PS3.15 tag removal | `inference/dicom_ingest.py` | Read; executed on 12 real LIDC objects |
| Pixel quality gate (uniform / black / blown-out / Laplacian blur) | `server/skin_cancer_model.py` `check_image_quality`; `server/lung-cancer-service.py` `_quality_failures` | Read; executed (64 px nodule crops are refused by the blur check) |
| OOD screen (PCA reconstruction error, 64 components, 99.5th pct) | same two files; `scripts/build-ood-reference.py` | Read; executed |
| Calibration (temperature scaling, applied for lung only), threshold on calibrated P | `lung-cancer-service.py` `_apply_temperature`, `scripts/calibrate-model.py`, `scripts/choose-lung-threshold.py` | Read |
| Grad-CAM on demand, refused when no result / model changed / consent withdrawn | `inference/gradcam.py`, `server/scan-explanation.ts`, `client/src/components/scan-explanation.tsx` | Read; tested by `tests/scan-explanation.test.ts` |
| Model registry + artifact fingerprint binding, fail-closed on drift | `server/model-availability.ts`, `server/model-fingerprint.ts`, `server/model-governance.ts` | Read; `tests/model-governance.test.ts` |
| Consent for automated analysis with the error rates in the disclosure | `server/privacy/ai-analysis-consent.ts` (`DISCLOSURE_VERSION` `2026-09-02.v2`) | Read; `tests/outcomes.test.ts` |
| Scan analysis handler: ownership check, governance, consent, analysis, persist, audit `SCAN_ANALYSED`, radiologist WS notify, patient notify | `server/routes.ts` `handleScanAnalysis` | Read |
| Refusal shapes 422 (`respondInputRejected`) / 503 (`respondModelUnavailable`) with "NOT a negative finding" | `server/routes.ts` | Read; `tests/chaos.test.ts` |
| Radiologist queue, report = adjudication (`specialist_review`), `modelWasCorrect` returned | `server/routes.ts` `/api/radiologist/*`, `recordOutcomeAndNotify` | `tests/radiologist-queue.test.ts` |
| Production performance with Wilson CIs and a 20/20 evidence floor | `server/production-performance.ts` | `tests/outcomes.test.ts` |
| Skin-tone (ITA) fairness: offline report bound to fingerprint, production bin recording, `reliable` flags | `server/fairness.ts`, `server/skin-tone.ts`, `scripts/measure-skin-tone-performance.py`, `dataset/data/skin_tone_performance.json` | `tests/fairness.test.ts` |
| Adverse events (immutable report, appended review, outlives the scan) | `server/adverse-events.ts`, `shared/schema.ts` `adverseEvents` | `tests/adverse-events.test.ts` |
| Auth, RBAC, IDOR protection, MFA (TOTP + consumed backup codes), break-glass, care relationship (shadow), erasure with retention holds, field encryption with keyring rotation | `server/security-config.ts`, `server/security-middleware.ts`, `server/mfa.ts`, `server/care-relationship.ts`, `server/erasure.ts`, `server/crypto/*` | `tests/auth-matrix.test.ts`, `tests/mfa.test.ts`, `tests/care-and-erasure.test.ts`, `tests/encryption.test.ts` |
| Session-authenticated WebSocket, role/user routing | `server/websocket.ts` | `tests/realtime.test.ts` |
| Audit table + `auditLog` middleware on ~40 routes | `server/security-middleware.ts` `recordAuditEvent`, `shared/schema.ts` `auditEvents` | Read |
| Prometheus metrics + promtool-tested alerts + runbook | `server/metrics.ts`, `ops/alerts.yml`, `ops/alerts_test.yml`, `ops/RUNBOOK.md` | CI step in `.github/workflows/ci.yml` |
| Offline scan queue that never means "benign" | `client/src/lib/submit-scan.ts`, `client/src/lib/scan-queue.ts` | Read |
| Homepage reads figures from `/api/models/cards`; no hardcoded accuracy | `client/src/pages/home.tsx`, `enhanced-hero-section.tsx`, `ai-features-section.tsx`, `cancer-detection-section.tsx` | Read |
| LIDC label pipeline (dedup, superseded annotation, nodule identity, patient-level split, per-nodule metrics) | `scripts/lidc_build_labels.py`, `lidc_extract_patches.py`, `lidc_whole_slices.py`, `train-lung-nodule-model.py` | Read; outputs present in `dataset/lidc-ct/patches.csv` (4,110 patches), `dataset/lidc-labels.csv` (1,703 nodules) |
| Genomics (PRS with ancestry-transferability withholding, actionable variants, consent scopes, access log) | `server/genomics/*`, `server/genomics-routes.ts` | Read headers only; out of scope for imaging |

## A3. Partially implemented

1. **LIDC nodule characteriser — trained, not served.** `dataset/lung_nodule_model/resnet50v2_lung_nodule_model.h5` exists with `lung_nodule_training.json` (per-nodule test: sens 0.862 [0.69–0.95], spec 0.691 [0.57–0.79], n=97 nodules, 29 malignant, threshold 0.30 chosen on validation), `lung_nodule_model_calibration.json` (ECE 0.040, fitted T=1.265 measured and *not* applied), `lung_nodule_model_ood.json` (both-direction validation passed: whole slices refused 90.8%, skin 92.5%, benign patches accepted 96.7%, off-nodule 99.2%). Not present in `MODEL_REGISTRY`, `MEASUREMENT_BINDINGS`, `model-fingerprint.ts` (`Modality = 'lung' | 'skin'`), `inference/server.py`, `server/inference-client.ts` (`modality: 'skin' | 'lung'`), or any client component. Its `knownGaps` still say "Not calibrated yet" and "No OOD reference built yet" — both stale.
2. **DICOM ingest — converter, not a pipeline.** Single object, middle frame of a multi-frame, one PNG out. No series assembly, no `SeriesInstanceUID` grouping (UIDs are deleted, not remapped), no spacing/orientation retained, no volume. `dicom_to_png_bytes` calls `_window(frame, dataset)` **without** `force_window=training_window(ds)`, so the serving path honours display presets — 5 of 12 sampled LIDC objects carry soft-tissue windows (WC 40–55 / WW 350–500) that black out the lung field. `training_window()` is only used by `scripts/lidc_extract_patches.py` and `scripts/lidc_whole_slices.py`. Training and serving windowing disagree, which is the drift the module's own docstring says it prevents.
3. **De-identification — applied to a transient copy only.** `deidentify()` runs inside `dicom_to_png_bytes` and the result is discarded; `server/routes.ts` `persistScanImage` writes `file.buffer` (the raw upload) to `uploads/` or Cloud Storage. A DICOM upload would be stored **identified** (all 12 sampled LIDC objects carry `PatientName`/`PatientID`). Latent, not a breach: `uploads/` currently holds 176 JPEGs and no `.dcm`. `docs/DEVICE_INTEGRATION.md` ("the original is never written to the platform's storage") is wrong for the upload path.
4. **DICOM on the spawn-fallback path.** With `INFERENCE_URL` unset, `analyseLungBySpawningPython` / `SkinCancerService.analyzeSkinImage` hand raw DICOM bytes to PIL, which fails → `ModelUnavailableError` → 503 "model unavailable". Fail-safe, wrong message, no de-identification.
5. **Clinician review — free text plus outcome, no structured disagreement.** `medical_scans` stores `findings`, `recommendations`, `radiologistId`, `reviewedAt`; `scan_outcomes` stores the adjudication. There is no field for "reviewer agrees/disagrees with the AI call", no override reason, no reviewer confidence, no review-time capture beyond `reviewedAt`. `modelWasCorrect` is computed in the response and not stored. CLAUDE.md asks for disagreement and override to be recorded.
6. **Care-relationship and MFA enforcement are shadow/off by default** (`CARE_RELATIONSHIP_ENFORCE`, `MFA_ENFORCE`). Documented as a rollout property; must be recorded as accepted risk if left.
7. **Homepage capability communication.** `client/src/components/cancer-detection-section.tsx` hardcodes five modalities (skin, lung, breast, prostate, cervical) with a binary Available / No model state. No CURRENT / IN DEVELOPMENT / VALIDATION / PLANNED / FUTURE vocabulary; no DETECT→SEGMENT→…→ASSIST representation; hero copy hardcodes "Two imaging models" and "three more have no classifier at all". Colon/GI is not mentioned anywhere.
8. **Tests cover the Node side only.** No `pytest`, no Python tests; `inference/dicom_ingest.py`, `gradcam.py`, `server/*.py` and every `scripts/*.py` are untested by automation. The TS suite never sends a DICOM or exercises an OOD refusal end-to-end (chaos tests remove the artifact; they do not test the screen).
9. **Legacy code still mounted or shipped.** `server/ai-engine.ts` (726 lines) builds tfjs "mock models" whose `predict` returns `Math.random()`; `predictMedicalCondition` refuses to serve them and only `getModelStatus`/`getModelPerformanceMetrics` are reachable (via `server/analytics-engine.ts` → `/api/advanced/analytics/*`), but the file remains a liability and pulls `@tensorflow/tfjs-node`. `server/ai-routes.ts` (own `/analyze-scan`) **was mounted** at `/api/advanced/ai/*` — the audit's first pass missed the import in `advanced-routes.ts`; corrected 2026-09-21 when both files were removed. `server/enhanced-medical-analysis.ts` has no importers. `client/src/components/ai-scan-simulator-fixed.tsx` and `multi-cancer-detection-system.tsx` are still mounted from `dashboard-layout.tsx` / `pages/cancer-detection.tsx`.
10. **Environment.** System Python 3.8.10 (EOL) with TF 2.13, torch 2.1+cpu, pydicom 2.4.4, fastapi 0.115. `venv/` is broken (TF DLL load failure). No MONAI, SimpleITK, nibabel, scikit-image, pylidc, pynetdicom, highdicom, onnxruntime, pytest. No GPU.

## A4. Missing

- Nodule **detection** (any candidate generator).
- **Segmentation** (lesion or organ), and any mask representation in storage or API.
- **Localisation** output beyond a 7×7 Grad-CAM (no coordinates, no bounding boxes, no measurement).
- **3D**: series/volume ingestion, resampling, spacing, orientation, multi-planar view, per-slice review.
- **Study/series data model**: `medical_scans` has one `imagePath`; no `imaging_studies`/`imaging_series`/`imaging_instances`, no acquisition metadata columns (the inference service returns `acquisition` {modality, rows, columns, manufacturer, model} and the handler discards it), no OOD score, no calibrated probability (only `aiConfidence` as text `"NN%"`), no ROI/annotation, no quality-gate result.
- **Multi-file / large upload**: multer `limits.fileSize` 10 MB, `upload.single('image')`; a CT series (200–400 objects, 100–300 MB) cannot arrive.
- **Interoperability**: no DICOM C-STORE SCP, no DICOMweb (QIDO/WADO/STOW), no HL7 v2, no FHIR (`ImagingStudy`, `DiagnosticReport`, `Observation`, `ServiceRequest`).
- **Multimodal clinical context**: the lung questionnaire (`client/src/components/lung-cancer-analyzer.tsx`) is client-side only and never transmitted; `server/screening-eligibility.ts` checks criteria but nothing fuses image + context.
- **Longitudinal**: no prior lookup, no registration, no change measurement.
- **Model monitoring beyond counters**: no feature-drift aggregation (the OOD score per scan is computed and discarded), no per-site/per-scanner stratification (acquisition metadata discarded).
- Breast, colon/GI, prostate, video/ultrasound/endoscopy: nothing, correctly.
- **Python test suite** and CI step for it.

## A5. Unsafe, misleading, or technically incorrect

Ordered by consequence.

1. **The lung "refuses every CT" claim is falsifiable and is in the submission pack.** Evidence in §A1. Files carrying the claim: `MODEL_CARDS.md` (§"This model cannot currently read real clinical imaging", both tables), `docs/pack/APPLICATION_TEXT.md` (refusal table row "Clinical DICOM to the lung model" and the paragraph "The lung model refuses real DICOM, and we published that"), `docs/DEVICE_INTEGRATION.md` (Track B "Built, and what it immediately revealed"), `docs/pack/DEMO_SCRIPT.md` (lines ~94, ~146–158: the live DICOM demo), `inference/server.py` (`infer_lung` comment: "The screen does catch it — a windowed CT scores 22.9"), `inference/dicom_ingest.py` (`_window` fallback comment). The `resolveScanType` substring match in `server/model-availability.ts` also means any scanType containing "lung" resolves to this model.
2. **Serving windowing ignores `training_window()`** (§A3.2). For the nodule model this is a correctness bug: `lung_nodule_training.json.windowing` states "Any serving path for this model MUST pass the same override." Today no serving path does.
3. **DICOM would be stored identified** (§A3.3). POPIA §19 finding-in-waiting; contradicts `docs/DEVICE_INTEGRATION.md` and the DPIA's storage narrative.
4. **Two documents attribute the web-PNG model's figures to CT nodule patches.** `docs/REGULATORY_PATHWAY.md` §1 table: "Input: CT nodule patch … sensitivity 0.812 … specificity 0.757" and §4.2 "measured on curated public datasets (LIDC-IDRI for lung)". `docs/CLINICIAN_BRIEFING.md` "### Lung — CT nodule patches: Of 282 cancers, the model flagged 229 and missed 53". Those are `Lung MRI (n).png` figures. A regulatory consultant or clinician briefed from these would be briefed on the wrong device.
5. **Stale fabricated benchmarks survive in legacy docs.** `docs/TECHNICAL_SPECIFICATIONS.md` §4 (`LungCancerModel … accuracy = 0.91 … v1.8.0`, `modelBenchmarks.breastCancer.accuracy: 0.94`, DICOM preprocessing stubs), `LUNG_CANCER_DETECTION.md` ("Expected Accuracy ~91%"), HIPAA references in `PRODUCTION_AUDIT_REPORT.md`, `SECURITY_CHECKLIST.md`, `FINAL_AUDIT_SUMMARY.md`. These contradict CLAUDE.md and `docs/pack/APPLICATION_TEXT.md`'s POPIA-not-HIPAA position.
6. **`server/routes.ts` `performLungCancerAnalysis` reports `confidenceThreshold: 70.0`** in `advancedMetrics`; the deployed threshold is 0.30 (and the skin service bands at 0.30/0.70, not 70). Stale literal of the kind `model-fingerprint.ts` was written to remove.
7. **Lung `riskLevel` is `'high' | 'low'` from a binary threshold** and is rendered as "HIGH RISK" on the patient response. It is a classifier flag, not a risk stratum. Transparent in `findings`, overclaiming in `summary.riskAssessment`.
8. **`lung_nodule_training.json.knownGaps`** says not calibrated / no OOD — both done. A model card built from it would understate the work; the opposite error, but still an inaccurate record.
9. **`ai-engine.ts` `Math.random()` mock models** (§A3.9). Unreachable for predictions today; one refactor away from not being.
10. **`dataset/` is gitignored** so every artifact, calibration file, OOD reference and measurement JSON is outside version control; `npm run backup:models` is the only safeguard. `docs/DISASTER_RECOVERY.md` records this.

## A6. Improvable immediately (no new data)

- D1: withdraw the web-PNG lung model; correct every document in §A5.1 and §A5.4–6; add a machine-checked "real CT" refuse-domain measurement so the limitation is recorded by the same script that validates the others, not by prose.
- Promote the LIDC nodule characteriser through the existing governance path (registry entry, binding, changelog, `/healthz`, inference endpoint, client) — all artifacts exist.
- Fix serving windowing to use `training_window()`; de-identify before persisting; persist acquisition metadata, OOD score and calibrated probability.
- Add a `pytest` suite for `inference/` and `server/*.py` using LIDC objects and the existing OOD sets.
- Structured clinician review fields (agreement, override reason).
- Homepage status vocabulary and the DETECT→ASSIST diagram driven by a server-side capability manifest.
- Delete dead analysis code; drop `@tensorflow/tfjs-node` if `ai-engine.ts` goes.

## A7. Requires new datasets

- Nodule detection validation: LUNA16 (LIDC-derived, candidate lists and reference nodules ≥3 mm) — a re-download; the current 229-series subset can serve as an independent check only where series overlap is excluded.
- Segmentation validation: LIDC XML already carries per-reader contour ROIs (parsed for centroids only in `scripts/lidc_build_labels.py`); LUNA16 masks; for organ masks, any dataset with lung segmentations (or accept a pretrained segmenter's output with a QC protocol).
- Skin fairness: Fitzpatrick V–VI images with recorded labels (DDI, Fitzpatrick17k, or a dermatology-department partnership) — a data problem the model card already names.
- Any South African retrospective set with confirmed outcomes (the TRL 5 path in `docs/CHALLENGE_IMPLEMENTATION_PLAN.md` Phase 5).
- Longitudinal pairs (NLST has them; LIDC does not).
- Breast (CBIS-DDSM, VinDr-Mammo), colon/GI (Kvasir-SEG, HyperKvasir), prostate (PI-CAI, PROSTATEx), video/ultrasound/endoscopy — each is a modality with its own quality gate, OOD reference, calibration and fairness question.

## A8. Requires new AI/ML models

- Nodule **detector** (2.5D or 3D). Under D2: adopt a pretrained open model and validate; do not train.
- Nodule/lesion **segmenter** and a lung **organ segmenter** (for field-of-view checks and the quality gate).
- A **stronger characteriser** than a frozen ImageNet ResNet on 64 px crops, once a detector supplies candidates — 3D patch models are the literature standard.
- Skin model fine-tuning (currently frozen trunk).
- Everything in P7–P13.

## A9. Requires clinical validation

- Every model above before any indication wider than "prioritise review order" (`docs/REGULATORY_PATHWAY.md` §5).
- The LIDC nodule characteriser: 29 malignant test nodules is a ±0.15 interval; LIDC labels are radiologist impressions, not histology; demographics unrecorded. It can be *served as research/internal-validation* with that stated; it cannot be called validated.
- Skin on darker skin: no claim is possible from this data.
- Reader study and retrospective SA validation (existing plan, Phase 5).

## A10. Requires external infrastructure or integrations

- A Python ≥3.10 runtime (MONAI ≥1.3, nnDetection, pylidc, highdicom, pynetdicom all require it); a GPU or cloud budget for any training beyond frozen-trunk heads.
- Object storage made mandatory in production; a test database separate from the shared Supabase instance (both already listed in the challenge plan).
- DICOM: a Storage SCP (pynetdicom) inside a clinic network, or DICOMweb against a PACS; an Orthanc instance is the practical development stand-in.
- HL7/FHIR: a FHIR server or a facade; `ServiceRequest` in, `ImagingStudy`/`DiagnosticReport`/`Observation` out.
- Model registry with checksums (MLflow/DVC) — the fingerprinting exists; the store does not.
- Redis for WebSocket state and a job queue (BullMQ) once series-level inference is asynchronous.

## Target-pipeline stage status

| Stage | Status | Evidence |
|---|---|---|
| DICOM / medical image | **Implemented for upload** | `inference/dicom_ingest.py` single object; `inference/series.py` assembles and orders a series; `POST /api/dicom/series`; no PACS receive |
| Quality / safety gate | **Implemented for CT series; partial per slice** | Pixel checks + `BurnedInAnnotation` refusal per slice; `inference/quality_gate.py` adds modality, slice count, thickness, spacing regularity, matrix, pixel spacing, rescale, ordering trust and body-part checks with bars measured on LIDC-IDRI; no field-of-view check (needs the organ mask, P3) |
| OOD detection | **Operational for skin; operational-but-misdescribed for lung; validated for nodule model** | §A1 |
| Detection | **Missing** | — |
| Segmentation | **Missing** | — |
| Localisation | **Experimental** | Grad-CAM only (`inference/gradcam.py`) |
| Characterisation | **Operational (skin); research artifact not served (lung nodule)** | `dataset/lung_nodule_model/*` |
| Multimodal clinical context | **Missing** | Questionnaire never leaves the browser |
| Calibration / uncertainty | **Operational** (temperature scaling; ECE, Brier; Wilson CIs) | `scripts/calibrate-model.py`, `server/production-performance.ts` |
| AI-assisted triage | **Operational** (priority from risk level; radiologist queue) | `/api/radiologist/pending-reviews` |
| Clinician review | **Operational, unstructured** | §A3.5 |
| Clinical outcome | **Operational** | `scan_outcomes`, `recordOutcomeAndNotify` |
| Model performance monitoring | **Partial** | Counters + alerts; no drift aggregation, no per-scanner stratification |

---

# PART B — RECOMMENDED ARCHITECTURE

## B1. Lung CT/DICOM pipeline (P1)

```
Upload (single DICOM | zip of a series | PNG/JPEG)        ← Node: verifyUpload, size limit raised per type
   │  multipart, streamed to disk (not memory) for series
   ▼
Series assembly (Python, inference/)                       ← group by SeriesInstanceUID before de-id;
   │  sort by ImagePositionPatient·normal; spacing/orientation; reject mixed/partial series
   ▼
De-identify (PS3.15 basic profile, UIDs REMAPPED via salted hash, not deleted)
   │  persist the de-identified object(s); never the original
   ▼
Quality gate (deterministic)                              ← Modality==CT; BodyPartExamined/anatomy check;
   │  slice thickness & count bounds; reconstruction kernel recorded; burned-in annotation; pixel checks
   ▼
Render for model: training_window(ds) (WC −600/WW 1500)  ← ONE implementation, serving == training
   ▼
OOD screen per model (both-direction validated)
   ▼
Route 1 (now): clinician-marked ROI → 64 px crop → nodule characteriser → calibrated P + Grad-CAM
Route 2 (P2): detector → candidates → characteriser per candidate
   ▼
Result record: probability, threshold, temperature, OOD score, model fingerprint, acquisition metadata,
ROI coordinates in patient space, quality-gate outcome
   ▼
Radiologist queue → structured review (agree/disagree/override) → outcome → performance/drift
```

Key rules: one windowing implementation (`inference/dicom_ingest.py`) imported by training and serving; UID remapping instead of deletion (needed for series grouping and longitudinal work, and still non-reversible without the salt); the original bytes never persisted; every model input rendered by the same function that produced its training patches.

## B2. Detection (P2)

Under D2 (CPU-only): adopt a published lung-nodule detector with a permissive licence and a LUNA16-validated checkpoint (candidates: MONAI's LUNA16 detection tutorial model (RetinaNet 3D), nnDetection's LUNA16 model), run as a separate Python service or a second module in `inference/`, and **re-validate on the local LIDC subset per nodule** using `dataset/lidc-labels.csv` as reference (with the LUNA16-overlap series excluded from the validation set). Output: candidates with patient-space centre (mm), diameter estimate, detector score. Published figures: FROC-style sensitivity at N false positives per scan, with intervals, on the held-out patient set. The detector is a **candidate generator for the characteriser**, not a verdict; the UI shows candidates for a radiologist to accept/reject, and rejections are recorded (that is training-quality data). If no checkpoint meets a pre-registered bar (e.g. ≥0.85 sensitivity at ≤4 FP/scan on the local set), P2 stops at "candidates not shown", and the pipeline stays at route 1.

## B3. Segmentation (P3)

Two different jobs. **Organ (lung) mask**: pretrained (TotalSegmentator or a MONAI lung-segmentation bundle) — used first as a *quality-gate input* (is the lung field in the frame; is a candidate inside lung parenchyma) before any of it is shown to a user. **Nodule mask**: pretrained or LIDC-contour-trained (LIDC XML contains per-reader boundaries; `lidc_build_labels.py` parses only centroids today) — validated per nodule with Dice against the reader consensus, and only shown once a Dice floor is met. Masks stored as RLE/NIfTI in object storage referenced from a new table, never inline in the scan row. Volume/diameter derived from masks is labelled "model-derived measurement, unvalidated" until validated against reader measurements.

## B4. 3D medical imaging (P4)

Series → volume (SimpleITK/nibabel), resample to isotropic spacing, retain original spacing for measurements; a viewer with axial/coronal/sagittal + window/level + slice scroll + overlay (Cornerstone3D is the established web toolkit and supports DICOM directly). The client viewer stays a review tool, not a diagnostic workstation, and says so. Inference on volumes is asynchronous (job table + WebSocket progress), which is why P4 follows P2/P3: they are what needs a volume.

## B5. Multimodal clinical intelligence (P7)

Transmit the structured context that already exists (questionnaire, `screening-eligibility.ts` inputs) to the server and **store it**; fuse only with a validated rule (Brock/PanCan for nodules is published and uses exactly nodule size/type/spiculation + age/sex/family history/emphysema) rather than a learned fusion until data exists. Genomics stays a separate track with its own consent; any fusion with imaging is P7+ and gated on the transferability logic already in `server/genomics/prs.ts`. No LLM in the clinical decision path.

## B6. Clinician-in-the-loop review (P6)

Structured review record per AI result: reviewer, model fingerprint, AI call, reviewer call, agreement (agree / disagree / override), override reason (controlled vocabulary + free text), time-to-first-open, time-to-sign-off, candidates accepted/rejected (P2), ROI drawn (route 1). Disagreement rate per model fingerprint becomes a monitored metric and an alert. Outcome stays append-only in `scan_outcomes`. Adverse-event linkage stays as is.

---

# PART C — RECOMMENDED CHANGES

## C1. Database (additive migrations, `migrations/*.sql` via `scripts/migrate-genomics.ts`)

| Migration (new file) | Adds | Why |
|---|---|---|
| `migrations/scan-analysis-detail.sql` | `medical_scans`: `calibrated_probability` numeric, `decision_threshold` numeric, `calibration_temperature` numeric, `ood_score` numeric, `ood_threshold` numeric, `quality_gate` text, `acquisition_modality` text, `acquisition_manufacturer` text, `acquisition_model` text, `input_source` text ('raster'\|'dicom'\|'series') | Today `aiConfidence` is a `"NN%"` string and OOD/acquisition data are discarded |
| `migrations/imaging-studies.sql` | `imaging_studies` (patient, remapped StudyUID hash, description, date-year), `imaging_series` (study, remapped SeriesUID hash, modality, spacing, orientation, slice count, kernel, storage prefix), `imaging_instances` (series, instance number, z, object path); `medical_scans.series_id` FK | Series/volume identity for P1–P4 |
| `migrations/scan-regions.sql` | `scan_regions` (scan, source 'clinician'\|'detector'\|'segmenter', geometry type, coordinates in patient mm and pixel space, diameter_mm, detector_score, mask object path, reviewer disposition, created_by) | Route 1 ROI now; detector candidates and masks later |
| `migrations/clinician-reviews.sql` | `clinician_reviews` (scan, reviewer, model fingerprint, ai_call, reviewer_call, agreement, override_reason, opened_at, signed_at) | §B6 |
| `migrations/clinical-context.sql` | `scan_clinical_context` (scan, structured fields, consent version) | P7 |
| `migrations/inference-jobs.sql` | `inference_jobs` (series, model, status, progress, error) | P4 async |

Do not touch existing migrations. Do not use `db:push` against the shared database.

## C2. API

- `POST /api/scans/analyze`: accept `scanType=lung_nodule` with an ROI (`x,y,w,h` in pixel space or `cx,cy,cz` + diameter in mm for series); accept a zip series (P1b) with per-type size limits; return the full result record (probability, threshold, temperature, OOD score, quality gate, acquisition).
- `GET /api/models/cards`: add `status` (CURRENT / VALIDATION / IN_DEVELOPMENT / PLANNED / FUTURE), `input` description, `route`, and `stages` (which pipeline stages the modality implements) — the homepage reads this.
- `GET /api/capabilities`: the DETECT→ASSIST manifest per modality, server-authored, so the homepage cannot claim a stage the server does not implement.
- `POST /api/scans/:id/review` (structured review), `GET /api/scans/:id/regions`, `POST /api/scans/:id/regions` (clinician ROI), `GET /api/series/:id/instances/:n` (slice image), `GET /api/jobs/:id`.
- `GET /api/models/performance`: add disagreement rate and per-acquisition stratification.
- Keep 422/503 shapes and their wording; extend `respondModelUnavailable` so the reason names the DICOM-on-fallback case.

## C3. Inference service (`inference/`)

- `inference/server.py`: `POST /infer/lung_nodule` (takes image + ROI, crops, renders with `training_window`, screens with the nodule OOD reference, characterises, optional Grad-CAM); `/healthz` reports the third model; remove the `lung` web-PNG endpoint once withdrawn (or keep it behind `INFERENCE_SERVE_LEGACY_LUNG=false` default-off with the registry disabled — prefer removal).
- `inference/dicom_ingest.py`: `dicom_to_png_bytes` passes `force_window=training_window(dataset)`; `deidentify` remaps UIDs with a per-deployment salt; new `assemble_series()` and `series_to_volume()`; return the de-identified bytes for persistence.
- New `inference/quality_gate.py` (deterministic CT checks), `inference/lung_nodule_service.py` (mirrors `server/lung-cancer-service.py` for the nodule artifact: threshold from `lung_nodule_training.json.operatingPoint.threshold`, temperature from `lung_nodule_model_calibration.json`, OOD from `lung_nodule_ood_reference.npz`).
- Later: `inference/detection_service.py`, `inference/segmentation_service.py` (P2/P3), a Python ≥3.10 runtime with its own `requirements.txt` and process.
- New `inference/tests/` (pytest) — see C6.

## C4. Frontend

- Retire `ai-scan-simulator-fixed.tsx`, `multi-cancer-detection-system.tsx` (and their mounts in `dashboard-layout.tsx`, `pages/cancer-detection.tsx`); fold upload into one component per modality driven by `/api/models/cards`.
- Lung: `lung-cancer-analyzer.tsx` becomes an ROI-marking view (draw a box on the rendered slice; a patient cannot mark a nodule — this becomes a clinician tool, so it moves out of the patient tab list in `dashboard-layout.tsx`).
- Radiologist dashboard: structured review form; candidate list (P2); mask overlay (P3); slice viewer (P4). `scan-explanation.tsx` unchanged.
- Result rendering: show calibrated probability with its interval semantics and the operating point; drop "HIGH RISK" styling for a binary flag.

## C5. Homepage

- `enhanced-hero-section.tsx`: remove hardcoded "Two imaging models" and "three more have no classifier"; count from the manifest.
- `cancer-detection-section.tsx`: replace the five-card binary grid with the manifest-driven status grid: **CURRENT** (skin), **VALIDATION** (lung nodule characteriser — serving as research/internal-validation with the 29-nodule interval stated), **IN DEVELOPMENT** (DICOM series pipeline, detection, segmentation), **PLANNED** (3D, multimodal, promptable segmentation, longitudinal), **FUTURE** (breast, colon/GI, prostate, additional cancers, video, ultrasound, endoscopy). Each FUTURE card says "no model, no data, no timeline" — no icons implying a product.
- A new `client/src/components/pipeline-stages-section.tsx`: DETECT → SEGMENT → LOCALIZE → CHARACTERIZE → UNDERSTAND → ASSIST, each stage coloured by the manifest's status per modality, with the caveat that a stage shown as current is current for the modality named, not in general.
- `home.tsx` status alert: unchanged wording, plus the withdrawal of the web-PNG lung model dated.
- A test (`tests/capability-claims.test.ts`) asserting every homepage status badge is derivable from `/api/capabilities`, so a claim cannot drift back in.

## C6. Testing

- **Python** (`inference/tests/`, pytest, run in CI with the system Python; artifacts gitignored so model-dependent tests skip with a reason): `test_dicom_ingest.py` (preamble detection; modality/VOI order; MONOCHROME1; multi-frame; `training_window` forced for CT; de-identification removes every keyword in `_IDENTIFYING_KEYWORDS` and private tags on a real LIDC object; UID remap deterministic and non-reversible; burned-in refusal), `test_quality_gate.py`, `test_ood.py` (both-direction bars on the existing `lidc-ood` sets for the nodule model; the *documented* failure for the legacy model as a regression pin), `test_gradcam.py`, `test_windowing_parity.py` (training script and serving path render the same bytes for the same object).
- **TypeScript**: re-point `tests/outcomes.test.ts`, `tests/scan-explanation.test.ts`, `tests/chaos.test.ts` from `lung` to `lung_nodule` (with an ROI) — re-pointed, not weakened; add `tests/dicom-upload.test.ts` (DICOM stored de-identified; identified original never on disk; fallback path refuses with the right message; series zip accepted/rejected), `tests/clinician-review.test.ts`, `tests/capability-claims.test.ts`, `tests/model-governance.test.ts` extended for the third binding.
- CI: add the pytest step to `.github/workflows/ci.yml`.

## C7. Documentation / governance

- Rewrite the lung sections of `MODEL_CARDS.md`; add the nodule model card (from `lung_nodule_training.json`, per-nodule figures only, rating-not-histology, no demographics possible); `docs/MODEL_CHANGELOG.md` entries for the withdrawal (what got worse: lung is unavailable) and the promotion.
- Correct `docs/REGULATORY_PATHWAY.md` §1, `docs/CLINICIAN_BRIEFING.md` lung section, `docs/DEVICE_INTEGRATION.md` Track B and storage claim, `docs/pack/APPLICATION_TEXT.md`, `docs/pack/DEMO_SCRIPT.md`, `docs/DPIA.md` (DICOM storage flow, UID remap salt as a key), `docs/pack/FAILURE_MODES.md` (new F-08: real CT rendered as a raster passes the legacy screen — closed by withdrawal).
- Delete or header-mark as historical: `docs/TECHNICAL_SPECIFICATIONS.md` §4, `LUNG_CANCER_DETECTION.md`, HIPAA lines in the three audit/checklist files.
- Add `docs/CAPABILITY_STATUS.md` defining CURRENT / IN DEVELOPMENT / VALIDATION / PLANNED / FUTURE with the evidence each requires (mirrors CLAUDE.md's model classes), and `docs/ML_CHANGE_PROCESS.md` (pre-registered bars before measurement, as `build-ood-reference.py` already does).

---

# PART D — CONSIDERATIONS

## D1. Security and privacy

- De-identify before persist; never store the identified object; UID remap salt handled as a key in `server/crypto/keyring.ts`'s manifest; `DeidentificationMethod` stays honest ("best-effort, not validated").
- Series uploads must stream to disk (memoryStorage at 300 MB × concurrency is an OOM), with per-user quotas and the existing `scanLimiter`.
- ROI coordinates, masks and clinical context are special personal information — same encryption manifest, same audit, same erasure holds.
- Any pretrained model adopted in P2/P3 is a supply-chain dependency: pin checksums, record licence, and fingerprint like the `.h5` files.
- Care-relationship enforcement should move from shadow to enforced before any clinician-marking workflow (a clinician drawing on a patient's CT is a stronger act than reading a result).
- Keep the rule that notifications never carry clinical content.

## D2. Clinical safety

- Every new stage inherits the refusal shapes: no candidates ≠ no nodules; no mask ≠ no lesion; a detector miss must be indistinguishable in the UI from "detector not run" only if the UI says which it was.
- Never show a measurement without "model-derived, unvalidated" until validated per B3.
- The nodule characteriser's 29-nodule interval is printed next to every figure; the model class is VALIDATION/research, never PRODUCTION.
- Grad-CAM caveat stays attached; candidate boxes get their own ("a box is a detector hypothesis, not a finding").
- Human review remains 100%; triage order changes are the harm channel (`docs/REGULATORY_PATHWAY.md` §2) — disagreement-rate alerts are the safeguard.

## D3. Regulatory / validation

- Intended use stays "prioritise review order" (§5 of the pathway doc). Adding detection widens the claim and likely the class — a consultant question before P2 ships to any clinic.
- Adopting a third-party pretrained model does not import its validation; local per-nodule re-validation with pre-registered bars is the minimum.
- The LIDC licence (CC BY 3.0) and citation are already recorded in `lung_nodule_training.json`.
- Keep the honest timeline (2–4 years to a cleared device).

## D4. Technical risks and dependencies

| Risk | Mitigation |
|---|---|
| Withdrawing lung removes the only radiology demo 5 days before submission | Promote the nodule characteriser (route 1) in Phase 1a; the DEMO_SCRIPT already tells the DICOM story — retell it as "the pipeline found its own model could not be trusted on CT, and replaced it" |
| Python 3.8 cannot run MONAI/nnDetection/pylidc | Side-by-side ≥3.10 environment for P2+; keep 3.8 for the TF models until migrated |
| CPU-only: 3D detection inference is minutes per series | Async jobs (P4), or 2.5D models; state the latency |
| Pretrained detectors were trained on LUNA16 = LIDC subset → validation leakage | Exclude overlapping series by SeriesInstanceUID before validating |
| `dataset/` outside git | `npm run backup:models` after every artifact change; model registry store (MLflow/DVC) later |
| Shared Supabase database for dev/test/demo | Provision `TEST_DATABASE_URL` before running the re-pointed suites |
| `resolveScanType` substring match: `lung_nodule` contains `lung` | Exact-match first, substring second, or rename keys so none is a prefix of another |
| Windowing regression between training and serving | `test_windowing_parity.py` in CI |

---

# PART E — PRIORITY RATIONALE

| P | Item | Why here |
|---|---|---|
| 0 | Correct the false claim; withdraw the legacy lung model | It is in the submission pack and falsifiable in one upload; nothing else matters if a judge finds it first |
| 1 | Lung DICOM/CT pipeline (+ promote the nodule characteriser) | The only modality with real clinical-format data on disk, a trained CT model, and a label pipeline already built; unblocks every later lung stage; makes the DICOM story true |
| 2 | Nodule detection | Turns route 1 (clinician points) into route 2 (system proposes); the characteriser exists to consume its output; the biggest step in clinical usefulness with the least new modelling under D2 |
| 3 | Nodule segmentation | Needs candidates to segment; supplies size/volume, which Lung-RADS and Brock require and which today are explicitly "not measured" |
| 4 | 3D | Detection/segmentation are inherently volumetric; 3D is the plumbing they need once they exist, not before |
| 5 | Skin fairness and validation | Runs in parallel with 1–4 (different team skills, data-gated); placed here because it is data-blocked and its published disclosure already exists — the work is acquisition, not engineering |
| 6 | Clinician review and outcome monitoring | Cheap, data-free, needed before any P2 candidate UI so that disagreements are captured from day one; deliberately not earlier only because P1 defines the record it structures |
| 7 | Multimodal context | Needs the structured record (P6) and a measured nodule (P3) to fuse with anything published (Brock) |
| 8 | Promptable segmentation | An interaction model over P3's masks; useless without them |
| 9 | Longitudinal | Needs series identity (P1), registration (P4) and measurements (P3) |
| 10–12 | Breast, colon/GI, prostate | Each is a new modality with no data or model in the repository; order follows SA burden and public-dataset availability |
| 13 | Video / ultrasound / endoscopy | Temporal models, different capture hardware, farthest from anything present |

---

# PART F — PHASED PLAN WITH FILE-LEVEL DETAIL

Each phase lists: modify / create / unchanged / migrations / API / ML / frontend / tests. No phase changes an existing migration or disables a safety mechanism.

## Phase 0 — Correct the record and withdraw the legacy lung model (before 24 Sep)

**Modify**
- `server/model-availability.ts`: `lung.enabled = false`, `disabledReason` quoting the measurement (38/40, 11/12, medians) and the withdrawal date; make `resolveScanType` prefer an exact key match.
- `server/privacy/ai-analysis-consent.ts`: remove the lung error-rate sentence from `DISCLOSURE_TEXT` (or reword for the nodule model in Phase 1a); bump `DISCLOSURE_VERSION`.
- `inference/server.py`: `infer_lung` docstring/comment corrected; keep the DICOM gate; log that the modality is withdrawn.
- `inference/dicom_ingest.py`: `_window` fallback comment corrected (measurement, not the 22.9 claim).
- `scripts/build-ood-reference.py`: add `--measure-only` (no rewrite of the `.npz`/`.json`) and add `dataset/lidc-ood/whole-slice` as a `refuse` domain for `lung`; run it once and commit the printed report into `MODEL_CARDS.md` — the script's own non-zero exit is the record.
- `MODEL_CARDS.md`, `docs/MODEL_CHANGELOG.md` (withdrawal entry, "what got worse"), `docs/pack/APPLICATION_TEXT.md`, `docs/pack/DEMO_SCRIPT.md`, `docs/DEVICE_INTEGRATION.md`, `docs/CLINICIAN_BRIEFING.md`, `docs/REGULATORY_PATHWAY.md`, `docs/pack/FAILURE_MODES.md` (F-08), `docs/DPIA.md` (DICOM storage note).
- `docs/TECHNICAL_SPECIFICATIONS.md` §4, `LUNG_CANCER_DETECTION.md`, `PRODUCTION_AUDIT_REPORT.md`, `SECURITY_CHECKLIST.md`, `FINAL_AUDIT_SUMMARY.md`: historical header or deletion of the fabricated sections.
- `client/src/components/enhanced-hero-section.tsx`, `cancer-detection-section.tsx`: remove hardcoded counts/copy; read from cards.
- `tests/outcomes.test.ts`, `tests/scan-explanation.test.ts`, `tests/chaos.test.ts`: re-point from `lung` to `skin` for Phase 0 and to `lung_nodule` in Phase 1a; assert the withdrawn modality answers 503 with the withdrawal reason.
**Create**: `tests/withdrawn-modality.test.ts`.
**Unchanged**: every migration; `server/model-governance.ts` (binding stays; a disabled-but-bound modality is a valid state); `inference/gradcam.py`; all `server/crypto/*`.
**Migrations**: none. **API**: cards now show lung disabled with reason. **ML**: none. **Frontend**: copy only.

## Phase 1a — Promote the LIDC nodule characteriser (route 1) — no new data

**Modify**
- `server/model-availability.ts`: `lung_nodule` entry with per-nodule figures, CIs, "rating not histology", "no demographics", class VALIDATION.
- `server/model-governance.ts`: `MEASUREMENT_BINDINGS.lung_nodule` (fingerprint of `resnet50v2_lung_nodule_model.h5`, `re_measured` once a `scripts/verify-lung-nodule-operating-point.py` reproduces sens 0.862/spec 0.691 at 0.30 per nodule).
- `server/model-fingerprint.ts`: `Modality` union and `artifactPath` (`LUNG_NODULE_MODEL_PATH`).
- `server/inference-client.ts`: modality union; `infer()` carries an ROI form field.
- `server/routes.ts`: `performRealTimeAnalysis` case `lung_nodule` → new `performLungNoduleAnalysis`; ROI parsing/validation; persist the new columns; drop `confidenceThreshold: 70.0`.
- `server/scan-explanation.ts`: modality union, `isPositiveCall`, ROI passed to the explanation re-run.
- `inference/server.py`: `/infer/lung_nodule`, `/healthz`.
- `inference/dicom_ingest.py`: `force_window=training_window(dataset)` in `dicom_to_png_bytes`; return de-identified bytes.
- `dataset/lung_nodule_model/lung_nodule_training.json`: fix `knownGaps` (regenerated by the training script, not hand-edited — add the fix to `scripts/train-lung-nodule-model.py`'s metadata writer and re-run only the metadata step, or record the correction in the changelog).
- `client/src/components/lung-cancer-analyzer.tsx` → clinician ROI-marking flow; `dashboard-layout.tsx` moves the lung tool to clinician roles; `radiologist-dashboard.tsx` renders the ROI with the result.
- `docs/MODEL_CHANGELOG.md`, `MODEL_CARDS.md` (nodule card), `docs/CLINICIAN_BRIEFING.md`, `docs/REGULATORY_PATHWAY.md` §1 (now truly "CT nodule patch"), `docs/pack/APPLICATION_TEXT.md`.
**Create**: `inference/lung_nodule_service.py`, `scripts/verify-lung-nodule-operating-point.py`, `migrations/scan-analysis-detail.sql`, `migrations/scan-regions.sql`, `inference/tests/{conftest.py,test_dicom_ingest.py,test_windowing_parity.py,test_ood.py,test_lung_nodule_service.py}`, `inference/requirements-dev.txt` (pytest), `tests/dicom-upload.test.ts`, `tests/lung-nodule.test.ts`.
**Unchanged**: `server/lung-cancer-service.py` (kept for the reproduction commands only), `server/skin_cancer_model.py`, `scripts/lidc_*.py`.
**Migrations**: the two above (additive). **API**: `scanType=lung_nodule` + ROI. **ML**: none new. **Frontend**: ROI tool. **Tests**: as listed; CI gains the pytest step.

## Phase 1b — DICOM series ingest — **implemented 2026-09-22**

A real CT study can now be ingested as a de-identified, ordered, quality-gated
series that a later inference stage could read. Nothing clinical happens: no
model reads a series, no finding is written, and `ingestStatus` is a statement
about file handling.

**Created**: `inference/series.py` (assembly and ordering),
`inference/quality_gate.py`, `inference/uid_remap.py`, `server/dicom-series.ts`
(storage and persistence), `migrations/imaging-series.sql`,
`scripts/lidc_find_series.py` (test fixture locator),
`inference/tests/{test_series_assembly,test_quality_gate,test_uid_remap,test_server_app}.py`,
`tests/dicom-series.test.ts`.
**Modified**: `inference/server.py` (`POST /ingest/series`; `/deidentify` gained
`preview=false`), `inference/dicom_ingest.py` (three-way UID keep/remap/delete
policy; de-identified UIDs reported back), `server/routes.ts`
(`POST /api/dicom/series`, `GET /api/dicom/series/:id`, per-request staging,
multer limits with a status), `server/inference-client.ts` (NDJSON stream
reader), `shared/schema.ts`, `server/capabilities.ts`, `.env.example`,
`scripts/generate-secrets.ts`, `package.json`.
**Unchanged**: the nodule model and its OOD/calibration artifacts; every
existing migration; every governance, consent and disclosure control.

### Decisions

**A series is assembled from the objects, not from the upload.** Grouping is by
`SeriesInstanceUID` and ordering is by projecting `ImagePositionPatient` onto
the slice normal (the cross product of the two `ImageOrientationPatient`
cosines), falling back to `SliceLocation` and then `InstanceNumber`, each with
its own `trusted` verdict. Sorting by the z component of
`ImagePositionPatient` is the common shortcut and is wrong the moment a series
is not axial. Filename order is never used. Two different series in one upload
are **refused, not merged**: a merged series is a volume containing slices from
two acquisitions, and nothing downstream could detect that.

**The quality-gate bars were measured, not chosen.** Across 30 LIDC-IDRI series
on 2026-09-22: 109-351 slices, 1.0-3.0 mm thickness, uniform spacing, 512x512,
all CHEST, all axial. The bars sit outside that range —
`MIN_SLICES = 40`, thickness 0.4-5.0 mm, pixel spacing 0.2-2.0 mm,
`MIN_MATRIX = 256`, spacing tolerance `max(0.5 mm, 25%)` — so the gate cannot
refuse the collection the downstream model was trained on. A test asserts that
property directly. Every check runs every time, so a caller fixing one problem
does not resubmit a 150 MB study to discover the next.

One deliberate exception to fail-closed: an **absent** `BodyPartExamined` is a
warning, not a failure, because it is absent from many real exports; the series
is recorded with `anatomyVerified: false` rather than assumed to be a chest. A
*wrong* body part is still a refusal.

**UIDs are remapped, not deleted and not randomised.** `HMAC-SHA256(salt,
"<kind>|<uid>")` truncated to 128 bits, stamped with the RFC 4122 v4 version
and variant bits, emitted under the PS3.5 Annex B.2 UUID-derived root `2.25.`.
Deleting UIDs destroys the study/series/instance tree, so a series cannot be
assembled and a prior cannot be found. Hashing in the clear preserves the tree
and reintroduces a join key to the source PACS, because the UID space one site
emits is small enough to enumerate. A salted HMAC gives both properties at
once. The salt is `DICOM_UID_SALT`; without it (or below 32 characters) the
service generates a per-process salt, warns once, and reports
`uidMappingScope: "ingestion"` instead of `"deployment"` — the mapping still
works within one ingestion, and the manifest and the stored row both say which
regime produced them rather than leaving it to be assumed.

**The response is a stream.** A 133-slice chest CT is roughly 93 MB of base64
as one JSON document, held whole on both sides. `POST /ingest/series` answers
newline-delimited JSON: the verdict first, then one event per slice in
anatomical order, then a completion line. The verdict comes first so a rejected
series emits no pixel data at all.

**Order of operations is the safety property.** Assemble, order, gate,
de-identify, store objects, and write rows last in one transaction. A failure at
any point deletes the stored objects and writes no rows. Writing rows as
instances arrive would produce a half-series that looks like a complete study
to everything downstream. A truncated stream is reported as `incomplete_series`:
partial is not a study.

**Re-ingestion is recognised, not duplicated.** Deterministic remapping means
the same series produces the same de-identified `seriesUid`, which is unique in
`imaging_series`; a second upload returns 200 with `alreadyIngested: true`
rather than a second row or a silent no-op.

### Persistence

`imaging_studies` (patient, remapped `study_uid` unique), then `imaging_series`
(remapped `series_uid` unique, modality, instance count, ordering method and
trust, quality-gate verdict and its JSON, `anatomy_verified`, geometry,
acquisition, `uid_mapping_scope`, storage prefix, `ingested_by`,
`ingest_status`), then `imaging_instances` (position index, remapped `sop_uid`,
position in mm, object path). Additive migration; no existing migration was
touched. No clinical column exists on any of the three.

### Security and privacy

Clinician roles only (`requireMedicalAccess`), audited as
`DICOM_SERIES_INGESTED` / `DICOM_SERIES_REJECTED` with counts and de-identified
identifiers only; the read is care-relationship gated. Uploads stream to disk,
never to memory: one staging directory per request, outside `uploads/`, removed
in a `finally` that runs on success, on refusal, on an exception and on a
multer limit. The original UIDs never cross the service boundary, are never
logged, and appear in no response — including rejections, which carry counts.
The bytes written to the object store are the de-identified ones, never the
upload.

### Verified

91 Python tests pass (29 pre-existing plus 62 new). `npx tsc --noEmit` and
`npm run build` clean. End to end against the resident service with 45 real
LIDC-IDRI CT objects on 2026-09-22: 43 checks, all passing — gate passed,
ordering trusted, median spacing 2.5 mm, every returned object marked
`PatientIdentityRemoved=YES` with no original identifier in its bytes, dates
reduced to the year, private tags gone, pixel data and geometry intact, the
remap deterministic across two ingestions, and mixed-series, too-few-slices,
non-DICOM and empty uploads all refused with no pixel data streamed.
`tests/dicom-series.test.ts` covers the HTTP layer and writes to a database, so
it runs with the rest of `npm test` against a disposable one.

### Known limitations

- **Not a volume.** The series is ordered and its spacing is known; nothing
  resamples, holds or renders a volume. That is P4.
- **Nothing reads a series.** `medical_scans` and the nodule characteriser are
  still per slice; an ingested series is not yet an input to inference.
- **Upload only.** No C-STORE SCP, no DICOMweb. A study reaches the platform
  because somebody exported it. Declared as `dicom-network-receive` PLANNED.
- **Best-effort de-identification.** PS3.15 Basic Profile by keyword plus
  wholesale private-tag removal; burned-in pixel text is refused via
  `BurnedInAnnotation`, not detected by OCR. Unchanged from P1a and still
  stated as best-effort.
- **The salt is the control.** Without `DICOM_UID_SALT` the mapping is
  per-process, so two ingestions in different processes will not agree and a
  prior cannot be found. Recorded per series as `uid_mapping_scope`.
- **`GET /api/dicom/series/:id` returns metadata, not pixels.** There is no
  slice-serving endpoint and no viewer yet.
- **One patient per upload is asserted by the caller.** The service checks that
  the objects are one series; that the named patient is the right one is the
  clinician's act, and it is audited.

## Phase 2 — Nodule detection (route 2), CPU-only, pretrained

**Create**: a Python ≥3.10 environment (`inference/py310/requirements.txt`), `inference/detection_service.py` (separate process/port, `DETECTION_URL`), `scripts/validate-detector-on-lidc.py` (per-nodule sensitivity at FP/scan with intervals; LUNA16-overlap exclusion; pre-registered bar written before running), `dataset/lung_detector/` (checkpoint, licence, checksum, validation JSON — gitignored like the rest), `client/src/components/candidate-list.tsx`, `tests/detection-candidates.test.ts`, `inference/tests/test_detection_contract.py`.
**Modify**: `server/model-availability.ts` (a `lung_detector` entry with FROC-style figures and class), `server/model-governance.ts`, `server/routes.ts` (candidates persisted as `scan_regions` source `detector`; each candidate characterised), `radiologist-dashboard.tsx` (accept/reject per candidate, recorded), `ops/alerts.yml` (candidate-rate collapse/saturation, mirroring `PredictionRateCollapsed`), `docs/REGULATORY_PATHWAY.md` (claim widening flagged **[CONFIRM]**).
**Migrations**: none beyond `scan-regions.sql` (already present). **Gate**: no candidate UI ships unless the pre-registered bar is met.

## Phase 3 — Segmentation

**Create**: `inference/segmentation_service.py` (organ mask as quality-gate input first; nodule mask second), `scripts/lidc_extract_contours.py` (per-reader boundaries from the same XML `lidc_build_labels.py` reads), `scripts/validate-segmenter-on-lidc.py` (Dice vs reader consensus, per nodule), `client/src/components/mask-overlay.tsx`, `tests/segmentation-masks.test.ts`.
**Modify**: `inference/quality_gate.py` (field-of-view via organ mask), `server/routes.ts` (mask path in `scan_regions`, derived diameter/volume labelled unvalidated), `radiologist-dashboard.tsx`, `MODEL_CARDS.md`.

## Phase 4 — 3D

**Create**: `inference/volume.py` (SimpleITK/nibabel; resample; spacing kept), `server/inference-jobs.ts`, `migrations/inference-jobs.sql`, `client/src/components/volume-viewer.tsx` (Cornerstone3D), `tests/inference-jobs.test.ts`.
**Modify**: `server/websocket.ts` (job progress events), `server/routes.ts` (`GET /api/jobs/:id`, `GET /api/series/:id/instances/:n`), `inference/detection_service.py` & `segmentation_service.py` (volume input), `docs/pack/FAILURE_MODES.md` (T-07 long-running job).

## Phase 5 — Skin fairness and validation (parallel; data-gated)

**Modify**: `scripts/measure-skin-tone-performance.py` (accept labelled Fitzpatrick sets, not only ITA), `server/fairness.ts` (a second report type: labelled), `scripts/train-skin-cancer-model.py` (optional unfrozen upper blocks behind a flag; CPU feasibility noted), `MODEL_CARDS.md`, `docs/DPIA.md` §5A.
**Create**: `scripts/evaluate-skin-on-labelled-tones.py`, `docs/SKIN_VALIDATION_PROTOCOL.md` (pre-registered bins and bars), `tests/fairness-labelled.test.ts`.
**Unchanged**: the deployed skin artifact until a new one passes the governance steps.

## Phase 6 — Clinician review and outcome monitoring (no data needed; can start with Phase 1a)

**Create**: `migrations/clinician-reviews.sql`, `server/clinician-review.ts`, `client/src/components/structured-review-form.tsx`, `tests/clinician-review.test.ts`.
**Modify**: `server/routes.ts` (`POST /api/scans/:id/review`; the report endpoint writes a review row alongside the outcome), `server/production-performance.ts` (disagreement rate with Wilson CI; per-acquisition strata), `server/metrics.ts` (`healthai_review_disagreement_total`), `ops/alerts.yml` + `ops/alerts_test.yml` (`ReviewDisagreementElevated`), `ops/RUNBOOK.md`, `radiologist-dashboard.tsx`, `outcome-review-panel.tsx`, `model-performance-panel.tsx`, `docs/MODEL_GOVERNANCE.md` (disagreement as a post-market signal).

## Phase 7 — Multimodal clinical context

**Create**: `migrations/clinical-context.sql`, `server/clinical-context.ts` (Brock/PanCan implemented from the published coefficients with citation, requiring a validated nodule measurement from P3), `client/src/components/clinical-context-form.tsx`, `tests/clinical-context.test.ts`.
**Modify**: `lung-cancer-analyzer.tsx` (transmit, do not compute locally), `server/screening-eligibility.ts` (shared vocabulary), `server/privacy/ai-analysis-consent.ts` (scope for context use), `docs/DPIA.md`.

## Phase 8 — Promptable segmentation

Gated on P3/P4. **Create**: `inference/promptable_segmentation_service.py` (a MedSAM-class model under the ≥3.10 runtime, click/box prompts on P4's viewer), `client/src/components/prompt-tools.tsx`, validation script and tests. **Modify**: `scan_regions` source `'prompted'`, `MODEL_CARDS.md`.

## Phase 9 — Longitudinal

Gated on P1b/P3/P4. **Create**: `inference/registration.py`, `server/longitudinal.ts` (prior lookup by remapped study hash), `migrations/scan-comparisons.sql`, `client/src/components/prior-comparison.tsx`, tests. NLST or a partner dataset required for validation.

## Phases 10–13 — Breast, colon/GI, prostate, video/ultrasound/endoscopy

Nothing is created in the repository for these beyond manifest entries with status **FUTURE** and a one-line statement each in `docs/CAPABILITY_STATUS.md`. Each would follow the same template when a dataset and a model exist: quality gate → both-direction OOD reference → calibration → held-out per-case figures with intervals → fairness where measurable → registry + binding + changelog → consent disclosure → tests.

---

## Verification (applies to every phase)

```bash
npx tsc --noEmit                       # clean
npm run build                          # clean
TEST_DATABASE_URL=<disposable> npm test  # all suites; re-pointed ones included
python -m pytest inference/tests       # Phase 1a onward
python scripts/build-ood-reference.py lung_nodule --measure-only   # exit 0, both directions
python scripts/verify-lung-nodule-operating-point.py               # reproduces the registry figures
node scripts/check-ops-config.mjs && promtool test rules ops/alerts_test.yml
```

End-to-end for Phase 1a: start `uvicorn inference.server:app`, set `INFERENCE_URL`, log in as a radiologist, upload a real LIDC DICOM, confirm (1) the stored object on disk has `PatientIdentityRemoved=YES` and no `PatientName`; (2) the rendered slice is at the lung window regardless of the object's display preset; (3) a 64 px ROI around a labelled nodule returns a calibrated probability with OOD score, threshold and fingerprint; (4) a whole-slice ROI is refused by the nodule OOD screen; (5) `GET /api/models/cards` shows `lung` disabled with the measured reason and `lung_nodule` bound `re_measured`; (6) the homepage shows lung under VALIDATION with the interval stated.

Claim sweep after every phase: `grep -rn "22.9\|22.88\|refuses every\|every clinical acquisition\|20.3–30.4" MODEL_CARDS.md docs client/src inference server` must return only the corrected historical note.

---

# FINAL STATUS TABLE

| CAPABILITY | CURRENT STATUS | EVIDENCE IN CODEBASE | REQUIRED WORK | PRIORITY |
|---|---|---|---|---|
| Skin lesion analysis | CURRENT (research prototype; not clinically validated) | `dataset/data/resnet50v2_skin_cancer_model.h5`, `server/skin_cancer_model.py`, `MODEL_REGISTRY.skin`, binding `ed06b8a0468e` re_measured, BA 0.864 on 660 | Labelled dark-skin validation; optional fine-tuning; no serving change | P5 |
| Lung analysis | WITHDRAWN (D1); nodule characteriser VALIDATION-class, not served | Legacy: `dataset/lung_cancer_MRI_dataset/*`, accepts 38/40 real CT slices (measured 2026-09-20). Nodule: `dataset/lung_nodule_model/*`, sens 0.862/spec 0.691 per nodule (n=97, 29 malignant) | Withdraw legacy; promote nodule model via governance; ROI route | P0, P1a |
| DICOM | Upload ingest implemented for a single object and a CT series (manifest status IN_DEVELOPMENT: no model is involved); no network receive | `inference/dicom_ingest.py` + `inference/series.py` + `inference/quality_gate.py` + `inference/uid_remap.py`; `POST /ingest/series` streams NDJSON; `POST /api/dicom/series` stores de-identified objects and the study/series/instance tree (`migrations/imaging-series.sql`); `training_window` on every serving render | C-STORE SCP / DICOMweb (P1b+); a slice-serving endpoint and viewer (P4) | done: P1a, P1b |
| CT | PARTIAL: ingest and quality gate are implemented; characterisation serves under VALIDATION terms, per slice | 229 LIDC series in `dataset/manifest-1600709154662/`, `scripts/lidc_*.py`, `dataset/lidc-ct/patches.csv`; gate bars measured on 30 of those series (2026-09-22); `lung_nodule` bound `9faf49cdca48` | Series-level inference (P2+); volume (P4) | done: P1a, P1b |
| 3D imaging | MISSING | `_select_frame` takes the middle frame only | Volume assembly, async jobs, viewer | P4 |
| Detection | MISSING | none (`lung_nodule_training.json.doesNotAnswer`: "There is no nodule detector") | Pretrained detector + LIDC per-nodule validation with pre-registered bar | P2 |
| Segmentation | MISSING | none; LIDC contours parsed for centroids only (`lidc_build_labels.py`) | Organ mask for QC, nodule mask validated by Dice | P3 |
| Localization | EXPERIMENTAL | Grad-CAM 7×7 upsampled (`inference/gradcam.py`) with caveat | Coordinates from P2 candidates; masks from P3 | P2/P3 |
| Characterization | CURRENT (skin) / VALIDATION not served (lung nodule) | as above | Wire nodule model; later 3D patch model | P1a |
| OOD detection | CURRENT (skin, both-direction validated for nodule model); INSUFFICIENT for legacy lung on real CT | `skin_model_ood.json`, `lung_nodule_model_ood.json` pass; `lung_model_ood.json` validated against skin only; real CT median 12–14 < 16.51 | Record the failure machine-checkably; withdraw legacy; per-model both-direction references for every new model | P0 |
| Calibration | CURRENT | `scripts/calibrate-model.py`; ECE/Brier/NLL; T applied for legacy lung, measured-not-applied for skin and nodule | Store calibrated P and T per scan; per-model on every new model | P1a |
| Grad-CAM | CURRENT (on demand, fingerprint- and consent-checked) | `server/scan-explanation.ts`, `tests/scan-explanation.test.ts` | Extend to nodule ROI; candidate-level later | P1a |
| Clinician review | CURRENT, unstructured | `/api/radiologist/scans/:id/report`, `scan_outcomes`, `recordOutcomeAndNotify` | Structured agreement/override record; disagreement metric + alert | P6 |
| Multimodal AI | MISSING | questionnaire client-only (`lung-cancer-analyzer.tsx`) | Store context; Brock-type validated rule after P3 | P7 |
| Genomics | CURRENT (separate track; PRS with transferability withholding) | `server/genomics/*`, `/api/genomics/transferability` | No imaging fusion until P7+ | — |
| Fairness monitoring | CURRENT for skin (offline ITA report + production bin); NOT POSSIBLE for LIDC | `server/fairness.ts`, `skin_tone_performance.json`, `medical_scans.skin_tone_bin`; `lung_nodule_training.json.knownGaps[0]` | Labelled-tone validation; acquisition-stratified monitoring for CT | P5, P6 |
| Real-time notifications | CURRENT | `server/websocket.ts` session-authenticated; `tests/realtime.test.ts` | Job progress events; Redis adapter for >1 replica | P4 |
| Audit logging | CURRENT | `audit_events`, `auditLog` on ~40 routes, `SCAN_ANALYSED` | Add review/ROI/candidate actions | P1a, P6 |
| POPIA controls | CURRENT with two shadow controls | consent scopes, erasure with holds, encryption keyring, break-glass; `CARE_RELATIONSHIP_ENFORCE`/`MFA_ENFORCE` still off; every DICOM path now persists the de-identified object, series UIDs salted-remapped, identified uploads removed with the request | Enforce care relationship before clinician-marking; erasure to cover `imaging_*` | P6 |
| Breast roadmap | FUTURE (no model, no data) | "breast" listed in `cancer-detection-section.tsx` as "No model"; `MODEL_CARDS.md` "Modalities with no model" | Manifest status only | P10 |
| Colon roadmap | FUTURE (not mentioned anywhere today) | none | Manifest status only | P11 |
| Prostate roadmap | FUTURE (no model, no data) | listed as "No model" | Manifest status only | P12 |
| Medical video roadmap | FUTURE | none | Manifest status only | P13 |
