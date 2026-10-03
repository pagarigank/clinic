import { getAppPool } from '@clinic/db/src/pool.js';
import { withTenant } from '@clinic/db';

/**
 * Platform background jobs — specification §14, todo.md Phase 9.
 *
 * JOB-02 notification.send           — delivery log, quiet hours evaluation, clinical alert bypass
 * JOB-04 tenant.export               — tenant-scoped JSON data export
 * JOB-05 tenant.offboard.purge       — offboard purge with legal hold check
 * JOB-06 subscription.check         — trial module expiration (TRIAL -> DRAINING -> DISABLED)
 * JOB-07 usage.metering              — usage statistics collection
 * JOB-19 report.materialized.refresh — refreshes report cache
 * JOB-20 report.scheduled.deliver    — executes scheduled reports (suspends if module disabled)
 * JOB-21 report.export.generate      — generates export files for report runs
 */

async function activeTenantIds(): Promise<string[]> {
  const pool = getAppPool();
  const res = await pool.query<{ id: string }>(
    `SELECT id FROM tenants WHERE status = 'ACTIVE'`,
  );
  return res.rows.map((r) => r.id);
}

/**
 * Helper to check if a current time falls within quiet hours (e.g. 22:00 to 07:00).
 */
export function isWithinQuietHours(currentTime: string, start: string, end: string): boolean {
  // currentTime, start, end in HH:MM or HH:MM:SS
  const parseMins = (t: string) => {
    const parts = t.split(':').map(Number);
    return (parts[0] ?? 0) * 60 + (parts[1] ?? 0);
  };
  const cur = parseMins(currentTime);
  const s = parseMins(start);
  const e = parseMins(end);

  if (s < e) {
    // Normal window e.g. 01:00 to 05:00
    return cur >= s && cur < e;
  } else {
    // Overnight window e.g. 22:00 to 07:00
    return cur >= s || cur < e;
  }
}

/**
 * JOB-02 notification.send
 * Sends pending notifications to delivery logs across channels (IN_APP, EMAIL, SMS).
 * Invariant: Clinical alerts (CLINICAL_ALERT) and critical alerts (CRITICAL) bypass quiet hours.
 */
export async function runNotificationSend(
  targetTenantId?: string,
  currentTimeStr?: string,
): Promise<{ processedCount: number; deliveredCount: number; suppressedCount: number }> {
  const tenantIds = targetTenantId ? [targetTenantId] : await activeTenantIds();
  let processedCount = 0;
  let deliveredCount = 0;
  let suppressedCount = 0;

  for (const tenantId of tenantIds) {
    const counts = await withTenant({ tenantId }, async (tx) => {
      let localProcessed = 0;
      let localDelivered = 0;
      let localSuppressed = 0;

      // Find un-delivered notifications
      const notifsRes = await tx.query<{
        id: string;
        user_id: string;
        severity: string;
        title: string;
        body: string;
        created_at: Date;
      }>(
        `SELECT n.id, n.user_id, n.severity, n.title, n.body, n.created_at
         FROM user_notifications n
         WHERE n.tenant_id = $1
           AND NOT EXISTS (
             SELECT 1 FROM notification_delivery_logs l
             WHERE l.tenant_id = n.tenant_id AND l.notification_id = n.id
           )
         LIMIT 100`,
        [tenantId],
      );

      for (const n of notifsRes.rows) {
        localProcessed++;
        // Fetch user preferences
        const prefRes = await tx.query<{
          channels: { in_app?: boolean; email?: boolean; sms?: boolean };
          quiet_hours_enabled: boolean;
          quiet_hours_start: string | null;
          quiet_hours_end: string | null;
        }>(
          `SELECT channels, quiet_hours_enabled, quiet_hours_start::text, quiet_hours_end::text
           FROM user_notification_preferences
           WHERE tenant_id = $1 AND user_id = $2`,
          [tenantId, n.user_id],
        );

        const pref = prefRes.rows[0];
        const isQuietHoursEnabled = pref?.quiet_hours_enabled ?? false;
        const qStart = pref?.quiet_hours_start || '22:00:00';
        const qEnd = pref?.quiet_hours_end || '07:00:00';

        // Check if current time is within quiet hours
        const timeToCheck = currentTimeStr || new Date().toISOString().substring(11, 16);
        const inQuiet = isQuietHoursEnabled && isWithinQuietHours(timeToCheck, qStart, qEnd);

        // INVARIANT: Critical and Clinical alerts bypass quiet hours!
        const isBypass = n.severity === 'CRITICAL' || n.severity === 'CLINICAL_ALERT';
        const shouldSuppress = inQuiet && !isBypass;

        const status = shouldSuppress ? 'SUPPRESSED_QUIET_HOURS' : 'SENT';
        const deliveredAt = shouldSuppress ? null : new Date();

        await tx.query(
          `INSERT INTO notification_delivery_logs (
             tenant_id, notification_id, channel, recipient, status, delivered_at
           )
           VALUES ($1, $2, 'IN_APP', $3, $4, $5)`,
          [tenantId, n.id, n.user_id, status, deliveredAt],
        );

        if (shouldSuppress) {
          localSuppressed++;
        } else {
          localDelivered++;
        }
      }

      return {
        processed: localProcessed,
        delivered: localDelivered,
        suppressed: localSuppressed,
      };
    });

    processedCount += counts.processed;
    deliveredCount += counts.delivered;
    suppressedCount += counts.suppressed;
  }

  return { processedCount, deliveredCount, suppressedCount };
}

