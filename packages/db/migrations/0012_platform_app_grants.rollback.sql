-- 0012_platform_app_grants rollback
SET ROLE clinic_owner;
REVOKE SELECT ON subscription_plans FROM clinic_app;
REVOKE SELECT ON platform_users FROM clinic_app;
REVOKE INSERT, UPDATE ON tenants FROM clinic_app;
RESET ROLE;
