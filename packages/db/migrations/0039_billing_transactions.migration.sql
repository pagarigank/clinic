-- 0039_billing_transactions.migration.sql
-- Phase 7: Invoices, Invoice Lines, Discount Applications, Payments, Allocations, Reprints, Credit Notes

-- 1. Invoices (specification §11.1, §11.2, todo.md §7.1)
CREATE TABLE IF NOT EXISTS invoices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    branch_id UUID NOT NULL,
    invoice_no TEXT NOT NULL,
    patient_id UUID REFERENCES patients(id),
    visit_id UUID REFERENCES visits(id),
    status TEXT NOT NULL DEFAULT 'DRAFT'
        CHECK (status IN ('DRAFT','OPEN','PARTIAL','PAID','VOID')),
    subtotal NUMERIC(14,2) NOT NULL DEFAULT 0,
    discount_total NUMERIC(14,2) NOT NULL DEFAULT 0,
    tax_total NUMERIC(14,2) NOT NULL DEFAULT 0,
    total NUMERIC(14,2) NOT NULL DEFAULT 0,
    paid_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
    balance NUMERIC(14,2) NOT NULL DEFAULT 0,
    payer_type TEXT NOT NULL DEFAULT 'PRIVATE_CASH'
        CHECK (payer_type IN ('PRIVATE_CASH','HMO','PHILHEALTH','CORPORATE')),
    notes TEXT,
    issued_at TIMESTAMPTZ,
    due_at TIMESTAMPTZ,
    voided_at TIMESTAMPTZ,
    voided_by UUID,
    void_reason TEXT,
    created_by UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id),
    FOREIGN KEY (tenant_id, patient_id) REFERENCES patients(tenant_id, id),
    FOREIGN KEY (tenant_id, visit_id) REFERENCES visits(tenant_id, id),
    FOREIGN KEY (tenant_id, created_by) REFERENCES users(tenant_id, id),
    FOREIGN KEY (tenant_id, voided_by) REFERENCES users(tenant_id, id),
    CONSTRAINT invoices_tenant_id_id_key UNIQUE (tenant_id, id),
    CONSTRAINT invoices_invoice_no_key UNIQUE (tenant_id, invoice_no)
);

-- 2. Invoice Lines (specification §11.1, §11.2, Q-17 PF separation)
CREATE TABLE IF NOT EXISTS invoice_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    invoice_id UUID NOT NULL,
    line_no INTEGER NOT NULL DEFAULT 1,
    source_type TEXT NOT NULL
        CHECK (source_type IN ('SERVICE','LAB','PHARMACY','SUPPLY','PROCEDURE','CONSULT','MANUAL','CHARGE')),
    source_id UUID,
    description TEXT NOT NULL,
    qty NUMERIC(12,2) NOT NULL DEFAULT 1,
    unit_price NUMERIC(14,2) NOT NULL,
    subtotal NUMERIC(14,2) NOT NULL,
    discount_type_id UUID,
    discount_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
    tax_code TEXT NOT NULL DEFAULT 'VAT_EXEMPT',
    tax_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
    net_amount NUMERIC(14,2) NOT NULL,
    payer_type TEXT NOT NULL DEFAULT 'PRIVATE_CASH'
        CHECK (payer_type IN ('PRIVATE_CASH','HMO','PHILHEALTH','CORPORATE')),
    is_professional_fee BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    FOREIGN KEY (tenant_id, invoice_id) REFERENCES invoices(tenant_id, id) ON DELETE CASCADE,
    FOREIGN KEY (tenant_id, discount_type_id) REFERENCES discount_types(tenant_id, id),
    CONSTRAINT invoice_lines_tenant_id_id_key UNIQUE (tenant_id, id),
    CONSTRAINT invoice_lines_line_no_key UNIQUE (tenant_id, invoice_id, line_no)
);

-- 3. Discount Applications (specification §11.1, BIL-T2 ID capture)
CREATE TABLE IF NOT EXISTS discount_applications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    invoice_id UUID NOT NULL,
    invoice_line_id UUID,
    discount_type_id UUID NOT NULL,
    id_number TEXT,
    id_type TEXT,
    discount_amount NUMERIC(14,2) NOT NULL,
    verified_by UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    FOREIGN KEY (tenant_id, invoice_id) REFERENCES invoices(tenant_id, id) ON DELETE CASCADE,
    FOREIGN KEY (tenant_id, invoice_line_id) REFERENCES invoice_lines(tenant_id, id) ON DELETE CASCADE,
    FOREIGN KEY (tenant_id, discount_type_id) REFERENCES discount_types(tenant_id, id),
    FOREIGN KEY (tenant_id, verified_by) REFERENCES users(tenant_id, id),
    CONSTRAINT discount_applications_tenant_id_id_key UNIQUE (tenant_id, id)
);

