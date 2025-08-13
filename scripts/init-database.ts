import { db, pool } from "../server/db";
import { users, medicalScans, medicalTerms, appointments } from "@shared/schema";
import { hashPassword } from "../server/auth-middleware";

async function initializeDatabase() {
  try {
    console.log("Initializing database...");

    // Create tables if they don't exist
    await db.execute(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'patient',
        full_name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        age INTEGER,
        gender TEXT,
        phone TEXT,
        address TEXT,
        blood_type TEXT,
        height TEXT,
        weight TEXT,
        emergency_contact TEXT,
        specialization TEXT,
        license_number TEXT,
        is_active BOOLEAN DEFAULT true,
        reset_token TEXT,
        reset_token_expiry TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await db.execute(`
      CREATE TABLE IF NOT EXISTS medical_scans (
        id SERIAL PRIMARY KEY,
        patient_id INTEGER REFERENCES users(id) NOT NULL,
        scan_type TEXT NOT NULL,
        image_path TEXT,
        ai_confidence TEXT DEFAULT '0%',
        result TEXT DEFAULT 'Processing',
        radiologist_id INTEGER REFERENCES users(id),
        doctor_id INTEGER REFERENCES users(id),
        notes TEXT DEFAULT '',
        status TEXT DEFAULT 'pending',
        priority TEXT DEFAULT 'medium',
        findings TEXT DEFAULT '',
        recommendations TEXT DEFAULT '',
        risk_level TEXT DEFAULT 'low',
        processing_time_ms INTEGER,
        image_size_bytes INTEGER,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await db.execute(`
      CREATE TABLE IF NOT EXISTS medical_terms (
        id SERIAL PRIMARY KEY,
        term TEXT NOT NULL,
        definition TEXT NOT NULL,
        pronunciation TEXT,
        category TEXT NOT NULL
      );
    `);

    await db.execute(`
      CREATE TABLE IF NOT EXISTS appointments (
        id SERIAL PRIMARY KEY,
        patient_id INTEGER REFERENCES users(id) NOT NULL,
        doctor_id INTEGER REFERENCES users(id) NOT NULL,
        appointment_date TIMESTAMP NOT NULL,
        appointment_time TEXT NOT NULL,
        type TEXT NOT NULL,
        status TEXT DEFAULT 'scheduled',
        notes TEXT DEFAULT '',
        priority TEXT DEFAULT 'medium',
        urgency_score INTEGER DEFAULT 5,
        duration_minutes INTEGER DEFAULT 30,
        reason TEXT DEFAULT '',
        follow_up_required BOOLEAN DEFAULT false,
        reminder_sent BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // Create default admin user
    const adminPassword = await hashPassword("admin123");
    await db.execute(`
      INSERT INTO users (username, password, role, full_name, email)
      VALUES ('admin', '${adminPassword}', 'admin', 'System Administrator', 'admin@healthai.com')
      ON CONFLICT (username) DO NOTHING;
    `);

    // Create sample doctor
    const doctorPassword = await hashPassword("doctor123");
    await db.execute(`
      INSERT INTO users (username, password, role, full_name, email, specialization, license_number)
      VALUES ('doctor', '${doctorPassword}', 'doctor', 'Dr. John Smith', 'doctor@healthai.com', 'General Practice', 'MD12345')
      ON CONFLICT (username) DO NOTHING;
    `);

    // Create sample radiologist
    const radiologistPassword = await hashPassword("radiologist123");
    await db.execute(`
      INSERT INTO users (username, password, role, full_name, email, specialization, license_number)
      VALUES ('radiologist', '${radiologistPassword}', 'radiologist', 'Dr. Sarah Johnson', 'radiologist@healthai.com', 'Radiology', 'RD12345')
      ON CONFLICT (username) DO NOTHING;
    `);

    // Create default patient account
    const patientPassword = await hashPassword("patient123");
    await db.execute(`
      INSERT INTO users (username, password, role, full_name, email)
      VALUES ('patient', '${patientPassword}', 'patient', 'Patient User', 'patient@healthai.com')
      ON CONFLICT (username) DO NOTHING;
    `);



    console.log("Database initialized successfully!");
    console.log("Default credentials:");
    console.log("Admin: admin / admin123");
    console.log("Doctor: doctor / doctor123");
    console.log("Radiologist: radiologist / radiologist123");
    console.log("Patient: patient / patient123");

  } catch (error) {
    console.error("Error initializing database:", error);
    throw error;
  } finally {
    await pool.end();
  }
}

// Run initialization when script is executed directly
initializeDatabase().catch(console.error);

export { initializeDatabase };