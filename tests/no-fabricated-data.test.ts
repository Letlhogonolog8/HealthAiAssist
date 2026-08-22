/**
 * Endpoints that used to make things up.
 *
 * Every assertion here corresponds to a value that was previously served as a
 * literal, a `Math.random()` call, or a browser-side re-derivation, and that
 * reached a clinician's or a patient's screen looking like a measurement.
 *
 * The shape of the bug was consistent enough to be worth naming, because it is
 * the shape the next one will have too: a field the database could not answer
 * was given a plausible default rather than left absent, and the interface —
 * having no way to tell a default from a reading — rendered it as fact. A green
 * STABLE badge on every patient, a 96% accuracy figure beside a progress bar, a
 * health score of "Good" for someone whose scan had just been flagged.
 *
 * So these tests mostly assert absence: that a rate is null rather than zero,
 * that a name is null rather than "Dr. Smith", that a scoped list is scoped.
 * Absence is the property that was lost, and it is the one worth pinning.
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
let otherPatient: Awaited<ReturnType<typeof registerPatient>>;
let doctor: Awaited<ReturnType<typeof registerPatient>>;
let docSession: Session;

before(async () => {
  await startServer();

  patient = await registerPatient('fab-patient');
  otherPatient = await registerPatient('fab-other');
  doctor = await registerPatient('fab-doctor');

  const pool = db();
  try {
    await pool.query(
      `UPDATE users SET role = 'doctor', specialization = 'Dermatology' WHERE id = $1`,
      [doctor.id]
    );
    // Only `patient` is linked to this clinician. `otherPatient` is linked to
    // nobody, and must not appear in the clinician's panel.
    await pool.query(
      `INSERT INTO appointments
         (patient_id, doctor_id, appointment_date, appointment_time, type, status)
       VALUES ($1, $2, now() + interval '3 days', '2:00 PM', 'Consultation', 'scheduled')`,
      [patient.id, doctor.id]
    );
  } finally {
    await pool.end();
  }

  docSession = new Session();
  const login = await docSession.post('/api/auth/login', {
    username: doctor.username,
    password: 'Passw0rd!23',
  });
  assert.equal(login.status, 200, login.text.slice(0, 200));
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
      await pool.query(
        'DELETE FROM appointments WHERE patient_id = ANY($1) OR doctor_id = ANY($1)',
        [ids]
      );
      await pool.query('DELETE FROM chat_messages WHERE sender_id = ANY($1) OR receiver_id = ANY($1)', [ids]);
      await pool.query('DELETE FROM processing_consents WHERE patient_id = ANY($1)', [ids]);
      await pool.query('DELETE FROM audit_events WHERE actor_user_id = ANY($1)', [ids]);
      await pool.query(`DELETE FROM session WHERE (sess -> 'user' ->> 'id')::int = ANY($1)`, [ids]);
      await pool.query('DELETE FROM users WHERE id = ANY($1)', [ids]);
    }
  } finally {
    await pool.end();
  }
  await stopServer();
});

describe("a patient's own dashboard", { timeout: TIMEOUT }, () => {
  test('does not score the patient\'s health', async () => {
    const res = await patient.session.get('/api/patient/stats');
    assert.equal(res.status, 200);

    // Was derived from whether the result text contained "abnormal", bucketed
    // into Good / Fair / Needs Attention, and defaulted to "Good" for a patient
    // with no scans. A finding worded "Lung Cancer detected" contains no such
    // substring and therefore scored as healthy.
    assert.equal(res.json.healthScore, null);
    assert.match(res.json.healthScoreNote, /does not compute a health score/i);
  });

  test('reports the real next appointment, or none', async () => {
    const res = await patient.session.get('/api/patient/stats');

    // Was the literal string "7 days", printed whether or not the patient had
    // an appointment at all.
    assert.notEqual(res.json.nextAppointment, '7 days');
    if (res.json.nextAppointment !== null) {
      assert.ok(res.json.nextAppointment.date, 'an appointment must carry its date');
      assert.doesNotThrow(() => new Date(res.json.nextAppointment.date).toISOString());
    }
  });

  test('counts flagged scans rather than interpreting them', async () => {
    const res = await patient.session.get('/api/patient/stats');
    assert.equal(typeof res.json.flaggedForReview, 'number');
    assert.equal(res.json.flaggedForReview, 0, 'this patient has no scans');
  });
});

describe("a clinician's patient panel", { timeout: TIMEOUT }, () => {
  test('is scoped to the clinician, not the whole register', async () => {
    const res = await docSession.get('/api/doctor/patients');
    assert.equal(res.status, 200, res.text.slice(0, 200));

    const ids = res.json.map((p: any) => p.id);
    assert.ok(ids.includes(patient.id), 'a linked patient must appear');
    assert.ok(
      !ids.includes(otherPatient.id),
      'a patient with no appointment and no scan under this clinician must not appear'
    );
  });

  test('never asserts a clinical status or a condition', async () => {
    const res = await docSession.get('/api/doctor/patients');
    const subject = res.json.find((p: any) => p.id === patient.id);
    assert.ok(subject, 'the linked patient must be present');

    // These three were literals — 'stable', 'low', 'Regular checkup' — written
    // for every patient alike and rendered as a green STABLE / LOW RISK pair.
    assert.equal(subject.status, undefined);
    assert.equal(subject.riskLevel, undefined);
    assert.equal(subject.condition, undefined);
  });

  test('leaves an unrecorded age unrecorded', async () => {
    const res = await docSession.get('/api/doctor/patients');
    const subject = res.json.find((p: any) => p.id === patient.id);

    // Was `patient.age || 30`. These accounts register without an age.
    assert.equal(subject.age, null);
  });

  test('does not claim every patient was seen today', async () => {
    const res = await docSession.get('/api/doctor/patients');
    const subject = res.json.find((p: any) => p.id === patient.id);

    // Was `new Date().toISOString()` for every row. The only appointment this
    // patient has is in the future, so there is no past visit to report.
    assert.equal(subject.lastVisit, null);
    assert.ok(subject.nextAppointment, 'the future appointment should be reported');
  });
});

describe("a clinician's counters", { timeout: TIMEOUT }, () => {
  test('are stable across calls', async () => {
    // `appointmentsCompleted` was `Math.floor(Math.random() * 5) + 3`, so the
    // tile showed a different number on every fifteen-second poll.
    const first = await docSession.get('/api/doctor/stats');
    const second = await docSession.get('/api/doctor/stats');
    assert.equal(first.status, 200, first.text.slice(0, 200));
    assert.deepEqual(first.json, second.json);
  });

  test('report nothing this platform does not measure', async () => {
    const res = await docSession.get('/api/doctor/stats');

    // There is no consultation timer and no satisfaction survey in this system.
    // These were served as the literals '18m' and 94.
    assert.equal(res.json.avgConsultationTime, undefined);
    assert.equal(res.json.patientSatisfaction, undefined);
  });

  test('are scoped to the clinician asking', async () => {
    const res = await docSession.get('/api/doctor/stats');

    // Was the count of every patient in the database. This clinician has one.
    assert.equal(res.json.activePatients, 1);
    assert.equal(res.json.upcomingAppointments, 1);
  });
});

describe('the reading queue', { timeout: TIMEOUT }, () => {
  test('publishes no accuracy figure', async () => {
    const res = await docSession.get('/api/radiologist/stats');
    assert.equal(res.status, 200, res.text.slice(0, 200));

    // `accuracyRate: 96` was returned here and rendered four times, including as
    // a progress bar filled to 96 and the caption "96% accuracy". Accuracy needs
    // confirmed outcomes and belongs to /api/models/performance.
    assert.equal(res.json.accuracyRate, undefined);
    assert.equal(res.json.accuracy?.available, false);
    assert.equal(res.json.accuracy?.endpoint, '/api/models/performance');
  });

  test('names mean confidence for what it is', async () => {
    const res = await docSession.get('/api/radiologist/stats');

    // Confidence says how sure the model was, not how often it was right.
    assert.ok('meanAiConfidencePct' in res.json);
    assert.equal(res.json.aiConfidence, undefined, 'the ambiguous name is gone');
  });

  test('reports review time as null rather than zero when unmeasured', async () => {
    const res = await docSession.get('/api/radiologist/stats');

    // Was the literal 3.2. A median with no reviews behind it is not 0 minutes.
    assert.equal(res.json.avgReviewTime, undefined);
    if (res.json.reviewsMeasured === 0) {
      assert.equal(res.json.medianReviewHours, null);
    }
  });

  test('invents no radiologist name and no confidence on pending reports', async () => {
    const res = await docSession.get('/api/doctor/reports/pending');
    assert.equal(res.status, 200, res.text.slice(0, 200));

    for (const report of res.json) {
      // Was the literal 'Dr. Smith' on every row.
      assert.notEqual(report.radiologist, 'Dr. Smith');
      // Was `scan.aiConfidence || '85%'`.
      assert.notEqual(report.aiConfidence, '85%');
      assert.ok(
        report.aiConfidence === null || typeof report.aiConfidence === 'string',
        'confidence is a recorded string or null, never a substituted default'
      );
    }
  });
});

describe('appointment availability', { timeout: TIMEOUT }, () => {
  const nextTuesday = () => {
    const d = new Date();
    d.setDate(d.getDate() + ((9 - d.getDay()) % 7 || 7));
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  test('is deterministic', async () => {
    const date = nextTuesday();
    const path = `/api/appointments/dermatologist-slots?doctorId=${doctor.id}&date=${date}`;

    // Was `timeSlots.filter(() => Math.random() > 0.3)`, so reloading the page
    // showed a different set of free times each render.
    const first = await patient.session.get(path);
    const second = await patient.session.get(path);
    assert.equal(first.status, 200, first.text.slice(0, 200));
    assert.deepEqual(first.json, second.json);
  });

  test('requires a clinician and a date', async () => {
    // The endpoint took no parameters at all and answered anyway.
    const res = await patient.session.get('/api/appointments/dermatologist-slots');
    assert.equal(res.status, 400);
  });

  test('refuses an unknown clinician rather than offering times for them', async () => {
    const res = await patient.session.get(
      `/api/appointments/dermatologist-slots?doctorId=99999999&date=${nextTuesday()}`
    );
    assert.equal(res.status, 404);
  });

  test('omits a slot that is already booked', async () => {
    const pool = db();
    let date: string;
    try {
      // Book a known time on a known future weekday for this clinician.
      const { rows } = await pool.query(
        `INSERT INTO appointments
           (patient_id, doctor_id, appointment_date, appointment_time, type, status)
         VALUES ($1, $2, $3::date, '3:00 PM', 'Consultation', 'scheduled')
         RETURNING to_char(appointment_date, 'YYYY-MM-DD') AS d`,
        [patient.id, doctor.id, nextTuesday()]
      );
      date = rows[0].d;
    } finally {
      await pool.end();
    }

    const res = await patient.session.get(
      `/api/appointments/dermatologist-slots?doctorId=${doctor.id}&date=${date}`
    );
    assert.equal(res.status, 200);
    // Both halves matter. Asserting only the absence would pass just as well
    // against an endpoint that had started returning nothing at all.
    assert.ok(
      res.json.length > 0,
      'the rest of the working day must still be offered'
    );
    assert.ok(
      res.json.includes('2:30 PM'),
      'an unbooked time must still be offered'
    );
    assert.ok(
      !res.json.includes('3:00 PM'),
      'a booked time must not be offered; the old handler filtered a hardcoded list of three example bookings instead'
    );
  });
});

describe('the dermatology referral list', { timeout: TIMEOUT }, () => {
  test('needs a session', async () => {
    // It took the patient's precise coordinates and returned staff contact
    // details, without authentication.
    const res = await new Session().post('/api/dermatologists/nearby', { urgency: 'urgent' });
    assert.equal(res.status, 401);
  });

  test('invents no ratings, distances or hospitals', async () => {
    const res = await patient.session.post('/api/dermatologists/nearby', { urgency: 'urgent' });
    assert.equal(res.status, 200, res.text.slice(0, 200));

    // Two fictional hospitals were returned for urgent cases, with a Call button
    // wired to +1 (555) 911-0000.
    assert.equal(res.json.nearbyHospitals, undefined);
    assert.equal(res.json.proximity.available, false);

    const body = JSON.stringify(res.json);
    assert.ok(!body.includes('555'), 'no invented phone numbers');
    assert.ok(!/"rating"/.test(body), 'clinicians carry no invented rating');
    assert.ok(!/"distance"/.test(body), 'clinicians carry no invented distance');

    for (const clinician of res.json.dermatologists) {
      // Real staff contact details were served here without authentication.
      assert.equal(clinician.email, undefined);
      assert.equal(clinician.phone, undefined);
      assert.notEqual(clinician.name, 'Dr. Available Dermatologist');
    }
  });

  test('finds clinicians by their recorded specialisation', async () => {
    const res = await patient.session.post('/api/dermatologists/nearby', { urgency: 'routine' });

    // The old filter matched `role === 'dermatologist'`, a role that does not
    // exist in this system, so the list was empty on every call.
    const ids = res.json.dermatologists.map((d: any) => d.id);
    assert.ok(ids.includes(doctor.id), 'a doctor specialising in dermatology must be listed');
  });
});

describe('the assistant', { timeout: TIMEOUT }, () => {
  test('ignores a user id supplied in the request body', async () => {
    // The consent gate keys on this id. Taking it from the body let anyone
    // borrow a consenting patient's permission to send data to OpenAI, and
    // recorded the cross-border transfer against that patient.
    const anonymous = new Session();
    const res = await anonymous.post('/api/chatbot/chat', {
      message: 'hello',
      userId: patient.id,
    });
    assert.equal(res.status, 200);

    const pool = db();
    try {
      const { rows } = await pool.query(
        `SELECT count(*)::int AS n FROM audit_events
          WHERE action = 'EXTERNAL_AI_TRANSFER' AND actor_user_id = $1`,
        [patient.id]
      );
      assert.equal(
        rows[0].n,
        0,
        'an anonymous caller must not be able to log a transfer against a patient'
      );
    } finally {
      await pool.end();
    }
  });

  test('bounds what it will forward', async () => {
    const anonymous = new Session();
    const tooMany = await anonymous.post('/api/chatbot/chat', {
      messages: Array.from({ length: 50 }, () => ({ role: 'user', content: 'x' })),
    });
    assert.equal(tooMany.status, 400);

    const tooLong = await anonymous.post('/api/chatbot/chat', {
      messages: [{ role: 'user', content: 'x'.repeat(5000) }],
    });
    assert.equal(tooLong.status, 400);
  });
});

describe('the notification centre', { timeout: TIMEOUT }, () => {
  test('is reachable at all', async () => {
    // /api/notifications was never registered, so the bell polled a 404 every
    // thirty seconds and rendered empty — while rows announcing confirmed
    // results were being written to the table behind it.
    const res = await patient.session.get('/api/notifications');
    assert.equal(res.status, 200, res.text.slice(0, 200));
    assert.ok(Array.isArray(res.json));
  });

  test('needs a session', async () => {
    const res = await new Session().get('/api/notifications');
    assert.equal(res.status, 401);
  });

  test("shows only the reader's own notifications", async () => {
    const pool = db();
    let mine: number;
    let theirs: number;
    try {
      const a = await pool.query(
        `INSERT INTO notifications (recipient_id, type, title, body)
         VALUES ($1, 'scan_result', 'Yours', '') RETURNING id`,
        [patient.id]
      );
      mine = a.rows[0].id;
      const b = await pool.query(
        `INSERT INTO notifications (recipient_id, type, title, body)
         VALUES ($1, 'scan_result', 'Theirs', '') RETURNING id`,
        [otherPatient.id]
      );
      theirs = b.rows[0].id;
    } finally {
      await pool.end();
    }

    const res = await patient.session.get('/api/notifications');
    const ids = res.json.map((n: any) => n.id);
    assert.ok(ids.includes(mine), 'own notification must be listed');
    assert.ok(!ids.includes(theirs), "another patient's notification must not be");
  });

  test("cannot mark another patient's notification read", async () => {
    const pool = db();
    let theirs: number;
    try {
      const { rows } = await pool.query(
        `INSERT INTO notifications (recipient_id, type, title, body)
         VALUES ($1, 'scan_result', 'Theirs', '') RETURNING id`,
        [otherPatient.id]
      );
      theirs = rows[0].id;
    } finally {
      await pool.end();
    }

    // Answers 200 — the operation is idempotent and must not confirm which ids
    // exist — but the row must be untouched.
    await patient.session.patch(`/api/notifications/${theirs}/read`);

    const check = db();
    try {
      const { rows } = await check.query('SELECT read_at FROM notifications WHERE id = $1', [theirs]);
      assert.equal(rows[0].read_at, null, "another patient's notification must stay unread");
    } finally {
      await check.end();
    }
  });

  test("cannot delete another patient's notification", async () => {
    const pool = db();
    let theirs: number;
    try {
      const { rows } = await pool.query(
        `INSERT INTO notifications (recipient_id, type, title, body)
         VALUES ($1, 'scan_result', 'Theirs', '') RETURNING id`,
        [otherPatient.id]
      );
      theirs = rows[0].id;
    } finally {
      await pool.end();
    }

    const res = await patient.session.del(`/api/notifications/${theirs}`);
    assert.equal(res.status, 404);

    const check = db();
    try {
      const { rows } = await check.query('SELECT count(*)::int n FROM notifications WHERE id = $1', [theirs]);
      assert.equal(rows[0].n, 1, "another patient's notification must survive");
    } finally {
      await check.end();
    }
  });

  test("marks the reader's own notifications read", async () => {
    const pool = db();
    let mine: number;
    try {
      const { rows } = await pool.query(
        `INSERT INTO notifications (recipient_id, type, title, body)
         VALUES ($1, 'scan_result', 'Mine', '') RETURNING id`,
        [patient.id]
      );
      mine = rows[0].id;
    } finally {
      await pool.end();
    }

    const res = await patient.session.patch(`/api/notifications/${mine}/read`);
    assert.equal(res.status, 200);

    const check = db();
    try {
      const { rows } = await check.query('SELECT read_at FROM notifications WHERE id = $1', [mine]);
      assert.ok(rows[0].read_at, 'the notification must now be read');
    } finally {
      await check.end();
    }

    // Marking it again is not an error.
    const again = await patient.session.patch(`/api/notifications/${mine}/read`);
    assert.equal(again.status, 200);
  });
});
