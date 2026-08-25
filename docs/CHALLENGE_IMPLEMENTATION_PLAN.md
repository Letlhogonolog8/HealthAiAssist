# Challenge Implementation Plan

Working checklist for the 2026 SA MedTech Innovation Challenge entry.
Derived from the readiness review of 24 August 2026.

**Deadline: 25 September 2026, 23:59 SAST.**
**Target: Category A (TRL 4), Track 2 — AI-Enabled Care and Triage.**

Phases 0–4 must land before submission. Phases 5–6 are the *stated development
plan* the application describes under Guidelines §6 — they are written here so
the plan is real, not so they are built by September.

Verification commands are given per task. A task is not done until its command
passes.

---

## Phase 0 — Unblock (Days 1–3, 25–27 Aug)

Nothing else in this document matters until Phase 0 is complete. P0.1 and P0.2
are the two items that decide whether the entry is viable at all.

### P0.1 — Establish the South African entity route `BLOCKING` `non-code`

The portal restricts entry to SA-registered SMMEs, university-based teams,
science-council teams, or academic laboratories. Nothing in this repository
establishes which route applies.

- [ ] Decide the route: CIPC-registered company, or institutional affiliation.
- [ ] If company: obtain the CIPC registration certificate and a SARS tax
      compliance PIN (Guidelines §5 lists both as possible requests).
- [ ] If institutional: obtain a signed authorisation letter on letterhead
      (Guidelines §4.1, §11.2).
- [ ] If genuinely unclear, submit a written query through the portal's official
      channel (Guidelines §9) and keep the reply.

**Done when:** you physically hold a CIPC certificate or a signed institutional
letter.

---

### P0.2 — Purge the contradictory documents `BLOCKING`

Five tracked files assert accuracy, regulatory and feature claims that the code
contradicts. Under Guidelines §11.6 an inaccurate application may be excluded.

- [ ] `git rm pitch-deck.md executive-summary.md investor-package-overview.md financial-model.md`
- [ ] `git rm ADVANCED_FEATURES_COMPLETE.md`
- [ ] Fix `README.md` lines 3 and 97 — they claim detection across "breast, lung,
      skin, colon, and prostate". Two modalities have models. Rewrite both to
      say skin and lung, and name the other three as having no classifier.
- [ ] Sweep the remaining docs for survivors:
      `PRODUCTION_AUDIT_REPORT.md`, `SECURITY_CHECKLIST.md`,
      `FINAL_AUDIT_SUMMARY.md`, `CHATBOT_SYSTEM_INSTRUCTIONS.md`.

If you want investor material later, rebuild it from `MODEL_CARDS.md`, which is
already accurate. Do not edit the old files into shape — start from the true
figures.

**Verify:**

```bash
grep -rniE "HIPAA|FDA (clear|approv)|SOC 2|ISO 13485|CE mark|SAHPRA (approv|submit|pre-sub)|9[0-9](\.[0-9])?% ?accur" \
  --include="*.md" . | grep -v node_modules
```

**Done when:** every remaining hit is a historical note describing a *removed*
claim (as `MODEL_CARDS.md` and `admin-dashboard.tsx` already do), never a
present-tense assertion.

---

### P0.3 — Fix the Cloud Storage availability gate `BUG`

`isGoogleCloudAvailable()` returns `visionClient !== null && storageClient !== null`
(`server/google-cloud-service.ts:248`). The Vision client is only used by dead
code, but `persistScanImage` is gated on this function — so when Vision
credentials fail to initialise, **every scan image falls through to
container-local `uploads/`**, which is ephemeral on Render, Railway and Cloud Run.
Patient images are being written to disposable storage whenever Vision is
unhappy, regardless of whether the bucket is fine.

- [ ] Change the predicate to `storageClient !== null`.
- [ ] Rename to `isScanObjectStoreAvailable()` so the name says what it gates.
- [ ] Update the import and call site in `server/routes.ts:64,125`.