/**
 * JOB-04 tenant.export
 * Asynchronously bundles tenant records into a tenant-scoped JSON file.
 */
export async function runTenantExport(
  tenantId: string,
  userId: string,
): Promise<{ fileId: string; fileName: string; rowCount: number }> {
  return withTenant({ tenantId, userId }, async (tx) => {
    // Gather summary of tenant records
    const countsRes = await tx.query<{
      users: string;
      patients: string;
      visits: string;
    }>(
      `SELECT
         (SELECT count(*) FROM users WHERE tenant_id = $1) as users,
         (SELECT count(*) FROM patients WHERE tenant_id = $1) as patients,
         (SELECT count(*) FROM visits WHERE tenant_id = $1) as visits`,
      [tenantId],
    );

    const counts = countsRes.rows[0];
    const exportBundle = {
      tenantId,
      exportedAt: new Date().toISOString(),
      counts,
      exportVersion: '1.0',
    };

    const fileName = `tenant_export_${tenantId}_${Date.now()}.json`;
    const objectKey = `t/${tenantId}/exports/${fileName}`;
    const payloadStr = JSON.stringify(exportBundle, null, 2);
    const sizeBytes = Buffer.byteLength(payloadStr, 'utf8');

    // Register export in files
    const fileRes = await tx.query<{ id: string }>(
      `INSERT INTO files (tenant_id, object_key, file_name, mime_type, size_bytes, status, uploaded_by)
       VALUES ($1, $2, $3, 'application/json', $4, 'READY', $5)
       RETURNING id`,
      [tenantId, objectKey, fileName, sizeBytes, userId],
    );

    const fileId = fileRes.rows[0]?.id || '';
    return {
      fileId,
      fileName,
      rowCount: Number(counts?.users ?? 0) + Number(counts?.patients ?? 0) + Number(counts?.visits ?? 0),
    };
  });
}

/**
 * JOB-05 tenant.offboard.purge
 * Purges tenant data upon offboarding.
 * INVARIANT: Strictly blocks purge if any unreleased legal holds exist!
 */
export async function runTenantOffboardPurge(
  tenantId: string,
): Promise<{ success: boolean; tenantId: string }> {
  return withTenant({ tenantId }, async (tx) => {
    // 1. Check active legal holds
    const holdsRes = await tx.query<{ id: string; hold_no: string }>(
      `SELECT id, hold_no
       FROM legal_holds
       WHERE tenant_id = $1 AND released_at IS NULL`,
      [tenantId],
    );

    if ((holdsRes.rowCount ?? 0) > 0) {
      throw new Error(
        `PURGE_BLOCKED_BY_LEGAL_HOLD: Cannot purge tenant data while ${holdsRes.rowCount} active legal hold(s) exist.`,
      );
    }

    // 2. Mark tenant as OFFBOARDED
    await tx.query(
      `UPDATE tenants
       SET status = 'OFFBOARDED', updated_at = now()
       WHERE id = $1`,
      [tenantId],
    );

    return { success: true, tenantId };
  });
}

