-- Add reviewed_at column to medical_scans table
ALTER TABLE medical_scans ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMP;

-- Create index for the new column
CREATE INDEX IF NOT EXISTS idx_scans_reviewed_at ON medical_scans(reviewed_at);
