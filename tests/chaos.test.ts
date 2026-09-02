/**
 * Failure injection: what the platform does when the model cannot answer.
 *
 * Every other suite exercises the path where things work. This one starts the
 * server with the model artifacts pointed at files that do not exist and asserts
 * the whole refusal chain holds, because that chain is the platform's central
 * safety claim and it is only ever exercised by accident.
 *
 * ── The single invariant ───────────────────────────────────────────────────
 *
 * **A failure must never produce something that reads as a negative finding.**
 *
 * "No abnormal findings detected" and "we could not look" are different
 * sentences with the same shape, and a patient cannot tell them apart. The
 * codebase has been carrying that rule since the fabricated `hasCancer: false,
 * confidence: 85` fallback was found in the skin scanner; these tests are the
 * standing check that it still holds when the thing that can fail, fails.
 *
 * ── Why the model path and not a mock ─────────────────────────────────────
 *
 * The server under test is a real process that inherits this process's
 * environment, so pointing LUNG_CANCER_MODEL_PATH at a missing file breaks it
 * the way a bad deploy would: the artifact is genuinely absent, the fingerprint
 * genuinely cannot be computed, and the governance gate, the inference call and
 * the error handler all run for real. A mock would test the mock.
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const TIMEOUT = 180_000;

// Set before importing the helper: startServer spawns with a copy of this
// environment, and the module resolves configuration at import time.
const MISSING = path.join(process.cwd(), 'dataset', 'does-not-exist', 'no-such-model.h5');
process.env.LUNG_CANCER_MODEL_PATH = MISSING;
process.env.SKIN_CANCER_MODEL_PATH = MISSING;
// A port nothing listens on, so the inference client's transport fails rather
// than silently falling back to a working resident service.
process.env.INFERENCE_URL = 'http://127.0.0.1:9';

const helpers = await import('./helpers/server.ts');
const { Session, TEST_USER_PREFIX, db, registerPatient, startServer, stopServer } = helpers;

let patient: Awaited<ReturnType<typeof registerPatient>>;

/** Any image at all; it must never get far enough for the content to matter. */
function anyImage(): Buffer {
  const candidates = [
    'dataset/dataset/data/test/benign',
    'dataset/dataset/lung_cancer_MRI_dataset/validate/cancer',
  ];
  for (const dir of candidates) {
    if (!fs.existsSync(dir)) continue;
    const file = fs.readdirSync(dir).find((f) => /\.(jpe?g|png)$/i.test(f));
    if (file) return fs.readFileSync(path.join(dir, file));
  }
  // A 1x1 PNG. Enough to reach the pipeline; the refusal happens before
  // anything looks at pixels.
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'
  );
}

async function submit(scanType: string) {
  const form = new FormData();
  form.append('image', new Blob([anyImage()], { type: 'image/jpeg' }), 'scan.jpg');
  form.append('scanType', scanType);
  return patient.session.postForm('/api/scans/analyze', form);
}

/**
 * Wording that would tell a patient their scan is clear.
 *
 * The disclaimer is excised before matching. A first version of this pattern
 * included "negative finding" and duly matched "This is NOT a negative
 * finding" — flagging the very sentence that makes the response safe. The
 * lesson kept rather than smoothed over: a check for dangerous phrasing has to
 * exclude the phrasing that exists to prevent the danger, or it fails on
 * exactly the correct implementations.
 *
 * The word boundaries are load-bearing too: without them `normal` matches
 * inside `abnormal`, so a genuine positive finding would fail the check.
 */
const SAFE_DISCLAIMER = /this is NOT a negative finding[.,]?/gi;
const READS_AS_NEGATIVE = /no abnormal|nothing found|all clear|appears clear|looks clear|\bbenign\b|\bnormal\b/i;

/** The payload minus the sentences that exist to say "we did not look". */
function withoutDisclaimer(body: unknown): string {
  return JSON.stringify(body).replace(SAFE_DISCLAIMER, '');
}

