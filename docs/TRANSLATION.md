# Translation

## The finding that comes first

**No component in this application consumes translations.**

There is an i18next runtime, a set of translation files, a language switcher, a
coverage panel, and a well-designed gate that refuses to offer a language until
every safety-critical string is translated *and* a clinical speaker has signed
it off. Not one component calls `useTranslation`. Every string in the interface
is a hardcoded English literal.

The system is inert, and it is worse than having no translation system, because
it looks like one. Someone who completed a translation file, watched it pass the
gate and switched the language would get an interface still entirely in English —
and would reasonably conclude the translation was broken rather than that nothing
reads it.

The gate protects against a *partially* translated interface. Nothing protected
against a *completely untranslated* one, which is the state the application is
actually in. `tests/i18n-wiring.test.ts` now does.

### What this means for the build plan

P2.10 was scoped as "translate into isiZulu and Afrikaans, through the existing
clinical-review gate". The translation is not the blocking work. The blocking
work is replacing every hardcoded string in the components with a `t()` call —
which is larger, entirely mechanical, and has to happen first.

Sequenced properly:

1. **Wire the components.** Replace hardcoded strings with `t('key')`, extending
   `en/translation.json` as you go. Largest single piece of work, no linguistic
   skill required. `tests/i18n-wiring.test.ts` will fail the moment the first
   component is wired, and its message says what to update.
2. **Render the switcher.** `LanguageSwitcher` exists and is not mounted
   anywhere; only `LanguageCoverage`, a status panel in the admin dashboard, is.
3. **Then translate**, using the worksheets below.

Doing step 3 first produces files that nothing reads.

---

## For a reviewer

Two worksheets are generated and ready:

- [`translation-worksheet-zu.md`](translation-worksheet-zu.md) — isiZulu
- [`translation-worksheet-af.md`](translation-worksheet-af.md) — Afrikaans

Regenerate for any language:

```bash
npm run translation-worksheet -- xh > docs/translation-worksheet-xh.md
```

Each worksheet carries 33 strings: 9 safety-critical and 24 interface chrome.

**The safety-critical strings carry a note on what the sentence must
accomplish**, because a fluent translation can be wrong in exactly the direction
that matters. "Not a diagnosis" rendered as "not a *final* diagnosis" is fluent,
natural, and implies a diagnosis exists in draft. It does not.

The single most important one:

> `result.model_flagged` — "The model flagged this scan for review."
>
> The model marked this for a human to look at. **It did not find cancer.** A
> person reading a mistranslation of this sentence may believe they have been
> told they have cancer.

And its counterpart:

> `result.model_cleared` — "The model did not flag this scan."
>
> This is **not** an all-clear and must not read as reassurance. Roughly 1 in 5
> lung cancers and 1 in 30 melanomas are missed.

**Leave anything you are unsure about blank.** A blank string keeps the language
unavailable, which is the safe state. A guess does not.

---

## Why the gate is built this way

From `client/src/lib/language-availability.ts`:

> The Spanish translation shipped here covers twenty-nine keys, all of them
> navigation and dashboard chrome: "Overview", "Appointments", "Save Changes".
> None of the clinical text is in it. A patient who set the interface to Spanish
> would have got Spanish navigation wrapped around English results, English risk
> levels, and an English "this is a model output, not a diagnosis" banner.

Someone who sees an application in their own language reasonably concludes it is
*in* their language. The string that most needs to be understood would have been
the one still in English. **Partial coverage in a medical interface is not a
smaller version of full coverage; it is a different and more dangerous thing.**

Two conditions, both required:

1. every safety-critical key present and non-empty, and
2. a human who reads the language has signed the translation off.

The second cannot be inferred from the first. A machine translation of "not a
diagnosis" can be present, complete, and wrong in a way only a speaker will
catch, so `clinicallyReviewed` is set by a person and never derived.

---

## Installing a completed translation

1. Create `client/src/locales/<code>/translation.json` with the reviewed strings.
2. Add an entry to `LANGUAGE_MANIFEST` in `language-availability.ts`, with
   `clinicallyReviewed: true`, `reviewedBy` and `reviewedOn` filled from the
   worksheet's sign-off block.
3. Use the endonym for `label` — what speakers call the language, not what
   English calls it. `isiZulu`, not `Zulu`.
4. Run `npm test`. The wiring test refuses a reviewed non-English language while
   no component consumes translations.
5. Check `LanguageCoverage` in the admin dashboard reports it as available.

---

## Keys removed, and why

Five keys were pruned as describing capabilities the platform does not have.
Sending a reviewer strings for removed features wastes their time and risks
reintroducing the feature:

| Key | Why |
|---|---|
| `health_score` | `/api/patient/stats` returns `healthScore: null` with a note explaining that scoring a person's health is a clinical act this platform has no business attempting. A translation key for it is an invitation to put it back. |
| `blood_based_cancer_screening` | The blood test analyser was deleted — it scored cancer risk in the browser from hand-written weights. |
| `blood_pressure`, `heart_rate`, `bmi` | Not collected anywhere in the system. |

`tests/i18n-wiring.test.ts` guards against the first two returning.

---

## Not covered

- **`lang` attributes.** Mixed-language content needs them, or a screen reader
  pronounces isiZulu with English phonetics. See
  [ACCESSIBILITY.md](ACCESSIBILITY.md).
- **Right-to-left.** No RTL language is planned; the layout has not been tested
  for one.
- **Pluralisation and interpolation.** `welcome` uses `{{name}}`; i18next's
  plural rules have not been exercised, and isiZulu noun classes are more
  complex than English plurals.
- **Clinician-facing text.** The worksheets cover the patient interface. The
  radiologist worklist and admin dashboard are English-only and not scoped here.
