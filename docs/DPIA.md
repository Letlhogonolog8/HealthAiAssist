# Data Protection Impact Assessment

**Subject:** HealthAI Assistant — cancer screening triage platform
**Legislation:** Protection of Personal Information Act 4 of 2013 (POPIA), South Africa
**Assessment date:** August 2026
**Status:** Draft. Not yet signed off by an Information Officer, because none has
been appointed — this is itself finding R-01 below.

---

## 0. How to read this document

This is an assessment, not a compliance claim. Several conditions are **not**
met, and they are stated as plainly as the ones that are. A DPIA that finds no
problems has not been performed.

Nothing here asserts certification, accreditation, or approval by any regulator.
The platform holds none.

Every claim about system behaviour cites the code that implements it, so each
one is checkable rather than asserted.

---

## 1. What is being assessed

A platform that accepts a medical image, runs a screening classifier over it,
and routes the result to a clinician for review. It also holds appointments,
clinician–patient messaging, an AI assistant, and an optional genomics module.

**Special personal information under POPIA §26** is processed throughout: health
information is the core of the system, and the genomics module additionally
holds biometric-adjacent data of a kind that implicates blood relatives who never
consented to anything.

### Data subjects

| Group | Data held |
|---|---|
| Patients | Identity, contact details, medical images, screening results, clinical notes, appointments, messages, optionally genotype data |
| Clinicians (doctor, radiologist) | Identity, contact details, specialisation, licence number, activity in the audit trail |
| Administrators | Identity, contact details, activity in the audit trail |
| **Third parties who never used the system** | Emergency contact name and number, held about someone who did not consent — see R-06 |

---

## 2. Processing operations and lawful basis

| # | Operation | Special info? | Basis relied on | Notes |
|---|---|---|---|---|
| P1 | Account creation and authentication | No | §11(1)(b) — necessary to perform a contract | |
| P2 | Storing and analysing a medical image | **Yes** | §27(1)(a) — consent; and §32(1)(a) — processing by a healthcare institution for the proper treatment of the data subject | Consent is obtained at registration; see R-04 on its granularity |
| P3 | Clinician review and sign-off of a result | **Yes** | §32(1)(a) | The mandatory human step; no path bypasses it |
| P4 | Recording a confirmed outcome against a scan | **Yes** | §32(1)(a) and §15(3)(e) — historical, statistical or research purposes | Feeds `GET /api/models/performance` |
| P5 | Clinician–patient messaging | **Yes** | §32(1)(a) | Message bodies encrypted at rest |
| P6 | Appointment scheduling | No | §11(1)(b) | Optional Google Calendar conflict check sends no patient identifiers |
| P7 | **AI assistant — transfer to OpenAI, United States** | **Yes** | §72(1)(a) — explicit consent to the specific transfer | Assessed in detail in §5 |
| P8 | Genomic ingest, polygenic scoring | **Yes** | §27(1)(a) — explicit, granular, revocable consent | Separate consent scopes from all of the above |
| P9 | Audit logging of sensitive access | No | §11(1)(c) — compliance with a legal obligation; §19 accountability | Non-identifying context only |
| P10 | Notification delivery by email/SMS | No | §11(1)(b) | **Carries no clinical content** — see §4.3 |

---

## 3. The eight conditions for lawful processing

