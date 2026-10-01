-- Tables first (dropping tenants removes the sync trigger that depends on
-- the function), then the function itself.
DROP TABLE IF EXISTS branch_licences;
DROP TABLE IF EXISTS branches;
DROP TABLE IF EXISTS tenant_modules;
DROP TABLE IF EXISTS subscriptions;
DROP TABLE IF EXISTS tenants;
DROP FUNCTION IF EXISTS app.sync_tenant_directory();
