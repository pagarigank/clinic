-- 0064_renal_core.migration.sql
-- Phase 7A — Renal Care Module (specification §13A, §19.10–19.12; architecture §7.5, ADR-12)

GRANT REFERENCES ON patients, visits, branches TO clinic_owner;

SET ROLE clinic_owner;

-- 1. Extend tenant_modules to allow 'renal'
ALTER TABLE tenant_modules DROP CONSTRAINT IF EXISTS tenant_modules_module_check;
ALTER TABLE tenant_modules ADD CONSTRAINT tenant_modules_module_check CHECK (module IN
  ('admin','patients','clinical','supply','laboratory','pharmacy',
   'billing','compliance','notifications','reports','renal'));

-- 2. Extend stock_locations.type to include 'DIALYSIS_UNIT' (architecture §8.1)
ALTER TABLE stock_locations DROP CONSTRAINT IF EXISTS stock_locations_type_check;
ALTER TABLE stock_locations ADD CONSTRAINT stock_locations_type_check CHECK (type IN
  ('CENTRAL_STORE','PHARMACY','CLINIC_ROOM','LAB','QUARANTINE','WASTE','IN_TRANSIT','DIALYSIS_UNIT'));

-- 3. Renal stations
CREATE TABLE renal_stations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  branch_id     uuid NOT NULL,
  station_no    text NOT NULL,
  name          text NOT NULL,
  room          text,
  is_isolation  boolean NOT NULL DEFAULT false,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT renal_stations_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT renal_stations_station_no_uniq UNIQUE (tenant_id, branch_id, station_no),
  CONSTRAINT renal_stations_branch_fkey FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id)
);

-- 4. Dialysis machines
CREATE TABLE dialysis_machines (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL REFERENCES tenants(id),
  branch_id             uuid NOT NULL,
  station_id            uuid,
  serial_no             text NOT NULL,
  brand                 text NOT NULL,
  model                 text NOT NULL,
  total_operating_hours numeric(10,2) NOT NULL DEFAULT 0,
  last_disinfected_at   timestamptz,
  last_serviced_at      timestamptz,
  status                text NOT NULL DEFAULT 'ACTIVE'
                        CHECK (status IN ('ACTIVE', 'MAINTENANCE', 'QUARANTINE', 'DECOMMISSIONED')),
  is_isolation          boolean NOT NULL DEFAULT false,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dialysis_machines_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT dialysis_machines_serial_no_uniq UNIQUE (tenant_id, serial_no),
  CONSTRAINT dialysis_machines_branch_fkey FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id),
  CONSTRAINT dialysis_machines_station_fkey FOREIGN KEY (tenant_id, station_id) REFERENCES renal_stations(tenant_id, id)
);

-- 5. Vascular accesses
CREATE TABLE vascular_accesses (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  patient_id      uuid NOT NULL,
  access_type     text NOT NULL
                  CHECK (access_type IN ('AV_FISTULA', 'AV_GRAFT', 'TUNNELED_CATHETER', 'TEMPORARY_CATHETER')),
  anatomical_site text NOT NULL,
  side            text NOT NULL CHECK (side IN ('LEFT', 'RIGHT')),
  created_date    date,
  surgeon_name    text,
  status          text NOT NULL DEFAULT 'MATURING'
                  CHECK (status IN ('MATURING', 'ACTIVE', 'FAILED', 'ABANDONED')),
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vascular_accesses_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT vascular_accesses_patient_fkey FOREIGN KEY (tenant_id, patient_id) REFERENCES patients(tenant_id, id)
);

-- 6. Access assessments
CREATE TABLE access_assessments (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                 uuid NOT NULL REFERENCES tenants(id),
  access_id                 uuid NOT NULL,
  assessed_at               timestamptz NOT NULL DEFAULT now(),
  assessed_by               uuid NOT NULL,
  thrill_present            boolean NOT NULL,
  bruit_present             boolean NOT NULL,
  signs_of_infection        boolean NOT NULL DEFAULT false,
  cannulation_complication  text,
  intervention_notes        text,
  created_at                timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT access_assessments_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT access_assessments_access_fkey FOREIGN KEY (tenant_id, access_id) REFERENCES vascular_accesses(tenant_id, id)
);

