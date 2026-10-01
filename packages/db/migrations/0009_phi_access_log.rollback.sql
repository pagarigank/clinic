-- 0009_phi_access_log rollback

SET ROLE clinic_owner;

DROP TRIGGER IF EXISTS phi_access_log_deny_delete ON phi_access_log;
DROP TRIGGER IF EXISTS phi_access_log_deny_update ON phi_access_log;
DROP FUNCTION IF EXISTS app.phi_access_log_append_only();
DROP TABLE IF EXISTS phi_access_log CASCADE;

RESET ROLE;
