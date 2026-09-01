# Runbook

What to do when `ops/alerts.yml` fires. One section per alert, anchored to the
`runbook:` annotation on each rule.

Two rules govern everything below.

**A refusal is safe; a wrong answer is not.** Every failure mode in this system
was designed to end in "no result, queued for a human". If you are choosing
between restoring automated analysis quickly and leaving it off while you
understand what happened, leave it off. Radiologists absorbing extra queue is a
cost. A model quietly issuing wrong negatives is a harm.

**Never re-enable a model you cannot explain.** `MODEL_REGISTRY.enabled` is the
kill switch. Setting it back to `true` is a clinical decision, not an
operational one, and needs the same person who would sign off a deployment.

---

## Kill switch

To stop a modality serving automated results immediately:

```ts
// server/model-availability.ts
lung: { enabled: false, disabledReason: 'Investigating <incident>', ... }
```

Scans then take the `respondModelUnavailable` path: stored, marked
`pending_manual_review`, 503 to the client with an explicit "this is NOT a
negative finding" message. No patient loses a scan, and `AutomatedAnalysisUnavailable`
will fire — which is correct and expected while the switch is off.

---

## AutomatedAnalysisUnavailable

**Means:** `assertModelEnabled` is throwing. No model served this modality for
10 minutes.

**Patient impact:** none directly — scans are queued for manual review. The
impact is on radiologists, who are absorbing work without being told.

1. Is this deliberate? Check whether someone set `enabled: false`. If the
   `disabledReason` names an incident, this alert is expected; silence it for
   the duration rather than fixing it.
2. If not deliberate, check the model artifact is present and readable:
   `dataset/lung_nodule_model/`, `dataset/data/resnet50v2_skin_cancer_model.h5`.
3. Check the inference service is up: `curl $INFERENCE_URL/health`.
4. Tell the radiology lead the queue is growing and roughly by how much:
   `SELECT count(*) FROM medical_scans WHERE status = 'pending_manual_review'`.

---

## InputDistributionShift

**Means:** over 20% of inputs for a modality are being refused as unlike the
training distribution, sustained for 30 minutes. Measured baseline on held-out
same-modality images is under 4% (skin lesions 0.8%, benign lung nodule patches
3.3%, off-nodule parenchyma 0.8%).

**Patient impact:** the refused scans are safe — they were refused, not
misclassified. The risk is the ones that got through: if the input distribution
has moved, the published sensitivity and specificity no longer describe this
deployment, and results being issued right now may not mean what the model card
says they mean.

1. Identify what changed. Almost always one of: a new scanner or capture
   device, a new clinic onboarded, a client update that changed image
   preprocessing, or whole CT slices being submitted where nodule patches are
   expected (the OOD screen flags those at 90.8%, by design).
2. Pull recent rejected submissions and look at them. If they are legitimate
   images of the right kind, the reference distribution is stale and the model
   needs re-evaluation against the new source before it keeps serving it.
3. If they are the wrong kind of image, this is the screen working. Fix the
   submitting client.
4. **Do not raise the OOD threshold to clear the alert.** That converts refusals
   into confident wrong answers, which is the failure the screen exists to
   prevent.

---

## PredictionRateCollapsed

**Severity: critical. This is the dangerous one.**

**Means:** across 50 or more scans in 6 hours, under 2% were flagged positive.
Expected is tens of percent at the deployed lung threshold of 0.30, and the skin
bands escalate 96.7% of malignant lesions.

**Patient impact: active and ongoing.** A model that flags nothing issues
negatives on scans it has not meaningfully assessed, and a negative is what
sends a patient home. Assume harm is accruing until proven otherwise.

1. **Disable the modality now** (see Kill switch). Do this before diagnosing.
2. Identify the affected window: earliest and latest `SCAN_ANALYSED` audit
   events showing the collapsed behaviour.
