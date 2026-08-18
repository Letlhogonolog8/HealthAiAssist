-- Consent and audit support for forwarding messages to an external AI processor.
--
-- Additive and idempotent.  Apply with: npm run db:migrate-chatbot-privacy

CREATE TABLE IF NOT EXISTS "processing_consents" (
	"id" serial PRIMARY KEY NOT NULL,
	"patient_id" integer NOT NULL,
	"scope" text NOT NULL,
	"granted" boolean NOT NULL,
	"consent_version" text NOT NULL,
	"recorded_at" timestamp DEFAULT now() NOT NULL,
	"notes" text DEFAULT ''
);

DO $$ BEGIN
	ALTER TABLE "processing_consents" ADD CONSTRAINT "processing_consents_patient_id_users_id_fk"
		FOREIGN KEY ("patient_id") REFERENCES "users"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "idx_processing_consent_patient_scope"
	ON "processing_consents" ("patient_id","scope");
CREATE INDEX IF NOT EXISTS "idx_processing_consent_recorded"
	ON "processing_consents" ("recorded_at");

-- Non-identifying context for audit rows, e.g. which categories a transfer carried.
ALTER TABLE "audit_events" ADD COLUMN IF NOT EXISTS "detail" text;
