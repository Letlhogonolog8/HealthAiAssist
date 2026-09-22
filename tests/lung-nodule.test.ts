/**
 * The lung nodule characteriser, route 1: a clinician marks a nodule on a CT
 * slice and the platform returns a probability with everything needed to
 * weigh it — and refuses everything else.
 *
 * Two configurations share this file, selected by whether INFERENCE_URL is set
 * in the environment the server inherits:
 *
 *   unset  — the characteriser has no subprocess fallback (deliberately: the
 *            withdrawn lung model's fallback degraded its input). The request
 *            must be refused with the variable named, and the scan stored and
 *            queued.
 *   set    — the full path: DICOM in, de-identified object persisted, the
 *            structured record on the row, the mark recorded, the explanation
 *            re-run over the mark.
 *
 * Either way the access rule holds: a patient cannot mark their own nodule.
 *
 * Needs the LIDC-IDRI download (gitignored); skips without it. The slice and
 * its labelled centre are resolved by scripts/lidc_find_nodule_slice.py from
 * the same label table the model was trained from.
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
const INFERENCE_CONFIGURED = Boolean(process.env.INFERENCE_URL);

interface NoduleSlice {
  path: string;
  cx: number;
  cy: number;
  noduleId: string;
  patientId: string;
  patientName: string;
}

/** A held-out nodule and the object it sits on, or null without the dataset. */
function resolveNodule(): NoduleSlice | null {
  if (!fs.existsSync(path.join(process.cwd(), 'dataset', 'lidc-labels.csv'))) return null;
  const run = spawnSync(process.env.PYTHON_BIN || 'python', ['scripts/lidc_find_nodule_slice.py'], {
    encoding: 'utf8',
    timeout: 120_000,
  });
  if (run.status !== 0) return null;
  const line = run.stdout.trim().split('\n').pop() ?? '';
  try {
    const parsed = JSON.parse(line);
    return parsed.error ? null : parsed;
  } catch {
    return null;
  }
}

const nodule = resolveNodule();
const SKIN_PNG = 'dataset/dataset/data/test/benign';

let patient: Awaited<ReturnType<typeof registerPatient>>;
let radSession: Session;
let analysedScanId: number | null = null;

async function submit(
  session: Session,
  bytes: Buffer,
  name: string,
  extra: Record<string, string> = {}
): Promise<{ status: number; json: any; text: string }> {
  const form = new FormData();
  form.append('image', new Blob([bytes], { type: 'application/octet-stream' }), name);
  form.append('scanType', 'lung_nodule');
  for (const [k, v] of Object.entries(extra)) form.append(k, v);
  return session.postForm('/api/scans/analyze', form);
}

before(async () => {
  await startServer();
  patient = await registerPatient('nodule-patient');
  const radiologist = await registerPatient('nodule-rad');
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
  assert.equal((await patient.session.post('/api/scans/analysis-consent', { granted: true })).status, 200);
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
        'DELETE FROM scan_regions WHERE scan_id IN (SELECT id FROM medical_scans WHERE patient_id = ANY($1)) OR created_by = ANY($1)',
        [ids]
      );
      await pool.query('DELETE FROM medical_scans WHERE patient_id = ANY($1)', [ids]);
      await pool.query('DELETE FROM processing_consents WHERE patient_id = ANY($1)', [ids]);
      await pool.query('DELETE FROM notifications WHERE recipient_id = ANY($1) OR actor_id = ANY($1)', [ids]);
      await pool.query('UPDATE audit_events SET actor_user_id = NULL WHERE actor_user_id = ANY($1)', [ids]);
      await pool.query('DELETE FROM users WHERE id = ANY($1)', [ids]);
    }
  } finally {
    await pool.end();
  }
  await stopServer();
});

// ---------------------------------------------------------------------------

