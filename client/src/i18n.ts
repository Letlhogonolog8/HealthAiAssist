/**
 * The i18next runtime.
 *
 * Loaded on demand, not at startup. Whether it is worth loading is decided by
 * lib/language-availability.ts, which answers that question without importing
 * anything from i18next — so a deployment offering one language never downloads
 * the roughly 16 kB gzipped of machinery that would resolve every string to the
 * value it already had.
 *
 * The gate that decides which languages may be offered, and the reasoning behind
 * it, lives in that module. This file only configures the runtime once the
 * decision has been made.
 */
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import {
  LANGUAGE_MANIFEST,
  LANGUAGE_STORAGE_KEY,
  availableLanguages,
  lookup,
} from './lib/language-availability';

import enTranslation from './locales/en/translation.json';

/** The stored preference, if it is still an offered language. */
function preferredLanguage(): string {
  try {
    const stored = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (stored && availableLanguages().some((l) => l.code === stored)) return stored;
  } catch {
    /* storage unavailable (private mode, embedded webview) */
  }

  // The browser's preference, but only if that language is actually offered.
  // Falling back to a partially translated match is exactly the failure the gate
  // exists to prevent.
  const browser = typeof navigator !== 'undefined' ? navigator.language?.split('-')[0] : undefined;
  if (browser && availableLanguages().some((l) => l.code === browser)) return browser;

  return 'en';
}

export function setLanguage(code: string): void {
  if (!availableLanguages().some((l) => l.code === code)) {
    console.warn(`Refusing to switch to "${code}": not an offered language.`);
    return;
  }
  try {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, code);
  } catch {
    /* preference is not persisted; the switch still applies for this session */
  }
  void i18n.changeLanguage(code);
}

// Only offered languages become resources. An unreviewed translation loaded into
// i18next is one changeLanguage() call away from reaching a patient.
const offered = availableLanguages().map((l) => l.code);
const resources = Object.fromEntries(
  LANGUAGE_MANIFEST.filter((entry) => offered.includes(entry.code)).map((entry) => [
    entry.code,
    { translation: entry.resource },
  ])
);

i18n.use(initReactI18next).init({
  resources,
  lng: preferredLanguage(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  // A missing key is loud in development and falls back to English in
  // production, rather than showing a patient a raw identifier.
  parseMissingKeyHandler: (key: string) =>
    import.meta.env.DEV ? `⟨${key}⟩` : ((lookup(enTranslation, key) as string) ?? key),
});

export default i18n;
