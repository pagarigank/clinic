-- 0033_pharmacy_transactions.migration.sql
-- Phase 5: Dispenses, Dispense Items, Pharmacist Interventions, Controlled Register (Append-only), Medication Administrations, Patient Returns, Interaction Decisions

-- Ensure composite tenant FK can reference prescription_items
ALTER TABLE prescription_items ADD CONSTRAINT prescription_items_tenant_id_id_key UNIQUE (tenant_id, id);

-- 1. Dispenses Header
CREATE TABLE dispenses (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id),
  branch_id         uuid NOT NULL,
  dispense_no       text NOT NULL,
  rx_id             uuid,
  patient_id        uuid NOT NULL,
  pharmacist_id     uuid,
  status            text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'VERIFIED', 'READY', 'DISPENSED', 'RETURNED', 'VOID')),
  is_controlled     boolean NOT NULL DEFAULT false,
  counselling_done  boolean NOT NULL DEFAULT false,
  total_amount      numeric(14,4) NOT NULL DEFAULT 0,
  notes             text,
  dispensed_at      timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dispenses_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT dispenses_no_uniq UNIQUE (tenant_id, branch_id, dispense_no),
  CONSTRAINT dispenses_branch_fkey FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id),
  CONSTRAINT dispenses_rx_fkey FOREIGN KEY (tenant_id, rx_id) REFERENCES prescriptions(tenant_id, id),
  CONSTRAINT dispenses_patient_fkey FOREIGN KEY (tenant_id, patient_id) REFERENCES patients(tenant_id, id),
  CONSTRAINT dispenses_pharmacist_fkey FOREIGN KEY (tenant_id, pharmacist_id) REFERENCES users(tenant_id, id)
);

CREATE INDEX idx_dispenses_tenant_status ON dispenses (tenant_id, status);
CREATE INDEX idx_dispenses_tenant_rx ON dispenses (tenant_id, rx_id);
CREATE INDEX idx_dispenses_tenant_patient ON dispenses (tenant_id, patient_id);

-- 2. Dispense Line Items
CREATE TABLE dispense_items (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                 uuid NOT NULL REFERENCES tenants(id),
  dispense_id               uuid NOT NULL,
  prescription_item_id      uuid,
  item_id                   uuid NOT NULL,
  batch_id                  uuid,
  qty                       numeric(14,3) NOT NULL CHECK (qty > 0),
  uom_id                    uuid NOT NULL,
  unit_price                numeric(14,4) NOT NULL DEFAULT 0,
  total_price               numeric(14,4) NOT NULL DEFAULT 0,
  substituted_from_item_id  uuid,
  substitution_reason       text,
  override_reason           text,
  created_at                timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dispense_items_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT dispense_items_batch_uniq UNIQUE (tenant_id, dispense_id, item_id, batch_id),
  CONSTRAINT dispense_items_dispense_fkey FOREIGN KEY (tenant_id, dispense_id) REFERENCES dispenses(tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT dispense_items_rx_item_fkey FOREIGN KEY (tenant_id, prescription_item_id) REFERENCES prescription_items(tenant_id, id),
  CONSTRAINT dispense_items_item_fkey FOREIGN KEY (tenant_id, item_id) REFERENCES items(tenant_id, id),
  CONSTRAINT dispense_items_batch_fkey FOREIGN KEY (tenant_id, batch_id) REFERENCES stock_batches(tenant_id, id),
  CONSTRAINT dispense_items_uom_fkey FOREIGN KEY (tenant_id, uom_id) REFERENCES uoms(tenant_id, id),
  CONSTRAINT dispense_items_sub_from_fkey FOREIGN KEY (tenant_id, substituted_from_item_id) REFERENCES items(tenant_id, id)
);

CREATE INDEX idx_dispense_items_tenant_dispense ON dispense_items (tenant_id, dispense_id);

-- 3. Pharmacist Interventions
CREATE TABLE pharmacist_interventions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  rx_id         uuid NOT NULL,
  dispense_id   uuid,
  type          text NOT NULL CHECK (type IN ('ALLERGY', 'INTERACTION', 'DUPLICATE', 'DOSE_HIGH', 'DOSE_LOW', 'FORMULARY', 'OTHER')),
  description   text NOT NULL,
  outcome       text NOT NULL CHECK (outcome IN ('APPROVED_WITH_OVERRIDE', 'MODIFIED_BY_PRESCRIBER', 'CANCELLED_BY_PRESCRIBER', 'REJECTED')),
  pharmacist_id uuid NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pharmacist_interventions_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT pharmacist_interventions_rx_fkey FOREIGN KEY (tenant_id, rx_id) REFERENCES prescriptions(tenant_id, id),
  CONSTRAINT pharmacist_interventions_pharmacist_fkey FOREIGN KEY (tenant_id, pharmacist_id) REFERENCES users(tenant_id, id)
);

