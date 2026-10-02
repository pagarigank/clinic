import { getAppPool } from '@clinic/db/src/pool.js';
import { withTenant } from '@clinic/db';

/**
 * Supply background jobs — todo.md §4.3, specification §10, §14.
 *
 * JOB-29 stock.lowlevel.scan         — detect below-min/out-of-stock
 * JOB-30 par.replenishment.suggest   — draft requisitions for locations below par
 * JOB-31 po.reorder.suggest          — draft PRs from reorder points
 * JOB-32 stock.balance.reconcile     — recompute balances from ledger; mismatch => hold (AC-13)
 * JOB-34 po.overdue.remind           — flag POs past expected date
 * JOB-35 requisition.sla.escalate    — escalate unapproved/unissued requisitions
 * JOB-36 supplier.scorecard.compute  — compute supplier scorecard (lead time, fill rate)
 * JOB-37 valuation.snapshot          — daily stock valuation snapshot
 *
 * Rules: Handlers run in withTenant; fan-out coordinators enumerate only active tenant IDs.
 */

async function getActiveTenantIds(targetTenantId?: string): Promise<string[]> {
  if (targetTenantId) return [targetTenantId];
  const pool = getAppPool();
  const res = await pool.query(`SELECT id FROM tenant_directory WHERE status = 'ACTIVE'`);
  return res.rows.map(r => r.id);
}

/** JOB-29: Scan for stock below min_qty and write outbox alerts. */
export async function runStockLowLevelScan(targetTenantId?: string): Promise<{ alerts: number }> {
  const tenantIds = await getActiveTenantIds(targetTenantId);
  let totalAlerts = 0;

  for (const tenantId of tenantIds) {
    await withTenant({ tenantId }, async (tx) => {
      const res = await tx.query(
        `INSERT INTO outbox (tenant_id, event_type, payload)
         SELECT lip.tenant_id, 'stock.low_level', jsonb_build_object(
           'locationId', lip.location_id,
           'itemId', lip.item_id,
           'minQty', lip.min_qty,
           'currentQty', COALESCE(SUM(b.qty_on_hand), 0)
         )
         FROM location_item_params lip
         JOIN stock_locations sl ON sl.id = lip.location_id
         LEFT JOIN stock_batches sb ON sb.item_id = lip.item_id AND sb.tenant_id = lip.tenant_id
         LEFT JOIN stock_balances b ON b.location_id = lip.location_id AND b.batch_id = sb.id AND b.tenant_id = lip.tenant_id
         WHERE lip.tenant_id = $1 AND lip.min_qty > 0
         GROUP BY lip.tenant_id, lip.location_id, lip.item_id, lip.min_qty
         HAVING COALESCE(SUM(b.qty_on_hand), 0) <= lip.min_qty
         RETURNING id`,
        [tenantId],
      );
      totalAlerts += res.rowCount ?? 0;
    });
  }

  return { alerts: totalAlerts };
}

