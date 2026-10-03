-- 0045_cash_sessions.migration.sql
-- Cashier POS server-side state (todo.md §7.3)

CREATE TABLE IF NOT EXISTS cash_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    branch_id UUID NOT NULL,
    cashier_id UUID NOT NULL,
    status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'HELD', 'COMPLETED', 'VOIDED')),
    patient_id UUID REFERENCES patients(id),
    invoice_id UUID REFERENCES invoices(id),
    session_data JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    row_version INTEGER NOT NULL DEFAULT 1,
    FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id),
    FOREIGN KEY (tenant_id, cashier_id) REFERENCES users(tenant_id, id)
);

CREATE INDEX cash_sessions_tenant_idx ON cash_sessions (tenant_id, cashier_id, status);

ALTER TABLE cash_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash_sessions FORCE ROW LEVEL SECURITY;
CREATE POLICY cash_sessions_tenant_isolation ON cash_sessions
    AS RESTRICTIVE FOR ALL USING (tenant_id = (SELECT app.tenant_id()));
CREATE POLICY cash_sessions_tenant_write ON cash_sessions
    FOR ALL USING (tenant_id = (SELECT app.tenant_id()));