**Verify:** with valid Storage credentials and no Vision credentials, upload a
scan and confirm `medical_scans.image_path` begins `gs://`, not `file://`.

---

### P0.4 — Delete the dead analysis code

Nothing calls any of this, but it is exactly the pattern the codebase was
cleaned of, and a judge reading the repository will find it.

- [ ] `server/google-cloud-service.ts` — delete `analyzeImageWithGoogleCloud`,
      `analyzeMedicalContent`, `assessMedicalRisk`, the `visionClient` and its
      initialisation, and the `@google-cloud/vision` import. Keep
      `uploadToGoogleCloudStorage` and `getSignedScanUrl` — both are live.
- [ ] `git rm client/src/components/blood-test-analyzer.tsx` — scores cancer risk
      in the browser from hand-written weights and names cancer types from them.
- [ ] `git rm client/src/components/demo-walkthrough.tsx` — unrouted, and claims
      DICOM support.
- [ ] `git rm client/src/components/index.ts` — the barrel is imported by nothing
      and re-exports components that no longer exist or are unrouted
      (`ProstateCancerAnalyzer` has no model behind it).
- [ ] `npm uninstall @google-cloud/vision`

**Verify:** `npx tsc --noEmit && npm run build` — both clean.

---

### P0.5 — Remove the residual UI claims

- [ ] `client/src/components/ai-scan-simulator-fixed.tsx:246` — "Supports DICOM,
      JPG, PNG formats up to 10MB" → "JPEG, PNG, TIFF, WebP or AVIF, up to 10 MB".
      The server allowlist is at `server/routes.ts:519`; keep the two in step.
- [ ] `client/src/components/google-ai-scanner.tsx` — the `AnalysisResult`
      interface declares `metastasisDetected`, `metastasisStage`,
      `bloodMarkersAnalysis`, and a `cancerType` union including `cervical`,
      `breast` and `prostate`. The server returns none of these. Delete the dead
      fields so the type describes the actual response.

---

### P0.6 — Fix the two labelling defects

- [ ] `accuracyLevel: Math.round(confidence)` reports confidence under the name
      "accuracy". Rename to `modelConfidencePercent` through
      `performSkinCancerAnalysis`, `performLungCancerAnalysis`, the
      `/api/scans/analyze` response, and every client consumer.
- [ ] `modelVersion` is the literal `'resnet50v2-skin-v1'`. Derive it from a
      SHA-256 of the artifact file, computed once at startup and cached:
      `resnet50v2-skin-<first 12 hex>`. Retraining then cannot silently mislabel
      a stored result.

**Verify:** `grep -rn "accuracyLevel" server/ client/src/` returns nothing.

---

### P0.7 — Cheap security wins

- [ ] `server/security-config.ts` — stop echoing `userId`, `userRole` and
      `requestedPatientId` in the 403 body of `requirePatientDataAccess`.
- [ ] Same file — remove the unconditional `console.log` of that triple.
- [ ] `server/security-enhanced.ts` — drop the blanket `https:` from
      `connectSrc`. Keep `'self'`, `https://api.openai.com`, `wss:`, `ws:`.
- [ ] `server/routes.ts` — replace `exec()` with `spawn()` and an argument array
      in `performLungCancerAnalysis`, so no path ever reaches a shell. (This is
      superseded by P1.3 but do it now in case P1.3 slips.)
- [ ] Rotate every credential in `.env` — database password, `OPENAI_API_KEY`,
      Twilio token, `SESSION_SECRET`, `ENCRYPTION_KEYS`. Do this before any
      demonstration or screen-share.

**Verify:** `npm test` — still 139/139. Load the app and confirm no CSP violation
in the console.

---

## Phase 1 — Close the structural gaps (Days 4–10, 28 Aug – 3 Sep)

### P1.1 — Recruit a clinical advisor `non-code` `highest non-code value`