/** JOB-30: Auto-draft requisitions for locations below par. */
export async function runParReplenishmentSuggest(targetTenantId?: string): Promise<{ requisitionsDrafted: number }> {
  const tenantIds = await getActiveTenantIds(targetTenantId);
  let drafted = 0;

  for (const tenantId of tenantIds) {
    await withTenant({ tenantId }, async (tx) => {
      const locationsBelowPar = await tx.query(
        `SELECT lip.tenant_id, lip.location_id, sl.branch_id, lip.item_id,
                lip.par_qty, COALESCE(SUM(b.qty_on_hand), 0) as current_qty
         FROM location_item_params lip
         JOIN stock_locations sl ON sl.id = lip.location_id
         LEFT JOIN stock_batches sb ON sb.item_id = lip.item_id AND sb.tenant_id = lip.tenant_id
         LEFT JOIN stock_balances b ON b.location_id = lip.location_id AND b.batch_id = sb.id AND b.tenant_id = lip.tenant_id
         WHERE lip.tenant_id = $1 AND lip.par_qty IS NOT NULL AND lip.par_qty > 0
         GROUP BY lip.tenant_id, lip.location_id, sl.branch_id, lip.item_id, lip.par_qty
         HAVING COALESCE(SUM(b.qty_on_hand), 0) < lip.par_qty`,
        [tenantId],
      );

      for (const row of locationsBelowPar.rows) {
        const centralStore = await tx.query(
          `SELECT id FROM stock_locations WHERE tenant_id = $1 AND type = 'CENTRAL_STORE' LIMIT 1`,
          [tenantId],
        );
        if (!centralStore.rows[0]) continue;

        const item = await tx.query(
          `SELECT base_uom_id FROM items WHERE tenant_id = $1 AND id = $2`,
          [tenantId, row.item_id],
        );
        if (!item.rows[0]) continue;

        const neededQty = Number(row.par_qty) - Number(row.current_qty);
        const reqRes = await tx.query(
          `INSERT INTO requisitions (
             tenant_id, branch_id, req_no, from_location_id, to_location_id, type, status, requested_by
           )
           VALUES ($1, $2, $3, $4, $5, 'PAR', 'DRAFT', '00000000-0000-0000-0000-000000000000')
           RETURNING id`,
          [
            tenantId,
            row.branch_id,
            `PAR-REQ-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
            row.location_id,
            centralStore.rows[0].id,
          ],
        );

        await tx.query(
          `INSERT INTO requisition_items (tenant_id, requisition_id, item_id, qty_requested, uom_id)
           VALUES ($1, $2, $3, $4, $5)`,
          [tenantId, reqRes.rows[0].id, row.item_id, neededQty, item.rows[0].base_uom_id],
        );
        drafted++;
      }
    });
  }

  return { requisitionsDrafted: drafted };
}

/** JOB-31: Draft PRs from reorder points and usage. */
export async function runPoReorderSuggest(targetTenantId?: string): Promise<{ prsDrafted: number }> {
  const tenantIds = await getActiveTenantIds(targetTenantId);
  let drafted = 0;

  for (const tenantId of tenantIds) {
    await withTenant({ tenantId }, async (tx) => {
      const belowReorder = await tx.query(
        `SELECT lip.tenant_id, lip.location_id, sl.branch_id, lip.item_id,
                lip.reorder_point, COALESCE(lip.max_qty, lip.reorder_point * 2) as target_qty,
                COALESCE(SUM(b.qty_on_hand), 0) as current_qty
         FROM location_item_params lip
         JOIN stock_locations sl ON sl.id = lip.location_id
         LEFT JOIN stock_batches sb ON sb.item_id = lip.item_id AND sb.tenant_id = lip.tenant_id
         LEFT JOIN stock_balances b ON b.location_id = lip.location_id AND b.batch_id = sb.id AND b.tenant_id = lip.tenant_id
         WHERE lip.tenant_id = $1 AND lip.reorder_point IS NOT NULL AND lip.reorder_point > 0
         GROUP BY lip.tenant_id, lip.location_id, sl.branch_id, lip.item_id, lip.reorder_point, lip.max_qty
         HAVING COALESCE(SUM(b.qty_on_hand), 0) <= lip.reorder_point`,
        [tenantId],
      );

      for (const row of belowReorder.rows) {
        const item = await tx.query(
          `SELECT base_uom_id FROM items WHERE tenant_id = $1 AND id = $2`,
          [tenantId, row.item_id],
        );
        if (!item.rows[0]) continue;

        const orderQty = Math.max(1, Number(row.target_qty) - Number(row.current_qty));
        const prRes = await tx.query(
          `INSERT INTO purchase_requests (
             tenant_id, branch_id, pr_no, requester_id, location_id, reason, status
           )
           VALUES ($1, $2, $3, '00000000-0000-0000-0000-000000000000', $4, 'Auto Reorder Suggestion', 'DRAFT')
           RETURNING id`,
          [
            tenantId,
            row.branch_id,
            `REORDER-PR-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
            row.location_id,
          ],
        );

        await tx.query(
          `INSERT INTO purchase_request_items (tenant_id, pr_id, item_id, qty_requested, uom_id)
           VALUES ($1, $2, $3, $4, $5)`,
          [tenantId, prRes.rows[0].id, row.item_id, orderQty, item.rows[0].base_uom_id],
        );
        drafted++;
      }
    });
  }

  return { prsDrafted: drafted };
}

/**
 * JOB-32: Reconcile stock balances against the ledger.
 * AC-13: Detects an injected imbalance and places a hold on the location/batch.
 */
export async function runStockBalanceReconcile(targetTenantId?: string): Promise<{ checked: number; mismatches: number }> {
  const tenantIds = await getActiveTenantIds(targetTenantId);
  let totalChecked = 0;
  let totalMismatches = 0;

  for (const tenantId of tenantIds) {
    await withTenant({ tenantId }, async (tx) => {
      const balances = await tx.query(
        `SELECT b.tenant_id, b.location_id, b.batch_id, b.qty_on_hand,
                COALESCE((
                  SELECT SUM(sm.qty)
                  FROM stock_movements sm
                  WHERE sm.tenant_id = b.tenant_id
                    AND sm.location_id = b.location_id
                    AND sm.batch_id = b.batch_id
                ), 0) as expected_qty
         FROM stock_balances b
         WHERE b.tenant_id = $1`,
        [tenantId],
      );

      totalChecked += balances.rowCount ?? 0;

      for (const row of balances.rows) {
        const onHand = Number(row.qty_on_hand);
        const expected = Number(row.expected_qty);

        if (Math.abs(onHand - expected) > 0.001) {
          totalMismatches++;
          // AC-13: Place hold on the stock_balance so FEFO and issues cannot use this held stock
          await tx.query(
            `UPDATE stock_balances
             SET hold_until = now() + interval '7 days'
             WHERE tenant_id = $1 AND location_id = $2 AND batch_id = $3`,
            [row.tenant_id, row.location_id, row.batch_id],
          );

          // Record security/audit alert in outbox
          await tx.query(
            `INSERT INTO outbox (tenant_id, event_type, payload)
             VALUES ($1, 'stock.balance.mismatch', jsonb_build_object(
               'locationId', $2::text,
               'batchId', $3::text,
               'balanceQty', $4::numeric,
               'expectedQty', $5::numeric
             ))`,
            [row.tenant_id, row.location_id, row.batch_id, onHand, expected],
          );
        }
      }
    });
  }

  return { checked: totalChecked, mismatches: totalMismatches };
}

