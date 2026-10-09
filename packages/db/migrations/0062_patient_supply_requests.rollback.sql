-- 0062_patient_supply_requests.rollback.sql
-- Undo 0062. Item lines first (they hold the FK to the header).

SET ROLE clinic_owner;

DROP TABLE IF EXISTS patient_supply_request_items;
DROP TABLE IF EXISTS patient_supply_requests;

RESET ROLE;

REVOKE REFERENCES ON patients, visits FROM clinic_owner;
