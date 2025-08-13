-- HealthAI Assistant - Supabase Database Setup

-- Enable Row Level Security
ALTER DATABASE postgres SET "app.jwt_secret" TO 'your-jwt-secret';

-- Users table
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(255) UNIQUE NOT NULL,
  password VARCHAR(255) NOT NULL,
  full_name VARCHAR(255),
  email VARCHAR(255) UNIQUE,
  role VARCHAR(50) DEFAULT 'patient',
  phone VARCHAR(20),
  age INTEGER,
  gender VARCHAR(20),
  blood_type VARCHAR(10),
  address TEXT,
  emergency_contact VARCHAR(255),
  height VARCHAR(20),
  weight VARCHAR(20),
  specialization VARCHAR(255),
  license_number VARCHAR(255),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Scans table
CREATE TABLE IF NOT EXISTS scans (
  id SERIAL PRIMARY KEY,
  patient_id INTEGER REFERENCES users(id),
  scan_type VARCHAR(100),
  image_path TEXT,
  result TEXT,
  ai_confidence VARCHAR(20),
  status VARCHAR(50) DEFAULT 'pending',
  notes TEXT,
  doctor_id INTEGER REFERENCES users(id),
  radiologist_id INTEGER REFERENCES users(id),
  reviewed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Appointments table
CREATE TABLE IF NOT EXISTS appointments (
  id SERIAL PRIMARY KEY,
  patient_id INTEGER REFERENCES users(id),
  doctor_id INTEGER REFERENCES users(id),
  appointment_date DATE,
  appointment_time VARCHAR(20),
  type VARCHAR(100),
  status VARCHAR(50) DEFAULT 'scheduled',
  reason TEXT,
  notes TEXT,
  priority VARCHAR(20) DEFAULT 'medium',
  created_at TIMESTAMP DEFAULT NOW()
);

-- Chat messages table
CREATE TABLE IF NOT EXISTS chat_messages (
  id SERIAL PRIMARY KEY,
  sender_id INTEGER REFERENCES users(id),
  receiver_id INTEGER REFERENCES users(id),
  message TEXT NOT NULL,
  message_type VARCHAR(20) DEFAULT 'text',
  status VARCHAR(20) DEFAULT 'sent',
  created_at TIMESTAMP DEFAULT NOW()
);

-- Medical terms table
CREATE TABLE IF NOT EXISTS medical_terms (
  id SERIAL PRIMARY KEY,
  term VARCHAR(255) NOT NULL,
  definition TEXT NOT NULL,
  category VARCHAR(100),
  created_at TIMESTAMP DEFAULT NOW()
);

-- Sessions table for express-session
CREATE TABLE IF NOT EXISTS session (
  sid VARCHAR NOT NULL COLLATE "default",
  sess JSON NOT NULL,
  expire TIMESTAMP(6) NOT NULL
) WITH (OIDS=FALSE);

ALTER TABLE session ADD CONSTRAINT session_pkey PRIMARY KEY (sid) NOT DEFERRABLE INITIALLY IMMEDIATE;
CREATE INDEX IDX_session_expire ON session (expire);

-- Insert default users
INSERT INTO users (username, password, full_name, email, role) VALUES
('admin', '$2b$10$example', 'System Admin', 'admin@healthai.com', 'admin'),
('doctor', '$2b$10$example', 'Dr. Sarah Johnson', 'doctor@healthai.com', 'doctor'),
('radiologist', '$2b$10$example', 'Dr. Michael Chen', 'radiologist@healthai.com', 'radiologist'),
('patient', '$2b$10$example', 'John Patient', 'patient@healthai.com', 'patient')
ON CONFLICT (username) DO NOTHING;