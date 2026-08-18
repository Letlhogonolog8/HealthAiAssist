-- Traceability: pin the model that produced each result, and give the general
-- audit log somewhere to actually live.
--
-- Additive and idempotent. No DROP, no destructive ALTER.
--
-- Apply with:  npm run db:migrate-traceability

-- Which model produced a stored result. Null for rows written before this
-- existed, and for scans queued for manual review where no model ran.
ALTER TABLE "medical_scans" ADD COLUMN IF NOT EXISTS "model_version" text;

-- `auditLog()` wrote to console.log only, so twelve sensitive endpoints -
-- staff creation and deletion, password resets, user deletion - produced no
-- retained record at all.
CREATE TABLE IF NOT EXISTS "audit_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"action" text NOT NULL,
	"actor_user_id" integer,
	"actor_username" text,
	"actor_role" text,
	"method" text,
	"path" text,
	"status_code" integer,
	"ip_address" text,
	"occurred_at" timestamp DEFAULT now() NOT NULL
);

DO $$ BEGIN
	ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_user_id_users_id_fk"
		FOREIGN KEY ("actor_user_id") REFERENCES "users"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "idx_audit_events_action" ON "audit_events" ("action");
CREATE INDEX IF NOT EXISTS "idx_audit_events_actor" ON "audit_events" ("actor_user_id");
CREATE INDEX IF NOT EXISTS "idx_audit_events_occurred" ON "audit_events" ("occurred_at");
