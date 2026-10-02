-- 0042_receipt_artifacts.rollback.sql
--
-- Drops the JOB-50 receipt document pointers. The generated receipt bytes
-- themselves are left in `files`: they are the patient's copy of an issued
-- financial document, so they are removed only by tenant offboarding purge
-- (JOB-05), never by a schema rollback.
--
-- Note: reverting this restores JOB-50 to its JSON-only behaviour, so any
-- `payment_reprints` rows keep their file_id/sha256_hash (0041) but the
-- original payment receipts lose their pointer.

ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_receipt_digest_format;
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_receipt_thermal_digest_format;
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_receipt_thermal_file_fkey;
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_receipt_file_fkey;

DROP INDEX IF EXISTS idx_payments_receipt_pending;
DROP INDEX IF EXISTS idx_payment_reprints_pending;

ALTER TABLE payments DROP COLUMN IF EXISTS receipt_generated_at;
ALTER TABLE payments DROP COLUMN IF EXISTS receipt_thermal_sha256;
ALTER TABLE payments DROP COLUMN IF EXISTS receipt_thermal_file_id;
ALTER TABLE payments DROP COLUMN IF EXISTS receipt_sha256;
ALTER TABLE payments DROP COLUMN IF EXISTS receipt_file_id;
