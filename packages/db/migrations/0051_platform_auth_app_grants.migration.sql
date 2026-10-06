-- 0051_platform_auth_app_grants: Phase 9 platform console login. The console
-- authenticates against the global `platform_users` table and rotates sessions
-- in `platform_sessions` — both without tenant RLS. 0006 deliberately revoked
-- clinic_app from these tables until this flow existed; now grant the runtime
-- role exactly what the console needs.
--
-- No PHI: platform_users / platform_sessions carry only console credentials and
-- session metadata (architecture §5.5). RLS is not applicable (no tenant_id).

SET ROLE clinic_owner;

-- Console session rotation (login / refresh / reuse detection / logout).
GRANT SELECT, INSERT, UPDATE ON platform_sessions TO clinic_app;

-- Platform TOTP recovery codes (consumed on console login).
GRANT SELECT, INSERT, UPDATE ON platform_mfa_recovery_codes TO clinic_app;

RESET ROLE;