describe('governance', { timeout: TIMEOUT }, () => {
  test('the nodule model serves under VALIDATION terms, bound and re-measured', async () => {
    const res = await new Session().get('/api/models/cards');
    const card = res.json.models.find((m: any) => m.scanType === 'lung_nodule');
    assert.ok(card, 'lung_nodule is registered');
    assert.equal(card.enabled, true);
    assert.equal(card.status, 'VALIDATION', 'small evidence base: validation terms, not current');
    assert.equal(card.modelClass, 'INTERNAL_VALIDATION');
    assert.equal(card.clinicallyValidated, false);
    assert.equal(card.measurementBinding.verification, 're_measured');
    const { MEASUREMENT_BINDINGS } = await import('../server/model-governance.ts');
    assert.match(MEASUREMENT_BINDINGS.lung_nodule.note, /verify-lung-nodule-operating-point\.py/);
    // The figures on the card are the per-nodule ones, with their sample size.
    assert.equal(card.evaluation.sensitivity, 0.8621);
    assert.equal(card.evaluation.specificity, 0.6912);
    assert.match(card.evaluation.dataset, /97 nodules/);
    assert.match(card.evaluation.caveats, /29/);
    assert.match(card.evaluation.caveats, /not clinically validated/i);
    assert.match(card.evaluation.caveats, /does not check that the marked region is a nodule|not that the marked region is a nodule/i);
    if (fs.existsSync(path.join(process.cwd(), 'dataset', 'lung_nodule_model', 'resnet50v2_lung_nodule_model.h5'))) {
      assert.equal(card.figuresDescribeDeployedArtifact, true, 'the artifact on disk is the measured one');
    }
  });

  test('the manifest shows characterisation under validation and detection as planned', async () => {
    const res = await new Session().get('/api/capabilities');
    const cap = res.json.capabilities.find((c: any) => c.scanType === 'lung_nodule');
    assert.ok(cap);
    if (cap.status === 'VALIDATION') {
      assert.equal(cap.stages.CHARACTERIZE, 'VALIDATION');
      assert.equal(cap.stages.DETECT, 'PLANNED');
      assert.equal(cap.stages.SEGMENT, 'PLANNED');
    } else {
      // Without the artifact the manifest must say so rather than claim validation.
      assert.equal(cap.status, 'DISABLED');
    }
  });
});

describe('who may mark', { timeout: TIMEOUT }, () => {
  test('a patient cannot mark a nodule on their own scan', async (t) => {
    if (!nodule) return t.skip('LIDC dataset not present');
    const res = await submit(patient.session, fs.readFileSync(nodule.path), 'slice.dcm', {
      cx: String(nodule.cx),
      cy: String(nodule.cy),
    });
    assert.equal(res.status, 403, res.text.slice(0, 200));
    assert.match(res.json.error, /clinician/i);
  });

  test('a clinician must mark before asking', async (t) => {
    if (!nodule) return t.skip('LIDC dataset not present');
    const res = await submit(radSession, fs.readFileSync(nodule.path), 'slice.dcm', {
      patientId: String(patient.id),
    });
    if (!INFERENCE_CONFIGURED) {
      // The service gate comes first; the mark is checked by the analysis.
      assert.ok([422, 503].includes(res.status), res.text.slice(0, 200));
      return;
    }
    assert.equal(res.status, 422, res.text.slice(0, 200));
    assert.match(res.json.reasons.join(' '), /mark the nodule/i);
    assert.match(res.json.message, /NOT a negative result/);
  });
});

describe('without the resident inference service', { timeout: TIMEOUT }, () => {
  test(
    'refuses with the variable named, and the scan is stored and queued',
    { skip: (!nodule && 'LIDC dataset not present') || (INFERENCE_CONFIGURED && 'INFERENCE_URL is set') },
    async () => {
      const res = await submit(radSession, fs.readFileSync(nodule!.path), 'slice.dcm', {
        patientId: String(patient.id),
        cx: String(nodule!.cx),
        cy: String(nodule!.cy),
      });
      assert.equal(res.status, 503, res.text.slice(0, 200));
      assert.match(res.json.reason, /INFERENCE_URL/);
      assert.match(res.json.message, /NOT a negative finding/);
      assert.equal(res.json.queuedForManualReview, true);
    }
  );
});