/** JOB-34: Flag overdue purchase orders past expected_date. */
export async function runPoOverdueRemind(targetTenantId?: string): Promise<{ overdueCount: number }> {
  const tenantIds = await getActiveTenantIds(targetTenantId);
  let totalOverdue = 0;

  for (const tenantId of tenantIds) {
    await withTenant({ tenantId }, async (tx) => {
      const res = await tx.query(
        `INSERT INTO outbox (tenant_id, event_type, payload)
         SELECT po.tenant_id, 'po.overdue', jsonb_build_object('poId', po.id, 'poNo', po.po_no, 'expectedDate', po.expected_date)
         FROM purchase_orders po
         WHERE po.tenant_id = $1
           AND po.status IN ('APPROVED', 'SENT', 'PARTIALLY_RECEIVED')
           AND po.expected_date IS NOT NULL
           AND po.expected_date < now()::date
         ON CONFLICT DO NOTHING
         RETURNING id`,
        [tenantId],
      );
      totalOverdue += res.rowCount ?? 0;
    });
  }

  return { overdueCount: totalOverdue };
}

/** JOB-35: Escalate requisitions pending beyond SLA (default 24h). */
export async function runRequisitionSlaEscalate(slaHours = 24, targetTenantId?: string): Promise<{ escalatedCount: number }> {
  const tenantIds = await getActiveTenantIds(targetTenantId);
  let totalEscalated = 0;

  for (const tenantId of tenantIds) {
    await withTenant({ tenantId }, async (tx) => {
      const res = await tx.query(
        `INSERT INTO outbox (tenant_id, event_type, payload)
         SELECT r.tenant_id, 'requisition.sla_breach', jsonb_build_object('requisitionId', r.id, 'reqNo', r.req_no)
         FROM requisitions r
         WHERE r.tenant_id = $1
           AND r.status IN ('SUBMITTED', 'ISSUED')
           AND r.created_at < now() - ($2 || ' hours')::interval
         ON CONFLICT DO NOTHING
         RETURNING id`,
        [tenantId, String(slaHours)],
      );
      totalEscalated += res.rowCount ?? 0;
    });
  }

  return { escalatedCount: totalEscalated };
}

/** JOB-36: Compute supplier scorecard (lead time, fill rate). */
export async function runSupplierScorecardCompute(targetTenantId?: string): Promise<{ computed: number }> {
  const tenantIds = await getActiveTenantIds(targetTenantId);
  let totalComputed = 0;

  for (const tenantId of tenantIds) {
    await withTenant({ tenantId }, async (tx) => {
      const suppliers = await tx.query(`SELECT id, tenant_id FROM suppliers WHERE tenant_id = $1 AND status = 'ACTIVE'`, [tenantId]);

      for (const s of suppliers.rows) {
        const leadTimeRes = await tx.query(
          `SELECT AVG(EXTRACT(EPOCH FROM (gr.received_at - po.approved_at)) / 86400) as avg_lead_time
           FROM goods_receipts gr
           JOIN purchase_orders po ON po.id = gr.po_id
           WHERE gr.tenant_id = $1 AND gr.supplier_id = $2 AND po.approved_at IS NOT NULL`,
          [tenantId, s.id],
        );
        const avgLeadTime = leadTimeRes.rows[0]?.avg_lead_time ? Math.round(Number(leadTimeRes.rows[0].avg_lead_time)) : null;

        if (avgLeadTime !== null && avgLeadTime > 0) {
          await tx.query(
            `UPDATE suppliers SET lead_time_days = $1, updated_at = now() WHERE tenant_id = $2 AND id = $3`,
            [avgLeadTime, tenantId, s.id],
          );
        }
        totalComputed++;
      }
    });
  }

  return { computed: totalComputed };
}

/** JOB-37: Snapshot daily stock valuation per location and item. */
export async function runValuationSnapshot(targetTenantId?: string): Promise<{ snapshotted: number }> {
  const tenantIds = await getActiveTenantIds(targetTenantId);
  let totalSnapshotted = 0;

  for (const tenantId of tenantIds) {
    await withTenant({ tenantId }, async (tx) => {
      const res = await tx.query(
        `INSERT INTO valuation_snapshots (tenant_id, as_of, location_id, item_id, batch_id, qty, unit_cost, total_value)
         SELECT b.tenant_id, now()::date, b.location_id, sb.item_id, b.batch_id,
                b.qty_on_hand, sb.unit_cost, (b.qty_on_hand * sb.unit_cost)
         FROM stock_balances b
         JOIN stock_batches sb ON sb.id = b.batch_id
         WHERE b.tenant_id = $1 AND b.qty_on_hand > 0
         RETURNING id`,
        [tenantId],
      );
      totalSnapshotted += res.rowCount ?? 0;
    });
  }

  return { snapshotted: totalSnapshotted };
}
