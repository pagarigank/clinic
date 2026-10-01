-- 0006_auth_support rollback (reverse order of creation).

DROP TABLE IF EXISTS platform_mfa_recovery_codes;
DROP TABLE IF EXISTS platform_sessions;
DROP TABLE IF EXISTS mfa_trusted_devices;
DROP TABLE IF EXISTS mfa_recovery_codes;
ALTER TABLE mfa_secrets DROP COLUMN IF EXISTS last_used_step;
