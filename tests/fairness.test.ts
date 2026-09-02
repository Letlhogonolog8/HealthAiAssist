/**
 * Subgroup performance, published rather than summarised.
 *
 * The measurement existed and had been run; the result sat in a JSON file that
 * nothing served, and the only trace in the API was one sentence of prose in
 * the model card caveats. A reader saw "cannot establish performance on darker
 * skin" as an assertion with no counts and no intervals behind it, which is
 * indistinguishable from a disclaimer written to be safe.
 *
 * What these pin is the part most likely to be lost in transit: that a bin with
 * four images and no benign controls is marked unreliable, and that its
 * sensitivity of 1.0 is never presented as the model working on dark skin.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { TEST_DATABASE_URL } from './helpers/server.ts';

/**
 * server/db.ts reads DATABASE_URL at import time, and in a bare tsx run that is
 * whatever the OS environment holds — which on this machine is a stale value
 * that shadows .env. The spawned server loads .env itself, so this only affects
 * tests that touch the database in-process. Set before any dynamic import of a
 * module that reaches for the pool.
 */
process.env.DATABASE_URL = TEST_DATABASE_URL;

const TIMEOUT = 60_000;

/**
 * dataset/ is gitignored, so CI has neither the model artifact nor the
 * measurement JSON. Tests that read the measured numbers skip there; the ones
 * about how an *absent* or *stale* measurement is reported still run, and those
 * are the ones that protect the reader from mistaking silence for a pass.
 */
const MEASUREMENT_PRESENT = (await import('node:fs')).existsSync(
  (await import('node:path')).join(process.cwd(), 'dataset', 'data', 'skin_tone_performance.json')
);

describe('stratified skin-tone performance', { timeout: TIMEOUT }, () => {
  test('the measurement describes the deployed artifact', async (t) => {
    if (!MEASUREMENT_PRESENT) return t.skip('skin tone measurement absent (gitignored)');
    const { fairnessStatus } = await import('../server/fairness.ts');
    const status = await fairnessStatus('skin');

    assert.equal(status.state, 'current', status.headline);
    assert.equal(status.measuredFingerprint, status.deployedFingerprint);
  });

  test('bins too small to act on are marked unreliable', async (t) => {
    if (!MEASUREMENT_PRESENT) return t.skip('skin tone measurement absent (gitignored)');
    const { fairnessStatus } = await import('../server/fairness.ts');
    const { report } = await fairnessStatus('skin');
    assert.ok(report);

    // Four images, all malignant, no benign controls. It yields a sensitivity
    // of 1.0, and that number without its n reads as the model working
    // perfectly on dark skin — the opposite of what the data supports.
    const dark = report!.bins.dark;
    assert.equal(dark.reliable, false, 'the dark bin cannot be reliable at n=4');
    assert.equal(dark.nBenign, 0);
    assert.equal(dark.specificity, null, 'no benign controls means no specificity');

    // Only the two lightest bins carry enough data.
    assert.deepEqual(report!.binsConsideredReliable, ['light', 'very_light']);
  });

  test('every bin carries its counts and interval, not a bare rate', async (t) => {
    if (!MEASUREMENT_PRESENT) return t.skip('skin tone measurement absent (gitignored)');
    const { fairnessStatus } = await import('../server/fairness.ts');
    const { report } = await fairnessStatus('skin');

    for (const [name, bin] of Object.entries(report!.bins)) {
      assert.ok(typeof bin.n === 'number', `${name} has no n`);
      assert.ok(typeof bin.nMalignant === 'number', `${name} has no malignant count`);
      if (bin.sensitivity !== null) {
        assert.ok(
          Array.isArray(bin.sensitivityCI),
          `${name} reports a sensitivity with no interval`
        );
      }
    }
  });

  test('the headline says the dataset cannot answer, not that the model is fair', async (t) => {
    if (!MEASUREMENT_PRESENT) return t.skip('skin tone measurement absent (gitignored)');
    const { fairnessStatus } = await import('../server/fairness.ts');
    const { headline } = await fairnessStatus('skin');

    assert.match(headline, /CANNOT establish performance on darker skin/i);
    // The inference a reader would otherwise draw from an absent disparity.
    assert.match(headline, /not of fairness/i);
  });

  test('a modality with no measurement says unknown, not equal', async () => {
    const { fairnessStatus } = await import('../server/fairness.ts');
    const status = await fairnessStatus('lung');

    assert.equal(status.state, 'absent');
    assert.equal(status.report, null);
    // "Unrecorded" and "no disparity" are different claims.
    assert.match(status.headline, /unknown rather than equal/i);
  });

  test('a measurement taken on a different artifact is marked stale, not served as current', async (t) => {
    if (!MEASUREMENT_PRESENT) return t.skip('skin tone measurement absent (gitignored)');
    const fairness = await import('../server/fairness.ts');
    const original = await fairness.fairnessStatus('skin');
    assert.equal(original.state, 'current');

    // Simulate the model being retrained without the fairness measurement
    // being re-run — the exact sequence that left the old report claiming to
    // describe an artifact that no longer existed.
    const fs = await import('fs/promises');
    const path = await import('path');
    const reportPath = path.join(process.cwd(), 'dataset', 'data', 'skin_tone_performance.json');
    const raw = await fs.readFile(reportPath, 'utf8');

    try {
      const doctored = JSON.parse(raw);
      doctored.artifactFingerprint = 'deadbeef0000';
      await fs.writeFile(reportPath, JSON.stringify(doctored, null, 2));

      const stale = await fairness.fairnessStatus('skin');
      assert.equal(stale.state, 'stale');
      assert.match(stale.headline, /does not describe the model currently serving/i);
      assert.match(stale.headline, /measure-skin-tone-performance/);
    } finally {
      await fs.writeFile(reportPath, raw);
    }
  });
});

