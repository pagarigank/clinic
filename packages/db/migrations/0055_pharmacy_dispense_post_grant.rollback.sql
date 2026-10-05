-- 0055_pharmacy_dispense_post_grant.rollback.sql
-- Undo exactly what 0055 did, in reverse order.

-- 1. tenant_admin dispense.post (only what 0055 could have added: not where the role
--    already holds rx.verify).
DELETE FROM role_permissions rp
USING roles r, permissions p, permissions verify_perm
WHERE rp.role_id = r.id
  AND rp.tenant_id = r.tenant_id
  AND rp.permission_id = p.id
  AND p.code = 'pharmacy.dispense.post'
  AND r.code = 'tenant_admin'
  AND r.tenant_id = '11111111-1111-4111-8111-111111111111'
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions e
    WHERE e.tenant_id = rp.tenant_id
      AND e.role_id = rp.role_id
      AND e.permission_id = verify_perm.id
      AND verify_perm.code = 'pharmacy.rx.verify'
  );

-- 2. grants for the two pharmacy roles, then the roles themselves.
DELETE FROM role_permissions rp
USING roles r
WHERE rp.role_id = r.id
  AND rp.tenant_id = r.tenant_id
  AND r.tenant_id = '11111111-1111-4111-8111-111111111111'
  AND r.code IN ('pharmacist_verifier', 'pharmacist_dispenser');

DELETE FROM roles
WHERE tenant_id = '11111111-1111-4111-8111-111111111111'
  AND code IN ('pharmacist_verifier', 'pharmacist_dispenser');

-- 3. The pharmacy.dispense.post catalogue row is intentionally left in place: it
--    predates this migration (it is what every grant was missing), and the rollback
--    above depends on resolving it by code.