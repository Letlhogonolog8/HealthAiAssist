CREATE TABLE IF NOT EXISTS "appointments" (
	"id" serial PRIMARY KEY NOT NULL,
	"patient_id" integer NOT NULL,
	"doctor_id" integer NOT NULL,
	"appointment_date" timestamp NOT NULL,
	"appointment_time" text NOT NULL,
	"type" text NOT NULL,
	"status" text DEFAULT 'scheduled',
	"notes" text DEFAULT '',
	"priority" text DEFAULT 'medium',
	"urgency_score" integer DEFAULT 5,
	"duration_minutes" integer DEFAULT 30,
	"reason" text DEFAULT '',
	"follow_up_required" boolean DEFAULT false,
	"reminder_sent" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "chat_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"sender_id" integer NOT NULL,
	"receiver_id" integer NOT NULL,
	"message" text NOT NULL,
	"message_type" text DEFAULT 'text',
	"status" text DEFAULT 'sent',
	"created_at" timestamp DEFAULT now() NOT NULL,
	"read_at" timestamp
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "genomic_access_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"patient_id" integer NOT NULL,
	"accessed_by_user_id" integer,
	"accessed_by_role" text,
	"action" text NOT NULL,
	"purpose" text,
	"consent_scope" text,
	"granted" boolean NOT NULL,
	"denial_reason" text,
	"ip_address" text,
	"occurred_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "genomic_consents" (
	"id" serial PRIMARY KEY NOT NULL,
	"patient_id" integer NOT NULL,
	"scope" text NOT NULL,
	"granted" boolean NOT NULL,
	"consent_version" text NOT NULL,
	"recorded_at" timestamp DEFAULT now() NOT NULL,
	"recorded_by_user_id" integer,
	"notes" text DEFAULT ''
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "genomic_profiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"patient_id" integer NOT NULL,
	"source" text NOT NULL,
	"genome_build" text,
	"variant_count" integer DEFAULT 0 NOT NULL,
	"self_reported_ancestry" text,
	"status" text DEFAULT 'processing' NOT NULL,
	"rejection_reason" text,
	"uploaded_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "genomic_variants" (
	"id" serial PRIMARY KEY NOT NULL,
	"profile_id" integer NOT NULL,
	"rsid" text NOT NULL,
	"chromosome" text,
	"position" integer,
	"genotype" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "medical_scans" (
	"id" serial PRIMARY KEY NOT NULL,
	"patient_id" integer NOT NULL,
	"scan_type" text NOT NULL,
	"image_path" text,
	"ai_confidence" text DEFAULT '0%',
	"result" text DEFAULT 'Processing',
	"radiologist_id" integer,
	"doctor_id" integer,
	"notes" text DEFAULT '',
	"status" text DEFAULT 'pending',
	"priority" text DEFAULT 'medium',
	"findings" text DEFAULT '',
	"recommendations" text DEFAULT '',
	"risk_level" text DEFAULT 'low',
	"processing_time_ms" integer,
	"image_size_bytes" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now(),
	"reviewed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "medical_terms" (
	"id" serial PRIMARY KEY NOT NULL,
	"term" text NOT NULL,
	"definition" text NOT NULL,
	"pronunciation" text,
	"category" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "genomic_risk_assessments" (
	"id" serial PRIMARY KEY NOT NULL,
	"patient_id" integer NOT NULL,
	"condition" text NOT NULL,
	"profile_id" integer,
	"scan_id" integer,
	"panel_id" text,
	"prs_raw_score" text,
	"prs_percentile" integer,
	"panel_coverage_pct" integer,
	"transferability_pct" integer,
	"risk_band" text DEFAULT 'indeterminate' NOT NULL,
	"contributions" text DEFAULT '{}',
	"caveats" text DEFAULT '',
	"requires_clinician_review" boolean DEFAULT true NOT NULL,
	"reviewed_by_user_id" integer,
	"reviewed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"password" text NOT NULL,
	"role" text DEFAULT 'patient' NOT NULL,
	"full_name" text NOT NULL,
	"email" text NOT NULL,
	"age" integer,
	"gender" text,
	"phone" text,
	"address" text,
	"blood_type" text,
	"height" text,
	"weight" text,
	"emergency_contact" text,
	"specialization" text,
	"license_number" text,
	"is_active" boolean DEFAULT true,
	"reset_token" text,
	"reset_token_expiry" timestamp,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "users_username_unique" UNIQUE("username"),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_patient_id_users_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_doctor_id_users_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_sender_id_users_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_receiver_id_users_id_fk" FOREIGN KEY ("receiver_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "genomic_access_log" ADD CONSTRAINT "genomic_access_log_patient_id_users_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "genomic_access_log" ADD CONSTRAINT "genomic_access_log_accessed_by_user_id_users_id_fk" FOREIGN KEY ("accessed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "genomic_consents" ADD CONSTRAINT "genomic_consents_patient_id_users_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "genomic_consents" ADD CONSTRAINT "genomic_consents_recorded_by_user_id_users_id_fk" FOREIGN KEY ("recorded_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "genomic_profiles" ADD CONSTRAINT "genomic_profiles_patient_id_users_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "genomic_variants" ADD CONSTRAINT "genomic_variants_profile_id_genomic_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."genomic_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medical_scans" ADD CONSTRAINT "medical_scans_patient_id_users_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medical_scans" ADD CONSTRAINT "medical_scans_radiologist_id_users_id_fk" FOREIGN KEY ("radiologist_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medical_scans" ADD CONSTRAINT "medical_scans_doctor_id_users_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "genomic_risk_assessments" ADD CONSTRAINT "genomic_risk_assessments_patient_id_users_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "genomic_risk_assessments" ADD CONSTRAINT "genomic_risk_assessments_profile_id_genomic_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."genomic_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "genomic_risk_assessments" ADD CONSTRAINT "genomic_risk_assessments_scan_id_medical_scans_id_fk" FOREIGN KEY ("scan_id") REFERENCES "public"."medical_scans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "genomic_risk_assessments" ADD CONSTRAINT "genomic_risk_assessments_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_appointments_patient" ON "appointments" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX "idx_appointments_doctor" ON "appointments" USING btree ("doctor_id");--> statement-breakpoint
CREATE INDEX "idx_appointments_date" ON "appointments" USING btree ("appointment_date");--> statement-breakpoint
CREATE INDEX "idx_appointments_status" ON "appointments" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_appointments_type" ON "appointments" USING btree ("type");--> statement-breakpoint
CREATE INDEX "idx_chat_sender" ON "chat_messages" USING btree ("sender_id");--> statement-breakpoint
CREATE INDEX "idx_chat_receiver" ON "chat_messages" USING btree ("receiver_id");--> statement-breakpoint
CREATE INDEX "idx_chat_created" ON "chat_messages" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_genomic_access_patient" ON "genomic_access_log" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX "idx_genomic_access_occurred" ON "genomic_access_log" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "idx_consent_patient_scope" ON "genomic_consents" USING btree ("patient_id","scope");--> statement-breakpoint
CREATE INDEX "idx_consent_recorded" ON "genomic_consents" USING btree ("recorded_at");--> statement-breakpoint
CREATE INDEX "idx_genomic_profiles_patient" ON "genomic_profiles" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX "idx_genomic_profiles_status" ON "genomic_profiles" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_genomic_variants_profile" ON "genomic_variants" USING btree ("profile_id");--> statement-breakpoint
CREATE INDEX "idx_genomic_variants_rsid" ON "genomic_variants" USING btree ("rsid");--> statement-breakpoint
CREATE INDEX "idx_genomic_variants_profile_rsid" ON "genomic_variants" USING btree ("profile_id","rsid");--> statement-breakpoint
CREATE INDEX "idx_scans_patient" ON "medical_scans" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX "idx_scans_status" ON "medical_scans" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_scans_created" ON "medical_scans" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_scans_type" ON "medical_scans" USING btree ("scan_type");--> statement-breakpoint
CREATE INDEX "idx_scans_radiologist" ON "medical_scans" USING btree ("radiologist_id");--> statement-breakpoint
CREATE INDEX "idx_scans_doctor" ON "medical_scans" USING btree ("doctor_id");--> statement-breakpoint
CREATE INDEX "idx_genomic_risk_patient" ON "genomic_risk_assessments" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX "idx_genomic_risk_condition" ON "genomic_risk_assessments" USING btree ("condition");--> statement-breakpoint
CREATE INDEX "idx_genomic_risk_created" ON "genomic_risk_assessments" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_users_username" ON "users" USING btree ("username");--> statement-breakpoint
CREATE INDEX "idx_users_email" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "idx_users_role" ON "users" USING btree ("role");