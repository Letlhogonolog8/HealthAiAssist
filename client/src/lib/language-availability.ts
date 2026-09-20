/**
 * Which languages this deployment may offer, and why the others are withheld.
 *
 * Separate from i18n.ts, and the separation is the point: this module answers
 * "is there more than one language?" without importing i18next. That question
 * has to be answerable cheaply, because the answer decides whether the i18next
 * runtime is worth loading at all — around 16 kB gzipped, which is a poor trade
 * on every page load when only one language is on offer.
 *
 * ── Why availability is gated at all ───────────────────────────────────────
 *
 * The Spanish translation shipped here covers twenty-nine keys, all of them
 * navigation and dashboard chrome: "Overview", "Appointments", "Save Changes".
 * None of the clinical text is in it. A patient who set the interface to Spanish
 * would have got Spanish navigation wrapped around English results, English risk
 * levels, and an English "this is a model output, not a diagnosis" banner.
 *
 * That is the failure this gate exists to prevent. Someone who sees an
 * application in their own language reasonably concludes it is in their
 * language, and the string that most needs to be understood would have been the
 * one still in English. Partial coverage in a medical interface is not a smaller
 * version of full coverage; it is a different and more dangerous thing.
 *
 * Two conditions, both required:
 *
 *   1. every SAFETY_CRITICAL key is present and non-empty, and
 *   2. a human who reads the language has signed the translation off.
 *
 * The second cannot be inferred from the first. A machine translation of "not a
 * diagnosis" can be present, complete, and wrong in a way only a speaker will
 * catch, so `clinicallyReviewed` is set by a person and never derived.
 */
import enTranslation from '../locales/en/translation.json';
import esTranslation from '../locales/es/translation.json';

/**
 * Keys a patient must not encounter in a language they did not choose.
 *
 * Everything here either states a limit of the system or tells someone what to
 * do about a result. A missing entry blocks the language outright.
 */
export const SAFETY_CRITICAL_KEYS = [
  'disclaimer.not_a_diagnosis',
  'disclaimer.screening_only',
  'disclaimer.clinician_review_required',
  'disclaimer.questionnaire_unvalidated',
  'result.model_flagged',
  'result.model_cleared',
  'result.confidence_is_not_accuracy',
  'result.awaiting_review',
  'action.contact_clinician',
] as const;

export interface LanguageManifest {
  code: string;
  /** Endonym: what speakers call it, not what English calls it. */
  label: string;
  resource: Record<string, unknown>;
  /**
   * Signed off by someone who reads the language AND understands the clinical
   * meaning. Never set from the presence of the strings themselves.
   */
  clinicallyReviewed: boolean;
  reviewedBy?: string;
  reviewedOn?: string;
  /** Where a translator starts. Repo-relative path to the blank worksheet. */
  worksheet?: string;
}

/**
 * ── The languages this deployment needs are the ones with no strings ───────
 *
 * isiZulu and Afrikaans are listed with an empty resource, on purpose. Until
 * they were, the coverage panel showed English offered and Spanish withheld,
 * and nothing about the two languages a South African deployment is actually
 * for — the gap was invisible precisely because nobody had started on it. An
 * entry with zero strings makes it a row that says "not started", with the
 * worksheet a translator would use, instead of an absence nobody sees.
 *
 * They are not machine-translated to fill the gap. The worksheets say why: a
 * blank keeps the language unavailable, which is the safe state, and a guess
 * at "this is not a diagnosis" does not.
 */
export const LANGUAGE_MANIFEST: LanguageManifest[] = [
  {
    code: 'en',
    label: 'English',
    resource: enTranslation,
    clinicallyReviewed: true,
    reviewedBy: 'source language',
  },
  {
    code: 'zu',
    label: 'isiZulu',
    resource: {},
    clinicallyReviewed: false,
    worksheet: 'docs/translation-worksheet-zu.md',
  },
  {
    code: 'af',
    label: 'Afrikaans',
    resource: {},
    clinicallyReviewed: false,
    worksheet: 'docs/translation-worksheet-af.md',
  },
  {
    // Not a target language for this deployment. Kept because the file exists
    // and the gate handles it correctly; listed after the languages that matter.
    code: 'es',
    label: 'Español',
    resource: esTranslation,
    // Deliberately false. The file covers navigation only; none of the clinical
    // strings are translated, and nobody who reads Spanish has checked it.
    // Setting this to true without doing that is the mistake the flag exists to
    // make visible.
    clinicallyReviewed: false,
  },
];

/** Reads a dotted key out of a nested resource object. */
export function lookup(resource: Record<string, unknown>, key: string): unknown {
  return key.split('.').reduce<any>((node, part) => (node == null ? node : node[part]), resource);
}

export function missingSafetyKeys(resource: Record<string, unknown>): string[] {
  return SAFETY_CRITICAL_KEYS.filter((key) => {
    const value = lookup(resource, key);
    return typeof value !== 'string' || value.trim() === '';
  });
}

export interface LanguageStatus {
  code: string;
  label: string;
  available: boolean;
  reason?: string;
  /** Non-empty strings present, against the English total. */
  coverage: { translated: number; total: number };
  worksheet?: string;
}

/** Dotted paths of every leaf string in a resource. */
function leafKeys(resource: Record<string, unknown>, prefix = ''): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(resource)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object') out.push(...leafKeys(v as Record<string, unknown>, key));
    else out.push(key);
  }
  return out;
}

const EN_KEYS = leafKeys(enTranslation as Record<string, unknown>);

function coverageOf(resource: Record<string, unknown>): { translated: number; total: number } {
  const translated = EN_KEYS.filter((key) => {
    const value = lookup(resource, key);
    return typeof value === 'string' && value.trim() !== '';
  }).length;
  return { translated, total: EN_KEYS.length };
}

/** Every known language and whether it may be offered, with the reason if not. */
export function languageStatuses(): LanguageStatus[] {
  return LANGUAGE_MANIFEST.map((entry) => {
    const coverage = coverageOf(entry.resource);
    const base = { code: entry.code, label: entry.label, coverage, worksheet: entry.worksheet };
    const missing = missingSafetyKeys(entry.resource);

    if (coverage.translated === 0) {
      // Distinct from "partly done": nothing exists yet, and the row should
      // say so rather than count nine untranslated strings as if work were
      // in progress.
      return { ...base, available: false, reason: 'not started: no strings translated' };
    }
    if (missing.length > 0) {
      return {
        ...base,
        available: false,
        reason: `${missing.length} safety-critical string(s) untranslated`,
      };
    }
    if (!entry.clinicallyReviewed) {
      return { ...base, available: false, reason: 'awaiting review by a clinical speaker' };
    }
    return { ...base, available: true };
  });
}

export const availableLanguages = (): LanguageStatus[] =>
  languageStatuses().filter((entry) => entry.available);

/**
 * Whether loading the i18next runtime is worth it.
 *
 * With one offered language every string resolves to the same value it would
 * have had as a literal, so the runtime buys nothing and costs a download.
 */
export const translationRuntimeNeeded = (): boolean => availableLanguages().length > 1;

export const LANGUAGE_STORAGE_KEY = 'healthai.language';
