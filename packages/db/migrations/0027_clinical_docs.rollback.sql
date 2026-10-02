-- Rollback 0027 — drop in reverse dependency order.
DROP TABLE IF EXISTS billing_charges;
DROP TABLE IF EXISTS clinical_templates;
DROP TABLE IF EXISTS order_sets;
DROP TABLE IF EXISTS referrals;
DROP TABLE IF EXISTS medical_certificates;
DROP TABLE IF EXISTS prescription_items;
DROP TABLE IF EXISTS prescriptions;
DROP TABLE IF EXISTS immunizations;
DROP TABLE IF EXISTS visit_procedures;
DROP TABLE IF EXISTS problem_list;
DROP TABLE IF EXISTS visit_diagnoses;
DROP TABLE IF EXISTS clinical_notes;
