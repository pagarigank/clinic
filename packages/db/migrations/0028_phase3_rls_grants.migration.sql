-- Phase 3 — FORCE RLS on every clinical table (ground rule 1, pattern of 0021),
-- runtime-role grants (pattern of 0012/0020), and the (tenant_id, …) indexes
-- the schema linter requires (pattern of 0022).

ALTER TABLE practitioner_profiles FORCE ROW LEVEL SECURITY;
ALTER TABLE practitioner_schedules FORCE ROW LEVEL SECURITY;
ALTER TABLE practitioner_schedule_exceptions FORCE ROW LEVEL SECURITY;
ALTER TABLE appointments FORCE ROW LEVEL SECURITY;
ALTER TABLE queue_tickets FORCE ROW LEVEL SECURITY;
ALTER TABLE visits FORCE ROW LEVEL SECURITY;
ALTER TABLE vitals FORCE ROW LEVEL SECURITY;
ALTER TABLE clinical_notes FORCE ROW LEVEL SECURITY;
ALTER TABLE visit_diagnoses FORCE ROW LEVEL SECURITY;
ALTER TABLE problem_list FORCE ROW LEVEL SECURITY;
ALTER TABLE visit_procedures FORCE ROW LEVEL SECURITY;
ALTER TABLE immunizations FORCE ROW LEVEL SECURITY;
ALTER TABLE prescriptions FORCE ROW LEVEL SECURITY;
ALTER TABLE prescription_items FORCE ROW LEVEL SECURITY;
ALTER TABLE medical_certificates FORCE ROW LEVEL SECURITY;
ALTER TABLE referrals FORCE ROW LEVEL SECURITY;
ALTER TABLE order_sets FORCE ROW LEVEL SECURITY;
ALTER TABLE clinical_templates FORCE ROW LEVEL SECURITY;
ALTER TABLE billing_charges FORCE ROW LEVEL SECURITY;

-- Runtime role grants: SELECT/INSERT/UPDATE only — deletes happen through
-- void/cancel columns, never DELETE (ground rule 7).
GRANT SELECT, INSERT, UPDATE ON
    practitioner_profiles, practitioner_schedules, practitioner_schedule_exceptions,
    appointments, queue_tickets, visits, vitals,
    clinical_notes, visit_diagnoses, problem_list, visit_procedures, immunizations,
    prescriptions, prescription_items, medical_certificates, referrals,
    order_sets, clinical_templates, billing_charges
TO clinic_app;

-- (tenant_id, …) indexes for tenant-scoped queries (schema-linter requirement).
CREATE INDEX practitioner_profiles_tenant_idx ON practitioner_profiles (tenant_id);
CREATE INDEX practitioner_schedules_tenant_idx ON practitioner_schedules (tenant_id);
CREATE INDEX practitioner_schedules_lookup_idx ON practitioner_schedules (tenant_id, branch_id, practitioner_id, weekday);
CREATE INDEX practitioner_schedule_exceptions_tenant_idx ON practitioner_schedule_exceptions (tenant_id);
CREATE INDEX appointments_tenant_idx ON appointments (tenant_id);
CREATE INDEX appointments_practitioner_time_idx ON appointments (tenant_id, practitioner_id, starts_at);
CREATE INDEX appointments_patient_idx ON appointments (tenant_id, patient_id);
CREATE INDEX queue_tickets_tenant_idx ON queue_tickets (tenant_id);
CREATE INDEX queue_tickets_board_idx ON queue_tickets (tenant_id, branch_id, status, issued_at);
CREATE INDEX visits_tenant_idx ON visits (tenant_id);
CREATE INDEX visits_patient_idx ON visits (tenant_id, patient_id);
CREATE INDEX visits_branch_status_idx ON visits (tenant_id, branch_id, status);
CREATE INDEX vitals_tenant_idx ON vitals (tenant_id);
CREATE INDEX vitals_visit_idx ON vitals (tenant_id, visit_id);
CREATE INDEX clinical_notes_tenant_idx ON clinical_notes (tenant_id);
CREATE INDEX clinical_notes_visit_idx ON clinical_notes (tenant_id, visit_id);
CREATE INDEX visit_diagnoses_tenant_idx ON visit_diagnoses (tenant_id);
CREATE INDEX problem_list_tenant_idx ON problem_list (tenant_id);
CREATE INDEX problem_list_patient_idx ON problem_list (tenant_id, patient_id);
CREATE INDEX visit_procedures_tenant_idx ON visit_procedures (tenant_id);
CREATE INDEX immunizations_tenant_idx ON immunizations (tenant_id);
CREATE INDEX prescriptions_tenant_idx ON prescriptions (tenant_id);
CREATE INDEX prescriptions_patient_idx ON prescriptions (tenant_id, patient_id);
CREATE INDEX prescriptions_status_idx ON prescriptions (tenant_id, status, valid_until);
CREATE INDEX prescription_items_tenant_idx ON prescription_items (tenant_id);
CREATE INDEX medical_certificates_tenant_idx ON medical_certificates (tenant_id);
CREATE INDEX referrals_tenant_idx ON referrals (tenant_id);
CREATE INDEX order_sets_tenant_idx ON order_sets (tenant_id);
CREATE INDEX clinical_templates_tenant_idx ON clinical_templates (tenant_id);
CREATE INDEX billing_charges_tenant_idx ON billing_charges (tenant_id);
CREATE INDEX billing_charges_visit_idx ON billing_charges (tenant_id, visit_id);
