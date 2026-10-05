-- 0056_lab_result_verify_roles.migration.sql
-- Fix: lab.result.verify was granted to NO role, so a result could never be verified.
--
-- AC-17 (specification §10) requires the person who enters a result to be a
-- different person from the one who verifies and releases it. The lab worklist,
-- result entry, verification queue, critical alerts, QC and report release all
-- exist as screens and endpoints, but the terminal step could not be performed:
--
--   POST /lab/results/:rid/verify -> 403 missing permission: lab.result.verify
--
-- leaving results in ENTERED and reports unreleased.
--
-- WHY TWO ROLES
-- sod_conflicts holds:
--
--     lab.result.enter + lab.result.verify
--     "result encoder must not verify (AC-17)"
--
-- and rbac.service.ts assertNoSoDConflicts() enforces it on every role write, so a
-- single role holding both is refused with 403 SEGREGATION_OF_DUTIES. The same trap
-- pharmacy.dispense.post fell into. So the seeded tenant — which had no laboratory
-- roles at all — gets the two identities the control requires:
--
--   lab_technologist -> reads the worklist, collects/receives/starts specimens,
--                       enters and amends results, records send-outs, QC, critical
--                       alert acknowledgement.
--   lab_verifier     -> verifies and releases results/reports, reads the worklist
--                       and the released reports.
--
-- tenant_admin keeps its existing laboratory rights (it already holds
-- lab.result.enter) and is granted lab.result.verify only where it does not already
-- hold lab.result.enter, so administration stays possible without one identity
-- satisfying the AC-17 pair.

-- ── 1. Make sure the permission exists (it is what every grant was missing) ─────
INSERT INTO permissions (code, description)
VALUES (
  'lab.result.verify',
  'Verify a result and release the report: independent of the encoder (AC-17)'
)
ON CONFLICT (code) DO NOTHING;

-- ── 2. The two roles ───────────────────────────────────────────────────────────
INSERT INTO roles (tenant_id, code, name, is_system)
VALUES
  ('11111111-1111-4111-8111-111111111111', 'lab_technologist',
   'Laboratory Technologist', true),
  ('11111111-1111-4111-8111-111111111111', 'lab_verifier',
   'Laboratory Verifier', true)
ON CONFLICT (tenant_id, code) DO NOTHING;

-- ── 3. Bench side: everything up to but not including verification ─────────────
INSERT INTO role_permissions (tenant_id, role_id, permission_id)
SELECT r.tenant_id, r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.tenant_id = '11111111-1111-4111-8111-111111111111'
  AND r.code = 'lab_technologist'
  AND p.code IN (
    -- exactly the permissions lab.controller.ts guards, bench side
    'lab.order.read',
    'lab.order.create',
    'lab.specimen.read',
    'lab.specimen.collect',   -- POST orders/:id/items/:iid/collect
    'lab.specimen.receive',   -- POST orders/:id/items/:iid/receive
    'lab.result.enter',       -- POST orders/:id/items/:iid/results
    'lab.result.amend',       -- POST results/:rid/amend
    'lab.result.read',
    'lab.critical.read',
    'lab.critical.ack',
    'lab.qc.read',
    'lab.qc.create',
    'lab.qc.update',
    'lab.qc.accept',
    'lab.qc.reject',
    'lab.sendout.create',
    'lab.sendout.read',
    'lab.config.read',
    'lab.config.create',
    'lab.config.update',
    'lab.interface.read',
    'lab.interface.write',
    -- reagent/consumable movements post against central supply
    'supply.stock.read',
    'supply.item.read'
  )
ON CONFLICT (tenant_id, role_id, permission_id) DO NOTHING;

-- ── 4. Verifier side: the independent check and the release ────────────────────
INSERT INTO role_permissions (tenant_id, role_id, permission_id)
SELECT r.tenant_id, r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.tenant_id = '11111111-1111-4111-8111-111111111111'
  AND r.code = 'lab_verifier'
  AND p.code IN (
    -- exactly the permissions lab.controller.ts guards, verification/release side
    'lab.order.read',
    'lab.specimen.read',
    'lab.result.read',
    'lab.result.verify',      -- POST results/:rid/verify
    'lab.report.read',
    'lab.report.release',
    'lab.critical.read',
    'lab.critical.ack',
    'lab.config.read'
  )
ON CONFLICT (tenant_id, role_id, permission_id) DO NOTHING;

-- ── 5. tenant_admin keeps administration without the AC-17 pair ────────────────
INSERT INTO role_permissions (tenant_id, role_id, permission_id)
SELECT r.tenant_id, r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.tenant_id = '11111111-1111-4111-8111-111111111111'
  AND r.code = 'tenant_admin'
  AND p.code = 'lab.result.verify'
  AND NOT EXISTS (
    SELECT 1
    FROM role_permissions existing
    JOIN permissions sib ON sib.id = existing.permission_id
    WHERE existing.tenant_id = r.tenant_id
      AND existing.role_id = r.id
      AND sib.code = 'lab.result.enter'
  )
ON CONFLICT (tenant_id, role_id, permission_id) DO NOTHING;