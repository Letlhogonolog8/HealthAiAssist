import { storage } from './storage';

// Define types based on the actual user object structure
type User = {
  id: number;
  username: string;
  password: string;
  role: string;
  fullName: string;
  email: string;
  age: number | null;
  gender: string | null;
  phone: string | null;
  address: string | null;
  bloodType: string | null;
  emergencyContact: string | null;
  height: string | null;
  weight: string | null;
  createdAt: Date | null;
  // Optional properties that might not exist in all user objects
  medicalHistory?: any;
  vitals?: any;
  healthScore?: any;
};

type Scan = {
  id: number;
  scanType: string;
  createdAt?: Date;
  result?: string;
  aiConfidence?: string;
  status?: string;
  doctorId?: number;
};

type Appointment = any; // Define proper type if needed

/**
 * A patient's profile, containing only what the database actually holds.
 *
 * Every field here used to have a fallback, and because none of medicalHistory,
 * vitals or healthScore is a column on `users`, the fallbacks were not edge
 * cases — they fired for every patient, every time. The endpoint reported that
 * each patient was a 34-year-old female, blood type A+, allergic to penicillin
 * and shellfish, with hypertension and type 2 diabetes, taking metformin,
 * lisinopril and aspirin, with a blood pressure of 120/80 stamped
 * `lastUpdated: now` so it read as a fresh measurement. Contact details had the
 * same treatment: a missing phone number became +1 (555) 123-4567.
 *
 * Invented allergies and medications on a clinician's screen are a patient
 * safety hazard, not a cosmetic defect, so nothing is invented here. A value
 * that was never recorded is null, and the caller renders that as "not
 * recorded". The three clinical sections the schema has no room for are returned
 * as null with a note saying so, rather than being filled in.
 */
export async function getPatientProfile(patientId: number) {
  const user = await storage.getUser(patientId);
  if (!user || user.role !== 'patient') {
    throw new Error('Patient not found');
  }
  const patientScans = await storage.getScans(patientId);
  const patientAppointments: Appointment[] = await storage.getPatientAppointments(patientId);

  // Resolve clinician names once for the whole scan list rather than rendering
  // "Dr. 42" from a raw foreign key, which is what the placeholder did.
  const clinicianIds = Array.from(
    new Set(
      patientScans
        .flatMap((scan: any) => [scan.doctorId, scan.radiologistId])
        .filter((id: number | null): id is number => typeof id === 'number')
    )
  );
  const clinicians = new Map<number, string>();
  for (const id of clinicianIds) {
    const clinician = await storage.getUser(id);
    if (clinician) clinicians.set(id, clinician.fullName || clinician.username);
  }

  return {
    id: user.id,
    personalInfo: {
      name: user.fullName || user.username,
      email: user.email ?? null,
      phone: user.phone ?? null,
      address: user.address ?? null,
      emergencyContact: user.emergencyContact ?? null,
      age: user.age ?? null,
      gender: user.gender ?? null,
      bloodType: user.bloodType ?? null,
      height: user.height ?? null,
      weight: user.weight ?? null
    },
    // Null, not a fabricated history. There is no schema for these, and the
    // honest answer to "what are this patient's allergies" is that this system
    // does not know.
    medicalHistory: null,
    vitals: null,
    healthScore: null,
    unavailable: {
      medicalHistory: 'Not recorded by this platform',
      vitals: 'Not recorded by this platform',
      healthScore: 'Not computed'
    },
    recentScans: patientScans.map((scan: any) => ({
      id: scan.id,
      type: scan.scanType,
      date: scan.createdAt ? new Date(scan.createdAt).toISOString().split('T')[0] : null,
      result: scan.result || 'Processing',
      confidence: scan.aiConfidence || null,
      // The workflow status, verbatim. It used to be mapped onto 'normal' /
      // 'abnormal', which turned "this scan has been processed" into a clinical
      // finding: a completed scan showing cancer was labelled normal, and a
      // failed one abnormal.
      status: scan.status ?? 'pending',
      modelVersion: scan.modelVersion ?? null,
      reportingClinician:
        (scan.doctorId && clinicians.get(scan.doctorId)) ||
        (scan.radiologistId && clinicians.get(scan.radiologistId)) ||
        null
    })),
    appointments: patientAppointments.map((appointment: any) => ({
      ...appointment,
      doctorName: appointment.doctorName ?? null,
      status: appointment.status || 'scheduled',
      type: appointment.type ?? null
    }))
  };
}

/**
 * The clinic's working-hours grid, from shared/ so the client draws the same set
 * the server will accept. Re-exported here because the availability functions
 * below are the main consumer.
 */
export { CLINIC_TIME_SLOTS } from '@shared/clinic-hours';
import { CLINIC_TIME_SLOTS } from '@shared/clinic-hours';

/** Clinicians who can take a dermatology referral, from their recorded specialisation. */
export function isDermatology(specialization: string | null | undefined): boolean {
  const value = (specialization ?? '').toLowerCase();
  return value.includes('dermatolog') || value.includes('skin');
}

