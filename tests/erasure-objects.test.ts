/**
 * Erasure and the stored objects: scan images, and objects that will not go.
 *
 * Two defects, found in the audit of 2026-09-28 and pinned here:
 *
 *   1. Scan images were never removed. Erasure deleted every `medical_scans`
 *      row and left the image each row pointed at in `uploads/` or the bucket —
 *      the pixel data the data subject asked to have deleted, still present,
 *      with nothing left pointing at it.
 *
 *   2. An object that could not be deleted lost its row anyway. The imaging
 *      path reported the category as retained, correctly, but then deleted the
 *      instance rows regardless, so an administrator asked to resolve it had
 *      no record of which objects remained (DPIA R-23 residual).
 *
 * The rule both now follow is the one erasure.ts already stated: objects before
 * rows, and a row is deleted only once its object is gone. A row whose object
 * could not be removed stays, the category is reported as retained, and the
 * failed locations are written to the audit trail for an administrator.
 *
 * A deletion is made to fail with an unrecognised storage scheme, which
 * `removeStoredObject` refuses — a real refusal path, not a mock.
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
const SCANS = 'Screening scans and findings';
const IMAGING = 'CT imaging series and detection candidates';
const UNREMOVABLE = 'nosuch://unreachable-store/object';

let clean: Awaited<ReturnType<typeof registerPatient>>;
let stuck: Awaited<ReturnType<typeof registerPatient>>;
let recovering: Awaited<ReturnType<typeof registerPatient>>;
let recoveringBlocker = '';
let admin: { session: Session; id: number };
const files: Record<string, string[]> = { clean: [], stuck: [] };

async function query(sql: string, params: unknown[] = []): Promise<any[]> {
  const pool = db();
  try {
    return (await pool.query(sql, params)).rows;
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

async function placeFile(patientId: number, name: string): Promise<{ uri: string; absolute: string }> {
  const objectName = `erasure-test/${patientId}/${name}`;
  const absolute = path.join(process.cwd(), 'uploads', objectName);
  await fs.promises.mkdir(path.dirname(absolute), { recursive: true });
  await fs.promises.writeFile(absolute, Buffer.from('placeholder pixels'));
  return { uri: `file://${objectName}`, absolute };
}

/** Seven years old, so the six-year clinical hold has expired. */
async function seedScan(patientId: number, imagePath: string): Promise<void> {
  await query(
    `INSERT INTO medical_scans (patient_id, scan_type, result, status, image_path, created_at)
     VALUES ($1, 'skin', 'test', 'completed', $2, now() - interval '7 years')`,
    [patientId, imagePath]
  );
}

async function seedSeries(patientId: number, objectPaths: string[]): Promise<void> {
  const uid = `2.25.${patientId}${Date.now() % 100000}`;
  const stamp = `now() - interval '7 years'`;
  const [study] = await query(
    `INSERT INTO imaging_studies (patient_id, study_uid, study_year, created_at)
     VALUES ($1, $2, '2019', ${stamp}) RETURNING id`,
    [patientId, `${uid}.1`]
  );
  const [series] = await query(
    `INSERT INTO imaging_series
       (study_id, patient_id, series_uid, modality, instance_count, ordering_method,
        ordering_trusted, quality_gate_passed, uid_mapping_scope, created_at)
     VALUES ($1, $2, $3, 'CT', $4, 'image_position_patient', true, true, 'deployment', ${stamp})
     RETURNING id`,
    [study.id, patientId, `${uid}.2`, objectPaths.length]
  );
  for (const [index, objectPath] of objectPaths.entries()) {
    await query(
      `INSERT INTO imaging_instances (series_id, position_index, sop_uid, position_mm, object_path, created_at)
       VALUES ($1, $2, $3, $4, $5, ${stamp})`,
      [series.id, index, `${uid}.3.${index}`, index * 1.0, objectPath]
    );
  }
  const [run] = await query(
    `INSERT INTO detection_runs (series_id, patient_id, status, candidate_count, created_at)
     VALUES ($1, $2, 'complete', 1, ${stamp}) RETURNING id`,
    [series.id, patientId]
  );
  await query(
    `INSERT INTO detection_candidates
       (run_id, series_id, patient_id, voxel_i, voxel_j, voxel_k,
        x_mm, y_mm, z_mm, position_index, score_raw, created_at)
     VALUES ($1, $2, $3, 1, 2, 0, 1.0, 2.0, 3.0, 0, 0.5, ${stamp})`,
    [run.id, series.id, patientId]
  );
}

