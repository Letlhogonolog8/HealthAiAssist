-- Care relationships, break-glass access, and erasure requests.
--
-- Additive and idempotent. No DROP, no destructive ALTER.
--
-- Apply with:  npm run db:migrate-care
--
-- requireMedicalAccess admitted any doctor, radiologist or admin to any
-- patient's record. Access was audited afterwards, which POPIA section 19 does
-- not treat as a substitute for minimality at the point of access.
--
-- Most relationships are DERIVED, not stored: a clinician with an appointment
-- booked with a patient, or assigned to one of their scans, has a care
-- relationship by virtue of that work. This table holds only what cannot be
-- derived -- an explicit administrative grant, and break-glass.

CREATE TABLE IF NOT EXISTS "care_relationships" (
  "id"              serial PRIMARY KEY,
  "patient_id"      integer NOT NULL REFERENCES "users"("id"),
  "clinician_id"    integer NOT NULL REFERENCES "users"("id"),
  "basis"           text NOT NULL,
  "justification"   text,
  "established_by"  integer REFERENCES "users"("id"),
  "established_at"  timestamp NOT NULL DEFAULT now(),
  "expires_at"      timestamp,
  "ended_at"        timestamp
);

CREATE INDEX IF NOT EXISTS "idx_care_rel_lookup"
  ON "care_relationships" ("clinician_id", "patient_id");
CREATE INDEX IF NOT EXISTS "idx_care_rel_patient"
  ON "care_relationships" ("patient_id");

-- POPIA section 24 gives a right to request erasure. The National Health Act and
-- HPCSA guidance require clinical records to be kept for at least six years from
-- the last entry. Both are true, and they apply to different categories, so a
-- request is adjudicated per category and the outcome records what was held back
-- and why.
CREATE TABLE IF NOT EXISTS "erasure_requests" (
  "id"             serial PRIMARY KEY,
  "patient_id"     integer NOT NULL REFERENCES "users"("id"),
  "requested_at"   timestamp NOT NULL DEFAULT now(),
  "status"         text NOT NULL DEFAULT 'pending',
  "request_notes"  text DEFAULT '',
  "reviewed_by"    integer REFERENCES "users"("id"),
  "reviewed_at"    timestamp,
  "outcome"        text
);

CREATE INDEX IF NOT EXISTS "idx_erasure_patient" ON "erasure_requests" ("patient_id");
CREATE INDEX IF NOT EXISTS "idx_erasure_status"  ON "erasure_requests" ("status");
