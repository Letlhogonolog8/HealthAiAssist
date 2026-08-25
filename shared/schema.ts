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

  /**
   * Second factor. Off until the user has proved they can produce a code.
   *
   * `mfaSecret` is populated at enrolment but `mfaEnabled` stays false until a
   * generated code verifies against it. Enabling on enrolment instead would
   * lock out anyone whose authenticator app failed to scan the QR — the
   * commonest way self-service MFA goes wrong, and the one that generates
   * support calls from clinicians who cannot reach patient records.
   *
   * The secret is encrypted at rest: it is a bearer credential, and a database
   * dump containing base32 TOTP seeds is a set of working second factors. See
   * server/crypto/encrypted-fields.ts.
   */
  mfaEnabled: boolean("mfa_enabled").default(false).notNull(),
  mfaSecret: text("mfa_secret"),
  /**
   * bcrypt hashes of single-use recovery codes, as a JSON array.
   *
   * Hashed for the same reason passwords are: they are equivalent to the second
   * factor. Consumed on use — the matched hash is removed from the array —
   * because a recovery code that still works after being used is a permanent
   * bypass sitting in whatever the user wrote it down in.
   */
  mfaBackupCodes: text("mfa_backup_codes"),
  mfaEnrolledAt: timestamp("mfa_enrolled_at"),

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
  /**
   * The model's binary call, stored as a boolean rather than inferred later.
   *
   * Production performance is a comparison between what the model said and what
   * turned out to be true, so both sides have to be recorded unambiguously.
   * `result` is a human-readable sentence ("Lung Cancer detected - high risk"),
   * and deriving the prediction by searching it for the word "cancer" makes the
   * confusion matrix depend on copy-editing. Null where no model ran — a scan
   * queued for manual review, or a row written before this column existed — and
   * those rows are excluded from measurement rather than guessed at.
   */
  predictedPositive: boolean("predicted_positive"),
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
 * What a scan turned out to be, established by a human.
 *
 * This is the missing half of every performance claim the platform makes. A
 * model's held-out evaluation says how it behaved on a fixed dataset in a lab;
 * it says nothing about how it behaves on this hospital's patients, this
 * scanner, this population. That second question needs a confirmed answer per
 * scan to compare the prediction against, and until this table existed the
 * system recorded none — so every endpoint that wanted to report production
 * accuracy correctly returned null, because the number was not merely unmeasured
 * but unmeasurable.
 *
 * Append-only, like `genomic_consents` and `processing_consents`. Rows are never
 * updated: an adjudication that is later revised is a new row, and the current
 * answer is the newest row per scan. A diagnosis that changed and a diagnosis
 * that was always this are different facts, and an audit needs to tell them
 * apart.
 *
 * `method` is not decoration. Histopathology and "the radiologist looked again"
 * are not equally strong evidence, and a performance figure computed only from
 * the weakest available confirmations is worth less than one that says which
 * confirmations it used.
 */
export const scanOutcomes = pgTable("scan_outcomes", {
  id: serial("id").primaryKey(),
  scanId: integer("scan_id").references(() => medicalScans.id).notNull(),

  /**
   * "malignant" | "benign" | "indeterminate"
   *
   * Indeterminate is a real answer, not a missing one: a biopsy can be
   * inconclusive. Those rows are counted and reported separately rather than
   * being forced into one of the other two, which would bias the matrix.
   */
  outcome: text("outcome").notNull(),

  /**
   * How it was established, strongest first:
   * "histopathology" | "biopsy" | "specialist_review" | "imaging_followup" |
   * "clinical_followup"
   */
  method: text("method").notNull(),

  recordedBy: integer("recorded_by").references(() => users.id).notNull(),
  notes: text("notes").default(""),
  recordedAt: timestamp("recorded_at").defaultNow().notNull(),
}, (table) => ({
  // "the newest outcome for this scan" is the only read on the hot path.
  scanIdx: index("idx_scan_outcomes_scan").on(table.scanId, table.recordedAt),
  outcomeIdx: index("idx_scan_outcomes_outcome").on(table.outcome),
}));

export type ScanOutcome = typeof scanOutcomes.$inferSelect;
export type InsertScanOutcome = typeof scanOutcomes.$inferInsert;

/** Adjudications this platform accepts, ordered strongest evidence first. */
export const OUTCOME_METHODS = [
  'histopathology',
  'biopsy',
  'specialist_review',
  'imaging_followup',
  'clinical_followup',
] as const;

export const OUTCOME_VALUES = ['malignant', 'benign', 'indeterminate'] as const;

export type OutcomeMethod = (typeof OUTCOME_METHODS)[number];
export type OutcomeValue = (typeof OUTCOME_VALUES)[number];

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

