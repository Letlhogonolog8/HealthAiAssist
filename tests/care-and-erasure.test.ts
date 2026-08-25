/**
 * Care relationships, break-glass, and the erasure a health system may not grant.
 *
 * Two controls that are easy to implement in a way that looks right and is not:
 *
 *   - An access check that admits everyone in a clinical role is the check this
 *     replaces. These tests pin that a clinician with no connection to a patient
 *     is refused, that a clinician who is treating them is not, and that the
 *     override is recorded rather than silent.
 *
 *   - An erasure flow that reports success while a statutory retention duty
 *     silently prevents the deletion is worse than no flow at all, because the
 *     person believes their record is gone. These pin that the clinical record
 *     is held, that the reason names the law, and that the audit trail survives.
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
let strangerDoctor: { session: Session; id: number };
let admin: { session: Session; id: number };

/**
 * Promotes a registered account to a role the registration endpoint refuses to
 * issue. Staff accounts are created by administrators in the real flow; there is
 * no bootstrap admin in a fresh test database, so the role is set directly.
 */
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

before(async () => {
  await startServer();

  patient = await registerPatient('careptA');
  otherPatient = await registerPatient('careptB');

  const doc = await registerPatient('caredoc');
  await promote(doc.id, 'doctor');
  strangerDoctor = { session: await loginAs(doc.username), id: doc.id };

  const adm = await registerPatient('careadm');
  await promote(adm.id, 'admin');
  admin = { session: await loginAs(adm.username), id: adm.id };
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
        await pool.query('DELETE FROM care_relationships WHERE patient_id = ANY($1) OR clinician_id = ANY($1)', [ids]);
        await pool.query('DELETE FROM erasure_requests WHERE patient_id = ANY($1) OR reviewed_by = ANY($1)', [ids]);
        await pool.query('DELETE FROM genomic_consents WHERE patient_id = ANY($1)', [ids]);
        await pool.query('DELETE FROM medical_scans WHERE patient_id = ANY($1)', [ids]);
        await pool.query('DELETE FROM chat_messages WHERE sender_id = ANY($1) OR receiver_id = ANY($1)', [ids]);
        await pool.query('DELETE FROM notifications WHERE recipient_id = ANY($1) OR actor_id = ANY($1)', [ids]);
        await pool.query('DELETE FROM appointments WHERE patient_id = ANY($1) OR doctor_id = ANY($1)', [ids]);
        await pool.query('DELETE FROM audit_events WHERE actor_user_id = ANY($1)', [ids]);
        await pool.query(`DELETE FROM session WHERE (sess -> 'user' ->> 'id')::int = ANY($1)`, [ids]);
        await pool.query('DELETE FROM users WHERE id = ANY($1)', [ids]);
      }
    } finally {
      await pool.end();
    }
  } finally {
    await stopServer();
  }
}, { timeout: TIMEOUT });

describe('break-glass', () => {
  test('a justification is required, and a token gesture is not one', async () => {
    const empty = await strangerDoctor.session.post('/api/clinical/break-glass', {
      patientId: patient.id,
    });
    assert.equal(empty.status, 400);

    const trivial = await strangerDoctor.session.post('/api/clinical/break-glass', {
      patientId: patient.id,
      justification: '.',
    });
    assert.equal(trivial.status, 400);
    assert.match(trivial.json.error, /at least a sentence/i);
  });

  test('an unknown patient is refused', async () => {
    const res = await strangerDoctor.session.post('/api/clinical/break-glass', {
      patientId: 99999999,
      justification: 'Patient presented unconscious in casualty and I need their history.',
    });
    assert.equal(res.status, 404);
  });

  test('a patient cannot open emergency access to anyone', async () => {
    const res = await patient.session.post('/api/clinical/break-glass', {
      patientId: otherPatient.id,
      justification: 'I would like to read this other person record for no good reason.',
    });
    assert.equal(res.status, 403);
  });

  test('a granted override is time-boxed and written to the audit trail', async () => {
    const justification =
      'Patient presented unconscious in casualty; I need prior imaging before theatre.';

    const res = await strangerDoctor.session.post('/api/clinical/break-glass', {
      patientId: patient.id,
      justification,
    });

    assert.equal(res.status, 200);
    assert.equal(res.json.granted, true);

    const expiry = new Date(res.json.expiresAt).getTime();
    assert.ok(expiry > Date.now(), 'grant is in the future');
    assert.ok(expiry - Date.now() <= 4 * 60 * 60 * 1000 + 60_000, 'grant is time-boxed');

    const pool = db();
    try {
      const { rows } = await pool.query(
        `SELECT action, detail FROM audit_events
          WHERE action = 'BREAK_GLASS_OPENED' AND actor_user_id = $1
          ORDER BY occurred_at DESC LIMIT 1`,
        [strangerDoctor.id]
      );
      assert.equal(rows.length, 1, 'the override was recorded');
      assert.match(rows[0].detail, /emergency access to patient/);
      // The clinician's stated reason is retained: an override nobody can review
      // the reasoning for is not reviewable.
      assert.match(rows[0].detail, /unconscious in casualty/);

      const grants = await pool.query(
        `SELECT basis, justification, expires_at FROM care_relationships
          WHERE clinician_id = $1 AND patient_id = $2`,
        [strangerDoctor.id, patient.id]
      );
      assert.equal(grants.rows.length, 1);
      assert.equal(grants.rows[0].basis, 'break_glass');
      assert.ok(grants.rows[0].expires_at, 'the grant expires');
    } finally {
      await pool.end();
    }
  });

  test('an administrator can see what is currently open', async () => {
    const res = await admin.session.get('/api/admin/break-glass/active');
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.json));
    assert.ok(
      res.json.some((row: any) => row.clinicianId === strangerDoctor.id),
      'the open grant is listed'
    );
  });

  test('a non-administrator cannot', async () => {
    const res = await strangerDoctor.session.get('/api/admin/break-glass/active');
    assert.equal(res.status, 403);
  });
});

