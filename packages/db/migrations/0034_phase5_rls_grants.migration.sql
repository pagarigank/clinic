-- 0034_phase5_rls_grants.migration.sql
-- Phase 5: RLS Policies, Tenant Indexes, and Role Grants

-- 1. Apply canonical RLS policies (ENABLE RLS, FORCE RLS, RESTRICTIVE tenant policy)
SELECT app.apply_tenant_isolation('generic_names');
SELECT app.apply_tenant_isolation('drug_products');
SELECT app.apply_tenant_isolation('drug_interactions');
SELECT app.apply_tenant_isolation('pharmacy_price_rules');
SELECT app.apply_tenant_isolation('special_rx_records');
SELECT app.apply_tenant_isolation('dispenses');
SELECT app.apply_tenant_isolation('dispense_items');
SELECT app.apply_tenant_isolation('pharmacist_interventions');
SELECT app.apply_tenant_isolation('controlled_register');
SELECT app.apply_tenant_isolation('medication_administrations');
SELECT app.apply_tenant_isolation('patient_returns');
SELECT app.apply_tenant_isolation('interaction_decisions');

-- 2. Tenant index requirements for schema-linter
CREATE INDEX IF NOT EXISTS generic_names_tenant_idx ON generic_names (tenant_id);
CREATE INDEX IF NOT EXISTS drug_products_tenant_idx ON drug_products (tenant_id);
CREATE INDEX IF NOT EXISTS drug_interactions_tenant_idx ON drug_interactions (tenant_id);
CREATE INDEX IF NOT EXISTS pharmacy_price_rules_tenant_idx ON pharmacy_price_rules (tenant_id);
CREATE INDEX IF NOT EXISTS special_rx_records_tenant_idx ON special_rx_records (tenant_id);
CREATE INDEX IF NOT EXISTS dispenses_tenant_idx ON dispenses (tenant_id);
CREATE INDEX IF NOT EXISTS dispense_items_tenant_idx ON dispense_items (tenant_id);
CREATE INDEX IF NOT EXISTS pharmacist_interventions_tenant_idx ON pharmacist_interventions (tenant_id);
CREATE INDEX IF NOT EXISTS controlled_register_tenant_idx ON controlled_register (tenant_id);
CREATE INDEX IF NOT EXISTS medication_administrations_tenant_idx ON medication_administrations (tenant_id);
CREATE INDEX IF NOT EXISTS patient_returns_tenant_idx ON patient_returns (tenant_id);
CREATE INDEX IF NOT EXISTS interaction_decisions_tenant_idx ON interaction_decisions (tenant_id);

-- 3. Role Grants for Application Role (clinic_app)
GRANT SELECT, INSERT, UPDATE, DELETE ON
  generic_names, drug_products, drug_interactions, pharmacy_price_rules,
  special_rx_records, dispenses, dispense_items, pharmacist_interventions,
  medication_administrations, patient_returns, interaction_decisions
TO clinic_app;

-- controlled_register: append-only (SELECT and INSERT only)
GRANT SELECT, INSERT ON controlled_register TO clinic_app;
REVOKE UPDATE, DELETE ON controlled_register FROM clinic_app, clinic_report, PUBLIC;

-- 4. Role Grants for Reporting Role (clinic_report)
GRANT SELECT ON
  generic_names, drug_products, drug_interactions, pharmacy_price_rules,
  special_rx_records, dispenses, dispense_items, pharmacist_interventions,
  controlled_register, medication_administrations, patient_returns, interaction_decisions
TO clinic_report;

