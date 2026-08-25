-- Second factor for accounts that can read patient records.
--
-- Additive and idempotent. No DROP, no destructive ALTER.
--
-- Apply with:  npm run db:migrate-mfa
--
-- TOTP generation and verification already existed in server/advanced-security.ts,
-- using speakeasy, with qrcode already a dependency. No route enrolled anyone
-- and no route challenged anyone, so every account that can read any patient's
-- record -- doctor, radiologist, admin -- was protected by a password alone.
--
-- mfa_secret is a bearer credential and is encrypted at rest by the application
-- (server/crypto/encrypted-fields.ts), so this column holds an AES-GCM envelope
-- rather than a base32 seed on any deployment with a keyring configured.

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "mfa_enabled" boolean NOT NULL DEFAULT false;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "mfa_secret" text;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "mfa_backup_codes" text;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "mfa_enrolled_at" timestamp;

-- Finding accounts in a privileged role that have not yet enrolled is the query
-- an administrator runs during a rollout, and it is the one this index serves.
CREATE INDEX IF NOT EXISTS "idx_users_mfa_enabled" ON "users" ("role", "mfa_enabled");