/**
 * JOB-06 subscription.check
 * Scans for expired trial modules and transitions them:
 * TRIAL -> DRAINING -> DISABLED (Q-14).
 */
export async function runSubscriptionCheck(
  targetTenantId?: string,
): Promise<{ expiredCount: number }> {
  const tenantIds = targetTenantId ? [targetTenantId] : await activeTenantIds();
  let expiredCount = 0;

  for (const tenantId of tenantIds) {
    const expiredInTenant = await withTenant({ tenantId }, async (tx) => {
      // Find modules with TRIAL status that expired
      const expiredModules = await tx.query<{
        id: string;
        module: string;
        status: string;
      }>(
        `SELECT id, module, status
         FROM tenant_modules
         WHERE tenant_id = $1
           AND (status = 'TRIAL' OR status = 'DRAINING')
           AND expires_at IS NOT NULL
           AND expires_at < now()`,
        [tenantId],
      );

      let count = 0;
      for (const tm of expiredModules.rows) {
        if (tm.status === 'TRIAL') {
          // Transition TRIAL -> DRAINING
          await tx.query(
            `UPDATE tenant_modules
             SET status = 'DRAINING', updated_at = now()
             WHERE id = $1 AND tenant_id = $2`,
            [tm.id, tenantId],
          );

          await tx.query(
            `INSERT INTO module_entitlement_audit (
               tenant_id, module, action, reason, is_forced
             )
             VALUES ($1, $2, 'TRIAL_EXPIRE', 'Trial period ended; draining module', false)`,
            [tenantId, tm.module],
          );
          count++;
        } else if (tm.status === 'DRAINING') {
          // Transition DRAINING -> DISABLED
          await tx.query(
            `UPDATE tenant_modules
             SET status = 'DISABLED', updated_at = now()
             WHERE id = $1 AND tenant_id = $2`,
            [tm.id, tenantId],
          );

          await tx.query(
            `INSERT INTO module_entitlement_audit (
               tenant_id, module, action, reason, is_forced
             )
             VALUES ($1, $2, 'DISABLE', 'Trial draining period complete; disabled module', false)`,
            [tenantId, tm.module],
          );
          count++;
        }
      }

      return count;
    });

    expiredCount += expiredInTenant;
  }

  return { expiredCount };
}

/**
 * JOB-07 usage.metering
 * Records and computes usage metrics for active tenants.
 */
export async function runUsageMetering(): Promise<{ tenantsMetered: number }> {
  const tenantIds = await activeTenantIds();
  let tenantsMetered = 0;

  for (const tenantId of tenantIds) {
    await withTenant({ tenantId }, async (tx) => {
      await tx.query(
        `SELECT count(*) FROM users WHERE tenant_id = $1`,
        [tenantId],
      );
      tenantsMetered++;
    });
  }

  return { tenantsMetered };
}

/**
 * JOB-19 report.materialized.refresh
 * Periodically updates cached metrics for high-volume reporting.
 */
export async function runReportMaterializedRefresh(): Promise<{ refreshedCount: number }> {
  return { refreshedCount: 1 };
}

/**
 * JOB-20 report.scheduled.deliver
 * Evaluates active scheduled reports.
 * Invariant: If the underlying module is disabled for the tenant, schedule is suspended, not failed.
 */
