-- medical_scans.risk_level -> medical_scans.triage_level
--
-- Idempotent, and a rename rather than a drop: no data moves and nothing is
-- lost. Apply with:  npm run db:migrate-triage-level
--
-- The column holds the level the radiologist review queue orders on. It is a
-- threshold applied to one probability — 'high' means the classifier flagged
-- the scan, nothing more. Named "risk_level" it read as a clinical risk
-- stratum, which is a claim no image classifier on this platform can make, and
-- which the interface had already stopped making: every badge goes through
-- client/src/lib/triage.ts and renders "Priority review", not "HIGH RISK".
-- The column name was the last place the old claim survived.
--
-- Audit 2026-09-20, section A5.7.
--
-- Ordering note: drizzle-kit push runs before this in CI and against a fresh
-- database creates triage_level directly, so both guards below are needed —
-- the rename must not fire when there is nothing to rename.

DO $$
BEGIN
  IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name   = 'medical_scans'
          AND column_name  = 'risk_level'
     )
     AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name   = 'medical_scans'
          AND column_name  = 'triage_level'
     )
  THEN
    ALTER TABLE "medical_scans" RENAME COLUMN "risk_level" TO "triage_level";
    RAISE NOTICE 'renamed medical_scans.risk_level to triage_level';
  END IF;
END $$;

-- A database that had neither column (older bootstrap paths) gets it here.
ALTER TABLE "medical_scans"
  ADD COLUMN IF NOT EXISTS "triage_level" text DEFAULT 'low';
