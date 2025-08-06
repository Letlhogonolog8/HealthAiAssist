import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

async function updateTestNumbers() {
  try {
    // Update with Twilio test numbers that work with trial accounts
    await pool.query(
      "UPDATE users SET phone = $1 WHERE username = $2",
      ['+15005550006', 'sam'] // Twilio test number - valid
    );
    console.log('✅ Updated Sam (Radiologist) with test number: +15005550006');

    await pool.query(
      "UPDATE users SET phone = $1 WHERE username = $2", 
      ['+15005550006', 'Tlhox'] // Same test number for testing
    );
    console.log('✅ Updated Tlhox (Patient) with test number: +15005550006');

    console.log('\n📞 Voice calling should now work with test numbers!');
    console.log('Note: These are Twilio test numbers that work with trial accounts.');

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await pool.end();
  }
}

updateTestNumbers();