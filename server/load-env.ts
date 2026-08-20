/**
 * Loads .env, and must be the first import in any entry point.
 *
 * This lives in its own module because of ES module evaluation order. Every
 * `import` in a file is hoisted and evaluated before any of that file's own
 * top-level statements, so environment loading written inline at the top of
 * server/index.ts still ran *after* `./routes` — and therefore after
 * `./db`, which reads DATABASE_URL at module scope to build its pool. The
 * loading code looked like the first thing in the file and was not.
 *
 * The symptom: .env pointed at a freshly provisioned Supabase database, the
 * override below reported success, and every write still went to the local
 * Postgres the shell's DATABASE_URL named. A registration returned id 133 while
 * the target database held no users at all.
 *
 * Importing this module first makes the load a side effect of the first
 * evaluated import, which is the only position that beats `./db`.
 */
import dotenv from 'dotenv';

// Production never reads .env: Railway and Render inject the real values, and
// those must not be second-guessed by a file that happens to be on disk.
if (process.env.NODE_ENV !== 'production') {
  // dotenv's default is that an already-set variable wins. On Windows a User-
  // or Machine-level DATABASE_URL therefore silently beats .env, so editing the
  // file appears to work and changes nothing. Warning about it was not enough:
  // this machine carried a Machine-scope DATABASE_URL belonging to an unrelated
  // project, which meant pointing .env at a new database left the app talking to
  // the old one.
  //
  // In development the file the developer just edited is the source of truth.
  //
  // PORT and NODE_ENV are exempt. They are per-invocation runtime knobs rather
  // than configuration — `PORT=5099 tsx server/index.ts` is how the test harness
  // starts a server beside a running dev one — and overriding them from .env
  // made that silently start on .env's port, where nothing was listening.
  const RUNTIME_KEYS = new Set(['PORT', 'NODE_ENV']);

  const parsed = dotenv.config().parsed ?? {};
  const shadowed = Object.keys(parsed).filter(
    (key) => !RUNTIME_KEYS.has(key) && process.env[key] !== parsed[key]
  );

  for (const key of shadowed) process.env[key] = parsed[key];

  // Values are never printed — only the key names, and only when they diverged.
  if (shadowed.length) {
    console.warn(
      `⚠️  ${shadowed.length} variable(s) in .env were shadowed by the environment ` +
        `and have been overridden from the file:\n     ${shadowed.join(', ')}\n` +
        '     .env wins in development. If you meant the environment value to win, ' +
        'remove it from .env or run with NODE_ENV=production.\n' +
        "     Inspect with: [Environment]::GetEnvironmentVariable('NAME','User'|'Machine')"
    );
  }
}
