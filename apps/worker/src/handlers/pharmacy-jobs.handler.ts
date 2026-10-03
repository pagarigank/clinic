import { getAppPool } from '@clinic/db/src/pool.js';
import { withTenant } from '@clinic/db';

/**
 * Pharmacy background jobs — todo.md §5.3, specification.md §9 (PHM-T8, PHM-T9), Appendix A.
 *
 * JOB-38 controlled.reconcile       — daily register vs on-hand stock balance
 * JOB-39 controlled.report.generate — monthly dangerous drugs book / controlled periodic report
 * JOB-40 pharmacy.rx.pending.remind — remind pending prescriptions in verification queue
 *
 * All handlers fan out per active tenant and run through withTenant(); the app pool
 * role is subject to FORCE RLS, so a raw cross-tenant query silently matches nothing.
 */

/**
 * JOB-38: controlled.reconcile
 * Daily check of `controlled_register` running balance vs `stock_balances`.
 * If variance > 0, records an alert/incident in outbox and flags discrepancy.
 * One discrepancy alert per (branch, drug, day) so a daily re-run does not duplicate.
 */
export async function runControlledReconcile(
  targetTenantId?: string,
): Promise<{ reconciledCount: number; varianceCount: number }> {
  const tenantIds = targetTenantId ? [targetTenantId] : await activeTenantIds();
  let reconciledCount = 0;
  let varianceCount = 0;
  const reconcileDay = new Date().toISOString().slice(0, 10);

  for (const tenantId of tenantIds) {
    const result = await withTenant({ tenantId }, async (tx) => {
      const controlledItems = await tx.query(
        `SELECT DISTINCT cr.branch_id, cr.drug_item_id,
                (SELECT cr2.running_balance
                 FROM controlled_register cr2
                 WHERE cr2.tenant_id = cr.tenant_id
                   AND cr2.branch_id = cr.branch_id
                   AND cr2.drug_item_id = cr.drug_item_id
                 ORDER BY cr2.occurred_at DESC, cr2.id DESC
                 LIMIT 1) as register_balance
         FROM controlled_register cr
         WHERE cr.tenant_id = $1`,
        [tenantId],
      );

      let reconciled = 0;
      let variance = 0;

      for (const item of controlledItems.rows) {
        const balRes = await tx.query(
          `SELECT COALESCE(SUM(sbal.qty_on_hand), 0) as on_hand
           FROM stock_balances sbal
           JOIN stock_batches sb ON sb.tenant_id = sbal.tenant_id AND sb.id = sbal.batch_id
           WHERE sbal.tenant_id = $1
             AND sb.item_id = $2
             AND sb.status = 'AVAILABLE'
             AND sbal.location_id IN (
               SELECT id FROM stock_locations WHERE tenant_id = $1 AND branch_id = $3
             )`,
          [tenantId, item.drug_item_id, item.branch_id],
        );

        const onHand = Number(balRes.rows[0]?.on_hand ?? 0);
        const regBal = Number(item.register_balance ?? 0);
        const delta = regBal - onHand;

        if (Math.abs(delta) > 0.001) {
          variance++;
          await tx.query(
            `INSERT INTO outbox (tenant_id, event_type, payload, dedup_key)
             VALUES ($1, 'controlled.reconciliation.discrepancy', $2, $3)
             ON CONFLICT (tenant_id, event_type, dedup_key) WHERE dedup_key IS NOT NULL DO NOTHING`,
            [
              tenantId,
              JSON.stringify({
                branchId: item.branch_id,
                drugItemId: item.drug_item_id,
                registerBalance: regBal,
                onHandBalance: onHand,
                variance: delta,
                detectedAt: new Date().toISOString(),
              }),
              `controlled-reconcile:${item.branch_id}:${item.drug_item_id}:${reconcileDay}`,
            ],
          );
        } else {
          reconciled++;
        }
      }

      return { reconciled, variance };
    });

    reconciledCount += result.reconciled;
    varianceCount += result.variance;
  }

  return { reconciledCount, varianceCount };
}

/**
 * JOB-39: controlled.report.generate
 * Monthly dangerous drugs book summary and periodic submission format (RPT-PHM-03/04).
 * One report request per tenant per month.
 */
export async function runControlledReportGenerate(
  targetTenantId?: string,
): Promise<{ generatedCount: number }> {
  const tenantIds = targetTenantId ? [targetTenantId] : await activeTenantIds();
  const generatedMonth = new Date().toISOString().substring(0, 7);
  let generatedCount = 0;

  for (const tenantId of tenantIds) {
    generatedCount += await withTenant({ tenantId }, async (tx) => {
      const hasEntries = await tx.query(
        `SELECT 1 FROM controlled_register WHERE tenant_id = $1 LIMIT 1`,
        [tenantId],
      );
      if (!hasEntries.rows[0]) return 0;

      const res = await tx.query(
        `INSERT INTO outbox (tenant_id, event_type, payload, dedup_key)
         VALUES ($1, 'controlled.report.monthly', $2, $3)
         ON CONFLICT (tenant_id, event_type, dedup_key) WHERE dedup_key IS NOT NULL DO NOTHING
         RETURNING tenant_id`,
        [
          tenantId,
          JSON.stringify({
            reportType: 'RPT-PHM-03',
            generatedMonth,
            generatedAt: new Date().toISOString(),
          }),
          `controlled-report:${generatedMonth}`,
        ],
      );
      return res.rowCount ?? 0;
    });
  }

  return { generatedCount };
}

/**
 * JOB-40: pharmacy.rx.pending.remind
 * Remind prescribers/pharmacists of prescriptions in verification queue > 2 hours.
 * One reminder per tenant per day; re-notifying is an explicit act, not a schedule side effect.
 */
export async function runPharmacyRxPendingRemind(
  thresholdHours = 2,
  targetTenantId?: string,
): Promise<{ remindedCount: number }> {
  const tenantIds = targetTenantId ? [targetTenantId] : await activeTenantIds();
  const remindDay = new Date().toISOString().slice(0, 10);
  let remindedCount = 0;

  for (const tenantId of tenantIds) {
    remindedCount += await withTenant({ tenantId }, async (tx) => {
      const res = await tx.query(
        `INSERT INTO outbox (tenant_id, event_type, payload, dedup_key)
         SELECT $1, 'pharmacy.rx.pending.remind',
                jsonb_build_object('pendingRxCount', count(*), 'oldestIssuedAt', min(p.issued_at)),
                $3
         FROM prescriptions p
         WHERE p.tenant_id = $1
           AND p.status = 'ISSUED'
           AND p.issued_at < now() - ($2 || ' hours')::interval
         HAVING count(*) > 0
         ON CONFLICT (tenant_id, event_type, dedup_key) WHERE dedup_key IS NOT NULL DO NOTHING
         RETURNING tenant_id`,
        [tenantId, String(thresholdHours), `rx-pending:${remindDay}`],
      );
      return res.rowCount ?? 0;
    });
  }

  return { remindedCount };
}

/** Active tenant IDs, for handlers that fan out across tenants. */
async function activeTenantIds(): Promise<string[]> {
  const pool = getAppPool();
  const res = await pool.query(`SELECT id FROM tenant_directory WHERE status = 'ACTIVE'`);
  return res.rows.map((r: { id: string }) => r.id);
}
