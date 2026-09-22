# Failure Modes, Escalation and Incident Response

What happens when each part of this system fails, who is accountable, and how
long they have.

Written because "what happens to a flagged scan at 02:00" is the question a
clinical governance review asks first, and because a system whose failure
behaviour is undocumented has failure behaviour anyway — just nobody knows what
it is.

---

## Part 1 — Clinical failure modes

Severity is the risk to the **patient**, not to the service.

### F-01 · A model produces no result

| | |
|---|---|
| **Cause** | Model artifact missing, inference service down or saturated, modality has no classifier |
| **Behaviour** | HTTP 503, **no diagnostic content whatsoever**, scan recorded with status `pending_manual_review` |
| **Severity** | Low — by design |
| **Escalation** | Enters the radiologist queue as an unread scan, indistinguishable in priority from any other unread scan |

**This is the designed behaviour, not a degradation.** An earlier version of this
system filled the gap with `Math.random()`, including a lung path that defaulted
to `no_cancer` at 0.5 confidence whenever the model failed to load — which it
always did, because the path pointed at a directory that existed on no deployed
machine. Nothing in the response distinguished that fabricated negative from a
real one.

> **A 503 is not a negative result.** It means no model produced an opinion.

### F-02 · An image is refused as unassessable

| | |
|---|---|
| **Cause** | Out-of-distribution, blank, blurred, over-exposed, or a clinical DICOM sent to the lung model |
| **Behaviour** | HTTP 422 with a reason the person who uploaded it can read. No scan record created — nothing was analysed |
| **Severity** | Low |
| **Escalation** | The uploader recaptures. If a whole clinic's images are being refused, that is F-07 |

### F-03 · A flagged scan is not reviewed

| | |
|---|---|
| **Cause** | Nobody opens the queue |
| **Severity** | **High.** This is the failure that harms a patient |

The system detects a flagged scan; it does not detect an unread queue. **This is
the largest gap in the current design** and needs a named owner before any
clinical use.

Required before deployment, not yet built:

- A turnaround target agreed with the facility — e.g. flagged scans read within
  24 hours, routine within 72.
- An alert when a flagged scan exceeds it, to a person rather than a dashboard.
- A named accountable clinician per facility, and a deputy.
- A weekly report of the oldest unread scan.

**Overnight, today:** there is no on-call path. A scan flagged at 02:00 waits
for the queue to be opened. Any pilot must state its hours of cover and its
out-of-hours arrangement explicitly, and neither is a software feature.

### F-04 · A false negative reaches a patient

| | |
|---|---|
| **Cause** | The model misses; the reviewing clinician agrees |
| **Severity** | **High** |
| **Rate** | Roughly 1 in 5 lung cancers; 3.3% of malignant lesions receive an outright benign skin result |

**Mitigations in place:** every result is reviewed by a clinician, so the model
is never the last word. The lung operating point is deliberately set below argmax
to trade false alarms for missed cancers. Skin uses banded thresholds so 96.7% of
malignant lesions are either flagged or escalated to `uncertain`, both of which
route to a clinician.

**Mitigation not in place:** the patient-facing wording for a non-flagged result
must never read as an all-clear. `result.model_cleared` is a safety-critical
translation key for exactly this reason.

### F-05 · A false positive causes unnecessary investigation

| | |
|---|---|
| **Severity** | Medium — real harm: anxiety, biopsy, cost, radiation |
| **Rate** | ~1 in 4 healthy lung scans flagged; 17% of skin scans land in `uncertain` |

Deliberate. The threshold sweep is published so the trade is inspectable, and
`LUNG_CANCER_THRESHOLD` is configurable per deployment — a facility with scarce
follow-up capacity may reasonably choose differently, and should record why.

### F-06 · Model behaviour drifts

| | |
|---|---|
| **Cause** | New scanner, new capture device, new population |
| **Severity** | **High**, and slow — it does not announce itself |
| **Detection** | `healthai_ood_rejections_total` and `healthai_scan_submissions_total{outcome}` |

