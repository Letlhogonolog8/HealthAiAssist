/**
 * Second factor: enrolment, challenge, and the properties that make it worth
 * having.
 *
 * The TOTP primitives existed in this codebase for months with no route calling
 * them, which is the same category of defect as a guard that is present but
 * registered after the handler — the code reads as protected and is not. These
 * tests exist so that "MFA is implemented" means something checkable.
 *
 * The properties pinned here, in rough order of how badly each would matter:
 *
 *   - a password alone does not produce an authenticated session for an
 *     enrolled account, and the half-authenticated session is invisible to
 *     every guard in the system;
 *   - enrolment does not enable until a code has been verified, so a failed QR
 *     scan cannot lock a clinician out;
 *   - recovery codes are single use — the defect in the original helper was
 *     that it could not identify which code matched and therefore could not
 *     consume one;
 *   - the second factor cannot be removed with a session alone;
 *   - the secret is not readable back out of the API.
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import speakeasy from 'speakeasy';

import {
  Session,
  TEST_USER_PREFIX,
  db,
  registerPatient,
  startServer,
  stopServer,
} from './helpers/server.ts';

const TIMEOUT = 120_000;

/** A code the server will accept right now. */
function currentToken(base32: string): string {
  return speakeasy.totp({ secret: base32, encoding: 'base32' });
}

interface Enrolled {
  user: Awaited<ReturnType<typeof registerPatient>>;
  secret: string;
  backupCodes: string[];
}

/**
 * A registered account with MFA fully enrolled and enabled.
 *
 * One per scenario group, and that is not tidiness — it is `loginLimiter`.
 *
 * That limiter allows five attempts per (IP, username) per fifteen minutes and,
 * alone among the limiters in this codebase, has no development skip. Every
 * other one calls `skip: shouldSkip`, which disables it when NODE_ENV is
 * development; the login limiter deliberately does not, because throttling
 * credential stuffing is not something you want switched off by an environment
 * variable.
 *
 * The consequence for tests is that a suite exercising the login path more than
 * five times as the same user gets 429s that look like assertion failures
 * somewhere unrelated — which is exactly how this was first observed here: a
 * recovery-code test failed with 401 because the *login* before it had been
 * rate limited, leaving no pending state for the challenge to find.
 *
 * Separate users keep each group inside its own bucket.
 */
async function enrolUser(label: string): Promise<Enrolled> {
  const user = await registerPatient(label);

  const enrol = await user.session.post('/api/auth/mfa/enroll', {});
  if (enrol.status !== 200) {
    throw new Error(`enrol failed (${enrol.status}): ${enrol.text.slice(0, 200)}`);
  }

  const parsed = new URL(enrol.json.otpauthUrl.replace('otpauth://', 'https://'));
  const secret = parsed.searchParams.get('secret') ?? '';

  const verify = await user.session.post('/api/auth/mfa/verify', {
    token: currentToken(secret),
  });
  if (verify.status !== 200) {
    throw new Error(`verify failed (${verify.status}): ${verify.text.slice(0, 200)}`);
  }

  return { user, secret, backupCodes: enrol.json.backupCodes };
}

/** Enrolment group: registered but not yet enrolled, so the flow can be walked. */
let user: Awaited<ReturnType<typeof registerPatient>>;
let secret = '';
let backupCodes: string[] = [];

let challengeAccount: Enrolled;
let recoveryAccount: Enrolled;
let disableAccount: Enrolled;

before(async () => {
  await startServer();
  user = await registerPatient('mfa');
  challengeAccount = await enrolUser('mfachal');
  recoveryAccount = await enrolUser('mfarec');
  disableAccount = await enrolUser('mfadis');
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
        await pool.query(
          `DELETE FROM audit_events WHERE actor_user_id = ANY($1)`,
          [ids]
        );
        await pool.query(
          `DELETE FROM session WHERE (sess -> 'user' ->> 'id')::int = ANY($1)`,
          [ids]
        );
        await pool.query('DELETE FROM users WHERE id = ANY($1)', [ids]);
      }
    } finally {
      await pool.end();
    }
  } finally {
    await stopServer();
  }
}, { timeout: TIMEOUT });

