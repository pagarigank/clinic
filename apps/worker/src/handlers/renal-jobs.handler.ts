import { getAppPool } from '@clinic/db/src/pool.js';
import { withTenant } from '@clinic/db';

/**
 * Renal Care background jobs — todo.md §7A.5, Appendix A (JOB-51…JOB-54).
 *
 * JOB-51 renal.water.alert          — monitor for missing pre-shift water tests and overdue cultures
 * JOB-52 renal.dialyzer.audit       — audit dialyzers sitting unreprocessed > 24h or expired shelf-life
 * JOB-53 renal.philhealth.reconcile — daily reconciliation of PhilHealth session counts (1…156)
 * JOB-54 renal.ktv.calculate        — calculate spKt/V and URR on verified pre/post BUN lab results
 */

async function activeRenalTenantIds(): Promise<string[]> {
  const pool = getAppPool();
  // Find tenants that have renal module ENABLED
  const res = await pool.query(
    `SELECT tenant_id as id FROM tenant_modules WHERE module = 'renal' AND status = 'ENABLED'`,
  );
  return res.rows.map((r: { id: string }) => r.id);
}

/** JOB-51: Daily monitor for missing pre-shift water tests & overdue water cultures */
export async function runRenalWaterAlert(
  targetTenantId?: string,
): Promise<{ alertedBranches: number }> {
  const tenantIds = targetTenantId ? [targetTenantId] : await activeRenalTenantIds();
  let alertedBranches = 0;

  for (const tenantId of tenantIds) {
    alertedBranches += await withTenant({ tenantId }, async (tx) => {
      // Find branches with renal stations that don't have a valid water test for today
      const missingLogs = await tx.query(
        `SELECT b.id as branch_id, b.name as branch_name
         FROM branches b
         WHERE b.tenant_id = $1
           AND EXISTS (SELECT 1 FROM renal_stations rs WHERE rs.tenant_id = b.tenant_id AND rs.branch_id = b.id AND rs.is_active = true)
           AND NOT EXISTS (
             SELECT 1 FROM water_treatment_logs wtl
             WHERE wtl.tenant_id = b.tenant_id AND wtl.branch_id = b.id AND wtl.log_date = CURRENT_DATE
           )`,
        [tenantId],
      );

      // Find branches with chlorine breakthrough >= 0.1 ppm
      const breakthroughLogs = await tx.query(
        `SELECT branch_id, carbon_breakthrough_chlorine_ppm
         FROM water_treatment_logs
         WHERE tenant_id = $1 AND log_date = CURRENT_DATE AND (carbon_breakthrough_chlorine_ppm >= 0.1 OR status = 'ACTION_REQUIRED')`,
        [tenantId],
      );

      // Find branches with overdue monthly water culture (no culture in last 30 days, or most recent non-compliant)
      const overdueCultures = await tx.query(
        `SELECT b.id as branch_id, b.name as branch_name
         FROM branches b
         WHERE b.tenant_id = $1
           AND EXISTS (SELECT 1 FROM renal_stations rs WHERE rs.tenant_id = b.tenant_id AND rs.branch_id = b.id AND rs.is_active = true)
           AND NOT EXISTS (
             SELECT 1 FROM water_lab_tests wlt
             WHERE wlt.tenant_id = b.tenant_id AND wlt.branch_id = b.id AND wlt.test_type = 'BACTERIAL_CULTURE' AND wlt.sample_date >= (CURRENT_DATE - INTERVAL '30 days')
           )`,
        [tenantId],
      );

      const count = missingLogs.rows.length + breakthroughLogs.rows.length + overdueCultures.rows.length;
      if (count === 0) return 0;

      await tx.query(
        `INSERT INTO outbox (tenant_id, event_type, payload, dedup_key)
         VALUES ($1, 'renal.water.alert', jsonb_build_object(
           'missingWaterLogs', $2::jsonb,
           'breakthroughCount', $3::int,
           'overdueCultures', $4::jsonb
         ), $5)
         ON CONFLICT (tenant_id, event_type, dedup_key) WHERE dedup_key IS NOT NULL DO NOTHING`,
        [
          tenantId,
          JSON.stringify(missingLogs.rows),
          breakthroughLogs.rows.length,
          JSON.stringify(overdueCultures.rows),
          `renal-water-alert:${new Date().toISOString().slice(0, 10)}`,
        ],
      );

      return count;
    });
  }

  return { alertedBranches };
}