The measured OOD flag rate on in-distribution images is 0.8%. A production rate
materially above that means the input distribution has moved and the published
figures may no longer describe what is happening.

**Not yet built:** an alert threshold. The counters exist; nothing watches them.

### F-07 · A whole site's images are refused

| | |
|---|---|
| **Cause** | A capture device whose optics differ from the training distribution |
| **Severity** | Medium operationally, **high** for adoption |

The tool refusing most of what a clinic photographs is a deployment failure even
when every individual refusal is correct. Any capture device must be validated
by re-measuring sensitivity and specificity on images *that device* produced,
before clinical use — see `docs/DEVICE_INTEGRATION.md`.

### F-08 · A model answers an input it was never measured on, and the screen lets it

| | |
|---|---|
| **Cause** | The out-of-distribution reference was validated against a convenience sample of the domain it must refuse, not against real acquisitions of it |
| **Severity** | **High** — a verdict with no measured basis is indistinguishable from a real one |
| **Occurred** | **Yes.** 2026-09-20, lung model. See `MODEL_CARDS.md`. |

The lung classifier, trained on web-sourced chest images, was believed to refuse
real CT because pydicom's bundled 128×128 test object scored 22.9 against a
16.51 threshold. Measured against 87 real LIDC-IDRI slices through the serving
code, the screen passed 84 and the model issued verdicts. Real CT sat inside the
model's training distribution in feature space; the screen had nothing to
separate.

**Detection:** `scripts/build-ood-reference.py` validates every reference in
both directions against pre-set bars and exits non-zero on a miss. The failure
was found the first time the script was pointed at the right domain.

**Mitigation, applied:** the model was withdrawn from serving the same day
(`MODEL_REGISTRY.lung.enabled = false`; governance state `withdrawn`); the
real-CT domain is now a permanent `refuse` domain for that model so the failure
cannot be re-measured away by omission; `tests/withdrawn-modality.test.ts`
checks the registry's reason against the measurement on disk.

**Mitigation, standing:** no model serves a modality until its OOD reference
has been validated against real acquisitions of that modality drawn from the
dataset the model was trained on — not a library's test fixture. The nodule
characteriser meets this (whole CT slices refused at 90.8%); the withdrawn
model never did.

**Residual risk:** a screen built on reconstruction error cannot refuse an
input that resembles the training data. It is one layer. The layers that
remain are the deterministic gates (DICOM preamble, quality checks), the
clinician who reviews every result, and the outcome loop that would eventually
show a model performing worse than its card — slowly, and after the fact.

---

## Part 2 — Technical failure modes

### T-01 · Database unreachable

Server starts; in-memory fallback holds **no accounts**, so every login fails.
Deliberate: a health system that cannot reach its user table should refuse
logins, not accept a built-in one. `/api/ready` returns 503 so a load balancer
removes the instance; `/api/health` stays 200 so a transient blip does not get
the container killed.

### T-02 · Inference service down or saturated

Scans answer 503 and queue for manual review (F-01). Saturation returns
`Retry-After` rather than accumulating work.

Measured: 30 concurrent requests against one instance served 27 and shed 3 with
503, queue draining to zero. Sustained throughput ~2 scans/second — inference is
serialised, so that is the designed ceiling. Shedding beyond it is the intended
behaviour, not a failure, and nothing submitted is lost. `/api/ready` reports reachability
and the resident artifact hashes, so an operator can confirm the service holds
the artifact that `medical_scans.model_version` names.

### T-03 · Object storage unavailable

Production **refuses to start** without it. The fallback writes patient imaging
to ephemeral container disk, which is lost on the next deploy — leaving findings
with no image behind them, which makes the human review step impossible for
exactly the scans where it matters most.

### T-04 · Connection lost mid-capture

