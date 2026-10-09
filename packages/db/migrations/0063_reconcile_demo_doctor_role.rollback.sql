-- ============================================================================
-- 0063_reconcile_demo_doctor_role (rollback)
-- ============================================================================
-- Reverses the reconciliation by restoring the 30 out-of-spec grants the drift
-- had placed on demo-a's `doctor` role. demo-b had no extras, so it is not
-- touched. This intentionally reintroduces the demo drift — it exists only to
-- keep the forward/rollback pair symmetric, exactly as 0044/0053/0056 do.
-- ON CONFLICT DO NOTHING keeps it idempotent and re-runnable.
-- ============================================================================

INSERT INTO role_permissions (tenant_id, role_id, permission_id)
SELECT r.tenant_id, r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.tenant_id = '11111111-1111-4111-8111-111111111111'   -- demo-a
  AND r.code = 'doctor'
  AND p.code IN (
    'billing.invoice.read',
    'clinical.queue.call', 'clinical.queue.skip',
    'lab.config.create', 'lab.config.delete', 'lab.config.read', 'lab.config.update',
    'lab.critical.ack', 'lab.critical.read',
    'lab.order.cancel', 'lab.order.update',
    'lab.qc.create', 'lab.qc.read',
    'lab.report.release',
    'lab.result.amend', 'lab.result.enter', 'lab.result.view_confidential',
    'lab.specimen.collect', 'lab.specimen.read', 'lab.specimen.receive', 'lab.specimen.reject',
    'pharmacy.product.read', 'pharmacy.stock.read',
    'supply.consumption.create', 'supply.issue.read', 'supply.item.read',
    'supply.location.read', 'supply.req.create', 'supply.req.read', 'supply.stock.read'
  )
ON CONFLICT (tenant_id, role_id, permission_id) DO NOTHING;