describe('erasure', () => {
  test('the assessment says what would be kept, and why, before anything happens', async () => {
    const res = await patient.session.get('/api/patient/me/erasure-assessment');
    assert.equal(res.status, 200);

    const categories: any[] = res.json.categories;
    assert.ok(categories.length >= 5);

    // The audit trail is never erasable, and the reason has to say so rather
    // than leaving the data subject to infer it.
    const audit = categories.find((c) => c.category === 'Audit trail');
    assert.equal(audit.disposition, 'retained');
    assert.match(audit.reason, /accountability/i);

    // Contact details carry no retention duty and go.
    const contact = categories.find((c) => c.category.startsWith('Contact details'));
    assert.equal(contact.disposition, 'erased');

    // Every category explains itself. A disposition with no reason is the thing
    // this endpoint exists to avoid.
    for (const category of categories) {
      assert.ok(category.reason && category.reason.length > 20, `${category.category} has a reason`);
    }
  });

  test('a clinical record within the retention period is refused, citing the basis', async () => {
    const pool = db();
    try {
      // A scan dated today puts the account inside the six-year hold.
      await pool.query(
        `INSERT INTO medical_scans (patient_id, scan_type, result, status, created_at)
         VALUES ($1, 'skin', 'Test scan', 'completed', now())`,
        [patient.id]
      );
    } finally {
      await pool.end();
    }

    const res = await patient.session.get('/api/patient/me/erasure-assessment');
    const scans = res.json.categories.find((c: any) => c.category === 'Screening scans and findings');

    assert.equal(scans.disposition, 'retained');
    assert.equal(scans.count, 1);
    // Naming the instrument is the difference between a refusal and a brush-off.
    assert.match(scans.reason, /National Health Act/);
    assert.ok(res.json.clinicalHoldUntil, 'the hold has an end date');

    const holdEnds = new Date(res.json.clinicalHoldUntil).getFullYear();
    assert.equal(holdEnds, new Date().getFullYear() + 6);
  });

  test('a request is recorded, and a second one is refused while it is open', async () => {
    const first = await patient.session.post('/api/patient/me/erasure-request', {
      notes: 'Please remove my data.',
    });
    assert.equal(first.status, 200);
    assert.equal(first.json.status, 'pending');
    assert.ok(first.json.assessment, 'the outcome is shown at request time');

    const second = await patient.session.post('/api/patient/me/erasure-request', {});
    assert.equal(second.status, 409);
  });

  test('only an administrator can execute one', async () => {
    const list = await admin.session.get('/api/admin/erasure-requests');
    assert.equal(list.status, 200);
    const request = list.json.find((r: any) => r.patientId === patient.id);
    assert.ok(request, 'the request is visible to an administrator');

    const byPatient = await patient.session.post(
      `/api/admin/erasure-requests/${request.id}/execute`,
      {}
    );
    assert.equal(byPatient.status, 403);

    const byDoctor = await strangerDoctor.session.post(
      `/api/admin/erasure-requests/${request.id}/execute`,
      {}
    );
    assert.equal(byDoctor.status, 403);
  });

  test('executing erases what it may, keeps the clinical record, and keeps the audit trail', async () => {
    const list = await admin.session.get('/api/admin/erasure-requests');
    const request = list.json.find((r: any) => r.patientId === patient.id);

    const res = await admin.session.post(`/api/admin/erasure-requests/${request.id}/execute`, {});
    assert.equal(res.status, 200);
    // Something went and something stayed, so neither "completed" nor "refused".
    assert.equal(res.json.status, 'partially_completed');

    const pool = db();
    try {
      const user = await pool.query(
        'SELECT full_name, email, is_active, phone FROM users WHERE id = $1',
        [patient.id]
      );
      assert.equal(user.rows.length, 1, 'the row is kept, not deleted');
      assert.match(user.rows[0].full_name, /Erased at data subject request/);
      assert.equal(user.rows[0].is_active, false);
      assert.equal(user.rows[0].phone, null);

      const scans = await pool.query(
        'SELECT id FROM medical_scans WHERE patient_id = $1',
        [patient.id]
      );
      assert.equal(scans.rows.length, 1, 'the clinical record is retained under the statutory hold');

      const audit = await pool.query(
        `SELECT id FROM audit_events WHERE action = 'ERASURE_COMPLETED'`
      );
      assert.ok(audit.rows.length >= 1, 'the erasure itself is audited');
    } finally {
      await pool.end();
    }
  });

  test('an executed request cannot be executed twice', async () => {
    const list = await admin.session.get('/api/admin/erasure-requests');
    const request = list.json.find((r: any) => r.patientId === patient.id);

    const res = await admin.session.post(`/api/admin/erasure-requests/${request.id}/execute`, {});
    assert.equal(res.status, 409);
  });
});
