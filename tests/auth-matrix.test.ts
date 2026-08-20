/**
 * Authorization matrix.
 *
 * Every case here corresponds to a defect that was live in this codebase:
 *
 *  - `/api/doctor/*` had no guards at all, so an anonymous request returned the
 *    full patient roster with names, emails and clinical notes.
 *  - `/api/auth/register` took `role` from the request body, so one
 *    unauthenticated POST produced a working admin account and defeated every
 *    other check in the file.
 *  - patient routes addressed resources by their own id with no ownership
 *    check, so any logged-in patient could read, reschedule or delete another
 *    patient's appointments and scans by guessing a small integer.
 *
 * None of these are exotic. All three were invisible because nothing exercised
 * the authorization layer. The point of this file is that they cannot come back
 * silently.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  startServer,
  stopServer,
  registerPatient,
  Session,
  db,
  TEST_USER_PREFIX,
} from './helpers/server.ts';

const TIMEOUT = 120_000;

let patient: Awaited<ReturnType<typeof registerPatient>>;
let attacker: Awaited<ReturnType<typeof registerPatient>>;
let doctor: Awaited<ReturnType<typeof registerPatient>>;
let doctorSession: Session;
let anon: Session;

/** Resources owned by `patient`, which `attacker` will try to reach. */
let ownedAppointmentId: number;
let ownedScanId: number;

const createdUserIds: number[] = [];

before(async () => {
  await startServer();

  anon = new Session();
  patient = await registerPatient('victim');
  attacker = await registerPatient('attacker');
  doctor = await registerPatient('doctor');
  createdUserIds.push(patient.id, attacker.id, doctor.id);

  const pool = db();
  try {
    // Promote one account to doctor. Registration cannot do this — which is
    // itself asserted below — so it is done directly, the way an admin would.
    await pool.query('UPDATE users SET role = $1 WHERE id = $2', ['doctor', doctor.id]);

    const appt = await pool.query(
      `INSERT INTO appointments (patient_id, doctor_id, date, appointment_date, appointment_time, type)
       VALUES ($1, $2, NOW(), NOW(), '10:00', 'checkup') RETURNING id`,
      [patient.id, doctor.id]
    );
    ownedAppointmentId = appt.rows[0].id;

    const scan = await pool.query(
      `INSERT INTO medical_scans (patient_id, scan_type, result)
       VALUES ($1, 'skin', 'Processing') RETURNING id`,
      [patient.id]
    );
    ownedScanId = scan.rows[0].id;
  } finally {
    await pool.end();
  }

  doctorSession = new Session();
  const login = await doctorSession.post('/api/auth/login', {
    username: doctor.username,
    password: 'Passw0rd!23',
  });
  assert.equal(login.status, 200, 'doctor login should succeed');
});

after(async () => {
  const pool = db();
  try {
    // Sweep by exact prefix, not just the ids this run happens to have tracked.
    // A run that fails partway through `before` — or midway, as happens while
    // deliberately breaking a guard to prove the tests catch it — leaves
    // accounts behind, and they accumulate in a database that holds real
    // patients.
    //
    // `left(username, n) = prefix` rather than LIKE: see TEST_USER_PREFIX. A
    // LIKE pattern here once matched far more than intended and deleted
    // unrelated accounts. This comparison has no metacharacters.
    const stale = await pool.query('SELECT id FROM users WHERE left(username, $2) = $1', [
      TEST_USER_PREFIX,
      TEST_USER_PREFIX.length,
    ]);
    const ids = stale.rows.map((r: any) => r.id);
    if (ids.length) {
      await pool.query('DELETE FROM appointments WHERE patient_id = ANY($1)', [ids]);
      await pool.query('DELETE FROM medical_scans WHERE patient_id = ANY($1)', [ids]);
      await pool.query('DELETE FROM appointments WHERE doctor_id = ANY($1)', [ids]);
      await pool.query('UPDATE medical_scans SET radiologist_id = NULL WHERE radiologist_id = ANY($1)', [ids]);
      await pool.query('UPDATE audit_events SET actor_user_id = NULL WHERE actor_user_id = ANY($1)', [ids]);
      await pool.query('DELETE FROM users WHERE id = ANY($1)', [ids]);
    }
  } finally {
    await pool.end();
  }
  await stopServer();
});

