-- 0065_renal_hbv_and_dialyzer_days.rollback.sql

SET ROLE clinic_owner;

ALTER TABLE dialysis_prescriptions
  DROP COLUMN IF EXISTS hbv_hbsag_positive;

ALTER TABLE dialyzers
  DROP COLUMN IF EXISTS max_reuse_days;

RESET ROLE;
