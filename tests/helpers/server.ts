/**
 * Test harness: boots the real server as a child process and talks to it over
 * HTTP.
 *
 * Deliberately not an in-process import of the Express app. Every defect these
 * tests cover was a middleware-ordering or middleware-absence bug — a missing
 * `requireAuth`, a guard placed after the handler, a role read from the request
 * body — and none of those are observable if you call the handler directly.
 * They only appear when a request travels the whole stack, so the tests send
 * real requests to a real listener.
 */
// Same env precedence as the server, and for the same reason. The suite spawns
// server/index.ts, which loads .env, while this process was reading whatever
// DATABASE_URL the shell carried. Once .env pointed at a different database
// from the shell variable, the server wrote its users to one database and these
// assertions queried another — every suite failed on a foreign key violation
// against ids that existed, just not where the test was looking.
import '../../server/load-env.ts';

import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { Pool } from 'pg';

export const PORT = Number(process.env.TEST_PORT ?? 5099);
export const BASE = `http://127.0.0.1:${PORT}`;

/**
 * Prefix reserved for accounts these tests create.
 *
 * Deliberately distinctive, and deliberately matched with `left(username, 7)`
 * rather than `LIKE`. An earlier version swept up accounts with
 * `LIKE 't\_%'`, intending "starts with t-underscore". The backslash did not
 * survive the trip to the server, so Postgres received `t_%` — where `_` is a
 * single-character wildcard — and the pattern matched every username starting
 * with "t" plus any character. It deleted ten unrelated accounts. A prefix
 * comparison has no metacharacters and cannot do that.
 */
export const TEST_USER_PREFIX = 'zztest_';

/** Cap on any single request the suite makes. */
export const REQUEST_TIMEOUT_MS = Number(process.env.TEST_REQUEST_TIMEOUT_MS ?? 20_000);

let child: ChildProcess | null = null;

export function db(): Pool {
  const cs = process.env.DATABASE_URL;
  if (!cs) throw new Error('DATABASE_URL is required to run these tests');
  return new Pool({
    connectionString: cs,
    ssl: cs.includes('localhost') ? false : { rejectUnauthorized: false },
    /**
     * Two, because this pool shares a budget with the server under test.
     *
     * pg defaults `max` to 10. The spawned server holds its own pool as well, so
     * the suite was asking for up to twenty clients against a Supabase pooler
     * that allows fifteen — and the runs that lost the race failed with
     * `(EMAXCONNSESSION) max clients reached in session mode`, in whichever test
     * happened to be querying at the time. It read as a flaky assertion about
     * report persistence or scan ownership; it was the connection budget.
     *
     * Four here plus the five the spawned server is given below leaves ample
     * room under the fifteen the pooler allows.
     */
    max: 4,
  });
}

/**
 * Refuse to run if something is already listening on the test port.
 *
 * Without this the harness silently attached to a leftover server from an
 * earlier run and tested *that* binary instead of the working tree — the whole
 * suite passed against code that no longer existed. A stale listener has to be
 * a hard failure, because the failure mode it produces is a green suite.
 */
async function assertPortFree(): Promise<void> {
  try {
    const res = await fetch(`${BASE}/api/health`, {
      signal: AbortSignal.timeout(2000),
    });
    if (res.ok) {
      throw new Error(
        `something is already listening on ${BASE}. These tests must start ` +
          `their own server or they may silently test a stale build. Stop it, ` +
          `or set TEST_PORT to a free port.`
      );
    }
  } catch (err: any) {
    // A connection error is the expected, healthy case: nothing is there.
    if (err?.message?.includes('already listening')) throw err;
  }
}

export async function startServer(timeoutMs = 90_000): Promise<void> {
  await assertPortFree();

  // `node --import tsx` rather than `npx tsx`: npx interposes a shell and a
  // launcher process, so child.pid was the shell's and killing it orphaned the
  // real server. This is a single process that can be killed directly.
  // A key is always available, so the whole suite runs against the encrypted
  // path rather than the no-op one. Encryption is transparent by design, which
  // is exactly why it needs to be on during the tests: a mistake in the storage
  // hooks — a write that seals and a read that forgets to open — shows up as a
  // clinician seeing base64 where a note should be, and only an end-to-end run
  // catches it.
  //
  // Defer to .env when it carries one, rather than imposing an ephemeral key.
  //
  // The imposed key did not survive. This process and the server both run
  // load-env, which in development lets .env win over the environment — that is
  // its whole purpose. So on a machine whose .env has ENCRYPTION_KEYS, the child
  // silently used that key while this process used the generated one, and a test
  // reading a column with raw SQL failed with "ciphertext was written under key
  // k1, which is not in the keyring". The suite passed on a machine with no key
  // configured and failed on a developer's, which is the worst way to find out.
  //
  // Both processes read the same source now, so they agree either way.
  if (!process.env.ENCRYPTION_KEYS && !process.env.ENCRYPTION_KEY) {
    process.env.ENCRYPTION_KEYS = `test1:${randomBytes(32).toString('hex')}`;
    process.env.ENCRYPTION_ACTIVE_KEY_ID = 'test1';
  }

  child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
    env: {
      ...process.env,
      NODE_ENV: 'development',
      PORT: String(PORT),
      /**
       * The server under test shares the database's connection budget with this
       * process's own pool. Supabase's pooler allows fifteen clients; the
       * server's default of ten plus pg's default of ten here asks for twenty,
       * and the runs that lost the race failed with
       * `(EMAXCONNSESSION) max clients reached in session mode` — surfacing as a
       * flaky assertion in whichever test happened to be querying.
       */
      DATABASE_POOL_MAX: '5',
    },
    stdio: 'ignore',
  });

  const exited = new Promise<never>((_, reject) => {
    child!.once('exit', (code) =>
      reject(new Error(`server exited during startup with code ${code}`))
    );
  });

  const healthy = (async () => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const res = await fetch(`${BASE}/api/health`);
        if (res.ok) return;
      } catch {
        /* not listening yet */
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error(`server did not become healthy on ${BASE} within ${timeoutMs}ms`);
  })();

  await Promise.race([healthy, exited]);
}

