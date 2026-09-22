# HealthAI Assistant — Claude Code Development Rules

## Project Identity

HealthAI Assistant is a safety-conscious medical AI pre-analysis and clinical triage platform.

It is NOT an autonomous cancer diagnosis system.

The system is clinician-in-the-loop.

AI provides pre-analysis and decision-support information that must be reviewed by an appropriately qualified healthcare professional.

---

## Core Safety Principle

The fundamental HealthAI principle is:

REFUSE RATHER THAN GUESS.

Never fabricate a medical prediction, probability, diagnosis, segmentation, measurement, clinical result, dataset metric, or model output.

Never use Math.random(), arbitrary constants, fake probabilities, placeholder clinical findings, or simulated medical results.

If a model cannot safely process an input, the system must refuse, return an appropriate error/status, or route the case for human review.

---

## Model Integrity

Never claim that a model is clinically validated unless the repository contains evidence supporting that claim.

Every model must have:

- model name
- version
- intended use
- training dataset
- validation dataset
- test dataset
- known limitations
- performance metrics
- subgroup information where available
- OOD behavior
- failure modes
- validation status

Models must be clearly classified as:

RESEARCH
EXPERIMENTAL
INTERNAL VALIDATION
EXTERNAL VALIDATION
CLINICAL VALIDATION
PRODUCTION

Do not activate experimental models in production clinical workflows.

---

## Current Lung Model Limitation

The existing lung model was trained using web-sourced PNG data and should NOT be represented as a clinically validated CT/DICOM model.

Do not bypass OOD detection simply to make real CT images produce predictions.

The LIDC-IDRI lung nodule model is a research/validation component and must not be represented as clinically validated based only on its current small held-out test set.

---

## Computer Vision Architecture

The long-term HealthAI pipeline is:

DICOM / Medical Image
→ Quality Gate
→ OOD Detection
→ Detection
→ Segmentation
→ Localization
→ Characterization
→ Multimodal Clinical Context
→ Calibration / Uncertainty
→ AI-Assisted Triage
→ Clinician Review
→ Clinical Outcome
→ Model Monitoring

Not every stage is currently production-ready.

Implement only functionality supported by actual models and validated data.

---

## Medical Imaging

The architecture should progressively support:

- 2D medical images
- DICOM
- CT
- 3D medical volumes
- lesion segmentation
- organ segmentation
- longitudinal imaging

Do not claim that these capabilities are clinically operational until they have actually been implemented and validated.

---

## Future Cancer Areas

The following are roadmap items unless actual validated models exist:

- Breast imaging
- Colon / gastrointestinal imaging
- Prostate imaging
- Additional cancer imaging modalities
- Medical video
- Ultrasound
- Endoscopy

Never create fake models for roadmap items.

Never create fake predictions for future modules.

---

## Clinical Review

AI results must remain subject to clinician review.

Record where appropriate:

- model version
- AI result
- clinician assessment
- disagreement
- override
- reviewer
- timestamp
- final outcome

---

## Privacy and Security

Preserve:

- authentication
- RBAC
- MFA
- encryption
- audit logging
- consent
- POPIA/privacy controls
- secure clinical data handling

Never expose sensitive clinical information in logs unnecessarily.

---

## Database

Use the existing PostgreSQL/Drizzle architecture.

Do not destroy existing migrations.

Do not silently modify production data.

Use proper migrations for schema changes.

---

## Frontend

HealthAI should look:

- professional
- clinical
- modern
- trustworthy
- simple
- accessible

Avoid generic "AI startup" visual design.

Do not overload dashboards with unnecessary information.

Do not create UI elements for functionality that does not exist.

---

## Development Behaviour

Before modifying complex functionality:

1. Inspect the existing implementation.
2. Understand dependencies.
3. Identify affected files.
4. Check existing tests.
5. Make the smallest appropriate architectural change.
6. Run relevant tests.
7. Fix regressions.
8. Verify the final implementation.

Never speculate about code that has not been inspected.

---

## Testing

Never remove or weaken tests merely to make the project pass.

Tests are part of the safety architecture.

Important areas include:

- authentication
- RBAC
- MFA
- consent
- OOD refusal
- model unavailable behavior
- invalid medical images
- model versioning
- clinician review
- audit logging
- fairness
- privacy
- real-time events
- no fabricated medical results

---

## Git Safety

Local reversible actions are allowed when necessary for development.

Ask before:

- deleting important files
- dropping database tables
- destructive migrations
- git reset --hard
- force pushing
- pushing to remote repositories
- modifying production infrastructure
- modifying production databases
- sending external communications
- exposing secrets

Never use destructive commands as a shortcut for solving development problems.

---

## Implementation Philosophy

Do not add technology merely because it looks impressive.

Prefer:

REAL FUNCTIONALITY
+
REAL DATA
+
REAL VALIDATION
+
REAL CLINICAL WORKFLOW
+
REAL SAFETY CONTROLS

over:

DEMO FEATURES
+
FAKE AI
+
FAKE DATA
+
UNVALIDATED CLAIMS

The goal is to transform HealthAI from a prototype toward a credible, safety-conscious, enterprise-grade medical AI platform.

Always distinguish between:

CURRENT
EXPERIMENTAL
VALIDATION
PLANNED
FUTURE