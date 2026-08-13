-- Supabase exposure lockdown. Apply immediately after the schema, before any
-- real data is loaded.
--
-- WHY THIS IS NOT OPTIONAL
--
-- Supabase automatically exposes every table in the `public` schema through
-- PostgREST. The anon key is a PUBLIC credential — it is designed to be shipped
-- to browsers, and it is in this repository's .env. On a table with no row level
-- security, that key grants SELECT/INSERT/UPDATE/DELETE to anyone who has it.
--
-- Concretely, without this file: `curl <SUPABASE_URL>/rest/v1/genomic_variants
-- -H "apikey: <anon key>"` returns every patient's genome.
--
-- This app does not use PostgREST at all. It connects over Postgres via
-- DATABASE_URL as the `postgres` role, which bypasses RLS. So enabling RLS with
-- no permissive policies blocks the public API completely while leaving the
-- application fully functional.
--
-- If you later add browser-direct Supabase access, add narrowly scoped policies
-- per table. Do not disable RLS to make something work.

ALTER TABLE "users"                     ENABLE ROW LEVEL SECURITY;
ALTER TABLE "medical_scans"             ENABLE ROW LEVEL SECURITY;
ALTER TABLE "medical_terms"             ENABLE ROW LEVEL SECURITY;
ALTER TABLE "appointments"              ENABLE ROW LEVEL SECURITY;
ALTER TABLE "chat_messages"             ENABLE ROW LEVEL SECURITY;
ALTER TABLE "genomic_consents"          ENABLE ROW LEVEL SECURITY;
ALTER TABLE "genomic_profiles"          ENABLE ROW LEVEL SECURITY;
ALTER TABLE "genomic_variants"          ENABLE ROW LEVEL SECURITY;
ALTER TABLE "genomic_risk_assessments"  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "genomic_access_log"        ENABLE ROW LEVEL SECURITY;

-- Force RLS even for the table owner, so a mistakenly-owned connection does not
-- silently bypass it. The `postgres` superuser still bypasses, which is what the
-- application relies on.
ALTER TABLE "users"                     FORCE ROW LEVEL SECURITY;
ALTER TABLE "medical_scans"             FORCE ROW LEVEL SECURITY;
ALTER TABLE "appointments"              FORCE ROW LEVEL SECURITY;
ALTER TABLE "chat_messages"             FORCE ROW LEVEL SECURITY;
ALTER TABLE "genomic_consents"          FORCE ROW LEVEL SECURITY;
ALTER TABLE "genomic_profiles"          FORCE ROW LEVEL SECURITY;
ALTER TABLE "genomic_variants"          FORCE ROW LEVEL SECURITY;
ALTER TABLE "genomic_risk_assessments"  FORCE ROW LEVEL SECURITY;
ALTER TABLE "genomic_access_log"        FORCE ROW LEVEL SECURITY;

-- Defence in depth: even with RLS on, remove the table grants PostgREST's roles
-- rely on, so a future accidental permissive policy is not sufficient on its own.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM authenticated;

-- And for tables created later.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM authenticated;