describe('MFA enrolment', () => {
  test('starts disabled, and reports whether the role requires it', async () => {
    const res = await user.session.get('/api/auth/mfa/status');
    assert.equal(res.status, 200);
    assert.equal(res.json.enabled, false);
    assert.equal(res.json.backupCodesRemaining, 0);
    // A patient account: the default required set is doctor/radiologist/admin.
    assert.equal(res.json.required, false);
  });

  test('enrolling returns a QR and recovery codes, but does not enable', async () => {
    const res = await user.session.post('/api/auth/mfa/enroll', {});
    assert.equal(res.status, 200);

    assert.match(res.json.otpauthUrl, /^otpauth:\/\/totp\//);
    assert.match(res.json.qrDataUrl, /^data:image\/png;base64,/);
    assert.equal(res.json.backupCodes.length, 8);

    backupCodes = res.json.backupCodes;

    // Recovered from the otpauth URL, the way an authenticator app would.
    const parsed = new URL(res.json.otpauthUrl.replace('otpauth://', 'https://'));
    secret = parsed.searchParams.get('secret') ?? '';
    assert.ok(secret.length > 0, 'otpauth URL carries a secret');

    // The critical half: a secret exists but the factor is NOT on yet. Enabling
    // here would lock out anyone whose authenticator failed to scan the code.
    const status = await user.session.get('/api/auth/mfa/status');
    assert.equal(status.json.enabled, false);
    assert.equal(status.json.backupCodesRemaining, 8);
  });

  test('a wrong code does not enable the factor', async () => {
    const res = await user.session.post('/api/auth/mfa/verify', { token: '000000' });
    assert.equal(res.status, 400);

    const status = await user.session.get('/api/auth/mfa/status');
    assert.equal(status.json.enabled, false);
  });

  test('a correct code enables it', async () => {
    const res = await user.session.post('/api/auth/mfa/verify', {
      token: currentToken(secret),
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.enabled, true);

    const status = await user.session.get('/api/auth/mfa/status');
    assert.equal(status.json.enabled, true);
    assert.ok(status.json.enrolledAt, 'enrolment time recorded');
  });

  test('the secret is never readable back out of the API', async () => {
    const status = await user.session.get('/api/auth/mfa/status');
    const serialized = JSON.stringify(status.json);
    assert.ok(!serialized.includes(secret), 'status does not echo the secret');

    const me = await user.session.get('/api/auth/me');
    assert.ok(
      !JSON.stringify(me.json).includes(secret),
      '/api/auth/me does not echo the secret'
    );
  });

  test('re-enrolling while enabled is refused', async () => {
    const res = await user.session.post('/api/auth/mfa/enroll', {});
    assert.equal(res.status, 409);
  });
});

describe('MFA challenge at login', () => {
  const account = () => challengeAccount;

  test('a correct password alone does not authenticate an enrolled account', async () => {
    const fresh = new Session();
    const login = await fresh.post('/api/auth/login', {
      username: account().user.username,
      password: 'Passw0rd!23',
    });

    assert.equal(login.status, 200);
    assert.equal(login.json.mfaRequired, true);
    // No identity in the response.
    assert.equal(login.json.id, undefined);
    assert.equal(login.json.role, undefined);

    // And, more importantly, no identity in the session: the pending state must
    // be invisible to every guard, not merely to this response body.
    const me = await fresh.get('/api/auth/me');
    assert.equal(me.status, 401);
  });

  test('a wrong second factor is refused', async () => {
    const fresh = new Session();
    await fresh.post('/api/auth/login', {
      username: account().user.username,
      password: 'Passw0rd!23',
    });

    const res = await fresh.post('/api/auth/mfa/challenge', { token: '000000' });
    assert.equal(res.status, 401);

    const me = await fresh.get('/api/auth/me');
    assert.equal(me.status, 401);
  });

  test('a correct second factor completes the login', async () => {
    const fresh = new Session();
    await fresh.post('/api/auth/login', {
      username: account().user.username,
      password: 'Passw0rd!23',
    });

    const res = await fresh.post('/api/auth/mfa/challenge', {
      token: currentToken(account().secret),
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.username, account().user.username);

    const me = await fresh.get('/api/auth/me');
    assert.equal(me.status, 200);
    assert.equal(me.json.username, account().user.username);
  });

  test('the challenge cannot be reached without a password first', async () => {
    const anonymous = new Session();
    const res = await anonymous.post('/api/auth/mfa/challenge', {
      token: currentToken(account().secret),
    });
    assert.equal(res.status, 401);
  });

  test('five wrong codes end the attempt rather than throttling it', async () => {
    const fresh = new Session();
    await fresh.post('/api/auth/login', {
      username: account().user.username,
      password: 'Passw0rd!23',
    });

    for (let i = 0; i < 5; i += 1) {
      const wrong = await fresh.post('/api/auth/mfa/challenge', { token: '000000' });
      assert.equal(wrong.status, 401);
    }

    // The sixth attempt is refused even with a CORRECT code: the pending state
    // is gone, so the guesser has to produce the password again.
    const correct = await fresh.post('/api/auth/mfa/challenge', {
      token: currentToken(account().secret),
    });
    assert.equal(correct.status, 401);
    assert.match(correct.json.error, /sign in again/i);
  });
});

describe('recovery codes', () => {
  const account = () => recoveryAccount;

  test('a recovery code completes a login and is then consumed', async () => {
    const code = account().backupCodes[0];

    const first = new Session();
    await first.post('/api/auth/login', {
      username: account().user.username,
      password: 'Passw0rd!23',
    });
    const used = await first.post('/api/auth/mfa/challenge', { backupCode: code });

    assert.equal(used.status, 200);
    assert.equal(used.json.usedBackupCode, true);
    assert.equal(used.json.backupCodesRemaining, 7);

    // The property the original helper could not provide: it compared with
    // `.some()` and returned a boolean, so it never knew which code matched and
    // could not remove it. Every recovery code stayed valid forever.
    const second = new Session();
    await second.post('/api/auth/login', {
      username: account().user.username,
      password: 'Passw0rd!23',
    });
    const replayed = await second.post('/api/auth/mfa/challenge', { backupCode: code });

    assert.equal(replayed.status, 401);
  });

  test('an unused recovery code still works', async () => {
    const fresh = new Session();
    await fresh.post('/api/auth/login', {
      username: account().user.username,
      password: 'Passw0rd!23',
    });
    const res = await fresh.post('/api/auth/mfa/challenge', { backupCode: account().backupCodes[1] });
    assert.equal(res.status, 200);
    assert.equal(res.json.backupCodesRemaining, 6);
  });
});

describe('disabling', () => {
  const account = () => disableAccount;

  test('a session alone cannot remove the second factor', async () => {
    const res = await account().user.session.post('/api/auth/mfa/disable', {});
    assert.equal(res.status, 400);

    const status = await account().user.session.get('/api/auth/mfa/status');
    assert.equal(status.json.enabled, true, 'still enabled');
  });

  test('a current code removes it, and clears the stored material', async () => {
    const res = await account().user.session.post('/api/auth/mfa/disable', {
      token: currentToken(account().secret),
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.enabled, false);

    const status = await account().user.session.get('/api/auth/mfa/status');
    assert.equal(status.json.enabled, false);
    assert.equal(status.json.backupCodesRemaining, 0, 'recovery codes cleared');

    // Login is single-factor again.
    const fresh = new Session();
    const login = await fresh.post('/api/auth/login', {
      username: account().user.username,
      password: 'Passw0rd!23',
    });
    assert.equal(login.status, 200);
    assert.equal(login.json.mfaRequired, undefined);
    assert.equal(login.json.username, account().user.username);
  });
});
