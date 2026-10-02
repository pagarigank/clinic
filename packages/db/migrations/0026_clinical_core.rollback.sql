-- Rollback 0026 — drop in reverse dependency order.
ALTER TABLE patients DROP CONSTRAINT IF EXISTS patients_tenant_id_id_key;
DROP EXTENSION IF EXISTS btree_gist;
DROP TABLE IF EXISTS vitals;
DROP TABLE IF EXISTS visits;
DROP TABLE IF EXISTS queue_tickets;
DROP TABLE IF EXISTS appointments;
DROP TABLE IF EXISTS practitioner_schedule_exceptions;
DROP TABLE IF EXISTS practitioner_schedules;
DROP TABLE IF EXISTS practitioner_profiles;