Guidelines §4.1 rewards multidisciplinary teams. A solo software build with no
named clinical collaborator scores poorly on the team criterion regardless of
code quality, and §7's "clinical utility" criterion cannot be evidenced at all
without one.

- [ ] Target a practising SA radiologist or dermatologist. Routes in: UCT MedTech
      (a challenge partner), a university dermatology or radiology department,
      the Radiological Society of South Africa, the Dermatology Society of
      Southern Africa.
- [ ] Ask for two things only: a 30-minute walkthrough of the tool, and a
      one-page letter for the application.
- [ ] Offer co-authorship on any validation work that follows.

**Done when:** a named advisor has run the tool and signed a letter.

---

### P1.2 — Write the device integration architecture `closes the §2 gap`

Guidelines §2 asks for system-level integration across device, AI and secure
workflow. You have two of three. §3 explicitly permits Category A applicants to
demonstrate the third through "prototypes, system architecture, development
plans, or partnership arrangements". Use that clause honestly rather than
inventing a capability.

New file: `docs/DEVICE_INTEGRATION.md`

- [ ] Capture device: a smartphone dermoscope attachment (DermLite DL1 class, or
      a locally sourced clip-on macro/polarised lens). Name the model, the price,
      and the field-of-view and illumination requirements the skin model needs.
- [ ] Radiology path: DICOM ingest from existing CT/CR hardware — see P2.2 for
      the implementation.
- [ ] A named partner target for each, and what you would ask them for.
- [ ] A bill of materials and an indicative cost per deployed site.
- [ ] An architecture diagram with the three §2 components labelled explicitly.

**Done when:** a reviewer can point at the device layer and see a costed,
architected plan with a named target, not a gap.

---

### P1.3 — Persistent inference server `biggest engineering win`

Every scan currently spawns a Python process that imports TensorFlow, loads a
ResNet50V2 from disk, and exits. Measured at 8.4 s, 11.0 s and 13.6 s — almost
entirely startup cost. There is no queue and no concurrency cap, and the rate
limiter allows 600 requests per five minutes per authenticated user against
`/api/scans`, so one ordinary account can demand hundreds of concurrent
TensorFlow processes.

**New service:** `inference/server.py` (FastAPI)

- [ ] Load both `.h5` models, both PCA OOD references, and both calibration
      configs once at startup.
- [ ] `POST /infer/skin` and `POST /infer/lung` — accept image bytes, return
      exactly the JSON shape the current CLI scripts emit, so nothing downstream
      changes.
- [ ] `GET /healthz` — report which models loaded and their artifact hashes.
- [ ] Factor the preprocessing, OOD and calibration logic into a shared module
      that both the server and the existing CLI scripts import.
      `scripts/evaluate-model.py` and friends must keep working.

**Node side:**

- [ ] `server/skin-cancer-service.ts` and `performLungCancerAnalysis` — call
      `INFERENCE_URL` over HTTP with an explicit timeout instead of spawning.
- [ ] Bound in-flight requests with a semaphore; return 429 with a retry hint
      when saturated, never an OOM.
- [ ] Keep the subprocess path as a fallback when `INFERENCE_URL` is unset, so
      local development still works — but log loudly that it is in use.
- [ ] Add a dedicated `scanLimiter` in `server/security-enhanced.ts`: 20 requests
      per 5 minutes for an authenticated user, mounted on `/api/scans` ahead of
      `medicalLimiter`.

**Deploy:**

- [ ] Add the service to `render.yaml`, the `Dockerfile` and `Procfile`.
- [ ] `INFERENCE_URL` documented in `.env.example` and the README.

**Verify:**

```bash
# warm latency
time curl -s -F image=@dataset/dataset/data/test/malignant/1.jpg localhost:8000/infer/skin
# concurrency
seq 20 | xargs -P20 -I{} curl -s -o /dev/null -F image=@... localhost:8000/infer/skin
```

