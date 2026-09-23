/**
 * DPIA R-23: that an erasure request reaches the imaging and detection tables.
 *
 * Until this was closed, `server/erasure.ts` contained no reference to
 * `imaging_studies`, `imaging_series`, `imaging_instances`, `detection_runs`
 * or `detection_candidates`. A data subject could be told their request had
 * been executed while their CT series, its stored objects and every candidate
 * coordinate derived from their anatomy stayed exactly where they were.
 *
 * None of those rows holds a direct identifier. That is not the point: they
 * are all linked to a patient_id, and a candidate is a location in one
 * person's chest.
 *
 * Two failure modes are pinned here, and they pull in opposite directions:
 *
 *   - Erasing imaging that is still inside the statutory retention period,
 *     which destroys a record the practice is required to hold.
 *   - Reporting an erasure as done while the pixel data is still on disk.
 *
 * The tests use a patient whose only entries are seven years old, so the hold
 * has genuinely expired, and a second patient whose series is from today.
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';

import {
  Session,
  TEST_USER_PREFIX,
  db,
  registerPatient,
  startServer,
  stopServer,
} from './helpers/server.ts';

const TIMEOUT = 120_000;

let expired: Awaited<ReturnType<typeof registerPatient>>;
let current: Awaited<ReturnType<typeof registerPatient>>;
let admin: { session: Session; id: number };

let expiredObjectPath: string;

async function promote(userId: number, role: string): Promise<void> {
  const pool = db();
  try {
    await pool.query('UPDATE users SET role = $1 WHERE id = $2', [role, userId]);
  } finally {
    await pool.end();
  }
}

async function loginAs(username: string): Promise<Session> {
  const session = new Session();
  const res = await session.post('/api/auth/login', { username, password: 'Passw0rd!23' });
  if (res.status !== 200) throw new Error(`login failed (${res.status}): ${res.text.slice(0, 200)}`);
  return session;
}

/**
 * Writes one series with an instance, a detection run and two candidates.
 *
 * Inserted directly rather than through the ingest endpoint: the point here is
 * the erasure, and the ingest path needs real DICOM. The columns are the real
 * NOT NULL set, so a schema change that adds one will fail this loudly rather
 * than leaving the test asserting on a table shape that no longer exists.
 */
async function seedImaging(patientId: number, ageYears: number): Promise<string> {
  const pool = db();
  const stamp = `now() - interval '${ageYears} years'`;
  const uid = `2.25.${patientId}${ageYears}${Date.now() % 100000}`;
  try {
    const study = await pool.query(
      `INSERT INTO imaging_studies (patient_id, study_uid, study_year, created_at)
       VALUES ($1, $2, '2019', ${stamp}) RETURNING id`,
      [patientId, `${uid}.1`]
    );
    const series = await pool.query(
      `INSERT INTO imaging_series
         (study_id, patient_id, series_uid, modality, instance_count, ordering_method,
          ordering_trusted, quality_gate_passed, uid_mapping_scope, created_at)
       VALUES ($1, $2, $3, 'CT', 1, 'image_position_patient', true, true, 'deployment', ${stamp})
       RETURNING id`,
      [study.rows[0].id, patientId, `${uid}.2`]
    );

    // A real stored object, so that "the row went but the pixels stayed" is a
    // failure this test can actually observe.
    const objectName = `series/${patientId}/${uid.replace(/[^0-9.]/g, '')}/00000.dcm`;
    const absolute = path.join(process.cwd(), 'uploads', objectName);
    await fs.promises.mkdir(path.dirname(absolute), { recursive: true });
    await fs.promises.writeFile(absolute, Buffer.from('not a real DICOM, a placeholder'));

    await pool.query(
      `INSERT INTO imaging_instances (series_id, position_index, sop_uid, position_mm, object_path, created_at)
       VALUES ($1, 0, $2, 0.0, $3, ${stamp})`,
      [series.rows[0].id, `${uid}.3`, `file://${objectName}`]
    );

    const run = await pool.query(
      `INSERT INTO detection_runs (series_id, patient_id, status, candidate_count, created_at)
       VALUES ($1, $2, 'complete', 2, ${stamp}) RETURNING id`,
      [series.rows[0].id, patientId]
    );

    for (let i = 0; i < 2; i += 1) {
      await pool.query(
        `INSERT INTO detection_candidates
           (run_id, series_id, patient_id, voxel_i, voxel_j, voxel_k,
            x_mm, y_mm, z_mm, position_index, score_raw, created_at)
         VALUES ($1, $2, $3, 10, 20, 0, 1.0, 2.0, 3.0, 0, 0.5, ${stamp})`,
        [run.rows[0].id, series.rows[0].id, patientId]
      );
    }

    return absolute;
  } finally {
    await pool.end();
  }
}

