/**
 * The translation system, and whether anything actually uses it.
 *
 * ── The defect this exists to catch ────────────────────────────────────────
 *
 * The platform has a well-designed language gate: a language is offered only
 * when every safety-critical string is present AND a human who reads it has
 * signed it off. It has translation files, an i18next runtime loaded on demand,
 * a language switcher and a coverage panel.
 *
 * Not one component calls `useTranslation`. Every string in the interface is
 * hardcoded English. The entire system is inert.
 *
 * That is worse than having no translation system, because it looks like one.
 * Someone completing a translation file, seeing it pass the gate, and switching
 * the language would get an interface still entirely in English — and would
 * reasonably conclude the translation was broken rather than that nothing
 * consumes it.
 *
 * The gate protects against a *partially* translated interface. Nothing
 * protected against a *completely untranslated* one, which is the state the
 * application is actually in.
 *
 * These tests run without a server: they read the source tree.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const CLIENT_SRC = path.join(process.cwd(), 'client', 'src');
const LOCALES = path.join(CLIENT_SRC, 'locales');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

/** Files that consume translations, as opposed to configuring them. */
function filesConsumingTranslations(): string[] {
  const infrastructure = ['i18n.ts', 'language-availability.ts'];
  return walk(CLIENT_SRC).filter((file) => {
    if (infrastructure.some((name) => file.endsWith(name))) return false;
    const source = fs.readFileSync(file, 'utf8');
    return /useTranslation\s*\(|<Trans[\s>]|i18n\.t\s*\(/.test(source);
  });
}

function flatten(value: any, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, child] of Object.entries(value ?? {})) {
    const full = prefix ? `${prefix}.${key}` : key;
    if (child && typeof child === 'object') Object.assign(out, flatten(child, full));
    else out[full] = String(child);
  }
  return out;
}

function readLocale(code: string): Record<string, string> {
  return flatten(
    JSON.parse(fs.readFileSync(path.join(LOCALES, code, 'translation.json'), 'utf8'))
  );
}

const manifestSource = fs.readFileSync(
  path.join(CLIENT_SRC, 'lib', 'language-availability.ts'),
  'utf8'
);

/** Language codes the manifest marks as clinically reviewed. */
function reviewedLanguages(): string[] {
  const codes: string[] = [];
  const entry = /code:\s*'([a-z-]+)'[\s\S]*?clinicallyReviewed:\s*(true|false)/g;
  let match: RegExpExecArray | null;
  while ((match = entry.exec(manifestSource)) !== null) {
    if (match[2] === 'true') codes.push(match[1]);
  }
  return codes;
}

describe('translation wiring', () => {
  test('a reviewed language other than English requires components that consume translations', () => {
    const reviewed = reviewedLanguages().filter((code) => code !== 'en');
    if (reviewed.length === 0) return; // nothing claimed, nothing to check

    const consumers = filesConsumingTranslations();
    assert.ok(
      consumers.length > 0,
      `${reviewed.join(', ')} is marked clinicallyReviewed, but no component calls ` +
        'useTranslation — the interface is hardcoded English and switching language ' +
        'would change nothing. Wire the components before offering the language.'
    );
  });

  test('the current state is recorded honestly: nothing consumes translations yet', () => {
    const consumers = filesConsumingTranslations();

    // Deliberately asserted rather than left implicit. When somebody wires the
    // first component this test fails, and the failure message is the reminder
    // to update docs/TRANSLATION.md and the manifest — which is the moment that
    // reminder is useful.
    assert.equal(
      consumers.length,
      0,
      'A component now consumes translations. Update docs/TRANSLATION.md, which ' +
        'currently states that none do, and revisit whether a language can be ' +
        `offered. Consumers: ${consumers.map((f) => path.basename(f)).join(', ')}`
    );
  });
});

describe('translation files', () => {
  test('every safety-critical key exists in English and is non-empty', () => {
    const safetyKeys = [...manifestSource.matchAll(/'((?:disclaimer|result|action)\.[a-z_]+)'/g)].map(
      (m) => m[1]
    );
    assert.ok(safetyKeys.length >= 9, 'found the safety-critical key list');

    const en = readLocale('en');
    for (const key of safetyKeys) {
      assert.ok(en[key] && en[key].trim().length > 0, `en is missing ${key}`);
    }
  });

  test('no locale carries a key English does not have', () => {
    const en = new Set(Object.keys(readLocale('en')));
    for (const code of fs.readdirSync(LOCALES)) {
      if (code === 'en') continue;
      for (const key of Object.keys(readLocale(code))) {
        // An orphan key is a string that was removed from the source language
        // and left behind in a translation — it survives review because nobody
        // is looking at a key nothing renders.
        assert.ok(en.has(key), `${code} carries "${key}", which no longer exists in en`);
      }
    }
  });

  test('no key describes a capability the platform refuses to have', () => {
    // health_score is the specific one worth guarding. /api/patient/stats
    // returns healthScore: null with a note explaining that scoring a person's
    // health is a clinical act this platform has no business attempting. A
    // translation key for it is an invitation to put it back.
    const forbidden = ['health_score', 'blood_based_cancer_screening'];
    for (const code of fs.readdirSync(LOCALES)) {
      const keys = Object.keys(readLocale(code));
      for (const banned of forbidden) {
        assert.ok(
          !keys.includes(banned),
          `${code} carries "${banned}", which names something the platform deliberately does not do`
        );
      }
    }
  });
});
