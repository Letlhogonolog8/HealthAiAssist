-- Structured analysis detail on medical_scans.
--
-- Until this migration a result was persisted as two strings — `ai_confidence`
-- ("74%") and `result` ("Lung Cancer detected - high risk") — and everything
-- the inference service knew about how it reached the number was discarded:
-- the calibrated probability itself, the threshold it was compared to, the
-- temperature that produced it, the out-of-distribution score that let it
-- through, whether calibration was applied, which scanner the image came from
-- and whether the input was a DICOM object or a raster export.
--
-- A clinician weighing a result needs those numbers, and a drift analysis
-- needs them per scanner. They are recorded as numbers, once, at the moment
-- of inference, and never back-filled from the strings.
--
-- Additive and idempotent. Existing rows keep NULLs, which the API reports as
-- "not recorded" rather than as zero.

ALTER TABLE "medical_scans" ADD COLUMN IF NOT EXISTS "calibrated_probability" double precision;
ALTER TABLE "medical_scans" ADD COLUMN IF NOT EXISTS "decision_threshold" double precision;
ALTER TABLE "medical_scans" ADD COLUMN IF NOT EXISTS "calibration_temperature" double precision;
ALTER TABLE "medical_scans" ADD COLUMN IF NOT EXISTS "calibration_applied" boolean;
ALTER TABLE "medical_scans" ADD COLUMN IF NOT EXISTS "ood_score" double precision;
ALTER TABLE "medical_scans" ADD COLUMN IF NOT EXISTS "ood_threshold" double precision;
-- 'passed' | 'failed' | 'rejected' | 'skipped'. Null where no gate ran.
ALTER TABLE "medical_scans" ADD COLUMN IF NOT EXISTS "quality_gate" text;
ALTER TABLE "medical_scans" ADD COLUMN IF NOT EXISTS "acquisition_modality" text;
ALTER TABLE "medical_scans" ADD COLUMN IF NOT EXISTS "acquisition_manufacturer" text;
ALTER TABLE "medical_scans" ADD COLUMN IF NOT EXISTS "acquisition_model" text;
-- 'raster' | 'dicom'. What arrived, as decided from the bytes.
ALTER TABLE "medical_scans" ADD COLUMN IF NOT EXISTS "input_source" text;
-- Evidence class of the model at the time it ran (MODEL_REGISTRY.modelClass).
ALTER TABLE "medical_scans" ADD COLUMN IF NOT EXISTS "model_class" text;
ALTER TABLE "medical_scans" ADD COLUMN IF NOT EXISTS "inference_at" timestamp;
-- True when the stored object is the de-identified DICOM, not the upload.
ALTER TABLE "medical_scans" ADD COLUMN IF NOT EXISTS "stored_deidentified" boolean;

CREATE INDEX IF NOT EXISTS "idx_scans_acquisition_manufacturer"
  ON "medical_scans" ("scan_type", "acquisition_manufacturer");