**Done when:** warm inference is under one second, twenty concurrent requests all
complete, and `npm test` still passes 139/139.

---

### P1.4 — Separate the environments

`.env` sets `NODE_ENV=development` against a live Supabase pooler in
`eu-west-1`, and `npm test` creates and deletes rows in it. There is one
database serving development, testing and any demonstration.

- [ ] Create a second Supabase project (or a local Postgres via Docker) for
      development and local testing.
- [ ] `.env` → development database. `.env.production` → production. Never the
      same URL in both.
- [ ] `tests/helpers/server.ts` — require `TEST_DATABASE_URL`, and refuse to run
      if it matches the value in `.env.production`.
- [ ] Document the data residency decision. Supabase has no South African
      region, so patient data sits in Ireland. That is lawful under POPIA §72
      with the right basis, but it must be a recorded decision — write it into
      the DPIA (P1.5), not left as an accident of the default region.

---

### P1.5 — Write the Data Protection Impact Assessment

Highest credibility per hour on the whole compliance list.

New file: `docs/DPIA.md`

- [ ] Processing operations, one row each, with the lawful basis per operation.
- [ ] Data categories held, and which are encrypted at rest (cite
      `server/crypto/encrypted-fields.ts`, which already documents the reasoning
      including what is deliberately left in plaintext).
- [ ] Recipients, including the OpenAI cross-border transfer. Cite
      `server/privacy/redaction.ts` and `server/privacy/external-processing.ts`,
      and attach output from `npm run` `tsx scripts/show-transfer-log.ts` as
      evidence that the log exists and is populated.
- [ ] Retention periods per category (this forces P2.6 to be specified).
- [ ] Risks, mitigations, residual risk, and a sign-off line.

---

### P1.6 — Make object storage mandatory in production

- [ ] `scripts/startup-check.ts` — when `NODE_ENV=production` and no scan object
      store is configured, fail to start. Silently writing patient images to
      ephemeral container disk is worse than refusing to boot.
- [ ] Keep the local-disk fallback in development only.

---

## Phase 2 — Build the demonstrable differentiators (Days 11–21, 4–14 Sep)

**This phase is over-subscribed for one developer.** Work it in the order below
and use the cut list at the end. P2.1 through P2.4 are the ones that change how
the entry scores; everything after is upside.

### P2.1 — Offline-first PWA with a sync queue `Track 2 + Track 3 priority`

Guidelines §3.2 explicitly encourages offline and edge capability; §3.3 requires
low-bandwidth and offline-first support. The application currently scores nothing
on a stated challenge priority.

- [ ] Service worker (`vite-plugin-pwa`) precaching the app shell.
- [ ] Runtime-cache `GET /api/models/cards` so the UI knows which modalities
      exist while offline.
- [ ] IndexedDB queue (`idb`) holding pending scans: image blob, modality,
      patient id, captured-at timestamp.
- [ ] Background Sync registration, with a fallback flush on the `online` event
      for browsers without it.
- [ ] UI state: "Queued — will upload when you are back online", with the queue
      visible and cancellable.

**Safety rule, non-negotiable:** the offline path queues an *upload*. It never
shows a cached result, an estimated result, or any diagnostic content. The
system's whole differentiator is that it refuses rather than guesses, and an
offline mode that invents a result destroys that.

**Done when:** with DevTools set to offline you can capture and queue a scan;
returning online flushes the queue and the real result appears.

---

### P2.2 — DICOM ingestion

- [ ] `pydicom` in the inference service: accept `.dcm`, read `pixel_array`,
      apply window/level from the tags, convert to the 224×224 RGB the models
      expect.
- [ ] De-identify before storing: strip or replace the tags in the DICOM PS3.15
      Basic Application Level Confidentiality Profile. Store the de-identified
      object, never the original.
- [ ] `server/routes.ts:519` — add `application/dicom` to the multer allowlist,
      and verify by magic bytes (`DICM` at offset 128), not by the declared MIME
      type.
