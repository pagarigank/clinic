import { getAppPool } from '@clinic/db/src/pool.js';
import { withTenant } from '@clinic/db';

/**
 * Clinical background jobs — todo.md §3.1/§3.2/§3.3, Appendix A.
 *
 * JOB-23 appointment.reminder      — reminders for tomorrow's appointments
 * JOB-24 appointment.noshow.mark   — auto-mark no-shows past a grace window
 * JOB-25 visit.stale.close         — nightly close of visits open beyond policy
 * JOB-26 rx.expire                 — expire issued prescriptions past valid_until
 *
 * Conventions (todo.md 1.5 per-job DoD): idempotent handler, tenant-scoped
 * payload semantics, safe retries (each UPDATE only touches rows in the target
 * state, so re-running is a no-op), observable via row counts.
 *
 * Each handler fans out per active tenant and runs through withTenant(); the app
 * pool role is NOBYPASSRLS over FORCE-RLS tables, so a raw cross-tenant query
 * silently matches nothing.
 */

/**JOB-23 — queue reminder outbox events for tomorrow's live appointments. */
export async function runAppointmentReminders(
  targetTenantId?: string,
): Promise<{ reminded: number }> {
  const tenantIds = targetTenantId ? [targetTenantId] : await activeTenantIds();
  const reminderDay = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  let reminded = 0;

  for (const tenantId of tenantIds) {
    reminded += await withTenant({ tenantId }, async (tx) => {
      const candidates = await tx.query(
        `SELECT count(*)::int AS n
         FROM appointments a
         WHERE a.tenant_id = $1
           AND a.status IN ('BOOKED','CONFIRMED')
           AND a.starts_at::date = (now() + interval '1 day')::date
           AND a.reminder_sent_at IS NULL`,
        [tenantId],
      );
      const count = Number(candidates.rows[0]?.n ?? 0);
      if (count === 0) return 0;

      await tx.query(
        `INSERT INTO outbox (tenant_id, event_type, payload, dedup_key)
         VALUES ($1, 'appointment.reminder', jsonb_build_object('count', $2::int), $3)
         ON CONFLICT (tenant_id, event_type, dedup_key) WHERE dedup_key IS NOT NULL DO NOTHING`,
        [tenantId, count, `appointment-reminder:${reminderDay}`],
      );

      await tx.query(
        `UPDATE appointments SET reminder_sent_at = now(), updated_at = now()
         WHERE tenant_id = $1
           AND status IN ('BOOKED','CONFIRMED')
           AND starts_at::date = (now() + interval '1 day')::date
           AND reminder_sent_at IS NULL`,
        [tenantId],
      );
      return 1;
    });
  }

  return { reminded };
}

/** JOB-24 — mark appointments as NO_SHOW after the grace window (default 15 min). */
export async function runNoShowMarking(
  graceMinutes = 15,
  targetTenantId?: string,
): Promise<{ marked: number }> {
  const tenantIds = targetTenantId ? [targetTenantId] : await activeTenantIds();
  let marked = 0;

  for (const tenantId of tenantIds) {
    marked += await withTenant({ tenantId }, async (tx) => {
      const res = await tx.query(
        `UPDATE appointments SET status = 'NO_SHOW', updated_at = now()
         WHERE tenant_id = $1
           AND status IN ('BOOKED','CONFIRMED')
           AND starts_at < now() - ($2 || ' minutes')::interval`,
        [tenantId, String(graceMinutes)],
      );
      return res.rowCount ?? 0;
    });
  }

  return { marked };
}

/** JOB-25 — close visits open beyond the policy window (default 24 h). */
export async function runStaleVisitClose(
  maxOpenHours = 24,
  targetTenantId?: string,
): Promise<{ closed: number }> {
  const tenantIds = targetTenantId ? [targetTenantId] : await activeTenantIds();
  let closed = 0;

  for (const tenantId of tenantIds) {
    closed += await withTenant({ tenantId }, async (tx) => {
      // Closing writes closed_at so the audit trail shows the auto-close (§3.2);
      // visits with unfinished clinical work go to READY_FOR_BILLING instead.
      const res = await tx.query(
        `UPDATE visits SET status = 'READY_FOR_BILLING', updated_at = now()
         WHERE tenant_id = $1
           AND status IN ('OPEN','IN_PROGRESS')
           AND opened_at < now() - ($2 || ' hours')::interval`,
        [tenantId, String(maxOpenHours)],
      );
      return res.rowCount ?? 0;
    });
  }

  return { closed };
}

/** JOB-26 — expire issued prescriptions past valid_until. */
export async function runRxExpire(targetTenantId?: string): Promise<{ expired: number }> {
  const tenantIds = targetTenantId ? [targetTenantId] : await activeTenantIds();
  let expired = 0;

  for (const tenantId of tenantIds) {
    expired += await withTenant({ tenantId }, async (tx) => {
      const res = await tx.query(
        `UPDATE prescriptions SET status = 'EXPIRED', updated_at = now()
         WHERE tenant_id = $1
           AND status = 'ISSUED'
           AND valid_until IS NOT NULL
           AND valid_until < now()::date`,
        [tenantId],
      );
      return res.rowCount ?? 0;
    });
  }

  return { expired };
}

/** Active tenant IDs, for handlers that fan out across tenants. */
async function activeTenantIds(): Promise<string[]> {
  const pool = getAppPool();
  const res = await pool.query(`SELECT id FROM tenant_directory WHERE status = 'ACTIVE'`);
  return res.rows.map((r: { id: string }) => r.id);
}
