-- 0053_receptionist_payment_method_read.migration.sql
-- Fix: the cashier role could not read payment methods.
--
-- GET /admin/payment-methods is guarded by `admin.payment_method.read`, which was
-- granted only to tenant_admin. But the receptionist role is the cashier: it holds
-- billing.payment.create / billing.shift.open / billing.invoice.create, and the POS
-- needs the method list to build a tender. So every cashier-side payment failed
-- with 403 on /admin/payment-methods, and the UI had been masking it by inventing
-- methods with non-UUID ids ("pm-cash"), which then failed validation with a 500.
--
-- This is a genuine permission-model gap, not a UI bug: you cannot hold
-- "take payment" without being able to know how a patient may pay.
--
-- READ-ONLY grant. Write access stays with tenant_admin — the cashier must not be
-- able to create, rename or disable payment methods (specification §2.3 keeps
-- admin.payment_method.{read,create,update,delete} as configuration).

INSERT INTO role_permissions (tenant_id, role_id, permission_id)
SELECT r.tenant_id, r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.code = 'receptionist'
  AND r.tenant_id = '11111111-1111-4111-8111-111111111111'
  AND p.code = 'admin.payment_method.read'
ON CONFLICT (tenant_id, role_id, permission_id) DO NOTHING;

-- The same reasoning applies to any role that can take payment, not just the
-- seeded receptionist. Apply it wherever billing.payment.create is already held,
-- so a tenant that defines its own cashier role gets the same ability.
INSERT INTO role_permissions (tenant_id, role_id, permission_id)
SELECT DISTINCT rp.tenant_id, rp.role_id, p.id
FROM role_permissions rp
JOIN permissions p ON p.id = rp.permission_id AND p.code = 'billing.payment.create'
WHERE NOT EXISTS (
  SELECT 1
  FROM role_permissions existing
  WHERE existing.tenant_id = rp.tenant_id
    AND existing.role_id = rp.role_id
    AND existing.permission_id = p.id
)
ON CONFLICT DO NOTHING;