async function countFor(patientId: number): Promise<Record<string, number>> {
  const pool = db();
  try {
    const rows: Record<string, number> = {};
    for (const [key, sql] of [
      ['studies', 'SELECT count(*)::int AS n FROM imaging_studies WHERE patient_id = $1'],
      ['series', 'SELECT count(*)::int AS n FROM imaging_series WHERE patient_id = $1'],
      [
        'instances',
        `SELECT count(*)::int AS n FROM imaging_instances i
           JOIN imaging_series s ON s.id = i.series_id WHERE s.patient_id = $1`,
      ],
      ['runs', 'SELECT count(*)::int AS n FROM detection_runs WHERE patient_id = $1'],
      ['candidates', 'SELECT count(*)::int AS n FROM detection_candidates WHERE patient_id = $1'],
    ] as Array<[string, string]>) {
      const result = await pool.query(sql, [patientId]);
      rows[key] = result.rows[0].n;
    }
    return rows;
  } finally {
    await pool.end();
  }
}

const IMAGING_CATEGORY = 'CT imaging series and detection candidates';

before(async () => {
  await startServer();
  expired = await registerPatient('eraseimgA');
  current = await registerPatient('eraseimgB');

  const staff = await registerPatient('eraseimgadm');
  await promote(staff.id, 'admin');
  admin = { session: await loginAs(staff.username), id: staff.id };

  // Seven years puts the first patient past the six-year hold; the second is
  // from today and must stay put.
  expiredObjectPath = await seedImaging(expired.id, 7);
  await seedImaging(current.id, 0);
}, { timeout: TIMEOUT });

after(async () => {
  try {
    const pool = db();
    try {
      const { rows } = await pool.query(
        `SELECT id FROM users WHERE left(username, ${TEST_USER_PREFIX.length}) = $1`,
        [TEST_USER_PREFIX]
      );
      const ids = rows.map((r: any) => r.id);
      if (ids.length) {
        // Children before parents, same order the erasure itself uses.
        await pool.query('DELETE FROM detection_candidates WHERE patient_id = ANY($1)', [ids]);
        await pool.query('DELETE FROM detection_runs WHERE patient_id = ANY($1)', [ids]);
        await pool.query(
          `DELETE FROM imaging_instances WHERE series_id IN
             (SELECT id FROM imaging_series WHERE patient_id = ANY($1))`,
          [ids]
        );
        await pool.query('DELETE FROM imaging_series WHERE patient_id = ANY($1)', [ids]);
        await pool.query('DELETE FROM imaging_studies WHERE patient_id = ANY($1)', [ids]);
        await pool.query('DELETE FROM erasure_requests WHERE patient_id = ANY($1) OR reviewed_by = ANY($1)', [ids]);
        await pool.query('DELETE FROM medical_scans WHERE patient_id = ANY($1)', [ids]);
        await pool.query('DELETE FROM notifications WHERE recipient_id = ANY($1) OR actor_id = ANY($1)', [ids]);
        await pool.query('DELETE FROM audit_events WHERE actor_user_id = ANY($1)', [ids]);
        await pool.query(`DELETE FROM session WHERE (sess -> 'user' ->> 'id')::int = ANY($1)`, [ids]);
        await pool.query('DELETE FROM users WHERE id = ANY($1)', [ids]);
      }
    } finally {
      await pool.end();
    }

    // The surviving patient's object was deliberately not erased, so this test
    // has to remove it rather than leaving test data in uploads/.
    for (const patient of [expired, current]) {
      const directory = path.join(process.cwd(), 'uploads', 'series', String(patient?.id ?? ''));
      await fs.promises.rm(directory, { recursive: true, force: true }).catch(() => {});
    }
  } finally {
    await stopServer();
  }
}, { timeout: TIMEOUT });

