/**
 * `../server/load-env` rather than `dotenv/config`.
 *
 * dotenv's default is that an already-set variable wins, so on a machine
 * carrying a Machine- or User-scope DATABASE_URL from another project this
 * script silently talked to that database instead of the one in .env — or, when
 * the credentials did not match, failed with "received invalid response: 4a"
 * from the SCRAM handshake. load-env overrides from the file in development,
 * which is what every other entry point in this project uses.
 */
import '../server/load-env';

import { initializeStorage, storage as storageInstance } from '../server/storage';
import { hashPassword } from '../server/auth-middleware';

type SeedResult = {
  createdUsers: number;
  createdScans: number;
  createdAppointments: number;
};

async function ensureUser(username: string, user: any) {
  const storage = storageInstance;
  const existing = await storage.getUserByUsername(username);
  if (existing) return existing;
  const password = await hashPassword(user.password || 'Password123!');
  const created = await storage.createUser({
    username,
    password,
    fullName: user.fullName,
    email: user.email,
    role: user.role,
    specialization: user.specialization,
  } as any);
  return created;
}

async function ensureScan(patientId: number, scan: any) {
  const storage = storageInstance;
  const scans = await storage.getScans(patientId);
  const duplicate = scans.find(
    s => s.scanType === scan.scanType && String(s.createdAt || '').slice(0, 10) === String(scan.createdAt || '').slice(0, 10)
  );
  if (duplicate) return duplicate;
  return storage.createScan({
    patientId,
    scanType: scan.scanType,
    result: scan.result,
    aiConfidence: scan.aiConfidence || '90%',
    notes: scan.notes || '',
    doctorId: scan.doctorId,
  } as any);
}

async function ensureAppointment(appointment: any) {
  const storage = storageInstance;
  const all = await storage.getAppointments(appointment.patientId);
  const dup = all.find(
    a => String(a.appointmentDate).slice(0, 10) === String(appointment.appointmentDate).slice(0, 10) && a.appointmentTime === appointment.appointmentTime
  );
  if (dup) return dup;
  return storage.createAppointment({
    patientId: appointment.patientId,
    doctorId: appointment.doctorId,
    appointmentDate: appointment.appointmentDate,
    appointmentTime: appointment.appointmentTime,
    type: appointment.type || 'General Consultation',
    reason: appointment.reason || 'Routine checkup',
  } as any);
}

export async function seedDev(): Promise<SeedResult> {
  await initializeStorage();

  let createdUsers = 0;
  let createdScans = 0;
  let createdAppointments = 0;

  const admin = await ensureUser('admin', {
    password: 'Admin123!',
    fullName: 'System Administrator',
    email: 'admin@example.com',
    role: 'admin',
  });
  if (admin) createdUsers++;

  const doctor = await ensureUser('doctor', {
    password: 'Doctor123!',
    fullName: 'Dr. Alice Smith',
    email: 'doctor@example.com',
    role: 'doctor',
    specialization: 'General Practice',
  });
  if (doctor) createdUsers++;

  const radiologist = await ensureUser('radiologist', {
    password: 'Radiologist123!',
    fullName: 'Dr. Bob Chen',
    email: 'radiologist@example.com',
    role: 'radiologist',
    specialization: 'Medical Imaging',
  });
  if (radiologist) createdUsers++;

  const patient = await ensureUser('patient', {
    password: 'Patient123!',
    fullName: 'Jane Patient',
    email: 'patient@example.com',
    role: 'patient',
  });
  if (patient) createdUsers++;

  if (patient && doctor) {
    const today = new Date();
    const scan1 = await ensureScan(patient.id, {
      scanType: 'Skin Dermatoscopy',
      result: 'Normal skin lesion appearance',
      aiConfidence: '92%',
      doctorId: doctor.id,
      createdAt: today,
    });
    if (scan1) createdScans++;

    const scan2 = await ensureScan(patient.id, {
      scanType: 'Pulmonary MRI',
      result: 'No pulmonary nodules detected',
      aiConfidence: '90%',
      doctorId: doctor.id,
      createdAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
    });
    if (scan2) createdScans++;

    const appt = await ensureAppointment({
      patientId: patient.id,
      doctorId: doctor.id,
      appointmentDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
      appointmentTime: '10:00 AM',
      type: 'Follow-up Appointment',
      reason: 'Review recent scan results',
    });
    if (appt) createdAppointments++;
  }

  return { createdUsers, createdScans, createdAppointments };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  seedDev()
    .then(r => {
      console.log(`Seed complete: users=${r.createdUsers}, scans=${r.createdScans}, appointments=${r.createdAppointments}`);
      process.exit(0);
    })
    .catch(err => {
      console.error('Seed failed', err);
      process.exit(1);
    });
}



