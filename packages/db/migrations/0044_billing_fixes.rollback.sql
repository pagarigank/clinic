-- 0044_billing_fixes.rollback.sql
DROP TABLE IF EXISTS payment_splits;

-- Role permissions are additive; rollback removes all billing permissions
-- seeded by 0044 to leave the DB in the pre-migration state.
DELETE FROM role_permissions rp
USING permissions p
WHERE rp.permission_id = p.id
  AND p.code LIKE 'billing.%';