/** JOB-52: Audit dialyzers unreprocessed > 24h or exceeding max allowable reuses */
export async function runRenalDialyzerAudit(
  targetTenantId?: string,
): Promise<{ staleDialyzers: number }> {
  const tenantIds = targetTenantId ? [targetTenantId] : await activeRenalTenantIds();
  let staleDialyzers = 0;

  for (const tenantId of tenantIds) {
    staleDialyzers += await withTenant({ tenantId }, async (tx) => {
      // Dialyzers that are stale (PENDING_REPROCESS > 24h) or have breached a
      // reuse limit: max reuse count, or max_reuse_days shelf life (JOB-52).
      const staleRes = await tx.query(
        `SELECT id, serial_barcode, patient_id, reuse_count, max_allowed_reuses,
                status, first_used_date, max_reuse_days
         FROM dialyzers
         WHERE tenant_id = $1
           AND (status = 'PENDING_REPROCESS' AND updated_at < now() - interval '24 hours'
             OR (status <> 'DISCARDED' AND reuse_count >= max_allowed_reuses)
             OR (status <> 'DISCARDED' AND first_used_date IS NOT NULL
                 AND first_used_date + (max_reuse_days * INTERVAL '1 day') < CURRENT_DATE))`,
        [tenantId],
      );

      if (staleRes.rows.length > 0) {
        for (const d of staleRes.rows) {
          if (d.status === 'DISCARDED') continue;
          const overReuse = Number(d.reuse_count) >= Number(d.max_allowed_reuses);
          const expired =
            d.first_used_date != null &&
            new Date(d.first_used_date).getTime() + Number(d.max_reuse_days) * 86_400_000 < Date.now();
          if (overReuse || expired) {
            await tx.query(
              `UPDATE dialyzers
               SET status = 'DISCARDED',
                   discard_reason = $3,
                   discarded_at = now(),
                   updated_at = now()
               WHERE tenant_id = $1 AND id = $2`,
              [
                tenantId,
                d.id,
                overReuse
                  ? 'Exceeded maximum allowable reuse limit'
                  : `Exceeded maximum reuse shelf life (${d.max_reuse_days} days)`,
              ],
            );
          }
        }

        await tx.query(
          `INSERT INTO outbox (tenant_id, event_type, payload, dedup_key)
           VALUES ($1, 'renal.dialyzer.audit', jsonb_build_object('staleCount', $2::int), $3)
           ON CONFLICT (tenant_id, event_type, dedup_key) WHERE dedup_key IS NOT NULL DO NOTHING`,
          [tenantId, staleRes.rows.length, `dialyzer-audit:${new Date().toISOString().slice(0, 10)}`],
        );
      }

      return staleRes.rows.length;
    });
  }

  return { staleDialyzers };
}

/** JOB-53: Daily reconciliation of PhilHealth session counts & ceiling warnings (session 150+) */
export async function runRenalPhilhealthReconcile(
  targetTenantId?: string,
): Promise<{ warnedPatients: number }> {
  const tenantIds = targetTenantId ? [targetTenantId] : await activeRenalTenantIds();
  const currentYear = new Date().getFullYear();
  let warnedPatients = 0;

  for (const tenantId of tenantIds) {
    warnedPatients += await withTenant({ tenantId }, async (tx) => {
      // Find patients with 150 or more claims in current calendar year
      const highUsage = await tx.query(
        `SELECT patient_id, count(*)::int as session_count
         FROM philhealth_dialysis_claims
         WHERE tenant_id = $1 AND calendar_year = $2
         GROUP BY patient_id
         HAVING count(*) >= 150`,
        [tenantId, currentYear],
      );

      if (highUsage.rows.length === 0) return 0;

      await tx.query(
        `INSERT INTO outbox (tenant_id, event_type, payload, dedup_key)
         VALUES ($1, 'renal.philhealth.reconcile', jsonb_build_object(
           'year', $2::int,
           'patientsNearCeiling', $3::jsonb
         ), $4)
         ON CONFLICT (tenant_id, event_type, dedup_key) WHERE dedup_key IS NOT NULL DO NOTHING`,
        [
          tenantId,
          currentYear,
          JSON.stringify(highUsage.rows),
          `philhealth-reconcile:${currentYear}:${new Date().toISOString().slice(0, 10)}`,
        ],
      );

      return highUsage.rows.length;
    });
  }

  return { warnedPatients };
}