/**
 * Clinicians available for a dermatology consultation.
 *
 * This filtered on `user.role === 'dermatologist'`. No such role exists — the
 * roles are patient, doctor, radiologist and admin, and that string appears
 * nowhere else in the codebase — so the filter matched nothing and the endpoint
 * returned an empty array on every call, unconditionally. The scheduling dialog
 * that consumes it has therefore been showing "no dermatologists available"
 * since the function was written.
 *
 * Every field it then mapped compounded the problem: `experience`, `rating`,
 * `location`, `nextAvailable`, `availableSlots`, `hospitalAffiliation` and
 * `coordinates` are not columns on `users`, so each one read `undefined` and
 * fell through to its `??` default. Had the role filter ever matched, the result
 * would have been a list of real clinicians with a rating of 0 and an empty
 * address.
 *
 * Dermatology is now identified by the `specialization` column, which is a real
 * one, and the response carries only fields the database can answer.
 */
export async function getAvailableDermatologists(_urgency: string) {
  // Filtered and projected in the database, and without email or phone: this is
  // reachable by a patient choosing a clinician, and a directory listing does
  // not need staff contact details.
  const doctors = await storage.listDirectory(['doctor']);

  return doctors
    .filter((doctor) => isDermatology(doctor.specialization))
    .map((doctor) => ({
      id: doctor.id,
      name: doctor.fullName,
      specialty: doctor.specialization || 'Dermatology',
      role: doctor.role,
    }));
}

/**
 * Free slots for one clinician on one date.
 *
 * "Free" means: inside the clinic's working hours, not already booked in the
 * appointments table, not in the past, and — where Google Calendar is
 * configured — not blocked on the clinician's calendar either.
 *
 * The two endpoints this replaces did none of that. One returned a fixed list of
 * sixteen slots minus three hardcoded "example booked slots"; the other returned
 * `timeSlots.filter(() => Math.random() > 0.3)`, so a patient reloading the page
 * saw a different set of free times each render and could book one the clinician
 * was already busy for.
 */
export async function getClinicianSlotsForDate(
  doctorId: number,
  dateString: string
): Promise<string[]> {
  const day = new Date(`${dateString}T00:00:00`);
  if (Number.isNaN(day.getTime())) return [];

  // No slots in the past, and none at the weekend.
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (day < today) return [];
  if (day.getDay() === 0 || day.getDay() === 6) return [];

  const booked = new Set(
    (await storage.getDoctorAppointments(doctorId))
      .filter((appointment: any) => {
        if (!appointment.appointmentDate) return false;
        if (appointment.status === 'cancelled') return false;
        return new Date(appointment.appointmentDate).toISOString().split('T')[0] === dateString;
      })
      .map((appointment: any) => appointment.appointmentTime)
  );

  let slots = CLINIC_TIME_SLOTS.filter((time) => !booked.has(time));

  // Calendar conflicts, when a calendar is connected. One batched call for the
  // day rather than one request per slot.
  try {
    const { googleCalendarService } = await import('./google-calendar-service');
    const checks = await googleCalendarService.checkMultipleTimeSlots(
      slots.map((time) => ({ date: dateString, time }))
    );
    slots = slots.filter((_, index) => checks[index]?.isAvailable !== false);
  } catch (error) {
    // An unreachable calendar must not invent availability in either direction.
    // The appointments table is the authoritative record of what this system
    // booked; the calendar is an additional constraint, so losing it degrades to
    // the database answer rather than to an empty list.
    console.warn('Calendar availability check unavailable; using booked appointments only');
  }

  return slots;
}

/**
 * Free slots across every clinician, for a whole month.
 *
 * Both table reads are gone. This loaded every user in the database — password
 * hashes included — and every appointment ever created, on an endpoint that
 * takes no authentication, then filtered both in JavaScript inside a triple loop
 * over days, clinicians and slots.
 */
export async function getAvailableAppointmentSlots(year: number, month: number) {
  const availableSlots: { [date: string]: any[] } = {};
  const daysInMonth = new Date(year, month, 0).getDate();

  const professionals = await storage.listDirectory(['doctor', 'radiologist']);
  if (professionals.length === 0) return availableSlots;

  // One query for the month's bookings, keyed by clinician and date, instead of
  // every appointment in the system re-filtered once per day.
  const monthStart = new Date(year, month - 1, 1);
  const monthEnd = new Date(year, month, 1);
  const booked = await storage.getBookedSlots(monthStart, monthEnd);

  const bookedByKey = new Map<string, Set<string>>();
  for (const slot of booked) {
    const key = `${slot.doctorId}:${slot.date}`;
    if (!bookedByKey.has(key)) bookedByKey.set(key, new Set());
    bookedByKey.get(key)!.add(slot.time);
  }

  const now = new Date();

  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(year, month - 1, day);
    const dateString = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

    // Skip weekends and past dates.
    if (date.getDay() === 0 || date.getDay() === 6 || date < now) continue;

    const availableSlotsForDay: any[] = [];

    for (const professional of professionals) {
      const taken = bookedByKey.get(`${professional.id}:${dateString}`) ?? new Set<string>();

      for (const time of CLINIC_TIME_SLOTS) {
        if (taken.has(time)) continue;
        availableSlotsForDay.push({
          time,
          available: true,
          doctor: professional.fullName,
          doctorId: professional.id,
          role: professional.role,
          specialty:
            professional.specialization ||
            (professional.role === 'radiologist' ? 'Medical Imaging' : 'General Practice'),
        });
      }
    }

    availableSlots[dateString] = availableSlotsForDay;
  }

  return availableSlots;
}
