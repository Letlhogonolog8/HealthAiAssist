# Regulatory Pathway

**Status: nothing here has been filed, and no regulator has been contacted.**
This document exists to make that engagement actionable, not to imply it has
begun.

**Scope note.** This is an engineering document written to brief a regulatory
consultant. It is not regulatory advice. Every classification below is a
*proposed* position that a qualified consultant must confirm — the class
determines the whole evidence burden, and getting it wrong wastes months.
Items needing that confirmation are marked **[CONFIRM]**.

---

## 1. What is being regulated

Not the platform. The two image classifiers.

The appointment booking, messaging, patient portal and audit machinery are
ordinary health IT. The regulated article is the software that takes a medical
image and returns a probability that informs whether a clinician looks at it
sooner — that is Software as a Medical Device (SaMD), and it is regulated on its
own regardless of what it is bundled with.

| | Lung | Skin |
|---|---|---|
| Input | CT nodule patch | Dermoscopic / clinical lesion image |
| Output | Calibrated P(cancer), threshold 0.30 | Banded: >0.70 malignant, 0.30–0.70 uncertain, ≤0.30 benign |
| Measured sensitivity | 0.812 | 0.913 |
| Measured specificity | 0.757 | 0.814 |
| Clearance held | none | none |

Figures are held-out test-set values from `MODEL_REGISTRY`. They are not clinical
performance and must never be presented to a regulator as such — see §4.

---

## 2. Proposed classification

### IMDRF SaMD framework

The IMDRF categorisation is the common language all three jurisdictions below
map onto. It is a two-axis judgement: **significance of the information** the
software provides, and **the state of the healthcare situation**.

- **Significance:** *drives clinical management*. It does not diagnose and it
  does not treat. It changes the order in which a radiologist looks at scans,
  which changes when a cancer is found.
- **Situation:** *serious*. Cancer screening.

That intersection is **IMDRF Category III** (of I–IV) on the published grid.
**[CONFIRM]** — the argument that it is Category II because a human reviews
every result is one a consultant may or may not accept. It is the single most
consequential question in this document, and the honest reading is that "a human
reviews everything" is weaker than it sounds: triage order determines *when* the
human looks, and a systematically wrong ordering harms patients even though a
human signed every report.

### Jurisdiction mapping

| Jurisdiction | Regulator | Proposed route | Confidence |
|---|---|---|---|
| South Africa | SAHPRA | Medical device licensing under the Medicines and Related Substances Act 101 of 1965 (as amended). Establishment licence required to manufacture/distribute; device class determines the conformity route. | **[CONFIRM]** class letter and whether a SaMD-specific guideline now applies |
| United States | FDA | 510(k) if a predicate exists (several CADt/CADx lung and dermatology devices are cleared); De Novo if not | **[CONFIRM]** predicate search |
| European Union | Notified Body under EU MDR 2017/745 | Rule 11 places most diagnostic-decision software at Class IIa or higher; a device informing decisions that may cause death or irreversible deterioration reaches IIb/III | **[CONFIRM]** rule application |

**South Africa is the only one that matters for the 25 September 2026 Challenge
submission.** FDA and EU are recorded here because the classification work is
shared and doing it once is cheaper than doing it three times — not because they
are on the critical path.

---

## 3. What already exists

Genuinely useful groundwork, and it is more than most projects have at this
stage:

| Requirement | Artefact | State |
|---|---|---|
| Device description | `docs/TECHNICAL_SPECIFICATIONS.md`, `docs/ARCHITECTURE_DIAGRAMS.md` | Exists |
| Performance characterisation | `MODEL_CARDS.md`, `MODEL_REGISTRY` | Exists, held-out only |
| Reproducibility | `scripts/evaluate-model.py`, commands published in model cards | Exists |
| Risk / failure analysis | `docs/pack/FAILURE_MODES.md` | Exists |
| Data protection impact | `docs/DPIA.md` | Exists |
| Retention policy | `docs/RETENTION.md` | Exists |
| Audit trail | `audit_events`, ~40 audited routes, `SCAN_ANALYSED` on the inference path | Exists |
| Post-market signal | `ops/alerts.yml`, `ops/RUNBOOK.md`, `/api/models/performance` | Exists |
| Informed consent | `processing_consents` scope `ai_image_analysis` | Exists |
| Known-limitation disclosure | Skin-tone finding published in the model card | Exists |

The last one is worth stating plainly to a consultant: this project has
*published* that its skin test set is 96% light-skinned and therefore cannot
establish performance on darker skin. That is a disclosure most submissions
avoid making, and it is far better to arrive having made it than to have it
found.

---

## 4. What does not exist, in the order it blocks things

