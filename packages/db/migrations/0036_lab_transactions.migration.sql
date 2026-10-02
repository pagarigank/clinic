-- 0036_lab_transactions.migration.sql
-- Phase 6: Laboratory Transactional Entities (Orders, Specimens, Results, Amendments, QC, Reports)

CREATE TABLE IF NOT EXISTS lab_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  order_no text NOT NULL,
  patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
  visit_id uuid REFERENCES visits(id) ON DELETE SET NULL,
  ordered_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  priority text CHECK (priority IN ('ROUTINE', 'URGENT', 'STAT')) NOT NULL DEFAULT 'ROUTINE',
  clinical_info text,
  status text CHECK (status IN ('ORDERED', 'COLLECTED', 'IN_PROGRESS', 'RESULTED', 'VERIFIED', 'RELEASED', 'COMPLETED', 'CANCELLED')) NOT NULL DEFAULT 'ORDERED',
  ordered_at timestamptz NOT NULL DEFAULT now(),
  source text CHECK (source IN ('VISIT', 'WALK_IN', 'SEND_IN')) NOT NULL DEFAULT 'VISIT',
  cancel_reason text,
  cancelled_at timestamptz,
  cancelled_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, order_no)
);

CREATE TABLE IF NOT EXISTS lab_order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES lab_orders(id) ON DELETE CASCADE,
  test_id uuid NOT NULL REFERENCES lab_tests(id) ON DELETE RESTRICT,
  status text CHECK (status IN ('ORDERED', 'COLLECTED', 'RECEIVED', 'IN_PROGRESS', 'RESULTED', 'VERIFIED', 'RELEASED', 'CANCELLED', 'REJECTED')) NOT NULL DEFAULT 'ORDERED',
  charge_line_id uuid,
  reagents_consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS specimens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  accession_no text NOT NULL,
  order_id uuid NOT NULL REFERENCES lab_orders(id) ON DELETE CASCADE,
  specimen_type_id uuid NOT NULL REFERENCES lab_specimen_types(id) ON DELETE RESTRICT,
  collected_by uuid REFERENCES users(id) ON DELETE SET NULL,
  collected_at timestamptz,
  collection_site text,
  received_by uuid REFERENCES users(id) ON DELETE SET NULL,
  received_at timestamptz,
  condition text CHECK (condition IN ('OK', 'HEMOLYZED', 'INSUFFICIENT', 'CLOTTED', 'MISLABELED')) NOT NULL DEFAULT 'OK',
  rejection_reason text,
  rejected_at timestamptz,
  rejected_by uuid REFERENCES users(id) ON DELETE SET NULL,
  storage_location text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, accession_no)
);

CREATE TABLE IF NOT EXISTS specimen_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  specimen_id uuid NOT NULL REFERENCES specimens(id) ON DELETE CASCADE,
  event text CHECK (event IN ('COLLECTED', 'RECEIVED', 'ALIQUOTED', 'STORED', 'DISCARDED', 'REJECTED')) NOT NULL,
  by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  note text
);

CREATE TABLE IF NOT EXISTS lab_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  order_item_id uuid NOT NULL REFERENCES lab_order_items(id) ON DELETE CASCADE,
  analyte_id uuid NOT NULL REFERENCES lab_analytes(id) ON DELETE RESTRICT,
  value_num numeric(14, 4),
  value_text text,
  unit text NOT NULL,
  flag text CHECK (flag IN ('N', 'L', 'H', 'LL', 'HH', 'A')) NOT NULL DEFAULT 'N',
  ref_range_text text,
  delta_flag text CHECK (delta_flag IS NULL OR delta_flag IN ('DELTA_PASS', 'DELTA_WARN', 'DELTA_FAIL')),
  status text CHECK (status IN ('ENTERED', 'VERIFIED', 'AMENDED')) NOT NULL DEFAULT 'ENTERED',
  entered_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  entered_at timestamptz NOT NULL DEFAULT now(),
  verified_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  verified_at timestamptz,
  instrument_id uuid REFERENCES lab_instruments(id) ON DELETE SET NULL,
  version int NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS lab_result_amendments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  result_id uuid NOT NULL REFERENCES lab_results(id) ON DELETE CASCADE,
  old_value text NOT NULL,
  new_value text NOT NULL,
  reason text NOT NULL,
  amended_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  amended_at timestamptz NOT NULL DEFAULT now(),
  notified_to_user_id uuid REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS lab_critical_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  result_id uuid NOT NULL REFERENCES lab_results(id) ON DELETE CASCADE,
  detected_at timestamptz NOT NULL DEFAULT now(),
  notified_to text NOT NULL,
  notified_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  method text CHECK (method IN ('IN_APP', 'PHONE', 'SMS')) NOT NULL DEFAULT 'IN_APP',
  read_back_confirmed boolean NOT NULL DEFAULT false,
  read_back_text text,
  acknowledged_at timestamptz,
  escalated_at timestamptz
);

CREATE TABLE IF NOT EXISTS lab_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES lab_orders(id) ON DELETE CASCADE,
  version int NOT NULL DEFAULT 1,
  file_id uuid REFERENCES files(id) ON DELETE SET NULL,
  sha256_hash text NOT NULL,
  issued_at timestamptz NOT NULL DEFAULT now(),
  issued_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  status text CHECK (status IN ('PRELIMINARY', 'FINAL', 'CORRECTED')) NOT NULL DEFAULT 'FINAL',
  report_data jsonb NOT NULL DEFAULT '{}',
  UNIQUE (tenant_id, order_id, version)
);

CREATE TABLE IF NOT EXISTS lab_qc_materials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  section_id uuid NOT NULL REFERENCES lab_sections(id) ON DELETE RESTRICT,
  code text NOT NULL,
  name text NOT NULL,
  manufacturer text,
  lot_no text NOT NULL,
  expiry_date date NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code, lot_no)
);

CREATE TABLE IF NOT EXISTS lab_qc_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  instrument_id uuid NOT NULL REFERENCES lab_instruments(id) ON DELETE RESTRICT,
  material_id uuid NOT NULL REFERENCES lab_qc_materials(id) ON DELETE RESTRICT,
  run_at timestamptz NOT NULL DEFAULT now(),
  run_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  status text CHECK (status IN ('ACCEPTED', 'REJECTED')) NOT NULL DEFAULT 'ACCEPTED',
  corrective_action text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS lab_qc_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  qc_run_id uuid NOT NULL REFERENCES lab_qc_runs(id) ON DELETE CASCADE,
  analyte_id uuid NOT NULL REFERENCES lab_analytes(id) ON DELETE RESTRICT,
  value_num numeric(14, 4) NOT NULL,
  target_mean numeric(14, 4) NOT NULL,
  target_sd numeric(14, 4) NOT NULL,
  z_score numeric(6, 2) NOT NULL,
  westgard_flags text,
  is_accepted boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS lab_send_outs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  order_item_id uuid NOT NULL REFERENCES lab_order_items(id) ON DELETE CASCADE,
  reference_lab_name text NOT NULL,
  tracking_no text,
  sent_at timestamptz NOT NULL DEFAULT now(),
  sent_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  result_received_at timestamptz,
  notes text
);
