/**
 * The radiologist review queue, and the counters that describe it.
 *
 * The queue is the platform's central promise: every AI result is reviewed by a
 * person before it reaches a patient. That promise is only as good as the list
 * that shows a radiologist what is waiting.
 *
 * It was not good. The handler behind /api/radiologist/pending-reviews gathered
 * two sets — scans whose `status` was 'pending_manual_review', and scans whose
 * `result` was still the literal string 'Processing' — and never asked for
 * `status = 'pending'`. That is the status of a scan the analysis pipeline has
 * finished with: handleScanAnalysis writes a result and a risk level and leaves
 * `status` at the schema default. So the queue could see scans no model could
 * run on, and scans still mid-flight, and was blind to every analysed scan
 * awaiting a signature — which is all of the actual work.
 *
 * The stat card above the list came from getRadiologistWorkload(), which counts
 * `status <> 'completed'`. The two disagreed on screen: "Pending Reviews: 2"
 * over an empty queue reading "Great work! You're all caught up."
 *
 * These tests pin the properties that keep the two honest:
 *
 *   - an analysed scan awaiting review is in the queue;
 *   - the queue's length and the counter above it are the same number;
 *   - "completed today" means a radiologist completed it today, not that it
 *     happened to be uploaded today;
 *   - a row carries enough to identify the patient it belongs to;
 *   - submitting a report actually moves the scan between the two lists.
 *
 * Scans are seeded through SQL rather than by running a model, so the suite
 * does not depend on the image dataset being present and can fix a scan in
 * exactly the state that was invisible.
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  Session,
  TEST_USER_PREFIX,
  db,
  registerPatient,
  startServer,
  stopServer,
} from './helpers/server.ts';

const TIMEOUT = 120_000;

let patient: Awaited<ReturnType<typeof registerPatient>>;
let radiologist: Awaited<ReturnType<typeof registerPatient>>;
let radSession: Session;

/** Scans seeded by this suite, so each test can start from a known queue. */
let analysedPendingId = 0;
let manualReviewId = 0;
let completedYesterdayId = 0;

async function seedScans(): Promise<void> {
  const pool = db();
  try {
    // An ordinary successful analysis: a result, a risk level, and the status
    // the pipeline actually leaves behind. This is the row the queue could not
    // see, and it is high risk, so it is also the one a radiologist most needs.
    const analysed = await pool.query(
      `INSERT INTO medical_scans
         (patient_id, scan_type, result, ai_confidence, risk_level,
          predicted_positive, model_version, status, created_at)
       VALUES ($1, 'lung', 'Lung Cancer detected - high risk', '91%', 'high',
               true, 'lung-v2', 'pending', now() - interval '3 hours')
       RETURNING id`,
      [patient.id]
    );
    analysedPendingId = analysed.rows[0].id;

    // A scan no model could analyse. This one the queue could always see.
    const manual = await pool.query(
      `INSERT INTO medical_scans
         (patient_id, scan_type, result, status, created_at)
       VALUES ($1, 'skin', 'Processing', 'pending_manual_review',
               now() - interval '2 hours')
       RETURNING id`,
      [patient.id]
    );
    manualReviewId = manual.rows[0].id;

    // Signed off yesterday. Belongs in neither today's completed list nor the
    // pending queue.
    const done = await pool.query(
      `INSERT INTO medical_scans
         (patient_id, scan_type, result, ai_confidence, risk_level,
          predicted_positive, model_version, status, radiologist_id,
          findings, recommendations, created_at, reviewed_at)
       VALUES ($1, 'lung', 'No abnormal findings detected', '77%', 'low',
               false, 'lung-v2', 'completed', $2,
               'Clear lung fields.', 'No further imaging.',
               now() - interval '3 days', now() - interval '1 day')
       RETURNING id`,
      [patient.id, radiologist.id]
    );
    completedYesterdayId = done.rows[0].id;
  } finally {
    await pool.end();
  }
}

