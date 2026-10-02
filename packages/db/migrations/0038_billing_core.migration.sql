-- 0038_billing_core.migration.sql
-- Phase 7: Core billing extensions, cashier shifts, and daily close summaries

-- 1. Extend discount_types (specification §11.1, todo.md §7.1)
ALTER TABLE discount_types ADD COLUMN IF NOT EXISTS code TEXT;
ALTER TABLE discount_types ADD COLUMN IF NOT EXISTS requires_id BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE discount_types ADD COLUMN IF NOT EXISTS legal_basis TEXT;
ALTER TABLE discount_types ADD COLUMN IF NOT EXISTS fixed_amount NUMERIC(12,2);

-- Update or insert standard Philippine discount types
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT id FROM tenants LOOP
    -- SENIOR CITIZEN (RA 9994)
    INSERT INTO discount_types (tenant_id, code, name, percentage, requires_id, legal_basis, is_active)
    VALUES (r.id, 'SENIOR', 'Senior Citizen Discount (20%)', 20.00, true, 'RA 9994 Expanded Senior Citizens Act of 2010', true)
    ON CONFLICT (tenant_id, name) DO UPDATE
      SET code = 'SENIOR', requires_id = true, legal_basis = 'RA 9994 Expanded Senior Citizens Act of 2010';

    -- PWD (RA 10754)
    INSERT INTO discount_types (tenant_id, code, name, percentage, requires_id, legal_basis, is_active)
    VALUES (r.id, 'PWD', 'Persons with Disability (20%)', 20.00, true, 'RA 10754 Act Expanding Benefits and Privileges of PWDs', true)
    ON CONFLICT (tenant_id, name) DO UPDATE
      SET code = 'PWD', requires_id = true, legal_basis = 'RA 10754 Act Expanding Benefits and Privileges of PWDs';

    -- EMPLOYEE / STAFF WELFARE
    INSERT INTO discount_types (tenant_id, code, name, percentage, requires_id, legal_basis, is_active)
    VALUES (r.id, 'EMPLOYEE', 'Employee / Staff Welfare (50%)', 50.00, true, 'Clinic Staff Health Benefit Policy', true)
    ON CONFLICT (tenant_id, name) DO UPDATE
      SET code = 'EMPLOYEE', requires_id = true, legal_basis = 'Clinic Staff Health Benefit Policy';

    -- PROMOTIONAL
    INSERT INTO discount_types (tenant_id, code, name, percentage, requires_id, legal_basis, is_active)
    VALUES (r.id, 'PROMO', 'Promotional Campaign (10%)', 10.00, false, 'Tenant Marketing Policy', true)
    ON CONFLICT (tenant_id, name) DO UPDATE
      SET code = 'PROMO', requires_id = false, legal_basis = 'Tenant Marketing Policy';

    -- Standard Payment Methods
    INSERT INTO payment_methods (tenant_id, code, name, is_active)
    VALUES
      (r.id, 'CASH', 'Cash', true),
      (r.id, 'CARD', 'Credit / Debit Card', true),
      (r.id, 'GCASH', 'GCash', true),
      (r.id, 'MAYA', 'Maya', true),
      (r.id, 'BANK_TRANSFER', 'Bank Transfer', true),
      (r.id, 'HMO', 'HMO / Insurance', true),
      (r.id, 'PHILHEALTH', 'PhilHealth', true)
    ON CONFLICT (tenant_id, code) DO NOTHING;
  END LOOP;

  -- Ensure composite tenant_id, id unique constraint for child foreign keys
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discount_types_tenant_id_id_key') THEN
    ALTER TABLE discount_types ADD CONSTRAINT discount_types_tenant_id_id_key UNIQUE (tenant_id, id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payment_methods_tenant_id_id_key') THEN
    ALTER TABLE payment_methods ADD CONSTRAINT payment_methods_tenant_id_id_key UNIQUE (tenant_id, id);
  END IF;
END $$;

-- 2. Cashier Shifts (BIL-T5, specification §11.1, §11.2)
CREATE TABLE IF NOT EXISTS cashier_shifts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    branch_id UUID NOT NULL,
    shift_no TEXT NOT NULL,
    cashier_id UUID NOT NULL,
    opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    opening_cash NUMERIC(14,2) NOT NULL DEFAULT 0,
    closed_at TIMESTAMPTZ,
    counted_cash NUMERIC(14,2),
    expected_cash NUMERIC(14,2),
    variance NUMERIC(14,2),
    notes TEXT,
    status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','CLOSED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id),
    FOREIGN KEY (tenant_id, cashier_id) REFERENCES users(tenant_id, id),
    CONSTRAINT cashier_shifts_tenant_id_id_key UNIQUE (tenant_id, id),
    CONSTRAINT cashier_shifts_shift_no_key UNIQUE (tenant_id, shift_no)
);

-- 3. Daily Cashier Summaries (JOB-48, BIL-T6, specification §11.1)
CREATE TABLE IF NOT EXISTS daily_cashier_summaries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    branch_id UUID NOT NULL,
    close_date DATE NOT NULL,
    total_invoiced NUMERIC(14,2) NOT NULL DEFAULT 0,
    total_collected NUMERIC(14,2) NOT NULL DEFAULT 0,
    total_cash NUMERIC(14,2) NOT NULL DEFAULT 0,
    total_card NUMERIC(14,2) NOT NULL DEFAULT 0,
    total_online NUMERIC(14,2) NOT NULL DEFAULT 0,
    total_hmo NUMERIC(14,2) NOT NULL DEFAULT 0,
    total_philhealth NUMERIC(14,2) NOT NULL DEFAULT 0,
    total_corporate NUMERIC(14,2) NOT NULL DEFAULT 0,
    total_discounts NUMERIC(14,2) NOT NULL DEFAULT 0,
    total_credit_notes NUMERIC(14,2) NOT NULL DEFAULT 0,
    open_shifts_count INTEGER NOT NULL DEFAULT 0,
    closed_by UUID,
    closed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    is_locked BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id),
    FOREIGN KEY (tenant_id, closed_by) REFERENCES users(tenant_id, id),
    CONSTRAINT daily_cashier_summaries_tenant_id_id_key UNIQUE (tenant_id, id),
    CONSTRAINT daily_cashier_summaries_uniq UNIQUE (tenant_id, branch_id, close_date)
);
