DROP POLICY IF EXISTS ref_icd10_write ON ref_icd10;
REVOKE INSERT, UPDATE, DELETE ON ref_icd10 FROM clinic_app;
