-- 0061_visit_clinical_memo rollback
ALTER TABLE visits
  DROP COLUMN IF EXISTS clinical_memo;

ALTER TABLE clinical_notes
  DROP COLUMN IF EXISTS clinical_memo;