async function counts(patientId: number): Promise<Record<string, number>> {
  const n = async (sql: string) => (await query(sql, [patientId]))[0].n as number;
  return {
    scans: await n('SELECT count(*)::int AS n FROM medical_scans WHERE patient_id = $1'),
    studies: await n('SELECT count(*)::int AS n FROM imaging_studies WHERE patient_id = $1'),
    series: await n('SELECT count(*)::int AS n FROM imaging_series WHERE patient_id = $1'),
    instances: await n(
      `SELECT count(*)::int AS n FROM imaging_instances i
         JOIN imaging_series s ON s.id = i.series_id WHERE s.patient_id = $1`
    ),
    runs: await n('SELECT count(*)::int AS n FROM detection_runs WHERE patient_id = $1'),
    candidates: await n('SELECT count(*)::int AS n FROM detection_candidates WHERE patient_id = $1'),
  };
}

async function eraseViaAdmin(patient: typeof clean): Promise<any> {
  const request = await patient.session.post('/api/patient/me/erasure-request', {});
  assert.equal(request.status, 200);
  const list = await admin.session.get('/api/admin/erasure-requests');
  const pending = list.json.find((r: any) => r.patientId === patient.id && r.status === 'pending');
  assert.ok(pending, 'the request reached an administrator');
  const executed = await admin.session.post(`/api/admin/erasure-requests/${pending.id}/execute`, {});
  assert.equal(executed.status, 200);
  return executed.json;
}

const disposition = (outcome: any, category: string) =>
  outcome.outcome.categories.find((c: any) => c.category === category);

before(async () => {
  await startServer();
  clean = await registerPatient('eraseobjA');
  stuck = await registerPatient('eraseobjB');
  recovering = await registerPatient('eraseobjC');
  const staff = await registerPatient('eraseobjadm');
  await query('UPDATE users SET role = $1 WHERE id = $2', ['admin', staff.id]);
  admin = { session: await loginAs(staff.username), id: staff.id };

  // Everything removable.
  const scanImage = await placeFile(clean.id, 'scan.jpg');
  const instance = await placeFile(clean.id, '00000.dcm');
  files.clean.push(scanImage.absolute, instance.absolute);
  await seedScan(clean.id, scanImage.uri);
  await seedSeries(clean.id, [instance.uri]);

  // One removable and one unremovable object in each category.
  const goodScan = await placeFile(stuck.id, 'scan-ok.jpg');
  const goodInstance = await placeFile(stuck.id, '00000.dcm');
  files.stuck.push(goodScan.absolute, goodInstance.absolute);
  await seedScan(stuck.id, goodScan.uri);
  await seedScan(stuck.id, `${UNREMOVABLE}/scan.jpg`);
  await seedSeries(stuck.id, [goodInstance.uri, `${UNREMOVABLE}/00001.dcm`]);

  // An object that cannot be removed now and can later: a directory where a
  // file is expected makes unlink fail (EPERM/EISDIR), and removing the
  // directory stands in for the storage coming back.
  const blockerName = `erasure-test/${recovering.id}/blocked.jpg`;
  recoveringBlocker = path.join(process.cwd(), 'uploads', blockerName);
  await fs.promises.mkdir(path.join(recoveringBlocker, 'inside'), { recursive: true });
  await seedScan(recovering.id, `file://${blockerName}`);
}, { timeout: TIMEOUT });

