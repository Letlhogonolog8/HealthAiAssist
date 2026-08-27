# Submission Readiness

Pre-Application Guidelines §10, worked line by line, with the state of each item
as at the last verification run.

**Deadline: 25 September 2026, 23:59 SAST. Submit on the 24th.**

---

## Blocking — nothing else matters until these close

| # | Item | State |
|---|---|---|
| **B1** | **South African entity or institutional affiliation** | ✗ **UNRESOLVED** |
| **B2** | **Named clinical advisor** | ✗ **UNRESOLVED** |

**B1 is an eligibility gate.** Entry is restricted to SA-registered SMMEs,
university-based teams, science-council teams, or academic laboratories. Nothing
in this repository establishes which applies. Either produce CIPC registration
(plus a SARS tax compliance PIN, which §5 lists as a possible request) or a
signed institutional authorisation letter.

**B2 is the largest single scoring gain available.** §4.1 rewards
multidisciplinary teams and §7 scores "clinical utility and usability" — a
criterion that cannot be evidenced at all by a team with no clinician in it. The
outreach email and reviewer brief are written and ready in
`docs/CLINICAL_ADVISOR_BRIEF.md`; it needs sending.

Both depend on other people replying. Both have been outstanding since the
beginning. Neither is an engineering task.

---

## §10 checklist

| # | Requirement | State | Evidence |
|---|---|---|---|
| 1 | Product aligns with the challenge problem statement | ✓ | Modernising legacy diagnostic workflow: AI triage behind installed radiology hardware, no equipment replaced |
| 2 | Correct TRL selected | ✓ **TRL 4** | Proof of concept and safety demonstrated in a defined laboratory model. No regulatory review, so not TRL 5 |
| 3 | Only one category selected | ✓ **Category A** | |
| 4 | Only one primary track selected | ✓ **Track 2** | Track 3 referenced as ecosystem contribution only, never as a second entry |
| 5 | All form sections complete | ⧗ | Text drafted in `APPLICATION_TEXT.md`; two `[CONFIRM]` markers correspond to B1 and B2 |
| 6 | All supporting documentation uploaded | ⧗ | Pack assembled below; entity documents blocked on B1 |
| 7 | Integration across device, AI and workflow demonstrated | ◐ **2 of 3** | AI and workflow implemented; device layer is a costed plan under the §3 allowance |
| 8 | Reviewed for accuracy, completeness and clarity | ✓ | See verification below |

---

## Supporting documents

| Document | Format | State |
|---|---|---|
| Model cards | `model-cards.pdf` (8 pp) | ✓ Every figure with its reproduction command |
| Architecture | `architecture.pdf` | ✓ Three §2 components, refusal paths |
| Application text | `APPLICATION_TEXT.md` | ⧗ Two `[CONFIRM]` markers |
| Device integration plan | `docs/DEVICE_INTEGRATION.md` | ✓ Costed, named partner targets |
| DPIA | `docs/DPIA.md` | ✓ 16 risks, six unmet conditions |
| Retention and erasure | `docs/RETENTION.md` | ✓ Including what is not implemented |
| Accessibility audit | `docs/ACCESSIBILITY.md` | ✓ WCAG 2.1 AA, zero violations |
| Failure modes and incident response | `FAILURE_MODES.md` | ✓ Seven gaps stated |
| Demonstration script | `DEMO_SCRIPT.md` | ✓ Rehearsed, figures verified |
| Translation status | `docs/TRANSLATION.md` | ✓ Records that i18n is inert |
| Demonstration video | — | ✗ **Not recorded** |
| CIPC / institutional letter | — | ✗ Blocked on B1 |
| Clinical advisor letter | — | ✗ Blocked on B2 |

---

## Verification — last full run

| Check | Result |
|---|---|
| `npx tsc --noEmit` | clean |
| `npm run build` | clean, service worker generated |
| `npm test` | **171 / 171**, 42 suites |
| Python modules compile | ✓ |
| Accessibility (axe-core, WCAG 2.1 AA) | 0 violations, both themes |

### Demo rehearsal — every figure in the script confirmed against a live system

| Act | Claimed | Measured |
|---|---|---|
| I — skin result | malignant, Grad-CAM present | `malignant 99.52`, explanation present |
| II — chest → skin model | refused, 37.04 / 22.63 | **exact** |
| II — skin → lung model | refused, ~26.1 / 16.51 | `26.125 / 16.51` |
| III — unsupported modality | 503, no diagnostic content, queued | **exact**, `queuedForManualReview: true`, no diagnostic field present |
| V — clinical DICOM → lung | 422 with explicit reason | **exact** |

**One correction made during rehearsal.** The script claimed sub-second latency
while Act I demonstrates Grad-CAM, which costs ~1.2 s. Warm inference is ~470 ms;
with the overlay it is ~1.7 s. The script now says so, because a panellist
noticing the gap between a claim and the clock is worse than the extra second.

### Capacity

| | |
|---|---|
| Warm inference | ~470 ms skin, ~430 ms lung |
| Sustained throughput | ~2 scans/second per instance |
| 30 concurrent | 27 served, 3 shed with 503 + `Retry-After`, queue drained to zero |

Shedding is the designed behaviour: past the queue depth the service refuses
rather than accumulating work, and a 503 becomes a scan queued for manual review.

---

## Before submitting — operational

- [ ] **Rotate every credential.** `SECURITY_CHECKLIST.md` records that the
      OpenAI key, Twilio credentials, Google Calendar credentials and database
      password were exposed in git history. `.env` is gitignored now; history is
      history.
- [ ] Run `npm run db:migrate-mfa` and `npm run db:migrate-care` on any
      environment being demonstrated.
- [ ] Set `INFERENCE_URL` wherever the demo runs — without it every scan takes
      8–14 s and DICOM is not converted.
- [ ] Provision a separate test database, so `npm test` no longer needs
      `TEST_ALLOW_SHARED_DATABASE=true` against the live instance.
- [ ] Decide on `MFA_ENFORCE` and `CARE_RELATIONSHIP_ENFORCE`. Both are off.
      Run in shadow mode, read `CARE_RELATIONSHIP_WOULD_BLOCK` in
      `audit_events`, then enable. Until then the DPIA correctly marks R-02 and
      R-07 as mitigated-in-shadow rather than closed.
- [ ] Record the demonstration video. Five acts, ~90 seconds of it refusals.

---

## What this entry does not claim

Collected in one place, because a panel that finds an overstatement stops
trusting the rest — and because every one of these is stated in the pack rather
than omitted from it.

- No clinical validation. No prospective data. No patients.
- No regulatory clearance or submission in any jurisdiction. Expected
  classification Class B/IIa SaMD, to be confirmed at pre-submission.
- No POPIA compliance claim. The DPIA records six unmet conditions, the first
  being that no Information Officer has been appointed.
- **The lung model cannot read clinical DICOM.** Every window tested — 20.3 to
  30.4 against a 16.51 threshold. Retraining on a documented CT dataset is the
  first item of clinical work.
- **Skin performance on darker skin cannot be established** from the test set.
  4.3% of images are brown or darker; the darkest bin holds four with no
  controls.
- Breast, colon and prostate have no classifier and are not offered.
- No FHIR or HL7. DICOM ingest only, one direction.
- English only in practice — and no component consumes translations at all.
- No named accountable clinician for the review queue, no turnaround target, no
  out-of-hours cover.

Every one of these was found and published by this project rather than
discovered by an evaluator. That is the argument the entry rests on, and it only
works if the list stays complete.