- [ ] Record the source modality and manufacturer tags on the scan row — useful
      later for drift analysis.

---

### P2.3 — Grad-CAM explainability overlays

Clinicians will not act on a bare probability, and an explainability view is the
standard first question in any clinical AI review.

- [ ] Inference service: `explain: true` returns a base64 PNG heatmap overlay
      alongside the prediction.
- [ ] Client: a toggle in the scan result view.
- [ ] Caveat text, shown with the overlay: it indicates where the model attended.
      It is not a lesion boundary, not a segmentation, and not a measurement.

---

### P2.4 — MFA for clinical roles

TOTP generation and verification already exist in `server/advanced-security.ts`
using `speakeasy`, and `qrcode` is a dependency. No route enrols or challenges,
so accounts that can read any patient record are protected by a password alone.

- [ ] Schema: `users.mfa_enabled`, `users.mfa_secret` (**encrypted** — add it to
      `ENCRYPTED_FIELDS`), `users.mfa_backup_codes` (hashed).
- [ ] `POST /api/auth/mfa/enroll` → `otpauth://` URI plus a QR data URL.
- [ ] `POST /api/auth/mfa/verify` → confirm a code, enable, issue backup codes once.
- [ ] `POST /api/auth/mfa/disable` → requires a current code.
- [ ] Login: when `mfa_enabled`, respond `{ mfaRequired: true, challengeToken }`
      and require a second call before a session is issued.
- [ ] Require MFA for `doctor`, `radiologist`, `admin`.
- [ ] Extend `tests/auth-matrix.test.ts` to cover the challenge path.

---

### P2.5 — Narrow clinician access, with break-glass

`requireMedicalAccess` admits any doctor, radiologist or admin to any patient's
record. Access is audited afterwards, which is necessary but not sufficient —
POPIA §19 expects minimality at the point of access.

- [ ] New table `care_relationships`: patient_id, clinician_id, established_at,
      ended_at, established_by.
- [ ] `requireCareRelationship` replaces `requireMedicalAccess` on patient-scoped
      routes.
- [ ] Break-glass: an explicit request carrying a free-text justification, which
      grants time-boxed access, writes a high-severity audit event, and notifies
      an administrator.
- [ ] Extend the auth matrix tests.

Scope this carefully — it touches many routes. If time is short, ship the
break-glass audit event and the justification capture first, and the relationship
table after submission.

---

### P2.6 — Retention and erasure

- [ ] `docs/RETENTION.md` — a schedule per data category, consistent with the
      DPIA.
- [ ] `POST /api/patient/me/erasure-request`, plus an administrative review flow.
- [ ] Erasure must respect the append-only tables. Replace personal fields with
      tombstones and keep the audit row: an audit trail that can be erased is not
      an audit trail.

---

### P2.7 — Replace the risk questionnaire with a validated instrument

The current questionnaire is an additive tally with hand-chosen weights, bucketed
into low/moderate/high, driving appointment urgency. It is labelled honestly in
the code, but a patient still sees a cancer risk level from a formula nobody
measured.

- [ ] Implement PLCOm2012 (Tammemägi et al., NEJM 2013) for lung — published,
      citable, with known discrimination and calibration.
- [ ] Offer it only to people inside its validated eligibility window (age 55–80
      with a smoking history). Outside that window, do not show a risk figure.
- [ ] Report the 6-year risk with the citation attached.
- [ ] Either remove the generic multi-cancer tally, or keep it explicitly as
      "lifestyle factors to discuss with a clinician" with no risk level and no
      urgency attached to it.

---

### P2.8 — Cheap technical wins

- [ ] Magic-byte upload validation (`file-type`) rather than trusting the
      client-declared MIME type.
- [ ] Split the admin dashboard chunk — 550 kB, twice the next largest.
- [ ] Extend CI beyond the auth matrix: `tsc --noEmit`, `npm run build`,
      `npm audit`, and a model-evaluation regression that fails if balanced
      accuracy drops below the recorded figure.