-- 7. Dialysis prescriptions
CREATE TABLE dialysis_prescriptions (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                   uuid NOT NULL REFERENCES tenants(id),
  patient_id                  uuid NOT NULL,
  nephrologist_id             uuid NOT NULL,
  effective_from              date NOT NULL DEFAULT CURRENT_DATE,
  effective_to                date,
  modality                    text NOT NULL DEFAULT 'HD' CHECK (modality IN ('HD', 'HDF')),
  frequency_per_week          int NOT NULL DEFAULT 3,
  duration_minutes            int NOT NULL DEFAULT 240,
  target_dry_weight_kg        numeric(5,2) NOT NULL,
  dialyzer_model              text NOT NULL,
  dialysate_formula           text NOT NULL DEFAULT 'STANDARD',
  potassium_meq               numeric(4,2),
  calcium_meq                 numeric(4,2),
  sodium_meq                  numeric(5,2),
  bicarbonate_meq             numeric(4,2),
  blood_flow_rate_target      int NOT NULL DEFAULT 300,
  dialysate_flow_rate_target  int NOT NULL DEFAULT 500,
  heparin_bolus_units         int,
  heparin_hourly_units        int,
  is_heparin_free             boolean NOT NULL DEFAULT false,
  status                      text NOT NULL DEFAULT 'DRAFT'
                              CHECK (status IN ('DRAFT', 'ACTIVE', 'SUPERSEDED', 'CANCELLED')),
  signed_at                   timestamptz,
  signed_by                   uuid,
  notes                       text,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dialysis_prescriptions_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT dialysis_prescriptions_patient_fkey FOREIGN KEY (tenant_id, patient_id) REFERENCES patients(tenant_id, id)
);

-- 8. Dialysis shifts
CREATE TABLE dialysis_shifts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  branch_id   uuid NOT NULL,
  shift_name  text NOT NULL,
  start_time  time NOT NULL,
  end_time    time NOT NULL,
  days_of_week int[] NOT NULL DEFAULT '{1,2,3,4,5,6}',
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dialysis_shifts_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT dialysis_shifts_branch_fkey FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id)
);

-- 9. Dialysis schedules (chair / shift roster)
CREATE TABLE dialysis_schedules (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  patient_id      uuid NOT NULL,
  branch_id       uuid NOT NULL,
  station_id      uuid NOT NULL,
  shift_id        uuid NOT NULL,
  day_of_week     int NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  effective_from  date NOT NULL DEFAULT CURRENT_DATE,
  effective_to    date,
  status          text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'SUSPENDED', 'CANCELLED')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dialysis_schedules_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT dialysis_schedules_patient_fkey FOREIGN KEY (tenant_id, patient_id) REFERENCES patients(tenant_id, id),
  CONSTRAINT dialysis_schedules_branch_fkey FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id),
  CONSTRAINT dialysis_schedules_station_fkey FOREIGN KEY (tenant_id, station_id) REFERENCES renal_stations(tenant_id, id),
  CONSTRAINT dialysis_schedules_shift_fkey FOREIGN KEY (tenant_id, shift_id) REFERENCES dialysis_shifts(tenant_id, id)
);

-- 10. Dialyzers (ADR-12 / R-REN-01: strict single-patient binding)
CREATE TABLE dialyzers (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES tenants(id),
  patient_id          uuid NOT NULL,
  serial_barcode      text NOT NULL,
  dialyzer_model      text NOT NULL,
  baseline_volume_ml  numeric(6,1) NOT NULL,
  current_volume_ml   numeric(6,1) NOT NULL,
  reuse_count         int NOT NULL DEFAULT 0,
  max_allowed_reuses  int NOT NULL DEFAULT 10,
  status              text NOT NULL DEFAULT 'CLEANED_READY'
                      CHECK (status IN ('IN_USE', 'PENDING_REPROCESS', 'CLEANED_READY', 'DISCARDED')),
  first_used_date     date,
  discard_reason      text,
  discarded_at        timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dialyzers_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT dialyzers_tenant_patient_key UNIQUE (tenant_id, id, patient_id),
  CONSTRAINT dialyzers_barcode_uniq UNIQUE (tenant_id, serial_barcode),
  CONSTRAINT dialyzers_patient_fkey FOREIGN KEY (tenant_id, patient_id) REFERENCES patients(tenant_id, id)
);

-- 11. Dialyzer reprocessings
CREATE TABLE dialyzer_reprocessings (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                   uuid NOT NULL REFERENCES tenants(id),
  dialyzer_id                 uuid NOT NULL,
  reprocessed_at              timestamptz NOT NULL DEFAULT now(),
  technician_id               uuid NOT NULL,
  pre_clean_ok                boolean NOT NULL DEFAULT true,
  measured_volume_ml          numeric(6,1) NOT NULL,
  bundle_volume_pct           numeric(5,2) NOT NULL,
  pressure_leak_test_passed   boolean NOT NULL,
  disinfectant_agent          text NOT NULL,
  disinfectant_concentration_ok boolean NOT NULL DEFAULT true,
  residual_test_prior_use     boolean,
  witness_id                  uuid,
  notes                       text,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dialyzer_reprocessings_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT dialyzer_reprocessings_dialyzer_fkey FOREIGN KEY (tenant_id, dialyzer_id) REFERENCES dialyzers(tenant_id, id)
);

