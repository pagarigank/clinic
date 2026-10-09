-- 0062_patient_supply_requests
-- SUP-T10 (specification §10): a patient-linked supply request so the central
-- supply dispensing workbench can group pending requests by patient, then issue
-- them against that patient's encounter.
--
-- Before this, supply had no patient-linked request entity at all. `purchase_requests`
-- and `requisitions`/`stock_issues` are department/location documents, and
-- `consumption_logs` only records supplies *after* they have already left stock.
-- There was nothing to "group by patient" and nothing pending to dispense.
--
-- The shape mirrors the existing header/line convention (purchase_requests,
-- requisitions): one `patient_supply_requests` header per encounter request and one
-- `patient_supply_request_items` line per item, so partial issuance is trackable
-- without inventing a second concept.

-- `patients` and `visits` were created by the migration runner (0018/0026 do not
-- SET ROLE), so clinic_owner needs explicit REFERENCES to attach the composite
-- tenant FKs below. Every other referenced table is already owned by clinic_owner.
GRANT REFERENCES ON patients, visits TO clinic_owner;

SET ROLE clinic_owner;

CREATE TABLE patient_supply_requests (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  branch_id     uuid NOT NULL,
  request_no    text NOT NULL,
  patient_id    uuid NOT NULL,
  visit_id      uuid,
  status        text NOT NULL DEFAULT 'PENDING'
                CHECK (status IN ('PENDING', 'PARTIALLY_ISSUED', 'ISSUED', 'CANCELLED')),
  requested_by  uuid NOT NULL,
  requested_at  timestamptz NOT NULL DEFAULT now(),
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT patient_supply_requests_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT patient_supply_requests_request_no_uniq UNIQUE (tenant_id, request_no),
  CONSTRAINT patient_supply_requests_branch_fkey FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id),
  CONSTRAINT patient_supply_requests_patient_fkey FOREIGN KEY (tenant_id, patient_id) REFERENCES patients(tenant_id, id),
  CONSTRAINT patient_supply_requests_visit_fkey FOREIGN KEY (tenant_id, visit_id) REFERENCES visits(tenant_id, id)
);

CREATE TABLE patient_supply_request_items (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  request_id    uuid NOT NULL,
  item_id       uuid NOT NULL,
  uom_id        uuid NOT NULL,
  qty_requested numeric(14,3) NOT NULL CHECK (qty_requested > 0),
  qty_issued    numeric(14,3) NOT NULL DEFAULT 0 CHECK (qty_issued >= 0),
  notes         text,
  CONSTRAINT patient_supply_request_items_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT patient_supply_request_items_request_fkey FOREIGN KEY (tenant_id, request_id)
    REFERENCES patient_supply_requests(tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT patient_supply_request_items_item_fkey FOREIGN KEY (tenant_id, item_id) REFERENCES items(tenant_id, id),
  CONSTRAINT patient_supply_request_items_uom_fkey FOREIGN KEY (tenant_id, uom_id) REFERENCES uoms(tenant_id, id)
);

-- Tenant isolation: enabled AND forced, with the composite tenant FK above so a
-- cross-tenant patient/item can never be attached (todo §49 ground rules).
SELECT app.apply_tenant_isolation('patient_supply_requests');
SELECT app.apply_tenant_isolation('patient_supply_request_items');

CREATE INDEX patient_supply_requests_tenant_idx ON patient_supply_requests (tenant_id);
CREATE INDEX patient_supply_requests_status_idx ON patient_supply_requests (tenant_id, status);
CREATE INDEX patient_supply_requests_patient_idx ON patient_supply_requests (tenant_id, patient_id);
CREATE INDEX patient_supply_request_items_tenant_idx ON patient_supply_request_items (tenant_id);
CREATE INDEX patient_supply_request_items_request_idx ON patient_supply_request_items (tenant_id, request_id);

-- Application + reporting grants. Explicit rather than relying on default
-- privileges, matching 0031/0037 so a fresh install and an upgraded one agree.
GRANT SELECT, INSERT, UPDATE, DELETE ON
  patient_supply_requests, patient_supply_request_items
TO clinic_app;

GRANT SELECT ON
  patient_supply_requests, patient_supply_request_items
TO clinic_report;

RESET ROLE;