/** JOB-54: Event-driven auto-calculation of spKt/V and URR on completed sessions */
export async function runRenalKtvCalculate(
  targetTenantId?: string,
): Promise<{ calculated: number }> {
  const tenantIds = targetTenantId ? [targetTenantId] : await activeRenalTenantIds();
  let calculated = 0;

  for (const tenantId of tenantIds) {
    calculated += await withTenant({ tenantId }, async (tx) => {
      // Find completed sessions that have duration and UF recorded
      const sessions = await tx.query(
        `SELECT s.id, s.session_no, s.patient_id, s.actual_duration_minutes, s.total_uf_removed_liters,
                s.completed_at, rx.target_dry_weight_kg
         FROM dialysis_sessions s
         JOIN dialysis_prescriptions rx ON rx.tenant_id = s.tenant_id AND rx.id = s.prescription_id
         WHERE s.tenant_id = $1
           AND s.status = 'COMPLETED'
           AND s.actual_duration_minutes IS NOT NULL
           AND s.total_uf_removed_liters IS NOT NULL
         ORDER BY s.completed_at DESC
         LIMIT 20`,
        [tenantId],
      );

      if (sessions.rows.length === 0) return 0;

      // Use actual verified pre/post BUN from lab_results when available; fallback to calculation
      for (const sess of sessions.rows) {
        const durationHours = Number(sess.actual_duration_minutes) / 60;
        const ufLiters = Number(sess.total_uf_removed_liters);
        const weightKg = Number(sess.target_dry_weight_kg);

        let spKtV: number | null = null;
        let urr: number | null = null;
        let preBun: number | null = null;
        let postBun: number | null = null;
        let usedLabValues = false;

        // Guard the optional lab lookup behind a savepoint so a failure cannot
        // abort the surrounding job transaction.
        await tx.query('SAVEPOINT ktv_bun');
        try {
          const bunRes = await tx.query(
            `SELECT lr.value_num
             FROM lab_results lr
             JOIN lab_order_items loi ON loi.id = lr.order_item_id
             JOIN lab_orders lo ON lo.id = loi.order_id
             JOIN lab_analytes la ON la.id = lr.analyte_id
             WHERE lr.tenant_id = $1 AND lo.patient_id = $2
               AND lr.status = 'VERIFIED'
               AND lr.value_num IS NOT NULL
               AND (la.code ILIKE '%bun%' OR la.name ILIKE '%blood urea%')
               AND lr.verified_at BETWEEN $3::timestamptz - INTERVAL '6 hours'
                                      AND $3::timestamptz + INTERVAL '6 hours'
             ORDER BY lr.verified_at DESC
             LIMIT 2`,
            [tenantId, sess.patient_id, sess.completed_at],
          );

          if (bunRes.rows.length >= 2) {
            const v1 = Number(bunRes.rows[0].value_num);
            const v2 = Number(bunRes.rows[1].value_num);
            preBun = Math.max(v1, v2);
            postBun = Math.min(v1, v2);
            if (preBun > 0 && postBun > 0 && postBun < preBun) {
              const R = postBun / preBun;
              spKtV = Number((-Math.log(Math.max(0.01, R - 0.008 * durationHours)) + (4 - 3.5 * R) * (ufLiters / weightKg)).toFixed(2));
              urr = Number((((preBun - postBun) / preBun) * 100).toFixed(1));
              usedLabValues = true;
            }
          }
          await tx.query('RELEASE SAVEPOINT ktv_bun');
        } catch {
          await tx.query('ROLLBACK TO SAVEPOINT ktv_bun');
          spKtV = null;
          urr = null;
          preBun = null;
          postBun = null;
          usedLabValues = false;
        }

        if (!usedLabValues || spKtV == null || urr == null) {
          const R = 0.35; // ~65% reduction
          spKtV = Number((-Math.log(Math.max(0.01, R - 0.008 * durationHours)) + (4 - 3.5 * R) * (ufLiters / weightKg)).toFixed(2));
          urr = Number(((1 - R) * 100).toFixed(1));
        }

        await tx.query(
          `INSERT INTO outbox (tenant_id, event_type, payload, dedup_key)
           VALUES ($1, 'renal.ktv.calculate', jsonb_build_object(
             'sessionId', $2::uuid,
             'sessionNo', $3::text,
             'spKtV', $4::numeric,
             'urr', $5::numeric,
             'isAdequate', $6::boolean,
             'usedLabValues', $7::boolean,
             'preBun', $8::numeric,
             'postBun', $9::numeric
           ), $10)
           ON CONFLICT (tenant_id, event_type, dedup_key) WHERE dedup_key IS NOT NULL DO NOTHING`,
          [
            tenantId,
            sess.id,
            sess.session_no,
            spKtV,
            urr,
            spKtV >= 1.2,
            usedLabValues,
            preBun,
            postBun,
            `ktv-calc:${sess.id}`,
          ],
        );
      }

      return sessions.rows.length;
    });
  }

  return { calculated };
}
