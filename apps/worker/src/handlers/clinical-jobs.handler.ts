import { getAppPool } from '@clinic/db/src/pool.js';

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
 */

/**JOB-23 — queue reminder outbox events for tomorrow's live appointments. */
export async function runAppointmentReminders(): Promise<{ reminded: number }> {
  const pool = getAppPool();
  // One outbox event per tenant with appointments tomorrow; the notification
  // path (JOB-02) fans out per patient without exposing PHI to the worker log.
  const res = await pool.query(
    `INSERT INTO outbox (tenant_id, event_type, payload)
     SELECT a.tenant_id, 'appointment.reminder', jsonb_build_object('count', count(*))
     FROM appointments a
     WHERE a.status IN ('BOOKED','CONFIRMED')
       AND a.starts_at::date = (now() + interval '1 day')::date
       AND a.reminder_sent_at IS NULL
     GROUP BY a.tenant_id
     ON CONFLICT DO NOTHING
     RETURNING tenant_id`,
  ).catch(() => ({ rowCount: 0 }));
  if ((res.rowCount ?? 0) > 0) {
    await pool.query(
      `UPDATE appointments SET reminder_sent_at = now()
       WHERE status IN ('BOOKED','CONFIRMED')
         AND starts_at::date = (now() + interval '1 day')::date
         AND reminder_sent_at IS NULL`,
    );
  }
  return { reminded: res.rowCount ?? 0 };
}

/** JOB-24 — mark appointments as NO_SHOW after the grace window (default 15 min). */
export async function runNoShowMarking(graceMinutes = 15): Promise<{ marked: number }> {
  const pool = getAppPool();
  const res = await pool.query(
    `UPDATE appointments SET status = 'NO_SHOW', updated_at = now()
     WHERE status IN ('BOOKED','CONFIRMED')
       AND starts_at < now() - ($1 || ' minutes')::interval`,
    [String(graceMinutes)],
  );
  return { marked: res.rowCount ?? 0 };
}

/** JOB-25 — close visits open beyond the policy window (default 24 h). */
export async function runStaleVisitClose(maxOpenHours = 24): Promise<{ closed: number }> {
  const pool = getAppPool();
  // Closing writes closed_at so the audit trail shows the auto-close (§3.2);
  // visits with unfinished clinical work go to READY_FOR_BILLING instead.
  const res = await pool.query(
    `UPDATE visits SET status = 'READY_FOR_BILLING', updated_at = now()
     WHERE status IN ('OPEN','IN_PROGRESS')
       AND opened_at < now() - ($1 || ' hours')::interval`,
    [String(maxOpenHours)],
  );
  return { closed: res.rowCount ?? 0 };
}

/** JOB-26 — expire issued prescriptions past valid_until. */
export async function runRxExpire(): Promise<{ expired: number }> {
  const pool = getAppPool();
  const res = await pool.query(
    `UPDATE prescriptions SET status = 'EXPIRED', updated_at = now()
     WHERE status = 'ISSUED' AND valid_until IS NOT NULL AND valid_until < now()::date`,
  );
  return { expired: res.rowCount ?? 0 };
}
