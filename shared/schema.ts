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
  /**
   * Which model produced this result, e.g. "resnet50v2-skin-v1".
   *
   * Without it a stored result cannot be explained later: models get retrained
   * and thresholds change, so a figure from six months ago may not be
   * reproducible from today's artifact. Null on rows written before this column
   * existed, and on scans queued for manual review where no model ran.
   */
  modelVersion: text("model_version"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow(),
  reviewedAt: timestamp("reviewed_at"),
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

export const chatMessages = pgTable("chat_messages", {
  id: serial("id").primaryKey(),
  senderId: integer("sender_id").references(() => users.id).notNull(),
  receiverId: integer("receiver_id").references(() => users.id).notNull(),
  message: text("message").notNull(),
  messageType: text("message_type").default("text"),
  status: text("status").default("sent"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  readAt: timestamp("read_at"),
}, (table) => ({
  senderIdx: index("idx_chat_sender").on(table.senderId),
  receiverIdx: index("idx_chat_receiver").on(table.receiverId),
  createdAtIdx: index("idx_chat_created").on(table.createdAt),
}));

/**
 * Append-only audit trail for sensitive non-genomic operations.
 *
 * `auditLog()` previously wrote to console.log only, so there was no audit trail
 * — just terminal output that vanished with the process. Genomic access already
 * had a proper table; this gives everything else the same treatment.
 */
export const auditEvents = pgTable("audit_events", {
  id: serial("id").primaryKey(),
  action: text("action").notNull(),
  actorUserId: integer("actor_user_id").references(() => users.id),
  actorUsername: text("actor_username"),
  actorRole: text("actor_role"),
  method: text("method"),
  path: text("path"),
  /** Populated once the response is known, so failed attempts are distinguishable. */
  statusCode: integer("status_code"),
  ipAddress: text("ip_address"),
  /**
   * Non-identifying context, e.g. which categories of data a cross-border
   * transfer carried. Never the values themselves — an audit log that contains
   * the personal information it is auditing has multiplied the problem.
   */
  detail: text("detail"),
  occurredAt: timestamp("occurred_at").defaultNow().notNull(),
}, (table) => ({
  actionIdx: index("idx_audit_events_action").on(table.action),
  actorIdx: index("idx_audit_events_actor").on(table.actorUserId),
  occurredAtIdx: index("idx_audit_events_occurred").on(table.occurredAt),
}));

export type AuditEvent = typeof auditEvents.$inferSelect;
export type InsertAuditEvent = typeof auditEvents.$inferInsert;

/**
 * Consent for processing that is not genomic — currently the AI assistant, which
 * forwards messages to a processor outside South Africa.
 *
 * Separate from `genomic_consents` because the scopes and the risk are
 * different, and conflating them would let a grant for one imply a grant for the
 * other. Same append-only shape: rows are never updated, so the history is
 * reconstructable and the current state is the newest row per (patient, scope).
 */
export const processingConsents = pgTable("processing_consents", {
  id: serial("id").primaryKey(),
  patientId: integer("patient_id").references(() => users.id).notNull(),
  // "external_ai_assistant"
  scope: text("scope").notNull(),
  granted: boolean("granted").notNull(),
  /** Version of the disclosure the person actually saw. */
  consentVersion: text("consent_version").notNull(),
  recordedAt: timestamp("recorded_at").defaultNow().notNull(),
  notes: text("notes").default(""),
}, (table) => ({
  patientScopeIdx: index("idx_processing_consent_patient_scope").on(table.patientId, table.scope),
  recordedAtIdx: index("idx_processing_consent_recorded").on(table.recordedAt),
}));

export type ProcessingConsent = typeof processingConsents.$inferSelect;
export type InsertProcessingConsent = typeof processingConsents.$inferInsert;

// ---------------------------------------------------------------------------
// Genomics
//
// Genomic data is kept in its own tables rather than on `users`, because it has
// a different access model: it is immutable once uploaded, it implicates blood
// relatives who never consented, and it cannot be reissued if leaked. Every read
// is logged; every use requires an unrevoked consent scope.
// ---------------------------------------------------------------------------

/**
 * Granular, revocable consent. One row per grant or revocation — rows are never
 * updated, so the consent history is auditable. Current state is the newest row
 * per (patient, scope).
 */
export const genomicConsents = pgTable("genomic_consents", {
  id: serial("id").primaryKey(),
  patientId: integer("patient_id").references(() => users.id).notNull(),
  // "clinical_care" | "research" | "secondary_sharing"
  scope: text("scope").notNull(),
  granted: boolean("granted").notNull(),
  // Version of the consent text the patient actually saw.
  consentVersion: text("consent_version").notNull(),
  recordedAt: timestamp("recorded_at").defaultNow().notNull(),
  recordedByUserId: integer("recorded_by_user_id").references(() => users.id),
  notes: text("notes").default(""),
}, (table) => ({
  patientScopeIdx: index("idx_consent_patient_scope").on(table.patientId, table.scope),
  recordedAtIdx: index("idx_consent_recorded").on(table.recordedAt),
}));

/** One uploaded genotype file per row. */
export const genomicProfiles = pgTable("genomic_profiles", {
  id: serial("id").primaryKey(),
  patientId: integer("patient_id").references(() => users.id).notNull(),
  // "23andme" | "ancestrydna" | "vcf"
  source: text("source").notNull(),
  // Reference build the file declares, e.g. "GRCh37". Scores are only valid when
  // the build matches the scoring file's build.
  genomeBuild: text("genome_build"),
  variantCount: integer("variant_count").notNull().default(0),
  /**
   * Self-reported ancestry, used to pick a PRS transferability factor and to
   * report it honestly. Free text; absence is meaningful and must not be
   * defaulted to European — that assumption is the bias this system exists to
   * surface. See server/genomics/ancestry.ts.
   */
  selfReportedAncestry: text("self_reported_ancestry"),
  // "processing" | "ready" | "rejected"
  status: text("status").notNull().default("processing"),
  rejectionReason: text("rejection_reason"),
  uploadedAt: timestamp("uploaded_at").defaultNow().notNull(),
}, (table) => ({
  patientIdx: index("idx_genomic_profiles_patient").on(table.patientId),
  statusIdx: index("idx_genomic_profiles_status").on(table.status),
}));

/** Individual genotype calls. Only variants a loaded panel needs are persisted. */
export const genomicVariants = pgTable("genomic_variants", {
  id: serial("id").primaryKey(),
  profileId: integer("profile_id").references(() => genomicProfiles.id).notNull(),
  rsid: text("rsid").notNull(),
  chromosome: text("chromosome"),
  position: integer("position"),
  // Two-character diploid call as read from the file, e.g. "AG". "--" = no call.
  genotype: text("genotype").notNull(),
}, (table) => ({
  profileIdx: index("idx_genomic_variants_profile").on(table.profileId),
  rsidIdx: index("idx_genomic_variants_rsid").on(table.rsid),
  profileRsidIdx: index("idx_genomic_variants_profile_rsid").on(table.profileId, table.rsid),
}));

/**
 * A computed risk assessment. Stores the inputs alongside the output so a past
 * result can be explained later, after panels or models have moved on.
 */
export const riskAssessments = pgTable("genomic_risk_assessments", {
  id: serial("id").primaryKey(),
  patientId: integer("patient_id").references(() => users.id).notNull(),
  condition: text("condition").notNull(),
  profileId: integer("profile_id").references(() => genomicProfiles.id),
  scanId: integer("scan_id").references(() => medicalScans.id),

  // Polygenic component
  panelId: text("panel_id"),
  prsRawScore: text("prs_raw_score"),
  prsPercentile: integer("prs_percentile"),
  /** Fraction of panel variants actually genotyped in this profile, 0-100. */
  panelCoveragePct: integer("panel_coverage_pct"),
  /** Ancestry transferability applied, 0-100. Low values widen the interval. */
  transferabilityPct: integer("transferability_pct"),

  // Fused output
  // "low" | "moderate" | "high" | "indeterminate"
  riskBand: text("risk_band").notNull().default("indeterminate"),
  /** JSON: which inputs contributed, and which were missing. */
  contributions: text("contributions").default("{}"),
  /** Human-readable limitations attached to THIS result. */
  caveats: text("caveats").default(""),

  requiresClinicianReview: boolean("requires_clinician_review").notNull().default(true),
  reviewedByUserId: integer("reviewed_by_user_id").references(() => users.id),
  reviewedAt: timestamp("reviewed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  patientIdx: index("idx_genomic_risk_patient").on(table.patientId),
  conditionIdx: index("idx_genomic_risk_condition").on(table.condition),
  createdAtIdx: index("idx_genomic_risk_created").on(table.createdAt),
}));

/**
 * Append-only record of every genomic data access. Never updated, never deleted.
 * Separate from the general audit log because genomic access has to be
 * reconstructable per-patient on request.
 */
export const genomicAccessLog = pgTable("genomic_access_log", {
  id: serial("id").primaryKey(),
  patientId: integer("patient_id").references(() => users.id).notNull(),
  accessedByUserId: integer("accessed_by_user_id").references(() => users.id),
  accessedByRole: text("accessed_by_role"),
  // "upload" | "read_variants" | "compute_risk" | "export" | "delete"
  action: text("action").notNull(),
  purpose: text("purpose"),
  /** Consent scope relied on for this access. */
  consentScope: text("consent_scope"),
  granted: boolean("granted").notNull(),
  denialReason: text("denial_reason"),
  ipAddress: text("ip_address"),
  occurredAt: timestamp("occurred_at").defaultNow().notNull(),
}, (table) => ({
  patientIdx: index("idx_genomic_access_patient").on(table.patientId),
  occurredAtIdx: index("idx_genomic_access_occurred").on(table.occurredAt),
}));

export const insertGenomicConsentSchema = createInsertSchema(genomicConsents).pick({
  patientId: true,
  scope: true,
  granted: true,
  consentVersion: true,
  notes: true,
});

export const insertGenomicProfileSchema = createInsertSchema(genomicProfiles).pick({
  patientId: true,
  source: true,
  genomeBuild: true,
  variantCount: true,
  selfReportedAncestry: true,
  status: true,
});

export type GenomicConsent = typeof genomicConsents.$inferSelect;
export type InsertGenomicConsent = z.infer<typeof insertGenomicConsentSchema>;
export type GenomicProfile = typeof genomicProfiles.$inferSelect;
export type InsertGenomicProfile = z.infer<typeof insertGenomicProfileSchema>;
export type GenomicVariant = typeof genomicVariants.$inferSelect;
export type InsertGenomicVariant = typeof genomicVariants.$inferInsert;
export type RiskAssessment = typeof riskAssessments.$inferSelect;
export type InsertRiskAssessment = typeof riskAssessments.$inferInsert;
export type GenomicAccessLogEntry = typeof genomicAccessLog.$inferSelect;
export type InsertGenomicAccessLogEntry = typeof genomicAccessLog.$inferInsert;


export const insertUserSchema = createInsertSchema(users)
  .pick({
    username: true,
    password: true,
    role: true,
    fullName: true,
    email: true,
    age: true,
    gender: true,
    specialization: true,
    licenseNumber: true,
  })
  .refine((data) => {
    // Password must be at least 8 characters with mixed case and number
    const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;
    return passwordRegex.test(data.password);
  }, {
    message: "Password must be at least 8 characters with uppercase, lowercase, and a number",
    path: ["password"],
  })
  .refine((data) => {
    // Username must be 3-20 characters, alphanumeric with underscore
    return /^[a-zA-Z0-9_]{3,20}$/.test(data.username);
  }, {
    message: "Username must be 3-20 characters, alphanumeric with underscore only",
    path: ["username"],
  })
  .refine((data) => {
    // Email must be valid and not too long
    return data.email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email);
  }, {
    message: "Invalid email format or too long",
    path: ["email"],
  })
  .refine((data) => {
    // Full name must be reasonable length
    return data.fullName.length >= 2 && data.fullName.length <= 255;
  }, {
    message: "Full name must be between 2 and 255 characters",
    path: ["fullName"],
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
  // Traceability: which model produced the result, how long it took, and the
  // band it landed in. Omitted previously, so results were unattributable.
  modelVersion: true,
  processingTime: true,
  riskLevel: true,
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
export type ChatMessage = typeof chatMessages.$inferSelect;
export type InsertChatMessage = typeof chatMessages.$inferInsert;

