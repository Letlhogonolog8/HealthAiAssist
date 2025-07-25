import pkg from 'pg';
const { Pool } = pkg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function checkStaff() {
  try {
    const result = await pool.query(
      "SELECT id, full_name, role FROM users WHERE role IN ('doctor', 'radiologist')"
    );
    console.log("Doctors and Radiologists in DB:", result.rows);
  } catch (error) {
    console.error("Error querying staff from DB:", error);
  } finally {
    await pool.end();
  }
}

checkStaff();
