import { Pool } from 'pg';
import bcrypt from 'bcrypt';

async function resetPasswords() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://postgres:inw73KYI!@localhost:5432/HealthAIAssistant',
  });

  try {
    // Hash new passwords
    const adminPasswordHash = await bcrypt.hash('admin001!', 12);
    const tlhoxPasswordHash = await bcrypt.hash('inw73KYI', 12);

    // Update admin password
    await pool.query(
      'UPDATE users SET password = $1 WHERE username = $2',
      [adminPasswordHash, 'admin']
    );

    // Update Tlhox password
    await pool.query(
      'UPDATE users SET password = $1 WHERE username = $2',
      [tlhoxPasswordHash, 'Tlhox']
    );

    console.log('Passwords reset successfully.');
  } catch (error) {
    console.error('Error resetting passwords:', error);
  } finally {
    await pool.end();
  }
}

resetPasswords();