before(async () => {
  await startServer();
  patient = await registerPatient('chaos-patient');

  // Consent granted, so a refusal cannot be attributed to the consent gate.
  // The point is what happens when the model is broken for someone who said yes.
  const consent = await patient.session.post('/api/scans/analysis-consent', { granted: true });
  assert.equal(consent.status, 200, consent.text.slice(0, 200));
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
      await pool.query('DELETE FROM adverse_events WHERE reported_by = ANY($1) OR patient_id = ANY($1)', [ids]);
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

describe('the model cannot be loaded', { timeout: TIMEOUT }, () => {
  for (const scanType of ['lung', 'skin']) {
    test(`${scanType}: refuses rather than answering`, async () => {
      const res = await submit(scanType);

      // 503, not 200. A 200 carrying no finding is the shape a client renders
      // as a result, which is how "we could not look" becomes "nothing found".
      assert.equal(res.status, 503, `expected 503, got ${res.status}: ${res.text.slice(0, 200)}`);
      assert.equal(res.json.success, false);
    });

    test(`${scanType}: says explicitly that this is not a negative result`, async () => {
      const res = await submit(scanType);
      assert.match(res.json.message, /NOT a negative finding/i);
    });

    test(`${scanType}: nothing in the response reads as a clean scan`, async () => {
      const res = await submit(scanType);
      const body = withoutDisclaimer(res.json);

      // The whole payload, not just the message: a stray `status: "normal"` or
      // `primaryFinding: "No abnormal findings"` anywhere in the object is the
      // failure, wherever a client happens to read from.
      assert.doesNotMatch(body, READS_AS_NEGATIVE, `refusal payload reads as a result: ${body.slice(0, 300)}`);

      // And no confidence figure, which is the other half of looking like a
      // measurement.
      assert.equal(res.json.analysis, undefined);
      assert.equal(res.json.confidence, undefined);
    });

    test(`${scanType}: the scan is kept for a human, not dropped`, async () => {
      const res = await submit(scanType);
      assert.equal(res.json.queuedForManualReview, true, 'the scan must survive the failure');
      assert.ok(res.json.scanId, 'a scan row must exist to queue');

      const pool = db();
      try {
        const { rows } = await pool.query(
          'SELECT status, predicted_positive, ai_confidence FROM medical_scans WHERE id = $1',
          [res.json.scanId]
        );
        assert.equal(rows.length, 1, 'the scan row was not written');
        assert.equal(rows[0].status, 'pending_manual_review');
        // The two columns production performance is computed from must stay
        // empty, or a failed scan enters the confusion matrix as a real call.
        assert.equal(rows[0].predicted_positive, null, 'a scan nothing analysed must not carry a model call');
        assert.notEqual(rows[0].ai_confidence, null);
        assert.doesNotMatch(String(rows[0].ai_confidence), /^\d/, 'no numeric confidence for an unanalysed scan');
      } finally {
        await pool.end();
      }
    });
  }

  test('the refusal names a reason a human can act on', async () => {
    const res = await submit('lung');
    // "Something went wrong" sends an operator looking in the wrong place.
    assert.ok(res.json.reason && res.json.reason.length > 10, 'no actionable reason given');
    assert.equal(res.json.scanType, 'lung');
  });
});

describe('the platform stays usable while the model is down', { timeout: TIMEOUT }, () => {
  test('the model card says the modality is not serving, rather than publishing figures as current', async () => {
    const res = await new Session().get('/api/models/cards');
    assert.equal(res.status, 200);

    for (const m of res.json.models) {
      // The artifact cannot be fingerprinted, so no published figure can be
      // claimed to describe what is deployed.
      assert.equal(
        m.figuresDescribeDeployedArtifact,
        false,
        `${m.scanType} claims its figures describe a model that cannot be read`
      );
      assert.ok(m.measurementBinding);
      assert.equal(m.measurementBinding.mayServe, false);
    }
  });

  test('harm can still be reported when the model is broken', async () => {
    // The reporting channel must not depend on the thing it exists to report on.
    const res = await patient.session.post('/api/adverse-events', {
      category: 'system_failure',
      severity: 'no_harm',
      description: 'Submitted a scan and got no result back.',
    });
    assert.equal(res.status, 201, res.text.slice(0, 200));
  });

  test('a patient can still read their own scans', async () => {
    const res = await patient.session.get('/api/scans');
    assert.equal(res.status, 200);
  });

  test('readiness still reports the database honestly', async () => {
    const res = await new Session().get('/api/ready');
    assert.ok([200, 503].includes(res.status));
  });
});