CREATE INDEX idx_pharmacist_interventions_rx ON pharmacist_interventions (tenant_id, rx_id);

-- 4. Controlled Register (Append-only Dangerous Drugs Book)
CREATE TABLE controlled_register (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES tenants(id),
  branch_id           uuid NOT NULL,
  drug_item_id        uuid NOT NULL,
  batch_id            uuid NOT NULL,
  entry_type          text NOT NULL CHECK (entry_type IN ('RECEIPT', 'DISPENSE', 'ADJUSTMENT', 'DISPOSAL')),
  qty_in              numeric(14,3) NOT NULL DEFAULT 0 CHECK (qty_in >= 0),
  qty_out             numeric(14,3) NOT NULL DEFAULT 0 CHECK (qty_out >= 0),
  running_balance     numeric(14,3) NOT NULL CHECK (running_balance >= 0),
  patient_id          uuid,
  rx_id               uuid,
  dispense_id         uuid,
  special_rx_serial   text,
  prescriber_s2_no    text,
  pharmacist_id       uuid NOT NULL,
  witness_id          uuid NOT NULL,
  witness_signature   text,
  notes               text,
  occurred_at         timestamptz NOT NULL DEFAULT now(),
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT controlled_register_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT controlled_register_branch_fkey FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id),
  CONSTRAINT controlled_register_item_fkey FOREIGN KEY (tenant_id, drug_item_id) REFERENCES items(tenant_id, id),
  CONSTRAINT controlled_register_batch_fkey FOREIGN KEY (tenant_id, batch_id) REFERENCES stock_batches(tenant_id, id),
  CONSTRAINT controlled_register_patient_fkey FOREIGN KEY (tenant_id, patient_id) REFERENCES patients(tenant_id, id),
  CONSTRAINT controlled_register_rx_fkey FOREIGN KEY (tenant_id, rx_id) REFERENCES prescriptions(tenant_id, id),
  CONSTRAINT controlled_register_pharmacist_fkey FOREIGN KEY (tenant_id, pharmacist_id) REFERENCES users(tenant_id, id),
  CONSTRAINT controlled_register_witness_fkey FOREIGN KEY (tenant_id, witness_id) REFERENCES users(tenant_id, id)
);

CREATE INDEX idx_controlled_register_item_date ON controlled_register (tenant_id, drug_item_id, occurred_at);

-- Trigger denying UPDATE and DELETE on controlled_register (Immutability guarantee)
CREATE OR REPLACE FUNCTION trg_controlled_register_deny_update_delete()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'CONTROLLED_REGISTER_IMMUTABLE: Controlled register entries are append-only. Updates and deletes are forbidden at the database level.';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_deny_update_controlled_register
BEFORE UPDATE ON controlled_register
FOR EACH ROW EXECUTE FUNCTION trg_controlled_register_deny_update_delete();