describe('erasure reaches imaging and detection (DPIA R-23)', { timeout: TIMEOUT }, () => {
  test('imaging appears in the assessment as its own category', async () => {
    const res = await current.session.get('/api/patient/me/erasure-assessment');
    assert.equal(res.status, 200);

    const imaging = res.json.categories.find((c: any) => c.category === IMAGING_CATEGORY);
    assert.ok(imaging, 'the imaging category is assessed at all');
    // One series, one run, two candidates.
    assert.equal(imaging.count, 4);
    assert.ok(imaging.reason.length > 20, 'the disposition explains itself');
  });

  test('a series with no scan still creates a clinical hold', async () => {
    // The hold used to be computed from medical_scans alone, so a patient with
    // imaging and no scan had no hold at all and their CT would have been
    // erased on request.
    const pool = db();
    try {
      const scans = await pool.query('SELECT id FROM medical_scans WHERE patient_id = $1', [
        current.id,
      ]);
      assert.equal(scans.rows.length, 0, 'this patient genuinely has no scans');
    } finally {
      await pool.end();
    }

    const res = await current.session.get('/api/patient/me/erasure-assessment');
    const imaging = res.json.categories.find((c: any) => c.category === IMAGING_CATEGORY);

    assert.equal(imaging.disposition, 'retained');
    assert.match(imaging.reason, /health record/i);
    assert.ok(res.json.clinicalHoldUntil, 'a hold date exists');
    assert.equal(
      new Date(res.json.clinicalHoldUntil).getFullYear(),
      new Date().getFullYear() + 6
    );
  });

  test('imaging past the retention period is erasable', async () => {
    const res = await expired.session.get('/api/patient/me/erasure-assessment');
    const imaging = res.json.categories.find((c: any) => c.category === IMAGING_CATEGORY);
    assert.equal(imaging.disposition, 'erased');
    assert.equal(imaging.count, 4);
  });

  test('executing removes the rows and the stored objects', async () => {
    assert.ok(fs.existsSync(expiredObjectPath), 'the object exists before erasure');

    const request = await expired.session.post('/api/patient/me/erasure-request', {
      notes: 'Remove my imaging.',
    });
    assert.equal(request.status, 200);

    const list = await admin.session.get('/api/admin/erasure-requests');
    const pending = list.json.find((r: any) => r.patientId === expired.id);
    assert.ok(pending, 'the request reached an administrator');

    const executed = await admin.session.post(
      `/api/admin/erasure-requests/${pending.id}/execute`,
      {}
    );
    assert.equal(executed.status, 200);

    const counts = await countFor(expired.id);
    assert.deepEqual(counts, { studies: 0, series: 0, instances: 0, runs: 0, candidates: 0 });

    assert.equal(
      fs.existsSync(expiredObjectPath),
      false,
      'the stored image object is gone, not just its row'
    );
  });

  test('another patient is untouched by it', async () => {
    const counts = await countFor(current.id);
    assert.deepEqual(counts, { studies: 1, series: 1, instances: 1, runs: 1, candidates: 2 });
  });

  test('the executed outcome reports the imaging category honestly', async () => {
    const list = await admin.session.get('/api/admin/erasure-requests');
    const done = list.json.find((r: any) => r.patientId === expired.id);
    assert.ok(done, 'the request is still listed after execution');
    assert.notEqual(done.status, 'pending');
  });
});
