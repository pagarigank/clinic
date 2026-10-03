import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createPool, withTenant } from '@clinic/db';
import { NotificationsService } from '../src/notifications/notifications.service.js';
import { FilesService } from '../src/files/files.service.js';
import { ReportsService } from '../src/reports/reports.service.js';
import { ProvisioningService } from '../src/platform/provisioning.service.js';
import { TenantModulesService } from '../src/tenant-modules/tenant-modules.service.js';

describe('Phase 9 — Connective Tissue & Platform Console Completion', () => {
  const TENANT_SUPPLY = '80000000-0000-4000-8000-000000000088';
  const TENANT_MULTI = '80000000-0000-4000-8000-000000000089';
  const USER_P9 = '80000000-0000-4000-8000-000000000087';
  const owner = createPool({ role: 'owner' });

  const notificationsService = new NotificationsService();
  const filesService = new FilesService();
  const reportsService = new ReportsService();
  const provisioningService = new ProvisioningService();
  const tenantModulesService = new TenantModulesService();

  let starterPlanId = '';
  let standardPlanId = '';
  let enterprisePlanId = '';

  beforeAll(async () => {
    // 1. Fetch starter and enterprise plan IDs
    const plansRes = await owner.query(`SELECT id, code FROM subscription_plans`);
    starterPlanId = plansRes.rows.find((r) => r.code === 'starter')?.id || '';
    standardPlanId = plansRes.rows.find((r) => r.code === 'standard')?.id || '';
    enterprisePlanId = plansRes.rows.find((r) => r.code === 'enterprise')?.id || '';

    // 2. Setup Supply-Only Tenant (TENANT_SUPPLY)
    await owner.query(
      `INSERT INTO tenants (id, name, slug, status)
       VALUES ($1, 'Supply Only Clinic', 'supply-only-clinic', 'ACTIVE')
       ON CONFLICT (id) DO UPDATE SET status = 'ACTIVE'`,
      [TENANT_SUPPLY],
    );

    // Setup Multi-Module Tenant (TENANT_MULTI)
    await owner.query(
      `INSERT INTO tenants (id, name, slug, status)
       VALUES ($1, 'Multi Module Clinic', 'multi-module-clinic', 'ACTIVE')
       ON CONFLICT (id) DO UPDATE SET status = 'ACTIVE'`,
      [TENANT_MULTI],
    );

    // Users
    await owner.query(
      `INSERT INTO users (id, tenant_id, email, name, password_hash, status)
       VALUES ($1, $2, 'supplyuser@example.com', 'Supply Officer', 'hash', 'ACTIVE')
       ON CONFLICT (id) DO NOTHING`,
      [USER_P9, TENANT_SUPPLY],
    );

    // Subscriptions
    await owner.query(
      `INSERT INTO subscriptions (tenant_id, plan_id, status)
       VALUES ($1, $2, 'ACTIVE')
       ON CONFLICT DO NOTHING`,
      [TENANT_SUPPLY, standardPlanId],
    );
    await owner.query(
      `INSERT INTO subscriptions (tenant_id, plan_id, status)
       VALUES ($1, $2, 'ACTIVE')
       ON CONFLICT DO NOTHING`,
      [TENANT_MULTI, enterprisePlanId],
    );

    // Seed modules for TENANT_SUPPLY: ONLY admin, supply, reports
    await owner.query(
      `INSERT INTO tenant_modules (tenant_id, module, status)
       VALUES
         ($1, 'admin', 'ENABLED'),
         ($1, 'supply', 'ENABLED'),
         ($1, 'reports', 'ENABLED'),
         ($1, 'notifications', 'ENABLED')
       ON CONFLICT (tenant_id, module) DO UPDATE SET status = EXCLUDED.status`,
      [TENANT_SUPPLY],
    );

    // Explicitly ensure laboratory, pharmacy, clinical, billing are DISABLED for TENANT_SUPPLY
    await owner.query(
      `INSERT INTO tenant_modules (tenant_id, module, status)
       VALUES
         ($1, 'laboratory', 'DISABLED'),
         ($1, 'pharmacy', 'DISABLED'),
         ($1, 'clinical', 'DISABLED'),
         ($1, 'billing', 'DISABLED')
       ON CONFLICT (tenant_id, module) DO UPDATE SET status = 'DISABLED'`,
      [TENANT_SUPPLY],
    );

    // Seed modules for TENANT_MULTI: all enabled
    await owner.query(
      `INSERT INTO tenant_modules (tenant_id, module, status)
       VALUES
         ($1, 'admin', 'ENABLED'),
         ($1, 'supply', 'ENABLED'),
         ($1, 'laboratory', 'ENABLED'),
         ($1, 'pharmacy', 'ENABLED'),
         ($1, 'clinical', 'ENABLED'),
         ($1, 'billing', 'ENABLED'),
         ($1, 'compliance', 'ENABLED'),
         ($1, 'reports', 'ENABLED'),
         ($1, 'notifications', 'ENABLED')
       ON CONFLICT (tenant_id, module) DO UPDATE SET status = 'ENABLED'`,
      [TENANT_MULTI],
    );
  });

  afterAll(async () => {
    await owner.query(`DELETE FROM user_notifications WHERE tenant_id IN ($1, $2)`, [TENANT_SUPPLY, TENANT_MULTI]);
    await owner.query(`DELETE FROM user_notification_preferences WHERE tenant_id IN ($1, $2)`, [TENANT_SUPPLY, TENANT_MULTI]);
    await owner.query(`DELETE FROM report_runs WHERE tenant_id IN ($1, $2)`, [TENANT_SUPPLY, TENANT_MULTI]);
    await owner.query(`DELETE FROM report_schedules WHERE tenant_id IN ($1, $2)`, [TENANT_SUPPLY, TENANT_MULTI]);
    await owner.query(`DELETE FROM file_versions WHERE tenant_id IN ($1, $2)`, [TENANT_SUPPLY, TENANT_MULTI]);
    await owner.query(`DELETE FROM files WHERE tenant_id IN ($1, $2)`, [TENANT_SUPPLY, TENANT_MULTI]);
    await owner.query(`DELETE FROM legal_holds WHERE tenant_id IN ($1, $2)`, [TENANT_SUPPLY, TENANT_MULTI]);
    await owner.query(`DELETE FROM items WHERE tenant_id IN ($1, $2)`, [TENANT_SUPPLY, TENANT_MULTI]);
    await owner.query(`DELETE FROM uoms WHERE tenant_id IN ($1, $2)`, [TENANT_SUPPLY, TENANT_MULTI]);
    await owner.query(`DELETE FROM subscriptions WHERE tenant_id IN ($1, $2)`, [TENANT_SUPPLY, TENANT_MULTI]);
    await owner.query(`DELETE FROM tenant_modules WHERE tenant_id IN ($1, $2)`, [TENANT_SUPPLY, TENANT_MULTI]);
    await owner.query(`DELETE FROM users WHERE id = $1`, [USER_P9]);
    await owner.query(`DELETE FROM tenants WHERE id IN ($1, $2)`, [TENANT_SUPPLY, TENANT_MULTI]);
    await owner.end();
  });

  describe('9.1 Notifications & Preferences', () => {
    it('creates, lists, and marks in-app notifications as read', async () => {
      const created = await notificationsService.createNotification(TENANT_SUPPLY, USER_P9, {
        userId: USER_P9,
        title: 'Stock Transfer Approved',
        body: 'Transfer TR-001 has been approved and is ready for dispatch.',
        severity: 'INFO',
        entityType: 'TRANSFER',
        entityId: 'TR-001',
      });

      expect(created.id).toBeDefined();
      expect(created.title).toBe('Stock Transfer Approved');

      // List notifications
      const list = await notificationsService.listNotifications(TENANT_SUPPLY, USER_P9);
      expect(list.data.length).toBeGreaterThanOrEqual(1);
      expect(list.meta.unreadCount).toBeGreaterThanOrEqual(1);

      // Mark single notification as read
      const readRes = await notificationsService.markAsRead(TENANT_SUPPLY, USER_P9, created.id);
      expect(readRes.read_at).toBeDefined();

      // Mark all as read
      const markAllRes = await notificationsService.markAllAsRead(TENANT_SUPPLY, USER_P9);
      expect(markAllRes.markedCount).toBeDefined();
    });

    it('manages user notification preferences including quiet hours', async () => {
      // Get default preferences
      const initial = await notificationsService.getPreferences(TENANT_SUPPLY, USER_P9);
      expect(initial.channels).toBeDefined();

      // Update preferences
      const updated = await notificationsService.updatePreferences(TENANT_SUPPLY, USER_P9, {
        channels: { inApp: true, email: true, sms: false },
        quietHoursEnabled: true,
        quietHoursStart: '23:00:00',
        quietHoursEnd: '06:00:00',
      });

      expect(updated.quiet_hours_enabled).toBe(true);
      expect(updated.quiet_hours_start).toBe('23:00:00');
      expect(updated.quiet_hours_end).toBe('06:00:00');
    });
  });

  describe('9.2 Files & Scan Gating', () => {
    it('manages file lifecycle, version history, and blocks infected files from download', async () => {
      // 1. Request presigned upload
      const upload = await filesService.requestUpload(TENANT_SUPPLY, USER_P9, {
        fileName: 'supply_invoice.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 2048,
      });

      expect(upload.fileId).toBeDefined();
      expect(upload.uploadUrl).toBeDefined();

      // 2. Complete upload -> sets READY, CLEAN, and creates version 1
      const completed = await filesService.completeUpload(TENANT_SUPPLY, USER_P9, upload.fileId);
      expect(completed?.status).toBe('READY');
      expect(completed?.scan_status).toBe('CLEAN');

      // 3. Verify version history
      const versions = await filesService.listVersions(TENANT_SUPPLY, USER_P9, upload.fileId);
      expect(versions.versions.length).toBe(1);
      expect(versions.versions[0].version).toBe(1);

      // 4. Download URL succeeds (≤ 60s)
      const download = await filesService.getDownloadUrl(TENANT_SUPPLY, USER_P9, upload.fileId);
      expect(download.downloadUrl).toBeDefined();
      expect(download.expiresInSeconds).toBe(60);

      // 5. Preview URL succeeds
      const preview = await filesService.getPreviewUrl(TENANT_SUPPLY, USER_P9, upload.fileId);
      expect(preview.previewUrl).toBeDefined();
      expect(preview.mimeType).toBe('application/pdf');

      // 6. Scan gating: mark file as INFECTED -> download is strictly blocked (FORBIDDEN)
      await filesService.updateScanStatus(TENANT_SUPPLY, upload.fileId, 'INFECTED');
      await expect(filesService.getDownloadUrl(TENANT_SUPPLY, USER_P9, upload.fileId)).rejects.toMatchObject({
        response: {
          code: 'FORBIDDEN',
          detail: expect.stringContaining('infected'),
        },
      });

      // Preview also blocked for infected files
      await expect(filesService.getPreviewUrl(TENANT_SUPPLY, USER_P9, upload.fileId)).rejects.toMatchObject({
        response: {
          code: 'FORBIDDEN',
        },
      });
    });
  });

  describe('9.3 Reports & Entitlement Isolation (AC-21)', () => {
    it('AC-21: supply-only tenant catalog contains NO RPT-LAB-*, RPT-PHM-*, RPT-CLN-*, or RPT-BIL-*', async () => {
      const catalog = await reportsService.getCatalog(TENANT_SUPPLY, USER_P9);
      const reportIds = catalog.reports.map((r) => r.id);

      // Must contain supply reports and admin reports
      expect(reportIds).toContain('RPT-SUP-01');
      expect(reportIds).toContain('RPT-ADM-01');

      // MUST NOT contain lab, pharmacy, clinical, or billing reports
      const forbiddenPrefixes = ['RPT-LAB-', 'RPT-PHM-', 'RPT-CLN-', 'RPT-BIL-'];
      for (const id of reportIds) {
        for (const prefix of forbiddenPrefixes) {
          expect(id.startsWith(prefix)).toBe(false);
        }
      }
    });

    it('AC-21: requesting a disabled module report by ID directly is refused with FORBIDDEN', async () => {
      // TENANT_SUPPLY attempting to run RPT-LAB-01 (laboratory is DISABLED)
      await expect(
        reportsService.runReport(TENANT_SUPPLY, USER_P9, 'RPT-LAB-01', {}),
      ).rejects.toMatchObject({
        response: {
          code: 'FORBIDDEN',
          detail: expect.stringContaining('not entitled to module'),
        },
      });

      // TENANT_SUPPLY attempting to export RPT-PHM-01 (pharmacy is DISABLED)
      await expect(
        reportsService.exportReport(TENANT_SUPPLY, USER_P9, 'RPT-PHM-01', { format: 'CSV' }),
      ).rejects.toMatchObject({
        response: {
          code: 'FORBIDDEN',
          detail: expect.stringContaining('not entitled to module'),
        },
      });
    });

    it('runs, exports, and schedules an entitled report (RPT-SUP-01)', async () => {
      // Run report
      const runRes = await reportsService.runReport(TENANT_SUPPLY, USER_P9, 'RPT-SUP-01', {});
      expect(runRes.reportId).toBe('RPT-SUP-01');
      expect(runRes.data).toBeDefined();

      // Export report
      const exportRes = await reportsService.exportReport(TENANT_SUPPLY, USER_P9, 'RPT-SUP-01', { format: 'CSV' });
      expect(exportRes.status).toBe('COMPLETED');
      expect(exportRes.fileId).toBeDefined();

      // Schedule report
      const scheduleRes = await reportsService.createSchedule(TENANT_SUPPLY, USER_P9, {
        reportId: 'RPT-SUP-01',
        cronExpression: '0 8 * * *',
        format: 'CSV',
      });
      expect(scheduleRes.id).toBeDefined();

      // Delete schedule
      const deleteRes = await reportsService.deleteSchedule(TENANT_SUPPLY, USER_P9, scheduleRes.id);
      expect(deleteRes.deleted).toBe(true);
    });
  });

  describe('9.4 Platform Console Completion', () => {
    it('GET /platform/plans/:id/modules returns allowed module set and limits for wizard', async () => {
      const starterModules = await provisioningService.getPlanModules(starterPlanId);
      expect(starterModules.planId).toBe(starterPlanId);
      expect(starterModules.modules).toContain('admin');
      expect(starterModules.modules).toContain('clinical');
    });

    it('Q-15 Downgrade Protection: plan downgrade that would orphan an entitled module is refused with actionable message', async () => {
      // TENANT_MULTI is on enterprisePlan with laboratory, pharmacy, clinical entitled.
      // Attempting to downgrade to starterPlan (which does NOT include laboratory):
      await expect(
        provisioningService.changePlan(TENANT_MULTI, starterPlanId, USER_P9),
      ).rejects.toMatchObject({
        response: {
          code: 'CONFLICT',
          detail: expect.stringMatching(/Cannot downgrade plan: module '.*' is still entitled\. Please drain or disable the module first\./),
        },
      });
    });

    it('JOB-05 Offboard check: offboarding refuses to purge while an active legal hold exists', async () => {
      // 1. Create active legal hold
      await withTenant({ tenantId: TENANT_MULTI }, async (tx) => {
        await tx.query(
          `INSERT INTO legal_holds (id, tenant_id, hold_no, scope, reason)
           VALUES ('80000000-0000-4000-8000-000000000077', $1, 'HLD-P9-99', 'ENTIRE_TENANT', 'Pending regulatory audit')
           ON CONFLICT DO NOTHING`,
          [TENANT_MULTI],
        );
      });

      // 2. Offboard attempt -> MUST REJECT WITH CONFLICT
      await expect(
        provisioningService.offboardTenant(TENANT_MULTI, 'Closing down clinic', USER_P9),
      ).rejects.toMatchObject({
        response: {
          code: 'CONFLICT',
          detail: expect.stringContaining('active legal hold'),
        },
      });

      // 3. Release the hold
      await withTenant({ tenantId: TENANT_MULTI }, async (tx) => {
        await tx.query(
          `UPDATE legal_holds
           SET released_at = now(), release_reason = 'Audit cleared'
           WHERE tenant_id = $1 AND id = '80000000-0000-4000-8000-000000000077'`,
          [TENANT_MULTI],
        );
      });

      // 4. Offboard now succeeds
      const offboardRes = await provisioningService.offboardTenant(TENANT_MULTI, 'Closing down clinic', USER_P9);
      expect(offboardRes.status).toBe('OFFBOARDED');

      // Restore tenant to ACTIVE for remaining tests
      await owner.query(`UPDATE tenants SET status = 'ACTIVE' WHERE id = $1`, [TENANT_MULTI]);
    });

    it('RPT-PLT-09 Entitlement transparency report surfaces NO PHI', async () => {
      const report = await provisioningService.getEntitlementTransparencyReport(TENANT_MULTI);
      expect(report.reportId).toBe('RPT-PLT-09');
      expect(report.meta.containsPhi).toBe(false);

      // Verify no PHI keys in response rows
      const phiKeys = ['patient_name', 'first_name', 'last_name', 'date_of_birth', 'diagnosis', 'medical_record_number', 'ssn'];
      for (const row of report.rows) {
        for (const key of phiKeys) {
          expect(row).not.toHaveProperty(key);
        }
      }
    });

    it('AC-25: drain -> force-disable -> re-enable round trip preserves all records and audit integrity', async () => {
      // 1. Initial: supply module is ENABLED in TENANT_SUPPLY
      // Create a test item under supply
      let itemId = '';
      await withTenant({ tenantId: TENANT_SUPPLY }, async (tx) => {
        const uomRes = await tx.query<{ id: string }>(
          `INSERT INTO uoms (tenant_id, code, name)
           VALUES ($1, 'BOX', 'Box')
           ON CONFLICT (tenant_id, code) DO UPDATE SET name = 'Box'
           RETURNING id`,
          [TENANT_SUPPLY],
        );
        const uomId = uomRes.rows[0]?.id;

        const itemRes = await tx.query<{ id: string }>(
          `INSERT INTO items (tenant_id, code, name, item_type, base_uom_id)
           VALUES ($1, 'TEST-ITEM-AC25', 'AC-25 Test Item', 'MEDICINE', $2)
           ON CONFLICT (tenant_id, code) DO UPDATE SET name = 'AC-25 Test Item'
           RETURNING id`,
          [TENANT_SUPPLY, uomId],
        );
        itemId = itemRes.rows[0]?.id || '';
      });

      // 2. Transition ENABLED -> DRAINING
      await tenantModulesService.updateModuleStatus(TENANT_SUPPLY, 'supply', 'DRAINING', undefined, undefined, USER_P9);
      let tm = await owner.query(`SELECT status FROM tenant_modules WHERE tenant_id = $1 AND module = 'supply'`, [TENANT_SUPPLY]);
      expect(tm.rows[0].status).toBe('DRAINING');

      // 3. Transition DRAINING -> DISABLED (force: true)
      await tenantModulesService.updateModuleStatus(TENANT_SUPPLY, 'supply', 'DISABLED', 'Maintenance testing', true, USER_P9);
      tm = await owner.query(`SELECT status FROM tenant_modules WHERE tenant_id = $1 AND module = 'supply'`, [TENANT_SUPPLY]);
      expect(tm.rows[0].status).toBe('DISABLED');

      // 4. Re-enable module: DISABLED -> ENABLED
      await tenantModulesService.enableModule(TENANT_SUPPLY, 'supply', 'ENABLED', USER_P9);
      tm = await owner.query(`SELECT status FROM tenant_modules WHERE tenant_id = $1 AND module = 'supply'`, [TENANT_SUPPLY]);
      expect(tm.rows[0].status).toBe('ENABLED');

      // 5. Verify data preserved intact
      await withTenant({ tenantId: TENANT_SUPPLY }, async (tx) => {
        const itemCheck = await tx.query(`SELECT id, code, name FROM items WHERE tenant_id = $1 AND id = $2`, [TENANT_SUPPLY, itemId]);
        expect(itemCheck.rowCount).toBe(1);
        expect(itemCheck.rows[0].code).toBe('TEST-ITEM-AC25');
      });
    });
  });
});
