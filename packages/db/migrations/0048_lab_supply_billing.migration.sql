-- 0048_lab_supply_billing.migration.sql
-- Phase 6/7: give laboratory and central supply a billable price source so
-- their orders/issues can post charge lines to billing (specification §5.1,
-- BIL-T1 line 641, CLN-T6 line 374).
--
-- specification.md §5.1 (lines 252-253) defines `service_catalog` with a
-- `category` (consult, procedure, lab, other) and `default_price`, but
-- migration 0016 created it with neither. This adds both, then links lab tests
-- and inventory items to a catalog service. The existing effective-dated
-- `price_lists` table remains the per-service price override; `default_price`
-- is the fallback. Prices are always resolved server-side (todo §49).
-- NOTE: runs as the superuser migrator (no SET ROLE) because service_catalog,
-- lab_tests and price_lists are owned by that role (see 0016/0027/0035).

-- 1. Service catalog: category + default price (specification §5.1 line 252)
ALTER TABLE service_catalog
  ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'other'
    CHECK (category IN ('consult', 'procedure', 'lab', 'other')),
  ADD COLUMN IF NOT EXISTS default_price numeric(10,2) NOT NULL DEFAULT 0
    CHECK (default_price >= 0);

COMMENT ON COLUMN service_catalog.category IS
  'Billing category (specification §5.1): consult | procedure | lab | other.';
COMMENT ON COLUMN service_catalog.default_price IS
  'Fallback unit price used when no effective-dated price_lists row applies.';

-- Composite tenant key so child tables can enforce tenant-safe FKs (ground rule).
ALTER TABLE service_catalog
  ADD CONSTRAINT service_catalog_tenant_id_id_key UNIQUE (tenant_id, id);

-- 2. Lab tests map to a billable catalog service (LAB charge, CLN-T6)
ALTER TABLE lab_tests
  ADD COLUMN IF NOT EXISTS service_id uuid;

ALTER TABLE lab_tests
  ADD CONSTRAINT lab_tests_service_fkey
    FOREIGN KEY (tenant_id, service_id) REFERENCES service_catalog (tenant_id, id);

CREATE INDEX IF NOT EXISTS lab_tests_tenant_service_idx ON lab_tests (tenant_id, service_id);

-- 3. Inventory items map to a billable catalog service (SUPPLY charge, BIL-T1)
ALTER TABLE items
  ADD COLUMN IF NOT EXISTS service_id uuid;

ALTER TABLE items
  ADD CONSTRAINT items_service_fkey
    FOREIGN KEY (tenant_id, service_id) REFERENCES service_catalog (tenant_id, id);

CREATE INDEX IF NOT EXISTS items_tenant_service_idx ON items (tenant_id, service_id);
