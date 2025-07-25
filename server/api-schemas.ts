import { z } from 'zod';

// Standardized API response schemas
export const StandardResponse = z.object({
  success: z.boolean(),
  data: z.any().optional(),
  error: z.string().optional(),
  message: z.string().optional(),
  timestamp: z.string().default(() => new Date().toISOString())
});

export const ScanResultSchema = z.object({
  id: z.number(),
  confidence: z.number().min(0).max(100),
  processingTime: z.number(),
  scanType: z.string(),
  type: z.string(),
  hasCancer: z.boolean(),
  riskLevel: z.enum(['low', 'medium', 'high']),
  findings: z.array(z.string()),
  recommendations: z.array(z.string()),
  cancerType: z.enum(['breast', 'prostate', 'lung', 'cervical', 'skin', 'unknown']).optional(),
  metastasisDetected: z.boolean().optional(),
  metastasisStage: z.enum(['early', 'intermediate', 'advanced', 'none']).optional(),
  piRadsScore: z.number().min(1).max(5).optional(),
  biRadsScore: z.number().min(0).max(6).optional(),
  lungRadsScore: z.number().min(1).max(6).optional(),
  abcdeScore: z.number().min(0).max(10).optional(),
  riskFactors: z.array(z.string()),
  patientHistory: z.object({
    previousCancer: z.boolean(),
    familyHistory: z.boolean(),
    age: z.number().optional(),
    smokingHistory: z.boolean().optional()
  }).optional(),
  biomarkers: z.object({
    psa: z.number().optional(),
    cea: z.number().optional(),
    ca125: z.number().optional(),
    ca199: z.number().optional()
  }).optional(),
  malignancyRisk: z.number().min(0).max(100), // Add missing field
  tissueAnalysis: z.object({
    density: z.string(),
    texture: z.string(),
    vascularization: z.string()
  }).optional(),
  followUpRequired: z.boolean().default(false),
  nextScanDate: z.string().optional()
});

export const UserSchema = z.object({
  id: z.number(),
  username: z.string(),
  fullName: z.string(),
  role: z.enum(['admin', 'doctor', 'patient', 'radiologist']),
  email: z.string().email(),
  isActive: z.boolean().default(true),
  lastLogin: z.string().optional(),
  profileComplete: z.boolean().default(false)
});

export const AppointmentSchema = z.object({
  id: z.number(),
  patientId: z.number(),
  doctorId: z.number(),
  patientName: z.string(),
  doctorName: z.string(),
  appointmentDate: z.string(),
  appointmentTime: z.string(),
  type: z.string(),
  status: z.enum(['scheduled', 'confirmed', 'cancelled', 'completed', 'rescheduled']),
  notes: z.string().optional(),
  priority: z.enum(['normal', 'high', 'urgent']).default('normal'),
  duration: z.number().default(30),
  hasResponse: z.boolean().default(false),
  responseMessage: z.string().optional()
});

export const StatsSchema = z.object({
  activePatients: z.number(),
  todaysAppointments: z.number(),
  pendingReports: z.number(),
  criticalCases: z.number(),
  totalPatients: z.number(),
  appointmentsCompleted: z.number(),
  avgConsultationTime: z.number(),
  patientSatisfaction: z.number(),
  aiAccuracy: z.number(),
  responseTime: z.number()
});

// Response wrapper functions
export function successResponse<T>(data: T, message?: string) {
  return {
    success: true,
    data,
    message,
    timestamp: new Date().toISOString()
  };
}

export function errorResponse(error: string, statusCode: number = 500) {
  return {
    success: false,
    error,
    timestamp: new Date().toISOString(),
    statusCode
  };
}

export function validateAndRespond<T>(
  schema: z.ZodSchema<T>,
  data: any,
  res: any,
  message?: string
) {
  try {
    const validatedData = schema.parse(data);
    return res.json(successResponse(validatedData, message));
  } catch (validationError) {
    console.error('Schema validation error:', validationError);
    return res.status(400).json(errorResponse('Invalid data format'));
  }
}