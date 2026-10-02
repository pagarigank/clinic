import { getAppPool } from '@clinic/db/src/pool.js';

/**
 * Pharmacy background jobs — todo.md §5.3, specification.md §9 (PHM-T8, PHM-T9), Appendix A.
 *
 * JOB-38 controlled.reconcile       — daily register vs on-hand stock balance
 * JOB-39 controlled.report.generate — monthly dangerous drugs book / controlled periodic report
 * JOB-40 pharmacy.rx.pending.remind — remind pending prescriptions in verification queue
 */

/**
 * JOB-38: controlled.reconcile
 * Daily check of `controlled_register` running balance vs `stock_balances`.
 * If variance > 0, records an alert/incident in outbox and flags discrepancy.
 */
export async function runControlledReconcile(): Promise<{ reconciledCount: number; varianceCount: number }> {
  const pool = getAppPool();

  // Find all controlled drugs with a running balance in the register
  const controlledItems = await pool.query(
    `SELECT DISTINCT cr.tenant_id, cr.branch_id, cr.drug_item_id,
            (SELECT cr2.running_balance
             FROM controlled_register cr2
             WHERE cr2.tenant_id = cr.tenant_id
               AND cr2.branch_id = cr.branch_id
               AND cr2.drug_item_id = cr.drug_item_id
             ORDER BY cr2.occurred_at DESC, cr2.id DESC
             LIMIT 1) as register_balance
     FROM controlled_register cr`,
  );

  let reconciledCount = 0;
  let varianceCount = 0;

  for (const item of controlledItems.rows) {
    const balRes = await pool.query(
      `SELECT COALESCE(SUM(sbal.qty_on_hand), 0) as on_hand
       FROM stock_balances sbal
       JOIN stock_batches sb ON sb.tenant_id = sbal.tenant_id AND sb.id = sbal.batch_id
       WHERE sbal.tenant_id = $1
         AND sb.item_id = $2
         AND sb.status = 'ACTIVE'
         AND sbal.location_id IN (
           SELECT id FROM stock_locations WHERE tenant_id = $1 AND branch_id = $3
         )`,
      [item.tenant_id, item.drug_item_id, item.branch_id],
    );

    const onHand = Number(balRes.rows[0]?.on_hand ?? 0);
    const regBal = Number(item.register_balance ?? 0);
    const variance = regBal - onHand;

    if (Math.abs(variance) > 0.001) {
      varianceCount++;
      // Raise incident outbox event
      await pool.query(
        `INSERT INTO outbox (tenant_id, event_type, payload)
         VALUES ($1, 'controlled.reconciliation.discrepancy', $2)
         ON CONFLICT DO NOTHING`,
        [
          item.tenant_id,
          JSON.stringify({
            branchId: item.branch_id,
            drugItemId: item.drug_item_id,
            registerBalance: regBal,
            onHandBalance: onHand,
            variance,
            detectedAt: new Date().toISOString(),
          }),
        ],
      );
    } else {
      reconciledCount++;
    }
  }

  return { reconciledCount, varianceCount };
}

/**
 * JOB-39: controlled.report.generate
 * Monthly dangerous drugs book summary and periodic submission format (RPT-PHM-03/04).
 */
export async function runControlledReportGenerate(): Promise<{ generatedCount: number }> {
  const pool = getAppPool();

  // Find all tenants that have controlled_register entries
  const tenants = await pool.query(
    `SELECT DISTINCT tenant_id FROM controlled_register`,
  );

  let generatedCount = 0;
  for (const t of tenants.rows) {
    await pool.query(
      `INSERT INTO outbox (tenant_id, event_type, payload)
       VALUES ($1, 'controlled.report.monthly', $2)
       ON CONFLICT DO NOTHING`,
      [
        t.tenant_id,
        JSON.stringify({
          reportType: 'RPT-PHM-03',
          generatedMonth: new Date().toISOString().substring(0, 7),
          generatedAt: new Date().toISOString(),
        }),
      ],
    );
    generatedCount++;
  }

  return { generatedCount };
}

/**
 * JOB-40: pharmacy.rx.pending.remind
 * Remind prescribers/pharmacists of prescriptions in verification queue > 2 hours.
 */
export async function runPharmacyRxPendingRemind(thresholdHours = 2): Promise<{ remindedCount: number }> {
  const pool = getAppPool();

  const res = await pool.query(
    `INSERT INTO outbox (tenant_id, event_type, payload)
     SELECT p.tenant_id, 'pharmacy.rx.pending.remind',
            jsonb_build_object('pendingRxCount', count(*), 'oldestIssuedAt', min(p.issued_at))
     FROM prescriptions p
     WHERE p.status = 'ISSUED'
       AND p.issued_at < now() - ($1 || ' hours')::interval
     GROUP BY p.tenant_id
     ON CONFLICT DO NOTHING
     RETURNING tenant_id`,
    [String(thresholdHours)],
  ).catch(() => ({ rowCount: 0 }));

  return { remindedCount: res.rowCount ?? 0 };
}