-- 12. Water treatment logs (Pre-shift safety gate)
CREATE TABLE water_treatment_logs (
  id                              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                       uuid NOT NULL REFERENCES tenants(id),
  branch_id                       uuid NOT NULL,
  log_date                        date NOT NULL DEFAULT CURRENT_DATE,
  shift_id                        uuid,
  tested_by                       uuid NOT NULL,
  pre_filter_pressure_in          numeric(6,2),
  pre_filter_pressure_out         numeric(6,2),
  softener_hardness_ppm           numeric(6,2),
  carbon_breakthrough_chlorine_ppm numeric(5,3) NOT NULL CHECK (carbon_breakthrough_chlorine_ppm >= 0),
  ro_conductivity_us              numeric(6,2) NOT NULL,
  ro_rejection_rate_pct           numeric(5,2) NOT NULL,
  product_flow_lpm                numeric(5,2),
  reject_flow_lpm                 numeric(5,2),
  chemical_disinfection_done      boolean NOT NULL DEFAULT false,
  status                          text NOT NULL DEFAULT 'NORMAL'
                                  CHECK (status IN ('NORMAL', 'ALERT', 'ACTION_REQUIRED')),
  notes                           text,
  created_at                      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT water_treatment_logs_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT water_treatment_logs_branch_fkey FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id),
  CONSTRAINT water_treatment_logs_shift_fkey FOREIGN KEY (tenant_id, shift_id) REFERENCES dialysis_shifts(tenant_id, id)
);

-- 13. Water lab tests (Endotoxin & Bacteriological surveillance)
CREATE TABLE water_lab_tests (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  branch_id     uuid NOT NULL,
  sample_date   date NOT NULL DEFAULT CURRENT_DATE,
  sample_point  text NOT NULL CHECK (sample_point IN ('RO_WATER', 'LOOP_RETURN', 'DIALYSIS_STATION')),
  test_type     text NOT NULL CHECK (test_type IN ('ENDOTOXIN', 'BACTERIAL_CULTURE')),
  result_value  numeric(8,4) NOT NULL,
  uom           text NOT NULL CHECK (uom IN ('EU/mL', 'CFU/mL')),
  is_compliant  boolean NOT NULL,
  lab_order_id  uuid,
  verified_by   uuid NOT NULL,
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT water_lab_tests_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT water_lab_tests_branch_fkey FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id)
);

-- 14. Dialysis sessions
CREATE TABLE dialysis_sessions (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                 uuid NOT NULL REFERENCES tenants(id),
  session_no                text NOT NULL,
  patient_id                uuid NOT NULL,
  visit_id                  uuid,
  branch_id                 uuid NOT NULL,
  station_id                uuid NOT NULL,
  machine_id                uuid NOT NULL,
  prescription_id           uuid NOT NULL,
  access_id                 uuid,
  dialyzer_id               uuid NOT NULL,
  scheduled_date            date NOT NULL DEFAULT CURRENT_DATE,
  shift_id                  uuid NOT NULL,
  status                    text NOT NULL DEFAULT 'SCHEDULED'
                            CHECK (status IN ('SCHEDULED', 'PRE_DIALYSIS', 'IN_PROGRESS', 'POST_DIALYSIS', 'COMPLETED', 'CANCELLED', 'INTERRUPTED')),
  started_at                timestamptz,
  completed_at              timestamptz,
  primary_nurse_id          uuid NOT NULL,
  attending_nephrologist_id uuid,
  cancellation_reason       text,
  actual_duration_minutes   int,
  total_uf_removed_liters   numeric(5,2),
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dialysis_sessions_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT dialysis_sessions_session_no_uniq UNIQUE (tenant_id, session_no),
  CONSTRAINT dialysis_sessions_patient_fkey FOREIGN KEY (tenant_id, patient_id) REFERENCES patients(tenant_id, id),
  CONSTRAINT dialysis_sessions_visit_fkey FOREIGN KEY (tenant_id, visit_id) REFERENCES visits(tenant_id, id),
  CONSTRAINT dialysis_sessions_branch_fkey FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id),
  CONSTRAINT dialysis_sessions_station_fkey FOREIGN KEY (tenant_id, station_id) REFERENCES renal_stations(tenant_id, id),
  CONSTRAINT dialysis_sessions_machine_fkey FOREIGN KEY (tenant_id, machine_id) REFERENCES dialysis_machines(tenant_id, id),
  CONSTRAINT dialysis_sessions_prescription_fkey FOREIGN KEY (tenant_id, prescription_id) REFERENCES dialysis_prescriptions(tenant_id, id),
  CONSTRAINT dialysis_sessions_access_fkey FOREIGN KEY (tenant_id, access_id) REFERENCES vascular_accesses(tenant_id, id),
  CONSTRAINT dialysis_sessions_dialyzer_fkey FOREIGN KEY (tenant_id, dialyzer_id, patient_id) REFERENCES dialyzers(tenant_id, id, patient_id),
  CONSTRAINT dialysis_sessions_shift_fkey FOREIGN KEY (tenant_id, shift_id) REFERENCES dialysis_shifts(tenant_id, id)
);

