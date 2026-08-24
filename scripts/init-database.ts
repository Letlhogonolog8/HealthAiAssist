/**
 * Must be first. `../server/db` builds its pool from process.env.DATABASE_URL at
 * module scope, and every import in a file is evaluated before the file's own
 * statements — so anything that loads .env later has already lost.
 *
 * Without it this script read whatever DATABASE_URL the shell carried. On a
 * machine with a Machine-scope DATABASE_URL left over from another project
 * (which is the case here), `npm run db:init` failed with
 * "received invalid response: 4a" — a SCRAM handshake against the wrong server —
 * and there was no way to create the first admin account.
 */
import "../server/load-env";

import { randomBytes } from "crypto";
import { db, pool } from "../server/db";
import { users, medicalScans, medicalTerms, appointments } from "@shared/schema";
import { hashPassword } from "../server/auth-middleware";

/**
 * Generates a strong password for a seeded account.
 *
 * Seed accounts previously shipped with admin/admin123, doctor/doctor123 and so
 * on, documented in the README. Those are the first credentials anyone tries,
 * and on any reachable deployment they are an open administrative login.
 *
 * Each run now mints a random password, printed once. Set SEED_<ROLE>_PASSWORD
 * to pin one for repeatable local work.
 */
function generatePassword(role: string): string {
  const override = process.env[`SEED_${role.toUpperCase()}_PASSWORD`];
  if (override) return override;
  // base64url of 18 bytes: 24 chars, satisfies the upper/lower/digit rule below.
  return `${randomBytes(18).toString("base64url")}A1`;
}

async function initializeDatabase() {
  try {
    // Seeding creates known accounts. That is fine locally and dangerous in
    // production, so it is refused there unless explicitly forced.
    if (process.env.NODE_ENV === "production" && process.env.ALLOW_PROD_SEED !== "true") {
      console.error(
        "Refusing to seed in production. Set ALLOW_PROD_SEED=true only if you " +
        "genuinely intend to create these accounts on a live system."
      );
      process.exit(1);
    }

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
    const adminPlain = generatePassword("admin");
    const adminPassword = await hashPassword(adminPlain);
    await db.execute(`
      INSERT INTO users (username, password, role, full_name, email)
      VALUES ('admin', '${adminPassword}', 'admin', 'System Administrator', 'admin@healthai.com')
      ON CONFLICT (username) DO NOTHING;
    `);

    // Create sample doctor
    const doctorPlain = generatePassword("doctor");
    const doctorPassword = await hashPassword(doctorPlain);
    await db.execute(`
      INSERT INTO users (username, password, role, full_name, email, specialization, license_number)
      VALUES ('doctor', '${doctorPassword}', 'doctor', 'Dr. John Smith', 'doctor@healthai.com', 'General Practice', 'MD12345')
      ON CONFLICT (username) DO NOTHING;
    `);

    // Create sample radiologist
    const radiologistPlain = generatePassword("radiologist");
    const radiologistPassword = await hashPassword(radiologistPlain);
    await db.execute(`
      INSERT INTO users (username, password, role, full_name, email, specialization, license_number)
      VALUES ('radiologist', '${radiologistPassword}', 'radiologist', 'Dr. Sarah Johnson', 'radiologist@healthai.com', 'Radiology', 'RD12345')
      ON CONFLICT (username) DO NOTHING;
    `);

    // Create default patient account
    const patientPlain = generatePassword("patient");
    const patientPassword = await hashPassword(patientPlain);
    await db.execute(`
      INSERT INTO users (username, password, role, full_name, email)
      VALUES ('patient', '${patientPassword}', 'patient', 'Patient User', 'patient@healthai.com')
      ON CONFLICT (username) DO NOTHING;
    `);



    console.log("");
    console.log("Database initialized successfully.");
    console.log("");
    console.log("=== Seeded account passwords - shown once, not stored ===");
    console.log(`  admin        ${adminPlain}`);
    console.log(`  doctor       ${doctorPlain}`);
    console.log(`  radiologist  ${radiologistPlain}`);
    console.log(`  patient      ${patientPlain}`);
    console.log("");
    console.log("Save these now. Accounts already present were left unchanged");
    console.log("(ON CONFLICT DO NOTHING), so their existing passwords still apply.");
    console.log("");

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