describe('skin-tone estimation', { timeout: TIMEOUT }, () => {
  test('agrees with the Python reference on real images', async () => {
    // The port is checked exhaustively by scripts/verify-skin-tone-port.ts,
    // which needs the dataset. This is the always-runnable half: a handful of
    // real images, asserted against the reference dump when it is present.
    const fs = await import('fs/promises');
    const path = await import('path');
    const refPath = path.join(process.cwd(), 'dataset', 'data', 'ita_reference.json');

    let reference: Record<string, { ita: number | null; bin: string | null }>;
    try {
      reference = JSON.parse(await fs.readFile(refPath, 'utf8'));
    } catch {
      return; // dataset absent; the dedicated script covers this
    }

    const { estimateSkinTone } = await import('../server/skin-tone.ts');
    const keys = Object.keys(reference).slice(0, 25);
    let checked = 0;

    for (const key of keys) {
      const imagePath = path.join(process.cwd(), 'dataset', 'dataset', 'data', 'test', key);
      let buf: Buffer;
      try {
        buf = await fs.readFile(imagePath);
      } catch {
        continue;
      }
      const got = await estimateSkinTone(buf);
      const exp = reference[key];

      // Refusals must agree too: a port that estimates where the reference
      // refuses is inventing a tone.
      assert.equal(got === null, exp.ita === null, `${key} refusal disagreement`);
      if (got && exp.ita !== null) {
        assert.equal(got.bin, exp.bin, `${key} bin disagreement`);
        assert.ok(Math.abs(got.ita - exp.ita) < 0.05, `${key} angle drift`);
      }
      checked++;
    }
    assert.ok(checked > 0, 'no images were actually compared');
  });

  test('refuses rather than guessing on an image with no skin', async () => {
    const sharp = (await import('sharp')).default;
    const { estimateSkinTone } = await import('../server/skin-tone.ts');

    // Flat mid-grey: b* is ~0, so the arctan would flip sign and produce a
    // plausible-looking but meaningless angle.
    const grey = await sharp({
      create: { width: 300, height: 300, channels: 3, background: { r: 128, g: 128, b: 128 } },
    }).png().toBuffer();

    assert.equal(await estimateSkinTone(grey), null);
  });

  test('bins order darkest to lightest', async () => {
    const { toneBin } = await import('../server/skin-tone.ts');
    assert.equal(toneBin(-45), 'dark');
    assert.equal(toneBin(-10), 'brown');
    assert.equal(toneBin(20), 'tan');
    assert.equal(toneBin(35), 'intermediate');
    assert.equal(toneBin(50), 'light');
    assert.equal(toneBin(70), 'very_light');
    // Edges are `low < ita <= high`, matching the reference.
    assert.equal(toneBin(-30), 'dark');
    assert.equal(toneBin(55), 'light');
  });
});

describe('production stratification', { timeout: TIMEOUT }, () => {
  test('reports an honest not-yet rather than an empty pass', async () => {
    const { productionFairness } = await import('../server/fairness.ts');
    const result = await productionFairness('skin');

    assert.ok(Array.isArray(result.strata));
    // With too few adjudicated outcomes the spread must be null, never 0 — a
    // zero spread reads as "no disparity found".
    if (result.binsWithEnoughData.length < 2) {
      assert.equal(result.sensitivitySpread, null);
      assert.match(result.note, /unanswered here/i);
      assert.match(result.note, /not that no disparity exists/i);
    }
  });
});
