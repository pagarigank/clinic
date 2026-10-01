-- Grant SELECT on reference tables to clinic_app
GRANT SELECT ON ref_icd10 TO clinic_app;
GRANT SELECT ON ref_psgc TO clinic_app;
GRANT SELECT ON ref_loinc TO clinic_app;
GRANT SELECT ON ref_drug_schedules TO clinic_app;

-- Seed drug schedule reference data (static PH RA 9165 schedules)
INSERT INTO ref_drug_schedules (code, description) VALUES
  ('S1', 'Schedule 1 – Dangerous Drugs (RA 9165)'),
  ('S2', 'Schedule 2 – Precursor / Essential Chemicals'),
  ('S3', 'Schedule 3 – Regulated Drugs'),
  ('OTC', 'Over-the-Counter'),
  ('Rx', 'Prescription Only'),
  ('LEGEND', 'Legend Drug (requires Rx, non-controlled)')
ON CONFLICT (code) DO NOTHING;

-- Grant access to tenant-config tables
GRANT SELECT, INSERT, UPDATE ON service_catalog TO clinic_app;
GRANT SELECT, INSERT, UPDATE ON price_lists TO clinic_app;
GRANT SELECT, INSERT, UPDATE ON discount_types TO clinic_app;
GRANT SELECT, INSERT, UPDATE ON payment_methods TO clinic_app;
GRANT SELECT, INSERT, UPDATE ON holidays TO clinic_app;
GRANT SELECT, INSERT, UPDATE ON operating_hours TO clinic_app;
GRANT SELECT, INSERT, UPDATE ON service_units TO clinic_app;

-- Grant access to template tables
GRANT SELECT, INSERT, UPDATE ON templates TO clinic_app;
GRANT SELECT, INSERT, UPDATE ON template_versions TO clinic_app;

-- Grant access to patient tables
GRANT SELECT, INSERT, UPDATE ON patients TO clinic_app;
GRANT SELECT, INSERT, UPDATE ON patient_identifiers TO clinic_app;
GRANT SELECT, INSERT, UPDATE ON patient_contacts TO clinic_app;
GRANT SELECT, INSERT, UPDATE ON patient_allergies TO clinic_app;
GRANT SELECT, INSERT, UPDATE ON patient_flags TO clinic_app;
GRANT SELECT, INSERT, UPDATE ON patient_consents TO clinic_app;
GRANT SELECT, INSERT ON patient_merges TO clinic_app;
GRANT SELECT, INSERT, UPDATE ON patient_philhealth TO clinic_app;
GRANT SELECT, INSERT, UPDATE ON patient_philhealth_dependents TO clinic_app;

-- Grant access to files table
GRANT SELECT, INSERT, UPDATE ON files TO clinic_app;
