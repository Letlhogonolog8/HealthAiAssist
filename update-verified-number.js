import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

async function updateVerifiedNumber() {
  try {
    // Update Sam (Radiologist) with verified Twilio number
    await pool.query(
      "UPDATE users SET phone = $1 WHERE username = $2",
      ['+27734801665', 'sam']
    );
    console.log('✅ Updated Sam (Radiologist) with verified number: +27734801665');

    // Verify the update
    const result = await pool.query(
      "SELECT username, full_name, role, phone FROM users WHERE username = 'sam'"
    );
    
    if (result.rows.length > 0) {
      const user = result.rows[0];
      console.log(`📞 ${user.full_name || user.username} (${user.role}): ${user.phone}`);
      console.log('✅ Voice calling should now work!');
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await pool.end();
  }
}

updateVerifiedNumber();