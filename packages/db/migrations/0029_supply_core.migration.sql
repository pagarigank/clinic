-- 0029_supply_core: Master data, batches, ledger, balances, periods (Phase 4 core)
-- specification §10, architecture §8.

SET ROLE clinic_owner;

-- Item Categories
CREATE TABLE item_categories (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  name        text NOT NULL,
  parent_id   uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT item_categories_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT item_categories_parent_fkey FOREIGN KEY (tenant_id, parent_id) REFERENCES item_categories(tenant_id, id)
);

-- UOMs (Units of Measure)
CREATE TABLE uoms (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  code        text NOT NULL,
  name        text NOT NULL,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uoms_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT uoms_code_uniq UNIQUE (tenant_id, code)
);

-- Items (Catalogue / Master)
CREATE TABLE items (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                   uuid NOT NULL REFERENCES tenants(id),
  code                        text NOT NULL,
  name                        text NOT NULL,
  item_type                   text NOT NULL CHECK (item_type IN ('MEDICINE','SUPPLY','REAGENT','EQUIPMENT')),
  category_id                 uuid,
  base_uom_id                 uuid NOT NULL,
  is_batch_tracked            boolean NOT NULL DEFAULT false,
  is_expiry_tracked           boolean NOT NULL DEFAULT false,
  storage_conditions          text,
  is_hazardous                boolean NOT NULL DEFAULT false,
  standard_cost               numeric(14,4) NOT NULL DEFAULT 0,
  min_shelf_life_days_on_receipt int NOT NULL DEFAULT 0,
  is_active                   boolean NOT NULL DEFAULT true,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT items_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT items_code_uniq UNIQUE (tenant_id, code),
  CONSTRAINT items_category_fkey FOREIGN KEY (tenant_id, category_id) REFERENCES item_categories(tenant_id, id),
  CONSTRAINT items_base_uom_fkey FOREIGN KEY (tenant_id, base_uom_id) REFERENCES uoms(tenant_id, id)
);

-- UOM Conversions
CREATE TABLE uom_conversions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  item_id     uuid,
  from_uom_id uuid NOT NULL,
  to_uom_id   uuid NOT NULL,
  factor      numeric(14,6) NOT NULL CHECK (factor > 0),
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uom_conversions_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT uom_conversions_item_fkey FOREIGN KEY (tenant_id, item_id) REFERENCES items(tenant_id, id),
  CONSTRAINT uom_conversions_from_uom_fkey FOREIGN KEY (tenant_id, from_uom_id) REFERENCES uoms(tenant_id, id),
  CONSTRAINT uom_conversions_to_uom_fkey FOREIGN KEY (tenant_id, to_uom_id) REFERENCES uoms(tenant_id, id),
  CONSTRAINT uom_conversions_uniq UNIQUE (tenant_id, item_id, from_uom_id, to_uom_id)
);

-- Item Barcodes
CREATE TABLE item_barcodes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  item_id     uuid NOT NULL,
  barcode     text NOT NULL,
  uom_id      uuid NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT item_barcodes_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT item_barcodes_barcode_uniq UNIQUE (tenant_id, barcode),
  CONSTRAINT item_barcodes_item_fkey FOREIGN KEY (tenant_id, item_id) REFERENCES items(tenant_id, id),
  CONSTRAINT item_barcodes_uom_fkey FOREIGN KEY (tenant_id, uom_id) REFERENCES uoms(tenant_id, id)
);

-- Suppliers
CREATE TABLE suppliers (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  code            text NOT NULL,
  name            text NOT NULL,
  tin             text,
  address         text,
  terms_days      int NOT NULL DEFAULT 30,
  lead_time_days  int NOT NULL DEFAULT 7,
  rating          numeric(3,2),
  status          text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE','ARCHIVED')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT suppliers_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT suppliers_code_uniq UNIQUE (tenant_id, code)
);

