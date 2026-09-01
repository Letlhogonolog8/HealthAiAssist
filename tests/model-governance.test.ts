/**
 * Binding published figures to the artifact they describe.
 *
 * MODEL_REGISTRY publishes sensitivity and specificity; nothing tied those
 * numbers to a file. Replace the .h5 and /api/models/cards keeps serving the
 * old figures about a model that is gone — the same defect as a hardcoded
 * accuracy figure, one level up: a real number silently reattached to the wrong
 * thing.
 *
 * These pin the two properties that make the binding worth having: that a
 * mismatch refuses to serve rather than warning, and that the strength of each
 * binding is published rather than implied.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

const TIMEOUT = 60_000;

describe('measurement bindings', { timeout: TIMEOUT }, () => {
  test('every registered modality has a binding', async () => {
    const { MODEL_REGISTRY } = await import('../server/model-availability.ts');
    const { MEASUREMENT_BINDINGS } = await import('../server/model-governance.ts');

    for (const modality of Object.keys(MODEL_REGISTRY)) {
      assert.ok(
        MEASUREMENT_BINDINGS[modality],
        `${modality} publishes figures with no recorded provenance`
      );
    }
  });

  test('a binding states how strongly it is held, and why', async () => {
    const { MEASUREMENT_BINDINGS } = await import('../server/model-governance.ts');

    for (const [modality, b] of Object.entries(MEASUREMENT_BINDINGS)) {
      assert.match(b.artifactFingerprint, /^[0-9a-f]{12}$/, `${modality} fingerprint`);
      assert.ok(
        ['re_measured', 'asserted_at_introduction'].includes(b.verification),
        `${modality} verification level`
      );
      // A governance record that cannot distinguish checked from assumed is
      // not a governance record.
      assert.ok(b.note && b.note.length > 20, `${modality} states no basis`);
    }
  });

  test('an inherited binding says so rather than implying measurement', async () => {
    const { MEASUREMENT_BINDINGS } = await import('../server/model-governance.ts');
    const lung = MEASUREMENT_BINDINGS.lung;

    // The lung test split is absent from this working copy, so the published
    // figures cannot be reproduced here. That has to be stated, not hidden
    // behind a binding that looks as strong as the skin one.
    assert.equal(lung.verification, 'asserted_at_introduction');
    assert.match(lung.note, /NOT re-measured/i);
  });

  test('the deployed artifacts match their bindings', async () => {
    const { allGovernanceStatuses } = await import('../server/model-governance.ts');
    const statuses = await allGovernanceStatuses();

    for (const s of statuses) {
      assert.equal(
        s.state,
        'matched',
        `${s.modality} is ${s.state}: ${s.explanation}`
      );
      assert.equal(s.mayServe, true);
    }
  });
});

describe('drift', { timeout: TIMEOUT }, () => {
  test('a modality whose artifact is not the measured one may not serve', async () => {
    const { MEASUREMENT_BINDINGS, governanceStatus } = await import(
      '../server/model-governance.ts'
    );

    const original = MEASUREMENT_BINDINGS.skin.artifactFingerprint;
    try {
      // Stand in for someone swapping the .h5 without re-measuring.
      MEASUREMENT_BINDINGS.skin.artifactFingerprint = 'deadbeef0000';

      const status = await governanceStatus('skin');
      assert.equal(status.state, 'drifted');
      // Refusing, not warning. An unmeasured model serving clinical triage is
      // the state MODEL_REGISTRY's own rule exists to prevent.
      assert.equal(status.mayServe, false);
      assert.match(status.explanation, /unmeasured/i);
      assert.match(status.explanation, /evaluate-model\.py/);
    } finally {
      MEASUREMENT_BINDINGS.skin.artifactFingerprint = original;
    }
  });

  test('a modality with no binding at all may not serve', async () => {
    const { governanceStatus } = await import('../server/model-governance.ts');
    const status = await governanceStatus('modality-that-does-not-exist');

    assert.equal(status.state, 'unbound');
    assert.equal(status.mayServe, false);
  });
});
