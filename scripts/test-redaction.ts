/**
 * Tests for the outbound redaction used before any cross-border transfer.
 *
 *   npm run test:redaction
 */
import assert from 'node:assert/strict';
import { redact, redactMessages } from '../server/privacy/redaction';

let passed = 0;
const failures: string[] = [];

function test(name: string, fn: () => void) {
  try { fn(); passed++; }
  catch (e) { failures.push(`${name}\n    ${e instanceof Error ? e.message : String(e)}`); }
}

test('removes a South African ID number', () => {
  const r = redact('My ID is 8001015009087 please help');
  assert.ok(!r.text.includes('8001015009087'), r.text);
  assert.ok(r.removed.includes('sa_id_number'));
});

test('removes a spaced ID number', () => {
  const r = redact('ID 800101 5009 087');
  assert.ok(!/800101/.test(r.text), r.text);
});

test('removes email addresses', () => {
  const r = redact('contact me on thabo.mokoena@example.co.za');
  assert.ok(!r.text.includes('@example.co.za'), r.text);
  assert.ok(r.removed.includes('email'));
});

test('removes SA phone numbers in both forms', () => {
  for (const number of ['0821234567', '+27 82 123 4567', '082 123 4567']) {
    const r = redact(`call me on ${number}`);
    assert.ok(!/\d{4}/.test(r.text), `${number} -> ${r.text}`);
  }
});

test('removes dates of birth', () => {
  const r = redact('born 01/01/1980');
  assert.ok(!r.text.includes('1980'), r.text);
  assert.ok(r.removed.includes('date_of_birth'));
});

test('removes labelled record numbers', () => {
  const r = redact('MRN: AB12345 needs review');
  assert.ok(!r.text.includes('AB12345'), r.text);
});

test('leaves ordinary clinical text untouched', () => {
  const original = 'I have a mole on my left arm that changed colour over 3 weeks.';
  const r = redact(original);
  assert.equal(r.text, original);
  assert.equal(r.removed.length, 0);
});

test('does not mangle small numbers that carry meaning', () => {
  const r = redact('the lesion is about 6mm and I am 47');
  assert.ok(r.text.includes('6mm'), r.text);
  assert.ok(r.text.includes('47'), r.text);
});

test('handles several identifiers in one message', () => {
  const r = redact('I am 8001015009087, call 0821234567 or mail a@b.co');
  assert.ok(!r.text.includes('8001015009087'));
  assert.ok(!r.text.includes('0821234567'));
  assert.ok(!r.text.includes('a@b.co'));
  assert.ok(r.removed.length >= 3);
});

test('redacts across a conversation and reports the union', () => {
  const { messages, removed } = redactMessages([
    { role: 'user', content: 'my id is 8001015009087' },
    { role: 'assistant', content: 'thanks' },
    { role: 'user', content: 'email me at x@y.co' },
  ]);
  assert.ok(!messages[0].content.includes('8001015009087'));
  assert.ok(!messages[2].content.includes('x@y.co'));
  assert.ok(removed.includes('sa_id_number') && removed.includes('email'));
});

test('is stable across repeated calls (no regex lastIndex leakage)', () => {
  // Global regexes held at module scope will skip matches if lastIndex is not
  // reset between calls. Same input must give the same result every time.
  const input = 'id 8001015009087 and mail a@b.co';
  const first = redact(input).text;
  for (let i = 0; i < 5; i++) {
    assert.equal(redact(input).text, first, `differed on call ${i + 2}`);
  }
});

test('empty input is safe', () => {
  assert.deepEqual(redact(''), { text: '', removed: [] });
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.error('\nFAILURES:');
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