3. Re-queue every scan analysed in that window for human review:
   ```sql
   UPDATE medical_scans
      SET status = 'pending_manual_review',
          notes  = notes || ' [Re-queued: model integrity incident <ref>]'
    WHERE created_at BETWEEN $1 AND $2
      AND scan_type = $3
      AND predicted_positive IS NOT NULL;
   ```
4. Tell the radiology lead the count and the window. Patients already told
   "no abnormal findings" during it may need recall — that is a clinical call,
   not yours.
5. Only then diagnose. Usual causes, in order of observed frequency: wrong
   artifact deployed; preprocessing regression (a model with normalisation fused
   into its graph fed `div255` inputs returns near-constant output); threshold
   config read as 1.0; a corrupted weights file that still loads.
6. Verify any fix against the held-out set with `scripts/evaluate-model.py`
   before re-enabling. Reproducing the model card's figures is the bar.

---

## PredictionRateSaturated

**Means:** over 80% of scans flagged positive across 50+ in 6 hours. Measured
specificity is 0.757 (lung) and 0.814 (skin), so even an all-negative population
should sit well under 30%.

**Patient impact:** the triage signal is carrying no information and the
radiology queue is filling indiscriminately. Less acutely dangerous than a
collapse — everything still reaches a human — but it destroys the value of
triage and buries genuine positives in noise.

