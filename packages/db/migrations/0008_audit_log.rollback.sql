-- 0008_audit_log rollback

SET ROLE clinic_owner;

DROP TRIGGER IF EXISTS audit_log_deny_delete ON audit_log;
DROP TRIGGER IF EXISTS audit_log_deny_update ON audit_log;
DROP FUNCTION IF EXISTS app.audit_log_append_only();
DROP TABLE IF EXISTS audit_log CASCADE;

RESET ROLE;