The scan is held in IndexedDB and uploaded on reconnect. **Nothing is analysed
offline and no result is shown.** A queued scan has two states — waiting and
uploaded — and no third state in which it means anything clinically.

### T-05 · Encryption key lost

Encrypted clinical free text becomes unreadable. Keys are a rotatable keyring
with ids embedded in the ciphertext, so rotation is possible without data loss —
but a lost key is unrecoverable by design.

**Required:** key custody procedure, offline backup, documented custodians.
**Not yet in place.**

### T-06 · Second factor lost

Eight single-use recovery codes, shown once. Exhausted or lost, an administrator
must intervene — and that path is a documented bypass of the control. Any
support process for it needs identity verification defined before MFA is
enforced.

---

## Part 3 — Incident response (POPIA §22)

### Definition

A security compromise is any unauthorised access to, or acquisition of, personal
information. Under POPIA §22 the Information Regulator **and each affected data
subject** must be notified as soon as reasonably possible after discovery.

### Timeline

| When | Action |
|---|---|
| **0–1 h** | Contain. Revoke sessions, rotate credentials, isolate the affected component. Do not delete anything — the audit trail is evidence. |
| **1–4 h** | Assess: what data, whose, how many, still ongoing? `audit_events` and the genomic access log are the primary sources. |
| **4–24 h** | Decide notifiability. Record the decision and its reasoning either way. |
| **24–72 h** | Notify the Information Regulator. Notify affected data subjects in writing. |
| **1 week** | Written post-incident review, with remediation items and owners. |

### Roles

| Role | Responsibility | Status |
|---|---|---|
| Information Officer | Statutory accountability; notifies the Regulator | **UNASSIGNED — DPIA R-01** |
| Technical lead | Containment and forensics | Named |
| Clinical lead | Assesses patient impact; decides on care disruption | **UNASSIGNED** |

> Two of three roles are unassigned. That is the single largest gap in this
> document, and it is not a software gap.

### Evidence available

- `audit_events` — append-only, non-identifying detail, 34 audited operations
- `genomic_access_log` — every genomic read
- Cross-border transfer log — `scripts/show-transfer-log.ts`
- `care_relationships` — every break-glass grant with its written justification
- Session table — active sessions, revocable in bulk

### Scenarios

**Clinician account compromised.** Revoke sessions; query `audit_events` for
everything that account read; check for break-glass grants; notify every patient
whose record was accessed. MFA is the control that makes this less likely and it
is currently **not enforced**.

**Database exfiltrated.** Clinical free text, contact details and MFA secrets
are AES-GCM encrypted; genomic genotype data is **not** (DPIA R-11) and cannot be
reissued if leaked — it implicates blood relatives who never consented. Rotate
the keyring, notify, and treat genomic exposure as the most serious element.

**Scan images exposed.** Objects are private in both backends and reachable only
through an authorised, audited endpoint that issues 10-minute signed URLs.
Exposure means either a bucket misconfiguration or a credential compromise;
check bucket policy first.

---

## Summary of what is not in place

Consolidated so it cannot be missed:

1. **No named accountable clinician** for the review queue (F-03)
2. **No turnaround target and no overdue alerting** (F-03)
3. **No out-of-hours cover** (F-03)
4. **No drift alert threshold** — counters exist, nothing watches them (F-06)
5. **No Information Officer** (POPIA §22, DPIA R-01)
6. **No key custody procedure** (T-05)
7. **No identity verification for MFA recovery** (T-06)
8. **Lung is a marked-nodule characteriser under validation terms** — the
   legacy whole-image model is withdrawn (F-08); the replacement rests on 29
   malignant test nodules and does not find nodules. A CT series can now be
   ingested and quality-gated (P1b, 2026-09-22), but nothing reads a series:
   ingesting a study is filing it, not looking at it.

Items 1–3 must be closed before any clinical use. They are operational
commitments a facility makes, not features a vendor ships.
