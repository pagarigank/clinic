-- 0030_supply_transactions: PR, PO, GRN, Requisitions, Adjustments, Counts, Disposals, Recalls
-- specification §10, architecture §8.

SET ROLE clinic_owner;

-- Purchase Requests
CREATE TABLE purchase_requests (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  branch_id     uuid NOT NULL REFERENCES branches(id),
  pr_no         text NOT NULL,
  requester_id  uuid NOT NULL,
  location_id   uuid NOT NULL,
  status        text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','SUBMITTED','APPROVED','REJECTED','CONVERTED','CANCELLED')),
  needed_by     date,
  reason        text,
  approved_by   uuid,
  approved_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT purchase_requests_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT purchase_requests_pr_no_uniq UNIQUE (tenant_id, pr_no),
  CONSTRAINT purchase_requests_location_fkey FOREIGN KEY (tenant_id, location_id) REFERENCES stock_locations(tenant_id, id)
);

CREATE TABLE purchase_request_items (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  pr_id         uuid NOT NULL,
  item_id       uuid NOT NULL,
  qty_requested numeric(14,3) NOT NULL CHECK (qty_requested > 0),
  uom_id        uuid NOT NULL,
  notes         text,
  CONSTRAINT purchase_request_items_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT purchase_request_items_pr_fkey FOREIGN KEY (tenant_id, pr_id) REFERENCES purchase_requests(tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT purchase_request_items_item_fkey FOREIGN KEY (tenant_id, item_id) REFERENCES items(tenant_id, id),
  CONSTRAINT purchase_request_items_uom_fkey FOREIGN KEY (tenant_id, uom_id) REFERENCES uoms(tenant_id, id)
);

-- Purchase Orders
CREATE TABLE purchase_orders (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  branch_id     uuid NOT NULL REFERENCES branches(id),
  po_no         text NOT NULL,
  supplier_id   uuid NOT NULL,
  status        text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','SUBMITTED','APPROVED','SENT','PARTIALLY_RECEIVED','RECEIVED','CLOSED','CANCELLED')),
  expected_date date,
  terms_days    int NOT NULL DEFAULT 30,
  subtotal      numeric(14,4) NOT NULL DEFAULT 0,
  tax_total     numeric(14,4) NOT NULL DEFAULT 0,
  total         numeric(14,4) NOT NULL DEFAULT 0,
  created_by    uuid NOT NULL,
  approved_by   uuid,
  approved_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT purchase_orders_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT purchase_orders_po_no_uniq UNIQUE (tenant_id, po_no),
  CONSTRAINT purchase_orders_supplier_fkey FOREIGN KEY (tenant_id, supplier_id) REFERENCES suppliers(tenant_id, id)
);

CREATE TABLE purchase_order_items (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  po_id         uuid NOT NULL,
  item_id       uuid NOT NULL,
  qty_ordered   numeric(14,3) NOT NULL CHECK (qty_ordered > 0),
  qty_received  numeric(14,3) NOT NULL DEFAULT 0 CHECK (qty_received >= 0),
  unit_price    numeric(14,4) NOT NULL DEFAULT 0,
  uom_id        uuid NOT NULL,
  total_price   numeric(14,4) NOT NULL DEFAULT 0,
  CONSTRAINT purchase_order_items_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT purchase_order_items_po_fkey FOREIGN KEY (tenant_id, po_id) REFERENCES purchase_orders(tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT purchase_order_items_item_fkey FOREIGN KEY (tenant_id, item_id) REFERENCES items(tenant_id, id),
  CONSTRAINT purchase_order_items_uom_fkey FOREIGN KEY (tenant_id, uom_id) REFERENCES uoms(tenant_id, id)
);

-- Goods Receipts (GRN)
CREATE TABLE goods_receipts (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES tenants(id),
  branch_id           uuid NOT NULL REFERENCES branches(id),
  location_id         uuid NOT NULL,
  grn_no              text NOT NULL,
  po_id               uuid,
  supplier_id         uuid NOT NULL,
  delivery_note_no    text,
  received_by         uuid NOT NULL,
  received_at         timestamptz NOT NULL DEFAULT now(),
  status              text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','POSTED','VOID')),
  temperature_celsius numeric(5,2),
  temperature_ok      boolean NOT NULL DEFAULT true,
  inspection_notes    text,
  void_reason         text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT goods_receipts_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT goods_receipts_grn_no_uniq UNIQUE (tenant_id, grn_no),
  CONSTRAINT goods_receipts_location_fkey FOREIGN KEY (tenant_id, location_id) REFERENCES stock_locations(tenant_id, id),
  CONSTRAINT goods_receipts_supplier_fkey FOREIGN KEY (tenant_id, supplier_id) REFERENCES suppliers(tenant_id, id),
  CONSTRAINT goods_receipts_po_fkey FOREIGN KEY (tenant_id, po_id) REFERENCES purchase_orders(tenant_id, id)
);

CREATE TABLE goods_receipt_items (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id),
  grn_id            uuid NOT NULL,
  item_id           uuid NOT NULL,
  batch_id          uuid,
  lot_no            text NOT NULL,
  expiry_date       date NOT NULL,
  qty_received      numeric(14,3) NOT NULL CHECK (qty_received > 0),
  uom_id            uuid NOT NULL,
  unit_cost         numeric(14,4) NOT NULL DEFAULT 0,
  inspection_result text NOT NULL DEFAULT 'ACCEPT' CHECK (inspection_result IN ('ACCEPT','QUARANTINE','REJECT')),
  override_reason   text,
  CONSTRAINT goods_receipt_items_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT goods_receipt_items_grn_fkey FOREIGN KEY (tenant_id, grn_id) REFERENCES goods_receipts(tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT goods_receipt_items_item_fkey FOREIGN KEY (tenant_id, item_id) REFERENCES items(tenant_id, id),
  CONSTRAINT goods_receipt_items_uom_fkey FOREIGN KEY (tenant_id, uom_id) REFERENCES uoms(tenant_id, id)
);

-- Supplier Invoices
CREATE TABLE supplier_invoices (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  invoice_no    text NOT NULL,
  po_id         uuid,
  grn_id        uuid,
  amount        numeric(14,4) NOT NULL,
  match_status  text NOT NULL DEFAULT 'MATCHED' CHECK (match_status IN ('MATCHED','VARIANCE')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT supplier_invoices_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT supplier_invoices_invoice_no_uniq UNIQUE (tenant_id, invoice_no),
  CONSTRAINT supplier_invoices_po_fkey FOREIGN KEY (tenant_id, po_id) REFERENCES purchase_orders(tenant_id, id),
  CONSTRAINT supplier_invoices_grn_fkey FOREIGN KEY (tenant_id, grn_id) REFERENCES goods_receipts(tenant_id, id)
);

-- Supplier Returns
CREATE TABLE supplier_returns (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  rtv_no          text NOT NULL,
  supplier_id     uuid NOT NULL,
  reason          text NOT NULL,
  status          text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','APPROVED','POSTED','CLOSED','CANCELLED')),
  credit_note_ref text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT supplier_returns_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT supplier_returns_rtv_no_uniq UNIQUE (tenant_id, rtv_no),
  CONSTRAINT supplier_returns_supplier_fkey FOREIGN KEY (tenant_id, supplier_id) REFERENCES suppliers(tenant_id, id)
);

CREATE TABLE supplier_return_items (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  return_id   uuid NOT NULL,
  item_id     uuid NOT NULL,
  batch_id    uuid NOT NULL,
  qty         numeric(14,3) NOT NULL CHECK (qty > 0),
  unit_cost   numeric(14,4) NOT NULL DEFAULT 0,
  CONSTRAINT supplier_return_items_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT supplier_return_items_fkey FOREIGN KEY (tenant_id, return_id) REFERENCES supplier_returns(tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT supplier_return_items_item_fkey FOREIGN KEY (tenant_id, item_id) REFERENCES items(tenant_id, id),
  CONSTRAINT supplier_return_items_batch_fkey FOREIGN KEY (tenant_id, batch_id) REFERENCES stock_batches(tenant_id, id)
);

-- Requisitions
CREATE TABLE requisitions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id),
  branch_id         uuid NOT NULL REFERENCES branches(id),
  req_no            text NOT NULL,
  from_location_id  uuid NOT NULL,
  to_location_id    uuid NOT NULL,
  type              text NOT NULL DEFAULT 'ADHOC' CHECK (type IN ('ADHOC','PAR','STAT')),
  status            text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','SUBMITTED','APPROVED','PARTIALLY_ISSUED','ISSUED','ACKNOWLEDGED','CANCELLED')),
  needed_by         date,
  requested_by      uuid NOT NULL,
  approved_by       uuid,
  approved_at       timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT requisitions_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT requisitions_req_no_uniq UNIQUE (tenant_id, req_no),
  CONSTRAINT requisitions_from_loc_fkey FOREIGN KEY (tenant_id, from_location_id) REFERENCES stock_locations(tenant_id, id),
  CONSTRAINT requisitions_to_loc_fkey FOREIGN KEY (tenant_id, to_location_id) REFERENCES stock_locations(tenant_id, id)
);

CREATE TABLE requisition_items (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  requisition_id  uuid NOT NULL,
  item_id         uuid NOT NULL,
  qty_requested   numeric(14,3) NOT NULL CHECK (qty_requested > 0),
  qty_approved    numeric(14,3),
  qty_issued      numeric(14,3) NOT NULL DEFAULT 0,
  qty_received    numeric(14,3) NOT NULL DEFAULT 0,
  uom_id          uuid NOT NULL,
  CONSTRAINT requisition_items_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT requisition_items_req_fkey FOREIGN KEY (tenant_id, requisition_id) REFERENCES requisitions(tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT requisition_items_item_fkey FOREIGN KEY (tenant_id, item_id) REFERENCES items(tenant_id, id),
  CONSTRAINT requisition_items_uom_fkey FOREIGN KEY (tenant_id, uom_id) REFERENCES uoms(tenant_id, id)
);

-- Stock Issues
CREATE TABLE stock_issues (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id),
  requisition_id    uuid NOT NULL,
  issue_no          text NOT NULL,
  from_location_id  uuid NOT NULL,
  to_location_id    uuid NOT NULL,
  issued_by         uuid NOT NULL,
  issued_at         timestamptz NOT NULL DEFAULT now(),
  status            text NOT NULL DEFAULT 'ISSUED' CHECK (status IN ('ISSUED','ACKNOWLEDGED','DISCREPANCY','VOID')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT stock_issues_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT stock_issues_issue_no_uniq UNIQUE (tenant_id, issue_no),
  CONSTRAINT stock_issues_req_fkey FOREIGN KEY (tenant_id, requisition_id) REFERENCES requisitions(tenant_id, id),
  CONSTRAINT stock_issues_from_loc_fkey FOREIGN KEY (tenant_id, from_location_id) REFERENCES stock_locations(tenant_id, id),
  CONSTRAINT stock_issues_to_loc_fkey FOREIGN KEY (tenant_id, to_location_id) REFERENCES stock_locations(tenant_id, id)
);

CREATE TABLE stock_issue_items (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES tenants(id),
  issue_id            uuid NOT NULL,
  item_id             uuid NOT NULL,
  batch_id            uuid NOT NULL,
  qty_issued          numeric(14,3) NOT NULL CHECK (qty_issued > 0),
  qty_received        numeric(14,3),
  discrepancy_reason  text,
  CONSTRAINT stock_issue_items_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT stock_issue_items_issue_fkey FOREIGN KEY (tenant_id, issue_id) REFERENCES stock_issues(tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT stock_issue_items_item_fkey FOREIGN KEY (tenant_id, item_id) REFERENCES items(tenant_id, id),
  CONSTRAINT stock_issue_items_batch_fkey FOREIGN KEY (tenant_id, batch_id) REFERENCES stock_batches(tenant_id, id)
);

-- Stock Transfers
CREATE TABLE stock_transfers (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id),
  transfer_no       text NOT NULL,
  from_location_id  uuid NOT NULL,
  to_location_id    uuid NOT NULL,
  cross_branch      boolean NOT NULL DEFAULT false,
  status            text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','APPROVED','POSTED','RECEIVED','CANCELLED')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT stock_transfers_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT stock_transfers_transfer_no_uniq UNIQUE (tenant_id, transfer_no),
  CONSTRAINT stock_transfers_from_loc_fkey FOREIGN KEY (tenant_id, from_location_id) REFERENCES stock_locations(tenant_id, id),
  CONSTRAINT stock_transfers_to_loc_fkey FOREIGN KEY (tenant_id, to_location_id) REFERENCES stock_locations(tenant_id, id)
);

CREATE TABLE stock_transfer_items (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  transfer_id uuid NOT NULL,
  item_id     uuid NOT NULL,
  batch_id    uuid NOT NULL,
  qty         numeric(14,3) NOT NULL CHECK (qty > 0),
  CONSTRAINT stock_transfer_items_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT stock_transfer_items_transfer_fkey FOREIGN KEY (tenant_id, transfer_id) REFERENCES stock_transfers(tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT stock_transfer_items_item_fkey FOREIGN KEY (tenant_id, item_id) REFERENCES items(tenant_id, id),
  CONSTRAINT stock_transfer_items_batch_fkey FOREIGN KEY (tenant_id, batch_id) REFERENCES stock_batches(tenant_id, id)
);

-- Stock Adjustments (SUP-T5)
CREATE TABLE stock_adjustments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  branch_id     uuid NOT NULL REFERENCES branches(id),
  adj_no        text NOT NULL,
  location_id   uuid NOT NULL,
  reason_code   text NOT NULL,
  status        text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','PENDING','APPROVED','POSTED','REJECTED','VOID')),
  requested_by  uuid NOT NULL,
  approved_by   uuid,
  approved_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT stock_adjustments_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT stock_adjustments_adj_no_uniq UNIQUE (tenant_id, adj_no),
  CONSTRAINT stock_adjustments_location_fkey FOREIGN KEY (tenant_id, location_id) REFERENCES stock_locations(tenant_id, id)
);

CREATE TABLE stock_adjustment_items (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  adjustment_id uuid NOT NULL,
  item_id       uuid NOT NULL,
  batch_id      uuid,
  qty_delta     numeric(14,3) NOT NULL CHECK (qty_delta <> 0),
  unit_cost     numeric(14,4) NOT NULL DEFAULT 0,
  notes         text,
  CONSTRAINT stock_adjustment_items_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT stock_adjustment_items_adj_fkey FOREIGN KEY (tenant_id, adjustment_id) REFERENCES stock_adjustments(tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT stock_adjustment_items_item_fkey FOREIGN KEY (tenant_id, item_id) REFERENCES items(tenant_id, id)
);

-- Physical Counts (SUP-T6)
CREATE TABLE physical_counts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  branch_id   uuid NOT NULL REFERENCES branches(id),
  count_no    text NOT NULL,
  location_id uuid NOT NULL,
  type        text NOT NULL DEFAULT 'FULL' CHECK (type IN ('FULL','CYCLE','SPOT')),
  blind       boolean NOT NULL DEFAULT false,
  snapshot_at timestamptz,
  status      text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','COUNTING','REVIEW','POSTED','CANCELLED')),
  created_by  uuid NOT NULL,
  posted_by   uuid,
  posted_at   timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT physical_counts_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT physical_counts_count_no_uniq UNIQUE (tenant_id, count_no),
  CONSTRAINT physical_counts_location_fkey FOREIGN KEY (tenant_id, location_id) REFERENCES stock_locations(tenant_id, id)
);

CREATE TABLE physical_count_items (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  count_id    uuid NOT NULL,
  item_id     uuid NOT NULL,
  batch_id    uuid,
  system_qty  numeric(14,3) NOT NULL DEFAULT 0,
  counted_qty numeric(14,3),
  recount_qty numeric(14,3),
  variance    numeric(14,3),
  notes       text,
  CONSTRAINT physical_count_items_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT physical_count_items_count_fkey FOREIGN KEY (tenant_id, count_id) REFERENCES physical_counts(tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT physical_count_items_item_fkey FOREIGN KEY (tenant_id, item_id) REFERENCES items(tenant_id, id)
);

-- Disposals (SUP-T8)
CREATE TABLE disposals (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  branch_id       uuid NOT NULL REFERENCES branches(id),
  disposal_no     text NOT NULL,
  location_id     uuid NOT NULL,
  reason          text NOT NULL CHECK (reason IN ('EXPIRED','DAMAGED','RECALLED','CONTAMINATED')),
  method          text NOT NULL,
  witness1_id     uuid,
  witness2_id     uuid,
  status          text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','APPROVED','POSTED','VOID')),
  disposed_by     uuid NOT NULL,
  disposed_at     timestamptz,
  certificate_url text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT disposals_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT disposals_disposal_no_uniq UNIQUE (tenant_id, disposal_no),
  CONSTRAINT disposals_location_fkey FOREIGN KEY (tenant_id, location_id) REFERENCES stock_locations(tenant_id, id)
);

CREATE TABLE disposal_items (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  disposal_id uuid NOT NULL,
  item_id     uuid NOT NULL,
  batch_id    uuid NOT NULL,
  qty         numeric(14,3) NOT NULL CHECK (qty > 0),
  unit_cost   numeric(14,4) NOT NULL DEFAULT 0,
  CONSTRAINT disposal_items_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT disposal_items_disposal_fkey FOREIGN KEY (tenant_id, disposal_id) REFERENCES disposals(tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT disposal_items_item_fkey FOREIGN KEY (tenant_id, item_id) REFERENCES items(tenant_id, id),
  CONSTRAINT disposal_items_batch_fkey FOREIGN KEY (tenant_id, batch_id) REFERENCES stock_batches(tenant_id, id)
);

-- Recalls (SUP-T9)
CREATE TABLE recalls (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  recall_no     text NOT NULL,
  source        text NOT NULL CHECK (source IN ('SUPPLIER','FDA','INTERNAL')),
  reason        text NOT NULL,
  status        text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','QUARANTINED','NOTIFIED','CLOSED')),
  initiated_by  uuid NOT NULL,
  initiated_at  timestamptz NOT NULL DEFAULT now(),
  closed_at     timestamptz,
  checklist     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT recalls_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT recalls_recall_no_uniq UNIQUE (tenant_id, recall_no)
);

CREATE TABLE recall_batches (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  recall_id       uuid NOT NULL,
  item_id         uuid NOT NULL,
  batch_id        uuid NOT NULL,
  quarantined_qty numeric(14,3) NOT NULL DEFAULT 0,
  action_taken    text,
  CONSTRAINT recall_batches_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT recall_batches_recall_fkey FOREIGN KEY (tenant_id, recall_id) REFERENCES recalls(tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT recall_batches_item_fkey FOREIGN KEY (tenant_id, item_id) REFERENCES items(tenant_id, id),
  CONSTRAINT recall_batches_batch_fkey FOREIGN KEY (tenant_id, batch_id) REFERENCES stock_batches(tenant_id, id)
);

-- Apply tenant isolation policies
SELECT app.apply_tenant_isolation('purchase_requests');
SELECT app.apply_tenant_isolation('purchase_request_items');
SELECT app.apply_tenant_isolation('purchase_orders');
SELECT app.apply_tenant_isolation('purchase_order_items');
SELECT app.apply_tenant_isolation('goods_receipts');
SELECT app.apply_tenant_isolation('goods_receipt_items');
SELECT app.apply_tenant_isolation('supplier_invoices');
SELECT app.apply_tenant_isolation('supplier_returns');
SELECT app.apply_tenant_isolation('supplier_return_items');
SELECT app.apply_tenant_isolation('requisitions');
SELECT app.apply_tenant_isolation('requisition_items');
SELECT app.apply_tenant_isolation('stock_issues');
SELECT app.apply_tenant_isolation('stock_issue_items');
SELECT app.apply_tenant_isolation('stock_transfers');
SELECT app.apply_tenant_isolation('stock_transfer_items');
SELECT app.apply_tenant_isolation('stock_adjustments');
SELECT app.apply_tenant_isolation('stock_adjustment_items');
SELECT app.apply_tenant_isolation('physical_counts');
SELECT app.apply_tenant_isolation('physical_count_items');
SELECT app.apply_tenant_isolation('disposals');
SELECT app.apply_tenant_isolation('disposal_items');
SELECT app.apply_tenant_isolation('recalls');
SELECT app.apply_tenant_isolation('recall_batches');

-- Tenant indexes for schema-linter
CREATE INDEX purchase_requests_tenant_idx ON purchase_requests (tenant_id);
CREATE INDEX purchase_request_items_tenant_idx ON purchase_request_items (tenant_id);
CREATE INDEX purchase_orders_tenant_idx ON purchase_orders (tenant_id);
CREATE INDEX purchase_order_items_tenant_idx ON purchase_order_items (tenant_id);
CREATE INDEX goods_receipts_tenant_idx ON goods_receipts (tenant_id);
CREATE INDEX goods_receipt_items_tenant_idx ON goods_receipt_items (tenant_id);
CREATE INDEX supplier_invoices_tenant_idx ON supplier_invoices (tenant_id);
CREATE INDEX supplier_returns_tenant_idx ON supplier_returns (tenant_id);
CREATE INDEX supplier_return_items_tenant_idx ON supplier_return_items (tenant_id);
CREATE INDEX requisitions_tenant_idx ON requisitions (tenant_id);
CREATE INDEX requisition_items_tenant_idx ON requisition_items (tenant_id);
CREATE INDEX stock_issues_tenant_idx ON stock_issues (tenant_id);
CREATE INDEX stock_issue_items_tenant_idx ON stock_issue_items (tenant_id);
CREATE INDEX stock_transfers_tenant_idx ON stock_transfers (tenant_id);
CREATE INDEX stock_transfer_items_tenant_idx ON stock_transfer_items (tenant_id);
CREATE INDEX stock_adjustments_tenant_idx ON stock_adjustments (tenant_id);
CREATE INDEX stock_adjustment_items_tenant_idx ON stock_adjustment_items (tenant_id);
CREATE INDEX physical_counts_tenant_idx ON physical_counts (tenant_id);
CREATE INDEX physical_count_items_tenant_idx ON physical_count_items (tenant_id);
CREATE INDEX disposals_tenant_idx ON disposals (tenant_id);
CREATE INDEX disposal_items_tenant_idx ON disposal_items (tenant_id);
CREATE INDEX recalls_tenant_idx ON recalls (tenant_id);
CREATE INDEX recall_batches_tenant_idx ON recall_batches (tenant_id);

RESET ROLE;