| Condition | Status | Assessment |
|---|---|---|
| **§8–9 Accountability** | ✗ **Not met** | No Information Officer registered with the Information Regulator. **R-01** |
| **§10 Minimality** | ~ Partial | Collection is proportionate. *Access* is not: any clinician can read any patient. **R-02** |
| **§11 Consent, justification, objection** | ✓ Met | Consent is append-only, versioned, scoped and revocable. `processing_consents`, `genomic_consents` in `shared/schema.ts`. Revocation takes effect on the next use, not on a nightly job. |
| **§12 Collection directly from the data subject** | ✓ Met | All personal information originates from the data subject or their treating clinician. |
| **§13–14 Purpose specification and retention** | ✗ **Not met** | No retention schedule and no deletion mechanism. Records accumulate indefinitely. **R-03** |
| **§15 Further processing limitation** | ✓ Met | Outcome data is used to measure model performance — a compatible secondary purpose under §15(3)(e), and disclosed. |
| **§16 Information quality** | ~ Partial | Clinical data is clinician-entered and correctable. Patients cannot yet request correction themselves. **R-05** |
| **§17–18 Openness** | ~ Partial | The cross-border disclosure is published unauthenticated at `GET /api/chatbot/disclosure`. There is no general privacy notice. **R-05** |
| **§19 Security safeguards** | ~ Partial | Strong: see §4. Weak: no MFA, no penetration test, broad clinician access. **R-02**, **R-07** |
| **§20 Operator obligations** | ~ Partial | OpenAI is an operator under POPIA. No written operator agreement is in place. **R-08** |
| **§21 Notification of security compromise (§22)** | ✗ **Not met** | No incident response plan, no notification procedure, no defined timeline. **R-09** |
| **§23–25 Data subject participation** | ✗ **Not met** | No access, correction or deletion request flow. **R-05** |
| **§26–27 Special personal information** | ✓ Met | Health data processed under the §32 healthcare authorisation and explicit consent. |
| **§72 Trans-border flows** | ✓ Met | Assessed in §5. This is the strongest area of the implementation. |

---

## 4. Security safeguards in place

### 4.1 Encryption at rest

Clinical free text is encrypted with AES-GCM under a **rotatable keyring**: key
identifiers are embedded in the ciphertext envelope, every listed key can
decrypt, and only the active key encrypts (`server/crypto/keyring.ts`).

This matters more than it might appear. If ciphertext does not record which key
produced it, changing the key makes every existing row unreadable at the instant
of the change — so in practice the key never changes, and a compromised or aged
key stays in service indefinitely. The design decision was made before the first
row was written, because it cannot be retrofitted.

**Encrypted** (`server/crypto/encrypted-fields.ts`):

`chat_messages.message` · `medical_scans.notes` · `medical_scans.findings` ·
`medical_scans.recommendations` · `scan_outcomes.notes` · `users.address` ·
`users.phone` · `users.emergency_contact` ·
`genomic_risk_assessments.caveats` · `genomic_risk_assessments.contributions`

**Deliberately not encrypted**, each with recorded reasoning in the same file:

| Field | Why not |
|---|---|
| `users.email`, `users.username` | Equality lookups on the authentication path. Randomised encryption makes `WHERE email = ?` impossible; protecting these needs a blind index, which leaks equality by design and is a separate decision. |
| `medical_scans.result` | Currently doubles as a status flag matched with `ILIKE`. Encryptable only after those queries move to `predicted_positive`, `risk_level` and `status`. **R-10** |
| `genomic_variants.genotype` | Wrong tool at this scale — 500k–900k rows of two-character calls against a ~90-character envelope each. Needs volume encryption or a sealed per-profile blob. **R-11** |
| `audit_events.detail` | Constrained by design to non-identifying context. An audit log containing the data it audits has multiplied the exposure; the fix is keeping it out, not encrypting it in place. |
| `medical_scans.image_path` | A storage locator, not content. The image is private in both backends and served only through an authorised, audited endpoint. |

An undocumented omission is indistinguishable from an oversight, which is why
the exclusions are enumerated rather than left as an absence.

### 4.2 Access control and audit

- Session-based authentication; bcrypt at cost factor 12.
- Session secret fail-closed: production **refuses to start** without one of at
  least 64 characters (`server/index.ts`).
- Authorisation enforced by an automated matrix that runs in CI on every push
  (`tests/auth-matrix.test.ts`). It exists because several `/api/doctor/*`
  routes were once found serving patient names and clinical notes to anonymous
  callers.
- Append-only `audit_events`; genomic reads additionally logged to
  `genomic_access_log`.
- Scan images are private objects, readable only through
  `GET /api/scans/:id/image`, which authorises the caller, audits the read, and
  redirects to a signed URL valid for ten minutes.
