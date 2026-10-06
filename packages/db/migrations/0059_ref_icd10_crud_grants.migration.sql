-- Grant INSERT, UPDATE, DELETE on ref_icd10 to clinic_app
GRANT INSERT, UPDATE, DELETE ON ref_icd10 TO clinic_app;

-- RLS write policy for ref_icd10
DROP POLICY IF EXISTS ref_icd10_write ON ref_icd10;
CREATE POLICY ref_icd10_write ON ref_icd10 FOR ALL USING (true) WITH CHECK (true);
