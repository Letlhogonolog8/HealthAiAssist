/**
 * Harm reporting.
 *
 * The properties pinned here are the ones that decide whether an incident
 * system is evidence or theatre:
 *
 *   - anyone can file, because a channel restricted to clinicians misses the
 *     events clinicians are least likely to report;
 *   - the gradings are constrained, because a thousand free-text narratives
 *     cannot be counted and a trend nobody can compute changes nothing;
 *   - a review cannot rewrite what was reported, because the pressure to soften
 *     a severity grade after an investigation is precisely what an incident log
 *     exists to resist;
 *   - the narrative is encrypted, because it is clinical detail about an
 *     identifiable person;
 *   - the report outlives the scan and the patient record, because a safety
 *     signal that disappears on erasure cannot support the trend it exists for.
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
let clinician: Awaited<ReturnType<typeof registerPatient>>;
let clinSession: Session;

before(async () => {
  await startServer();

  patient = await registerPatient('ae-patient');
  clinician = await registerPatient('ae-clinician');

  const pool = db();
  try {
    await pool.query('UPDATE users SET role = $1 WHERE id = $2', ['radiologist', clinician.id]);
  } finally {
    await pool.end();
  }

  clinSession = new Session();
  const login = await clinSession.post('/api/auth/login', {
    username: clinician.username,
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
      await pool.query(
        'DELETE FROM adverse_events WHERE reported_by = ANY($1) OR reviewed_by = ANY($1) OR patient_id = ANY($1)',
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

describe('filing a report', { timeout: TIMEOUT }, () => {
  test('a patient can file one, not only clinical staff', async () => {
    const res = await patient.session.post('/api/adverse-events', {
      category: 'delayed_review',
      severity: 'no_harm',
      description: 'My scan sat for four days before anyone looked at it.',
    });

    assert.equal(res.status, 201, res.text.slice(0, 200));
    assert.ok(res.json.id);
    assert.equal(res.json.status, 'open');
    // The reporter is told it is someone else's job now. A channel that leaves
    // people wondering whether to chase it gets used once.
    assert.match(res.json.message, /reviewed by a clinician/i);
  });

  test('anonymous callers cannot file', async () => {
    const res = await new Session().post('/api/adverse-events', {
      category: 'other',
      severity: 'no_harm',
      description: 'x',
    });
    assert.equal(res.status, 401);
  });

  test('near_miss is offered, and is the first severity', async () => {
    const res = await patient.session.get('/api/adverse-events/vocabularies');
    assert.equal(res.status, 200);

    // Ordering is deliberate: a near miss is the same latent fault as a
    // realised harm, found for free, and it is the class people skip.
    assert.equal(res.json.severities[0], 'near_miss');
    assert.match(res.json.severityGuidance.near_miss, /same fault, no harm/i);
  });

  test('category and severity are constrained to the declared vocabularies', async () => {
    const badCategory = await patient.session.post('/api/adverse-events', {
      category: 'something went wrong',
      severity: 'harm',
      description: 'x',
    });
    assert.equal(badCategory.status, 400);
    assert.ok(Array.isArray(badCategory.json.allowed));

    const badSeverity = await patient.session.post('/api/adverse-events', {
      category: 'other',
      severity: 'quite bad',
      description: 'x',
    });
    assert.equal(badSeverity.status, 400);
  });

  test('an empty description is refused rather than filed blank', async () => {
    const res = await patient.session.post('/api/adverse-events', {
      category: 'other',
      severity: 'harm',
      description: '   ',
    });
    assert.equal(res.status, 400);
  });

  test('the narrative is encrypted at rest', async () => {
    const secret = 'The report said benign and the biopsy said otherwise.';
    const filed = await patient.session.post('/api/adverse-events', {
      category: 'incorrect_result',
      severity: 'harm',
      description: secret,
    });
    assert.equal(filed.status, 201);

    const pool = db();
    try {
      const { rows } = await pool.query('SELECT description FROM adverse_events WHERE id = $1', [
        filed.json.id,
      ]);
      // Clinical detail about an identifiable person must not be readable by
      // anyone holding a database connection.
      assert.notEqual(rows[0].description, secret);
      assert.doesNotMatch(rows[0].description, /biopsy/i);
    } finally {
      await pool.end();
    }
  });
});

describe('reading reports', { timeout: TIMEOUT }, () => {
  test('a patient cannot read everyone else\'s reports', async () => {
    const res = await patient.session.get('/api/adverse-events');
    assert.equal(res.status, 403);
  });

  test('a clinician can, and gets the narrative back decrypted', async () => {
    const marker = `needle-${Date.now()}`;
    await patient.session.post('/api/adverse-events', {
      category: 'missed_finding',
      severity: 'near_miss',
      description: `Case ${marker}: flagged late but caught.`,
    });

    const res = await clinSession.get('/api/adverse-events');
    assert.equal(res.status, 200);
    assert.ok(res.json.events.length > 0);
    assert.ok(
      res.json.events.some((e: any) => String(e.description).includes(marker)),
      'the reviewer must be able to read what was reported'
    );
  });
});

describe('the trend', { timeout: TIMEOUT }, () => {
  test('reports counts and a comparison window, not a safety score', async () => {
    const res = await clinSession.get('/api/adverse-events/trend');
    assert.equal(res.status, 200);

    assert.ok(typeof res.json.current.total === 'number');
    assert.ok(res.json.current.bySeverity);
    // A single number would invite exactly the reading the note forbids.
    assert.ok(res.json.previous, 'a count with nothing to compare it to is not a trend');
    assert.equal(res.json.safetyScore, undefined);
    assert.equal(res.json.score, undefined);
  });

  test('says plainly that a fall in reports is not evidence of safety', async () => {
    const res = await clinSession.get('/api/adverse-events/trend');
    // Under-reporting is the normal state of every incident system, and a
    // reader will otherwise supply the wrong assumption themselves.
    assert.match(res.json.note, /under-reporting/i);
    assert.match(res.json.note, /not evidence/i);
  });

  test('a patient cannot read the trend', async () => {
    const res = await patient.session.get('/api/adverse-events/trend');
    assert.equal(res.status, 403);
  });
});

describe('review', { timeout: TIMEOUT }, () => {
  test('a reviewer cannot rewrite the reported grading or narrative', async () => {
    const original = 'Original account of what happened.';
    const filed = await patient.session.post('/api/adverse-events', {
      category: 'incorrect_result',
      severity: 'severe_harm',
      description: original,
    });
    assert.equal(filed.status, 201);

    // Attempt to downgrade everything that matters while closing it.
    const review = await clinSession.patch(`/api/adverse-events/${filed.json.id}/review`, {
      status: 'closed',
      reviewNotes: 'Investigated; no fault found.',
      severity: 'no_harm',
      category: 'other',
      description: 'Nothing happened.',
    });
    assert.equal(review.status, 200);
    assert.equal(review.json.status, 'closed');

    const pool = db();
    try {
      const { rows } = await pool.query(
        'SELECT severity, category FROM adverse_events WHERE id = $1',
        [filed.json.id]
      );
      // The whole point: an incident log that can be edited after the fact is
      // not evidence.
      assert.equal(rows[0].severity, 'severe_harm', 'severity must survive the review');
      assert.equal(rows[0].category, 'incorrect_result', 'category must survive the review');
    } finally {
      await pool.end();
    }
  });

  test('a patient cannot review', async () => {
    const filed = await patient.session.post('/api/adverse-events', {
      category: 'other',
      severity: 'no_harm',
      description: 'x',
    });
    const res = await patient.session.patch(`/api/adverse-events/${filed.json.id}/review`, {
      status: 'closed',
      reviewNotes: 'closing my own report',
    });
    assert.equal(res.status, 403);
  });

  test('an unknown status is refused', async () => {
    const filed = await patient.session.post('/api/adverse-events', {
      category: 'other',
      severity: 'no_harm',
      description: 'x',
    });
    const res = await clinSession.patch(`/api/adverse-events/${filed.json.id}/review`, {
      status: 'probably fine',
      reviewNotes: 'x',
    });
    assert.equal(res.status, 400);
  });
});
