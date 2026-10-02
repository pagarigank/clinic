-- 0035_lab_core.migration.sql
-- Phase 6: Laboratory Configuration & Master Entities

CREATE TABLE IF NOT EXISTS lab_sections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  display_order int NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code)
);

CREATE TABLE IF NOT EXISTS lab_specimen_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  default_container text NOT NULL,
  tube_top_color text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code)
);

CREATE TABLE IF NOT EXISTS lab_tests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  section_id uuid NOT NULL REFERENCES lab_sections(id) ON DELETE RESTRICT,
  specimen_type_id uuid NOT NULL REFERENCES lab_specimen_types(id) ON DELETE RESTRICT,
  code text NOT NULL,
  name text NOT NULL,
  loinc_code text,
  tat_minutes int NOT NULL DEFAULT 60,
  is_stat_allowed boolean NOT NULL DEFAULT true,
  is_confidential boolean NOT NULL DEFAULT false,
  fasting_required boolean NOT NULL DEFAULT false,
  fasting_hours int,
  instructions text,
  is_panel boolean NOT NULL DEFAULT false,
  requires_pathologist_review boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code)
);

CREATE TABLE IF NOT EXISTS lab_test_panels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  panel_test_id uuid NOT NULL REFERENCES lab_tests(id) ON DELETE CASCADE,
  child_test_id uuid NOT NULL REFERENCES lab_tests(id) ON DELETE CASCADE,
  display_order int NOT NULL DEFAULT 0,
  UNIQUE (tenant_id, panel_test_id, child_test_id)
);

CREATE TABLE IF NOT EXISTS lab_analytes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  test_id uuid NOT NULL REFERENCES lab_tests(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  default_unit text NOT NULL,
  precision_digits int NOT NULL DEFAULT 2,
  is_calculated boolean NOT NULL DEFAULT false,
  calculation_formula text,
  sort_order int NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  UNIQUE (tenant_id, test_id, code)
);

CREATE TABLE IF NOT EXISTS lab_reference_ranges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  analyte_id uuid NOT NULL REFERENCES lab_analytes(id) ON DELETE CASCADE,
  sex text CHECK (sex IN ('ALL', 'MALE', 'FEMALE')) NOT NULL DEFAULT 'ALL',
  age_min_days int NOT NULL DEFAULT 0,
  age_max_days int NOT NULL DEFAULT 36500,
  normal_min numeric(12, 4),
  normal_max numeric(12, 4),
  critical_low numeric(12, 4),
  critical_high numeric(12, 4),
  text_range text,
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_to timestamptz
);

CREATE TABLE IF NOT EXISTS lab_delta_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  analyte_id uuid NOT NULL REFERENCES lab_analytes(id) ON DELETE CASCADE,
  delta_type text CHECK (delta_type IN ('ABSOLUTE', 'PERCENT')) NOT NULL DEFAULT 'PERCENT',
  max_change numeric(12, 4) NOT NULL,
  lookback_hours int NOT NULL DEFAULT 72,
  UNIQUE (tenant_id, analyte_id)
);

CREATE TABLE IF NOT EXISTS lab_instruments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  section_id uuid NOT NULL REFERENCES lab_sections(id) ON DELETE RESTRICT,
  code text NOT NULL,
  name text NOT NULL,
  model text,
  serial_no text,
  calibration_due_at timestamptz,
  last_calibrated_at timestamptz,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, branch_id, code)
);

CREATE TABLE IF NOT EXISTS lab_test_reagents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  test_id uuid NOT NULL REFERENCES lab_tests(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  qty_per_test numeric(12, 4) NOT NULL,
  uom_id uuid NOT NULL REFERENCES uoms(id) ON DELETE RESTRICT,
  UNIQUE (tenant_id, test_id, item_id)
);

CREATE TABLE IF NOT EXISTS lab_report_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  section_id uuid REFERENCES lab_sections(id) ON DELETE SET NULL,
  name text NOT NULL,
  template_html text NOT NULL,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
