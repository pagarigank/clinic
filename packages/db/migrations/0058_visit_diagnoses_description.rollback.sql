-- 0058_visit_diagnoses_description.rollback.sql
ALTER TABLE visit_diagnoses DROP COLUMN IF EXISTS description;