- Denial responses carry no identifiers — a 403 that echoes the requested
  patient id is an enumeration oracle.

### 4.3 Notification channels carry no clinical content

Email and SMS are not confidential channels: they traverse carrier and
third-party mail infrastructure unencrypted, and land on a lock screen a partner
or colleague can read.

The delivery layer therefore states that something is waiting and where to sign
in to read it — never the finding, the risk level, the modality, or an urgency
cue. Urgency on a lock screen is itself clinical information
(`server/notification-delivery.ts`).

### 4.4 Refusal rather than fabrication

Not conventionally a data-protection control, but it is an information-quality
one under §16. When no validated model can analyse a scan, the system returns
no diagnostic content and queues the scan for a human. A fabricated negative
recorded against a patient is inaccurate personal information with clinical
consequences.

---

## 5. Cross-border transfer — POPIA §72

**This is the highest-risk processing operation in the platform, and the most
carefully handled.**

The AI assistant forwards message content to OpenAI in the United States. That
is a trans-border flow of personal information, potentially special personal
information, to a country without an adequacy finding.

### Controls

| Control | Implementation |
|---|---|
| Redaction before transmission | `server/privacy/redaction.ts` — SA ID numbers, email addresses, SA phone numbers, dates of birth, medical record and file numbers, passport numbers, and long numeric strings are replaced with labelled placeholders |
| Consent checked **per message**, not once at signup | `server/privacy/external-processing.ts` |
| Versioned disclosure | The consent record stores which version of the disclosure text the person actually saw |
| Public disclosure | `GET /api/chatbot/disclosure` — unauthenticated, because someone deciding whether to consent must be able to read it first |
| Revocable, with immediate effect | Consent is re-checked on every message, so withdrawal stops the transfer at once |
| Transfer log | Records who, when, and which *categories* of data — never the values. `scripts/show-transfer-log.ts` |
| Append-only consent history | `processing_consents` — rows are never updated, so grant and revocation history is reconstructable |

### Residual risk

Redaction is pattern-based. It cannot catch personal information a patient
volunteers in prose ("I'm the only person in Nkandla with this condition"). The
mitigation is the disclosure and the consent, not the regex — and the disclosure
should say so explicitly. **R-12**

### A second cross-border flow, less obvious

Patient data is stored in **Supabase, eu-west-1 (Ireland)**. This is also a
§72 transfer and was **not** a deliberate decision — it is the provider's
default region.

The EU has data protection broadly comparable to POPIA, so the §72(1)(b)
"adequate level of protection" route is arguable. But it must be an assessed and
recorded decision rather than an accident of a signup form. Supabase offers no
South African region; if data residency in South Africa becomes a requirement —
which a public-sector deployment may well impose — this needs a different
provider. **R-13**

---

## 6. Risk register

Severity reflects the risk to the **data subject**, not to the project.

