import { getDb, pool } from "../server/db";

const db = getDb();
import { hashPassword } from "../server/auth-middleware";

async function addCustomUsers() {
  try {
    console.log("Adding custom users...");

    // Add user 'sam' with password 'inw73KYI!!'
    const samPassword = await hashPassword("inw73KYI!!");
    await db.execute(`
      INSERT INTO users (username, password, role, full_name, email)
      VALUES ('sam', '${samPassword}', 'patient', 'Sam Patient', 'sam@healthai.com')
      ON CONFLICT (username) DO UPDATE SET password = '${samPassword}';
    `);

    // Add user 'doctor_kenosi' with password 'kenosi123!'
    const kenosiPassword = await hashPassword("kenosi123!");
    await db.execute(`
      INSERT INTO users (username, password, role, full_name, email, specialization, license_number)
      VALUES ('doctor_kenosi', '${kenosiPassword}', 'doctor', 'Dr. Kenosi', 'kenosi@healthai.com', 'General Practice', 'MD67890')
      ON CONFLICT (username) DO UPDATE SET password = '${kenosiPassword}';
    `);

    // Update admin password to 'admin001!'
    const adminPassword = await hashPassword("admin001!");
    await db.execute(`
      INSERT INTO users (username, password, role, full_name, email)
      VALUES ('admin', '${adminPassword}', 'admin', 'System Administrator', 'admin@healthai.com')
      ON CONFLICT (username) DO UPDATE SET password = '${adminPassword}';
    `);

    console.log("Custom users added successfully!");
    console.log("Credentials:");
    console.log("sam / inw73KYI!!");
    console.log("doctor_kenosi / kenosi123!");
    console.log("admin / admin001!");

  } catch (error) {
    console.error("Error adding custom users:", error);
    throw error;
  } finally {
    await pool.end();
  }
}

addCustomUsers().catch(console.error);