- [ ] `GET /metrics` (`prom-client`): inference latency percentiles, queue depth,
      model refusal rate, OOD flag rate, 503 rate by modality.

---

### P2.9 — Accessibility audit

- [ ] Run `axe` over each role's dashboard.
- [ ] Verify AA contrast throughout, both themes.
- [ ] Walk one complete patient journey with a screen reader.

---

### P2.10 — isiZulu and Afrikaans `needs a human reviewer`

The gate in `client/src/lib/language-availability.ts` requires every
safety-critical key present *and* a named human who reads the language to sign
off. That second condition cannot be automated and is the real cost here.

- [ ] Translate the full key set, not just navigation chrome.
- [ ] Get each language signed off by a speaker who also understands the clinical
      meaning; record `reviewedBy` and `reviewedOn` in the manifest.
- [ ] Two languages done properly beats eleven done by machine — and the gate
      already exists to enforce exactly that.

**Cut this** if no reviewer is available. Shipping an unreviewed translation
would contradict the safety property the gate was built to provide.

---

### Cut list for Phase 2

If the phase runs long, drop in this order — last dropped first:

1. P2.10 isiZulu/Afrikaans (drop first if no reviewer)
2. P2.9 accessibility audit (defer the fixes, keep the audit)
3. P2.6 retention and erasure (specify in the DPIA, implement after)
4. P2.5 care relationships (keep break-glass audit, defer the table)
5. P2.7 PLCOm2012

Never cut P2.1 (offline) or P2.4 (MFA). Offline is a named challenge priority
and the strongest demo moment available; MFA is a day's work over code that is
already written.

---

## Phase 3 — Assemble the evidence pack (Days 22–30, 15–23 Sep)

Guidelines §5 and §11.5 both ask for evidence appropriate to the technology's
maturity. Yours is unusually good — it just has to be packaged.

- [ ] **Model cards as a formatted PDF**, with the reproduction commands intact.
      This is the single strongest artifact in the repository. Include the
      threshold sweep table, the calibration figures, and the skin-tone analysis
      *including its negative finding*.
- [ ] **Demonstration video.** Script it deliberately:
      1. a normal scan and result;
      2. the **refusal path** — a modality with no model returning 503 and
         queueing for human review;
      3. the **OOD rejection** — a chest image fed to the skin classifier being
         refused rather than classified;
      4. the **offline queue** — capture with the network off, sync on reconnect.
      Items 2 and 3 are the differentiator. Do not cut them for a tidier demo.
- [ ] **Architecture diagrams** with device, AI and secure-workflow layers
      labelled against §2's three components.
- [ ] **Test and CI evidence**: 139/139, the authorisation matrix, the coverage
      report, the CI workflow file.
- [ ] **Failure-mode and escalation document**: what happens to a flagged scan at
      02:00, who owns the queue, what the turnaround target is, what happens on a
      model outage or a network partition mid-scan.
- [ ] **Incident response plan** with the POPIA §22 notification path and a named
      responsible person.
- [ ] **Load test** the inference path — before the demonstration, not during it.
- [ ] **Application text**, written against the guidelines rather than freehand:
      - §4.2's six required elements, each answered explicitly.
      - §4.3 innovation — lead with refusal-by-design, not "AI cancer detection".
      - §4.4 market and impact. Name real integration targets: the National
        Health Laboratory Service, Discovery Health, district facilities on the
        Ideal Clinic programme.
      - §6 operational readiness — Category A is judged on technical feasibility,
        validation progress and *future development plans*. Phases 5 and 6 below
        are that answer.
- [ ] **Rehearse** the full demonstration on the deployed instance, under load.

---

## Phase 4 — Submit (Days 31–32, 24–25 Sep)

Work Guidelines §10 line by line:

