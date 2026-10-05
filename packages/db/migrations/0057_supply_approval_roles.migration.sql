-- 0057_supply_approval_roles.migration.sql
-- Fix: four supply permissions were granted to NO role, so three different
-- controlled flows could never be completed.
--
--   supply.po.approve       0 roles   purchase order creator could submit forever
--   supply.adjust.approve   0 roles   stock adjustment could never be approved
--   supply.adjust.post      0 roles   approved adjustment could never hit stock
--   supply.invoice.match    0 roles   received goods could never be 3-way matched
--
-- Every sibling in each family had exactly one role; these four were simply missed.
-- The practical effect was that requisitions, adjustments and GRN matching all
-- dead-ended in DRAFT/SUBMITTED with no terminal action available to anyone.
--
-- WHY THIS NEEDS THREE ROLES, NOT ONE
-- supply chains are three-legged, and sod_conflicts encodes each hop separately:
--
--   supply.po.submit      + supply.po.approve       creator must not approve
--   supply.adjust.submit  + supply.adjust.approve   adjustment creator must not approve
--   supply.adjust.approve + supply.adjust.post      approver must not post
--   supply.grn.post       + supply.invoice.match     receiver must not 3-way match
--
-- G-11 requires the same ("PO create != approve", "adjustment request != approve").
-- rbac.service.ts assertNoSoDConflicts() enforces every pair on each role write, so
-- a single "supply officer" role would be refused outright. The seeded tenant had no
-- supply roles at all, so this creates the three identities the model intends:
--
--   storekeeper        -> raise requisitions/POs/adjustments/GRNs, receive goods,
--                         issue stock, count. Prepares everything, approves nothing.
--   supply_approver    -> approve purchase orders and stock adjustments. Does not
--                         post adjustments (the third leg), does not receive goods.
--   inventory_controller -> post approved adjustments, 3-way match invoices against
--                         the PO and GRN. Closes the loop and owns the ledger.
--
-- A real store runs this as three people or one person switching roles with a
-- step-up, which is exactly the independence G-11 asks for.

-- ── 1. The four permissions already exist in the catalogue (they are what the grants
--       were missing); nothing to insert. ───────────────────────────────────────────

-- ── 2. The three roles ───────────────────────────────────────────────────────────
INSERT INTO roles (tenant_id, code, name, is_system)
VALUES
  ('11111111-1111-4111-8111-111111111111', 'storekeeper',
   'Storekeeper', true),
  ('11111111-1111-4111-8111-111111111111', 'supply_approver',
   'Supply Approver', true),
  ('11111111-1111-4111-8111-111111111111', 'inventory_controller',
   'Inventory Controller', true)
ON CONFLICT (tenant_id, code) DO NOTHING;

-- ── 3. Prepares everything, approves nothing ─────────────────────────────────────
INSERT INTO role_permissions (tenant_id, role_id, permission_id)
SELECT r.tenant_id, r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.tenant_id = '11111111-1111-4111-8111-111111111111'
  AND r.code = 'storekeeper'
  AND p.code IN (
    -- item / location master
    'supply.item.read', 'supply.item.create', 'supply.item.update', 'supply.item.delete',
    'supply.location.read', 'supply.location.create', 'supply.location.update', 'supply.location.delete',
    -- requisitions and issues
    'supply.req.read', 'supply.req.create', 'supply.req.submit',
    'supply.req.cancel', 'supply.req.reject', 'supply.req.receive',
    'supply.issue.read', 'supply.issue.create', 'supply.issue.update', 'supply.issue.post',
    -- purchasing: raise and submit, never approve
    'supply.po.create', 'supply.po.submit',
    -- goods receipt: create and post receipts
    'supply.grn.read', 'supply.grn.create', 'supply.grn.update', 'supply.grn.post', 'supply.grn.void',
    'supply.invoice.read', 'supply.invoice.create', 'supply.invoice.update',
    -- stock adjustments: raise and submit, never approve or post
    'supply.adjust.read', 'supply.adjust.create', 'supply.adjust.submit',
    'supply.adjust.reject', 'supply.adjust.void',
    -- counts
    'supply.count.read', 'supply.count.create', 'supply.count.update',
    'supply.count.submit', 'supply.count.post', 'supply.count.recount',
    -- batches
    'supply.batch.quarantine', 'supply.batch.release',
    -- disposals
    'supply.dispose.read', 'supply.dispose.create', 'supply.dispose.post',
    'supply.dispose.witness', 'supply.dispose.certificate',
    -- consumptions (issued against a patient encounter)
    'supply.consumption.create',
    -- reads needed to render the dashboards and workbenches
    'supply.stock.read'
  )
ON CONFLICT (tenant_id, role_id, permission_id) DO NOTHING;

-- ── 4. Approves requisitions and adjustments; does not post them ──────────────────
INSERT INTO role_permissions (tenant_id, role_id, permission_id)
SELECT r.tenant_id, r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.tenant_id = '11111111-1111-4111-8111-111111111111'
  AND r.code = 'supply_approver'
  AND p.code IN (
    'supply.req.read', 'supply.req.approve', 'supply.req.reject',
    'supply.po.read', 'supply.po.approve',
    'supply.adjust.read', 'supply.adjust.approve',
    'supply.count.read', 'supply.count.approve',
    'supply.item.read', 'supply.location.read', 'supply.stock.read',
    'supply.grn.read', 'supply.issue.read'
  )
ON CONFLICT (tenant_id, role_id, permission_id) DO NOTHING;

-- ── 5. Closes the loop and owns the ledger ───────────────────────────────────────
INSERT INTO role_permissions (tenant_id, role_id, permission_id)
SELECT r.tenant_id, r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.tenant_id = '11111111-1111-4111-8111-111111111111'
  AND r.code = 'inventory_controller'
  AND p.code IN (
    -- third leg of the adjustment chain: post what has been approved
    'supply.adjust.read', 'supply.adjust.post',
    -- 3-way match against PO + GRN (and deliberately NOT grn.post)
    'supply.invoice.read', 'supply.invoice.match',
    'supply.po.read',
    'supply.grn.read',
    'supply.count.read', 'supply.count.approve',
    'supply.item.read', 'supply.location.read', 'supply.stock.read',
    'supply.batch.quarantine', 'supply.batch.release',
    'supply.dispose.read', 'supply.dispose.post', 'supply.dispose.certificate'
  )
ON CONFLICT (tenant_id, role_id, permission_id) DO NOTHING;