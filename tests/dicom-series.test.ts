/**
 * POST /api/dicom/series — filing one CT study.
 *
 * Ingestion is not interpretation, and these tests pin both halves of that: a
 * real series is assembled, ordered, quality-gated and stored de-identified,
 * and nothing about the result reads as a statement about the patient.
 *
 * The de-identification assertions are why the fixture script prints the
 * ORIGINAL UIDs and PatientID. A test can only prove an identifier is absent
 * from a response, from a database row and from the stored bytes if it knows
 * what the identifier was.
 *
 * Two configurations share this file, selected by whether INFERENCE_URL is set
 * in the environment the server inherits:
 *
 *   unset — series ingestion has no subprocess fallback, deliberately. The
 *           request must be refused with the variable named, and nothing
 *           stored.
 *   set   — the whole path: assemble, order, gate, de-identify, store, record.
 *
 * Either way the access rules and the upload ceilings hold. The cases that
 * need the LIDC-IDRI download (gitignored) skip with a reason without it.
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  Session,
  TEST_USER_PREFIX,
  db,
  registerPatient,
  startServer,
  stopServer,
} from './helpers/server.ts';

/**
 * Ceilings small enough to reach in a test.
 *
 * Set here rather than left at their defaults because reaching the defaults
 * means pushing a gigabyte through a fetch to find out whether a comparison
 * works. `startServer()` runs later, in `before`, and hands the child whatever
 * this process's environment holds by then; none of these names appears in
 * `.env`, so nothing shadows them.
 *
 * None is below what the fixture series needs: 45 objects, 23.7 MB in total,
 * largest object 0.53 MB.
 */
const MAX_FILES = 64;
const MAX_FILE_BYTES = 4 * 1024 * 1024;
const MAX_TOTAL_BYTES = 32 * 1024 * 1024;
process.env.DICOM_SERIES_MAX_FILES = String(MAX_FILES);
process.env.DICOM_SERIES_MAX_FILE_BYTES = String(MAX_FILE_BYTES);
process.env.DICOM_SERIES_MAX_TOTAL_BYTES = String(MAX_TOTAL_BYTES);

const TIMEOUT = 300_000;
/** Ingestion is a per-slice round trip through the service; give it room. */
const INGEST_TIMEOUT_MS = 240_000;
const INFERENCE_CONFIGURED = Boolean(process.env.INFERENCE_URL);

interface SeriesFixture {
  patient: string;
  files: string[];
  instanceCount: number;
  originalSeriesInstanceUid: string;
  originalStudyInstanceUid: string;
  originalSopInstanceUid: string;
  originalPatientId: string;
}

/**
 * A real CT series, capped so the suite stays quick.
 *
 * 45 objects is deliberately just over the gate's 40-slice floor: enough to
 * pass it, few enough that a full ingest is a minute rather than ten.
 */
function resolveSeries(maxFiles: number, patient?: string): SeriesFixture | null {
  if (!fs.existsSync(path.join(process.cwd(), 'dataset', 'manifest-1600709154662'))) return null;
  const args = ['scripts/lidc_find_series.py', '--max-files', String(maxFiles)];
  if (patient) args.push('--patient', patient);
  const run = spawnSync(process.env.PYTHON_BIN || 'python', args, {
    encoding: 'utf8',
    timeout: 600_000,
  });
  if (run.status !== 0) return null;
  try {
    const parsed = JSON.parse(run.stdout.trim().split('\n').pop() ?? '');
    return parsed.error ? null : parsed;
  } catch {
    return null;
  }
}

const series = resolveSeries(45);
/** A second patient's series, for the two-series-in-one-upload case. */
const otherSeries = series ? resolveSeries(20, 'LIDC-IDRI-0003') : null;

const WITHOUT_DATASET = !series && 'LIDC-IDRI download absent (gitignored)';
const WITHOUT_SERVICE = !INFERENCE_CONFIGURED && 'INFERENCE_URL is not set';
const FULL_PATH = WITHOUT_DATASET || WITHOUT_SERVICE;

let patient: Awaited<ReturnType<typeof registerPatient>>;
let radSession: Session;
let ingestedSeriesId: number | null = null;

function blobFor(file: string): Blob {
  return new Blob([fs.readFileSync(path.join(process.cwd(), file))], {
    type: 'application/dicom',
  });
}

