-- 0048_lab_supply_billing.rollback.sql

DROP INDEX IF EXISTS items_tenant_service_idx;
ALTER TABLE items DROP CONSTRAINT IF EXISTS items_service_fkey;
ALTER TABLE items DROP COLUMN IF EXISTS service_id;

DROP INDEX IF EXISTS lab_tests_tenant_service_idx;
ALTER TABLE lab_tests DROP CONSTRAINT IF EXISTS lab_tests_service_fkey;
ALTER TABLE lab_tests DROP COLUMN IF EXISTS service_id;

ALTER TABLE service_catalog DROP CONSTRAINT IF EXISTS service_catalog_tenant_id_id_key;
ALTER TABLE service_catalog DROP COLUMN IF EXISTS default_price;
ALTER TABLE service_catalog DROP COLUMN IF EXISTS category;
