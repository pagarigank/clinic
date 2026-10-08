-- 0061_visit_clinical_memo: Add clinical_memo to visits and clinical_notes tables
ALTER TABLE visits
  ADD COLUMN IF NOT EXISTS clinical_memo TEXT;

ALTER TABLE clinical_notes
  ADD COLUMN IF NOT EXISTS clinical_memo TEXT;
