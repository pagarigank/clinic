-- 0047_lab_specimen_stability.rollback.sql
ALTER TABLE lab_specimen_types DROP COLUMN IF EXISTS stability_hours;
