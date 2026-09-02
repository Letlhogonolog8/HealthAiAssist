-- Skin-tone stratum on each analysed scan, for fairness measurement.
--
-- Additive and idempotent. No DROP, no destructive ALTER.
--
-- Apply with:  npm run db:migrate-skin-tone
--
-- The offline measurement (dataset/data/skin_tone_performance.json) establishes
-- that the test set CANNOT answer how the skin model performs on darker skin:
-- the dark bin holds four images and no benign controls. Only production data
-- can answer it, and only if the stratum is recorded when the scan is analysed.
--
-- One of six Chardon/Del Bino bins, or null. Null is the normal answer for lung
-- scans, for images with too little visible skin to judge, and for scans where
-- no model ran. It is deliberately the coarse bin rather than the continuous
-- angle, and it is not encrypted because stratification is a GROUP BY over it.
-- See the EXCLUDED_FIELDS entry in server/crypto/encrypted-fields.ts and
-- docs/DPIA.md.
ALTER TABLE "medical_scans" ADD COLUMN IF NOT EXISTS "skin_tone_bin" text;

-- The only read: counts and outcomes per bin.
CREATE INDEX IF NOT EXISTS "idx_scans_skin_tone_bin"
  ON "medical_scans" ("skin_tone_bin");