/**
 * Who is entitled to open a given patient's record, and on what basis.
 *
 * Until this existed, `requireMedicalAccess` admitted any account holding the
 * doctor, radiologist or admin role to any patient in the system. Access was
 * audited afterwards, which is necessary and not sufficient: POPIA section 19
 * expects minimality at the point of access, not only accountability once the
 * record has already been read.
 *
 * -- Most relationships are not rows in this table --------------------------
 *
 * They are derived from work that already exists. A clinician with an
 * appointment booked with a patient has a care relationship; so does the
 * radiologist or doctor assigned to one of their scans. Deriving those means no
 * backfill, no parallel bookkeeping that can drift from the appointments it
 * describes, and no clinician locked out of a patient they are demonstrably
 * treating.
 *
 * This table holds the two cases that cannot be derived:
 *
 *   "assigned"    - an explicit grant, made by an administrator, for care that
 *                   has not produced an appointment or a scan yet.
 *   "break_glass" - a clinician asserting an urgent need, in writing, and
 *                   accepting that the assertion is recorded against their name.
 *
 * -- Why break-glass rather than a stricter rule ----------------------------
 *
 * Because emergencies are real, and a system that cannot be overridden in one
 * gets overridden around: shared logins, a colleague's session left open, the
 * record read on someone else's account. An override that is easy to invoke and
 * impossible to invoke quietly is safer than one that is hard to invoke.
 *
 * Hence: a justification is required, it is time-boxed, and it writes a
 * high-severity audit event naming the clinician, the patient and the reason.
 */
export const careRelationships = pgTable("care_relationships", {
  id: serial("id").primaryKey(),
  patientId: integer("patient_id").references(() => users.id).notNull(),
  clinicianId: integer("clinician_id").references(() => users.id).notNull(),
  /** "assigned" | "break_glass" */
  basis: text("basis").notNull(),
  /** Required for break_glass. Free text, written by the clinician. */
  justification: text("justification"),
  establishedBy: integer("established_by").references(() => users.id),
  establishedAt: timestamp("established_at").defaultNow().notNull(),
  /**
   * When the grant lapses. Null for an assigned relationship, which ends when
   * someone ends it; set for break-glass, which ends on its own.
   *
   * A break-glass grant that never expired would be a permanent bypass acquired
   * by typing a sentence once.
   */
  expiresAt: timestamp("expires_at"),
  endedAt: timestamp("ended_at"),
}, (table) => ({
  lookupIdx: index("idx_care_rel_lookup").on(table.clinicianId, table.patientId),
  patientIdx: index("idx_care_rel_patient").on(table.patientId),
}));

export type CareRelationship = typeof careRelationships.$inferSelect;
export type InsertCareRelationship = typeof careRelationships.$inferInsert;

/** How long a break-glass grant lasts before it has to be re-justified. */
export const BREAK_GLASS_TTL_MS = 4 * 60 * 60 * 1000;

/**
 * A request to erase personal information, and what happened to it.
 *
 * POPIA section 24 gives a data subject the right to request deletion. South
 * African health records law substantially constrains it: the National Health
 * Act and the HPCSA's guidance require patient records to be retained for at
 * least six years from the last entry, and longer for minors. Those two
 * obligations do not conflict so much as apply to different things, and the
 * honest system is one that says which is which rather than promising a
 * deletion it will not perform.
 *
 * So a request is recorded, adjudicated per category, and the outcome explains
 * what was erased, what was retained, and under what basis it was retained. A
 * refusal with a citation is a better answer than silence, and a far better
 * answer than a deletion that quietly did not happen.
 */
export const erasureRequests = pgTable("erasure_requests", {
  id: serial("id").primaryKey(),
  patientId: integer("patient_id").references(() => users.id).notNull(),
  requestedAt: timestamp("requested_at").defaultNow().notNull(),
  /** "pending" | "partially_completed" | "refused" | "completed" */
  status: text("status").notNull().default("pending"),
  /** What the data subject asked for, in their words. */
  requestNotes: text("request_notes").default(""),
  reviewedBy: integer("reviewed_by").references(() => users.id),
  reviewedAt: timestamp("reviewed_at"),
  /** Machine-readable record of what was erased and what was held back. */
  outcome: text("outcome"),
}, (table) => ({
  patientIdx: index("idx_erasure_patient").on(table.patientId),
  statusIdx: index("idx_erasure_status").on(table.status),
}));

export type ErasureRequest = typeof erasureRequests.$inferSelect;
export type InsertErasureRequest = typeof erasureRequests.$inferInsert;

export type ProcessingConsent = typeof processingConsents.$inferSelect;
export type InsertProcessingConsent = typeof processingConsents.$inferInsert;

/**
 * In-app notifications.
 *
 * These lived in a module-scoped array in server/routes.ts, under a comment
 * reading "replace with database in production". Three consequences, all live:
 * every notification vanished on restart or redeploy; a second instance behind a
 * load balancer had its own array, so whether a user saw a notification depended
 * on which process answered; and the array was capped at 50 entries globally, so
 * one busy conversation evicted everyone else's.
 *
 * `readAt` is a timestamp rather than a boolean so "when was this seen" is
 * answerable, which matters for anything clinical.
 */
export const notifications = pgTable("notifications", {
  id: serial("id").primaryKey(),
  recipientId: integer("recipient_id").references(() => users.id).notNull(),
  /** Null for notifications the system raises rather than a person. */
  actorId: integer("actor_id").references(() => users.id),
  // "chat_message" | "appointment" | "scan_result" | "report"
  type: text("type").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull().default(""),
  /** Where the UI should send the reader, e.g. "/chat". */
  link: text("link"),
  readAt: timestamp("read_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  recipientIdx: index("idx_notifications_recipient").on(table.recipientId, table.createdAt),
  unreadIdx: index("idx_notifications_unread").on(table.recipientId, table.readAt),
}));

export type Notification = typeof notifications.$inferSelect;
export type InsertNotification = typeof notifications.$inferInsert;

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

