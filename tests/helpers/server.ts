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
  child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
    env: { ...process.env, NODE_ENV: 'development', PORT: String(PORT) },
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
