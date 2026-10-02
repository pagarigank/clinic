-- 0038_billing_core.rollback.sql
DROP TABLE IF EXISTS daily_cashier_summaries;
DROP TABLE IF EXISTS cashier_shifts;
ALTER TABLE discount_types DROP COLUMN IF EXISTS fixed_amount;
ALTER TABLE discount_types DROP COLUMN IF EXISTS legal_basis;
ALTER TABLE discount_types DROP COLUMN IF EXISTS requires_id;
ALTER TABLE discount_types DROP COLUMN IF EXISTS code;
