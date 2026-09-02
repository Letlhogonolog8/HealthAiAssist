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
import fs from 'node:fs';
import path from 'node:path';

const TIMEOUT = 60_000;

/**
 * The model artifacts are gitignored, so CI runs without them.
 *
 * The binding assertions below are about the *shape* of the governance record
 * and hold everywhere; the ones that compare a recorded fingerprint against a
 * deployed file need the file. Those skip rather than fail, because "the
 * artifact is absent" is a property of the checkout, not a governance defect —
 * and a test that fails in CI for that reason gets deleted.
 */
const ARTIFACTS_PRESENT = fs.existsSync(
  path.join(process.cwd(), 'dataset', 'data', 'resnet50v2_skin_cancer_model.h5')
);

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

    // Written as an invariant rather than pinned to a modality, because both
    // are now `re_measured` and a test asserting otherwise would have to be
    // deleted the next time one is verified — which is the moment a weaker
    // binding could slip in unnoticed.
    for (const [modality, b] of Object.entries(MEASUREMENT_BINDINGS)) {
      if (b.verification === 'asserted_at_introduction') {
        assert.match(
          b.note,
          /NOT re-measured/i,
          `${modality} inherited its figures without saying so`
        );
      }
    }
  });

  test('a re-measured binding names how it was reproduced', async () => {
    const { MEASUREMENT_BINDINGS } = await import('../server/model-governance.ts');

    // "Re-measured" is the strongest claim this record makes. It has to point
    // at the thing that did the measuring, or it is just a different word for
    // asserted.
    for (const [modality, b] of Object.entries(MEASUREMENT_BINDINGS)) {
      if (b.verification === 're_measured') {
        assert.match(
          b.note,
          /scripts\/[\w-]+\.(py|ts)|evaluate-model\.py/,
          `${modality} claims re-measurement without naming the script`
        );
      }
    }
  });

  test('the deployed artifacts match their bindings', async (t) => {
    if (!ARTIFACTS_PRESENT) return t.skip('model artifacts absent (gitignored)');
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
  test('a modality whose artifact is not the measured one may not serve', async (t) => {
    if (!ARTIFACTS_PRESENT) return t.skip('model artifacts absent (gitignored)');
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
