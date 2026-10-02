-- 0041_generated_artifacts.rollback.sql
ALTER TABLE lab_reports
    DROP CONSTRAINT IF EXISTS lab_reports_file_id_fkey;

-- Only succeeds while every report still has a digest; a report left unrendered
-- by JOB-43 is exactly the case this rollback cannot reverse automatically.
ALTER TABLE lab_reports
    ALTER COLUMN sha256_hash SET NOT NULL;

ALTER TABLE lab_reports
    ADD CONSTRAINT lab_reports_file_id_fkey
    FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE SET NULL;

ALTER TABLE payment_reprints
    DROP CONSTRAINT IF EXISTS payment_reprints_file_id_fkey;

ALTER TABLE payment_reprints
    DROP COLUMN IF EXISTS sha256_hash;
ALTER TABLE payment_reprints
    DROP COLUMN IF EXISTS file_id;

ALTER TABLE medical_certificates
    DROP CONSTRAINT IF EXISTS medical_certificates_file_id_fkey;

ALTER TABLE medical_certificates
    DROP COLUMN IF EXISTS sha256_hash;

ALTER TABLE files
    DROP CONSTRAINT IF EXISTS files_generated_artifact_integrity;
ALTER TABLE files
    DROP CONSTRAINT IF EXISTS files_sha256_format;

-- Drop the origin/sha256/content columns before the CHECK on origin is gone:
-- the columns must go together or the integrity CHECK loses its inputs.
ALTER TABLE files
    DROP COLUMN IF EXISTS origin;
ALTER TABLE files
    DROP COLUMN IF EXISTS sha256;
ALTER TABLE files
    DROP COLUMN IF EXISTS content;

ALTER TABLE files
    DROP CONSTRAINT IF EXISTS files_tenant_id_id_key;
