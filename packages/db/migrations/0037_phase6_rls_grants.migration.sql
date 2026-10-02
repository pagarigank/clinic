-- 0037_phase6_rls_grants.migration.sql
-- Phase 6: RLS Policies, Tenant Indexes, Immutability Triggers, and Role Grants

-- 1. Apply canonical RLS policies (ENABLE RLS, FORCE RLS, RESTRICTIVE tenant policy)
SELECT app.apply_tenant_isolation('lab_sections');
SELECT app.apply_tenant_isolation('lab_specimen_types');
SELECT app.apply_tenant_isolation('lab_tests');
SELECT app.apply_tenant_isolation('lab_test_panels');
SELECT app.apply_tenant_isolation('lab_analytes');
SELECT app.apply_tenant_isolation('lab_reference_ranges');
SELECT app.apply_tenant_isolation('lab_delta_rules');
SELECT app.apply_tenant_isolation('lab_instruments');
SELECT app.apply_tenant_isolation('lab_test_reagents');
SELECT app.apply_tenant_isolation('lab_report_templates');
SELECT app.apply_tenant_isolation('lab_orders');
SELECT app.apply_tenant_isolation('lab_order_items');
SELECT app.apply_tenant_isolation('specimens');
SELECT app.apply_tenant_isolation('specimen_events');
SELECT app.apply_tenant_isolation('lab_results');
SELECT app.apply_tenant_isolation('lab_result_amendments');
SELECT app.apply_tenant_isolation('lab_critical_notifications');
SELECT app.apply_tenant_isolation('lab_reports');
SELECT app.apply_tenant_isolation('lab_qc_materials');
SELECT app.apply_tenant_isolation('lab_qc_runs');
SELECT app.apply_tenant_isolation('lab_qc_results');
SELECT app.apply_tenant_isolation('lab_send_outs');

-- 2. Tenant index requirements for schema-linter
CREATE INDEX IF NOT EXISTS lab_sections_tenant_idx ON lab_sections (tenant_id);
CREATE INDEX IF NOT EXISTS lab_specimen_types_tenant_idx ON lab_specimen_types (tenant_id);
CREATE INDEX IF NOT EXISTS lab_tests_tenant_idx ON lab_tests (tenant_id);
CREATE INDEX IF NOT EXISTS lab_test_panels_tenant_idx ON lab_test_panels (tenant_id);
CREATE INDEX IF NOT EXISTS lab_analytes_tenant_idx ON lab_analytes (tenant_id);
CREATE INDEX IF NOT EXISTS lab_reference_ranges_tenant_idx ON lab_reference_ranges (tenant_id);
CREATE INDEX IF NOT EXISTS lab_delta_rules_tenant_idx ON lab_delta_rules (tenant_id);
CREATE INDEX IF NOT EXISTS lab_instruments_tenant_idx ON lab_instruments (tenant_id);
CREATE INDEX IF NOT EXISTS lab_test_reagents_tenant_idx ON lab_test_reagents (tenant_id);
CREATE INDEX IF NOT EXISTS lab_report_templates_tenant_idx ON lab_report_templates (tenant_id);
CREATE INDEX IF NOT EXISTS lab_orders_tenant_idx ON lab_orders (tenant_id);
CREATE INDEX IF NOT EXISTS lab_order_items_tenant_idx ON lab_order_items (tenant_id);
CREATE INDEX IF NOT EXISTS specimens_tenant_idx ON specimens (tenant_id);
CREATE INDEX IF NOT EXISTS specimen_events_tenant_idx ON specimen_events (tenant_id);
CREATE INDEX IF NOT EXISTS lab_results_tenant_idx ON lab_results (tenant_id);
CREATE INDEX IF NOT EXISTS lab_result_amendments_tenant_idx ON lab_result_amendments (tenant_id);
CREATE INDEX IF NOT EXISTS lab_critical_notifications_tenant_idx ON lab_critical_notifications (tenant_id);
CREATE INDEX IF NOT EXISTS lab_reports_tenant_idx ON lab_reports (tenant_id);
CREATE INDEX IF NOT EXISTS lab_qc_materials_tenant_idx ON lab_qc_materials (tenant_id);
CREATE INDEX IF NOT EXISTS lab_qc_runs_tenant_idx ON lab_qc_runs (tenant_id);
CREATE INDEX IF NOT EXISTS lab_qc_results_tenant_idx ON lab_qc_results (tenant_id);
CREATE INDEX IF NOT EXISTS lab_send_outs_tenant_idx ON lab_send_outs (tenant_id);

-- 3. Verified result immutability trigger
CREATE OR REPLACE FUNCTION app.fn_guard_verified_result_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'VERIFIED' AND NEW.status = 'VERIFIED' THEN
    IF OLD.value_num IS DISTINCT FROM NEW.value_num
       OR OLD.value_text IS DISTINCT FROM NEW.value_text
       OR OLD.flag IS DISTINCT FROM NEW.flag THEN
      RAISE EXCEPTION 'Verified lab results cannot be edited directly; use result amendment (LAB-T9)';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_verified_result_mutation ON lab_results;
CREATE TRIGGER trg_guard_verified_result_mutation
BEFORE UPDATE ON lab_results
FOR EACH ROW EXECUTE FUNCTION app.fn_guard_verified_result_mutation();

-- 4. Role Grants for Application Role (clinic_app)
GRANT SELECT, INSERT, UPDATE, DELETE ON
  lab_sections, lab_specimen_types, lab_tests, lab_test_panels, lab_analytes,
  lab_reference_ranges, lab_delta_rules, lab_instruments, lab_test_reagents,
  lab_report_templates, lab_orders, lab_order_items, specimens,
  lab_results, lab_critical_notifications, lab_reports,
  lab_qc_materials, lab_qc_runs, lab_qc_results, lab_send_outs
TO clinic_app;

-- Append-only tables: specimen_events and lab_result_amendments
GRANT SELECT, INSERT ON specimen_events, lab_result_amendments TO clinic_app;
REVOKE UPDATE, DELETE ON specimen_events, lab_result_amendments FROM clinic_app, clinic_report, PUBLIC;

-- 5. Role Grants for Reporting Role (clinic_report)
GRANT SELECT ON
  lab_sections, lab_specimen_types, lab_tests, lab_test_panels, lab_analytes,
  lab_reference_ranges, lab_delta_rules, lab_instruments, lab_test_reagents,
  lab_report_templates, lab_orders, lab_order_items, specimens, specimen_events,
  lab_results, lab_result_amendments, lab_critical_notifications, lab_reports,
  lab_qc_materials, lab_qc_runs, lab_qc_results, lab_send_outs
TO clinic_report;