-- 4. Payments (specification §11.1, §11.2, BIL-T3 split tender)
CREATE TABLE IF NOT EXISTS payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    branch_id UUID NOT NULL,
    shift_id UUID,
    payment_no TEXT NOT NULL,
    patient_id UUID REFERENCES patients(id),
    invoice_id UUID,
    method_id UUID NOT NULL,
    amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
    tendered_amount NUMERIC(14,2) NOT NULL,
    change_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
    reference TEXT,
    payer_type TEXT NOT NULL DEFAULT 'PRIVATE_CASH'
        CHECK (payer_type IN ('PRIVATE_CASH','HMO','PHILHEALTH','CORPORATE')),
    received_by UUID NOT NULL,
    received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    reprint_count INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'POSTED'
        CHECK (status IN ('POSTED','VOIDED')),
    voided_at TIMESTAMPTZ,
    voided_by UUID,
    void_reason TEXT,
    FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id),
    FOREIGN KEY (tenant_id, shift_id) REFERENCES cashier_shifts(tenant_id, id),
    FOREIGN KEY (tenant_id, invoice_id) REFERENCES invoices(tenant_id, id),
    FOREIGN KEY (tenant_id, patient_id) REFERENCES patients(tenant_id, id),
    FOREIGN KEY (tenant_id, method_id) REFERENCES payment_methods(tenant_id, id),
    FOREIGN KEY (tenant_id, received_by) REFERENCES users(tenant_id, id),
    FOREIGN KEY (tenant_id, voided_by) REFERENCES users(tenant_id, id),
    CONSTRAINT payments_tenant_id_id_key UNIQUE (tenant_id, id),
    CONSTRAINT payments_payment_no_key UNIQUE (tenant_id, payment_no)
);

-- 5. Payment Allocations (specification §11.1, multi-invoice or line settlement)
CREATE TABLE IF NOT EXISTS payment_allocations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    payment_id UUID NOT NULL,
    invoice_id UUID NOT NULL,
    amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    FOREIGN KEY (tenant_id, payment_id) REFERENCES payments(tenant_id, id) ON DELETE CASCADE,
    FOREIGN KEY (tenant_id, invoice_id) REFERENCES invoices(tenant_id, id),
    CONSTRAINT payment_allocations_tenant_id_id_key UNIQUE (tenant_id, id)
);

-- 6. Payment Reprints (todo.md §7.2, audited reprint log)
CREATE TABLE IF NOT EXISTS payment_reprints (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    payment_id UUID NOT NULL,
    reprinted_by UUID NOT NULL,
    reprinted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    reason TEXT NOT NULL,
    format TEXT NOT NULL DEFAULT 'PDF' CHECK (format IN ('PDF','THERMAL')),
    FOREIGN KEY (tenant_id, payment_id) REFERENCES payments(tenant_id, id),
    FOREIGN KEY (tenant_id, reprinted_by) REFERENCES users(tenant_id, id),
    CONSTRAINT payment_reprints_tenant_id_id_key UNIQUE (tenant_id, id)
);

-- 7. Credit Notes (specification §11.1, §11.2, BIL-T4)
CREATE TABLE IF NOT EXISTS credit_notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    branch_id UUID NOT NULL,
    cn_no TEXT NOT NULL,
    invoice_id UUID NOT NULL,
    amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
    reason TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'DRAFT'
        CHECK (status IN ('DRAFT','APPROVED','CANCELLED')),
    created_by UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    approved_by UUID,
    approved_at TIMESTAMPTZ,
    FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id),
    FOREIGN KEY (tenant_id, invoice_id) REFERENCES invoices(tenant_id, id),
    FOREIGN KEY (tenant_id, created_by) REFERENCES users(tenant_id, id),
    FOREIGN KEY (tenant_id, approved_by) REFERENCES users(tenant_id, id),
    CONSTRAINT credit_notes_tenant_id_id_key UNIQUE (tenant_id, id),
    CONSTRAINT credit_notes_cn_no_key UNIQUE (tenant_id, cn_no)
);

-- 8. Link billing_charges to invoice
ALTER TABLE billing_charges ADD COLUMN IF NOT EXISTS invoice_id UUID;
ALTER TABLE billing_charges ADD COLUMN IF NOT EXISTS invoice_line_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'billing_charges_invoice_fk') THEN
    ALTER TABLE billing_charges
      ADD CONSTRAINT billing_charges_invoice_fk
      FOREIGN KEY (tenant_id, invoice_id) REFERENCES invoices(tenant_id, id);
  END IF;
END $$;

-- 9. Financial Immutability Trigger (Ground Rule G-03)
-- Posted payment amounts and targets cannot be mutated. Only void status/reprints may change.
CREATE OR REPLACE FUNCTION app.fn_guard_posted_payment_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'VOIDED' THEN
    RAISE EXCEPTION 'Voided payments cannot be modified';
  END IF;

  IF OLD.status = 'POSTED' AND NEW.status = 'POSTED' THEN
    IF OLD.amount IS DISTINCT FROM NEW.amount
       OR OLD.payment_no IS DISTINCT FROM NEW.payment_no
       OR OLD.method_id IS DISTINCT FROM NEW.method_id
       OR OLD.tendered_amount IS DISTINCT FROM NEW.tendered_amount
       OR OLD.invoice_id IS DISTINCT FROM NEW.invoice_id
       OR OLD.tenant_id IS DISTINCT FROM NEW.tenant_id
       OR OLD.branch_id IS DISTINCT FROM NEW.branch_id THEN
      RAISE EXCEPTION 'Posted payment details are immutable; use void and reversal';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_posted_payment_mutation ON payments;
CREATE TRIGGER trg_guard_posted_payment_mutation
BEFORE UPDATE ON payments
FOR EACH ROW EXECUTE FUNCTION app.fn_guard_posted_payment_mutation();