-- Supplier Contacts
CREATE TABLE supplier_contacts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  supplier_id uuid NOT NULL,
  name        text NOT NULL,
  email       text,
  phone       text,
  is_primary  boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT supplier_contacts_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT supplier_contacts_supplier_fkey FOREIGN KEY (tenant_id, supplier_id) REFERENCES suppliers(tenant_id, id)
);

-- Supplier Items (Catalog / Pricing)
CREATE TABLE supplier_items (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id),
  supplier_id  uuid NOT NULL,
  item_id      uuid NOT NULL,
  supplier_sku text,
  last_price   numeric(14,4) NOT NULL DEFAULT 0,
  pack_size    numeric(14,3) NOT NULL DEFAULT 1,
  uom_id       uuid NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT supplier_items_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT supplier_items_uniq UNIQUE (tenant_id, supplier_id, item_id),
  CONSTRAINT supplier_items_supplier_fkey FOREIGN KEY (tenant_id, supplier_id) REFERENCES suppliers(tenant_id, id),
  CONSTRAINT supplier_items_item_fkey FOREIGN KEY (tenant_id, item_id) REFERENCES items(tenant_id, id),
  CONSTRAINT supplier_items_uom_fkey FOREIGN KEY (tenant_id, uom_id) REFERENCES uoms(tenant_id, id)
);

-- Stock Locations
CREATE TABLE stock_locations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  branch_id   uuid NOT NULL,
  code        text NOT NULL,
  name        text NOT NULL,
  type        text NOT NULL CHECK (type IN ('CENTRAL_STORE','PHARMACY','CLINIC_ROOM','LAB','QUARANTINE','WASTE','IN_TRANSIT')),
  parent_id   uuid,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT stock_locations_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT stock_locations_code_uniq UNIQUE (tenant_id, branch_id, code),
  CONSTRAINT stock_locations_branch_fkey FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id),
  CONSTRAINT stock_locations_parent_fkey FOREIGN KEY (tenant_id, parent_id) REFERENCES stock_locations(tenant_id, id)
);

-- Location Item Parameters (Min/Max/Par/Reorder)
CREATE TABLE location_item_params (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  location_id   uuid NOT NULL,
  item_id       uuid NOT NULL,
  min_qty       numeric(14,3) NOT NULL DEFAULT 0,
  max_qty       numeric(14,3),
  par_qty       numeric(14,3),
  reorder_point numeric(14,3),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT location_item_params_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT location_item_params_uniq UNIQUE (tenant_id, location_id, item_id),
  CONSTRAINT location_item_params_location_fkey FOREIGN KEY (tenant_id, location_id) REFERENCES stock_locations(tenant_id, id),
  CONSTRAINT location_item_params_item_fkey FOREIGN KEY (tenant_id, item_id) REFERENCES items(tenant_id, id)
);

-- Stock Batches
CREATE TABLE stock_batches (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id),
  item_id           uuid NOT NULL,
  lot_no            text NOT NULL,
  expiry_date       date NOT NULL,
  supplier_id       uuid,
  unit_cost         numeric(14,4) NOT NULL DEFAULT 0,
  status            text NOT NULL DEFAULT 'AVAILABLE' CHECK (status IN ('AVAILABLE','QUARANTINED','EXPIRED','RECALLED','DEPLETED')),
  quarantine_reason text,
  received_at       timestamptz NOT NULL DEFAULT now(),
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT stock_batches_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT stock_batches_lot_uniq UNIQUE (tenant_id, item_id, lot_no, expiry_date),
  CONSTRAINT stock_batches_item_fkey FOREIGN KEY (tenant_id, item_id) REFERENCES items(tenant_id, id),
  CONSTRAINT stock_batches_supplier_fkey FOREIGN KEY (tenant_id, supplier_id) REFERENCES suppliers(tenant_id, id)
);

