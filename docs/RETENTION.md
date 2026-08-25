# Retention and Erasure Schedule

**Closes DPIA risk R-03 (no retention schedule) and R-05 (no data subject
rights flow).** Read with [DPIA.md](DPIA.md).

Implemented in [`server/erasure.ts`](../server/erasure.ts). The categories below
are the ones that code adjudicates; the two are meant to stay in step, and a
change to one without the other is a bug.

---

## The constraint that shapes this

Two obligations apply at once, and they are not in conflict so much as applying
to different things:

| | |
|---|---|
| **POPIA §24** | A data subject may request deletion of personal information. |
| **POPIA §14** | Personal information must not be kept longer than necessary for the purpose. |
| **National Health Act §17 · HPCSA guidance** | A health record must be kept for **at least six years from the last entry** — longer for minors, and for certain occupational health records. |

The honest system says which obligation governs which category. What is
dishonest is a "delete my account" button that reports success while a statutory
duty silently prevents most of the deletion, because the person then believes
their record is gone.

So: an erasure request is **assessed per category**, and the outcome states what
was erased, what was retained, and on what basis. A refusal that cites the
instrument is a better answer than silence.

---

## Schedule

| Category | Retention | Erasable on request? | Basis |
|---|---|---|---|
| **Screening scans, findings, recommendations** | 6 years from last entry | **No**, until the period expires | National Health Act §17; HPCSA |
| **Scan outcomes (confirmed diagnoses)** | 6 years from last entry | **No**, until the period expires | Part of the health record |
| **Messages with clinicians** | 6 years from last entry | **No**, until the period expires | Clinical correspondence forms part of the record |
| **Appointments** | 6 years from last entry | **No**, until the period expires | Part of the health record |
| **Genomic data, variants, polygenic scores** | Until consent is withdrawn | **Yes, in full** | Held under consent, not a statutory duty |
| **Genomic consent records** | 6 years from withdrawal | No | Evidence the processing and the erasure were lawful |
| **AI assistant transcripts** | Until consent is withdrawn | **Yes** | Held under §72 consent |
| **Processing consent records** | 6 years from withdrawal | No | Evidence the §72 transfer was lawful |
| **Notifications** | 12 months | **Yes** | Operational; no retention duty |
| **Contact details** (address, phone, emergency contact) | While the account is active | **Yes** | Not required to maintain the clinical record |
| **Account identity** (name, email) | Tombstoned on erasure; row retained | Replaced, not deleted | Deleting the row orphans the retained clinical record and the audit trail |
| **Audit events** | 6 years | **Never** | POPIA §19 accountability |
| **Session records** | 24 hours after expiry | Yes | Operational |
| **Scan images in object storage** | With their scan record | Follows the scan | Part of the health record |

### Two entries worth expanding

**The audit trail is never erasable.** An audit trail that can be deleted on
request is not an audit trail — it is the record that demonstrates access was
appropriate, including the record that this erasure was performed properly. Its
`detail` column is constrained by design to non-identifying context, so it holds
no clinical content and no contact details.

**Erasure is tombstoning, not `DELETE`.** The `users` row stays with its personal
fields replaced, the account deactivated, and MFA material cleared. Deleting it
outright would orphan every scan, appointment and audit event referencing it —
destroying the clinical record the six-year duty exists to preserve.

---

## How a request flows

```
  Patient
    │
    ├─ GET  /api/patient/me/erasure-assessment
    │       What would be erased and what would be kept, with reasons.
    │       Available before requesting, and deliberately specific.
    │
    └─ POST /api/patient/me/erasure-request
            Recorded, not executed. Administrators are notified.
                │
                ▼
  Administrator
    ├─ GET  /api/admin/erasure-requests
    └─ POST /api/admin/erasure-requests/:id/execute
            Re-assesses at execution — a scan added since the request would
            extend the clinical hold, and acting on a stale adjudication would
            erase something now protected.
                │
                ▼
            status: completed | partially_completed | refused
            outcome: the per-category adjudication, stored on the request
            ERASURE_COMPLETED written to audit_events
```

Erasure goes through a person rather than executing on submission. It is
irreversible, it interacts with a legal duty, and the assessment can change
between request and execution. The request row is itself durable evidence that
the right was exercised and when — which matters whether or not the erasure is
granted in full.

---

## Not yet implemented

Stated because an omission that is not written down is indistinguishable from an
oversight:

- **No automatic expiry job.** Nothing sweeps records whose retention period has
  passed. The schedule above is enforced at the point of an erasure request, not
  continuously, so data currently outlives its period until someone asks. A
  scheduled job is the remaining work, and until it exists §14 is only partly
  met.
- **Minors are not distinguished.** The retention period for a minor runs longer
  and the schema records no date of birth reliably enough to compute it. Any
  paediatric deployment needs this before it starts.
- **Object storage is not swept.** Deleting a scan row does not currently delete
  the image object behind it.
- **No subject access export.** POPIA §23 gives a right of access as well as
  erasure. A patient can see their own records through the application; there is
  no machine-readable export.

---

## Review

| | |
|---|---|
| Next review | On the first paediatric deployment, or on any change to the categories in `server/erasure.ts` |
| Owner | Unassigned — see DPIA R-01 |
