-- Release the NOT NULL on the legacy `appointments.date` column.
--
-- The live table carries two columns for the same fact: `date` and
-- `appointment_date`. Only `appointment_date` is declared in shared/schema.ts
-- and only `appointment_date` is read anywhere in the codebase, so every insert
-- Drizzle builds omits `date` — and `date` is NOT NULL with no default. Every
-- appointment insert therefore failed with
--
--   null value in column "date" of relation "appointments" violates
--   not-null constraint
--
-- which is why the table holds zero rows: no appointment has ever been booked
-- successfully through any endpoint.
--
-- This drops the constraint rather than the column. Dropping the column would
-- also be safe today (it is empty and unreferenced), but keeping it costs
-- nothing and leaves the decision to remove it as a separate, deliberate step.
--
-- Reverse with:
--   ALTER TABLE appointments ALTER COLUMN date SET NOT NULL;
-- (only possible while the column contains no nulls).

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'appointments'
      AND column_name = 'date'
      AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE appointments ALTER COLUMN date DROP NOT NULL;
    RAISE NOTICE 'appointments.date: NOT NULL dropped';
  ELSE
    RAISE NOTICE 'appointments.date: already nullable or absent, nothing to do';
  END IF;
END $$;