Same causes and same diagnostic steps as
[PredictionRateCollapsed](#predictionratecollapsed), opposite sign. Re-queuing
is not required, because nothing was wrongly cleared; every flagged scan is
going to a radiologist anyway.

---

## InferenceFallbackInUse

**Means:** p95 inference latency above 5s. The resident service answers in
roughly 0.5s; the per-request Python subprocess fallback takes 8–14s.

**Patient impact:** slow, not wrong. Results remain valid.

1. Confirm `INFERENCE_URL` is set in the environment the server actually reads.
2. `curl $INFERENCE_URL/health` from the application host — DNS and network
   policy are the usual culprits, not the service.
3. Start it if it is down: `uvicorn inference.server:app --host 127.0.0.1 --port 8001`.
4. The fallback warns once per process at startup and then stays silent, which
   is how it survives to production unnoticed. Grep application logs for
   `INFERENCE_URL is not set` to confirm how long it has been in use.

---

## InferenceSaturated

**Means:** the inference queue is full and requests are being shed. Patients are
seeing 503s.

1. Check load against `INFERENCE_MAX_IN_FLIGHT` (default 24 on the Node side;
   the service has its own bounded queue and answers 503 past it).
2. Scale the inference service horizontally if this is genuine demand.
3. Raise the cap only after confirming the service absorbs it — raising a limit
   past what the backend can serve converts backpressure into errors, which is
   the same mistake `DATABASE_POOL_MAX` documents against the Supabase pooler.

---

## ScanPipelineErrors

**Means:** over 5% of submissions ending in an unhandled error.

**Patient impact: potentially severe.** Unlike a refusal, an error produces no
queued manual-review row. The scan may be lost to the patient entirely — they
uploaded something and nothing exists.

1. Find the failures by `X-Request-Id` in the application logs.
2. Determine whether rows were created. If not, identify the affected patients
   and ask them to resubmit; they have no way of knowing.
3. Common causes: object storage unwritable (`persistScanImage`), database
   connection exhaustion, malformed DICOM reaching the decoder.

---

## SevereHarmReported

**Means:** a person filed an adverse event graded `severe_harm` — serious or
lasting injury. This is not a system signal. Somebody is telling you they were
hurt.

**Do this in order.**

1. Read the report: `GET /api/adverse-events?severity=severe_harm`. The
   narrative is decrypted for clinical staff.
2. Decide whether to disable the modality involved (see
   [Kill switch](#kill-switch)). You do not need to establish causation first —
   the cost of a needless day of manual review is much lower than the cost of a
   second event while you investigate.
3. Tell the clinical lead and the responsible person for the device. This is
   the class of event a regulator expects to be recorded and, once these
   classifiers are cleared, reported.
4. Preserve the evidence. The scan row is mutable and erasable; the report
   already holds its own copy of the model version and the prediction, but
   export the linked scan and its audit trail before anything else touches it.
5. Do not close the report to tidy the queue. It closes when the investigation
   concludes, and the reported severity cannot be edited down.

---

## AdverseEventRateElevated

**Means:** more than five `harm` or `severe_harm` reports in 24 hours.

A cluster, not an incident. Individually these may each look explicable.

1. Look for the common factor before treating them separately: same modality,
   same model version, same clinic, same time of day, same reporting clinician.
   `model_version_at_event` is denormalised onto each report precisely so this
   is answerable after the scan rows have changed.
2. Cross-check against `PredictionRateCollapsed` and `InputDistributionShift`.
   A cluster of harm reports alongside either is a strong signal and should be
   treated as a model integrity incident.
3. **A rise is not necessarily worse care.** Under-reporting is the normal
   state of every incident system, so a jump often follows someone publicising
   the channel, a new cohort of staff, or a single motivated reporter. Check
   whether the reporter population changed before concluding the device did.
4. A *fall* is not evidence of improvement, for the same reason. Do not report
   it as one.

---

## BreakGlassUsageElevated

**Means:** more than 3 emergency overrides opened in an hour. Break-glass
bypasses the care-relationship check.

1. Read the events: `SELECT * FROM audit_events WHERE action = 'BREAK_GLASS_OPENED' ORDER BY occurred_at DESC`.
   Each carries the clinician, the patient id and the clinician's stated reason.
2. A genuine cluster (mass-casualty, ward emergency) needs no action beyond
   noting it.
3. A pattern from one clinician, or reasons that read as routine, usually means
   the normal assignment path is broken and people are routing around it. Fix
   the assignment path — an override that is easier than the correct route will
   keep being used.
4. Escalate to the privacy officer if access looks unjustified. This is the
   audit trail those overrides exist to produce.

---

## CareRelationshipDenialsEnforced

**Means:** more than 10 clinicians refused access to patient records in an hour,
in enforced mode.

1. This usually means the derivation is missing a legitimate basis, not that
   access is being attacked. Appointments and scan assignments are derived; an
   explicit `assigned` grant covers care that has produced neither yet.
2. Identify the failing pairs before tightening anything.
3. Left alone, this pushes clinicians towards break-glass or shared logins,
   which is strictly worse for patient privacy than the access it prevented.
4. If the derivation is genuinely wrong, add the missing basis. Reverting to
   shadow mode is acceptable while you do — shadow counts what enforcement would
   have refused without refusing it.

---

## ApplicationDown

**Means:** Prometheus cannot scrape the instance for 2 minutes.

1. Check the process is running and the host is reachable.
2. `GET /api/health` (cheap) and `GET /api/ready` (reports database
   connectivity) distinguish "process up, database gone" from "process gone".
3. Database connection exhaustion is the most common cause on Supabase — the
   pooler caps the project at 15 clients in session mode and `DATABASE_POOL_MAX`
   defaults to 10 to leave headroom. Migration scripts and psql sessions consume
   the same budget.

---

## NoScanSubmissions

**Means:** no scans at all in an hour, during weekday clinic hours (06:00–15:00
UTC, i.e. 08:00–17:00 SAST).

Silence is indistinguishable from a broken upload path, because a client that
cannot submit produces no failed requests to alert on.

1. Submit a test scan end to end before concluding it is a quiet day.
2. Check the client build deployed — a front-end error breaks upload while the
   API stays perfectly healthy.
3. Confirm the alert's own time window still matches the deployment's clinic
   hours and timezone. If the service now runs outside 08:00–17:00 SAST, this
   rule needs adjusting rather than silencing.
