-- Rollback 0028 — drop the indexes, revoke grants, unforce RLS.
DROP INDEX IF EXISTS billing_charges_visit_idx;
DROP INDEX IF EXISTS billing_charges_tenant_idx;
DROP INDEX IF EXISTS clinical_templates_tenant_idx;
DROP INDEX IF EXISTS order_sets_tenant_idx;
DROP INDEX IF EXISTS referrals_tenant_idx;
DROP INDEX IF EXISTS medical_certificates_tenant_idx;
DROP INDEX IF EXISTS prescription_items_tenant_idx;
DROP INDEX IF EXISTS prescriptions_status_idx;
DROP INDEX IF EXISTS prescriptions_patient_idx;
DROP INDEX IF EXISTS prescriptions_tenant_idx;
DROP INDEX IF EXISTS immunizations_tenant_idx;
DROP INDEX IF EXISTS visit_procedures_tenant_idx;
DROP INDEX IF EXISTS problem_list_patient_idx;
DROP INDEX IF EXISTS problem_list_tenant_idx;
DROP INDEX IF EXISTS visit_diagnoses_tenant_idx;
DROP INDEX IF EXISTS clinical_notes_visit_idx;
DROP INDEX IF EXISTS clinical_notes_tenant_idx;
DROP INDEX IF EXISTS vitals_visit_idx;
DROP INDEX IF EXISTS vitals_tenant_idx;
DROP INDEX IF EXISTS visits_branch_status_idx;
DROP INDEX IF EXISTS visits_patient_idx;
DROP INDEX IF EXISTS visits_tenant_idx;
DROP INDEX IF EXISTS queue_tickets_board_idx;
DROP INDEX IF EXISTS queue_tickets_tenant_idx;
DROP INDEX IF EXISTS appointments_patient_idx;
DROP INDEX IF EXISTS appointments_practitioner_time_idx;
DROP INDEX IF EXISTS appointments_tenant_idx;
DROP INDEX IF EXISTS practitioner_schedule_exceptions_tenant_idx;
DROP INDEX IF EXISTS practitioner_schedules_lookup_idx;
DROP INDEX IF EXISTS practitioner_schedules_tenant_idx;
DROP INDEX IF EXISTS practitioner_profiles_tenant_idx;

REVOKE SELECT, INSERT, UPDATE ON
    practitioner_profiles, practitioner_schedules, practitioner_schedule_exceptions,
    appointments, queue_tickets, visits, vitals,
    clinical_notes, visit_diagnoses, problem_list, visit_procedures, immunizations,
    prescriptions, prescription_items, medical_certificates, referrals,
    order_sets, clinical_templates, billing_charges
FROM clinic_app;

ALTER TABLE billing_charges NO FORCE ROW LEVEL SECURITY;
ALTER TABLE clinical_templates NO FORCE ROW LEVEL SECURITY;
ALTER TABLE order_sets NO FORCE ROW LEVEL SECURITY;
ALTER TABLE referrals NO FORCE ROW LEVEL SECURITY;
ALTER TABLE medical_certificates NO FORCE ROW LEVEL SECURITY;
ALTER TABLE prescription_items NO FORCE ROW LEVEL SECURITY;
ALTER TABLE prescriptions NO FORCE ROW LEVEL SECURITY;
ALTER TABLE immunizations NO FORCE ROW LEVEL SECURITY;
ALTER TABLE visit_procedures NO FORCE ROW LEVEL SECURITY;
ALTER TABLE problem_list NO FORCE ROW LEVEL SECURITY;
ALTER TABLE visit_diagnoses NO FORCE ROW LEVEL SECURITY;
ALTER TABLE clinical_notes NO FORCE ROW LEVEL SECURITY;
ALTER TABLE vitals NO FORCE ROW LEVEL SECURITY;
ALTER TABLE visits NO FORCE ROW LEVEL SECURITY;
ALTER TABLE queue_tickets NO FORCE ROW LEVEL SECURITY;
ALTER TABLE appointments NO FORCE ROW LEVEL SECURITY;
ALTER TABLE practitioner_schedule_exceptions NO FORCE ROW LEVEL SECURITY;
ALTER TABLE practitioner_schedules NO FORCE ROW LEVEL SECURITY;
ALTER TABLE practitioner_profiles NO FORCE ROW LEVEL SECURITY;