-- Stock Balances (Derived view with hard non-negative checks, architecture §8)
CREATE TABLE stock_balances (
  tenant_id         uuid NOT NULL,
  location_id       uuid NOT NULL,
  batch_id          uuid NOT NULL,
  qty_on_hand       numeric(14,3) NOT NULL DEFAULT 0,
  qty_reserved      numeric(14,3) NOT NULL DEFAULT 0,
  last_movement_at  timestamptz,
  hold_until        timestamptz,
  CONSTRAINT stock_balances_pk PRIMARY KEY (tenant_id, location_id, batch_id),
  CONSTRAINT stock_balances_nonneg CHECK (qty_on_hand >= 0 AND qty_reserved >= 0 AND qty_reserved <= qty_on_hand),
  CONSTRAINT stock_balances_tenant_batch_fkey FOREIGN KEY (tenant_id, batch_id) REFERENCES stock_batches(tenant_id, id),
  CONSTRAINT stock_balances_tenant_location_fkey FOREIGN KEY (tenant_id, location_id) REFERENCES stock_locations(tenant_id, id)
);

-- Stock Movements (Append-only ledger, partitioned monthly, architecture §8.1)
CREATE TABLE stock_movements (
  id            uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  occurred_at   timestamptz NOT NULL DEFAULT now(),
  location_id   uuid NOT NULL,
  item_id       uuid NOT NULL,
  batch_id      uuid,
  qty           numeric(14,3) NOT NULL CHECK (qty <> 0),
  uom_id        uuid NOT NULL,
  unit_cost     numeric(14,4),
  movement_type text NOT NULL CHECK (movement_type IN (
    'GRN','ISSUE_OUT','ISSUE_IN','DISPENSE','SALE',
    'PATIENT_RETURN','SUPPLIER_RETURN','ADJ_GAIN','ADJ_LOSS','COUNT_VARIANCE',
    'DISPOSAL','CONSUMPTION','TRANSFER_OUT','TRANSFER_IN','REVERSAL'
  )),
  ref_type      text,
  ref_id        uuid,
  reversal_of   uuid,
  reason_code   text,
  reason_note   text,
  posted_by     uuid NOT NULL,
  request_id    text NOT NULL,
  prev_hash     text,
  row_hash      text,
  CONSTRAINT stock_movements_pk PRIMARY KEY (tenant_id, occurred_at, id),
  CONSTRAINT stock_movements_tenant_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id)
) PARTITION BY RANGE (occurred_at);

-- Default partition for development & testing
CREATE TABLE stock_movements_p_default PARTITION OF stock_movements DEFAULT;
REVOKE ALL ON stock_movements_p_default FROM public, clinic_app, clinic_report;

-- Append-only trigger for stock_movements (AC-12)
CREATE OR REPLACE FUNCTION app.stock_movements_append_only() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN
  RAISE EXCEPTION 'stock_movements is append-only; UPDATE and DELETE are forbidden.';
END;
$$;

CREATE TRIGGER stock_movements_deny_update
  BEFORE UPDATE ON stock_movements
  FOR EACH ROW EXECUTE FUNCTION app.stock_movements_append_only();

CREATE TRIGGER stock_movements_deny_delete
  BEFORE DELETE ON stock_movements
  FOR EACH ROW EXECUTE FUNCTION app.stock_movements_append_only();

REVOKE UPDATE, DELETE ON stock_movements FROM public, clinic_app, clinic_report;

-- Periods / Period Lock (AC-20)
CREATE TABLE periods (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  period      text NOT NULL,
  status      text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','LOCKED')),
  locked_by   uuid,
  locked_at   timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT periods_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT periods_period_uniq UNIQUE (tenant_id, period)
);

-- Consumption Logs (SUP-T10)
CREATE TABLE consumption_logs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  location_id uuid NOT NULL,
  item_id     uuid NOT NULL,
  batch_id    uuid,
  qty         numeric(14,3) NOT NULL CHECK (qty > 0),
  uom_id      uuid NOT NULL,
  ref_type    text NOT NULL,
  ref_id      uuid,
  notes       text,
  logged_by   uuid NOT NULL,
  logged_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT consumption_logs_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT consumption_logs_location_fkey FOREIGN KEY (tenant_id, location_id) REFERENCES stock_locations(tenant_id, id),
  CONSTRAINT consumption_logs_item_fkey FOREIGN KEY (tenant_id, item_id) REFERENCES items(tenant_id, id),
  CONSTRAINT consumption_logs_uom_fkey FOREIGN KEY (tenant_id, uom_id) REFERENCES uoms(tenant_id, id)
);

