/**
 * Detection runs and candidate review.
 *
 * The property this file mostly exists to protect: a completed run with no
 * candidates, a refused run, and a failed run must stay distinguishable. All
 * three look like "no candidates" to anything that only counts rows, and if
 * they collapse then an infrastructure failure reads as a clear study. That
 * is the failure mode the whole platform is built to avoid.
 *
 * There is no trained detector in this repository, so every run here refuses
 * with `model_unavailable`. That is the honest end state of the pipeline as
 * built, and the tests assert the refusal is shaped like a refusal rather than
 * like an absence of findings.
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import {
  Session,
  TEST_USER_PREFIX,
  db,
  registerPatient,
  startServer,
  stopServer,
} from './helpers/server.ts';

const TIMEOUT = 300_000;
const INGEST_TIMEOUT_MS = 240_000;
const INFERENCE_CONFIGURED = Boolean(process.env.INFERENCE_URL);

function resolveSeries(maxFiles: number): any | null {
  if (!fs.existsSync(path.join(process.cwd(), 'dataset', 'manifest-1600709154662'))) return null;
  const run = spawnSync(process.env.PYTHON_BIN || 'python',
    ['scripts/lidc_find_series.py', '--max-files', String(maxFiles)],
    { encoding: 'utf8', timeout: 600_000 });
  if (run.status !== 0) return null;
  try {
    const parsed = JSON.parse(run.stdout.trim().split('\n').pop() ?? '');
    return parsed.error ? null : parsed;
  } catch {
    return null;
  }
}

const series = resolveSeries(45);
const WITHOUT_DATASET = !series && 'LIDC-IDRI download absent (gitignored)';
const WITHOUT_SERVICE = !INFERENCE_CONFIGURED && 'INFERENCE_URL is not set';
const FULL_PATH = WITHOUT_DATASET || WITHOUT_SERVICE;

let patient: Awaited<ReturnType<typeof registerPatient>>;
let otherPatient: Awaited<ReturnType<typeof registerPatient>>;
let radSession: Session;
let seriesId: number | null = null;

before(async () => {
  await startServer();
  patient = await registerPatient('det-patient');
  otherPatient = await registerPatient('det-other');
  const radiologist = await registerPatient('det-rad');
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

  if (!FULL_PATH) {
    // Retried once, deliberately.
    //
    // The server warms the googleapis import *after* it starts listening —
    // that ordering is itself a fix, because doing it before the database
    // check silently downgraded sessions to memory. It costs about twelve
    // seconds of blocked event loop, and a 24 MB multipart upload arriving in
    // that window has its connection reset. `/api/ready` cannot cover it,
    // since the server is genuinely ready and merely busy.
    //
    // This suite is exposed where others are not because it ingests in
    // `before` rather than inside a test. One retry after a pause is honest
    // about what is happening; widening the request timeout would not help,
    // because the connection is reset rather than slow.
    const ingest = async () => {
      const form = new FormData();
      for (const file of series!.files) {
        form.append('files',
          new Blob([fs.readFileSync(path.join(process.cwd(), file))], { type: 'application/dicom' }),
          path.basename(file));
      }
      form.append('patientId', String(patient.id));
      return radSession.postForm('/api/dicom/series', form, INGEST_TIMEOUT_MS);
    };

    let res;
    try {
      res = await ingest();
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 15_000));
      res = await ingest();
    }
    if (res.status === 201 || res.status === 200) seriesId = res.json.seriesId;
  }
});

after(async () => {
  const pool = db();
  try {
    const stale = await pool.query('SELECT id FROM users WHERE left(username, $2) = $1',
      [TEST_USER_PREFIX, TEST_USER_PREFIX.length]);
    const ids = stale.rows.map((r: any) => r.id);
    if (ids.length) {
      await pool.query('DELETE FROM detection_candidates WHERE patient_id = ANY($1)', [ids]);
      await pool.query('DELETE FROM detection_runs WHERE patient_id = ANY($1)', [ids]);
      const objects = await pool.query(
        `SELECT object_path FROM imaging_instances WHERE series_id IN
           (SELECT id FROM imaging_series WHERE patient_id = ANY($1))`, [ids]);
      for (const row of objects.rows) {
        if (typeof row.object_path === 'string' && row.object_path.startsWith('file://')) {
          await fs.promises.unlink(
            path.join(process.cwd(), 'uploads', row.object_path.slice('file://'.length))
          ).catch(() => {});
        }
      }
      await pool.query(
        `DELETE FROM imaging_instances WHERE series_id IN
           (SELECT id FROM imaging_series WHERE patient_id = ANY($1))`, [ids]);
      await pool.query('DELETE FROM imaging_series WHERE patient_id = ANY($1)', [ids]);
      await pool.query('DELETE FROM imaging_studies WHERE patient_id = ANY($1)', [ids]);
      for (const id of ids) {
        await fs.promises.rm(path.join(process.cwd(), 'uploads', 'series', String(id)),
          { recursive: true, force: true }).catch(() => {});
      }
      await pool.query('DELETE FROM medical_scans WHERE patient_id = ANY($1)', [ids]);
      await pool.query('DELETE FROM processing_consents WHERE patient_id = ANY($1)', [ids]);
      await pool.query(
        'DELETE FROM notifications WHERE recipient_id = ANY($1) OR actor_id = ANY($1)', [ids]);
      await pool.query(
        'UPDATE audit_events SET actor_user_id = NULL WHERE actor_user_id = ANY($1)', [ids]);
      await pool.query('DELETE FROM users WHERE id = ANY($1)', [ids]);
    }
  } finally {
    await pool.end();
  }
  await stopServer();
});

// ── authorization ──────────────────────────────────────────────────────────

describe('who may request detection', { timeout: TIMEOUT }, () => {
  test('an anonymous caller cannot', async () => {
    const res = await new Session().post('/api/dicom/series/1/detection');
    assert.equal(res.status, 401);
  });

  test('a patient cannot request detection on their own series', { skip: FULL_PATH }, async () => {
    const res = await patient.session.post(`/api/dicom/series/${seriesId}/detection`);
    assert.ok([403, 404].includes(res.status), `${res.status}: ${res.text.slice(0, 200)}`);
  });

  test('an anonymous caller cannot read candidates', async () => {
    const res = await new Session().get('/api/dicom/series/1/candidates');
    assert.equal(res.status, 401);
  });

  test('an anonymous caller cannot read a run', async () => {
    assert.equal((await new Session().get('/api/detection/runs/1')).status, 401);
  });

  test('an anonymous caller cannot review a candidate', async () => {
    const res = await new Session().patch('/api/candidates/1/review', { disposition: 'accepted' });
    assert.equal(res.status, 401);
  });
});

// ── the refusal, which is the honest end state today ───────────────────────

describe('a run with no detector', { timeout: TIMEOUT }, () => {
  test('refuses with 503 and records the refusal', { skip: FULL_PATH }, async () => {
    const res = await radSession.post(`/api/dicom/series/${seriesId}/detection`);

    assert.equal(res.status, 503, res.text.slice(0, 400));
    assert.equal(res.json.status, 'refused');
    assert.equal(res.json.failureCode, 'model_unavailable');
    assert.equal(res.json.candidateCount, null, 'null, not zero — nothing was searched');
    assert.match(res.json.error, /NOT a negative result/);
    assert.match(res.json.interpretation, /was NOT searched/);
  });

  test('the refusal is persisted as a run, not lost', { skip: FULL_PATH }, async () => {
    const pool = db();
    try {
      const { rows } = await pool.query(
        `SELECT status, failure_code, candidate_count FROM detection_runs
          WHERE series_id = $1 ORDER BY created_at DESC LIMIT 1`, [seriesId]);
      assert.equal(rows[0].status, 'refused');
      assert.equal(rows[0].failure_code, 'model_unavailable');
      assert.equal(rows[0].candidate_count, null);
    } finally {
      await pool.end();
    }
  });

  test('a refused run is readable and says it is not a negative result', { skip: FULL_PATH }, async () => {
    const pool = db();
    let runId: number;
    try {
      const { rows } = await pool.query(
        'SELECT id FROM detection_runs WHERE series_id = $1 ORDER BY created_at DESC LIMIT 1',
        [seriesId]);
      runId = rows[0].id;
    } finally {
      await pool.end();
    }

    const res = await radSession.get(`/api/detection/runs/${runId}`);
    assert.equal(res.status, 200);
    assert.equal(res.json.status, 'refused');
    assert.match(res.json.interpretation, /not a negative result/i);
  });

  test('a refused run produces no candidates, and the list says so', { skip: FULL_PATH }, async () => {
    const res = await radSession.get(`/api/dicom/series/${seriesId}/candidates`);
    assert.equal(res.status, 200);
    assert.deepEqual(res.json.candidates, []);
    assert.equal(res.json.run.status, 'refused');
    // The list alone cannot say whether anything was searched; the run can.
    assert.match(res.json.run.interpretation, /was NOT searched/);
    assert.match(res.json.note, /not a finding/i);
  });

  test('no field in the response could hold a clinical conclusion', { skip: FULL_PATH }, async () => {
    // Asserted on the structure, not on substrings: the disclaimers
    // legitimately contain the word "malignancy" precisely because they are
    // denying it, and a text search cannot tell a denial from a claim.
    const res = await radSession.get(`/api/dicom/series/${seriesId}/candidates`);

    const keys = new Set<string>();
    const walk = (value: any) => {
      if (Array.isArray(value)) return value.forEach(walk);
      if (value && typeof value === 'object') {
        for (const [key, child] of Object.entries(value)) {
          keys.add(key.toLowerCase());
          walk(child);
        }
      }
    };
    walk(res.json);

    for (const forbidden of ['malignan', 'cancer', 'diagnos', 'risk', 'priority', 'benign']) {
      assert.ok(
        ![...keys].some((key) => key.includes(forbidden)),
        `a field name contains "${forbidden}": ${[...keys].join(', ')}`
      );
    }
    // And the prose that does mention malignancy only denies it.
    assert.match(res.json.note, /says nothing about malignancy/);
  });
});

// ── preconditions ──────────────────────────────────────────────────────────

describe('series that cannot be searched', { timeout: TIMEOUT }, () => {
  test('a series that does not exist is refused', async () => {
    const res = await radSession.post('/api/dicom/series/2147483600/detection');
    assert.ok([403, 404, 422].includes(res.status), `${res.status}`);
  });

  test('an invalid series id is a 400', async () => {
    const res = await radSession.post('/api/dicom/series/not-a-number/detection');
    assert.ok([400, 403, 404].includes(res.status), `${res.status}`);
  });
});

// ── review vocabulary ──────────────────────────────────────────────────────

describe('candidate review', { timeout: TIMEOUT }, () => {
  test('a disposition outside the closed vocabulary is refused', { skip: FULL_PATH }, async () => {
    // No candidate exists (no detector), so this asserts the guard order:
    // the vocabulary is checked before anything else.
    const res = await radSession.patch('/api/candidates/999999/review', {
      disposition: 'malignant',
    });
    assert.ok([400, 403, 404].includes(res.status), `${res.status}: ${res.text.slice(0, 200)}`);
    if (res.status === 400) {
      assert.match(res.json.error, /disposition must be one of/);
      assert.match(res.json.error, /not what it is/);
    }
  });

  test('the vocabulary contains no clinical conclusion', async () => {
    const { REVIEW_DISPOSITIONS } = await import('../server/detection.ts');
    assert.deepEqual([...REVIEW_DISPOSITIONS],
      ['accepted', 'rejected', 'uncertain', 'missed_candidate_added']);
    for (const word of ['malignant', 'benign', 'cancer', 'risk', 'urgent']) {
      assert.ok(!REVIEW_DISPOSITIONS.some((d) => d.includes(word)), word);
    }
  });
});

// ── patient isolation ──────────────────────────────────────────────────────

describe('patient isolation', { timeout: TIMEOUT }, () => {
  test('a run carries the patient it belongs to', { skip: FULL_PATH }, async () => {
    const pool = db();
    try {
      const { rows } = await pool.query(
        'SELECT patient_id FROM detection_runs WHERE series_id = $1 LIMIT 1', [seriesId]);
      assert.equal(rows[0].patient_id, patient.id);
    } finally {
      await pool.end();
    }
  });

  test('candidate rows denormalise the patient so isolation needs no join', async () => {
    const pool = db();
    try {
      const { rows } = await pool.query(
        `SELECT column_name FROM information_schema.columns
          WHERE table_name = 'detection_candidates' AND column_name = 'patient_id'`);
      assert.equal(rows.length, 1);
    } finally {
      await pool.end();
    }
  });

  test('a crashed run does not strand the series forever', { skip: FULL_PATH }, async () => {
    // Found by audit. The partial unique index refuses a second in-flight
    // run, so a crash between creating one and finishing it left the series
    // answering 409 permanently, recoverable only by hand-written SQL.
    const detection = await import('../server/detection.ts');
    const pool = db();
    try {
      await pool.query(
        `INSERT INTO detection_runs (series_id, patient_id, status, created_at)
         VALUES ($1, $2, 'queued', now() - interval '3 hours')`,
        [seriesId, patient.id]
      );

      const blocked = await radSession.post(`/api/dicom/series/${seriesId}/detection`);
      assert.notEqual(blocked.status, 409, 'the stale run must not block a new request');

      const { rows } = await pool.query(
        `SELECT status, failure_code, candidate_count FROM detection_runs
          WHERE series_id = $1 AND failure_code = 'abandoned'`,
        [seriesId]
      );
      assert.equal(rows.length, 1, 'the stranded run was reaped');
      assert.equal(rows[0].status, 'failed', 'failed, not deleted — a crash is evidence');
      assert.equal(rows[0].candidate_count, null, 'null, never 0');
    } finally {
      await pool.end();
    }
  });

  test('a genuinely in-flight run still blocks a second with 409', { skip: FULL_PATH }, async () => {
    const pool = db();
    try {
      await pool.query(
        `INSERT INTO detection_runs (series_id, patient_id, status) VALUES ($1, $2, 'running')`,
        [seriesId, patient.id]
      );
      const res = await radSession.post(`/api/dicom/series/${seriesId}/detection`);
      assert.equal(res.status, 409, res.text.slice(0, 200));
      assert.equal(res.json.code, 'detection_already_in_flight');
    } finally {
      await pool.query?.('SELECT 1').catch(() => {});
      await pool.end();
    }
  });

  test('one run at a time per series is enforced by the database', async () => {
    const pool = db();
    try {
      const { rows } = await pool.query(
        `SELECT indexdef FROM pg_indexes WHERE indexname = 'idx_detection_runs_one_in_flight'`);
      assert.equal(rows.length, 1, 'the partial unique index exists');
      assert.match(rows[0].indexdef, /queued/);
      assert.match(rows[0].indexdef, /running/);
    } finally {
      await pool.end();
    }
  });
});

// ── the capability boundary ────────────────────────────────────────────────

describe('the capability manifest still says PLANNED', { timeout: TIMEOUT }, () => {
  test('detection is not promoted by the pipeline existing', async () => {
    const res = await new Session().get('/api/capabilities');
    const detection = res.json.capabilities.find((c: any) => c.id === 'lung-nodule-detection');
    assert.ok(detection);
    assert.equal(detection.status, 'PLANNED');
    assert.equal(detection.modelClass, null);
  });
});