export async function stopServer(): Promise<void> {
  if (!child) return;
  const pid = child.pid;
  const ended = new Promise<void>((resolve) => child!.once('exit', () => resolve()));

  child.kill('SIGKILL');
  if (process.platform === 'win32' && pid) {
    const { spawnSync } = await import('node:child_process');
    spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' });
  }

  await Promise.race([ended, new Promise((r) => setTimeout(r, 5000))]);
  child = null;

  // Confirm the port actually came back, so a failure to tear down surfaces
  // here rather than as a mysteriously passing suite next time.
  for (let i = 0; i < 10; i++) {
    try {
      await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(500) });
      await new Promise((r) => setTimeout(r, 500));
    } catch {
      return; // nothing listening any more
    }
  }
  throw new Error(`test server on ${BASE} did not shut down; kill it before re-running`);
}

/** A browser-ish session: keeps whatever cookie the server last set. */
export class Session {
  private cookie = '';

  /**
   * The Cookie header this session would send.
   *
   * Exposed so a test can hand the same session to a WebSocket upgrade, which
   * is the only way to exercise socket authentication against a real login.
   */
  get cookieHeader(): string {
    return this.cookie;
  }

  async request(
    method: string,
    path: string,
    body?: unknown
  ): Promise<{ status: number; json: any; text: string }> {
    const headers: Record<string, string> = {};
    if (this.cookie) headers.Cookie = this.cookie;
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    // Every request is bounded. Without this a request that never gets a
    // response hangs until the enclosing suite's timeout, so a run reports
    // "suite timed out" minutes later with no indication of which call stalled.
    let res: Response;
    try {
      res = await fetch(`${BASE}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: 'manual',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err: any) {
      if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
        throw new Error(
          `${method} ${path} did not respond within ${REQUEST_TIMEOUT_MS}ms`
        );
      }
      throw new Error(`${method} ${path} failed: ${err?.message ?? err}`);
    }

    const setCookie = res.headers.getSetCookie?.() ?? [];
    for (const c of setCookie) {
      const pair = c.split(';')[0];
      if (pair.startsWith('healthai.sid=')) this.cookie = pair;
    }

    const text = await res.text();
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* HTML fallback or empty body */
    }
    return { status: res.status, json, text };
  }

  get = (p: string) => this.request('GET', p);
  post = (p: string, b?: unknown) => this.request('POST', p, b);
  patch = (p: string, b?: unknown) => this.request('PATCH', p, b);
  del = (p: string) => this.request('DELETE', p);

  /**
   * A multipart upload, through the same cookie jar as everything else.
   *
   * Worth having rather than reaching for bare fetch(): the server rotates a
   * session periodically and answers with a new sid, so a request that sends the
   * cookie but ignores Set-Cookie works once and then fails, which is a
   * confusing way to discover you have been logged out. The jar follows the
   * rotation the way a browser does.
   *
   * The timeout is separate because model inference is slow and legitimately so.
   */
  async postForm(
    path: string,
    form: FormData,
    timeoutMs = 120_000
  ): Promise<{ status: number; json: any; text: string }> {
    const headers: Record<string, string> = {};
    if (this.cookie) headers.Cookie = this.cookie;

    let res: Response;
    try {
      res = await fetch(`${BASE}${path}`, {
        method: 'POST',
        headers,
        body: form,
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err: any) {
      throw new Error(`POST ${path} (multipart) failed: ${err?.message ?? err}`);
    }

    for (const c of res.headers.getSetCookie?.() ?? []) {
      const pair = c.split(';')[0];
      if (pair.startsWith('healthai.sid=')) this.cookie = pair;
    }

    const text = await res.text();
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* not JSON */
    }
    return { status: res.status, json, text };
  }
}

/** Registers a fresh account and returns its session plus the created id. */
export async function registerPatient(
  label: string
): Promise<{ session: Session; id: number; username: string }> {
  // insertUserSchema enforces /^[a-zA-Z0-9_]{3,20}$/, so the name has to stay
  // short: 7 + 10 = 17 characters.
  const suffix = Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
  const username = `${TEST_USER_PREFIX}${suffix}`;
  const session = new Session();
  const res = await session.post('/api/auth/register', {
    username,
    password: 'Passw0rd!23',
    email: `${username}@example.test`,
    fullName: `Test ${label}`,
    role: 'patient',
  });
  if (res.status !== 200) {
    throw new Error(`register failed (${res.status}): ${res.text.slice(0, 200)}`);
  }
  return { session, id: res.json.id, username };
}
