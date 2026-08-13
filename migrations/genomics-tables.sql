-- Genomics tables: consent, profiles, variants, risk assessments, access log.
--
-- NOTE ON NAMING: the target database already contains an unrelated
-- `risk_assessments` table belonging to a different application (it has columns
-- like keystroke_risk_score and session_id). Ours is therefore named
-- `genomic_risk_assessments`. Do not "simplify" it back.
--
-- Written as an idempotent additive migration rather than using the generated
-- baseline, because this database predates any migration history and the
-- generated 0000 file would try to CREATE TABLE over the existing schema.
--
-- Purely additive: no DROP, no ALTER of existing tables.
--
-- Apply with:  npm run db:migrate-genomics

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

CREATE TABLE IF NOT EXISTS "genomic_variants" (
	"id" serial PRIMARY KEY NOT NULL,
	"profile_id" integer NOT NULL,
	"rsid" text NOT NULL,
	"chromosome" text,
	"position" integer,
	"genotype" text NOT NULL
);

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

-- Foreign keys. Guarded so re-running is safe.
DO $$ BEGIN
	ALTER TABLE "genomic_consents" ADD CONSTRAINT "genomic_consents_patient_id_users_id_fk"
		FOREIGN KEY ("patient_id") REFERENCES "users"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
	ALTER TABLE "genomic_consents" ADD CONSTRAINT "genomic_consents_recorded_by_user_id_users_id_fk"
		FOREIGN KEY ("recorded_by_user_id") REFERENCES "users"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
	ALTER TABLE "genomic_profiles" ADD CONSTRAINT "genomic_profiles_patient_id_users_id_fk"
		FOREIGN KEY ("patient_id") REFERENCES "users"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
	ALTER TABLE "genomic_variants" ADD CONSTRAINT "genomic_variants_profile_id_genomic_profiles_id_fk"
		FOREIGN KEY ("profile_id") REFERENCES "genomic_profiles"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
	ALTER TABLE "genomic_risk_assessments" ADD CONSTRAINT "genomic_risk_assessments_patient_id_users_id_fk"
		FOREIGN KEY ("patient_id") REFERENCES "users"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
	ALTER TABLE "genomic_risk_assessments" ADD CONSTRAINT "genomic_risk_assessments_profile_id_genomic_profiles_id_fk"
		FOREIGN KEY ("profile_id") REFERENCES "genomic_profiles"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
	ALTER TABLE "genomic_risk_assessments" ADD CONSTRAINT "genomic_risk_assessments_scan_id_medical_scans_id_fk"
		FOREIGN KEY ("scan_id") REFERENCES "medical_scans"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
	ALTER TABLE "genomic_risk_assessments" ADD CONSTRAINT "genomic_risk_assessments_reviewed_by_user_id_users_id_fk"
		FOREIGN KEY ("reviewed_by_user_id") REFERENCES "users"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
	ALTER TABLE "genomic_access_log" ADD CONSTRAINT "genomic_access_log_patient_id_users_id_fk"
		FOREIGN KEY ("patient_id") REFERENCES "users"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
	ALTER TABLE "genomic_access_log" ADD CONSTRAINT "genomic_access_log_accessed_by_user_id_users_id_fk"
		FOREIGN KEY ("accessed_by_user_id") REFERENCES "users"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "idx_consent_patient_scope" ON "genomic_consents" ("patient_id","scope");
CREATE INDEX IF NOT EXISTS "idx_consent_recorded" ON "genomic_consents" ("recorded_at");
CREATE INDEX IF NOT EXISTS "idx_genomic_profiles_patient" ON "genomic_profiles" ("patient_id");
CREATE INDEX IF NOT EXISTS "idx_genomic_profiles_status" ON "genomic_profiles" ("status");
CREATE INDEX IF NOT EXISTS "idx_genomic_variants_profile" ON "genomic_variants" ("profile_id");
CREATE INDEX IF NOT EXISTS "idx_genomic_variants_rsid" ON "genomic_variants" ("rsid");
CREATE INDEX IF NOT EXISTS "idx_genomic_variants_profile_rsid" ON "genomic_variants" ("profile_id","rsid");
CREATE INDEX IF NOT EXISTS "idx_genomic_risk_patient" ON "genomic_risk_assessments" ("patient_id");
CREATE INDEX IF NOT EXISTS "idx_genomic_risk_condition" ON "genomic_risk_assessments" ("condition");
CREATE INDEX IF NOT EXISTS "idx_genomic_risk_created" ON "genomic_risk_assessments" ("created_at");
CREATE INDEX IF NOT EXISTS "idx_genomic_access_patient" ON "genomic_access_log" ("patient_id");
CREATE INDEX IF NOT EXISTS "idx_genomic_access_occurred" ON "genomic_access_log" ("occurred_at");
