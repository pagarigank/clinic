-- 0057_supply_approval_roles.rollback.sql
-- Undo exactly what 0057 did, in reverse order.

-- SAFETY (must run before any destructive statement in this file)
--
-- Deleting a role cascades away user_roles, which silently strips the role from every
-- user who held it: the grants come back on the next migration run but the
-- assignments do not, so effective permissions come back empty and every route 403s
-- with a permission the role plainly should have. That happened during development on
-- 0055 and 0056 and it is invisible unless you go looking.
DO $$
DECLARE
  assigned integer;
BEGIN
  SELECT count(*) INTO assigned
  FROM user_roles ur
  WHERE ur.role_id IN (
    SELECT id FROM roles
    WHERE tenant_id = '11111111-1111-4111-8111-111111111111'
      AND code IN ('storekeeper', 'supply_approver', 'inventory_controller')
  );
  IF assigned > 0 THEN
    RAISE EXCEPTION
      'refusing to roll back: % user(s) still assigned these roles; remove the assignments first',
      assigned;
  END IF;
END $$;

-- 1. grants for the three supply roles
DELETE FROM role_permissions rp
USING roles r
WHERE rp.role_id = r.id
  AND rp.tenant_id = r.tenant_id
  AND r.tenant_id = '11111111-1111-4111-8111-111111111111'
  AND r.code IN ('storekeeper', 'supply_approver', 'inventory_controller');

-- 2. the roles themselves
DELETE FROM roles
WHERE tenant_id = '11111111-1111-4111-8111-111111111111'
  AND code IN ('storekeeper', 'supply_approver', 'inventory_controller');

-- 3. The four permission rows (supply.po.approve, supply.adjust.approve,
--    supply.adjust.post, supply.invoice.match) are intentionally left in place: they
--    predate this migration and are what every grant was missing. Removing them would
--    also orphan the @RequirePermission decorators on the controllers.