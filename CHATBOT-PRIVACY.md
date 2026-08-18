# AI assistant — data protection

The assistant sends what a user types to **OpenAI, in the United States**. Under
POPIA that is a cross-border transfer (s72) of personal information, and where
the message concerns health it is *special* personal information (s26), which may
only be processed on an s27 ground.

This document records the technical controls. **It is not a legal opinion and it
is not a completed impact assessment** — a South African privacy practitioner
must review the consent wording and sign off the PIA before any real patient uses
this. What the controls do is make that review short, because most of the
identifiable data no longer leaves.

## What used to be sent

Every request carried a system message built by `getUserContext()`:

```
User: Thabo Mokoena, Role: patient, Age: 47, Gender: male
Recent scans: skin (pending), lung (reviewed)
Upcoming appointments: 2
```

The patient's real name, their age and sex, and thirty days of scan history —
identifiable special personal information, transferred abroad, with no consent, no
operator agreement and no notice. The full payload was also written to the server
log via `console.log`.

`/api/chatbot/analyze` was worse: it accepted free-text symptoms and forwarded
them **with no authentication at all**.

## What is sent now

The system prompt, and the user's messages after redaction. Nothing else.

- **No name.** `getUserContext()` is deleted. The assistant answers general
  questions and never needed identity to do it.
- **No clinical history.** No scans, results, appointments or risk assessments.
- **No identifiers in free text.** [`server/privacy/redaction.ts`](server/privacy/redaction.ts)
  strips SA ID numbers, phone numbers, email addresses, dates of birth, labelled
  record and passport numbers, and long digit runs, replacing each with a labelled
  placeholder so the sentence still reads.
- **Nothing logged.** The payload `console.log` is gone.

Names are deliberately *not* pattern-matched. Any regex broad enough to catch
South African names would destroy ordinary clinical text, and one narrow enough to
be safe would miss most of them. Names are handled at the source instead — the
system never puts one in.

## Controls

| Control | Where |
|---|---|
| Consent required, checked on **every** message | `hasExternalAiConsent()` |
| Withdrawal takes effect immediately | consent read per request, not cached |
| Append-only consent record with the disclosure version | `processing_consents` |
| Disclosure readable before consenting | `GET /api/chatbot/disclosure` |
| Every transfer recorded | `audit_events`, action `EXTERNAL_AI_TRANSFER` |
| Authentication on both transfer paths | `requireAuth` |
| Kill switch, no deploy needed | `CHATBOT_ENABLED=false` |
| Scope limits in the system prompt | no diagnosis, no result interpretation |
| Fails closed | unreadable consent table ⇒ refuse |

Without consent the assistant still answers, from the **local fallback** — no
transfer occurs. Refusing to work at all would have pushed users toward consenting
for the wrong reason.

### The transfer record

```
npx tsx scripts/show-transfer-log.ts
  2026-08-18T15:29:14Z  user=50  -> OpenAI (United States)  model=gpt-4o-mini
                        msgs=1  redacted=[sa_id_number]  clinicalContext=false
```

Categories only, never values. An audit log containing the personal information it
audits has doubled the exposure rather than controlled it.

## What you still have to do

Engineering cannot supply any of this.

**With OpenAI**
- Sign the **Data Processing Addendum**. This is what makes them a contracted
  operator under POPIA s21, which requires a written contract obliging them to
  maintain security measures.
- Request **Zero Data Retention**. If granted, prompts are not stored on their
  side at all, which materially changes the s72 analysis.
- Record that API data is not used for training by default, and cite it in the
  notice rather than assuming users know.

**With the Regulator**
- Register your **Information Officer** with the Information Regulator.
- Complete a **Personal Information Impact Assessment**. The controls above are
  most of its substance; the gap is the lawful-basis analysis and the residual
  risk assessment.

**With users**
- An **s18 notice** in the privacy policy: what is sent, to whom, which country,
  why, and how to withdraw. The in-app disclosure covers the point of use; the
  policy still has to say it.
- A **retention and deletion policy** for conversations held on your side.

## Residual risk, stated plainly

- Redaction is a reduction measure, not a guarantee. Free text can identify
  someone through combinations no pattern will catch — "the radiologist at the
  Tygerberg clinic who saw me on Tuesday". Consent and disclosure exist because
  redaction alone is not sufficient.
- A user can still type something regrettable. The disclosure says so in plain
  language, which is the honest mitigation.
- OpenAI's own retention applies unless ZDR is granted. Until it is, assume
  prompts persist on their infrastructure for their stated retention period.
- The kill switch is the containment measure if the operator agreement lapses or
  the Regulator raises a question.