-- Valuation Snapshots (JOB-37)
CREATE TABLE valuation_snapshots (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  as_of       date NOT NULL,
  location_id uuid NOT NULL,
  item_id     uuid NOT NULL,
  batch_id    uuid,
  qty         numeric(14,3) NOT NULL,
  unit_cost   numeric(14,4) NOT NULL,
  total_value numeric(14,4) NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT valuation_snapshots_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT valuation_snapshots_location_fkey FOREIGN KEY (tenant_id, location_id) REFERENCES stock_locations(tenant_id, id),
  CONSTRAINT valuation_snapshots_item_fkey FOREIGN KEY (tenant_id, item_id) REFERENCES items(tenant_id, id)
);

-- Apply tenant isolation policies
SELECT app.apply_tenant_isolation('item_categories');
SELECT app.apply_tenant_isolation('uoms');
SELECT app.apply_tenant_isolation('items');
SELECT app.apply_tenant_isolation('uom_conversions');
SELECT app.apply_tenant_isolation('item_barcodes');
SELECT app.apply_tenant_isolation('suppliers');
SELECT app.apply_tenant_isolation('supplier_contacts');
SELECT app.apply_tenant_isolation('supplier_items');
SELECT app.apply_tenant_isolation('stock_locations');
SELECT app.apply_tenant_isolation('location_item_params');
SELECT app.apply_tenant_isolation('stock_batches');
SELECT app.apply_tenant_isolation('stock_balances');
SELECT app.apply_tenant_isolation('stock_movements');
SELECT app.apply_tenant_isolation('periods');
SELECT app.apply_tenant_isolation('consumption_logs');
SELECT app.apply_tenant_isolation('valuation_snapshots');

-- Tenant index requirements for schema-linter
CREATE INDEX item_categories_tenant_idx ON item_categories (tenant_id);
CREATE INDEX uoms_tenant_idx ON uoms (tenant_id);
CREATE INDEX items_tenant_idx ON items (tenant_id);
CREATE INDEX uom_conversions_tenant_idx ON uom_conversions (tenant_id);
CREATE INDEX item_barcodes_tenant_idx ON item_barcodes (tenant_id);
CREATE INDEX suppliers_tenant_idx ON suppliers (tenant_id);
CREATE INDEX supplier_contacts_tenant_idx ON supplier_contacts (tenant_id);
CREATE INDEX supplier_items_tenant_idx ON supplier_items (tenant_id);
CREATE INDEX stock_locations_tenant_idx ON stock_locations (tenant_id);
CREATE INDEX location_item_params_tenant_idx ON location_item_params (tenant_id);
CREATE INDEX stock_batches_tenant_idx ON stock_batches (tenant_id);
CREATE INDEX stock_balances_tenant_idx ON stock_balances (tenant_id);
CREATE INDEX stock_movements_tenant_idx ON stock_movements (tenant_id);
CREATE INDEX periods_tenant_idx ON periods (tenant_id);
CREATE INDEX consumption_logs_tenant_idx ON consumption_logs (tenant_id);
CREATE INDEX valuation_snapshots_tenant_idx ON valuation_snapshots (tenant_id);

-- Operational indexes
CREATE INDEX items_search_idx ON items (tenant_id, is_active, name);
CREATE INDEX stock_batches_expiry_idx ON stock_batches (tenant_id, item_id, expiry_date);
CREATE INDEX stock_balances_lookup_idx ON stock_balances (tenant_id, location_id, batch_id);
CREATE INDEX stock_movements_item_idx ON stock_movements (tenant_id, item_id, occurred_at DESC);
CREATE INDEX stock_movements_loc_idx ON stock_movements (tenant_id, location_id, occurred_at DESC);

RESET ROLE;
