-- 0033_pharmacy_transactions.rollback.sql
DROP TABLE IF EXISTS interaction_decisions CASCADE;
DROP TABLE IF EXISTS patient_returns CASCADE;
DROP TABLE IF EXISTS medication_administrations CASCADE;
DROP TRIGGER IF EXISTS trg_deny_delete_controlled_register ON controlled_register;
DROP TRIGGER IF EXISTS trg_deny_update_controlled_register ON controlled_register;
DROP FUNCTION IF EXISTS trg_controlled_register_deny_update_delete();
DROP TABLE IF EXISTS controlled_register CASCADE;
DROP TABLE IF EXISTS pharmacist_interventions CASCADE;
DROP TABLE IF EXISTS dispense_items CASCADE;
DROP TABLE IF EXISTS dispenses CASCADE;
ALTER TABLE prescription_items DROP CONSTRAINT IF EXISTS prescription_items_tenant_id_id_key;