CREATE TRIGGER trg_deny_delete_controlled_register
BEFORE DELETE ON controlled_register
FOR EACH ROW EXECUTE FUNCTION trg_controlled_register_deny_update_delete();

-- 5. In-Clinic Medication Administration (PHM-T6)
CREATE TABLE medication_administrations (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id),
  branch_id         uuid NOT NULL,
  visit_id          uuid NOT NULL,
  drug_item_id      uuid NOT NULL,
  batch_id          uuid NOT NULL,
  dose              text NOT NULL,
  route             text NOT NULL,
  given_by          uuid NOT NULL,
  status            text NOT NULL DEFAULT 'ADMINISTERED' CHECK (status IN ('ADMINISTERED', 'VOID')),
  administered_at   timestamptz NOT NULL DEFAULT now(),
  notes             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT medication_administrations_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT medication_administrations_branch_fkey FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id),
  CONSTRAINT medication_administrations_visit_fkey FOREIGN KEY (tenant_id, visit_id) REFERENCES visits(tenant_id, id),
  CONSTRAINT medication_administrations_item_fkey FOREIGN KEY (tenant_id, drug_item_id) REFERENCES items(tenant_id, id),
  CONSTRAINT medication_administrations_batch_fkey FOREIGN KEY (tenant_id, batch_id) REFERENCES stock_batches(tenant_id, id),
  CONSTRAINT medication_administrations_given_by_fkey FOREIGN KEY (tenant_id, given_by) REFERENCES users(tenant_id, id)
);

CREATE INDEX idx_med_admin_visit ON medication_administrations (tenant_id, visit_id);

-- 6. Patient Returns
CREATE TABLE patient_returns (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id),
  branch_id         uuid NOT NULL,
  dispense_id       uuid NOT NULL,
  dispense_item_id  uuid NOT NULL,
  qty               numeric(14,3) NOT NULL CHECK (qty > 0),
  reason            text NOT NULL,
  disposition       text NOT NULL CHECK (disposition IN ('RESTOCK', 'QUARANTINE', 'DISPOSE')),
  credit_note_ref   text,
  status            text NOT NULL DEFAULT 'RECEIVED' CHECK (status IN ('RECEIVED', 'PROCESSED')),
  created_by        uuid NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT patient_returns_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT patient_returns_branch_fkey FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id),
  CONSTRAINT patient_returns_dispense_fkey FOREIGN KEY (tenant_id, dispense_id) REFERENCES dispenses(tenant_id, id),
  CONSTRAINT patient_returns_item_fkey FOREIGN KEY (tenant_id, dispense_item_id) REFERENCES dispense_items(tenant_id, id),
  CONSTRAINT patient_returns_user_fkey FOREIGN KEY (tenant_id, created_by) REFERENCES users(tenant_id, id)
);

CREATE INDEX idx_patient_returns_dispense ON patient_returns (tenant_id, dispense_id);

-- 7. Interaction Decisions (Audit trail for alert decisions, exit gate requirement)
CREATE TABLE interaction_decisions (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                 uuid NOT NULL REFERENCES tenants(id),
  rx_id                     uuid NOT NULL,
  interaction_id            uuid,
  drug_a_name               text NOT NULL,
  drug_b_name               text NOT NULL,
  severity                  text NOT NULL,
  decision                  text NOT NULL CHECK (decision IN ('OVERRIDDEN', 'INTERVENED', 'CANCELLED')),
  justification_reason_code text,
  justification_notes       text,
  pharmacist_id             uuid NOT NULL,
  created_at                timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT interaction_decisions_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT interaction_decisions_rx_fkey FOREIGN KEY (tenant_id, rx_id) REFERENCES prescriptions(tenant_id, id),
  CONSTRAINT interaction_decisions_pharmacist_fkey FOREIGN KEY (tenant_id, pharmacist_id) REFERENCES users(tenant_id, id)
);

CREATE INDEX idx_interaction_decisions_rx ON interaction_decisions (tenant_id, rx_id);
