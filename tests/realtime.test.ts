/**
 * The real-time layer, end to end.
 *
 * Every assertion here corresponds to something that was broken:
 *
 *  - Two WebSocket managers were started against the same HTTP server, so the
 *    first client to open /ws made ws throw out of an event handler and killed
 *    the process. The app's own frontend opens that socket on load.
 *  - The socket accepted every upgrade and then believed whatever identity the
 *    client claimed in its first frame, so `{id: 7, role: 'admin'}` was enough
 *    to be registered as user 7 and receive their messages and notifications.
 *  - Clients could originate `scan_update` and `notification` broadcasts, which
 *    every connected dashboard rendered as though the server had sent them.
 *  - Nothing was ever pushed by the server, so "real-time chat" only updated on
 *    a refetch.
 *  - POST /api/chat/mark-read returned {success: true} without touching the
 *    database, and /api/chat/notify accepted unauthenticated notifications
 *    addressed to any user from any claimed sender.
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';

import {
  PORT,
  Session,
  TEST_USER_PREFIX,
  db,
  registerPatient,
  startServer,
  stopServer,
} from './helpers/server.ts';

const TIMEOUT = 90_000;

let patient: Awaited<ReturnType<typeof registerPatient>>;
let bystander: Awaited<ReturnType<typeof registerPatient>>;
let doctor: Awaited<ReturnType<typeof registerPatient>>;
let doctorSession: Session;

/** Opens an authenticated socket and collects every frame it receives. */
function openSocket(cookie: string): Promise<{ ws: WebSocket; frames: any[] }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`, { headers: { Cookie: cookie } });
    const frames: any[] = [];
    const timer = setTimeout(() => reject(new Error('socket did not open')), 15_000);

    ws.on('message', (raw) => frames.push(JSON.parse(raw.toString())));
    ws.on('open', () => {
      clearTimeout(timer);
      resolve({ ws, frames });
    });
    ws.on('unexpected-response', (_req, res) => {
      clearTimeout(timer);
      reject(Object.assign(new Error(`upgrade refused: ${res.statusCode}`), {
        statusCode: res.statusCode,
      }));
    });
    ws.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

const settle = (ms = 800) => new Promise((r) => setTimeout(r, ms));

/** The cookie a Session is holding, for handing to a WebSocket. */
const cookieOf = (session: Session): string => session.cookieHeader;

before(async () => {
  await startServer();

  patient = await registerPatient('rt-patient');
  bystander = await registerPatient('rt-bystander');
  doctor = await registerPatient('rt-doctor');

  const pool = db();
  try {
    // Registration always creates a patient, which the authorization suite
    // asserts. Promote one directly, the way an admin would.
    await pool.query('UPDATE users SET role = $1 WHERE id = $2', ['doctor', doctor.id]);
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
    const stale = await pool.query('SELECT id FROM users WHERE left(username, $2) = $1', [
      TEST_USER_PREFIX,
      TEST_USER_PREFIX.length,
    ]);
    const ids = stale.rows.map((r: any) => r.id);
    if (ids.length) {
      await pool.query(
        'DELETE FROM chat_messages WHERE sender_id = ANY($1) OR receiver_id = ANY($1)',
        [ids]
      );
      await pool.query(
        'DELETE FROM notifications WHERE recipient_id = ANY($1) OR actor_id = ANY($1)',
        [ids]
      );
      await pool.query('DELETE FROM appointments WHERE patient_id = ANY($1) OR doctor_id = ANY($1)', [ids]);
      await pool.query('DELETE FROM medical_scans WHERE patient_id = ANY($1)', [ids]);
      await pool.query('UPDATE audit_events SET actor_user_id = NULL WHERE actor_user_id = ANY($1)', [ids]);
      await pool.query('DELETE FROM users WHERE id = ANY($1)', [ids]);
    }
  } finally {
    await pool.end();
  }
  await stopServer();
});

// ---------------------------------------------------------------------------

describe('websocket authentication', { timeout: TIMEOUT }, () => {
  test('an unauthenticated upgrade is refused', async () => {
    await assert.rejects(
      () => openSocket(''),
      (err: any) => err.statusCode === 401,
      'anonymous clients must not be able to open /ws'
    );
  });

  test('the server survives a websocket connection', async () => {
    // Not a tautology. Two managers were attached to the same HTTP server, so
    // the first upgrade threw "handleUpgrade() was called more than once with
    // the same socket" from inside an event handler and took the process down.
    const { ws } = await openSocket(cookieOf(patient.session));
    ws.close();
    await settle(300);

    const health = await new Session().get('/api/health');
    assert.equal(health.status, 200, 'the server must still be running');
  });

  test('a socket cannot claim an identity it does not have', async () => {
    const { ws, frames } = await openSocket(cookieOf(patient.session));
    ws.send(
      JSON.stringify({
        type: 'user_authenticate',
        data: { id: 999_999, username: 'attacker', role: 'admin', fullName: 'Not Real' },
      })
    );
    await settle();
    ws.close();

    const success = frames.find((f) => f.type === 'authentication_success');
    assert.ok(success, 'the socket should be registered');
    assert.equal(
      success.data.userId,
      patient.id,
      'identity must come from the session, not from the frame'
    );

    const roster = frames.find((f) => f.type === 'online_users');
    assert.ok(
      !roster?.data.users.some((u: any) => u.id === 999_999 || u.role === 'admin'),
      'a claimed admin identity must never reach the online roster'
    );
  });
});

describe('server-originated delivery', { timeout: TIMEOUT }, () => {
  test('a sent message reaches the recipient over the socket', async () => {
    const recipient = await openSocket(cookieOf(patient.session));
    await settle();
    recipient.frames.length = 0;

    const sent = await doctorSession.post('/api/chat/send', {
      receiverId: patient.id,
      message: 'Your results are ready.',
    });
    assert.equal(sent.status, 200, sent.text.slice(0, 200));

    await settle();
    recipient.ws.close();

    const pushed = recipient.frames.find((f) => f.type === 'new_chat_message');
    assert.ok(pushed, 'the recipient should receive the message without refetching');
    assert.equal(pushed.data.message, 'Your results are ready.');
    assert.equal(pushed.data.senderId, doctor.id, 'the sender is stamped by the server');
  });

  test('a client cannot originate a scan result broadcast', async () => {
    const listener = await openSocket(cookieOf(patient.session));
    const sender = await openSocket(cookieOf(doctorSession));
    await settle();
    listener.frames.length = 0;

    sender.ws.send(
      JSON.stringify({ type: 'scan_update', data: { result: 'FABRICATED MALIGNANT' } })
    );
    await settle();
    sender.ws.close();
    listener.ws.close();

    assert.ok(
      !listener.frames.some((f) => f.type === 'scan_update' || f.type === 'scan_completed'),
      'scan results must only originate from the server'
    );
  });

  test('presence is reported from live connections, not hardcoded', async () => {
    const online = await openSocket(cookieOf(doctorSession));
    await settle();

    const participants = await patient.session.get('/api/chat/participants');
    assert.equal(participants.status, 200);
    const seen = participants.json.find((p: any) => p.id === doctor.id);

    online.ws.close();

    assert.ok(seen, 'a clinician should appear in a patient\'s participant list');
    assert.equal(seen.isOnline, true, 'isOnline was hardcoded to false for every participant');
  });
});

describe('chat persistence', { timeout: TIMEOUT }, () => {
  test('mark-read writes to the database and is idempotent', async () => {
    await doctorSession.post('/api/chat/send', {
      receiverId: patient.id,
      message: 'Please confirm receipt.',
    });

    const first = await patient.session.post('/api/chat/mark-read', { senderId: doctor.id });
    assert.equal(first.status, 200);
    assert.ok(first.json.marked >= 1, 'mark-read used to report success without doing anything');

    const second = await patient.session.post('/api/chat/mark-read', { senderId: doctor.id });
    assert.equal(second.json.marked, 0, 'nothing is left to mark on a second call');
  });

  test('notifications survive in the database and can be marked read', async () => {
    await doctorSession.post('/api/chat/send', {
      receiverId: patient.id,
      message: 'A second note.',
    });

    const listed = await patient.session.get('/api/chat/notifications');
    assert.equal(listed.status, 200);
    const note = listed.json.find((n: any) => n.type === 'chat_message');
    assert.ok(note, 'sending a message should raise a notification for the recipient');
    assert.equal(note.read, false);

    const marked = await patient.session.post('/api/chat/notifications/mark-read', {
      notificationId: note.id,
    });
    assert.equal(marked.json.marked, 1);

    const after = await patient.session.get('/api/chat/notifications');
    assert.equal(after.json.find((n: any) => n.id === note.id).read, true);
  });

  test('the unauthenticated notification injector is gone', async () => {
    const anon = new Session();
    const res = await anon.post('/api/chat/notify', {
      recipientId: patient.id,
      senderId: doctor.id,
      senderName: 'Dr Impostor',
      message: 'Take this medication',
    });
    assert.equal(res.status, 404, '/api/chat/notify must not exist');
  });
});

describe('chat authorization', { timeout: TIMEOUT }, () => {
  test('a patient cannot message another patient', async () => {
    const res = await patient.session.post('/api/chat/send', {
      receiverId: bystander.id,
      message: 'hello stranger',
    });
    assert.equal(res.status, 403, 'the participant matrix must be enforced on send');
  });

  test('an unknown recipient is a 404, not a 500', async () => {
    const res = await doctorSession.post('/api/chat/send', {
      receiverId: 99_999_999,
      message: 'x',
    });
    assert.equal(res.status, 404);
  });
});

describe('session lifecycle', { timeout: TIMEOUT }, () => {
  test('signing out everywhere revokes the other sessions and keeps this one', async () => {
    // Two more logins for the same account, so there is something to revoke.
    const second = new Session();
    const third = new Session();
    for (const session of [second, third]) {
      const login = await session.post('/api/auth/login', {
        username: patient.username,
        password: 'Passw0rd!23',
      });
      assert.equal(login.status, 200);
    }

    const listed = await patient.session.get('/api/advanced/security/sessions');
    assert.equal(listed.status, 200);
    assert.ok(
      listed.json.totalSessions >= 3,
      `expected the account's real sessions to be listed, got ${listed.json.totalSessions}`
    );
    assert.ok(
      listed.json.activeSessions.some((s: any) => s.current),
      'the calling session should be marked current'
    );

    const terminated = await patient.session.post('/api/advanced/security/sessions/terminate-all', {});
    assert.equal(terminated.status, 200);
    assert.ok(
      terminated.json.terminatedSessions >= 2,
      'this used to report 0 while claiming all other sessions were terminated'
    );

    assert.equal((await second.get('/api/auth/me')).status, 401, 'the other session must be dead');
    assert.equal((await patient.session.get('/api/auth/me')).status, 200, 'this session must survive');
  });

  test('deleting an account ends its sessions immediately', async () => {
    // A throwaway patient, logged in, then deleted by an admin.
    const victim = await registerPatient('rt-victim');
    assert.equal((await victim.session.get('/api/auth/me')).status, 200);

    const pool = db();
    let adminSession: Session;
    try {
      await pool.query('UPDATE users SET role = $1 WHERE id = $2', ['admin', doctor.id]);
      adminSession = new Session();
      const login = await adminSession.post('/api/auth/login', {
        username: doctor.username,
        password: 'Passw0rd!23',
      });
      assert.equal(login.status, 200);

      const deleted = await adminSession.del(`/api/admin/users/${victim.id}`);
      assert.equal(deleted.status, 200, deleted.text.slice(0, 200));

      assert.equal(
        (await victim.session.get('/api/auth/me')).status,
        401,
        'a deleted account stayed logged in until its cookie expired \u2014 up to 24 hours'
      );
    } finally {
      // Put the clinician back the way the other suites expect it.
      await pool.query('UPDATE users SET role = $1 WHERE id = $2', ['doctor', doctor.id]);
      await pool.query(`DELETE FROM session WHERE (sess -> 'user' ->> 'id')::int = $1`, [doctor.id]);
      await pool.end();
    }

    // doctorSession's role claim is now stale; re-establish it for later suites.
    doctorSession = new Session();
    const relogin = await doctorSession.post('/api/auth/login', {
      username: doctor.username,
      password: 'Passw0rd!23',
    });
    assert.equal(relogin.status, 200);
  });
});

describe('API surface', { timeout: TIMEOUT }, () => {
  test('an unknown /api path returns JSON, not the single-page app', async () => {
    const res = await new Session().get('/api/definitely-not-a-route');
    assert.equal(res.status, 404);
    assert.ok(
      res.json && typeof res.json.error === 'string',
      'the SPA catch-all used to answer 200 with HTML for every unmatched /api path'
    );
  });

  test('readiness reports the database, and health stays cheap', async () => {
    const anon = new Session();

    const health = await anon.get('/api/health');
    assert.equal(health.status, 200);

    const ready = await anon.get('/api/ready');
    assert.equal(ready.status, 200, 'the database is up in this run');
    assert.equal(ready.json.database, 'ok');
    assert.equal(typeof ready.json.latencyMs, 'number');
  });
});
