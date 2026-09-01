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

const TIMEOUT = 60_000;

describe('stratified skin-tone performance', { timeout: TIMEOUT }, () => {
  test('the measurement describes the deployed artifact', async () => {
    const { fairnessStatus } = await import('../server/fairness.ts');
    const status = await fairnessStatus('skin');

    assert.equal(status.state, 'current', status.headline);
    assert.equal(status.measuredFingerprint, status.deployedFingerprint);
  });

  test('bins too small to act on are marked unreliable', async () => {
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

  test('every bin carries its counts and interval, not a bare rate', async () => {
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

  test('the headline says the dataset cannot answer, not that the model is fair', async () => {
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

  test('a measurement taken on a different artifact is marked stale, not served as current', async () => {
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
