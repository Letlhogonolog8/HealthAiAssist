-- Study -> series -> instance, for ingested DICOM.
--
-- ── Why these tables are needed ──────────────────────────────────────────
--
-- `medical_scans` holds one row per analysed image: one `image_path`, one
-- result, one model version. That shape is correct for a photograph of a
-- lesion and cannot describe a CT study, which is a few hundred objects that
-- mean nothing individually and everything in order. There is nowhere in the
-- existing schema to record that these 127 objects are one series, what order
-- they go in, or whether the series passed a quality gate.
--
-- ── What is deliberately NOT here ────────────────────────────────────────
--
-- Any clinical finding. Ingestion establishes that a series is readable,
-- ordered and suitable for a pipeline; it establishes nothing about the
-- patient. `ingest_status` describes the file handling and must never be read
-- as a clinical status. A result about a series belongs in `medical_scans`,
-- produced by a model, reviewed by a clinician, with its own governance.
--
-- ── Identity ─────────────────────────────────────────────────────────────
--
-- Every *_uid column holds the REMAPPED UID produced by
-- inference/uid_remap.py, never the source UID. The mapping is a salted HMAC,
-- so these values cannot be resolved back to the originating PACS without the
-- deployment salt, and they are stable across uploads when one is configured
-- — which is what makes the unique constraints below able to recognise a
-- re-ingested series rather than duplicating it.
--
-- Additive and idempotent.

CREATE TABLE IF NOT EXISTS "imaging_studies" (
  "id" serial PRIMARY KEY,
  "patient_id" integer NOT NULL,
  -- Remapped StudyInstanceUID. Unique: the same study re-uploaded under a
  -- configured salt maps here again and is recognised rather than duplicated.
  "study_uid" text NOT NULL,
  -- Study date reduced to the year by de-identification, kept as a string
  -- because that is what the tag carries after reduction.
  "study_year" text,
  "created_at" timestamp DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "imaging_studies"
    ADD CONSTRAINT "imaging_studies_patient_id_users_id_fk"
    FOREIGN KEY ("patient_id") REFERENCES "users"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "idx_imaging_studies_uid" ON "imaging_studies" ("study_uid");
CREATE INDEX IF NOT EXISTS "idx_imaging_studies_patient" ON "imaging_studies" ("patient_id");

CREATE TABLE IF NOT EXISTS "imaging_series" (
  "id" serial PRIMARY KEY,
  "study_id" integer NOT NULL,
  "patient_id" integer NOT NULL,
  -- Remapped SeriesInstanceUID.
  "series_uid" text NOT NULL,
  "modality" text NOT NULL,
  "instance_count" integer NOT NULL,

  -- How the slices were put in order, and whether that order can be trusted.
  -- A series ordered by anything other than ImagePositionPatient, or with a
  -- geometric problem, is recorded as untrusted and must not have a volume
  -- built from it.
  "ordering_method" text NOT NULL,
  "ordering_trusted" boolean NOT NULL,

  -- The gate's verdict and its full structured result, so a rejection can be
  -- explained months later without re-running anything.
  "quality_gate_passed" boolean NOT NULL,
  "quality_gate" text,
  "anatomy_verified" boolean,

  -- Geometry and acquisition, for the downstream pipeline and for drift
  -- analysis by scanner.
  "rows" integer,
  "columns" integer,
  "pixel_spacing_mm" double precision,
  "slice_thickness_mm" double precision,
  "median_spacing_mm" double precision,
  "manufacturer" text,
  "manufacturer_model" text,
  "convolution_kernel" text,
  "body_part" text,

  -- 'deployment' or 'ingestion': how far the UID mapping reaches. An
  -- 'ingestion'-scope series cannot be joined to a later upload of the same
  -- study, and saying so here is cheaper than working it out afterwards.
  "uid_mapping_scope" text NOT NULL,

  -- Object-store prefix the de-identified instances live under.
  "storage_prefix" text,
  "ingested_by" integer,
  -- File handling only. NOT a clinical status.
  "ingest_status" text NOT NULL DEFAULT 'ingested',
  "created_at" timestamp DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "imaging_series"
    ADD CONSTRAINT "imaging_series_study_id_imaging_studies_id_fk"
    FOREIGN KEY ("study_id") REFERENCES "imaging_studies"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "imaging_series"
    ADD CONSTRAINT "imaging_series_patient_id_users_id_fk"
    FOREIGN KEY ("patient_id") REFERENCES "users"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "imaging_series"
    ADD CONSTRAINT "imaging_series_ingested_by_users_id_fk"
    FOREIGN KEY ("ingested_by") REFERENCES "users"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "idx_imaging_series_uid" ON "imaging_series" ("series_uid");
CREATE INDEX IF NOT EXISTS "idx_imaging_series_study" ON "imaging_series" ("study_id");
CREATE INDEX IF NOT EXISTS "idx_imaging_series_patient" ON "imaging_series" ("patient_id");

CREATE TABLE IF NOT EXISTS "imaging_instances" (
  "id" serial PRIMARY KEY,
  "series_id" integer NOT NULL,
  -- Position in anatomical order, 0-based. The order the series is read in,
  -- not the order the files arrived in.
  "position_index" integer NOT NULL,
  -- Remapped SOPInstanceUID.
  "sop_uid" text NOT NULL,
  -- Projection of ImagePositionPatient onto the slice normal, in millimetres.
  "position_mm" double precision,
  -- Where the de-identified object is stored. Never the upload.
  "object_path" text,
  "created_at" timestamp DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "imaging_instances"
    ADD CONSTRAINT "imaging_instances_series_id_imaging_series_id_fk"
    FOREIGN KEY ("series_id") REFERENCES "imaging_series"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "idx_imaging_instances_series_position"
  ON "imaging_instances" ("series_id", "position_index");
CREATE INDEX IF NOT EXISTS "idx_imaging_instances_sop" ON "imaging_instances" ("sop_uid");
