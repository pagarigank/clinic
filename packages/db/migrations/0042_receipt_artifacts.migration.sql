-- 0042_receipt_artifacts.migration.sql
-- Phase 7 / JOB-50 (todo.md 7.1, 7.2; specification 11, 14).
--
-- An official receipt is a generated document, so it follows the same storage
-- contract as lab reports (0041): the exact rendered bytes live in
-- files.content, files.sha256 is the digest of those bytes, and the payment
-- points at the document it was issued against.
--
-- Two documents are produced per payment:
--   receipt_file_id / receipt_sha256            - the A4 PDF the patient keeps
--   receipt_thermal_file_id / receipt_thermal_sha256 - the ESC/POS twin for the
--                                                  80mm thermal printer
-- Both are nullable: a payment exists before JOB-50 has run, and receipt_sha256
-- is assigned by the renderer, never by the payment-capture path. That mirrors
-- lab_reports.sha256_hash, where release leaves the digest NULL.

-- 1. Receipt document pointers on payments
ALTER TABLE payments ADD COLUMN IF NOT EXISTS receipt_file_id UUID;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS receipt_sha256 TEXT;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS receipt_thermal_file_id UUID;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS receipt_thermal_sha256 TEXT;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS receipt_generated_at TIMESTAMPTZ;

-- 2. Composite tenant FKs: a receipt may only ever point at a file in its own
--    tenant, and files are never hard-deleted out from under an issued receipt.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'payments_receipt_file_fkey'
  ) THEN
    ALTER TABLE payments ADD CONSTRAINT payments_receipt_file_fkey
      FOREIGN KEY (tenant_id, receipt_file_id)
      REFERENCES files(tenant_id, id) ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'payments_receipt_thermal_file_fkey'
  ) THEN
    ALTER TABLE payments ADD CONSTRAINT payments_receipt_thermal_file_fkey
      FOREIGN KEY (tenant_id, receipt_thermal_file_id)
      REFERENCES files(tenant_id, id) ON DELETE RESTRICT;
  END IF;
END $$;

-- 3. A receipt digest must be a real document hash when it is present. The
--    renderer assigns it, so it can never be a placeholder over JSON.
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_receipt_digest_format;
ALTER TABLE payments ADD CONSTRAINT payments_receipt_digest_format CHECK (
  (receipt_file_id IS NULL AND receipt_sha256 IS NULL)
  OR (receipt_sha256 ~ '^[0-9a-f]{64}$')
);

ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_receipt_thermal_digest_format;
ALTER TABLE payments ADD CONSTRAINT payments_receipt_thermal_digest_format CHECK (
  (receipt_thermal_file_id IS NULL AND receipt_thermal_sha256 IS NULL)
  OR (receipt_thermal_sha256 ~ '^[0-9a-f]{64}$')
);

-- 4. JOB-50 claims work by scanning for POSTED payments with no receipt yet.
--    Without this the job is a sequential scan of every payment ever taken.
CREATE INDEX IF NOT EXISTS idx_payments_receipt_pending
  ON payments (tenant_id, received_at)
  WHERE status = 'POSTED' AND receipt_file_id IS NULL;

-- 5. Reprints are already append-only and already carry file_id/sha256_hash
--    (0041); index the ones still awaiting a document.
CREATE INDEX IF NOT EXISTS idx_payment_reprints_pending
  ON payment_reprints (tenant_id, payment_id)
  WHERE file_id IS NULL;
