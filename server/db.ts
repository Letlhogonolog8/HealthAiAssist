import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from "@shared/schema";

// PostgreSQL only configuration
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is required (set as a System environment variable in production)');
}

/**
 * How many connections this process may hold open.
 *
 * Was 20. DATABASE_URL points at a Supabase pooler running in session mode,
 * which caps the whole project at 15 clients — so the pool was configured to
 * open a third more connections than the server would accept. Past the limit
 * Postgres answers `(EMAXCONNSESSION) max clients reached in session mode` and
 * the request simply fails, which showed up as pages half-loading and the admin
 * dashboard tripping its error boundary partway through its imports.
 *
 * A pool bigger than the server's limit is not extra capacity. pg hands out
 * connections up to `max` and only queues beyond that, so raising `max` past
 * what the database permits converts backpressure into errors.
 *
 * The default leaves headroom under 15 for the other things that connect —
 * `db:push`, the migration and maintenance scripts, a psql session. Raise it
 * with DATABASE_POOL_MAX only after checking what the database actually allows;
 * on Supabase that is the pooler's `pool_size`, not the instance's max
 * connections.
 */
const POOL_MAX = Math.max(1, Number.parseInt(process.env.DATABASE_POOL_MAX ?? '', 10) || 10);

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false },
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 30000,
  max: POOL_MAX,
  statement_timeout: 30000,
  query_timeout: 30000
});

export const db = drizzle(pool, { schema });

export function getDb() {
  return db;
}

export { pool }; // Export pool for session store when using PostgreSQL

// Test PostgreSQL connection
export async function testDbConnection() {
  try {
    const client = await pool.connect();
    await client.query('SELECT 1');
    client.release();
    console.log('PostgreSQL connection successful');
    return true;
  } catch (error) {
    console.error('PostgreSQL connection failed:', error);
    return false;
  }
}

// Connection error handler
pool.on('error', (err) => {
  console.error('Unexpected database pool error:', err);
});

// Graceful shutdown handler
process.on('SIGTERM', async () => {
  console.log('Closing database connections...');
  await pool.end();
  process.exit(0);
});