before(async () => {
  await startServer();

  patient = await registerPatient('radq-patient');
  radiologist = await registerPatient('radq-rad');

  const pool = db();
  try {
    await pool.query('UPDATE users SET role = $1 WHERE id = $2', [
      'radiologist',
      radiologist.id,
    ]);
  } finally {
    await pool.end();
  }

  radSession = new Session();
  const login = await radSession.post('/api/auth/login', {
    username: radiologist.username,
    password: 'Passw0rd!23',
  });
  assert.equal(login.status, 200, login.text.slice(0, 200));

  await seedScans();
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
      await pool.query('UPDATE audit_events SET actor_user_id = NULL WHERE actor_user_id = ANY($1)', [
        ids,
      ]);
      await pool.query('DELETE FROM users WHERE id = ANY($1)', [ids]);
    }
  } finally {
    await pool.end();
  }
  await stopServer();
});

// ---------------------------------------------------------------------------

describe('the review queue can see what is waiting', { timeout: TIMEOUT }, () => {
  test('an analysed scan awaiting sign-off is in the queue', async () => {
    const res = await radSession.get('/api/radiologist/pending-reviews');
    assert.equal(res.status, 200);

    const ids = res.json.map((row: any) => row.id);
    assert.ok(
      ids.includes(analysedPendingId),
      `scan ${analysedPendingId} has a result, a risk level and status 'pending' — ` +
        `it is exactly what a radiologist is meant to review, and the queue ` +
        `returned ${JSON.stringify(ids)}`
    );
  });

  test('a scan with no automated analysis is still in the queue', async () => {
    // The one case the old handler did cover. It must not regress in the
    // opposite direction: these scans have no AI result at all and depend
    // entirely on this list.
    const res = await radSession.get('/api/radiologist/pending-reviews');
    const ids = res.json.map((row: any) => row.id);
    assert.ok(ids.includes(manualReviewId), 'manual-review scan dropped from the queue');
  });

  test('a completed scan is not in the queue', async () => {
    const res = await radSession.get('/api/radiologist/pending-reviews');
    const ids = res.json.map((row: any) => row.id);
    assert.ok(!ids.includes(completedYesterdayId), 'a signed-off scan reappeared as pending');
  });

  test('the queue and the counter above it are the same number', async () => {
    // The defect that made this visible: "Pending Reviews: 2" over an empty
    // list. The two are computed by different code and must agree, so this
    // asserts the relationship rather than either value.
    const [queue, stats] = await Promise.all([
      radSession.get('/api/radiologist/pending-reviews'),
      radSession.get('/api/radiologist/stats'),
    ]);

    assert.equal(
      queue.json.length,
      stats.json.pendingReviews,
      `the queue listed ${queue.json.length} scans while the stat card claimed ` +
        `${stats.json.pendingReviews}`
    );
  });

  test('a queue row identifies its patient and carries the AI result', async () => {
    const res = await radSession.get('/api/radiologist/pending-reviews');
    const row = res.json.find((r: any) => r.id === analysedPendingId);
    assert.ok(row, 'the analysed scan was not in the queue');

    assert.equal(row.patientName, `Test radq-patient`);
    assert.equal(row.scanType, 'lung');
    // Reported "Analysis in progress" for every row, because the only rows that
    // reached the list were ones still processing.
    assert.equal(row.aiPrediction, 'Lung Cancer detected - high risk');
    assert.equal(row.aiConfidence, 91);
  });

  test('priority reflects the recorded risk, not the unwritten column', async () => {
    // `priority` defaults to 'medium' and nothing writes it, so reading it gave
    // every row a MEDIUM badge — including this one, whose risk_level is 'high'.
    // The badge, the priority filter and "Sort: Priority" all read this field.
    const res = await radSession.get('/api/radiologist/pending-reviews');
    const row = res.json.find((r: any) => r.id === analysedPendingId);

    assert.equal(row.riskLevel, 'high');
    assert.equal(
      row.priority,
      'high',
      'a high-risk scan was ranked medium, so nothing in the queue distinguished it'
    );
  });

  test('a scan with no AI result is flagged as such rather than given one', async () => {
    const res = await radSession.get('/api/radiologist/pending-reviews');
    const row = res.json.find((r: any) => r.id === manualReviewId);

    assert.equal(row.awaitingManualReview, true);
    assert.equal(row.aiConfidence, null, 'confidence was 0, which reads as a measurement');
  });

  test('no row invents a referring doctor', async () => {
    // Was the literal 'Johnson' on every scan. A scan records no referring
    // clinician, so the honest answer is null.
    const res = await radSession.get('/api/radiologist/pending-reviews');
    for (const row of res.json) {
      assert.equal(row.referringDoctor, null);
    }
  });
});