- [ ] Product aligns with the challenge problem statement.
- [ ] Correct TRL selected — **TRL 4**. Do not inflate it.
- [ ] **One** category selected — A.
- [ ] **One** primary track selected — Track 2. Track 3 referenced as ecosystem
      contribution only, never as a second entry.
- [ ] All form sections complete.
- [ ] All supporting documentation uploaded.
- [ ] Integration across device, AI and workflow demonstrated (P1.2 carries the
      device leg).
- [ ] Reviewed for accuracy, completeness and clarity.

**Submit on the 24th.** Not at 23:00 on the 25th.

---

## Phase 5 — The TRL 5 path (Q4 2026, post-submission)

This phase is *described* in the application under §6, not built before it.

**Clinical validation — what actually moves TRL 4 → 5**

- [ ] Retrospective validation on South African data: a few hundred
      de-identified scans from one facility with confirmed outcomes, run through
      the surveillance endpoint that already exists
      (`GET /api/models/performance`). Highest-value clinical work available, and
      the machinery is built.
- [ ] Reader study: 3–5 clinicians read the same set with and without the tool.
      Measure sensitivity, specificity and reading time. This is what §7's
      "clinical utility" criterion means.
- [ ] Retrain lung on a documented CT dataset (LIDC-IDRI, NLST) with a
      **patient-level** split. The current set is MRI-labelled PNGs of unrecorded
      provenance, split by image.
- [ ] Fine-tune the skin model's upper blocks — skipped only because the training
      machine was CPU-only with ~1 GB free.
- [ ] Acquire Fitzpatrick V–VI images with recorded labels, via a dermatology
      department partnership. This is a data problem, not a modelling one, and
      the model card already says so.
- [ ] Draft a prospective protocol and submit it for ethics review.

**Regulatory**

- [ ] SAHPRA pre-submission engagement; IMDRF SaMD risk classification.
- [ ] ISO 14971 risk management file; IEC 62304 lifecycle records.
- [ ] Clinical safety case — hazard analysis, mitigations, residual risk.
      DCB0129/0160 is a usable template.
- [ ] Register an Information Officer with the Information Regulator.

**Engineering**

- [ ] FHIR R4: `DiagnosticReport`, `Observation`, `ImagingStudy` out;
      `ServiceRequest` in. Closes the order-to-result loop.
- [ ] Redis adapter for WebSocket state — currently process-local `Map`s, so a
      second replica has its own view of presence.
- [ ] BullMQ for inference, notification delivery and report generation.
- [ ] OpenTelemetry traces; Sentry with PHI scrubbing configured first;
      structured JSON logging with correlation ids (preserving the current
      logger's property of never logging response bodies).
- [ ] Model registry (MLflow or DVC) with checksums.
- [ ] Independent penetration test by a recognised SA firm.
- [ ] Edge inference: TFLite or ONNX with INT8 quantisation, in-browser.
- [ ] Referral tracking with SLA: flagged → referred → seen → outcome recorded.
- [ ] Model drift monitoring — the OOD detector already computes the distance;
      this needs aggregation and a threshold.
- [ ] SMS/USSD/WhatsApp result-ready notification for feature-phone reach. The
      delivery layer already correctly refuses to put clinical content in an SMS;
      keep that property.
- [ ] Radiologist worklist: prioritisation by confidence and wait time,
      side-by-side prior comparison, structured reporting templates,
      turnaround-time metrics.
- [ ] Image viewer: window/level, measurement, annotation.

---

## Phase 6 — Toward deployment (2027)

- [ ] Prospective clinical investigation under the approved protocol.
- [ ] SAHPRA submission.
- [ ] ISO 13485 quality management system.
- [ ] Multi-site pilot with district facilities.

---

## Running verification

After every phase:

```bash
npx tsc --noEmit          # must be clean
npm run build             # must be clean
npm test                  # must be 139/139 (more, once P2.4/P2.5 land)
```

And the claim sweep from P0.2 — because the failure mode this whole entry guards
against is a claim drifting back in.
