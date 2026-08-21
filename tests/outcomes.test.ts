/**
 * Adjudicated outcomes, and the production performance they make measurable.
 *
 * Before `scan_outcomes` existed, every endpoint asked how well the models
 * perform on real patients correctly answered null — the comparison had no
 * second operand. These tests pin the properties that keep the answer honest
 * once there is one:
 *
 *   - the model's call is recorded as a boolean when it is made, not recovered
 *     later by pattern-matching the prose in `result`;
 *   - only clinical staff may adjudicate, and only into the fixed vocabularies;
 *   - the table is append-only, so a revised diagnosis is distinguishable from
 *     one that was always this;
 *   - a rate is never reported without its denominator and interval, and a
 *     sample too small to act on says so.
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  Session,
  TEST_USER_PREFIX,
  db,
  registerPatient,
  startServer,
  stopServer,
} from './helpers/server.ts';

import { summarise, wilsonInterval } from '../server/production-performance.ts';

const TIMEOUT = 120_000;

/**
 * A real chest image from the held-out lung set.
 *
 * The suite needs a scan the model will actually flag, and the only honest way
 * to get one is to run the model. Skipped rather than faked when the dataset is
 * absent, because inventing a prediction inside the tests that guard against
 * invented predictions would be self-defeating.
 */
const LUNG_DIR = 'dataset/dataset/lung_cancer_MRI_dataset/validate/cancer';
const lungImages = fs.existsSync(LUNG_DIR) ? fs.readdirSync(LUNG_DIR).slice(0, 2) : [];
const haveImages = lungImages.length >= 2;

let patient: Awaited<ReturnType<typeof registerPatient>>;
let stranger: Awaited<ReturnType<typeof registerPatient>>;
let radiologist: Awaited<ReturnType<typeof registerPatient>>;
let radSession: Session;
const scanIds: number[] = [];

async function analyse(session: Session, file: string): Promise<number> {
  const form = new FormData();
  const bytes = fs.readFileSync(`${LUNG_DIR}/${file}`);
  form.append('image', new Blob([bytes], { type: 'image/jpeg' }), file);
  form.append('scanType', 'lung');

  const res = await session.postForm('/api/scans/analyze', form);
  assert.equal(res.status, 200, res.text.slice(0, 200));
  return res.json.scan.id;
}

before(async () => {
  await startServer();

  patient = await registerPatient('outcome-patient');
  stranger = await registerPatient('outcome-stranger');
  radiologist = await registerPatient('outcome-rad');

  const pool = db();
  try {
    await pool.query('UPDATE users SET role = $1 WHERE id = $2', ['radiologist', radiologist.id]);
  } finally {
    await pool.end();
  }

  radSession = new Session();
  const login = await radSession.post('/api/auth/login', {
    username: radiologist.username,
    password: 'Passw0rd!23',
  });
  assert.equal(login.status, 200);

  if (haveImages) {
    for (const file of lungImages) scanIds.push(await analyse(patient.session, file));
  }
});

after(async () => {
  const pool = db();
  try {
    const stale = await pool.query('SELECT id FROM users WHERE left(username, $2) = $1', [
      TEST_USER_PREFIX,
      TEST_USER_PREFIX.length,
    ]);
    const ids = stale.rows.map((r: any) => r.id);
    if (ids.length) {
      await pool.query(
        `DELETE FROM scan_outcomes
          WHERE recorded_by = ANY($1)
             OR scan_id IN (SELECT id FROM medical_scans WHERE patient_id = ANY($1))`,
        [ids]
      );
      await pool.query('DELETE FROM medical_scans WHERE patient_id = ANY($1)', [ids]);
      await pool.query(
        'DELETE FROM notifications WHERE recipient_id = ANY($1) OR actor_id = ANY($1)',
        [ids]
      );
      await pool.query('DELETE FROM appointments WHERE patient_id = ANY($1) OR doctor_id = ANY($1)', [ids]);
      await pool.query(
        'DELETE FROM chat_messages WHERE sender_id = ANY($1) OR receiver_id = ANY($1)',
        [ids]
      );
      await pool.query('UPDATE audit_events SET actor_user_id = NULL WHERE actor_user_id = ANY($1)', [ids]);
      await pool.query('DELETE FROM users WHERE id = ANY($1)', [ids]);
    }
  } finally {
    await pool.end();
  }
  await stopServer();
});

