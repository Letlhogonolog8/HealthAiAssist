import { Pool } from 'pg';
import bcrypt from 'bcrypt';

async function resetPasswords() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL environment variable is required');
  }

  // New passwords must be supplied via environment, never hardcoded.
  // Usage: RESET_USERNAME=admin RESET_PASSWORD='...' tsx scripts/reset_passwords.ts
  const username = process.env.RESET_USERNAME;
  const newPassword = process.env.RESET_PASSWORD;
  if (!username || !newPassword) {
    throw new Error('RESET_USERNAME and RESET_PASSWORD environment variables are required');
  }

  const pool = new Pool({ connectionString });

  try {
    const passwordHash = await bcrypt.hash(newPassword, 12);

    const result = await pool.query(
      'UPDATE users SET password = $1 WHERE username = $2',
      [passwordHash, username]
    );

    console.log(`Password reset for '${username}' (${result.rowCount} row(s) updated).`);
  } catch (error) {
    console.error('Error resetting passwords:', error);
  } finally {
    await pool.end();
  }
}

resetPasswords();