// ---------------------------------------------------------------------------

describe('anonymous access', { timeout: TIMEOUT }, () => {
  const mustReject = [
    '/api/doctor/patients',
    '/api/doctor/reports',
    '/api/doctor/reports/pending',
    '/api/doctor/stats',
    '/api/doctor/notifications',
    '/api/doctor/activities/recent',
    '/api/patient/stats',
    '/api/patient/appointments',
    '/api/admin/stats',
    '/api/scans',
  ];

  for (const path of mustReject) {
    test(`401 for GET ${path}`, async () => {
      const res = await anon.get(path);
      assert.equal(res.status, 401, `${path} must require authentication`);
    });
  }

  test('patient roster is not served to anonymous callers', async () => {
    const res = await anon.get('/api/doctor/patients');
    assert.equal(res.status, 401);
    assert.ok(!/@/.test(res.text), 'response must not contain email addresses');
  });
});

describe('role separation', { timeout: TIMEOUT }, () => {
  const doctorOnly = [
    '/api/doctor/patients',
    '/api/doctor/reports',
    '/api/doctor/reports/pending',
    '/api/doctor/stats',
  ];

  for (const path of doctorOnly) {
    test(`patient gets 403 for ${path}`, async () => {
      const res = await patient.session.get(path);
      assert.equal(res.status, 403, `${path} must be closed to patients`);
    });

    test(`doctor gets 200 for ${path}`, async () => {
      const res = await doctorSession.get(path);
      assert.equal(res.status, 200, `${path} must remain open to clinicians`);
    });
  }

  for (const path of ['/api/admin/stats', '/api/admin/staff', '/api/admin/users/metrics']) {
    test(`doctor gets 403 for admin route ${path}`, async () => {
      const res = await doctorSession.get(path);
      assert.equal(res.status, 403, `${path} must be admin-only`);
    });
  }

  test('patient can still read their own data', async () => {
    for (const path of ['/api/patient/stats', '/api/patient/appointments', '/api/scans']) {
      const res = await patient.session.get(path);
      assert.equal(res.status, 200, `${path} must stay available to its owner`);
    }
  });
});

describe('privilege escalation via registration', { timeout: TIMEOUT }, () => {
  test('a self-registered account cannot choose its own role', async () => {
    const session = new Session();
    const username = `${TEST_USER_PREFIX}${Math.random().toString(36).slice(2, 10)}`;
    const res = await session.post('/api/auth/register', {
      username,
      password: 'Passw0rd!23',
      email: `${username}@example.test`,
      fullName: 'Escalation Attempt',
      role: 'admin',
      specialization: 'Oncology',
      licenseNumber: 'FAKE-123',
    });

    assert.equal(res.status, 200);
    createdUserIds.push(res.json.id);
    assert.equal(res.json.role, 'patient', 'requested role must be ignored');

    // And the account must actually behave as a patient.
    assert.equal((await session.get('/api/admin/staff')).status, 403);
    assert.equal((await session.get('/api/doctor/patients')).status, 403);
  });

  test('clinical credentials cannot be self-asserted', async () => {
    const pool = db();
    try {
      const r = await pool.query(
        'SELECT role, specialization, license_number FROM users WHERE id = $1',
        [createdUserIds[createdUserIds.length - 1]]
      );
      assert.equal(r.rows[0].role, 'patient');
      assert.ok(!r.rows[0].specialization, 'specialization must not be set from registration');
      assert.ok(!r.rows[0].license_number, 'licence number must not be set from registration');
    } finally {
      await pool.end();
    }
  });
});

