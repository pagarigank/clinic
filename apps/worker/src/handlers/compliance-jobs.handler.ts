import { getAppPool } from '@clinic/db/src/pool.js';
import { withTenant } from '@clinic/db';

/**
 * Compliance background jobs — specification §14, todo.md Phase 8.
 *
 * JOB-15 retention.enforce    — identifies candidate records past retention, checks legal holds
 * JOB-16 dsr.deadline.remind  — daily reminder of open DSR requests nearing due date
 * JOB-17 breach.clock.remind  — high-frequency escalation for breach notifications nearing 72h
 */

async function activeTenantIds(): Promise<string[]> {
  const pool = getAppPool();
  const res = await pool.query<{ id: string }>(
    `SELECT id FROM tenant_directory WHERE status = 'ACTIVE'`,
  );
  return res.rows.map((r) => r.id);
}

/**
 * JOB-15 retention.enforce
 * Scans for records past retention policy thresholds and registers candidates.
 * Ground rule: Automatically flags and binds candidates to active legal holds.
 */
export async function handleRetentionEnforce(
  targetTenantId?: string,
): Promise<{ candidatesFound: number }> {
  const tenantIds = targetTenantId ? [targetTenantId] : await activeTenantIds();
  let totalCandidates = 0;

  for (const tenantId of tenantIds) {
    totalCandidates += await withTenant({ tenantId }, async (tx) => {
      // Load active retention policies
      const policiesRes = await tx.query(
        `SELECT id, record_class, retention_years, action
         FROM retention_policies
         WHERE tenant_id = $1 AND is_active = true`,
        [tenantId],
      );

      let found = 0;

      for (const policy of policiesRes.rows) {
        const years = Number(policy.retention_years);

        if (policy.record_class === 'CLINICAL_VISITS') {
          // Visits closed > N years ago
          const oldVisits = await tx.query(
            `SELECT v.id, v.visit_no, v.patient_id, v.closed_at
             FROM visits v
             WHERE v.tenant_id = $1
               AND v.status = 'CLOSED'
               AND v.closed_at < (now() - ($2 || ' years')::interval)
               AND NOT EXISTS (
                 SELECT 1 FROM retention_candidates rc
                 WHERE rc.tenant_id = v.tenant_id
                   AND rc.record_class = 'CLINICAL_VISITS'
                   AND rc.entity_id = v.id
               )`,
            [tenantId, years],
          );

          for (const visit of oldVisits.rows) {
            // Check active legal holds
            const holdRes = await tx.query(
              `SELECT id FROM legal_holds
               WHERE tenant_id = $1 AND released_at IS NULL
                 AND (scope = 'ENTIRE_TENANT' OR (scope = 'PATIENT' AND patient_id = $2) OR (scope = 'RECORD_CLASS' AND record_class = 'CLINICAL_VISITS'))
               LIMIT 1`,
              [tenantId, visit.patient_id],
            );
            const legalHoldId = holdRes.rows[0]?.id || null;
            const status = legalHoldId ? 'HELD' : 'PENDING';

            await tx.query(
              `INSERT INTO retention_candidates (
                 tenant_id, policy_id, record_class, entity_id, entity_ref,
                 patient_id, eligible_at, status, held_by_legal_hold_id, created_at
               )
               VALUES ($1, $2, 'CLINICAL_VISITS', $3, $4, $5, now(), $6, $7, now())`,
              [
                tenantId,
                policy.id,
                visit.id,
                `Visit ${visit.visit_no}`,
                visit.patient_id,
                status,
                legalHoldId,
              ],
            );
            found++;
          }
        }
      }

      return found;
    });
  }

  return { candidatesFound: totalCandidates };
}

/**
 * JOB-16 dsr.deadline.remind
 * Daily scan for open DSRs nearing their due date (within 7 days).
 */
export async function handleDsrDeadlineRemind(
  targetTenantId?: string,
): Promise<{ reminded: number }> {
  const tenantIds = targetTenantId ? [targetTenantId] : await activeTenantIds();
  const today = new Date().toISOString().slice(0, 10);
  let totalReminded = 0;

  for (const tenantId of tenantIds) {
    totalReminded += await withTenant({ tenantId }, async (tx) => {
      const openDsr = await tx.query(
        `SELECT id, request_no, type, due_at
         FROM data_subject_requests
         WHERE tenant_id = $1
           AND status IN ('RECEIVED', 'VERIFYING', 'IN_PROGRESS')
           AND due_at <= (now() + interval '7 days')`,
        [tenantId],
      );

      for (const dsr of openDsr.rows) {
        await tx.query(
          `INSERT INTO outbox (tenant_id, event_type, payload, dedup_key)
           VALUES ($1, 'dsr.deadline.approaching', $2::jsonb, $3)
           ON CONFLICT (tenant_id, event_type, dedup_key) WHERE dedup_key IS NOT NULL DO NOTHING`,
          [
            tenantId,
            JSON.stringify({ dsrId: dsr.id, requestNo: dsr.request_no, dueAt: dsr.due_at }),
            `dsr-remind:${dsr.id}:${today}`,
          ],
        );
      }

      return openDsr.rows.length;
    });
  }

  return { reminded: totalReminded };
}

/**
 * JOB-17 breach.clock.remind
 * High-priority scan for unnotified breach incidents nearing notification deadline (within 24 hours).
 */
export async function handleBreachClockRemind(
  targetTenantId?: string,
): Promise<{ escalated: number }> {
  const tenantIds = targetTenantId ? [targetTenantId] : await activeTenantIds();
  const hourSlot = new Date().toISOString().slice(0, 13); // Hourly dedup slot
  let totalEscalated = 0;

  for (const tenantId of tenantIds) {
    totalEscalated += await withTenant({ tenantId }, async (tx) => {
      const activeBreaches = await tx.query(
        `SELECT id, incident_no, severity, notify_regulator_due_at
         FROM breach_incidents
         WHERE tenant_id = $1
           AND status IN ('DETECTED', 'ASSESSED')
           AND notified_regulator = false
           AND notify_regulator_due_at <= (now() + interval '24 hours')`,
        [tenantId],
      );

      for (const breach of activeBreaches.rows) {
        await tx.query(
          `INSERT INTO outbox (tenant_id, event_type, payload, dedup_key)
           VALUES ($1, 'breach.clock.urgent', $2::jsonb, $3)
           ON CONFLICT (tenant_id, event_type, dedup_key) WHERE dedup_key IS NOT NULL DO NOTHING`,
          [
            tenantId,
            JSON.stringify({ breachId: breach.id, incidentNo: breach.incident_no, deadline: breach.notify_regulator_due_at }),
            `breach-clock:${breach.id}:${hourSlot}`,
          ],
        );
      }

      return activeBreaches.rows.length;
    });
  }

  return { escalated: totalEscalated };
}