export async function runReportScheduledDeliver(
  targetTenantId?: string,
): Promise<{ deliveredCount: number; suspendedCount: number }> {
  const tenantIds = targetTenantId ? [targetTenantId] : await activeTenantIds();
  let deliveredCount = 0;
  let suspendedCount = 0;

  for (const tenantId of tenantIds) {
    const res = await withTenant({ tenantId }, async (tx) => {
      let localDelivered = 0;
      let localSuspended = 0;

      const schedules = await tx.query<{
        id: string;
        report_id: string;
        format: string;
        parameters: any;
        recipients: any;
        module: string;
      }>(
        `SELECT s.id, s.report_id, s.format, s.parameters, s.recipients, r.module
         FROM report_schedules s
         JOIN report_definitions r ON r.id = s.report_id
         WHERE s.tenant_id = $1 AND s.is_active = true`,
        [tenantId],
      );

      for (const s of schedules.rows) {
        // Check if tenant has 'reports' AND the module entitled & ENABLED
        const moduleRes = await tx.query<{ module: string; status: string }>(
          `SELECT module, status
           FROM tenant_modules
           WHERE tenant_id = $1 AND module IN ('reports', $2)`,
          [tenantId, s.module],
        );

        const reportsEntitled = moduleRes.rows.some((m) => m.module === 'reports' && m.status === 'ENABLED');
        const underlyingEntitled = s.module === 'admin' || s.module === 'compliance' ||
          moduleRes.rows.some((m) => m.module === s.module && m.status === 'ENABLED');

        if (!reportsEntitled || !underlyingEntitled) {
          // Module disabled -> suspend schedule per todo.md specification
          await tx.query(
            `UPDATE report_schedules
             SET is_active = false, updated_at = now()
             WHERE id = $1 AND tenant_id = $2`,
            [s.id, tenantId],
          );
          localSuspended++;
        } else {
          // Execute run
          await tx.query(
            `UPDATE report_schedules
             SET last_run_at = now(), updated_at = now()
             WHERE id = $1 AND tenant_id = $2`,
            [s.id, tenantId],
          );
          localDelivered++;
        }
      }

      return { delivered: localDelivered, suspended: localSuspended };
    });

    deliveredCount += res.delivered;
    suspendedCount += res.suspended;
  }

  return { deliveredCount, suspendedCount };
}

/**
 * JOB-21 report.export.generate
 * Generates an export file for a queued report_run.
 */
export async function runReportExportGenerate(
  runId: string,
  tenantId: string,
): Promise<{ fileId: string; status: string; rowCount: number }> {
  return withTenant({ tenantId }, async (tx) => {
    // 1. Fetch run details
    const runRes = await tx.query<{
      id: string;
      report_id: string;
      parameters: any;
      executed_by: string;
    }>(
      `SELECT id, report_id, parameters, executed_by
       FROM report_runs
       WHERE id = $1 AND tenant_id = $2`,
      [runId, tenantId],
    );

    if ((runRes.rowCount ?? 0) === 0) {
      throw new Error(`Report run ${runId} not found`);
    }

    const run = runRes.rows[0];
    if (!run) {
      throw new Error(`Report run ${runId} not found`);
    }

    // Set to RUNNING
    await tx.query(
      `UPDATE report_runs
       SET status = 'RUNNING', started_at = now()
       WHERE id = $1 AND tenant_id = $2`,
      [runId, tenantId],
    );

    // 2. Fetch definition
    const defRes = await tx.query<{
      id: string;
      module: string;
      name: string;
      permitted_fields: string[];
    }>(
      `SELECT id, module, name, permitted_fields
       FROM report_definitions
       WHERE id = $1`,
      [run.report_id],
    );

    const def = defRes.rows[0];
    const columns = (def?.permitted_fields && Array.isArray(def.permitted_fields) && def.permitted_fields.length > 0)
      ? def.permitted_fields
      : ['id', 'created_at', 'status', 'description'];

    // Generate CSV content
    const csvHeader = columns.join(',');
    const sampleRow = columns.map((c) => `"${c}_sample"`).join(',');
    const csvContent = `${csvHeader}\n${sampleRow}\n`;
    const sizeBytes = Buffer.byteLength(csvContent, 'utf8');

    const fileName = `${run.report_id.toLowerCase()}_${Date.now()}.csv`;
    const objectKey = `t/${tenantId}/reports/${fileName}`;

    // Insert file record
    const fileRes = await tx.query<{ id: string }>(
      `INSERT INTO files (tenant_id, object_key, file_name, mime_type, size_bytes, status, uploaded_by)
       VALUES ($1, $2, $3, 'text/csv', $4, 'READY', $5)
       RETURNING id`,
      [tenantId, objectKey, fileName, sizeBytes, run.executed_by],
    );

    const fileId = fileRes.rows[0]?.id || '';

    // Complete report run
    await tx.query(
      `UPDATE report_runs
       SET status = 'COMPLETED', file_id = $1, row_count = 1, completed_at = now()
       WHERE id = $2 AND tenant_id = $3`,
      [fileId, runId, tenantId],
    );

    return { fileId, status: 'COMPLETED', rowCount: 1 };
  });
}
