-- 0034_phase5_rls_grants.rollback.sql
SET ROLE clinic_owner;

REVOKE ALL ON
  generic_names, drug_products, drug_interactions, pharmacy_price_rules,
  special_rx_records, dispenses, dispense_items, pharmacist_interventions,
  controlled_register, medication_administrations, patient_returns, interaction_decisions
FROM clinic_app, clinic_report;

RESET ROLE;