async function ingest(
  session: Session,
  files: string[],
  patientId: number | null
): Promise<{ status: number; json: any; text: string }> {
  const form = new FormData();
  for (const file of files) form.append('files', blobFor(file), path.basename(file));
  if (patientId !== null) form.append('patientId', String(patientId));
  return session.postForm('/api/dicom/series', form, INGEST_TIMEOUT_MS);
}

async function countSeries(patientId: number): Promise<number> {
  const pool = db();
  try {
    const { rows } = await pool.query(
      'SELECT count(*)::int AS n FROM imaging_series WHERE patient_id = $1',
      [patientId]
    );
    return rows[0].n;
  } finally {
    await pool.end();
  }
}

/**
 * Temporary directories a series upload stages identified objects into.
 *
 * The server runs as a child of this process and inherits its TMPDIR, so this
 * is the same directory the route stages into. Left-behind directories are the
 * observable form of "the identified original outlived the request".
 */
function stagingDirectories(): string[] {
  try {
    return fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith('healthai-dicom-'));
  } catch {
    return [];
  }
}

/**
 * Waits for the staging to go, rather than demanding it is already gone.
 *
 * The route removes the directory in a `finally`, which runs after the
 * response has been written — so a test that reads the temporary directory the
 * instant the reply lands sometimes catches a directory that is a millisecond
 * from deletion. That is a race in the assertion, not a leak, and it showed up
 * exactly once in four runs, on the largest upload. What is worth asserting is
 * that the identified objects do not survive the request by any meaningful
 * margin; three seconds is far longer than the removal takes and far shorter
 * than anything that would count as outliving it.
 */
async function assertStagingCleared(): Promise<void> {
  const deadline = Date.now() + 3000;
  let remaining = stagingDirectories();
  while (remaining.length && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 100));
    remaining = stagingDirectories();
  }
  assert.deepEqual(remaining, [], 'an identified upload outlived its request');
}

before(async () => {
  await startServer();
  patient = await registerPatient('series-patient');
  const radiologist = await registerPatient('series-rad');
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
      // The stored objects go before the rows that point at them, so a failure
      // here cannot leave a file nothing refers to.
      const objects = await pool.query(
        `SELECT object_path FROM imaging_instances WHERE series_id IN
           (SELECT id FROM imaging_series WHERE patient_id = ANY($1))`,
        [ids]
      );
      for (const row of objects.rows) {
        if (typeof row.object_path === 'string' && row.object_path.startsWith('file://')) {
          await fs.promises
            .unlink(path.join(process.cwd(), 'uploads', row.object_path.slice('file://'.length)))
            .catch(() => {});
        }
      }
      // And the directories they lived in. Unlinking the objects leaves
      // `uploads/series/<patientId>/<seriesUid>/` behind, and since the patient
      // id is new on every run they accumulate one empty tree per run.
      for (const id of ids) {
        await fs.promises
          .rm(path.join(process.cwd(), 'uploads', 'series', String(id)), {
            recursive: true,
            force: true,
          })
          .catch(() => {});
      }
      await pool.query(
        `DELETE FROM imaging_instances WHERE series_id IN
           (SELECT id FROM imaging_series WHERE patient_id = ANY($1))`,
        [ids]
      );
      await pool.query('DELETE FROM imaging_series WHERE patient_id = ANY($1)', [ids]);
      await pool.query('DELETE FROM imaging_studies WHERE patient_id = ANY($1)', [ids]);
      await pool.query(
        'DELETE FROM scan_regions WHERE scan_id IN (SELECT id FROM medical_scans WHERE patient_id = ANY($1)) OR created_by = ANY($1)',
        [ids]
      );
      await pool.query('DELETE FROM medical_scans WHERE patient_id = ANY($1)', [ids]);
      await pool.query('DELETE FROM processing_consents WHERE patient_id = ANY($1)', [ids]);
      await pool.query(
        'DELETE FROM notifications WHERE recipient_id = ANY($1) OR actor_id = ANY($1)',
        [ids]
      );
      await pool.query(
        'UPDATE audit_events SET actor_user_id = NULL WHERE actor_user_id = ANY($1)',
        [ids]
      );
      await pool.query('DELETE FROM users WHERE id = ANY($1)', [ids]);
    }
  } finally {
    await pool.end();
  }
  await stopServer();
});

// ── who may file a study ───────────────────────────────────────────────────

