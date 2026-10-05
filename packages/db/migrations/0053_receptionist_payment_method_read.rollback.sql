-- 0053_receptionist_payment_method_read.rollback.sql
-- Remove exactly the grants added by 0052. Restricted to payment methods so the
-- rollback cannot touch any other role permission.

DELETE FROM role_permissions rp
USING role_permissions src, permissions p, roles r
WHERE rp.permission_id = p.id
  AND p.code = 'admin.payment_method.read'
  AND src.role_id = rp.role_id
  AND src.tenant_id = rp.tenant_id
  AND src.permission_id = (
    SELECT id FROM permissions WHERE code = 'billing.payment.create'
  )
  AND r.id = rp.role_id
  AND r.code = 'receptionist'
  AND r.tenant_id = '11111111-1111-4111-8111-111111111111';