-- 15. Session pre-assessments
CREATE TABLE session_pre_assessments (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL REFERENCES tenants(id),
  session_id            uuid NOT NULL,
  pre_weight_kg         numeric(5,2) NOT NULL,
  standing_bp_systolic  int,
  standing_bp_diastolic int,
  sitting_bp_systolic   int NOT NULL,
  sitting_bp_diastolic  int NOT NULL,
  pulse                 int NOT NULL,
  temp                  numeric(4,1) NOT NULL,
  resp_rate             int,
  dry_weight_kg         numeric(5,2) NOT NULL,
  fluid_gain_kg         numeric(5,2) NOT NULL,
  target_uf_liters      numeric(5,2) NOT NULL,
  edema_grade           text CHECK (edema_grade IN ('NONE', '1+', '2+', '3+', '4+')),
  access_checked        boolean NOT NULL DEFAULT true,
  nurse_sign_id         uuid NOT NULL,
  notes                 text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT session_pre_assessments_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT session_pre_assessments_session_uniq UNIQUE (tenant_id, session_id),
  CONSTRAINT session_pre_assessments_session_fkey FOREIGN KEY (tenant_id, session_id) REFERENCES dialysis_sessions(tenant_id, id) ON DELETE CASCADE
);

-- 16. Session flowsheets
CREATE TABLE session_flowsheets (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL REFERENCES tenants(id),
  session_id            uuid NOT NULL,
  recorded_at           timestamptz NOT NULL DEFAULT now(),
  elapsed_minutes       int NOT NULL,
  bp_systolic           int NOT NULL,
  bp_diastolic          int NOT NULL,
  pulse                 int NOT NULL,
  blood_flow_rate       int NOT NULL,
  dialysate_flow_rate   int NOT NULL,
  arterial_pressure     int,
  venous_pressure       int,
  tmp                   int,
  uf_rate               numeric(5,2),
  cum_uf_volume_liters  numeric(5,2) NOT NULL,
  heparin_administered  int,
  symptoms              text,
  interventions         text,
  recorded_by           uuid NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT session_flowsheets_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT session_flowsheets_session_fkey FOREIGN KEY (tenant_id, session_id) REFERENCES dialysis_sessions(tenant_id, id) ON DELETE CASCADE
);

-- 17. Session post-assessments
CREATE TABLE session_post_assessments (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                 uuid NOT NULL REFERENCES tenants(id),
  session_id                uuid NOT NULL,
  post_weight_kg            numeric(5,2) NOT NULL,
  standing_bp_systolic      int,
  standing_bp_diastolic     int,
  sitting_bp_systolic       int NOT NULL,
  sitting_bp_diastolic      int NOT NULL,
  pulse                     int NOT NULL,
  temp                      numeric(4,1) NOT NULL,
  actual_uf_removed_liters  numeric(5,2) NOT NULL,
  total_heparin_given       int,
  access_bruit_thrill       boolean NOT NULL DEFAULT true,
  hemostasis_minutes        int NOT NULL,
  condition_at_discharge    text NOT NULL DEFAULT 'STABLE',
  post_nurse_notes          text,
  signed_by                 uuid NOT NULL,
  created_at                timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT session_post_assessments_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT session_post_assessments_session_uniq UNIQUE (tenant_id, session_id),
  CONSTRAINT session_post_assessments_session_fkey FOREIGN KEY (tenant_id, session_id) REFERENCES dialysis_sessions(tenant_id, id) ON DELETE CASCADE
);

-- 18. PhilHealth dialysis claims
CREATE TABLE philhealth_dialysis_claims (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL REFERENCES tenants(id),
  session_id            uuid NOT NULL,
  patient_id            uuid NOT NULL,
  claim_no              text NOT NULL,
  calendar_year         int NOT NULL,
  session_sequence_no   int NOT NULL CHECK (session_sequence_no >= 1),
  benefit_package_code  text NOT NULL DEFAULT 'HD01',
  claim_amount          numeric(12,2) NOT NULL DEFAULT 2600.00,
  copay_amount          numeric(12,2) NOT NULL DEFAULT 0.00,
  eclaims_status        text NOT NULL DEFAULT 'DRAFT'
                        CHECK (eclaims_status IN ('DRAFT', 'READY', 'TRANSMITTED', 'PAID', 'DENIED')),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT philhealth_claims_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT philhealth_claims_claim_no_uniq UNIQUE (tenant_id, claim_no),
  CONSTRAINT philhealth_claims_session_uniq UNIQUE (tenant_id, session_id),
  CONSTRAINT philhealth_claims_patient_year_seq_uniq UNIQUE (tenant_id, patient_id, calendar_year, session_sequence_no),
  CONSTRAINT philhealth_claims_session_fkey FOREIGN KEY (tenant_id, session_id) REFERENCES dialysis_sessions(tenant_id, id),
  CONSTRAINT philhealth_claims_patient_fkey FOREIGN KEY (tenant_id, patient_id) REFERENCES patients(tenant_id, id)
);

