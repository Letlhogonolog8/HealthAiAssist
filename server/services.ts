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

type Dermatologist = User & {
  specialization?: string;
  isUrgentCare?: boolean;
  experience?: string;
  rating?: number;
  location?: string;
  nextAvailable?: string;
  availableSlots?: any[];
  hospitalAffiliation?: string;
  coordinates?: any;
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

export async function getAvailableDermatologists(urgency: string) {
  // Fetch dermatologists dynamically from storage or database
  const allUsers = await storage.getAllUsers();
  const dermatologists: Dermatologist[] = allUsers.filter(user => user.role === 'dermatologist') as Dermatologist[];

  // Sort and filter based on urgency
  let filteredDermatologists = dermatologists;
  if (urgency === 'urgent') {
    filteredDermatologists = dermatologists.filter(d => d.isUrgentCare).concat(
      dermatologists.filter(d => !d.isUrgentCare)
    );
  }

  return filteredDermatologists.map(d => ({
    id: d.id,
    name: d.fullName,
    specialty: d.specialization || 'Dermatology',
    experience: d.experience ?? '',
    rating: d.rating ?? 0,
    location: d.location ?? '',
    phone: d.phone ?? '',
    email: d.email ?? '',
    nextAvailable: d.nextAvailable ?? '',
    isUrgentCare: Boolean(d.isUrgentCare),
    availableSlots: d.availableSlots ?? [],
    hospitalAffiliation: d.hospitalAffiliation ?? '',
    coordinates: d.coordinates ?? {}
  }));
}

export async function getAvailableAppointmentSlots(year: number, month: number) {
  const availableSlots: { [date: string]: any[] } = {};
  const daysInMonth = new Date(year, month, 0).getDate();

  const allUsers = await storage.getAllUsers();
  const availableProfessionals = allUsers.filter(user => ['doctor', 'radiologist'].includes(user.role));
  
  // Get all appointments for the month
  const allAppointments = await storage.getAppointments();

  const timeSlots = ['9:00 AM', '9:30 AM', '10:00 AM', '10:30 AM', '11:00 AM', '11:30 AM', '2:00 PM', '2:30 PM', '3:00 PM', '3:30 PM', '4:00 PM', '4:30 PM'];

  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(year, month - 1, day);
    const dateString = date.toISOString().split('T')[0];

    // Skip weekends and past dates
    if (date.getDay() === 0 || date.getDay() === 6 || date < new Date()) continue;

    if (availableProfessionals.length === 0) continue;

    // Get booked appointments for this date
    const dayAppointments = allAppointments.filter(apt => {
      const aptDate = new Date(apt.appointmentDate).toISOString().split('T')[0];
      return aptDate === dateString;
    });

    const availableSlotsForDay: any[] = [];
    
    for (const professional of availableProfessionals) {
      // Get booked times for this professional on this date
      const bookedTimes = dayAppointments
        .filter(apt => apt.doctorId === professional.id)
        .map(apt => apt.appointmentTime);

      // Add available time slots for this professional
      for (const time of timeSlots) {
        if (!bookedTimes.includes(time)) {
          availableSlotsForDay.push({
            time,
            available: true,
            doctor: professional.fullName,
            doctorId: professional.id,
            role: professional.role,
            specialty: professional.specialization || (professional.role === 'radiologist' ? 'Medical Imaging' : 'General Practice')
          });
        }
      }
    }

    availableSlots[dateString] = availableSlotsForDay;
  }

  return availableSlots;
}