**1. A quality management system.** ISO 13485. Nothing else on this list can be
filed without it, because a regulator's first question is not "is the model
good" but "what process produced it, and would it catch the problem next time".
This is the long pole. **[CONFIRM]** whether SAHPRA accepts an equivalent.

**2. Clinical evidence.** Held-out test-set numbers are not clinical
performance. They were measured on curated public datasets (LIDC-IDRI for lung),
not on the population, scanners or workflow the device would be used in. What is
needed is a prospective study on the intended-use population, with a
pre-registered endpoint. Nothing in this repository substitutes for it, and no
amount of engineering will.

**3. Demographic performance.** The skin test set has 4 dark-skin images and no
dark-skin benign controls. Lung training demographics are unrecorded entirely.
A regulator will ask, and "we disclosed it" is the right answer to the ethics
question but not to the evidence one. Representative data collection is a
prerequisite, not a follow-up.

**4. Formal risk management file.** ISO 14971. `FAILURE_MODES.md` is a strong
start and is not the same artefact — 14971 wants hazard identification, risk
estimation, control measures and *evidence the controls work*, traced.

**5. Software lifecycle records.** IEC 62304. Given the IMDRF category above,
likely software safety class B or C, which brings requirements on architecture,
unit verification and configuration management. The test suite and CI are
evidence toward this; they are not organised as 62304 records.

**6. Labelling and instructions for use.** Including the intended-use statement,
contraindications, and the residual-risk disclosures. The model card caveats are
the raw material.

---

## 5. Intended-use statement (draft)

The single most important sentence in any submission, because everything else is
assessed against it. Deliberately narrow — a wider claim is a larger evidence
burden and a worse device.

> [Device] is a software tool intended to assist qualified clinicians in
> prioritising the review order of lung CT nodule patches and skin lesion
> images. It provides a calibrated probability score as an adjunct to, and never
> a replacement for, clinician review. It does not provide a diagnosis. Every
> result is reviewed by a qualified clinician before any clinical action is
> taken. It is not intended for use as a standalone diagnostic device, for
> screening asymptomatic populations outside an established screening programme,
> or as the sole basis for any clinical decision.

**[CONFIRM]** — the phrase "prioritising review order" is doing deliberate work:
it claims triage, not detection. A consultant should confirm it is both
defensible and sufficient for the intended market, because narrowing it further
would make the device useless and widening it raises the class.

---

## 6. Engaging SAHPRA

**Do not file anything first.** The first contact should be a pre-submission
meeting, which costs a request and gets the classification question answered by
the people whose answer binds.

**Bring:** the intended-use statement (§5), the device description, the measured
performance with its limitations stated plainly, and the classification proposal
with its uncertainty acknowledged.

**Ask, specifically:**

1. Is this device class correct for this intended use?
2. Is a SaMD-specific guideline applicable, or does the general device framework
   govern?
3. What clinical evidence is expected for this class and this claim?
4. Does an establishment licence need to precede a device application?
5. Is there a route for the demographic-representation gap short of full
   prospective collection — for example a restricted indication?

**Question 5 matters most.** The honest answer to the fairness gap may be that
the device can only be indicated for populations it has been measured on, until
it has been measured on more. That is a legitimate outcome and a much faster one
than waiting for a representative dataset that does not exist yet.

---

## 7. For the 25 September 2026 Challenge submission

The Challenge is not a regulator and does not require clearance. What it scores
is credibility, and the correct posture is the one this codebase already takes:

- State plainly that the device has no clearance in any jurisdiction.
- Show the pathway is understood — this document.
- Show the engineering that a submission would need already exists: audit trail,
  post-market monitoring, consent, published limitations.
- **Do not imply a filing is in progress.** It is not, and a reviewer who checks
  will find that out.

The most valuable thing obtainable before the deadline is not regulatory
progress. It is the clinical advisor in `docs/CLINICAL_ADVISOR_BRIEF.md`, who
can speak to clinical utility — the criterion no amount of engineering evidences.

---

## 8. Honest timeline

| Phase | Realistic duration |
|---|---|
| Regulatory consultant engaged, classification confirmed | 4–8 weeks |
| QMS (ISO 13485) established | 6–12 months |
| Representative data collected, models retrained and re-evaluated | 6–12 months, dataset-dependent |
| Prospective clinical study | 12–24 months |
| SAHPRA submission and review | **[CONFIRM]** — dependent on class and current queue |

**Two to four years to a cleared device, on this evidence base.** Anyone
promising materially faster is either assuming a lower class than §2 proposes or
is not counting the clinical study.

Nothing in this timeline blocks the Challenge submission, research use, or
continued development. It blocks one thing only: use on real patients as a
clinical device.
