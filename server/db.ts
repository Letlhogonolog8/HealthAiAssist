import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from "@shared/schema";

// PostgreSQL only configuration
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is required');
}

const pool = new Pool({ 
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false },
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 30000,
  max: 20,
  statement_timeout: 30000,
  query_timeout: 30000
});

const db = drizzle(pool, { schema });

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
