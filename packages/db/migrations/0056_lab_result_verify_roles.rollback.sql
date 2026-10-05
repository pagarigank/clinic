-- 0056_lab_result_verify_roles.rollback.sql
-- Undo exactly what 0056 did, in reverse order.

-- SAFETY (must run before any destructive statement in this file)
--
-- Deleting a role cascades away user_roles, which silently strips the role from every
-- user who held it: the grants come back on the next migration run but the
-- assignments do not, so effective permissions come back empty and every route 403s
-- with a permission that the role plainly should have. That happened twice during
-- development (0055 and 0056) and it is invisible unless you go looking.
--
-- Refuse to roll back while anyone is still assigned, so this fails loudly and
-- atomically instead of half-reverting.
DO $$
DECLARE
  assigned integer;
BEGIN
  SELECT count(*) INTO assigned
  FROM user_roles ur
  WHERE ur.role_id IN (
    SELECT id FROM roles
    WHERE tenant_id = '11111111-1111-4111-8111-111111111111'
      AND code IN ('lab_technologist', 'lab_verifier')
  );
  IF assigned > 0 THEN
    RAISE EXCEPTION
      'refusing to roll back: % user(s) still assigned these roles; remove the assignments first',
      assigned;
  END IF;
END $$;

-- 1. tenant_admin lab.result.verify (only what 0056 could have added: not where the
--    role already holds lab.result.enter).
DELETE FROM role_permissions rp
USING roles r, permissions p, permissions enter_perm
WHERE rp.role_id = r.id
  AND rp.tenant_id = r.tenant_id
  AND rp.permission_id = p.id
  AND p.code = 'lab.result.verify'
  AND r.code = 'tenant_admin'
  AND r.tenant_id = '11111111-1111-4111-8111-111111111111'
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions e
    WHERE e.tenant_id = rp.tenant_id
      AND e.role_id = rp.role_id
      AND e.permission_id = enter_perm.id
      AND enter_perm.code = 'lab.result.enter'
  );

-- 2. grants for the two laboratory roles, then the roles themselves.
DELETE FROM role_permissions rp
USING roles r
WHERE rp.role_id = r.id
  AND rp.tenant_id = r.tenant_id
  AND r.tenant_id = '11111111-1111-4111-8111-111111111111'
  AND r.code IN ('lab_technologist', 'lab_verifier');

DELETE FROM roles
WHERE tenant_id = '11111111-1111-4111-8111-111111111111'
  AND code IN ('lab_technologist', 'lab_verifier');

-- 3. The lab.result.verify catalogue row is intentionally left in place: it predates
--    this migration (it is what every grant was missing), and the statements above
--    resolve it by code.