// ---------------------------------------------------------------------------

describe('interval arithmetic', { timeout: TIMEOUT }, () => {
  test('Wilson keeps a sensible width at the boundaries', () => {
    // The normal approximation gives ±0 here, which is the failure this choice
    // exists to avoid: four for four is not certainty.
    const perfect = wilsonInterval(4, 4)!;
    assert.ok(perfect.low > 0.4 && perfect.low < 0.6, `low was ${perfect.low}`);
    assert.equal(perfect.high, 1);

    const none = wilsonInterval(0, 4)!;
    assert.equal(none.low, 0);
    assert.ok(none.high > 0.4, `high was ${none.high}`);
  });

  test('a rate stays inside [0, 1] and is null with no denominator', () => {
    const wide = wilsonInterval(1, 3)!;
    assert.ok(wide.low >= 0 && wide.high <= 1);
    assert.equal(wilsonInterval(0, 0), null);
  });

  test('a small sample is reported as insufficient rather than rounded up', () => {
    const summary = summarise({
      scanType: 'lung',
      truePositives: 3, falsePositives: 1, trueNegatives: 4, falseNegatives: 1,
      indeterminate: 0, unadjudicated: 12,
    });
    assert.equal(summary.sufficientForInference, false);
    assert.ok(summary.note.includes('Too few'), summary.note);
    // The estimate is still there, with its denominator attached.
    assert.equal(summary.sensitivity.denominator, 4);
    assert.ok(summary.sensitivity.interval);
  });

  test('an absent denominator yields null, never zero', () => {
    const summary = summarise({
      scanType: 'skin',
      truePositives: 0, falsePositives: 0, trueNegatives: 0, falseNegatives: 0,
      indeterminate: 0, unadjudicated: 0,
    });
    assert.equal(summary.sensitivity.value, null);
    assert.equal(summary.balancedAccuracy, null);
  });
});

describe('recording an outcome', { timeout: TIMEOUT, skip: !haveImages && 'no lung dataset on disk' }, () => {
  test('the model call is stored as a boolean at analysis time', async () => {
    const pool = db();
    try {
      const { rows } = await pool.query(
        'SELECT predicted_positive FROM medical_scans WHERE id = ANY($1)',
        [scanIds]
      );
      assert.equal(rows.length, scanIds.length);
      assert.ok(
        rows.every((r: any) => r.predicted_positive !== null),
        'predicted_positive must not be inferred from the result string later'
      );
    } finally {
      await pool.end();
    }
  });

  test('a patient cannot adjudicate their own scan', async () => {
    const res = await patient.session.post(`/api/scans/${scanIds[0]}/outcome`, {
      outcome: 'benign',
      method: 'histopathology',
    });
    assert.equal(res.status, 403);
  });

  test('outcome and method are constrained to the declared vocabularies', async () => {
    const badOutcome = await radSession.post(`/api/scans/${scanIds[0]}/outcome`, {
      outcome: 'probably fine',
      method: 'histopathology',
    });
    assert.equal(badOutcome.status, 400);
    assert.ok(Array.isArray(badOutcome.json.allowed));

    const badMethod = await radSession.post(`/api/scans/${scanIds[0]}/outcome`, {
      outcome: 'malignant',
      method: 'i had a hunch',
    });
    assert.equal(badMethod.status, 400);
  });

  test('a clinician can record one, and is told whether the model was right', async () => {
    const res = await radSession.post(`/api/scans/${scanIds[0]}/outcome`, {
      outcome: 'malignant',
      method: 'histopathology',
      notes: 'Confirmed on resection.',
    });
    assert.equal(res.status, 201, res.text.slice(0, 200));
    assert.equal(typeof res.json.modelWasCorrect, 'boolean');
  });

  test('a revision appends rather than overwrites', async () => {
    await radSession.post(`/api/scans/${scanIds[1]}/outcome`, {
      outcome: 'benign',
      method: 'biopsy',
      notes: 'Granuloma.',
    });
    await radSession.post(`/api/scans/${scanIds[1]}/outcome`, {
      outcome: 'malignant',
      method: 'histopathology',
      notes: 'Resection contradicted the biopsy.',
    });

    const res = await radSession.get(`/api/scans/${scanIds[1]}/outcome`);
    assert.equal(res.json.current.outcome, 'malignant', 'newest row wins');
    assert.equal(res.json.history.length, 2, 'the superseded adjudication is retained');
  });

  test('a patient sees where it stands, not the deliberation', async () => {
    const res = await patient.session.get(`/api/scans/${scanIds[1]}/outcome`);
    assert.equal(res.status, 200);
    assert.equal(res.json.current.outcome, 'malignant');
    assert.equal(res.json.history.length, 0);
  });

  test('another patient sees nothing at all', async () => {
    const res = await stranger.session.get(`/api/scans/${scanIds[0]}/outcome`);
    assert.equal(res.status, 403);
  });
});