describe('completed means a radiologist completed it', { timeout: TIMEOUT }, () => {
  test('a pending scan is not listed as completed today', async () => {
    // This filtered on created_at and kept anything whose result was not the
    // literal 'Processing' — so a scan uploaded this morning and still sitting
    // unreviewed was listed under Completed, with the AI verdict shown as the
    // radiologist's findings.
    const res = await radSession.get('/api/radiologist/completed-today');
    assert.equal(res.status, 200);

    const ids = res.json.map((row: any) => row.id);
    assert.ok(
      !ids.includes(analysedPendingId),
      'an unreviewed scan was presented as a completed review'
    );
    assert.ok(!ids.includes(manualReviewId));
  });

  test("yesterday's sign-off is not in today's list", async () => {
    const res = await radSession.get('/api/radiologist/completed-today');
    const ids = res.json.map((row: any) => row.id);
    assert.ok(!ids.includes(completedYesterdayId));
  });

  test('submitting a report moves the scan between the two lists', async () => {
    const before = await Promise.all([
      radSession.get('/api/radiologist/pending-reviews'),
      radSession.get('/api/radiologist/completed-today'),
    ]);
    const pendingBefore = before[0].json.length;
    const completedBefore = before[1].json.length;

    const report = await radSession.post(
      `/api/radiologist/scans/${analysedPendingId}/report`,
      {
        findings: 'Spiculated nodule, right upper lobe, 14mm.',
        recommendation: 'Refer to MDT. Tissue diagnosis required.',
      }
    );
    assert.equal(report.status, 200, report.text.slice(0, 200));

    const [queue, completed, stats] = await Promise.all([
      radSession.get('/api/radiologist/pending-reviews'),
      radSession.get('/api/radiologist/completed-today'),
      radSession.get('/api/radiologist/stats'),
    ]);

    assert.equal(queue.json.length, pendingBefore - 1, 'the scan did not leave the queue');
    assert.equal(
      completed.json.length,
      completedBefore + 1,
      'the scan did not arrive in today’s completed list'
    );
    assert.equal(queue.json.length, stats.json.pendingReviews, 'the counter drifted');

    const row = completed.json.find((r: any) => r.id === analysedPendingId);
    // The radiologist's own words, not the one-line AI verdict they supersede.
    assert.equal(row.findings, 'Spiculated nodule, right upper lobe, 14mm.');
    assert.equal(row.recommendation, 'Refer to MDT. Tissue diagnosis required.');
  });
});

describe('the outcome queue identifies its rows', { timeout: TIMEOUT }, () => {
  test('a row carries the patient, the modality and the model', async () => {
    /*
     * The query behind this ran `SELECT s.*` through raw node-postgres, whose
     * rows are keyed by the database's own column names. So `scan.patientId`
     * was undefined, the name lookup was a lookup on undefined, and
     * JSON.stringify dropped every other undefined field — leaving rows that
     * carried an id and a result string and nothing else. Every row showed no
     * patient, no modality, no date, and "no image stored" whether or not one
     * existed.
     */
    const res = await radSession.get('/api/radiologist/awaiting-outcome');
    assert.equal(res.status, 200);

    const row = res.json.find((r: any) => r.id === completedYesterdayId);
    assert.ok(row, 'the adjudicable scan was missing from the outcome queue');

    assert.equal(row.patientId, patient.id);
    assert.equal(row.patientName, 'Test radq-patient');
    assert.equal(row.scanType, 'lung');
    assert.equal(row.modelVersion, 'lung-v2');
    assert.equal(row.predictedPositive, false);
    assert.ok(row.createdAt, 'createdAt was dropped');
  });
});