-- 19. Apply tenant isolation (RLS enable, force, and policy)
SELECT app.apply_tenant_isolation('renal_stations');
SELECT app.apply_tenant_isolation('dialysis_machines');
SELECT app.apply_tenant_isolation('vascular_accesses');
SELECT app.apply_tenant_isolation('access_assessments');
SELECT app.apply_tenant_isolation('dialysis_prescriptions');
SELECT app.apply_tenant_isolation('dialysis_shifts');
SELECT app.apply_tenant_isolation('dialysis_schedules');
SELECT app.apply_tenant_isolation('dialyzers');
SELECT app.apply_tenant_isolation('dialyzer_reprocessings');
SELECT app.apply_tenant_isolation('water_treatment_logs');
SELECT app.apply_tenant_isolation('water_lab_tests');
SELECT app.apply_tenant_isolation('dialysis_sessions');
SELECT app.apply_tenant_isolation('session_pre_assessments');
SELECT app.apply_tenant_isolation('session_flowsheets');
SELECT app.apply_tenant_isolation('session_post_assessments');
SELECT app.apply_tenant_isolation('philhealth_dialysis_claims');

-- 20. Tenant indexes for performance and ground rule 1 compliance
CREATE INDEX renal_stations_tenant_idx ON renal_stations (tenant_id);
CREATE INDEX renal_stations_branch_idx ON renal_stations (tenant_id, branch_id);
CREATE INDEX dialysis_machines_tenant_idx ON dialysis_machines (tenant_id);
CREATE INDEX dialysis_machines_branch_idx ON dialysis_machines (tenant_id, branch_id);
CREATE INDEX vascular_accesses_tenant_idx ON vascular_accesses (tenant_id);
CREATE INDEX vascular_accesses_patient_idx ON vascular_accesses (tenant_id, patient_id);
CREATE INDEX access_assessments_tenant_idx ON access_assessments (tenant_id);
CREATE INDEX access_assessments_access_idx ON access_assessments (tenant_id, access_id);
CREATE INDEX dialysis_prescriptions_tenant_idx ON dialysis_prescriptions (tenant_id);
CREATE INDEX dialysis_prescriptions_patient_idx ON dialysis_prescriptions (tenant_id, patient_id);
CREATE INDEX dialysis_shifts_tenant_idx ON dialysis_shifts (tenant_id);
CREATE INDEX dialysis_shifts_branch_idx ON dialysis_shifts (tenant_id, branch_id);
CREATE INDEX dialysis_schedules_tenant_idx ON dialysis_schedules (tenant_id);
CREATE INDEX dialysis_schedules_patient_idx ON dialysis_schedules (tenant_id, patient_id);
CREATE INDEX dialyzers_tenant_idx ON dialyzers (tenant_id);
CREATE INDEX dialyzers_patient_idx ON dialyzers (tenant_id, patient_id);
CREATE INDEX dialyzer_reprocessings_tenant_idx ON dialyzer_reprocessings (tenant_id);
CREATE INDEX dialyzer_reprocessings_dialyzer_idx ON dialyzer_reprocessings (tenant_id, dialyzer_id);
CREATE INDEX water_treatment_logs_tenant_idx ON water_treatment_logs (tenant_id);
CREATE INDEX water_treatment_logs_branch_date_idx ON water_treatment_logs (tenant_id, branch_id, log_date);
CREATE INDEX water_lab_tests_tenant_idx ON water_lab_tests (tenant_id);
CREATE INDEX water_lab_tests_branch_date_idx ON water_lab_tests (tenant_id, branch_id, sample_date);
CREATE INDEX dialysis_sessions_tenant_idx ON dialysis_sessions (tenant_id);
CREATE INDEX dialysis_sessions_patient_idx ON dialysis_sessions (tenant_id, patient_id);
CREATE INDEX dialysis_sessions_scheduled_idx ON dialysis_sessions (tenant_id, scheduled_date);
CREATE INDEX session_pre_assessments_tenant_idx ON session_pre_assessments (tenant_id);
CREATE INDEX session_pre_assessments_session_idx ON session_pre_assessments (tenant_id, session_id);
CREATE INDEX session_flowsheets_tenant_idx ON session_flowsheets (tenant_id);
CREATE INDEX session_flowsheets_session_idx ON session_flowsheets (tenant_id, session_id);
CREATE INDEX session_post_assessments_tenant_idx ON session_post_assessments (tenant_id);
CREATE INDEX session_post_assessments_session_idx ON session_post_assessments (tenant_id, session_id);
CREATE INDEX philhealth_claims_tenant_idx ON philhealth_dialysis_claims (tenant_id);
CREATE INDEX philhealth_claims_patient_year_idx ON philhealth_dialysis_claims (tenant_id, patient_id, calendar_year);

