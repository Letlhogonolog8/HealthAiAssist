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
 * Real lesion images from the held-out skin set.
 *
 * The suite needs scans the model actually scored, and the only honest way to
 * get them is to run the model. Skipped rather than faked when the dataset is
 * absent, because inventing a prediction inside the tests that guard against
 * invented predictions would be self-defeating.
 *
 * These were chest images from the lung set until the lung model was withdrawn
 * (2026-09-20; see MODEL_CARDS.md). Skin is the modality that serves, so skin
 * is what produces a `predicted_positive` to adjudicate. The lung path is kept
 * below as what it now is: a refusal that must still leave a row for a human.
 */
const SKIN_DIR = 'dataset/dataset/data/test/malignant';
const skinCandidates = fs.existsSync(SKIN_DIR)
  ? fs.readdirSync(SKIN_DIR).filter((f) => /\.(jpe?g|png)$/i.test(f)).slice(0, 8)
  : [];
const haveImages = skinCandidates.length >= 2;

const LUNG_DIR = 'dataset/dataset/lung_cancer_MRI_dataset/validate/cancer';
const lungImage = fs.existsSync(LUNG_DIR)
  ? fs.readdirSync(LUNG_DIR).find((f) => /\.(jpe?g|png)$/i.test(f)) ?? null
  : null;

let patient: Awaited<ReturnType<typeof registerPatient>>;
let stranger: Awaited<ReturnType<typeof registerPatient>>;
let radiologist: Awaited<ReturnType<typeof registerPatient>>;
let radSession: Session;
const scanIds: number[] = [];
/** A lung scan the withdrawn model was asked about and refused. */
let refusedLungScanId: number | null = null;

/**
 * Submits candidates until `wanted` are scored.
 *
 * The out-of-distribution screen refuses roughly 1 held-out lesion in 120, and
 * a refusal is the correct behaviour rather than a test failure — so an image
 * it declines is skipped and the next one tried. Anything other than a 200 or
 * a 422 is a real failure and is reported as one.
 */
