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
}

export const LANGUAGE_MANIFEST: LanguageManifest[] = [
  {
    code: 'en',
    label: 'English',
    resource: enTranslation,
    clinicallyReviewed: true,
    reviewedBy: 'source language',
  },
  {
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
}

/** Every known language and whether it may be offered, with the reason if not. */
export function languageStatuses(): LanguageStatus[] {
  return LANGUAGE_MANIFEST.map((entry) => {
    const missing = missingSafetyKeys(entry.resource);

    if (missing.length > 0) {
      return {
        code: entry.code,
        label: entry.label,
        available: false,
        reason: `${missing.length} safety-critical string(s) untranslated`,
      };
    }
    if (!entry.clinicallyReviewed) {
      return {
        code: entry.code,
        label: entry.label,
        available: false,
        reason: 'awaiting review by a clinical speaker',
      };
    }
    return { code: entry.code, label: entry.label, available: true };
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