describe('who may ingest', { timeout: TIMEOUT }, () => {
  test('an anonymous caller cannot', async () => {
    const form = new FormData();
    form.append('files', new Blob([Buffer.from('x')]), 'a.dcm');
    const res = await new Session().postForm('/api/dicom/series', form);
    assert.equal(res.status, 401);
  });

  test('a patient cannot file a study, even their own', { skip: WITHOUT_DATASET }, async () => {
    const res = await ingest(patient.session, series!.files.slice(0, 2), patient.id);
    assert.equal(res.status, 403, res.text.slice(0, 300));
  });

  test('a clinician must name the patient the study belongs to', { skip: WITHOUT_DATASET }, async () => {
    const res = await ingest(radSession, series!.files.slice(0, 2), null);
    assert.equal(res.status, 400, res.text.slice(0, 300));
    assert.match(res.json.error, /patientId/i);
  });

  test('an unknown patient is refused', async () => {
    const form = new FormData();
    form.append('files', new Blob([Buffer.from('x')]), 'a.dcm');
    form.append('patientId', '2147483600');
    const res = await radSession.postForm('/api/dicom/series', form);
    assert.equal(res.status, 400, res.text.slice(0, 300));
    assert.match(res.json.error, /patient/i);
  });

  test('an empty upload is refused', async () => {
    const form = new FormData();
    form.append('patientId', String(patient.id));
    const res = await radSession.postForm('/api/dicom/series', form);
    assert.equal(res.status, 400);
  });
});

// ── without the resident service ───────────────────────────────────────────

describe('without the resident inference service', { timeout: TIMEOUT }, () => {
  test(
    'ingestion refuses, names the variable, and stores nothing',
    { skip: WITHOUT_DATASET || (INFERENCE_CONFIGURED && 'INFERENCE_URL is set') },
    async () => {
      const before = await countSeries(patient.id);
      const res = await ingest(radSession, series!.files, patient.id);
      assert.equal(res.status, 422, res.text.slice(0, 400));
      assert.equal(res.json.accepted, false);
      assert.equal(res.json.stage, 'service_unavailable');
      assert.equal(res.json.reasons[0].code, 'inference_unavailable');
      assert.match(res.json.reasons[0].message, /INFERENCE_URL/);
      // A refusal to file a study says nothing about the patient, and says so.
      assert.match(res.json.message, /NOT a finding/);
      assert.equal(await countSeries(patient.id), before, 'nothing was stored');
    }
  );
});

// ── the whole path ─────────────────────────────────────────────────────────