describe('with the resident inference service', { timeout: TIMEOUT }, () => {
  const skipUnless = (!nodule && 'LIDC dataset not present') || (!INFERENCE_CONFIGURED && 'INFERENCE_URL not set');

  test('a raster export is refused: the crop needs the native pixel scale', { skip: skipUnless }, async () => {
    const file = fs.readdirSync(SKIN_PNG).find((f) => /\.(jpe?g|png)$/i.test(f))!;
    const res = await submit(radSession, fs.readFileSync(path.join(SKIN_PNG, file)), file, {
      patientId: String(patient.id),
      cx: '100',
      cy: '100',
    });
    assert.equal(res.status, 422, res.text.slice(0, 200));
    assert.match(res.json.reasons.join(' '), /DICOM/);
  });

  test('a marked nodule on a real CT slice returns the structured record', { skip: skipUnless }, async () => {
    const res = await submit(radSession, fs.readFileSync(nodule!.path), 'slice.dcm', {
      patientId: String(patient.id),
      cx: String(nodule!.cx),
      cy: String(nodule!.cy),
    });
    assert.equal(res.status, 200, res.text.slice(0, 300));
    analysedScanId = res.json.scan.id;

    const { detail, region, acquisition } = res.json.analysis;
    assert.ok(detail, 'the structured record is present');
    assert.ok(detail.probability >= 0 && detail.probability <= 1, `probability ${detail.probability}`);
    assert.equal(detail.threshold, 0.3);
    assert.equal(detail.temperature, 1.0);
    assert.equal(detail.calibrationApplied, false);
    assert.equal(detail.oodStatus, 'PASS');
    assert.ok(detail.oodScore < detail.oodThreshold, 'a labelled nodule crop passes its own screen');
    assert.equal(detail.qualityGate, 'passed');
    assert.equal(detail.inputSource, 'dicom');
    assert.equal(detail.modelClass, 'INTERNAL_VALIDATION');
    assert.equal(detail.clinicalValidation, 'NOT ESTABLISHED');
    assert.equal(detail.humanReview, 'REQUIRED');
    assert.match(detail.modelVersion, /^resnet50v2-lung_nodule-[0-9a-f]{12}$/);
    assert.ok(Date.parse(detail.inferenceAt) > 0);

    assert.equal(region.cx, nodule!.cx);
    assert.equal(region.cy, nodule!.cy);
    assert.equal(region.sizePx, 64);
    assert.equal(acquisition.modality, 'CT');
    assert.equal(acquisition.windowApplied.source, 'training_window');
    assert.equal(acquisition.windowApplied.center, -600);
    assert.equal(acquisition.deidentifiedObject, undefined, 'the object bytes do not ride in the response');
    assert.equal(res.json.analysis.storedDeidentified, true);

    // No diagnosis wording anywhere in the result.
    const text = JSON.stringify(res.json.analysis);
    assert.doesNotMatch(text, /(high|medium|low) risk|cancer detected|riskAssessment/i);
    assert.match(res.json.scan.result, /marked nodule/i);
  });

  test('the row records the numbers, not only the string', { skip: skipUnless }, async () => {
    assert.ok(analysedScanId);
    const pool = db();
    try {
      const { rows } = await pool.query(
        `SELECT calibrated_probability, decision_threshold, calibration_temperature, calibration_applied,
                ood_score, ood_threshold, quality_gate, acquisition_modality, acquisition_manufacturer,
                input_source, model_class, inference_at, stored_deidentified, image_path, predicted_positive
           FROM medical_scans WHERE id = $1`,
        [analysedScanId]
      );
      const r = rows[0];
      assert.equal(typeof r.calibrated_probability, 'number');
      assert.equal(r.decision_threshold, 0.3);
      assert.equal(r.calibration_temperature, 1);
      assert.equal(r.calibration_applied, false);
      assert.ok(r.ood_score < r.ood_threshold);
      assert.equal(r.quality_gate, 'passed');
      assert.equal(r.acquisition_modality, 'CT');
      assert.ok(r.acquisition_manufacturer, 'the scanner is recorded');
      assert.equal(r.input_source, 'dicom');
      assert.equal(r.model_class, 'INTERNAL_VALIDATION');
      assert.ok(r.inference_at instanceof Date);
      assert.equal(r.stored_deidentified, true);
      assert.equal(typeof r.predicted_positive, 'boolean');
      assert.equal(r.predicted_positive, r.calibrated_probability >= 0.3, 'the call is the threshold applied to the probability');

      const regions = await pool.query('SELECT * FROM scan_regions WHERE scan_id = $1', [analysedScanId]);
      assert.equal(regions.rows.length, 1);
      assert.equal(regions.rows[0].source, 'clinician');
      assert.equal(regions.rows[0].cx, nodule!.cx);
      assert.equal(regions.rows[0].cy, nodule!.cy);
      assert.equal(regions.rows[0].size_px, 64);
      assert.ok(regions.rows[0].spacing_row_mm > 0, 'spacing from the acquisition');

      // What was written to storage is the de-identified object, not the upload.
      assert.match(r.image_path, /^file:\/\/.*\.dcm$/);
      const stored = fs.readFileSync(path.join(process.cwd(), 'uploads', r.image_path.slice('file://'.length)));
      assert.ok(stored.includes(Buffer.from('HealthAI best-effort PS3.15 Basic Profile')), 'de-identification method recorded in the object');
      assert.ok(!stored.includes(Buffer.from(nodule!.patientId)), 'the original PatientID value is not in the stored bytes');
      assert.ok(!stored.includes(Buffer.from('1.3.6.1.4.1.14519.5.2.1.6279.6001.1045776554436178843457074')), 'the series UID is not in the stored bytes');
    } finally {
      await pool.end();
    }
  });

  test('the explanation re-runs over the recorded mark and agrees with the stored call', { skip: skipUnless }, async () => {
    assert.ok(analysedScanId);
    const res = await radSession.get(`/api/scans/${analysedScanId}/explanation`);
    assert.equal(res.status, 200, res.text.slice(0, 300));
    assert.equal(res.json.modality, 'lung_nodule');
    assert.match(res.json.explanation.heatmapPng, /^data:image\/png;base64,/);
    assert.match(res.json.explanation.caveat, /not .*(boundary|segmentation|measurement)/i);
    assert.equal(res.json.agreesWithStoredResult, true, `re-run said ${res.json.rerunPrediction}`);
  });

  test('a DICOM stored without consent is stored de-identified, or not at all', { skip: skipUnless }, async () => {
    const decliner = await registerPatient('nodule-decliner');
    assert.equal((await decliner.session.post('/api/scans/analysis-consent', { granted: false })).status, 200);
    const res = await submit(radSession, fs.readFileSync(nodule!.path), 'slice.dcm', {
      patientId: String(decliner.id),
      cx: String(nodule!.cx),
      cy: String(nodule!.cy),
    });
    assert.equal(res.status, 200, res.text.slice(0, 300));
    assert.equal(res.json.analysed, false);
    const pool = db();
    try {
      const { rows } = await pool.query('SELECT image_path, stored_deidentified, input_source FROM medical_scans WHERE id = $1', [res.json.scan.id]);
      assert.equal(rows[0].input_source, 'dicom');
      assert.equal(rows[0].stored_deidentified, true);
      const stored = fs.readFileSync(path.join(process.cwd(), 'uploads', rows[0].image_path.slice('file://'.length)));
      assert.ok(!stored.includes(Buffer.from(nodule!.patientId)));
    } finally {
      await pool.end();
    }
  });
});
