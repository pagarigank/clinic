-- 0039_billing_transactions.rollback.sql
DROP TRIGGER IF EXISTS trg_guard_posted_payment_mutation ON payments;
DROP FUNCTION IF EXISTS app.fn_guard_posted_payment_mutation();

ALTER TABLE billing_charges DROP CONSTRAINT IF EXISTS billing_charges_invoice_fk;
ALTER TABLE billing_charges DROP COLUMN IF EXISTS invoice_line_id;
ALTER TABLE billing_charges DROP COLUMN IF EXISTS invoice_id;

DROP TABLE IF EXISTS credit_notes;
DROP TABLE IF EXISTS payment_reprints;
DROP TABLE IF EXISTS payment_allocations;
DROP TABLE IF EXISTS payments;
DROP TABLE IF EXISTS discount_applications;
DROP TABLE IF EXISTS invoice_lines;
DROP TABLE IF EXISTS invoices;