describe('cross-patient access (IDOR)', { timeout: TIMEOUT }, () => {
  test("attacker cannot read another patient's appointment list", async () => {
    const res = await attacker.session.get(`/api/patient/appointments/${patient.id}`);
    assert.equal(res.status, 403);
  });

  test("attacker cannot reschedule another patient's appointment", async () => {
    const res = await attacker.session.patch(
      `/api/patient/appointments/${ownedAppointmentId}/reschedule`,
      { newDate: '2030-01-01', newTime: '09:00' }
    );
    assert.equal(res.status, 403);
  });

  test("attacker cannot delete another patient's appointment", async () => {
    const res = await attacker.session.del(`/api/patient/appointments/${ownedAppointmentId}`);
    assert.equal(res.status, 403);
  });

  test("attacker cannot delete another patient's scan", async () => {
    const res = await attacker.session.del(`/api/patient/activities/${ownedScanId}`);
    assert.equal(res.status, 403);
  });

  test('the rejected attempts left the records intact', async () => {
    const pool = db();
    try {
      const appt = await pool.query('SELECT id, status FROM appointments WHERE id = $1', [
        ownedAppointmentId,
      ]);
      const scan = await pool.query('SELECT id FROM medical_scans WHERE id = $1', [ownedScanId]);
      assert.equal(appt.rowCount, 1, 'appointment must survive the attack');
      assert.notEqual(appt.rows[0].status, 'rescheduled', 'appointment must not have been altered');
      assert.equal(scan.rowCount, 1, 'scan must survive the attack');
    } finally {
      await pool.end();
    }
  });

  test('the owner is unaffected and can still act', async () => {
    const res = await patient.session.get(`/api/patient/appointments/${patient.id}`);
    assert.equal(res.status, 200);
  });

  test('a patient cannot book an appointment against another patient id', async () => {
    await attacker.session.post('/api/patient/appointments', {
      patientId: patient.id,
      appointmentDate: '2030-01-01',
      appointmentTime: '09:00',
      type: 'checkup',
      doctorName: 'Nobody',
    });

    const pool = db();
    try {
      const r = await pool.query(
        "SELECT id FROM appointments WHERE patient_id = $1 AND appointment_time = '09:00'",
        [patient.id]
      );
      assert.equal(r.rowCount, 0, 'booking must not be attributed to another patient');
    } finally {
      await pool.end();
    }
  });
});

describe('routes that were reachable without a session', { timeout: TIMEOUT }, () => {
  test('anonymous callers cannot reach clinical write routes', async () => {
    assert.equal((await anon.post('/api/patients', { name: 'X', email: 'x@e.com' })).status, 401);
    assert.equal((await anon.post('/api/medical-terms', { term: 'x', definition: 'y' })).status, 401);
    assert.equal((await anon.post('/api/appointments/dermatologist', {
      dermatologistId: 1, date: '2030-01-01', time: '09:00',
    })).status, 401);
  });

  test('notifications are scoped to the session, not a query parameter', async () => {
    // Anonymous access is refused outright.
    assert.equal((await anon.get('/api/chat/notifications?userId=2')).status, 401);

    // And an authenticated caller cannot ask for someone else's by id: the
    // parameter is ignored entirely, so the response is their own list.
    const res = await attacker.session.get(`/api/chat/notifications?userId=${patient.id}`);
    assert.equal(res.status, 200);
    for (const n of res.json ?? []) {
      assert.equal(n.recipientId, attacker.id, 'must only return the caller\'s notifications');
    }
  });

  test('booking a dermatology appointment files it against the caller', async () => {
    const doctorId = doctor.id;
    const res = await patient.session.post('/api/appointments/dermatologist', {
      dermatologistId: doctorId,
      date: '2030-06-01',
      time: '09:00',
      reason: 'Lesion check',
    });
    assert.equal(res.status, 200);

    const pool = db();
    try {
      const row = await pool.query(
        'SELECT patient_id FROM appointments WHERE id = $1',
        [res.json.appointment.id]
      );
      assert.equal(
        row.rows[0].patient_id,
        patient.id,
        'appointment must belong to the caller, not a hardcoded default'
      );
    } finally {
      await pool.end();
    }
  });
});

