-- 0058_visit_diagnoses_description.migration.sql
-- Record optional clinical diagnosis description / impression alongside ICD-10 code on visit_diagnoses
ALTER TABLE visit_diagnoses ADD COLUMN IF NOT EXISTS description TEXT;

-- Seed common primary care reference codes
INSERT INTO ref_icd10 (code, description)
VALUES
  ('R69', 'Illness, unspecified'),
  ('Z76.0', 'Issue of repeat prescription'),
  ('Z02.1', 'Pre-employment examination')
ON CONFLICT (code) DO NOTHING;
