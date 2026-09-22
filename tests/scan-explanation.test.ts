/**
 * GET /api/scans/:id/explanation — where the model looked.
 *
 * Two configurations share this file, selected by whether INFERENCE_URL is set
 * in the environment the server inherits:
 *
 *   unset  — the common development case. The refusal paths are exercised and
 *            the endpoint must say plainly that explanations need the resident
 *            service, without touching the stored result.
 *   set    — the resident inference service is running. The full path is
 *            exercised: a real heatmap comes back with its caveat, and the
 *            re-run agrees with the stored call.
 *
 * Either way, the access and "nothing was assessed" rules hold, and those are
 * the ones that matter for safety: a heatmap over a scan the model never scored
 * would suggest an opinion that was never formed.
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

const TIMEOUT = 300_000;
const INFERENCE_CONFIGURED = Boolean(process.env.INFERENCE_URL);

/**
 * Skin, because skin is the modality that serves. This file used a chest image
 * and the lung model until that model was withdrawn (2026-09-20; MODEL_CARDS.md).
 * Several candidates are kept because the out-of-distribution screen refuses
 * roughly one held-out lesion in 120, and a refusal is correct rather than a
 * test failure — the next candidate is tried.
 */
const SKIN_DIR = 'dataset/dataset/data/test/malignant';
const skinImages = fs.existsSync(SKIN_DIR)
  ? fs.readdirSync(SKIN_DIR).filter((f) => /\.(jpe?g|png)$/i.test(f)).slice(0, 6)
  : [];
const haveImage = skinImages.length >= 1;

let consenting: Awaited<ReturnType<typeof registerPatient>>;
let declining: Awaited<ReturnType<typeof registerPatient>>;
let radSession: Session;
let analysedScanId: number | null = null;
let unanalysedScanId: number | null = null;
/** A row written by the withdrawn lung model before it was withdrawn. */
let legacyLungScanId: number | null = null;

async function submit(session: Session, file: string): Promise<{ status: number; json: any; text: string }> {
  const form = new FormData();
  const bytes = fs.readFileSync(`${SKIN_DIR}/${file}`);
  form.append('image', new Blob([bytes], { type: 'image/jpeg' }), file);
  form.append('scanType', 'skin');
  return session.postForm('/api/scans/analyze', form);
}