describe('endpoints that used to confirm work they never did', { timeout: TIMEOUT }, () => {
  test('a radiologist report is actually persisted, not just acknowledged', async () => {
    const pool = db();
    let scanId: number;
    try {
      const scan = await pool.query(
        `INSERT INTO medical_scans (patient_id, scan_type, result)
         VALUES ($1, 'lung', 'Processing') RETURNING id`,
        [patient.id]
      );
      scanId = scan.rows[0].id;
    } finally {
      await pool.end();
    }

    const res = await doctorSession.post(`/api/radiologist/scans/${scanId}/report`, {
      findings: 'No acute abnormality.',
      recommendation: 'Routine follow-up.',
    });
    assert.equal(res.status, 200);

    const verify = db();
    try {
      const row = await verify.query(
        'SELECT findings, recommendations, status FROM medical_scans WHERE id = $1',
        [scanId]
      );
      assert.equal(row.rows[0].findings, 'No acute abnormality.');
      assert.equal(row.rows[0].recommendations, 'Routine follow-up.');
      assert.equal(row.rows[0].status, 'completed');
    } finally {
      await verify.end();
    }
  });

  test('report submission requires a clinician', async () => {
    assert.equal((await anon.post('/api/radiologist/scans/1/report', {
      findings: 'x', recommendation: 'y',
    })).status, 401);

    assert.equal((await patient.session.post('/api/radiologist/scans/1/report', {
      findings: 'x', recommendation: 'y',
    })).status, 403);
  });

  test('the unauthenticated no-op reschedule endpoint no longer confirms anything', async () => {
    const res = await anon.patch('/api/appointments/1/reschedule', {
      newDate: '2030-01-01',
      newTime: '09:00',
    });

    // The route is deleted. An unmatched /api path falls through to the SPA
    // catch-all, which answers 200 with index.html — so the status code is not
    // the thing to assert on. What matters is that no JSON success body comes
    // back: nothing tells the caller a clinical action succeeded.
    assert.equal(res.json?.success, undefined, 'must not report success');
    assert.ok(
      !/rescheduled successfully/i.test(res.text),
      'must not claim the appointment was rescheduled'
    );
  });
});

describe('scan ownership', { timeout: TIMEOUT }, () => {
  test("a patient cannot delete another patient's scan via /api/scans/:id", async () => {
    const pool = db();
    let scanId: number;
    try {
      const scan = await pool.query(
        `INSERT INTO medical_scans (patient_id, scan_type, result)
         VALUES ($1, 'skin', 'Processing') RETURNING id`,
        [patient.id]
      );
      scanId = scan.rows[0].id;
    } finally {
      await pool.end();
    }

    const res = await attacker.session.del(`/api/scans/${scanId}`);
    assert.equal(res.status, 403);

    const verify = db();
    try {
      const row = await verify.query('SELECT id FROM medical_scans WHERE id = $1', [scanId]);
      assert.equal(row.rowCount, 1, 'scan must survive');
    } finally {
      await verify.end();
    }
  });
});

describe('PHI access is audited', { timeout: TIMEOUT }, () => {
  test('a successful read is attributed to the reader', async () => {
    const res = await doctorSession.get('/api/doctor/patients');
    assert.equal(res.status, 200);

    await new Promise((r) => setTimeout(r, 1500)); // audit row is written on finish

    const pool = db();
    try {
      const rows = await pool.query(
        `SELECT action, actor_role, status_code FROM audit_events
         WHERE actor_user_id = $1 AND action = 'READ_PATIENT_LIST'
         ORDER BY occurred_at DESC LIMIT 1`,
        [doctor.id]
      );
      assert.equal(rows.rowCount, 1, 'a READ_PATIENT_LIST row must exist');
      assert.equal(rows.rows[0].actor_role, 'doctor');
      assert.equal(rows.rows[0].status_code, 200);
    } finally {
      await pool.end();
    }
  });

  test('a refused read is recorded too', async () => {
    await anon.get('/api/doctor/patients');
    await new Promise((r) => setTimeout(r, 1500));

    const pool = db();
    try {
      const rows = await pool.query(
        `SELECT status_code FROM audit_events
         WHERE action = 'READ_PATIENT_LIST' AND status_code = 401
         ORDER BY occurred_at DESC LIMIT 1`
      );
      assert.equal(rows.rowCount, 1, 'a denied read must still produce an audit row');
    } finally {
      await pool.end();
    }
  });
});