describe('with the resident inference service', { timeout: TIMEOUT }, () => {
  test('a real CT series is assembled, ordered, gated and stored', { skip: FULL_PATH }, async () => {
    const res = await ingest(radSession, series!.files, patient.id);
    assert.equal(res.status, 201, res.text.slice(0, 500));
    assert.equal(res.json.accepted, true);
    assert.equal(res.json.alreadyIngested, false);
    ingestedSeriesId = res.json.seriesId;

    assert.equal(res.json.instanceCount, series!.instanceCount);
    assert.equal(res.json.duplicatesDropped, 0);
    assert.equal(res.json.ordering.method, 'image_position_patient');
    assert.equal(res.json.ordering.trusted, true);
    assert.equal(res.json.qualityGate.passed, true);
    assert.deepEqual(res.json.qualityGate.failures, []);
    assert.equal(res.json.qualityGate.measurements.modality, 'CT');
    assert.equal(res.json.qualityGate.measurements.sliceCount, series!.instanceCount);
    assert.equal(res.json.ingestStatus, 'ingested');
    assert.ok(['deployment', 'ingestion'].includes(res.json.uidMappingScope));

    // Ingestion is not interpretation, and the response says so rather than
    // leaving the reader to infer it from the absence of a result.
    assert.match(res.json.message, /not an interpretation/i);
    assert.doesNotMatch(res.text, /malignan|cancer|diagnos|risk level/i);
  });

  test('no original identifier survives into the read endpoint', { skip: FULL_PATH }, async () => {
    assert.ok(ingestedSeriesId, 'the ingest ran first');
    const res = await radSession.get(`/api/dicom/series/${ingestedSeriesId}`);
    assert.equal(res.status, 200, res.text.slice(0, 300));
    for (const original of [
      series!.originalSeriesInstanceUid,
      series!.originalStudyInstanceUid,
      series!.originalSopInstanceUid,
      series!.originalPatientId,
    ]) {
      assert.ok(original.length > 3, 'the fixture actually carried this identifier');
      assert.ok(!res.text.includes(original), `the response leaks ${original}`);
    }
  });

  test('the stored rows carry the de-identified tree and no clinical field', { skip: FULL_PATH }, async () => {
    assert.ok(ingestedSeriesId);
    const pool = db();
    try {
      const { rows } = await pool.query(
        `SELECT s.*, st.study_uid FROM imaging_series s
           JOIN imaging_studies st ON st.id = s.study_id
          WHERE s.id = $1`,
        [ingestedSeriesId]
      );
      const row = rows[0];
      assert.ok(row, 'the series row exists');
      assert.equal(row.patient_id, patient.id);
      assert.equal(row.modality, 'CT');
      assert.equal(row.instance_count, series!.instanceCount);
      assert.equal(row.ordering_trusted, true);
      assert.equal(row.quality_gate_passed, true);
      assert.equal(row.ingest_status, 'ingested');

      // UUID-derived remaps under 2.25., never the source UIDs.
      assert.ok(row.series_uid.startsWith('2.25.'), `not remapped: ${row.series_uid}`);
      assert.ok(row.study_uid.startsWith('2.25.'), `not remapped: ${row.study_uid}`);
      assert.notEqual(row.series_uid, series!.originalSeriesInstanceUid);
      assert.notEqual(row.study_uid, series!.originalStudyInstanceUid);

      const instances = await pool.query(
        'SELECT * FROM imaging_instances WHERE series_id = $1 ORDER BY position_index',
        [ingestedSeriesId]
      );
      assert.equal(instances.rows.length, series!.instanceCount);
      assert.deepEqual(
        instances.rows.map((r: any) => r.position_index),
        instances.rows.map((_: any, i: number) => i)
      );
      // Ordered by anatomy: the projected positions increase monotonically.
      const positions = instances.rows.map((r: any) => Number(r.position_mm));
      assert.deepEqual(positions, [...positions].sort((a, b) => a - b));
      for (const instance of instances.rows) {
        assert.ok(instance.sop_uid.startsWith('2.25.'));
        assert.notEqual(instance.sop_uid, series!.originalSopInstanceUid);
      }
      // Distinct instances keep distinct identities: a remap that collided
      // would silently collapse a series into fewer slices than it has.
      assert.equal(new Set(instances.rows.map((r: any) => r.sop_uid)).size, instances.rows.length);
    } finally {
      await pool.end();
    }
  });

  test('the bytes written to storage are the de-identified ones', { skip: FULL_PATH }, async () => {
    assert.ok(ingestedSeriesId);
    const pool = db();
    let objectPath: string;
    try {
      const { rows } = await pool.query(
        'SELECT object_path FROM imaging_instances WHERE series_id = $1 ORDER BY position_index LIMIT 1',
        [ingestedSeriesId]
      );
      objectPath = rows[0].object_path;
    } finally {
      await pool.end();
    }
    if (!objectPath.startsWith('file://')) return; // an object store; nothing local to read

    const stored = fs.readFileSync(
      path.join(process.cwd(), 'uploads', objectPath.slice('file://'.length))
    );
    assert.ok(
      stored.includes(Buffer.from('HealthAI best-effort PS3.15 Basic Profile')),
      'the stored object records how it was de-identified'
    );
    for (const original of [
      series!.originalSeriesInstanceUid,
      series!.originalStudyInstanceUid,
      series!.originalPatientId,
    ]) {
      assert.ok(!stored.includes(Buffer.from(original)), `the stored object leaks ${original}`);
    }
  });

  test('the identified upload does not outlive the request', { skip: FULL_PATH }, async () => {
    await assertStagingCleared();
  });

  test('re-ingesting the same series is recognised, not duplicated', { skip: FULL_PATH }, async () => {
    const before = await countSeries(patient.id);
    const res = await ingest(radSession, series!.files, patient.id);
    assert.equal(res.status, 200, res.text.slice(0, 400));
    assert.equal(res.json.accepted, true);
    assert.equal(res.json.alreadyIngested, true);
    assert.equal(res.json.seriesId, ingestedSeriesId);
    assert.match(res.json.message, /already ingested/i);
    assert.equal(await countSeries(patient.id), before, 'no second series row');

    const pool = db();
    try {
      const { rows } = await pool.query(
        'SELECT count(*)::int AS n FROM imaging_instances WHERE series_id = $1',
        [ingestedSeriesId]
      );
      assert.equal(rows[0].n, series!.instanceCount, 'no duplicated instance rows');

      // And the objects those rows point at are still there.
      //
      // The object name is derived from patient, de-identified series UID and
      // position, all of which are deterministic — so a re-ingest writes the
      // *same* paths, not a second copy. Cleaning up "the objects this run
      // wrote" therefore deletes the ones the first ingestion's rows
      // reference, and the series becomes a set of rows pointing at nothing.
      const objects = await pool.query(
        'SELECT object_path FROM imaging_instances WHERE series_id = $1 ORDER BY position_index',
        [ingestedSeriesId]
      );
      const missing = objects.rows
        .map((r: any) => r.object_path)
        .filter(
          (p: string) =>
            typeof p === 'string' &&
            p.startsWith('file://') &&
            !fs.existsSync(path.join(process.cwd(), 'uploads', p.slice('file://'.length)))
        );
      assert.deepEqual(missing, [], 're-ingestion deleted objects the stored rows point at');
    } finally {
      await pool.end();
    }
  });

  test('the series reads back with its geometry and no finding', { skip: FULL_PATH }, async () => {
    assert.ok(ingestedSeriesId);
    const res = await radSession.get(`/api/dicom/series/${ingestedSeriesId}`);
    assert.equal(res.status, 200, res.text.slice(0, 300));
    assert.equal(res.json.modality, 'CT');
    assert.equal(res.json.instanceCount, series!.instanceCount);
    assert.equal(res.json.instances.length, series!.instanceCount);
    assert.equal(res.json.ordering.trusted, true);
    assert.equal(res.json.qualityGate.passed, true);
    assert.ok(res.json.seriesInstanceUid.startsWith('2.25.'));
    assert.equal(res.json.geometry.rows, 512);
    assert.ok(Number(res.json.geometry.medianSpacingMm) > 0);
    assert.match(res.json.note, /no clinical finding/i);
  });

  test('a patient cannot read an ingested series', { skip: FULL_PATH }, async () => {
    assert.ok(ingestedSeriesId);
    const res = await patient.session.get(`/api/dicom/series/${ingestedSeriesId}`);
    assert.ok([403, 404].includes(res.status), `${res.status}: ${res.text.slice(0, 200)}`);
  });

  // ── refusals, each of which must store nothing ───────────────────────────

  test('two series in one upload are refused, not merged', { skip: FULL_PATH }, async () => {
    if (!otherSeries) return; // only one patient's objects downloaded
    assert.notEqual(otherSeries.originalSeriesInstanceUid, series!.originalSeriesInstanceUid);

    const before = await countSeries(patient.id);
    const res = await ingest(
      radSession,
      [...series!.files.slice(0, 20), ...otherSeries.files.slice(0, 20)],
      patient.id
    );
    assert.equal(res.status, 422, res.text.slice(0, 400));
    assert.equal(res.json.accepted, false);
    assert.equal(res.json.stage, 'mixed_series');
    assert.equal(res.json.reasons[0].code, 'mixed_series');
    assert.match(res.json.message, /NOT a finding/);
    // Counts, never the original UIDs, even in a rejection.
    assert.ok(!res.text.includes(series!.originalSeriesInstanceUid));
    assert.ok(!res.text.includes(otherSeries.originalSeriesInstanceUid));
    assert.equal(await countSeries(patient.id), before, 'a refused upload stores nothing');
  });

  test('a series with too few slices is refused by the gate', { skip: FULL_PATH }, async () => {
    const before = await countSeries(patient.id);
    const res = await ingest(radSession, series!.files.slice(0, 5), patient.id);
    assert.equal(res.status, 422, res.text.slice(0, 400));
    assert.equal(res.json.accepted, false);
    assert.equal(res.json.stage, 'quality_gate');
    const codes = res.json.qualityGate.failures.map((f: any) => f.code);
    assert.ok(codes.includes('too_few_slices'), JSON.stringify(codes));
    // Every failure carries a code and a sentence somebody can act on.
    for (const failure of res.json.qualityGate.failures) {
      assert.ok(failure.message.length > 30, failure.code);
    }
    assert.equal(await countSeries(patient.id), before, 'a gated series stores nothing');
  });

  test('a file that is not DICOM is refused before anything is stored', { skip: FULL_PATH }, async () => {
    const before = await countSeries(patient.id);
    const form = new FormData();
    form.append('files', new Blob([Buffer.from('not a DICOM object at all')]), 'a.dcm');
    for (const file of series!.files.slice(0, 20)) {
      form.append('files', blobFor(file), path.basename(file));
    }
    form.append('patientId', String(patient.id));
    const res = await radSession.postForm('/api/dicom/series', form, INGEST_TIMEOUT_MS);
    assert.equal(res.status, 422, res.text.slice(0, 400));
    assert.equal(res.json.reasons[0].code, 'not_dicom');
    assert.equal(await countSeries(patient.id), before);
  });
});

