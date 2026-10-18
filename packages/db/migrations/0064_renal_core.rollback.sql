-- 0064_renal_core.rollback.sql

SET ROLE clinic_owner;

DROP TABLE IF EXISTS philhealth_dialysis_claims CASCADE;
DROP TABLE IF EXISTS session_post_assessments CASCADE;
DROP TABLE IF EXISTS session_flowsheets CASCADE;
DROP TABLE IF EXISTS session_pre_assessments CASCADE;
DROP TABLE IF EXISTS dialysis_sessions CASCADE;
DROP TABLE IF EXISTS water_lab_tests CASCADE;
DROP TABLE IF EXISTS water_treatment_logs CASCADE;
DROP TABLE IF EXISTS dialyzer_reprocessings CASCADE;
DROP TABLE IF EXISTS dialyzers CASCADE;
DROP TABLE IF EXISTS dialysis_schedules CASCADE;
DROP TABLE IF EXISTS dialysis_shifts CASCADE;
DROP TABLE IF EXISTS dialysis_prescriptions CASCADE;
DROP TABLE IF EXISTS access_assessments CASCADE;
DROP TABLE IF EXISTS vascular_accesses CASCADE;
DROP TABLE IF EXISTS dialysis_machines CASCADE;
DROP TABLE IF EXISTS renal_stations CASCADE;

ALTER TABLE stock_locations DROP CONSTRAINT IF EXISTS stock_locations_type_check;
ALTER TABLE stock_locations ADD CONSTRAINT stock_locations_type_check CHECK (type IN
  ('CENTRAL_STORE','PHARMACY','CLINIC_ROOM','LAB','QUARANTINE','WASTE','IN_TRANSIT'));

RESET ROLE;

DELETE FROM tenant_modules WHERE module = 'renal';
DELETE FROM permissions WHERE code LIKE 'renal.%' OR code LIKE 'reports.renal.%';
DELETE FROM report_definitions WHERE module = 'renal';

ALTER TABLE tenant_modules DROP CONSTRAINT IF EXISTS tenant_modules_module_check;
ALTER TABLE tenant_modules ADD CONSTRAINT tenant_modules_module_check CHECK (module IN
  ('admin','patients','clinical','supply','laboratory','pharmacy',
   'billing','compliance','notifications','reports'));
