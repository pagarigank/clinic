-- Rollback 0051: clinic_app loses console auth access again (0006 posture).
SET ROLE clinic_owner;

REVOKE ALL ON platform_mfa_recovery_codes FROM clinic_app;
REVOKE ALL ON platform_sessions FROM clinic_app;

RESET ROLE;
