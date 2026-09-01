-- Adverse event reporting: the channel by which harm reaches the people who
-- could fix it.
--
-- Additive and idempotent. No DROP, no destructive ALTER.
--
-- Apply with:  npm run db:migrate-adverse-events
--
-- `scan_outcomes` measures whether the model was right. This records whether
-- anyone was hurt, which the confusion matrix cannot see: a model can be
-- correct and still contribute to harm through a review that arrived too late,
-- and wrong on a scan that hurt nobody because a radiologist caught it. A
-- device that cannot be told it caused harm cannot be shown to be safe.

CREATE TABLE IF NOT EXISTS "adverse_events" (
  "id"                          serial PRIMARY KEY,

  -- Nullable and deliberately WITHOUT a foreign key.
  --
  -- Erasure deletes medical_scans once the six-year clinical retention hold
  -- expires, and a safety record that vanishes with the record it concerns
  -- cannot support the trend analysis it exists for. server/erasure.ts nulls
  -- these and redacts the narrative instead, on the same reasoning that retains
  -- audit_events under POPIA section 19 accountability.
  "scan_id"                     integer,
  "patient_id"                  integer,

  "reported_by"                 integer,
  "reporter_role"               text,

  -- Constrained vocabularies, enforced in the application rather than by a
  -- CHECK, so that adding a category is a code change with a migration behind
  -- it rather than a silent divergence. See ADVERSE_EVENT_CATEGORIES.
  "category"                    text NOT NULL,
  "severity"                    text NOT NULL,

  -- Encrypted at the application layer (server/crypto/encrypted-fields.ts):
  -- clinical narrative about an identifiable person, read whole, never matched.
  "description"                 text NOT NULL,

  -- When it happened, which is not when it was noticed.
  "occurred_at"                 timestamp,
  "reported_at"                 timestamp NOT NULL DEFAULT now(),

  "status"                      text NOT NULL DEFAULT 'open',

  "reviewed_by"                 integer,
  "reviewed_at"                 timestamp,
  "review_notes"                text,

  -- What the model said, copied at report time.
  --
  -- Denormalised on purpose: the scan row is mutable and erasable, so by the
  -- time anyone analyses a cluster of these the prediction that provoked them
  -- may be gone or changed. A safety record has to hold its own evidence.
  "model_version_at_event"      text,
  "predicted_positive_at_event" boolean
);

-- reported_by and reviewed_by DO carry foreign keys: unlike the patient, the
-- reporting account is never erased, only tombstoned, so the reference stays
-- resolvable and attribution survives.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'adverse_events_reported_by_users_id_fk'
  ) THEN
    ALTER TABLE "adverse_events"
      ADD CONSTRAINT "adverse_events_reported_by_users_id_fk"
      FOREIGN KEY ("reported_by") REFERENCES "users"("id");
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'adverse_events_reviewed_by_users_id_fk'
  ) THEN
    ALTER TABLE "adverse_events"
      ADD CONSTRAINT "adverse_events_reviewed_by_users_id_fk"
      FOREIGN KEY ("reviewed_by") REFERENCES "users"("id");
  END IF;
END $$;

-- "what is still open, newest first" is the only read on the hot path.
CREATE INDEX IF NOT EXISTS "idx_adverse_events_status"
  ON "adverse_events" ("status", "reported_at");
CREATE INDEX IF NOT EXISTS "idx_adverse_events_severity"
  ON "adverse_events" ("severity");
CREATE INDEX IF NOT EXISTS "idx_adverse_events_scan"
  ON "adverse_events" ("scan_id");
CREATE INDEX IF NOT EXISTS "idx_adverse_events_reported"
  ON "adverse_events" ("reported_at");
