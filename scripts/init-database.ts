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

    // Create sample patients
    const patientPassword = await hashPassword("patient123");
    const samplePatients = [
      { username: 'patient', fullName: 'John Doe', email: 'patient@healthai.com', age: 35, gender: 'Male', phone: '012-345-6789' },
      { username: 'patient2', fullName: 'Sarah Wilson', email: 'sarah.wilson@healthai.com', age: 28, gender: 'Female', phone: '012-345-6790' },
      { username: 'patient3', fullName: 'Michael Brown', email: 'michael.brown@healthai.com', age: 42, gender: 'Male', phone: '012-345-6791' },
      { username: 'patient4', fullName: 'Emma Davis', email: 'emma.davis@healthai.com', age: 31, gender: 'Female', phone: '012-345-6792' },
      { username: 'patient5', fullName: 'Robert Taylor', email: 'robert.taylor@healthai.com', age: 55, gender: 'Male', phone: '012-345-6793' }
    ];

    for (const patient of samplePatients) {
      await db.execute(`
        INSERT INTO users (username, password, role, full_name, email, age, gender, phone)
        VALUES ('${patient.username}', '${patientPassword}', 'patient', '${patient.fullName}', '${patient.email}', ${patient.age}, '${patient.gender}', '${patient.phone}')
        ON CONFLICT (username) DO NOTHING;
      `);
    }

    // Add sample medical terms
    const medicalTermsData = [
      { term: "Malignant", definition: "Cancerous; having the properties of a malignancy that can invade and destroy nearby tissue and spread to other parts of the body", category: "Oncology" },
      { term: "Benign", definition: "Not cancerous; does not invade nearby tissue or spread to other parts of the body", category: "Oncology" },
      { term: "Biopsy", definition: "The removal of tissue or cells from the body for examination under a microscope", category: "Procedure" },
      { term: "Metastasis", definition: "The spread of cancer from one part of the body to another", category: "Oncology" },
      { term: "Chemotherapy", definition: "Treatment with drugs that kill cancer cells", category: "Treatment" }
    ];

    for (const term of medicalTermsData) {
      await db.execute(`
        INSERT INTO medical_terms (term, definition, category)
        VALUES ('${term.term}', '${term.definition}', '${term.category}')
        ON CONFLICT DO NOTHING;
      `);
    }

    console.log("Database initialized successfully!");
    console.log("Default credentials:");
    console.log("Admin: admin / admin123");
    console.log("Doctor: doctor / doctor123");
    console.log("Radiologist: radiologist / radiologist123");
    console.log("Patients: patient, patient2, patient3, patient4, patient5 / patient123");

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