/**
 * Generates a worksheet for a translator and clinical reviewer.
 *
 * Run:  npx tsx scripts/translation-worksheet.ts zu > worksheet-zu.md
 *
 * The point is that a reviewer should not have to read the codebase to know
 * what a string means or how much it matters. Each entry carries the English
 * source, whether it is safety-critical, and — for the safety-critical ones —
 * what the sentence has to accomplish, which is frequently not obvious from the
 * words alone.
 */
import fs from 'node:fs';
import path from 'node:path';

const CODE = process.argv[2];
if (!CODE) {
  console.error('usage: tsx scripts/translation-worksheet.ts <language-code>');
  process.exit(1);
}

const LOCALES = path.join(process.cwd(), 'client', 'src', 'locales');
const en = JSON.parse(fs.readFileSync(path.join(LOCALES, 'en', 'translation.json'), 'utf8'));

const manifest = fs.readFileSync(
  path.join(process.cwd(), 'client', 'src', 'lib', 'language-availability.ts'),
  'utf8'
);
const SAFETY = new Set(
  [...manifest.matchAll(/'((?:disclaimer|result|action)\.[a-z_]+)'/g)].map((m) => m[1])
);

/**
 * What each safety-critical sentence has to achieve.
 *
 * Written for someone deciding whether a translation is correct, not for
 * someone deciding whether it is fluent. A fluent translation that softens
 * "not a diagnosis" into "not a final diagnosis" has changed the meaning in the
 * direction that matters.
 */
const INTENT: Record<string, string> = {
  'disclaimer.not_a_diagnosis':
    'Must be unambiguous that NO diagnosis has been made. Not "preliminary", not ' +
    '"initial", not "not yet confirmed" — those all imply a diagnosis exists in ' +
    'draft. The model produced a number; nobody has diagnosed anything.',
  'disclaimer.screening_only':
    'Screening means deciding who to look at more closely. It does not mean a ' +
    'light examination or a first-pass diagnosis. If the target language has a ' +
    'word used for population screening programmes, that is the one.',
  'disclaimer.clinician_review_required':
    'A qualified person reviews EVERY result before it means anything. Must not ' +
    'read as optional, advisable, or "you may wish to".',
  'disclaimer.questionnaire_unvalidated':
    'The questionnaire checks published criteria; it does not estimate the ' +
    'reader\'s chance of having cancer. Must not read as a risk score.',
  'result.model_flagged':
    'The model marked this for a human to look at. It did NOT find cancer. The ' +
    'distinction is the single most important one in the interface — a person ' +
    'reading this may believe they have been told they have cancer.',
  'result.model_cleared':
    'The model did not mark it. This is NOT an all-clear and must not read as ' +
    'reassurance. Roughly 1 in 5 lung cancers and 1 in 30 melanomas are missed.',
  'result.confidence_is_not_accuracy':
    'Confidence is how sure the model was about one image. Accuracy is how often ' +
    'it is right across many. A 99% confident wrong answer is ordinary.',
  'result.awaiting_review':
    'Nothing has been decided yet. Neutral — must not imply good or bad news.',
  'action.contact_clinician':
    'A direct instruction to speak to a person. Should feel like the next step, ' +
    'not a legal footer.',
};

function flatten(value: any, prefix = ''): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const [key, child] of Object.entries(value ?? {})) {
    const full = prefix ? `${prefix}.${key}` : key;
    if (child && typeof child === 'object') out.push(...flatten(child, full));
    else out.push([full, String(child)]);
  }
  return out;
}

const entries = flatten(en);
const safety = entries.filter(([k]) => SAFETY.has(k));
const chrome = entries.filter(([k]) => !SAFETY.has(k));

const lines: string[] = [];
lines.push(`# Translation worksheet — \`${CODE}\``);
lines.push('');
lines.push(`Generated from \`client/src/locales/en/translation.json\`.`);
lines.push(`${entries.length} strings: ${safety.length} safety-critical, ${chrome.length} interface chrome.`);
lines.push('');
lines.push('Fill the **Translation** column. Leave anything you are unsure about blank —');
lines.push('a blank string keeps the language unavailable, which is the safe state. A');
lines.push('guess does not.');
lines.push('');
lines.push('---');
lines.push('');
lines.push('## Part 1 — Safety-critical');
lines.push('');
lines.push('These decide whether the language may be offered at all. If any is blank or');
lines.push('untranslated, the language stays off. Each carries a note on what the sentence');
lines.push('has to accomplish — please translate the **intent**, not the words.');
lines.push('');

for (const [key, value] of safety) {
  lines.push(`### \`${key}\``);
  lines.push('');
  lines.push(`**English:** ${value}`);
  lines.push('');
  if (INTENT[key]) {
    lines.push(`**Must convey:** ${INTENT[key]}`);
    lines.push('');
  }
  lines.push('**Translation:**');
  lines.push('');
  lines.push('> ');
  lines.push('');
}

lines.push('---');
lines.push('');
lines.push('## Part 2 — Interface chrome');
lines.push('');
lines.push('Navigation, buttons and headings. Lower consequence, still needed for the');
lines.push('interface to be usable.');
lines.push('');
lines.push('| Key | English | Translation |');
lines.push('|---|---|---|');
for (const [key, value] of chrome) {
  lines.push(`| \`${key}\` | ${value.replace(/\|/g, '\|')} | |`);
}

lines.push('');
lines.push('---');
lines.push('');
lines.push('## Sign-off');
lines.push('');
lines.push('Required before the language can be offered. Both, not either.');
lines.push('');
lines.push('- [ ] I am a fluent speaker of this language.');
lines.push('- [ ] I have read what each safety-critical string must convey, and my');
lines.push('      translations convey it — not merely a fluent rendering of the English.');
lines.push('- [ ] Where I was unsure, I left it blank rather than guessing.');
lines.push('');
lines.push('Name: ______________________  Qualification: ______________________');
lines.push('');
lines.push('Date: ______________________');

console.log(lines.join('\n'));
