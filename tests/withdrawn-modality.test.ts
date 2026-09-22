/**
 * A withdrawn modality: switched off in the registry, still described.
 *
 * The lung model was withdrawn on 2026-09-20 after it was found to accept real
 * chest CT — 84 of 87 LIDC-IDRI slices passed its out-of-distribution screen
 * and received verdicts — when it had no measured performance on CT at all.
 * MODEL_CARDS.md has the account.
 *
 * These pin what "withdrawn" has to mean, so that it cannot decay into either
 * of the two states it is easily mistaken for:
 *
 *   - not "no model": the artifact exists, its figures are real, and the
 *     public record must still say which artifact and why it was withdrawn;
 *   - not "serving": no request may reach it, whatever the fingerprint says.
 *
 * And one thing more: the withdrawal has to be backed by the measurement that
 * caused it. A registry entry that says "found to accept real CT" beside an
 * OOD report that says every requirement is met would be two records that
 * disagree with nobody watching — which is the defect this project keeps
 * finding in itself and keeps removing.
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { Session, startServer, stopServer } from './helpers/server.ts';

const TIMEOUT = 120_000;

const LUNG_OOD_REPORT = path.join(
  process.cwd(),
  'dataset',
  'lung_cancer_MRI_dataset',
  'lung_model_ood.json'
);

before(async () => {
  await startServer();
});

after(async () => {
  await stopServer();
});

describe('the model card', { timeout: TIMEOUT }, () => {
  test('lists the withdrawn modality with its reason, not as absent', async () => {
    const res = await new Session().get('/api/models/cards');
    assert.equal(res.status, 200);

    const lung = res.json.models.find((m: any) => m.scanType === 'lung');
    assert.ok(lung, 'a withdrawn modality is still on the card; only an unregistered one is absent');
    assert.equal(lung.enabled, false);
    assert.match(lung.disabledReason, /withdrawn/i);
    assert.match(lung.disabledReason, /2026-09-20/, 'the withdrawal is dated');
    assert.match(lung.disabledReason, /real chest CT|LIDC/i, 'the reason names what was measured');
    assert.match(lung.disabledReason, /queued for a radiologist/i, 'the reason says what happens instead');

    // The figures stay: they are true of the artifact on its own test set.
    // What changes is whether they describe anything that serves.
    assert.ok(lung.evaluation, 'the measured figures are not erased by a withdrawal');
    assert.equal(lung.figuresDescribeDeployedArtifact, false);
    assert.ok(lung.measurementBinding);
    assert.equal(lung.measurementBinding.state, 'withdrawn');
    assert.equal(lung.measurementBinding.mayServe, false);
    // A withdrawal is a decision about a specific file, and the record names it.
    assert.ok(lung.measurementBinding.measuredFingerprint, 'the measured artifact is named');
  });

  test('the caveats no longer claim the screen refuses real CT', async () => {
    const res = await new Session().get('/api/models/cards');
    const lung = res.json.models.find((m: any) => m.scanType === 'lung');
    const text = `${lung.evaluation?.caveats ?? ''} ${lung.disabledReason ?? ''}`;

    // The withdrawn claim, in the forms it took. Any of these coming back is
    // the model card drifting away from the measurement again.
    assert.doesNotMatch(text, /refuses every (clinical|real) acquisition/i);
    assert.doesNotMatch(text, /22\.9|22\.88|25\.04/, 'the CT_small figures are not evidence about CT');
  });
});

describe('the withdrawal is backed by the measurement on disk', { timeout: TIMEOUT }, () => {
  test('the OOD report records the real-CT domain as failed', async (t) => {
    if (!fs.existsSync(LUNG_OOD_REPORT)) return t.skip('dataset/ absent (gitignored)');
    const report = JSON.parse(fs.readFileSync(LUNG_OOD_REPORT, 'utf8'));

    assert.equal(report.meetsRequirements, false, 'the detector must not be recorded as meeting its bar');
    assert.ok(Array.isArray(report.failures) && report.failures.length > 0);
    assert.ok(
      report.failures.some((f: string) => /real CT/i.test(f)),
      `no failure names real CT: ${JSON.stringify(report.failures)}`
    );

    const realCt = report.validation.find(
      (v: any) => v.expect === 'refuse' && /real CT/i.test(v.label ?? '')
    );
    assert.ok(realCt, 'the real-CT domain must be in the report as a "refuse" domain');
    assert.equal(realCt.pass, false);
    // The number the registry quotes has to be the number in the report.
    assert.ok(realCt.flaggedRate < 0.1, `flagged ${realCt.flaggedRate}; the screen let real CT through`);
    assert.ok(realCt.n >= 80, `only ${realCt.n} slices measured`);
  });

  test('the two records agree on what was measured', async (t) => {
    if (!fs.existsSync(LUNG_OOD_REPORT)) return t.skip('dataset/ absent (gitignored)');
    const report = JSON.parse(fs.readFileSync(LUNG_OOD_REPORT, 'utf8'));
    const realCt = report.validation.find(
      (v: any) => v.expect === 'refuse' && /real CT/i.test(v.label ?? '')
    );

    const { MODEL_REGISTRY } = await import('../server/model-availability.ts');
    const reason = MODEL_REGISTRY.lung.disabledReason ?? '';

    // "84 of 87" in the reason; n and flaggedRate in the report.
    const quoted = reason.match(/(\d+) of (\d+) LIDC-IDRI slices/);
    assert.ok(quoted, 'the reason quotes a count from the measurement');
    const [, passedStr, nStr] = quoted;
    assert.equal(Number(nStr), realCt.n);
    assert.equal(Number(passedStr), Math.round(realCt.n * (1 - realCt.flaggedRate)));

    const median = reason.match(/median ([\d.]+) against a ([\d.]+) threshold/);
    assert.ok(median, 'the reason quotes the median and threshold');
    assert.equal(Number(median[1]), Number(realCt.medianError.toFixed(2)));
    assert.equal(Number(median[2]), Number(report.threshold.toFixed(2)));
  });
});
