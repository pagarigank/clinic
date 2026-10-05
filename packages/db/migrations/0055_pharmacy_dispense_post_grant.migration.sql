-- 0055_pharmacy_dispense_post_grant.migration.sql
-- Fix: pharmacy.dispense.post was granted to NO role, so a dispense could never be
-- posted.
--
-- PHM-T2 (specification §9.3) requires posting a dispense to move stock, write the
-- DISPENSE movement, charge the invoice and flip the Rx to DISPENSED, all in one
-- transaction. The workbench creates the draft and allocates FEFO (both 201), then:
--
--   POST /pharmacy/dispenses/:id/post -> 403 missing permission: pharmacy.dispense.post
--
-- leaving the record at DRAFT with no stock movement while the UI reported success.
--
-- WHY TWO ROLES, NOT ONE "pharmacist" WITH BOTH RIGHTS
-- sod_conflicts contains:
--
--     pharmacy.rx.verify + pharmacy.dispense.post
--     "verification must be independent of dispensing"
--
-- and rbac.service.ts assertNoSoDConflicts() enforces it at runtime on every role
-- write, so this is not merely seed hygiene — assigning both to one role is refused
-- with 403 SEGREGATION_OF_DUTIES. G-11 requires the same thing ("entry != verify").
--
-- The seeded tenant had no pharmacy roles at all, even though specification §2 defines
-- a PHARMACIST persona and the verification queue already expects someone to work it.
-- So this creates the two identities the control requires:
--
--   pharmacist_verifier -> rx.verify / rx.intervene (+ read). Clinical check only.
--   pharmacist_dispenser-> dispense.* (create/update/post/read) + controlled.*.
--                          Releases stock, writes movements, charges the invoice.
--
-- A real clinic runs this as two logins on the same bench (or the same person
-- switching roles with a step-up), which is precisely the independence G-11 wants.

-- ── 1. Make sure the permission exists (it is what every grant was missing) ─────
-- The catalogue row already ships with the schema; this only guards against a tenant
-- provisioned without it.
INSERT INTO permissions (code, description)
VALUES (
  'pharmacy.dispense.post',
  'Post a dispense: move stock, write movements, charge the invoice and update Rx status in one transaction'
)
ON CONFLICT (code) DO NOTHING;

-- ── 2. The two roles ───────────────────────────────────────────────────────────
INSERT INTO roles (tenant_id, code, name, is_system)
VALUES
  ('11111111-1111-4111-8111-111111111111', 'pharmacist_verifier',
   'Pharmacist — Verification', true),
  ('11111111-1111-4111-8111-111111111111', 'pharmacist_dispenser',
   'Pharmacist — Dispensing', true)
ON CONFLICT (tenant_id, code) DO NOTHING;

-- ── 3. Clinical verification side (PHM-T1) ─────────────────────────────────────
INSERT INTO role_permissions (tenant_id, role_id, permission_id)
SELECT r.tenant_id, r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.tenant_id = '11111111-1111-4111-8111-111111111111'
  AND r.code = 'pharmacist_verifier'
  AND p.code IN (
    'pharmacy.rx.read',
    'pharmacy.rx.verify',
    'pharmacy.rx.intervene',
    'pharmacy.product.read',
    'pharmacy.controlled.read'
  )
ON CONFLICT (tenant_id, role_id, permission_id) DO NOTHING;

-- ── 4. Dispensing side (PHM-T2 / PHM-T4) ───────────────────────────────────────
INSERT INTO role_permissions (tenant_id, role_id, permission_id)
SELECT r.tenant_id, r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.tenant_id = '11111111-1111-4111-8111-111111111111'
  AND r.code = 'pharmacist_dispenser'
  AND p.code IN (
    'pharmacy.stock.read',
    'pharmacy.rx.read',
    'pharmacy.dispense.read',
    'pharmacy.dispense.create',
    'pharmacy.dispense.update',
    'pharmacy.dispense.post',
    'pharmacy.product.read',
    'pharmacy.controlled.read',
    'pharmacy.controlled.dispense',
    'pharmacy.controlled.witness'
  )
ON CONFLICT (tenant_id, role_id, permission_id) DO NOTHING;

-- ── 5. tenant_admin keeps administration without the clinical gate ─────────────
-- Give tenant_admin dispense.post only where it does NOT already hold rx.verify, so
-- no single identity satisfies the SoD pair.
INSERT INTO role_permissions (tenant_id, role_id, permission_id)
SELECT r.tenant_id, r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.tenant_id = '11111111-1111-4111-8111-111111111111'
  AND r.code = 'tenant_admin'
  AND p.code = 'pharmacy.dispense.post'
  AND NOT EXISTS (
    SELECT 1
    FROM role_permissions existing
    JOIN permissions sib ON sib.id = existing.permission_id
    WHERE existing.tenant_id = r.tenant_id
      AND existing.role_id = r.id
      AND sib.code = 'pharmacy.rx.verify'
  )
ON CONFLICT (tenant_id, role_id, permission_id) DO NOTHING;