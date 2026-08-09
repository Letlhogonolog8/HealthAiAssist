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

export async function getPatientProfile(patientId: number) {
  const user = await storage.getUser(patientId);
  if (!user || user.role !== 'patient') {
    throw new Error('Patient not found');
  }
  const patientScans = await storage.getScans(patientId);
  const patientAppointments: Appointment[] = await storage.getPatientAppointments(patientId);

  // Type assertion for optional properties
  const userWithOptional = user as User;

  // Compose profile dynamically
  return {
    id: user.id,
  personalInfo: {
    name: user.fullName || user.username,
    email: user.email || 'patient@example.com',
    phone: user.phone || '+1 (555) 123-4567',
    address: user.address || '123 Medical Center Blvd, Health City, HC 12345',
    emergencyContact: user.emergencyContact || 'Emergency Contact - +1 (555) 987-6543',
    age: user.age ?? 34,
    gender: user.gender ?? 'Female',
    bloodType: user.bloodType ?? 'A+',
    height: user.height ?? "5'6\"",
    weight: user.weight ?? '135 lbs'
  },
    medicalHistory: userWithOptional.medicalHistory ?? {
      allergies: ['Penicillin', 'Shellfish'],
      conditions: ['Hypertension', 'Type 2 Diabetes'],
      medications: ['Metformin 500mg', 'Lisinopril 10mg', 'Aspirin 81mg'],
      surgeries: ['Appendectomy (2018)', 'Gallbladder removal (2020)']
    },
  recentScans: patientScans.map(scan => ({
    id: scan.id,
    type: scan.scanType,
    date: scan.createdAt ? new Date(scan.createdAt).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
    result: scan.result || 'Processing',
    confidence: scan.aiConfidence || '0%',
    status: scan.status === 'completed' ? 'normal' : scan.status === 'pending' ? 'pending' : 'abnormal',
    doctor: scan.doctorId ? `Dr. ${scan.doctorId}` : 'Dr. Unknown'
  })),
  appointments: patientAppointments.map(appointment => ({
    ...appointment,
    doctorName: appointment.doctorName || `Dr. ${appointment.doctorId || 'Unknown'}`,
    status: appointment.status || 'scheduled',
    type: appointment.type || 'General Consultation'
  })),
    vitals: userWithOptional.vitals ?? {
      bloodPressure: '120/80',
      heartRate: 72,
      temperature: 98.6,
      weight: 135,
      bmi: 21.8,
      lastUpdated: new Date().toISOString()
    },
    healthScore: userWithOptional.healthScore ?? {
      overall: patientScans.length > 0 ? Math.max(70, 100 - (patientScans.filter(s => s.result && s.result.toLowerCase().includes('abnormal')).length * 10)) : 85,
      cardiovascular: 88,
      respiratory: 82,
      metabolic: 85
    }
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
