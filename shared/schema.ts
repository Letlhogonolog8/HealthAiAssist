import { pgTable, text, serial, integer, boolean, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  role: text("role").notNull().default("patient"),
  fullName: text("full_name").notNull(),
  email: text("email").unique().notNull(),
  age: integer("age"),
  gender: text("gender"),
  phone: text("phone"),
  address: text("address"),
  bloodType: text("blood_type"),
  height: text("height"),
  weight: text("weight"),
  emergencyContact: text("emergency_contact"),
  specialization: text("specialization"),
  licenseNumber: text("license_number"),
  isActive: boolean("is_active").default(true),
  resetToken: text("reset_token"),
  resetTokenExpiry: timestamp("reset_token_expiry"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  usernameIdx: index("idx_users_username").on(table.username),
  emailIdx: index("idx_users_email").on(table.email),
  roleIdx: index("idx_users_role").on(table.role),
}));

export const medicalScans = pgTable("medical_scans", {
  id: serial("id").primaryKey(),
  patientId: integer("patient_id").references(() => users.id).notNull(),
  scanType: text("scan_type").notNull(),
  imagePath: text("image_path"),
  aiConfidence: text("ai_confidence").default("0%"),
  result: text("result").default("Processing"),
  radiologistId: integer("radiologist_id").references(() => users.id),
  doctorId: integer("doctor_id").references(() => users.id),
  notes: text("notes").default(""),
  status: text("status").default("pending"),
  priority: text("priority").default("medium"),
  findings: text("findings").default(""),
  recommendations: text("recommendations").default(""),
  riskLevel: text("risk_level").default("low"),
  processingTime: integer("processing_time_ms"),
  imageSize: integer("image_size_bytes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  patientIdx: index("idx_scans_patient").on(table.patientId),
  statusIdx: index("idx_scans_status").on(table.status),
  createdAtIdx: index("idx_scans_created").on(table.createdAt),
  scanTypeIdx: index("idx_scans_type").on(table.scanType),
  radiologistIdx: index("idx_scans_radiologist").on(table.radiologistId),
  doctorIdx: index("idx_scans_doctor").on(table.doctorId),
}));

export const medicalTerms = pgTable("medical_terms", {
  id: serial("id").primaryKey(),
  term: text("term").notNull(),
  definition: text("definition").notNull(),
  pronunciation: text("pronunciation"),
  category: text("category").notNull(),
});

export const appointments = pgTable("appointments", {
  id: serial("id").primaryKey(),
  patientId: integer("patient_id").references(() => users.id).notNull(),
  doctorId: integer("doctor_id").references(() => users.id).notNull(),
  appointmentDate: timestamp("appointment_date").notNull(),
  appointmentTime: text("appointment_time").notNull(),
  type: text("type").notNull(),
  status: text("status").default("scheduled"),
  notes: text("notes").default(""),
  priority: text("priority").default("medium"),
  urgencyScore: integer("urgency_score").default(5),
  duration: integer("duration_minutes").default(30),
  reason: text("reason").default(""),
  followUpRequired: boolean("follow_up_required").default(false),
  reminderSent: boolean("reminder_sent").default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  patientIdx: index("idx_appointments_patient").on(table.patientId),
  doctorIdx: index("idx_appointments_doctor").on(table.doctorId),
  dateIdx: index("idx_appointments_date").on(table.appointmentDate),
  statusIdx: index("idx_appointments_status").on(table.status),
  typeIdx: index("idx_appointments_type").on(table.type),
}));



export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
  role: true,
  fullName: true,
  email: true,
  specialization: true,
  licenseNumber: true,
});

export const insertScanSchema = createInsertSchema(medicalScans).pick({
  patientId: true,
  scanType: true,
  imagePath: true,
  aiConfidence: true,
  result: true,
  notes: true,
  status: true,
  findings: true,
});

export const insertTermSchema = createInsertSchema(medicalTerms).pick({
  term: true,
  definition: true,
  pronunciation: true,
  category: true,
});

export const insertAppointmentSchema = createInsertSchema(appointments).pick({
  patientId: true,
  doctorId: true,
  appointmentDate: true,
  appointmentTime: true,
  type: true,
  notes: true,
  priority: true,
  urgencyScore: true,
});



export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type InsertScan = z.infer<typeof insertScanSchema>;
export type MedicalScan = typeof medicalScans.$inferSelect;
export type InsertTerm = z.infer<typeof insertTermSchema>;
export type MedicalTerm = typeof medicalTerms.$inferSelect;
export type InsertAppointment = z.infer<typeof insertAppointmentSchema>;
export type Appointment = typeof appointments.$inferSelect;

