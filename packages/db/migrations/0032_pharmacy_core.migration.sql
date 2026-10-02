-- 0032_pharmacy_core.migration.sql
-- Phase 5: Pharmacy Catalogue, Generic Names, Drug Products, Interactions, Price Rules, Special Rx Records

-- 1. Generic Names
CREATE TABLE generic_names (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  name        text NOT NULL,
  atc_code    text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz,
  CONSTRAINT generic_names_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT generic_names_tenant_name_uniq UNIQUE (tenant_id, name)
);

CREATE INDEX idx_generic_names_tenant_name ON generic_names (tenant_id, name);

-- 2. Drug Products (Catalog extensions mapping to items)
CREATE TABLE drug_products (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES tenants(id),
  item_id             uuid NOT NULL,
  generic_id          uuid NOT NULL,
  brand_name          text NOT NULL,
  strength            text NOT NULL,
  dosage_form         text NOT NULL,
  route               text NOT NULL,
  pack_size           integer NOT NULL DEFAULT 1,
  fda_reg_no          text,
  rx_required         text NOT NULL DEFAULT 'RX' CHECK (rx_required IN ('OTC', 'RX', 'CONTROLLED')),
  controlled_schedule text CHECK (controlled_schedule IN ('DDB_SCHEDULE_1', 'DDB_SCHEDULE_2', 'DDB_SCHEDULE_3', 'DDB_SCHEDULE_4', 'DDB_SCHEDULE_5')),
  storage             text NOT NULL DEFAULT 'ROOM' CHECK (storage IN ('ROOM', 'COLD')),
  is_formulary        boolean NOT NULL DEFAULT true,
  high_alert          boolean NOT NULL DEFAULT false,
  allergy_class       text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  deleted_at          timestamptz,
  CONSTRAINT drug_products_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT drug_products_tenant_item_uniq UNIQUE (tenant_id, item_id),
  CONSTRAINT drug_products_item_fkey FOREIGN KEY (tenant_id, item_id) REFERENCES items(tenant_id, id),
  CONSTRAINT drug_products_generic_fkey FOREIGN KEY (tenant_id, generic_id) REFERENCES generic_names(tenant_id, id)
);

CREATE INDEX idx_drug_products_tenant_item ON drug_products (tenant_id, item_id);
CREATE INDEX idx_drug_products_tenant_generic ON drug_products (tenant_id, generic_id);

-- 3. Drug Interactions
CREATE TABLE drug_interactions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES tenants(id),
  generic_a_id        uuid NOT NULL,
  generic_b_id        uuid NOT NULL,
  severity            text NOT NULL CHECK (severity IN ('CONTRAINDICATED', 'MAJOR', 'MODERATE', 'MINOR')),
  mechanism           text,
  clinical_advice     text NOT NULL,
  is_tenant_override  boolean NOT NULL DEFAULT false,
  override_reason     text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT drug_interactions_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT drug_interactions_pair_uniq UNIQUE (tenant_id, generic_a_id, generic_b_id),
  CONSTRAINT drug_interactions_gen_a_fkey FOREIGN KEY (tenant_id, generic_a_id) REFERENCES generic_names(tenant_id, id),
  CONSTRAINT drug_interactions_gen_b_fkey FOREIGN KEY (tenant_id, generic_b_id) REFERENCES generic_names(tenant_id, id)
);

CREATE INDEX idx_drug_interactions_tenant_pair ON drug_interactions (tenant_id, generic_a_id, generic_b_id);

-- 4. Pharmacy Price Rules
CREATE TABLE pharmacy_price_rules (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id),
  item_id           uuid NOT NULL,
  pricing_strategy  text NOT NULL CHECK (pricing_strategy IN ('MARKUP_PCT', 'FIXED_PRICE')),
  markup_pct        numeric(6,2),
  fixed_price       numeric(14,4),
  effective_from    date NOT NULL DEFAULT CURRENT_DATE,
  effective_to      date,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pharmacy_price_rules_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT pharmacy_price_rules_item_fkey FOREIGN KEY (tenant_id, item_id) REFERENCES items(tenant_id, id)
);

CREATE INDEX idx_pharmacy_price_rules_tenant_item ON pharmacy_price_rules (tenant_id, item_id, effective_from);

-- 5. Special Rx Records (DDB Yellow Rx tracking for Controlled Drugs)
CREATE TABLE special_rx_records (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES tenants(id),
  special_rx_serial   text NOT NULL,
  prescriber_id       uuid NOT NULL,
  s2_license_no       text NOT NULL,
  patient_id          uuid NOT NULL,
  drug_item_id        uuid NOT NULL,
  qty_words           text NOT NULL,
  qty_numeric         numeric(14,3) NOT NULL CHECK (qty_numeric > 0),
  date_issued         date NOT NULL,
  copy_status         text NOT NULL DEFAULT 'ORIGINAL' CHECK (copy_status IN ('ORIGINAL', 'DUPLICATE', 'TRIPLICATE')),
  is_used             boolean NOT NULL DEFAULT false,
  used_at             timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT special_rx_records_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT special_rx_records_serial_uniq UNIQUE (tenant_id, special_rx_serial),
  CONSTRAINT special_rx_records_prescriber_fkey FOREIGN KEY (tenant_id, prescriber_id) REFERENCES users(tenant_id, id),
  CONSTRAINT special_rx_records_patient_fkey FOREIGN KEY (tenant_id, patient_id) REFERENCES patients(tenant_id, id),
  CONSTRAINT special_rx_records_item_fkey FOREIGN KEY (tenant_id, drug_item_id) REFERENCES items(tenant_id, id)
);

CREATE INDEX idx_special_rx_records_serial ON special_rx_records (tenant_id, special_rx_serial);