after(async () => {
  try {
    const rows = await query(
      `SELECT id FROM users WHERE left(username, ${TEST_USER_PREFIX.length}) = $1`,
      [TEST_USER_PREFIX]
    );
    const ids = rows.map((r: any) => r.id);
    if (ids.length) {
      await query('DELETE FROM detection_candidates WHERE patient_id = ANY($1)', [ids]);
      await query('DELETE FROM detection_runs WHERE patient_id = ANY($1)', [ids]);
      await query(
        `DELETE FROM imaging_instances WHERE series_id IN
           (SELECT id FROM imaging_series WHERE patient_id = ANY($1))`,
        [ids]
      );
      await query('DELETE FROM imaging_series WHERE patient_id = ANY($1)', [ids]);
      await query('DELETE FROM imaging_studies WHERE patient_id = ANY($1)', [ids]);
      await query('DELETE FROM erasure_requests WHERE patient_id = ANY($1) OR reviewed_by = ANY($1)', [ids]);
      await query('DELETE FROM medical_scans WHERE patient_id = ANY($1)', [ids]);
      await query('DELETE FROM notifications WHERE recipient_id = ANY($1) OR actor_id = ANY($1)', [ids]);
      for (const id of ids) {
        await query(`DELETE FROM audit_events WHERE action = 'ERASURE_OBJECTS_RETAINED' AND detail LIKE $1`, [
          `patient ${id} %`,
        ]);
      }
      await query('DELETE FROM audit_events WHERE actor_user_id = ANY($1)', [ids]);
      await query(`DELETE FROM session WHERE (sess -> 'user' ->> 'id')::int = ANY($1)`, [ids]);
      await query('DELETE FROM users WHERE id = ANY($1)', [ids]);
    }
    for (const patient of [clean, stuck, recovering]) {
      await fs.promises
        .rm(path.join(process.cwd(), 'uploads', 'erasure-test', String(patient?.id ?? '')), {
          recursive: true,
          force: true,
        })
        .catch(() => {});
    }
  } finally {
    await stopServer();
  }
}, { timeout: TIMEOUT });

describe('erasure removes stored objects, and keeps the record of any it cannot', { timeout: TIMEOUT }, () => {
  test('scan images are removed along with their rows', async () => {
    for (const file of files.clean) assert.ok(fs.existsSync(file), 'objects exist before erasure');

    const outcome = await eraseViaAdmin(clean);

    assert.deepEqual(await counts(clean.id), {
      scans: 0, studies: 0, series: 0, instances: 0, runs: 0, candidates: 0,
    });
    for (const file of files.clean) {
      assert.equal(fs.existsSync(file), false, `${path.basename(file)} is gone, not just its row`);
    }
    assert.equal(disposition(outcome, SCANS).disposition, 'erased');
    assert.equal(disposition(outcome, IMAGING).disposition, 'erased');
  });

  test('a row whose object cannot be removed is kept, and only that row', async () => {
    const outcome = await eraseViaAdmin(stuck);

    for (const file of files.stuck) {
      assert.equal(fs.existsSync(file), false, `${path.basename(file)} was removable and is gone`);
    }
    assert.deepEqual(await counts(stuck.id), {
      scans: 1, // the one whose image could not be removed
      studies: 1, // kept because an instance in it is kept
      series: 1,
      instances: 1, // the unremovable one
      runs: 0, // derived results go regardless
      candidates: 0,
    });
    const [kept] = await query('SELECT image_path FROM medical_scans WHERE patient_id = $1', [stuck.id]);
    assert.ok(kept.image_path.startsWith(UNREMOVABLE), 'the kept scan row is the stuck one');
    const [instance] = await query(
      `SELECT i.object_path FROM imaging_instances i
         JOIN imaging_series s ON s.id = i.series_id WHERE s.patient_id = $1`,
      [stuck.id]
    );
    assert.ok(instance.object_path.startsWith(UNREMOVABLE), 'the kept instance row is the stuck one');

    assert.equal(disposition(outcome, SCANS).disposition, 'retained');
    assert.equal(disposition(outcome, IMAGING).disposition, 'retained');
    assert.match(disposition(outcome, SCANS).reason, /NOT been fully erased/);
    assert.equal(outcome.status, 'partially_completed');
  });

  test('the failed locations are in the audit trail for an administrator', async () => {
    const rows = await query(
      `SELECT detail FROM audit_events WHERE action = 'ERASURE_OBJECTS_RETAINED' AND detail LIKE $1`,
      [`patient ${stuck.id} %`]
    );
    const detail = rows.map((r: any) => r.detail).join('\n');
    assert.ok(detail.includes(`${UNREMOVABLE}/scan.jpg`), 'the scan image location is recorded');
    assert.ok(detail.includes(`${UNREMOVABLE}/00001.dcm`), 'the instance location is recorded');
  });

  test('the data subject is told a count, not internal storage locations', async () => {
    const list = await admin.session.get('/api/admin/erasure-requests');
    const request = list.json.find((r: any) => r.patientId === stuck.id);
    const outcome = typeof request.outcome === 'string' ? JSON.parse(request.outcome) : request.outcome;
    const text = JSON.stringify(outcome);
    assert.equal(text.includes(UNREMOVABLE), false, 'no storage URI in the outcome');
  });
});

