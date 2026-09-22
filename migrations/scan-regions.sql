-- Regions on a scan: where somebody, or something, pointed.
--
-- Route 1 of the lung nodule characteriser is "a clinician marks the nodule".
-- That mark is a clinical act and part of the result — the probability is
-- about THAT region — so it is recorded with the scan, in pixel space and,
-- where the acquisition carried spacing, in millimetres.
--
-- `source` says who made the region. Today it is always 'clinician'. A
-- detector (roadmap P2) will write 'detector' rows with a score, and a
-- segmenter (P3) 'segmenter' rows with a mask path; `reviewer_disposition`
-- is where the clinician's accept / reject of a proposed region is recorded,
-- which is the training-quality signal a detector will later be measured by.
--
-- Additive and idempotent.

CREATE TABLE IF NOT EXISTS "scan_regions" (
  "id" serial PRIMARY KEY,
  "scan_id" integer NOT NULL,
  -- 'clinician' | 'detector' | 'segmenter'
  "source" text NOT NULL,
  -- 'point' | 'box' | 'mask'
  "geometry" text NOT NULL DEFAULT 'point',
  -- Centre in pixels of the rendered frame (column, row).
  "cx" double precision,
  "cy" double precision,
  "size_px" integer,
  "frame_rows" integer,
  "frame_columns" integer,
  -- From the acquisition, when it carried PixelSpacing.
  "spacing_row_mm" double precision,
  "spacing_col_mm" double precision,
  "size_mm" double precision,
  -- Detector confidence, for 'detector' rows only.
  "detector_score" double precision,
  -- Object-store path of a mask, for 'segmenter' rows only.
  "mask_path" text,
  -- 'accepted' | 'rejected' | null, set by a reviewer on a proposed region.
  "reviewer_disposition" text,
  "created_by" integer,
  "created_at" timestamp DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "scan_regions"
    ADD CONSTRAINT "scan_regions_scan_id_medical_scans_id_fk"
    FOREIGN KEY ("scan_id") REFERENCES "medical_scans"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "scan_regions"
    ADD CONSTRAINT "scan_regions_created_by_users_id_fk"
    FOREIGN KEY ("created_by") REFERENCES "users"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "idx_scan_regions_scan" ON "scan_regions" ("scan_id");
