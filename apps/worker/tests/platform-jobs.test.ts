import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createPool, withTenant } from '@clinic/db';
import {
  isWithinQuietHours,
  runNotificationSend,
  runTenantOffboardPurge,
  runSubscriptionCheck,
  runTenantExport,
  runReportScheduledDeliver,
} from '../src/handlers/platform-jobs.handler.js';

describe('Phase 9 Background Jobs', () => {
  const testTenantId = '90000000-0000-4000-8000-000000000099';
  const testUserId = '90000000-0000-4000-8000-000000000098';
  const owner = createPool({ role: 'owner' });

  beforeAll(async () => {
    // Seed test tenant & user using owner pool
    await owner.query(
      `INSERT INTO tenants (id, name, slug, status)
       VALUES ($1, 'Phase 9 Test Tenant', 'phase9-test-tenant', 'ACTIVE')
       ON CONFLICT (id) DO UPDATE SET status = 'ACTIVE'`,
      [testTenantId],
    );

    await owner.query(
      `INSERT INTO users (id, tenant_id, email, name, password_hash, status)
       VALUES ($1, $2, 'p9user@example.com', 'Phase 9 User', 'hash', 'ACTIVE')
       ON CONFLICT (id) DO NOTHING`,
      [testUserId, testTenantId],
    );
  });

  afterAll(async () => {
    await owner.query(`DELETE FROM user_notifications WHERE tenant_id = $1`, [testTenantId]);
    await owner.query(`DELETE FROM user_notification_preferences WHERE tenant_id = $1`, [testTenantId]);
    await owner.query(`DELETE FROM notification_delivery_logs WHERE tenant_id = $1`, [testTenantId]);
    await owner.query(`DELETE FROM legal_holds WHERE tenant_id = $1`, [testTenantId]);
    await owner.query(`DELETE FROM tenant_modules WHERE tenant_id = $1`, [testTenantId]);
    await owner.query(`DELETE FROM report_schedules WHERE tenant_id = $1`, [testTenantId]);
    await owner.query(`DELETE FROM files WHERE tenant_id = $1`, [testTenantId]);
    await owner.query(`DELETE FROM users WHERE id = $1`, [testUserId]);
    await owner.query(`DELETE FROM tenants WHERE id = $1`, [testTenantId]);
    await owner.end();
  });

  it('correctly calculates isWithinQuietHours', () => {
    // Normal window: 01:00 to 05:00
    expect(isWithinQuietHours('02:00', '01:00', '05:00')).toBe(true);
    expect(isWithinQuietHours('06:00', '01:00', '05:00')).toBe(false);

    // Overnight window: 22:00 to 07:00
    expect(isWithinQuietHours('23:30', '22:00', '07:00')).toBe(true);
    expect(isWithinQuietHours('04:15', '22:00', '07:00')).toBe(true);
    expect(isWithinQuietHours('12:00', '22:00', '07:00')).toBe(false);
  });

  it('JOB-02 notification.send respects quiet hours but clinical and critical alerts bypass', async () => {
    // 1. Setup user preferences: quiet hours enabled between 22:00 and 07:00
    await withTenant({ tenantId: testTenantId }, async (tx) => {
      await tx.query(
        `INSERT INTO user_notification_preferences (
           tenant_id, user_id, channels, quiet_hours_enabled, quiet_hours_start, quiet_hours_end
         )
         VALUES ($1, $2, '{"in_app": true}'::jsonb, true, '22:00:00', '07:00:00')
         ON CONFLICT (tenant_id, user_id)
         DO UPDATE SET quiet_hours_enabled = true, quiet_hours_start = '22:00:00', quiet_hours_end = '07:00:00'`,
        [testTenantId, testUserId],
      );

      // Create a routine INFO notification
      await tx.query(
        `INSERT INTO user_notifications (id, tenant_id, user_id, title, body, severity)
         VALUES ('90000000-0000-4000-8000-000000000101', $1, $2, 'Routine Info', 'Routine body', 'INFO')
         ON CONFLICT DO NOTHING`,
        [testTenantId, testUserId],
      );

      // Create a CLINICAL_ALERT notification
      await tx.query(
        `INSERT INTO user_notifications (id, tenant_id, user_id, title, body, severity)
         VALUES ('90000000-0000-4000-8000-000000000102', $1, $2, 'Critical Lab Result', 'Panic value', 'CLINICAL_ALERT')
         ON CONFLICT DO NOTHING`,
        [testTenantId, testUserId],
      );

      // Create a CRITICAL notification
      await tx.query(
        `INSERT INTO user_notifications (id, tenant_id, user_id, title, body, severity)
         VALUES ('90000000-0000-4000-8000-000000000103', $1, $2, 'System Emergency', 'Database failover', 'CRITICAL')
         ON CONFLICT DO NOTHING`,
        [testTenantId, testUserId],
      );
    });

    // Run job simulating midnight (23:30)
    const res = await runNotificationSend(testTenantId, '23:30');
    expect(res.processedCount).toBe(3);
    expect(res.suppressedCount).toBe(1); // INFO was suppressed
    expect(res.deliveredCount).toBe(2);  // CLINICAL_ALERT and CRITICAL bypassed quiet hours!

    // Verify delivery logs
    await withTenant({ tenantId: testTenantId }, async (tx) => {
      const logs = await tx.query<{ notification_id: string; status: string }>(
        `SELECT notification_id, status FROM notification_delivery_logs WHERE tenant_id = $1`,
        [testTenantId],
      );
      const infoLog = logs.rows.find((l) => l.notification_id === '90000000-0000-4000-8000-000000000101');
      const clinicalLog = logs.rows.find((l) => l.notification_id === '90000000-0000-4000-8000-000000000102');
      const criticalLog = logs.rows.find((l) => l.notification_id === '90000000-0000-4000-8000-000000000103');

      expect(infoLog?.status).toBe('SUPPRESSED_QUIET_HOURS');
      expect(clinicalLog?.status).toBe('SENT');
      expect(criticalLog?.status).toBe('SENT');
    });
  });

  it('JOB-05 offboard purge strictly refuses if an active legal hold exists', async () => {
    // 1. Create an active legal hold
    await withTenant({ tenantId: testTenantId }, async (tx) => {
      await tx.query(
        `INSERT INTO legal_holds (id, tenant_id, hold_no, scope, reason)
         VALUES ('90000000-0000-4000-8000-000000000104', $1, 'HLD-P9-01', 'ENTIRE_TENANT', 'Pending litigation')
         ON CONFLICT DO NOTHING`,
        [testTenantId],
      );
    });

    // 2. Attempt purge -> MUST THROW
    await expect(runTenantOffboardPurge(testTenantId)).rejects.toThrow(/PURGE_BLOCKED_BY_LEGAL_HOLD/);

    // 3. Release the legal hold
    await withTenant({ tenantId: testTenantId }, async (tx) => {
      await tx.query(
        `UPDATE legal_holds
         SET released_at = now(), release_reason = 'Litigation settled'
         WHERE tenant_id = $1 AND id = '90000000-0000-4000-8000-000000000104'`,
        [testTenantId],
      );
    });

    // 4. Purge now succeeds
    const purgeRes = await runTenantOffboardPurge(testTenantId);
    expect(purgeRes.success).toBe(true);

    const tRes = await owner.query(`SELECT status FROM tenants WHERE id = $1`, [testTenantId]);
    expect(tRes.rows[0].status).toBe('OFFBOARDED');
  });

  it('JOB-06 subscription.check expires trial modules to draining and then disabled', async () => {
    // Restore tenant status to ACTIVE
    await owner.query(`UPDATE tenants SET status = 'ACTIVE' WHERE id = $1`, [testTenantId]);

    // Insert an expired TRIAL module
    await withTenant({ tenantId: testTenantId }, async (tx) => {
      await tx.query(
        `INSERT INTO tenant_modules (tenant_id, module, status, expires_at)
         VALUES ($1, 'laboratory', 'TRIAL', now() - interval '1 hour')
         ON CONFLICT (tenant_id, module)
         DO UPDATE SET status = 'TRIAL', expires_at = now() - interval '1 hour'`,
        [testTenantId],
      );
    });

    // Pass 1: TRIAL -> DRAINING
    const pass1 = await runSubscriptionCheck(testTenantId);
    expect(pass1.expiredCount).toBe(1);

    await withTenant({ tenantId: testTenantId }, async (tx) => {
      const tm = await tx.query(`SELECT status FROM tenant_modules WHERE tenant_id = $1 AND module = 'laboratory'`, [testTenantId]);
      expect(tm.rows[0].status).toBe('DRAINING');
    });

    // Pass 2: DRAINING -> DISABLED
    const pass2 = await runSubscriptionCheck(testTenantId);
    expect(pass2.expiredCount).toBe(1);

    await withTenant({ tenantId: testTenantId }, async (tx) => {
      const tm = await tx.query(`SELECT status FROM tenant_modules WHERE tenant_id = $1 AND module = 'laboratory'`, [testTenantId]);
      expect(tm.rows[0].status).toBe('DISABLED');
    });
  });

  it('JOB-04 tenant.export bundles data into tenant-scoped JSON file', async () => {
    const exportRes = await runTenantExport(testTenantId, testUserId);
    expect(exportRes.fileId).toBeDefined();
    expect(exportRes.fileName).toContain(`tenant_export_${testTenantId}`);

    await withTenant({ tenantId: testTenantId }, async (tx) => {
      const file = await tx.query(`SELECT id, status, mime_type FROM files WHERE id = $1`, [exportRes.fileId]);
      expect(file.rows[0].status).toBe('READY');
      expect(file.rows[0].mime_type).toBe('application/json');
    });
  });

  it('JOB-20 suspends scheduled reports when underlying module is disabled', async () => {
    // Schedule a lab report (RPT-LAB-01), but 'laboratory' module is now DISABLED in tenant
    await withTenant({ tenantId: testTenantId }, async (tx) => {
      // Ensure 'reports' is enabled
      await tx.query(
        `INSERT INTO tenant_modules (tenant_id, module, status)
         VALUES ($1, 'reports', 'ENABLED')
         ON CONFLICT (tenant_id, module) DO UPDATE SET status = 'ENABLED'`,
        [testTenantId],
      );

      await tx.query(
        `INSERT INTO report_schedules (id, tenant_id, report_id, cron_expression, is_active, created_by)
         VALUES ('90000000-0000-4000-8000-000000000105', $1, 'RPT-LAB-01', '0 6 * * *', true, $2)
         ON CONFLICT (id) DO UPDATE SET is_active = true`,
        [testTenantId, testUserId],
      );
    });

    // Run JOB-20
    const deliverRes = await runReportScheduledDeliver(testTenantId);
    expect(deliverRes.suspendedCount).toBe(1);

    // Verify schedule is now suspended (is_active = false)
    await withTenant({ tenantId: testTenantId }, async (tx) => {
      const s = await tx.query(`SELECT is_active FROM report_schedules WHERE id = '90000000-0000-4000-8000-000000000105'`, []);
      expect(s.rows[0].is_active).toBe(false);
    });
  });
});