describe('production performance', { timeout: TIMEOUT, skip: !haveImages && 'no lung dataset on disk' }, () => {
  test('the matrix is built from adjudicated scans', async () => {
    const res = await radSession.get('/api/models/performance');
    assert.equal(res.status, 200);

    const lung = res.json.models.find((m: any) => m.scanType === 'lung');
    assert.ok(lung, 'lung should appear once it has predictions');
    assert.equal(lung.adjudicated, 2);
    assert.ok(lung.sensitivity.denominator > 0);
    assert.ok(lung.sensitivity.interval, 'a rate must carry its interval');
    assert.equal(lung.sufficientForInference, false, 'two scans is not a sample');
  });

  test('restricting the evidence changes the answer', async () => {
    const all = await radSession.get('/api/models/performance');
    const strict = await radSession.get('/api/models/performance?evidence=histopathology');

    const relaxedLung = all.json.models.find((m: any) => m.scanType === 'lung');
    const strictLung = strict.json.models.find((m: any) => m.scanType === 'lung');

    assert.equal(strictLung.evidenceFloor, 'histopathology');
    assert.ok(
      strictLung.adjudicated <= relaxedLung.adjudicated,
      'a stricter evidence floor cannot admit more scans'
    );
  });

  test('an unknown evidence level is refused', async () => {
    const res = await radSession.get('/api/models/performance?evidence=vibes');
    assert.equal(res.status, 400);
  });

  test('a patient cannot read model performance', async () => {
    const res = await patient.session.get('/api/models/performance');
    assert.equal(res.status, 403);
  });

  test('the backlog lists predictions still awaiting an outcome', async () => {
    const res = await radSession.get('/api/radiologist/awaiting-outcome');
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.json));
    assert.ok(
      !res.json.some((row: any) => scanIds.includes(row.id)),
      'scans adjudicated above should have left the queue'
    );
  });
});

describe('language availability gate', { timeout: TIMEOUT }, () => {
  test('a language missing safety-critical strings is withheld', async () => {
    const { languageStatuses, missingSafetyKeys, LANGUAGE_MANIFEST } = await import(
      '../client/src/lib/language-availability.ts'
    );

    const spanish = LANGUAGE_MANIFEST.find((l) => l.code === 'es')!;
    assert.ok(
      missingSafetyKeys(spanish.resource).length > 0,
      'the Spanish file covers navigation only; this test guards the gate, not the file'
    );

    const status = languageStatuses().find((l) => l.code === 'es')!;
    assert.equal(status.available, false);
    assert.match(status.reason!, /untranslated|review/);
  });

  test('English is offered and complete', async () => {
    const { languageStatuses, missingSafetyKeys, LANGUAGE_MANIFEST } = await import(
      '../client/src/lib/language-availability.ts'
    );

    const english = LANGUAGE_MANIFEST.find((l) => l.code === 'en')!;
    assert.deepEqual(missingSafetyKeys(english.resource), []);
    assert.equal(languageStatuses().find((l) => l.code === 'en')!.available, true);
  });

  test('the runtime is only loaded when there is a choice to make', async () => {
    const { translationRuntimeNeeded, availableLanguages } = await import(
      '../client/src/lib/language-availability.ts'
    );
    // Loading i18next to resolve every string to the value it already had is a
    // download for nothing.
    assert.equal(translationRuntimeNeeded(), availableLanguages().length > 1);
  });
});