async function analyseUntil(session: Session, wanted: number): Promise<number[]> {
  const ids: number[] = [];
  for (const file of skinCandidates) {
    if (ids.length >= wanted) break;
    const form = new FormData();
    const bytes = fs.readFileSync(`${SKIN_DIR}/${file}`);
    form.append('image', new Blob([bytes], { type: 'image/jpeg' }), file);
    form.append('scanType', 'skin');

    const res = await session.postForm('/api/scans/analyze', form);
    if (res.status === 422) continue;
    assert.equal(res.status, 200, res.text.slice(0, 200));
    ids.push(res.json.scan.id);
  }
  assert.equal(ids.length, wanted, `only ${ids.length} of ${skinCandidates.length} candidates were scored`);
  return ids;
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

  // Automated analysis now requires the patient to have agreed to it. Without
  // this the scans below are stored and queued for a human but never analysed,
  // `predicted_positive` stays null, and every measurement in this file has
  // nothing to measure.
  const consent = await patient.session.post('/api/scans/analysis-consent', { granted: true });
  assert.equal(consent.status, 200, consent.text.slice(0, 200));

  if (haveImages) {
    scanIds.push(...(await analyseUntil(patient.session, 2)));
  }

  if (lungImage) {
    // Consent is on record and the image is a real chest image. The refusal
    // is the modality's, not the patient's: the lung model is withdrawn.
    const form = new FormData();
    form.append('image', new Blob([fs.readFileSync(`${LUNG_DIR}/${lungImage}`)], { type: 'image/jpeg' }), lungImage);
    form.append('scanType', 'lung');
    const res = await patient.session.postForm('/api/scans/analyze', form);
    assert.equal(res.status, 503, res.text.slice(0, 200));
    assert.match(res.json.reason, /withdrawn/i, 'the refusal must name the withdrawal');
    assert.equal(res.json.queuedForManualReview, true);
    refusedLungScanId = res.json.scanId ?? null;
    assert.ok(refusedLungScanId, 'a refused lung scan must still leave a row for a human');
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
      // Consent rows reference users.id; leaving them behind makes the user
      // delete below fail on the foreign key rather than clean up.
      await pool.query('DELETE FROM processing_consents WHERE patient_id = ANY($1)', [ids]);
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

describe('skin-tone stratum is recorded', { timeout: TIMEOUT }, () => {
  const BENIGN_DIR = 'dataset/dataset/data/test/benign';

  test('an analysed skin scan carries a tone bin', async (t) => {
    if (!fs.existsSync(BENIGN_DIR)) return t.skip('skin dataset not present');
    const file = fs.readdirSync(BENIGN_DIR).find((f) => /\.(jpe?g|png)$/i.test(f));
    if (!file) return t.skip('no skin images');

    const form = new FormData();
    form.append('image', new Blob([fs.readFileSync(`${BENIGN_DIR}/${file}`)], { type: 'image/jpeg' }), file);
    form.append('scanType', 'skin');

    const res = await patient.session.postForm('/api/scans/analyze', form);
    // A refusal is a legitimate outcome here (OOD screen, model unavailable);
    // what must not happen is an analysed scan with no stratum recorded.
    if (res.status !== 200 || res.json?.analysed === false) {
      return t.skip(`skin analysis did not run: ${res.status}`);
    }

    const pool = db();
    try {
      const { rows } = await pool.query(
        'SELECT skin_tone_bin, predicted_positive FROM medical_scans WHERE id = $1',
        [res.json.scan.id]
      );
      assert.equal(rows.length, 1);
      assert.notEqual(rows[0].predicted_positive, null, 'the model ran');
      // The estimator may legitimately refuse on an image with too little
      // visible skin, so null is allowed — but if set it must be a real bin.
      if (rows[0].skin_tone_bin !== null) {
        assert.ok(
          ['dark', 'brown', 'tan', 'intermediate', 'light', 'very_light', 'unclassified']
            .includes(rows[0].skin_tone_bin),
          `unexpected bin ${rows[0].skin_tone_bin}`
        );
      }
    } finally {
      await pool.end();
    }
  });

  test('a lung scan never carries one, and a refused scan carries no model call', async (t) => {
    if (!refusedLungScanId) return t.skip('lung dataset not present');
    const pool = db();
    try {
      const { rows } = await pool.query(
        'SELECT skin_tone_bin, predicted_positive, status FROM medical_scans WHERE id = $1',
        [refusedLungScanId]
      );
      assert.equal(rows.length, 1);
      // A chest image has no perilesional skin; asking would produce a number
      // that means nothing — and nothing was analysed anyway.
      assert.equal(rows[0].skin_tone_bin, null, 'lung scans must not be given a tone');
      assert.equal(rows[0].predicted_positive, null, 'a refused scan must not carry a model call');
      assert.equal(rows[0].status, 'pending_manual_review');
    } finally {
      await pool.end();
    }
  });
});

describe('consent to automated analysis', { timeout: TIMEOUT }, () => {
  test('the disclosure states the error rates, not just that AI is used', async () => {
    const res = await new Session().get('/api/scans/analysis-disclosure');
    assert.equal(res.status, 200);

    const text = res.json.disclosure.join(' ');
    // The miss rate is the fact that determines whether a reasonable person
    // agrees. A disclosure that omits it is not informed consent.
    assert.match(text, /1 in 30/, 'skin miss rate must be disclosed');
    assert.match(text, /1 in 4/, 'skin false-alarm rate must be disclosed');
    // A disclosure must describe what runs. The web-trained lung model is
    // withdrawn and its miss rate must not be quoted; the nodule characteriser
    // reads one marked nodule, and its small-sample figures are stated with
    // the sample size.
    assert.doesNotMatch(text, /1 in 5/, 'the withdrawn lung model\'s miss rate must not be quoted');
    assert.match(text, /nodule that a clinician has marked/i);
    assert.match(text, /4 of 29/, 'the nodule figure carries its denominator');
    assert.match(text, /not read by any program/i, 'an unmarked CT is not read');
    assert.match(text, /not been approved by any medical regulator/i);
    assert.match(text, /darker skin/i);
    assert.equal(res.json.revocable, true);
    assert.equal(res.json.humanReviewGuaranteed, true);
  });

  test('declining is the default, and is recorded as a decision', async () => {
    const decliner = await registerPatient('outcome-decliner');

    const before = await decliner.session.get('/api/scans/analysis-consent');
    assert.equal(before.status, 200);
    assert.equal(before.json.granted, false, 'consent must not be assumed');
    assert.equal(before.json.version, null, 'nothing agreed to yet');

    const post = await decliner.session.post('/api/scans/analysis-consent', { granted: false });
    assert.equal(post.status, 200);

    const after = await decliner.session.get('/api/scans/analysis-consent');
    assert.equal(after.json.granted, false);
    // An explicit refusal is distinguishable from never having been asked,
    // because it records which version of the text was refused.
    assert.ok(after.json.version, 'an explicit decline records the version seen');
  });

  test('a scan submitted without consent is stored, queued, and not given a result', async (t) => {
    if (!haveImages) return t.skip('skin dataset not present');

    const decliner = await registerPatient('outcome-noconsent');

    const form = new FormData();
    const bytes = fs.readFileSync(`${SKIN_DIR}/${skinCandidates[0]}`);
    form.append('image', new Blob([bytes], { type: 'image/jpeg' }), skinCandidates[0]);
    form.append('scanType', 'skin');

    const res = await decliner.session.postForm('/api/scans/analyze', form);
    assert.equal(res.status, 200, res.text.slice(0, 200));

    // Declining must not cost the patient their scan.
    assert.ok(res.json.scan?.id, 'the scan is still stored');
    assert.equal(res.json.analysed, false);
    assert.equal(res.json.scan.status, 'pending_manual_review');

    // The whole point: an absent result must never read as a negative one.
    assert.equal(res.json.scan.predictedPositive ?? null, null);
    assert.equal(res.json.scan.aiConfidence, 'N/A');
    assert.doesNotMatch(
      String(res.json.scan.result),
      /no abnormal|normal|negative|clear/i,
      'an unanalysed scan must not be phrased as a negative finding'
    );
    assert.match(res.json.message, /NOT a negative finding/);

    const pool = db();
    try {
      await pool.query('DELETE FROM medical_scans WHERE patient_id = $1', [decliner.id]);
    } finally {
      await pool.end();
    }
  });
});

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
      scanType: 'skin',
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

describe('recording an outcome', { timeout: TIMEOUT, skip: !haveImages && 'no skin dataset on disk' }, () => {
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

describe('production performance', { timeout: TIMEOUT, skip: !haveImages && 'no skin dataset on disk' }, () => {
  test('the matrix is built from adjudicated scans', async () => {
    const res = await radSession.get('/api/models/performance');
    assert.equal(res.status, 200);

    const skin = res.json.models.find((m: any) => m.scanType === 'skin');
    assert.ok(skin, 'skin should appear once it has predictions');
    // At least the two adjudicated above. Exactly two only on a database that
    // holds nothing else, which CI's is and a developer's need not be.
    assert.ok(skin.adjudicated >= 2, `expected the two adjudications above, got ${skin.adjudicated}`);
    assert.ok(skin.sensitivity.denominator > 0);
    assert.ok(skin.sensitivity.interval, 'a rate must carry its interval');
    // The withdrawn modality has no predictions to measure and must not be
    // invented into the table.
    const lung = res.json.models.find((m: any) => m.scanType === 'lung');
    if (lung) assert.equal(lung.adjudicated, 0, 'no lung scan was scored, so none can be adjudicated');
  });

  test('restricting the evidence changes the answer', async () => {
    const all = await radSession.get('/api/models/performance');
    const strict = await radSession.get('/api/models/performance?evidence=histopathology');

    const relaxedSkin = all.json.models.find((m: any) => m.scanType === 'skin');
    const strictSkin = strict.json.models.find((m: any) => m.scanType === 'skin');

    assert.equal(strictSkin.evidenceFloor, 'histopathology');
    assert.ok(
      strictSkin.adjudicated <= relaxedSkin.adjudicated,
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
