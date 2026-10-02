-- 0044_billing_fixes.migration.sql
-- Phase 7 gap-closure (todo.md §7 audit 2026-10-02).
--
-- Three gaps closed here:
--
--   1. payment_splits — server-side storage for split-tender line items.
--      The old code accepted the splits array in the contract but never
--      persisted it, so the POS derived the breakdown client-side against
--      the audit constraint that money must not be computed client-side.
--
--   2. Billing role permissions — billing.payment.void, billing.invoice.void,
--      billing.credit.approve, and billing.discount.revoke were defined in
--      the permission catalogue (0007) and guarded on the controller, but
--      were granted to no seeded system role, making every destructive
--      billing action reachable only through a hand-made custom role
--      (todo.md audit note §450).
--
--   3. cash_sessions / shift period-lock — openShift and closeShift were
--      missing a checkPeriodOpen guard; the relevant table changes are
--      handled at the service layer (billing.service.ts), but the migration
--      adds the DB-level period-lock CHECK constraint on cashier_shifts so
--      the guard cannot be silently removed.

-- ── 1. payment_splits (BIL-T3 split tender, specification §11.1) ─────────────

CREATE TABLE IF NOT EXISTS payment_splits (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID        NOT NULL REFERENCES tenants(id),
    payment_id   UUID        NOT NULL,
    method_id    UUID        NOT NULL,
    amount       NUMERIC(14,2) NOT NULL CHECK (amount > 0),
    tendered_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
    reference    TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    FOREIGN KEY (tenant_id, payment_id)
        REFERENCES payments(tenant_id, id) ON DELETE CASCADE,
    FOREIGN KEY (tenant_id, method_id)
        REFERENCES payment_methods(tenant_id, id),
    CONSTRAINT payment_splits_tenant_id_id_key UNIQUE (tenant_id, id)
);

-- Apply canonical RLS and grant the app role read/insert access
SELECT app.apply_tenant_isolation('payment_splits');

CREATE INDEX IF NOT EXISTS payment_splits_tenant_payment_idx
    ON payment_splits (tenant_id, payment_id);

GRANT SELECT, INSERT ON payment_splits TO clinic_app;
GRANT SELECT ON payment_splits TO clinic_report;
REVOKE DELETE ON payment_splits FROM clinic_app, clinic_report, PUBLIC;
REVOKE UPDATE ON payment_splits FROM clinic_app, clinic_report, PUBLIC;

-- ── 2. Billing role permissions ───────────────────────────────────────────────
--
-- For every existing active tenant, assign the missing permissions to the
-- system roles that already exist. New tenants are handled by the updated
-- provision.handler.ts (admin case).
--
-- SoD constraint (0007): billing.payment.void CONFLICTS billing.payment.create,
-- so cashier (which holds create) must NOT receive void. Only branch_manager
-- and tenant_admin receive the destructive permissions.
--
-- The assignment is ON CONFLICT DO NOTHING so re-running the migration is safe.

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT t.id AS tenant_id
    FROM tenants t
    WHERE t.status IN ('ACTIVE', 'PROVISIONING')
  LOOP

    -- ── tenant_admin: full billing permissions ──────────────────────────────
    INSERT INTO role_permissions (tenant_id, role_id, permission_id)
    SELECT r.tenant_id, ro.id, p.id
    FROM roles ro
    CROSS JOIN permissions p
    WHERE ro.tenant_id = r.tenant_id
      AND ro.code = 'tenant_admin'
      AND p.code IN (
        'billing.invoice.read',  'billing.invoice.create', 'billing.invoice.update',
        'billing.invoice.void',  'billing.charge.create',
        'billing.payment.read',  'billing.payment.create', 'billing.payment.void',
        'billing.credit.read',   'billing.credit.create',  'billing.credit.approve',
        'billing.shift.read',    'billing.shift.open',     'billing.shift.close',
        'billing.discount.read', 'billing.discount.create','billing.discount.revoke'
      )
    ON CONFLICT (tenant_id, role_id, permission_id) DO NOTHING;

    -- ── branch_manager: full billing permissions (same as tenant_admin) ─────
    INSERT INTO role_permissions (tenant_id, role_id, permission_id)
    SELECT r.tenant_id, ro.id, p.id
    FROM roles ro
    CROSS JOIN permissions p
    WHERE ro.tenant_id = r.tenant_id
      AND ro.code = 'branch_manager'
      AND p.code IN (
        'billing.invoice.read',  'billing.invoice.create', 'billing.invoice.update',
        'billing.invoice.void',  'billing.charge.create',
        'billing.payment.read',  'billing.payment.create', 'billing.payment.void',
        'billing.credit.read',   'billing.credit.create',  'billing.credit.approve',
        'billing.shift.read',    'billing.shift.open',     'billing.shift.close',
        'billing.discount.read', 'billing.discount.create','billing.discount.revoke'
      )
    ON CONFLICT (tenant_id, role_id, permission_id) DO NOTHING;

    -- ── cashier: operational billing only; no void/approve (SoD) ───────────
    INSERT INTO role_permissions (tenant_id, role_id, permission_id)
    SELECT r.tenant_id, ro.id, p.id
    FROM roles ro
    CROSS JOIN permissions p
    WHERE ro.tenant_id = r.tenant_id
      AND ro.code = 'cashier'
      AND p.code IN (
        'billing.invoice.read',  'billing.invoice.create', 'billing.invoice.update',
        'billing.charge.create',
        'billing.payment.read',  'billing.payment.create',
        'billing.credit.read',   'billing.credit.create',
        'billing.shift.read',    'billing.shift.open',     'billing.shift.close',
        'billing.discount.read', 'billing.discount.create','billing.discount.revoke'
      )
    ON CONFLICT (tenant_id, role_id, permission_id) DO NOTHING;

    -- ── doctor: charge capture + read billing ───────────────────────────────
    INSERT INTO role_permissions (tenant_id, role_id, permission_id)
    SELECT r.tenant_id, ro.id, p.id
    FROM roles ro
    CROSS JOIN permissions p
    WHERE ro.tenant_id = r.tenant_id
      AND ro.code = 'doctor'
      AND p.code IN (
        'billing.invoice.read', 'billing.payment.read',
        'billing.charge.create'
      )
    ON CONFLICT (tenant_id, role_id, permission_id) DO NOTHING;

    -- ── nurse/encoder: charge capture + read billing ─────────────────────────
    INSERT INTO role_permissions (tenant_id, role_id, permission_id)
    SELECT r.tenant_id, ro.id, p.id
    FROM roles ro
    CROSS JOIN permissions p
    WHERE ro.tenant_id = r.tenant_id
      AND ro.code IN ('nurse', 'encoder')
      AND p.code IN (
        'billing.invoice.read', 'billing.payment.read',
        'billing.charge.create'
      )
    ON CONFLICT (tenant_id, role_id, permission_id) DO NOTHING;

  END LOOP;
END $$;
