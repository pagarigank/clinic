-- 0012_platform_app_grants: grant clinic_app read access to platform tables
-- needed by provisioning (ProvisioningService) and the break-glass flow.
-- subscription_plans: app must read to validate module entitlement per plan.
-- platform_users: app must read to authenticate platform users in break-glass.
-- tenants: app must insert/update for provisioning flow (platform scope).
--
-- Architecture §5.5: platform tables have no RLS because they carry no PHI.
-- These grants do not change the security boundary — the RLS guard is
-- on tenant tables (§5.3), not on these catalogues.

SET ROLE clinic_owner;

-- Plan catalogue: needed by provisioning to validate module entitlement per plan
GRANT SELECT ON subscription_plans TO clinic_app;

-- Platform users: needed for break-glass session validation
GRANT SELECT ON platform_users TO clinic_app;

-- Tenants: provisioning service creates tenants from the platform scope
-- (no tenant context exists yet when the row is being created)
GRANT INSERT, UPDATE, SELECT ON tenants TO clinic_app;

RESET ROLE;
