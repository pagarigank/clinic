-- 0065_renal_hbv_and_dialyzer_days.migration.sql
-- Phase 7A gap fixes: add HBsAg flag to prescriptions, add max_reuse_days to dialyzers

SET ROLE clinic_owner;

ALTER TABLE dialysis_prescriptions
  ADD COLUMN IF NOT EXISTS hbv_hbsag_positive boolean NOT NULL DEFAULT false;

ALTER TABLE dialyzers
  ADD COLUMN IF NOT EXISTS max_reuse_days int NOT NULL DEFAULT 10;

RESET ROLE;