| ID | Risk | Severity | Status | Mitigation |
|---|---|---|---|---|
| **R-01** | No Information Officer registered with the Information Regulator | High | Open | Appoint and register. Non-discretionary under §55. |
| **R-02** | Any clinician could read any patient record; no care-relationship check, no break-glass justification | **High** | **Mitigated, shadow mode** | `server/care-relationship.ts`. Relationships derived from appointments and scan assignments; explicit grants and time-boxed break-glass in `care_relationships`; every override audited and notified to administrators. Enforcement is behind `CARE_RELATIONSHIP_ENFORCE` and currently **off** — denials are recorded as `CARE_RELATIONSHIP_WOULD_BLOCK` so the derivation can be measured before it starts refusing clinicians. **Not closed until that flag is on.** |
| **R-03** | No retention schedule; no deletion mechanism | High | **Partially mitigated** | [RETENTION.md](RETENTION.md) and `server/erasure.ts`. Schedule published, erasure implemented and adjudicated per category. **No automatic expiry job**, so §14 is only partly met: records outlive their period until someone requests erasure. |
| **R-04** | Consent for image processing is not as granular as genomic consent | Medium | Open | Extend the `processing_consents` scope model to imaging |
| **R-05** | No data subject access, correction or erasure request flow; no general privacy notice | High | **Partially mitigated** | Erasure implemented end to end, with an assessment endpoint that states what would be kept and why *before* a request is made. §23 access (a machine-readable export) and a general privacy notice are still absent. |
| **R-06** | Emergency contact details held about a third party who never consented | Medium | Partially mitigated | Encrypted at rest. Needs a retention rule and a notice at capture. |
| **R-07** | No MFA on accounts that can read any patient record | **High** | **Mitigated, shadow mode** | `server/mfa.ts`. Enrolment, challenge, single-use recovery codes, secret encrypted at rest. Enforcement is behind `MFA_ENFORCE` and currently **off** so existing clinicians are not locked out mid-deploy. **Not closed until that flag is on.** |
| **R-08** | No written operator agreement with OpenAI under §20 | Medium | Open | Execute a data processing agreement, or remove the dependency |
| **R-09** | No incident response or §22 breach notification procedure | High | Open | Written plan with a named responsible person and a defined timeline |
| **R-10** | `medical_scans.result` holds clinical text and is not encrypted | Medium | Open | Move status queries to `status` / `risk_level` / `predicted_positive`, then encrypt |
| **R-11** | Genomic genotype data unencrypted at rest | **High** | Open | Volume encryption or a sealed per-profile blob. Genomic data cannot be reissued if leaked and implicates relatives. |
| **R-12** | Redaction cannot catch self-identifying prose sent to the AI assistant | Medium | Partially mitigated | Consent and disclosure. Disclosure text should state the limit explicitly. |
| **R-13** | Patient data resides in Ireland by provider default, not by decision | Medium | Open | Record the §72(1)(b) assessment, or relocate |
| **R-14** | No independent penetration test | Medium | Open | Commission one from a recognised South African firm |
| **R-15** | Development and production share one database | Medium | **Mitigated** | Test suite now refuses to run destructively against a remote database without explicit opt-in (`tests/helpers/server.ts`). Separate instances still to be provisioned. |
| **R-16** | Scan images could be written to ephemeral container storage and lost | Medium | **Mitigated** | Production now refuses to start without durable object storage (`server/index.ts`) |

---

## 7. Conclusion

The platform's **technical** safeguards are strong for its stage: rotatable
encryption designed before first write, append-only audit, per-message
cross-border consent with redaction, authorisation enforced in CI, and a design
posture of refusing rather than guessing.

Its **governance** safeguards are largely absent: no Information Officer, no
retention schedule, no data subject rights flow, no breach procedure, no
operator agreement.

That asymmetry is characteristic of a system built by engineers before it
acquired an accountable owner, and the remedy is mostly paperwork and appointment
rather than code. The two highest-severity items that *are* code — R-02
(clinician access breadth) and R-07 (no MFA) — are both scheduled in the build
plan.

Since this assessment was first written, R-02 and R-07 have been implemented and
R-03 and R-05 partly so. Three of those four remain **shadow-mode or partial**,
and the distinction matters: code that can enforce a control is not the same as a
control being enforced. R-02 and R-07 close when `CARE_RELATIONSHIP_ENFORCE` and
`MFA_ENFORCE` are set, which is a deployment decision that should follow a period
of measurement, not precede it.

**No processing described here should extend to identifiable patients outside a
consented research or pilot setting until R-01, R-03, R-09 are closed and R-02
and R-07 are actually enforced.**

---

## 8. Review

| | |
|---|---|
| Next review | On completion of build plan Phase 2, or on any change to the processing operations in §2 |
| Owner | Unassigned — see R-01 |
| Related | [MODEL_CARDS.md](../MODEL_CARDS.md) · [CHATBOT-PRIVACY.md](../CHATBOT-PRIVACY.md) · [GENOMICS.md](../GENOMICS.md) · [CHALLENGE_IMPLEMENTATION_PLAN.md](CHALLENGE_IMPLEMENTATION_PLAN.md) |
