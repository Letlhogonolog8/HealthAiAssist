import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { drizzle as drizzleSqlite } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
import * as schema from "@shared/schema";

// Database configuration with fallback
const DATABASE_URL = process.env.DATABASE_URL || 'sqlite:./healthai.db';
let usePostgres = DATABASE_URL.startsWith('postgresql://');
let pool: Pool | null = null;
let sqliteDb: Database.Database | null = null;

if (usePostgres) {
  pool = new Pool({ 
    connectionString: DATABASE_URL,
    ssl: DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false },
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
    max: 20
  });
} else {
  sqliteDb = new Database('./healthai.db');
}

const pgDb = usePostgres && pool ? drizzle(pool, { schema }) : null;
const sqliteDbInstance = !usePostgres && sqliteDb ? drizzleSqlite(sqliteDb, { schema }) : null;

export function getDb() {
  if (usePostgres && pgDb) {
    return pgDb;
  }
  if (!usePostgres && sqliteDbInstance) {
    return sqliteDbInstance;
  }
  throw new Error('Database client not initialized');
}

export { pool }; // Export pool for session store when using PostgreSQL

// Test database connection with fallback to SQLite
export async function testDbConnection() {
  if (usePostgres && pool) {
    let retries = 3;
    while (retries > 0) {
      try {
        const client = await pool.connect();
        await client.query('SELECT 1');
        client.release();
        console.log('PostgreSQL connection successful');
        return true;
      } catch (error) {
        retries--;
        console.error(`PostgreSQL connection failed (${3 - retries}/3):`, error);
        if (retries === 0) {
          console.log('Falling back to SQLite database...');
          usePostgres = false;
          if (pool) await pool.end();
          pool = null;
          sqliteDb = new Database('./healthai.db');
          // Reinitialize db with SQLite
          const newDb = drizzleSqlite(sqliteDb, { schema });
          if (pgDb) {
            Object.assign(pgDb, newDb);
          }
          console.log('SQLite database initialized successfully');
          return true;
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  } else {
    console.log('Using SQLite database');
    return true;
  }
  return false;
}

// Connection error handler
if (pool) {
  pool.on('error', (err) => {
    console.error('Unexpected database pool error:', err);
  });
}

// Graceful shutdown handler
process.on('SIGTERM', async () => {
  console.log('Closing database connections...');
  if (pool) await pool.end();
  if (sqliteDb) sqliteDb.close();
  process.exit(0);
});
