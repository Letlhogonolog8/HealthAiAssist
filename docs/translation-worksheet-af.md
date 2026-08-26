# Translation worksheet — `af`

Generated from `client/src/locales/en/translation.json`.
33 strings: 9 safety-critical, 24 interface chrome.

Fill the **Translation** column. Leave anything you are unsure about blank —
a blank string keeps the language unavailable, which is the safe state. A
guess does not.

---

## Part 1 — Safety-critical

These decide whether the language may be offered at all. If any is blank or
untranslated, the language stays off. Each carries a note on what the sentence
has to accomplish — please translate the **intent**, not the words.

### `disclaimer.not_a_diagnosis`

**English:** This is a model output, not a diagnosis.

**Must convey:** Must be unambiguous that NO diagnosis has been made. Not "preliminary", not "initial", not "not yet confirmed" — those all imply a diagnosis exists in draft. The model produced a number; nobody has diagnosed anything.

**Translation:**

> 

### `disclaimer.screening_only`

**English:** Screening triage only. It is used to prioritise review, not to decide care.

**Must convey:** Screening means deciding who to look at more closely. It does not mean a light examination or a first-pass diagnosis. If the target language has a word used for population screening programmes, that is the one.

**Translation:**

> 

### `disclaimer.clinician_review_required`

**English:** Every result requires review by a qualified clinician before it means anything.

**Must convey:** A qualified person reviews EVERY result before it means anything. Must not read as optional, advisable, or "you may wish to".

**Translation:**

> 

### `disclaimer.questionnaire_unvalidated`

**English:** This is a tally of your own answers, not a validated cancer risk model. It does not estimate your probability of having or developing cancer.

**Must convey:** The questionnaire checks published criteria; it does not estimate the reader's chance of having cancer. Must not read as a risk score.

**Translation:**

> 

### `result.model_flagged`

**English:** The model flagged this scan for review.

**Must convey:** The model marked this for a human to look at. It did NOT find cancer. The distinction is the single most important one in the interface — a person reading this may believe they have been told they have cancer.

**Translation:**

> 

### `result.model_cleared`

**English:** The model did not flag this scan.

**Must convey:** The model did not mark it. This is NOT an all-clear and must not read as reassurance. Roughly 1 in 5 lung cancers and 1 in 30 melanomas are missed.

**Translation:**

> 

### `result.confidence_is_not_accuracy`

**English:** Confidence is how sure the model was, not how often it is right.

**Must convey:** Confidence is how sure the model was about one image. Accuracy is how often it is right across many. A 99% confident wrong answer is ordinary.

**Translation:**

> 

### `result.awaiting_review`

**English:** Awaiting clinician review.

**Must convey:** Nothing has been decided yet. Neutral — must not imply good or bad news.

**Translation:**

> 

### `action.contact_clinician`

**English:** Discuss this with your clinician.

**Must convey:** A direct instruction to speak to a person. Should feel like the next step, not a legal footer.

**Translation:**

> 

---

## Part 2 — Interface chrome

Navigation, buttons and headings. Lower consequence, still needed for the
interface to be usable.

| Key | English | Translation |
|---|---|---|
| `welcome` | Welcome back, {{name}} | |
| `manage_health` | Manage your health journey with AI-powered insights | |
| `overview` | Overview | |
| `appointments` | Appointments | |
| `scans` | Scans | |
| `risk_assessment` | Risk Assessment | |
| `profile` | Profile | |
| `ai_tools` | AI Tools | |
| `recent_activities` | Recent Activities | |
| `upcoming_appointments` | Upcoming Appointments | |
| `no_recent_activities` | No recent activities | |
| `no_upcoming_appointments` | No upcoming appointments | |
| `schedule_appointment` | Schedule Appointment | |
| `medical_imaging_analysis` | Medical Imaging Analysis | |
| `skin_cancer_detection` | Skin Cancer Detection | |
| `live_skin_scan` | Live Skin Scan | |
| `personal_information` | Personal Information | |
| `edit` | Edit | |
| `cancel` | Cancel | |
| `save_changes` | Save Changes | |
| `ai_medical_scanner` | AI Medical Scanner | |
| `upload_medical_images` | Upload medical images for AI-powered analysis | |
| `book_appointment` | Book Appointment | |
| `schedule_now` | Schedule Now | |

---

## Sign-off

Required before the language can be offered. Both, not either.

- [ ] I am a fluent speaker of this language.
- [ ] I have read what each safety-critical string must convey, and my
      translations convey it — not merely a fluent rendering of the English.
- [ ] Where I was unsure, I left it blank rather than guessing.

Name: ______________________  Qualification: ______________________

Date: ______________________