describe('retrying objects an erasure could not remove', { timeout: TIMEOUT }, () => {
  let requestId: number;

  test('the first execution keeps the row whose image would not go', async () => {
    const outcome = await eraseViaAdmin(recovering);
    assert.equal(disposition(outcome, SCANS).disposition, 'retained');
    assert.equal((await counts(recovering.id)).scans, 1);
    const list = await admin.session.get('/api/admin/erasure-requests');
    requestId = list.json.find((r: any) => r.patientId === recovering.id).id;
  });

  test('a patient cannot trigger a retry', async () => {
    const res = await recovering.session.post(`/api/admin/erasure-requests/${requestId}/retry-objects`, {});
    assert.ok([401, 403].includes(res.status), `status ${res.status}`);
  });

  test('a request that has not been executed cannot be retried', async () => {
    const other = await registerPatient('eraseobjD');
    const filed = await other.session.post('/api/patient/me/erasure-request', {});
    assert.equal(filed.status, 200);
    const list = await admin.session.get('/api/admin/erasure-requests');
    const pending = list.json.find((r: any) => r.patientId === other.id);
    const res = await admin.session.post(`/api/admin/erasure-requests/${pending.id}/retry-objects`, {});
    assert.equal(res.status, 409);
  });

  test('while the object still will not go, the retry keeps the row and says so', async () => {
    const res = await admin.session.post(`/api/admin/erasure-requests/${requestId}/retry-objects`, {});
    assert.equal(res.status, 200, res.text.slice(0, 300));
    assert.equal(res.json.status, 'partially_completed');
    assert.equal(disposition(res.json, SCANS).disposition, 'retained');
    assert.equal((await counts(recovering.id)).scans, 1);
  });

  test('once the object can go, the retry removes it and its row', async () => {
    await fs.promises.rm(recoveringBlocker, { recursive: true, force: true });
    const res = await admin.session.post(`/api/admin/erasure-requests/${requestId}/retry-objects`, {});
    assert.equal(res.status, 200, res.text.slice(0, 300));
    assert.deepEqual(res.json.retried, [SCANS]);
    assert.equal(disposition(res.json, SCANS).disposition, 'erased');
    assert.equal((await counts(recovering.id)).scans, 0);
    assert.equal(fs.existsSync(recoveringBlocker), false);
  });

  test('every retry is in the audit trail', async () => {
    const rows = await query(
      `SELECT detail FROM audit_events WHERE action = 'ERASURE_RETRY_COMPLETED' AND detail LIKE $1`,
      [`request ${requestId} %`]
    );
    assert.equal(rows.length, 2);
  });

  test('an unremovable object is still retained after a retry', async () => {
    const list = await admin.session.get('/api/admin/erasure-requests');
    const request = list.json.find((r: any) => r.patientId === stuck.id);
    const res = await admin.session.post(`/api/admin/erasure-requests/${request.id}/retry-objects`, {});
    assert.equal(res.status, 200, res.text.slice(0, 300));
    assert.equal(disposition(res.json, SCANS).disposition, 'retained');
    assert.equal(disposition(res.json, IMAGING).disposition, 'retained');
    assert.equal((await counts(stuck.id)).instances, 1);
  });
});
