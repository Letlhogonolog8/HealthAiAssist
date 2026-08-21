-- Adjudicated outcomes: the missing half of every performance claim.
--
-- Additive and idempotent. No DROP, no destructive ALTER.
--
-- Apply with:  npm run db:migrate-outcomes
--
-- Until this existed the platform could not measure how its models performed on
-- real patients, because nothing recorded what a scan turned out to be. Every
-- endpoint asked for production accuracy correctly returned null; the number was
-- not merely unmeasured but unmeasurable.

-- The model's binary call, as a boolean rather than something inferred from the
-- prose in `result`. Null for scans where no model ran (queued for manual
-- review) and for rows written before this column existed; those are excluded
-- from measurement rather than guessed at.
ALTER TABLE "medical_scans" ADD COLUMN IF NOT EXISTS "predicted_positive" boolean;

-- Append-only, matching genomic_consents and processing_consents. A revised
-- adjudication is a new row; the current answer is the newest row per scan.
CREATE TABLE IF NOT EXISTS "scan_outcomes" (
  "id"          serial PRIMARY KEY,
  "scan_id"     integer NOT NULL,
  "outcome"     text NOT NULL,
  "method"      text NOT NULL,
  "recorded_by" integer NOT NULL,
  "notes"       text DEFAULT '',
  "recorded_at" timestamp NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'scan_outcomes_scan_id_medical_scans_id_fk'
  ) THEN
    ALTER TABLE "scan_outcomes"
      ADD CONSTRAINT "scan_outcomes_scan_id_medical_scans_id_fk"
      FOREIGN KEY ("scan_id") REFERENCES "medical_scans"("id");
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'scan_outcomes_recorded_by_users_id_fk'
  ) THEN
    ALTER TABLE "scan_outcomes"
      ADD CONSTRAINT "scan_outcomes_recorded_by_users_id_fk"
      FOREIGN KEY ("recorded_by") REFERENCES "users"("id");
  END IF;

  -- Enumerations enforced in the database as well as in the application. A
  -- confusion matrix built from a column that can hold any string is a matrix
  -- with an unbounded number of silent buckets.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.constraint_column_usage
    WHERE constraint_name = 'scan_outcomes_outcome_check'
  ) THEN
    ALTER TABLE "scan_outcomes"
      ADD CONSTRAINT "scan_outcomes_outcome_check"
      CHECK ("outcome" IN ('malignant', 'benign', 'indeterminate'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.constraint_column_usage
    WHERE constraint_name = 'scan_outcomes_method_check'
  ) THEN
    ALTER TABLE "scan_outcomes"
      ADD CONSTRAINT "scan_outcomes_method_check"
      CHECK ("method" IN (
        'histopathology', 'biopsy', 'specialist_review',
        'imaging_followup', 'clinical_followup'
      ));
  END IF;
END $$;

-- "The newest outcome for this scan" is the only read on the hot path, and the
-- performance query groups by outcome across the whole table.
CREATE INDEX IF NOT EXISTS "idx_scan_outcomes_scan"
  ON "scan_outcomes" ("scan_id", "recorded_at");
CREATE INDEX IF NOT EXISTS "idx_scan_outcomes_outcome"
  ON "scan_outcomes" ("outcome");

-- Backfill predicted_positive for scans that already carry a model result.
--
-- Deliberately conservative: only rows with a model version (so a model
-- definitely ran) and an unambiguous verdict string are set. Anything else stays
-- null and is excluded from measurement. Guessing here would put fabricated
-- predictions into the very table built to stop fabrication.
UPDATE "medical_scans"
   SET "predicted_positive" = true
 WHERE "predicted_positive" IS NULL
   AND "model_version" IS NOT NULL
   AND ("result" ILIKE '%cancer%detected%' OR "result" ILIKE '%malignan%');

UPDATE "medical_scans"
   SET "predicted_positive" = false
 WHERE "predicted_positive" IS NULL
   AND "model_version" IS NOT NULL
   AND "result" ILIKE 'No abnormal findings%';