-- 21. Explicit runtime grants
GRANT SELECT, INSERT, UPDATE, DELETE ON
  renal_stations, dialysis_machines, vascular_accesses, access_assessments,
  dialysis_prescriptions, dialysis_shifts, dialysis_schedules, dialyzers,
  dialyzer_reprocessings, water_treatment_logs, water_lab_tests,
  dialysis_sessions, session_pre_assessments, session_flowsheets,
  session_post_assessments, philhealth_dialysis_claims
TO clinic_app;

GRANT SELECT ON
  renal_stations, dialysis_machines, vascular_accesses, access_assessments,
  dialysis_prescriptions, dialysis_shifts, dialysis_schedules, dialyzers,
  dialyzer_reprocessings, water_treatment_logs, water_lab_tests,
  dialysis_sessions, session_pre_assessments, session_flowsheets,
  session_post_assessments, philhealth_dialysis_claims
TO clinic_report;

RESET ROLE;

-- 22. Seed canonical permissions catalogue for renal module (specification §2.3, §13A, §18.11)
INSERT INTO permissions (code, description) VALUES
  ('renal.station.read', 'View renal stations'),
  ('renal.station.create', 'Create renal stations'),
  ('renal.station.update', 'Update renal stations'),
  ('renal.station.delete', 'Delete/archive renal stations'),
  ('renal.station.archive', 'Archive renal stations'),
  ('renal.machine.read', 'View dialysis machines'),
  ('renal.machine.create', 'Register dialysis machines'),
  ('renal.machine.update', 'Update dialysis machines'),
  ('renal.machine.service', 'Log machine service and disinfection'),
  ('renal.schedule.read', 'View dialysis schedules'),
  ('renal.schedule.create', 'Create dialysis schedule assignments'),
  ('renal.schedule.update', 'Update dialysis schedule assignments'),
  ('renal.schedule.cancel', 'Cancel dialysis schedule assignments'),
  ('renal.access.read', 'View vascular access records'),
  ('renal.access.create', 'Create vascular access and assessments'),
  ('renal.access.update', 'Update vascular access records'),
  ('renal.access.intervene', 'Record vascular access intervention'),
  ('renal.access.archive', 'Archive vascular access records'),
  ('renal.prescription.read', 'View dialysis prescriptions'),
  ('renal.prescription.create', 'Draft dialysis prescriptions'),
  ('renal.prescription.update', 'Update draft dialysis prescriptions'),
  ('renal.prescription.sign', 'Sign and activate dialysis prescriptions'),
  ('renal.prescription.amend', 'Amend dialysis prescriptions'),
  ('renal.prescription.cancel', 'Cancel dialysis prescriptions'),
  ('renal.session.read', 'View dialysis sessions worklist'),
  ('renal.session.create', 'Schedule dialysis sessions'),
  ('renal.session.start', 'Initiate pre-dialysis intake'),
  ('renal.session.record', 'Record intra-dialytic flowsheet vitals'),
  ('renal.session.complete', 'Complete post-dialysis evaluation and close'),
  ('renal.session.sign', 'Sign off completed dialysis sessions'),
  ('renal.session.cancel', 'Cancel dialysis sessions'),
  ('renal.dialyzer.read', 'View dialyzers'),
  ('renal.dialyzer.create', 'Register new dialyzers'),
  ('renal.dialyzer.inspect', 'Inspect dialyzer integrity and baseline'),
  ('renal.dialyzer.reprocess', 'Record dialyzer reprocessing'),
  ('renal.dialyzer.discard', 'Discard dialyzers'),
  ('renal.water.read', 'View water treatment and surveillance logs'),
  ('renal.water.create', 'Record water treatment and lab tests'),
  ('renal.water.record', 'Record pre-shift water treatment surveillance'),
  ('renal.water.verify', 'Verify water treatment surveillance'),
  ('renal.water.alert', 'Manage water safety alerts'),
  ('renal.claim.read', 'View PhilHealth dialysis benefit usage'),
  ('renal.claim.create', 'Generate PhilHealth dialysis claims'),
  ('renal.claim.submit', 'Submit PhilHealth dialysis claims'),
  ('reports.renal.view', 'View renal care reports'),
  ('reports.renal.export', 'Export renal care reports')
ON CONFLICT (code) DO UPDATE SET description = EXCLUDED.description;

-- 23. Seed roles and role permissions for demo tenants
DO $$
DECLARE
  v_tenant_id uuid;
  v_admin_role_id uuid;
  v_doctor_role_id uuid;
  v_nurse_role_id uuid;
  v_neph_role_id uuid;
  v_dnurse_role_id uuid;
  v_dtech_role_id uuid;
