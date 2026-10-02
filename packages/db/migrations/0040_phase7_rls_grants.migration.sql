-- 0040_phase7_rls_grants.migration.sql
-- Phase 7: RLS Policies, Tenant Indexes, and Role Grants for Billing & Cashiering

-- 1. Apply canonical RLS policies (ENABLE RLS, FORCE RLS, RESTRICTIVE tenant policy)
SELECT app.apply_tenant_isolation('cashier_shifts');
SELECT app.apply_tenant_isolation('daily_cashier_summaries');
SELECT app.apply_tenant_isolation('invoices');
SELECT app.apply_tenant_isolation('invoice_lines');
SELECT app.apply_tenant_isolation('discount_applications');
SELECT app.apply_tenant_isolation('payments');
SELECT app.apply_tenant_isolation('payment_allocations');
SELECT app.apply_tenant_isolation('payment_reprints');
SELECT app.apply_tenant_isolation('credit_notes');

-- 2. Tenant index requirements for schema-linter and query performance
CREATE INDEX IF NOT EXISTS cashier_shifts_tenant_idx ON cashier_shifts (tenant_id);
CREATE INDEX IF NOT EXISTS cashier_shifts_tenant_branch_status_idx ON cashier_shifts (tenant_id, branch_id, status);
CREATE INDEX IF NOT EXISTS cashier_shifts_tenant_cashier_idx ON cashier_shifts (tenant_id, cashier_id);

CREATE INDEX IF NOT EXISTS daily_cashier_summaries_tenant_idx ON daily_cashier_summaries (tenant_id);
CREATE INDEX IF NOT EXISTS daily_cashier_summaries_tenant_date_idx ON daily_cashier_summaries (tenant_id, branch_id, close_date);

CREATE INDEX IF NOT EXISTS invoices_tenant_idx ON invoices (tenant_id);
CREATE INDEX IF NOT EXISTS invoices_tenant_branch_status_idx ON invoices (tenant_id, branch_id, status);
CREATE INDEX IF NOT EXISTS invoices_tenant_patient_idx ON invoices (tenant_id, patient_id);
CREATE INDEX IF NOT EXISTS invoices_tenant_visit_idx ON invoices (tenant_id, visit_id);

CREATE INDEX IF NOT EXISTS invoice_lines_tenant_idx ON invoice_lines (tenant_id);
CREATE INDEX IF NOT EXISTS invoice_lines_tenant_invoice_idx ON invoice_lines (tenant_id, invoice_id);

CREATE INDEX IF NOT EXISTS discount_applications_tenant_idx ON discount_applications (tenant_id);
CREATE INDEX IF NOT EXISTS discount_applications_tenant_invoice_idx ON discount_applications (tenant_id, invoice_id);

CREATE INDEX IF NOT EXISTS payments_tenant_idx ON payments (tenant_id);
CREATE INDEX IF NOT EXISTS payments_tenant_invoice_idx ON payments (tenant_id, invoice_id);
CREATE INDEX IF NOT EXISTS payments_tenant_shift_idx ON payments (tenant_id, shift_id);
CREATE INDEX IF NOT EXISTS payments_tenant_no_idx ON payments (tenant_id, payment_no);

CREATE INDEX IF NOT EXISTS payment_allocations_tenant_idx ON payment_allocations (tenant_id);
CREATE INDEX IF NOT EXISTS payment_allocations_tenant_payment_idx ON payment_allocations (tenant_id, payment_id);
CREATE INDEX IF NOT EXISTS payment_allocations_tenant_invoice_idx ON payment_allocations (tenant_id, invoice_id);

CREATE INDEX IF NOT EXISTS payment_reprints_tenant_idx ON payment_reprints (tenant_id);
CREATE INDEX IF NOT EXISTS payment_reprints_tenant_payment_idx ON payment_reprints (tenant_id, payment_id);

CREATE INDEX IF NOT EXISTS credit_notes_tenant_idx ON credit_notes (tenant_id);
CREATE INDEX IF NOT EXISTS credit_notes_tenant_invoice_idx ON credit_notes (tenant_id, invoice_id);

-- 3. Grants for Application Role (clinic_app)
GRANT SELECT, INSERT, UPDATE, DELETE ON
  cashier_shifts, invoices, invoice_lines, discount_applications, credit_notes
TO clinic_app;

GRANT SELECT, INSERT, UPDATE ON payments, daily_cashier_summaries TO clinic_app;
GRANT SELECT, INSERT ON payment_allocations, payment_reprints TO clinic_app;

-- Append-only / financial protections
REVOKE DELETE ON payments, payment_allocations, payment_reprints, daily_cashier_summaries FROM clinic_app, clinic_report, PUBLIC;
REVOKE UPDATE ON payment_allocations, payment_reprints FROM clinic_app, clinic_report, PUBLIC;

-- 4. Grants for Reporting Role (clinic_report)
GRANT SELECT ON
  cashier_shifts, daily_cashier_summaries, invoices, invoice_lines,
  discount_applications, payments, payment_allocations, payment_reprints, credit_notes
TO clinic_report;