// ── the ceilings on one upload ─────────────────────────────────────────────

describe('upload limits', { timeout: TIMEOUT }, () => {
  test('one object above the per-object limit is refused, with the limit named', async () => {
    const form = new FormData();
    form.append('files', new Blob([Buffer.alloc(MAX_FILE_BYTES + 64 * 1024)]), 'huge.dcm');
    form.append('patientId', String(patient.id));
    const res = await radSession.postForm('/api/dicom/series', form, INGEST_TIMEOUT_MS);
    assert.equal(res.status, 413, res.text.slice(0, 300));
    assert.match(res.json.error, /per-object limit/i);
    assert.match(res.json.error, /Nothing was stored/i);
    await assertStagingCleared();
  });

  test('more objects than the per-series cap are refused', async () => {
    const form = new FormData();
    for (let i = 0; i <= MAX_FILES; i++) {
      form.append('files', new Blob([Buffer.from('x')]), `${i}.dcm`);
    }
    form.append('patientId', String(patient.id));
    const res = await radSession.postForm('/api/dicom/series', form, INGEST_TIMEOUT_MS);
    assert.equal(res.status, 413, res.text.slice(0, 300));
    assert.match(res.json.error, new RegExp(`${MAX_FILES} objects`));
    await assertStagingCleared();
  });

  test('an upload above the total limit is refused before the service sees it', async () => {
    const perFile = 4 * 1024 * 1024 - 1024;
    const count = Math.ceil(MAX_TOTAL_BYTES / perFile) + 1;
    const form = new FormData();
    for (let i = 0; i < count; i++) {
      form.append('files', new Blob([Buffer.alloc(perFile)]), `${i}.dcm`);
    }
    form.append('patientId', String(patient.id));
    const res = await radSession.postForm('/api/dicom/series', form, INGEST_TIMEOUT_MS);
    assert.equal(res.status, 413, res.text.slice(0, 300));
    assert.match(res.json.error, /limit for one series/i);
    await assertStagingCleared();
  });
});

