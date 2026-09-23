-- Detection runs and the candidates they propose.
--
-- ── Why a run is a row ────────────────────────────────────────────────────
--
-- The important property is that these three outcomes stay distinguishable:
--
--     complete, candidate_count = 0   the volume was searched and nothing
--                                     scored above the threshold
--     refused                         the study was not searched, because it
--                                     was out of distribution, failed the
--                                     gate, or had no model
--     failed                          something broke
--
-- Without a run row there is nowhere to record which of those happened, and
-- all three collapse into "no candidates", so an infrastructure failure reads
-- as a normal negative result. That is the failure this platform exists to
-- prevent, and it is why the run is persisted before the candidates rather
-- than derived from them.
--
-- ── What is deliberately not here ─────────────────────────────────────────
--
-- No malignancy column, no risk column, no priority column, no clinical
-- conclusion of any kind. A candidate is a location and a score, and the score
-- answers "would a radiologist have marked something here" — the only question
-- the LIDC annotations support. Characterisation is a separate model with its
-- own fingerprint, reached only after a clinician has reviewed a candidate.
--
-- Additive and idempotent, following the convention of every migration here.
-- No existing table or column is altered.

-- ── detection_runs ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "detection_runs" (
  "id" serial PRIMARY KEY,
  "series_id" integer NOT NULL,
  -- Denormalised from imaging_series for the same reason that table does it:
  -- an isolation check should not need a join to be correct.
  "patient_id" integer NOT NULL,

  -- 'queued' | 'running' | 'complete' | 'refused' | 'failed'.
  "status" text NOT NULL DEFAULT 'queued',
  -- Why a run refused or failed. Null on a complete run. This is what keeps
  -- 'refused' from being readable as 'nothing found'.
  "failure_code" text,
  "failure_detail" text,

  -- Null until the run completes. A NULL count is not zero: zero means
  -- searched and clear of the threshold, NULL means never got there.
  "candidate_count" integer,

  -- Provenance. Every one of these is needed to say what produced a result,
  -- and a result whose model or transform cannot be identified is not
  -- reproducible.
  "detector_version" text,
  "detector_fingerprint" text,
  "preprocessing_version" text,
  "preprocessing_fingerprint" text,
  "detection_config_fingerprint" text,
  "lung_mask_version" text,

  -- Out-of-distribution screening, per run. 'passed' | 'refused' |
  -- 'unavailable'. 'unavailable' is honest: no detector OOD reference exists
  -- yet, and recording that is better than recording a pass nobody measured.
  "ood_status" text,
  "ood_score" double precision,
  "ood_threshold" double precision,

  -- Calibration, per run. 'applied' | 'unavailable'. No detector calibration
  -- artifact exists yet either.
  "calibration_status" text,
  "calibration_version" text,
  "calibration_fingerprint" text,

  -- The volume actually searched, for reproducibility.
  "volume_slices" integer,
  "volume_rows" integer,
  "volume_columns" integer,
  "slice_spacing_mm" double precision,
  "slice_polarity" text,

  "requested_by" integer,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "started_at" timestamp,
  "completed_at" timestamp
);

DO $$ BEGIN
  ALTER TABLE "detection_runs"
    ADD CONSTRAINT "detection_runs_series_id_imaging_series_id_fk"
    FOREIGN KEY ("series_id") REFERENCES "imaging_series"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "detection_runs"
    ADD CONSTRAINT "detection_runs_patient_id_users_id_fk"
    FOREIGN KEY ("patient_id") REFERENCES "users"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "detection_runs"
    ADD CONSTRAINT "detection_runs_requested_by_users_id_fk"
    FOREIGN KEY ("requested_by") REFERENCES "users"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "idx_detection_runs_series" ON "detection_runs" ("series_id");
CREATE INDEX IF NOT EXISTS "idx_detection_runs_patient" ON "detection_runs" ("patient_id");
CREATE INDEX IF NOT EXISTS "idx_detection_runs_status" ON "detection_runs" ("status");

-- One run in flight per series. A second request while one is queued or
-- running is a conflict to report, not a second search to start: two
-- concurrent runs would write two candidate sets for one series and neither
-- would be identifiable as the current one.
CREATE UNIQUE INDEX IF NOT EXISTS "idx_detection_runs_one_in_flight"
  ON "detection_runs" ("series_id")
  WHERE "status" IN ('queued', 'running');

-- ── detection_candidates ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "detection_candidates" (
  "id" serial PRIMARY KEY,
  "run_id" integer NOT NULL,
  "series_id" integer NOT NULL,
  "patient_id" integer NOT NULL,

  -- Both coordinate systems. Voxel indices are reproducible against the
  -- volume that was searched; patient millimetres survive a rebuild and are
  -- what a viewer and the characteriser need. Storing only one loses
  -- something either way.
  "voxel_i" double precision NOT NULL,
  "voxel_j" double precision NOT NULL,
  "voxel_k" integer NOT NULL,
  "x_mm" double precision NOT NULL,
  "y_mm" double precision NOT NULL,
  "z_mm" double precision NOT NULL,
  -- Always 'dicom_patient_lps'. Stored rather than assumed, because a
  -- coordinate whose frame is implied is a coordinate somebody will
  -- eventually read in the wrong one.
  "coordinate_system" text NOT NULL DEFAULT 'dicom_patient_lps',

  -- The ordered slice a reviewer opens. Not always equal to voxel_k: a
  -- resampled volume sits on a different grid from the source series.
  "position_index" integer NOT NULL,

  -- What the detector said, and what calibration made of it. score_calibrated
  -- is NULL while no calibration artifact exists — never a copy of the raw
  -- score, which would present an uncalibrated number as a probability.
  "score_raw" double precision NOT NULL,
  "score_calibrated" double precision,
  -- How many raw proposals were suppressed into this one.
  "merged_from" integer NOT NULL DEFAULT 1,

  -- Clinician review. 'accepted' | 'rejected' | 'uncertain' |
  -- 'missed_candidate_added'. NULL means not yet reviewed, which is not the
  -- same as rejected.
  "review_disposition" text,
  "review_note" text,
  "reviewed_by" integer,
  "reviewed_at" timestamp,

  "created_at" timestamp DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "detection_candidates"
    ADD CONSTRAINT "detection_candidates_run_id_detection_runs_id_fk"
    FOREIGN KEY ("run_id") REFERENCES "detection_runs"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "detection_candidates"
    ADD CONSTRAINT "detection_candidates_series_id_imaging_series_id_fk"
    FOREIGN KEY ("series_id") REFERENCES "imaging_series"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "detection_candidates"
    ADD CONSTRAINT "detection_candidates_patient_id_users_id_fk"
    FOREIGN KEY ("patient_id") REFERENCES "users"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "detection_candidates"
    ADD CONSTRAINT "detection_candidates_reviewed_by_users_id_fk"
    FOREIGN KEY ("reviewed_by") REFERENCES "users"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "idx_detection_candidates_run" ON "detection_candidates" ("run_id");
CREATE INDEX IF NOT EXISTS "idx_detection_candidates_series" ON "detection_candidates" ("series_id");
CREATE INDEX IF NOT EXISTS "idx_detection_candidates_patient" ON "detection_candidates" ("patient_id");
CREATE INDEX IF NOT EXISTS "idx_detection_candidates_review"
  ON "detection_candidates" ("review_disposition");
