-- The geometry a CT series needs to become a coordinate system.
--
-- P1b persisted enough to file a series and read it back: ordering, spacing,
-- a quality-gate verdict. It did not persist enough to say where in the
-- patient any particular voxel is, and the P2 audit found three specific
-- gaps:
--
--   * `pixel_spacing_mm` held one scalar. DICOM PixelSpacing is two values —
--     the step between rows and the step between columns — and they differ on
--     plenty of real acquisitions. A single value cannot place a pixel on an
--     anisotropic one, and which of the two it held was not recorded either.
--
--   * ImageOrientationPatient was not persisted at all. Without the two
--     direction cosines there is no image plane, so a pixel index maps to
--     nothing.
--
--   * `imaging_instances.position_mm` held the scalar projection onto the
--     slice normal — enough to order slices, not enough to locate one. The
--     full ImagePositionPatient 3-vector is the slice's origin in the patient.
--
-- Together those meant a detection candidate could be produced but not
-- anchored: the numbers would exist and would point nowhere. Everything added
-- here is read from the DICOM objects at ingest and written once.
--
-- Also recorded is the polarity decision. Ordering by projection onto the
-- slice normal is anatomical but directionless — the normal is a cross
-- product, so its sign follows how the acquisition described itself, and the
-- identical anatomy orders either way. inference/series.py now orients the
-- normal towards the patient's head and says whether that required reversing
-- the raw order. A volume built on the other convention is a superior-
-- inferior mirror of the patient in which every slice is individually valid,
-- so the decision is stored rather than recomputed and assumed.
--
-- Additive and idempotent. Existing rows keep NULLs, which the API reports as
-- not recorded rather than as zero, and no existing column is changed or
-- dropped: `pixel_spacing_mm` stays exactly as it was.

-- ── imaging_series ────────────────────────────────────────────────────────

-- The two direction cosines, as a JSON array of six numbers, following the
-- `quality_gate` precedent in this table. Six separate columns would buy
-- nothing: nothing queries an individual cosine, and the six are meaningless
-- apart.
ALTER TABLE "imaging_series" ADD COLUMN IF NOT EXISTS "image_orientation_patient" text;

-- DICOM PixelSpacing, split so neither can be mistaken for the other. The
-- first DICOM value is the spacing between rows — the vertical step, which
-- belongs to the column cosine.
ALTER TABLE "imaging_series" ADD COLUMN IF NOT EXISTS "pixel_spacing_row_mm" double precision;
ALTER TABLE "imaging_series" ADD COLUMN IF NOT EXISTS "pixel_spacing_col_mm" double precision;

-- 'feet_to_head' | 'indeterminate'. The anatomical direction of increasing
-- slice index. 'indeterminate' is a coronal or sagittal acquisition, where
-- the through-plane axis is not superior-inferior at all; such a series can
-- still be ordered and stored, and a volume must refuse it.
ALTER TABLE "imaging_series" ADD COLUMN IF NOT EXISTS "slice_polarity" text;

-- Whether the raw projection order ran head-to-feet and was reversed to meet
-- the convention. Kept so the decision is inspectable after the fact rather
-- than inferred from the data it was applied to.
ALTER TABLE "imaging_series" ADD COLUMN IF NOT EXISTS "slice_polarity_normalised" boolean;

-- The unit slice normal actually used, after any reversal, as a JSON array of
-- three numbers. Derivable from the orientation, but only if the reader knows
-- which polarity rule was in force when the series was ingested — so it is
-- recorded, not recomputed.
ALTER TABLE "imaging_series" ADD COLUMN IF NOT EXISTS "slice_normal" text;

-- ── imaging_instances ─────────────────────────────────────────────────────

-- ImagePositionPatient: the patient-space position of this slice's first
-- voxel, in LPS millimetres. Three columns rather than a JSON array because
-- these are read per slice in a loop when a frame is built, and because a
-- future spatial query would want them separable.
ALTER TABLE "imaging_instances" ADD COLUMN IF NOT EXISTS "ipp_x" double precision;
ALTER TABLE "imaging_instances" ADD COLUMN IF NOT EXISTS "ipp_y" double precision;
ALTER TABLE "imaging_instances" ADD COLUMN IF NOT EXISTS "ipp_z" double precision;