BEGIN
  FOR v_tenant_id IN SELECT id FROM tenants WHERE id IN ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222')
  LOOP
    -- Ensure system roles exist
    INSERT INTO roles (tenant_id, code, name, is_system)
    VALUES
      (v_tenant_id, 'nephrologist', 'Nephrologist', true),
      (v_tenant_id, 'dialysis_nurse', 'Dialysis Nurse', true),
      (v_tenant_id, 'dialysis_tech', 'Dialysis Technician', true)
    ON CONFLICT (tenant_id, code) DO NOTHING;

    SELECT id INTO v_admin_role_id FROM roles WHERE tenant_id = v_tenant_id AND code = 'tenant_admin';
    SELECT id INTO v_doctor_role_id FROM roles WHERE tenant_id = v_tenant_id AND code = 'doctor';
    SELECT id INTO v_nurse_role_id FROM roles WHERE tenant_id = v_tenant_id AND code = 'nurse';
    SELECT id INTO v_neph_role_id FROM roles WHERE tenant_id = v_tenant_id AND code = 'nephrologist';
    SELECT id INTO v_dnurse_role_id FROM roles WHERE tenant_id = v_tenant_id AND code = 'dialysis_nurse';
    SELECT id INTO v_dtech_role_id FROM roles WHERE tenant_id = v_tenant_id AND code = 'dialysis_tech';

    -- Grant renal permissions to tenant_admin
    IF v_admin_role_id IS NOT NULL THEN
      INSERT INTO role_permissions (tenant_id, role_id, permission_id)
      SELECT v_tenant_id, v_admin_role_id, p.id
      FROM permissions p
      WHERE p.code LIKE 'renal.%' OR p.code LIKE 'reports.renal.%'
      ON CONFLICT (tenant_id, role_id, permission_id) DO NOTHING;
    END IF;

    -- Grant to doctor
    IF v_doctor_role_id IS NOT NULL THEN
      INSERT INTO role_permissions (tenant_id, role_id, permission_id)
      SELECT v_tenant_id, v_doctor_role_id, p.id
      FROM permissions p
      WHERE p.code IN (
        'renal.station.read', 'renal.machine.read', 'renal.schedule.read',
        'renal.access.read', 'renal.access.create', 'renal.access.update',
        'renal.prescription.read', 'renal.prescription.create', 'renal.prescription.update',
        'renal.prescription.sign', 'renal.prescription.amend', 'renal.prescription.cancel',
        'renal.session.read', 'renal.session.create', 'renal.session.start',
        'renal.session.record', 'renal.session.complete', 'renal.session.cancel',
        'renal.dialyzer.read', 'renal.water.read', 'renal.claim.read', 'reports.renal.view'
      )
      ON CONFLICT (tenant_id, role_id, permission_id) DO NOTHING;
    END IF;

    -- Grant to nephrologist
    IF v_neph_role_id IS NOT NULL THEN
      INSERT INTO role_permissions (tenant_id, role_id, permission_id)
      SELECT v_tenant_id, v_neph_role_id, p.id
      FROM permissions p
      WHERE p.code IN (
        'patient.record.read', 'patient.record.update', 'clinical.schedule.read', 'clinical.appointment.read',
        'clinical.queue.read', 'clinical.visit.read', 'clinical.vitals.read', 'clinical.note.read',
        'clinical.note.create', 'clinical.note.update', 'clinical.note.sign', 'clinical.diagnosis.read',
        'clinical.diagnosis.create', 'clinical.rx.read', 'clinical.rx.create', 'clinical.rx.sign',
        'lab.order.read', 'lab.order.create', 'lab.result.read', 'lab.report.read', 'reference.read',
        'files.read', 'files.write', 'notifications.read',
        'renal.station.read', 'renal.machine.read', 'renal.schedule.read',
        'renal.access.read', 'renal.access.create', 'renal.access.update',
        'renal.prescription.read', 'renal.prescription.create', 'renal.prescription.update',
        'renal.prescription.sign', 'renal.prescription.amend', 'renal.prescription.cancel',
        'renal.session.read', 'renal.session.create', 'renal.session.start',
        'renal.session.record', 'renal.session.complete', 'renal.session.cancel',
        'renal.dialyzer.read', 'renal.water.read', 'renal.claim.read', 'reports.renal.view'
      )
      ON CONFLICT (tenant_id, role_id, permission_id) DO NOTHING;
    END IF;

    -- Grant to nurse & dialysis_nurse
    IF v_dnurse_role_id IS NOT NULL THEN
      INSERT INTO role_permissions (tenant_id, role_id, permission_id)
      SELECT v_tenant_id, v_dnurse_role_id, p.id
      FROM permissions p
      WHERE p.code IN (
        'patient.record.read', 'clinical.schedule.read', 'clinical.appointment.read', 'clinical.queue.read',
        'clinical.visit.read', 'clinical.vitals.read', 'clinical.vitals.create', 'clinical.note.read',
        'clinical.note.create', 'clinical.supply.read', 'clinical.supply.create', 'supply.req.read',
        'supply.req.create', 'supply.consumption.create', 'reference.read', 'files.read', 'notifications.read',
        'renal.station.read', 'renal.machine.read', 'renal.schedule.read', 'renal.schedule.create',
        'renal.schedule.update', 'renal.access.read', 'renal.access.create', 'renal.prescription.read',
        'renal.session.read', 'renal.session.create', 'renal.session.start', 'renal.session.record',
        'renal.session.complete', 'renal.session.cancel', 'renal.dialyzer.read', 'renal.water.read',
        'renal.claim.read', 'renal.claim.create', 'reports.renal.view'
      )
      ON CONFLICT (tenant_id, role_id, permission_id) DO NOTHING;
    END IF;

    IF v_nurse_role_id IS NOT NULL THEN
      INSERT INTO role_permissions (tenant_id, role_id, permission_id)
      SELECT v_tenant_id, v_nurse_role_id, p.id
      FROM permissions p
      WHERE p.code IN (
        'renal.station.read', 'renal.machine.read', 'renal.schedule.read',
        'renal.access.read', 'renal.access.create', 'renal.prescription.read',
        'renal.session.read', 'renal.session.create', 'renal.session.start',
        'renal.session.record', 'renal.session.complete', 'renal.session.cancel',
        'renal.dialyzer.read', 'renal.water.read', 'renal.claim.read', 'reports.renal.view'
      )
      ON CONFLICT (tenant_id, role_id, permission_id) DO NOTHING;
    END IF;

    -- Grant to dialysis_tech
    IF v_dtech_role_id IS NOT NULL THEN
      INSERT INTO role_permissions (tenant_id, role_id, permission_id)
      SELECT v_tenant_id, v_dtech_role_id, p.id
      FROM permissions p
      WHERE p.code IN (
        'patient.record.read', 'reference.read', 'notifications.read', 'supply.req.read', 'supply.req.create',
        'renal.station.read', 'renal.machine.read', 'renal.machine.update', 'renal.machine.service',
        'renal.dialyzer.read', 'renal.dialyzer.create', 'renal.dialyzer.reprocess', 'renal.dialyzer.discard',
        'renal.water.read', 'renal.water.create', 'renal.water.alert', 'reports.renal.view'
      )
      ON CONFLICT (tenant_id, role_id, permission_id) DO NOTHING;
    END IF;
  END LOOP;