before(async () => {
  await startServer();

  consenting = await registerPatient('explain-yes');
  declining = await registerPatient('explain-no');
  const radiologist = await registerPatient('explain-rad');

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

  assert.equal((await consenting.session.post('/api/scans/analysis-consent', { granted: true })).status, 200);
  assert.equal((await declining.session.post('/api/scans/analysis-consent', { granted: false })).status, 200);

  if (haveImage) {
    // Consent refused: stored and queued, never scored. predicted_positive stays null.
    const queued = await submit(declining.session, skinImages[0]);
    assert.equal(queued.status, 200, queued.text.slice(0, 200));
    unanalysedScanId = queued.json.scan?.id ?? queued.json.scanId;
    assert.ok(unanalysedScanId, 'no scan id for the unanalysed scan');

    // Consent granted: the model runs (resident service or subprocess fallback).
    for (const file of skinImages) {
      const scored = await submit(consenting.session, file);
      if (scored.status === 422) continue;
      assert.equal(scored.status, 200, scored.text.slice(0, 200));
      analysedScanId = scored.json.scan?.id;
      break;
    }
    assert.ok(analysedScanId, `none of ${skinImages.length} candidates was scored`);
  }

  // A result the withdrawn model produced while it was still serving. Inserted
  // directly, because the API can no longer produce one — which is the point.
  const pool2 = db();
  try {
    const { rows } = await pool2.query(
      `INSERT INTO medical_scans
         (patient_id, scan_type, result, ai_confidence, status, model_version, predicted_positive)
       VALUES ($1, 'lung', 'Lung Cancer detected - high risk', '81%', 'pending',
               'resnet50v2-lung-31315d6a059a', true)
       RETURNING id`,
      [consenting.id]
    );
    legacyLungScanId = rows[0].id;
  } finally {
    await pool2.end();
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

describe('who may ask', { timeout: TIMEOUT }, () => {
  test('a patient cannot request an explanation, even of their own scan', { skip: !haveImage && 'dataset not present' }, async () => {
    const res = await consenting.session.get(`/api/scans/${analysedScanId}/explanation`);
    assert.equal(res.status, 403, res.text.slice(0, 200));
  });

  test('anonymous is refused', async () => {
    const res = await new Session().get('/api/scans/1/explanation');
    assert.equal(res.status, 401);
  });

  test('a scan that does not exist is 404, not 500', async () => {
    const res = await radSession.get('/api/scans/2147483000/explanation');
    assert.equal(res.status, 404, res.text.slice(0, 200));
  });
});

describe('what it refuses to explain', { timeout: TIMEOUT }, () => {
  test('a scan the model never scored: 409, and explicitly not a negative', { skip: !haveImage && 'dataset not present' }, async () => {
    const res = await radSession.get(`/api/scans/${unanalysedScanId}/explanation`);
    assert.equal(res.status, 409, res.text.slice(0, 200));
    assert.equal(res.json.success, false);
    assert.equal(res.json.code, 'no_model_result');
    assert.match(res.json.message, /NOT a negative finding/);
    // No heatmap, no confidence, nothing that renders as a result.
    assert.equal(res.json.explanation, undefined);
  });

  test('a result from a withdrawn model: 409, and the stored result is left standing', async () => {
    // The lung model no longer serves. Re-running it to draw a heatmap over a
    // result it produced earlier would be serving it, so the request is refused
    // — with the withdrawal reason, not a generic "unavailable".
    const res = await radSession.get(`/api/scans/${legacyLungScanId}/explanation`);
    // 409 in every configuration: the withdrawal is checked before the
    // transport, so a subprocess-only deployment gives the same answer.
    assert.equal(res.status, 409, res.text.slice(0, 200));
    assert.equal(res.json.success, false);
    assert.equal(res.json.code, 'model_not_serving');
    assert.match(res.json.message, /withdrawn/i);
    assert.equal(res.json.detail?.governanceState, 'withdrawn');
    assert.equal(res.json.explanation, undefined);

    const pool = db();
    try {
      const { rows } = await pool.query(
        'SELECT predicted_positive, model_version FROM medical_scans WHERE id = $1',
        [legacyLungScanId]
      );
      assert.equal(rows[0].predicted_positive, true, 'the historical call must survive');
      assert.equal(rows[0].model_version, 'resnet50v2-lung-31315d6a059a');
    } finally {
      await pool.end();
    }
  });

  test(
    'without the resident inference service: 503 that leaves the stored result standing',
    { skip: (!haveImage && 'dataset not present') || (INFERENCE_CONFIGURED && 'INFERENCE_URL is set; the 200 path is tested instead') },
    async () => {
      const res = await radSession.get(`/api/scans/${analysedScanId}/explanation`);
      assert.equal(res.status, 503, res.text.slice(0, 200));
      assert.equal(res.json.code, 'explanations_unavailable');
      assert.match(res.json.message, /INFERENCE_URL/);
      assert.match(res.json.message, /stored result stands/i);

      // And the scan row is untouched by the attempt.
      const pool = db();
      try {
        const { rows } = await pool.query(
          'SELECT predicted_positive, model_version FROM medical_scans WHERE id = $1',
          [analysedScanId]
        );
        assert.equal(rows.length, 1);
        assert.notEqual(rows[0].predicted_positive, null, 'the stored call must survive');
        assert.ok(rows[0].model_version, 'the stored model version must survive');
      } finally {
        await pool.end();
      }
    }
  );
});

describe('with the resident inference service', { timeout: TIMEOUT }, () => {
  test(
    'returns a heatmap, its caveat, and agreement with the stored call',
    { skip: (!haveImage && 'dataset not present') || (!INFERENCE_CONFIGURED && 'INFERENCE_URL not set') },
    async () => {
      const res = await radSession.get(`/api/scans/${analysedScanId}/explanation`);
      assert.equal(res.status, 200, res.text.slice(0, 300));
      assert.equal(res.json.success, true);
      assert.equal(res.json.modality, 'skin');

      const { explanation } = res.json;
      assert.match(explanation.heatmapPng, /^data:image\/png;base64,[A-Za-z0-9+/=]{100,}$/, 'not a PNG data URI');
      assert.match(explanation.method, /Grad-CAM/);
      // The caveat is the safety content. It must arrive, and it must say what
      // a heatmap is not.
      assert.ok(explanation.caveat.length > 100, 'caveat missing or truncated');
      assert.match(explanation.caveat, /not .*(boundary|segmentation|measurement)/i);

      // Same bytes, same artifact: the re-run must reproduce the stored call.
      assert.equal(res.json.agreesWithStoredResult, true, `re-run said ${res.json.rerunPrediction}`);
    }
  );

  test(
    'the deployed fingerprint is reported and matches the scan',
    { skip: (!haveImage && 'dataset not present') || (!INFERENCE_CONFIGURED && 'INFERENCE_URL not set') },
    async () => {
      const res = await radSession.get(`/api/scans/${analysedScanId}/explanation`);
      assert.equal(res.status, 200);
      const pool = db();
      try {
        const { rows } = await pool.query('SELECT model_version FROM medical_scans WHERE id = $1', [analysedScanId]);
        assert.equal(res.json.modelVersion, rows[0].model_version);
      } finally {
        await pool.end();
      }
    }
  );
});