// ── what the platform says it can do ───────────────────────────────────────

describe('the capability manifest describes what exists', { timeout: TIMEOUT }, () => {
  test('series ingest is current; receiving from a PACS is not', async () => {
    const res = await new Session().get('/api/capabilities');
    const capabilities = res.json.capabilities as any[];

    const ingest = capabilities.find((c) => c.id === 'dicom-ingest');
    assert.ok(ingest);
    // Not CURRENT. That status is a claim about a measured, fingerprint-bound
    // model, and series ingest has no model in it — the guard in
    // tests/capability-claims.test.ts holds the line, and this asserts the
    // same thing from the other side.
    assert.equal(ingest.status, 'IN_DEVELOPMENT');
    assert.equal(ingest.scanType, null);
    assert.equal(ingest.modelClass, null);
    assert.match(ingest.evidence, /series/i);
    assert.match(ingest.evidence, /does not receive from a PACS/i);
    assert.match(ingest.evidence, /does not build a volume/i);
    assert.match(ingest.evidence, /carries no finding about the patient/i);

    // The gap is its own row rather than something to infer from the absence
    // of one.
    const receive = capabilities.find((c) => c.id === 'dicom-network-receive');
    assert.ok(receive, 'DICOM network receive is declared');
    assert.equal(receive.status, 'PLANNED');

    // Ingestion working is not a claim about anything downstream of it.
    assert.equal(capabilities.find((c) => c.id === 'ct-volume').status, 'PLANNED');
    assert.equal(capabilities.find((c) => c.id === 'lung-nodule-detection').status, 'PLANNED');
    assert.equal(capabilities.find((c) => c.id === 'lung-nodule-segmentation').status, 'PLANNED');
  });
});