END $$;

-- 24. Entitle Tenant A to 'renal' module
INSERT INTO tenant_modules (tenant_id, module, status, seed_status)
VALUES ('11111111-1111-4111-8111-111111111111', 'renal', 'ENABLED', 'SEEDED')
ON CONFLICT (tenant_id, module) DO UPDATE SET status = 'ENABLED';

-- 25. Seed report definitions for renal care module (specification §15.9)
INSERT INTO report_definitions (id, module, name, description, category, permitted_fields) VALUES
  ('RPT-REN-01', 'renal', 'Dialysis Treatment Census & Station Utilization', 'Treatment counts by branch/shift/station, modality, machine operating hours', 'Renal', '["id","session_no","scheduled_date","status","actual_duration_minutes","station_no","machine_serial","modality"]'::jsonb),
  ('RPT-REN-02', 'renal', 'Water Treatment & Quality Surveillance Log', 'Daily pre-shift chlorine checks, RO conductivity, endotoxin & bacterial culture logs', 'Renal', '["id","log_date","carbon_breakthrough_chlorine_ppm","ro_conductivity_us","ro_rejection_rate_pct","status","created_at"]'::jsonb),
  ('RPT-REN-03', 'renal', 'Dialyzer Reuse & Reprocessing Register', 'Serial barcode, patient, reuse counts, bundle volumes, leak test outcomes, discard reasons', 'Renal', '["id","serial_barcode","dialyzer_model","baseline_volume_ml","current_volume_ml","reuse_count","max_allowed_reuses","status","discard_reason"]'::jsonb),
  ('RPT-REN-04', 'renal', 'Vascular Access Surveillance & Complications', 'Access types, anatomical sites, infection/stenosis incidents, intervention history', 'Renal', '["id","access_type","anatomical_site","side","status","created_date","first_name","last_name"]'::jsonb),
  ('RPT-REN-05', 'renal', 'PhilHealth 156-Session Benefit Utilization Tracker', 'Patient session sequence (1…156), claim numbers, remaining benefit balance, copay tallies', 'Renal', '["id","claim_no","calendar_year","session_sequence_no","claim_amount","copay_amount","eclaims_status","first_name","last_name"]'::jsonb),
  ('RPT-REN-06', 'renal', 'Clinical Adequacy & Anemia Management Trend', 'Monthly Kt/V, URR, pre/post BUN, Hemoglobin, Ferritin, TSAT, and ESA dosage trends', 'Renal', '["id","session_no","scheduled_date","actual_duration_minutes","total_uf_removed_liters","target_dry_weight_kg"]'::jsonb)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  category = EXCLUDED.category,
  permitted_fields = EXCLUDED.permitted_fields;

RESET ROLE;
