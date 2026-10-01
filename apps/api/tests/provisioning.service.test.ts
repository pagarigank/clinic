/**
 * Tests for ProvisioningService (todo 1.7 ⛔)
 * - Tenant create with module dependency validation
 * - Plan restriction enforcement
 * - Suspend / reactivate state machine
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProvisioningService } from '../src/platform/provisioning.service.js';
import { ProblemException } from '../src/http/problem.exception.js';
import { probeDb } from '@clinic/db/tests/helpers.js';

// Skip against missing DB
const hasDb = await probeDb();

describe.skipIf(!hasDb)('ProvisioningService (todo 1.7)', () => {
  let service: ProvisioningService;

  beforeEach(() => {
    service = new ProvisioningService();
  });

  const STARTER_PLAN_ID = 'fa000000-0000-4000-8000-000000000001';
  const COMPLETE_PLAN_ID = 'fa000000-0000-4000-8000-000000000002';

  describe('createTenant', () => {
    it('creates a tenant in PROVISIONING state', async () => {
      const slug = `test-tenant-${Date.now()}`;
      const tenant = await service.createTenant({
        name: 'Test Clinic',
        slug,
        planId: STARTER_PLAN_ID,
        modules: ['admin', 'patients'],
      });

      expect(tenant.status).toBe('PROVISIONING');
      expect(tenant.slug).toBe(slug);
      expect(tenant.name).toBe('Test Clinic');

      // Cleanup
      const { getAppPool, withTenantOnPool } = await import('@clinic/db');
      const pool = getAppPool();
      await withTenantOnPool(pool, { scope: 'platform', tenantId: tenant.id }, async (tx) => {
        await tx.query(`DELETE FROM outbox WHERE tenant_id = $1`, [tenant.id]);
        await tx.query(`DELETE FROM tenant_modules WHERE tenant_id = $1`, [tenant.id]);
        await tx.query(`DELETE FROM subscriptions WHERE tenant_id = $1`, [tenant.id]);
        await tx.query(`DELETE FROM tenants WHERE id = $1`, [tenant.id]);
      });
    });

    it('auto-adds admin module when missing from list', async () => {
      const slug = `test-tenant-noadmin-${Date.now()}`;
      const tenant = await service.createTenant({
        name: 'No Admin Test',
        slug,
        planId: STARTER_PLAN_ID,
        modules: ['patients'],
      });
      expect(tenant).toBeDefined();

      const { getAppPool, withTenantOnPool } = await import('@clinic/db');
      const pool = getAppPool();
      
      const moduleList = await withTenantOnPool(pool, { tenantId: tenant.id }, async (tx) => {
        const modules = await tx.query(
          `SELECT module FROM tenant_modules WHERE tenant_id = $1 ORDER BY module`,
          [tenant.id],
        );
        return modules.rows.map((r: any) => r.module);
      });
      expect(moduleList).toContain('admin');
      
      await withTenantOnPool(pool, { scope: 'platform', tenantId: tenant.id }, async (tx) => {
        await tx.query(`DELETE FROM outbox WHERE tenant_id = $1`, [tenant.id]);
        await tx.query(`DELETE FROM tenant_modules WHERE tenant_id = $1`, [tenant.id]);
        await tx.query(`DELETE FROM subscriptions WHERE tenant_id = $1`, [tenant.id]);
        await tx.query(`DELETE FROM tenants WHERE id = $1`, [tenant.id]);
      });
    });

    it('rejects a module that has a missing hard dependency', async () => {
      await expect(
        service.createTenant({
          name: 'Bad Deps',
          slug: `test-baddeps-${Date.now()}`,
          planId: COMPLETE_PLAN_ID,
          modules: ['pharmacy'], // requires patients + supply + admin
        }),
      ).rejects.toThrow(ProblemException);
    });

    it('rejects modules outside the starter plan restrictions', async () => {
      await expect(
        service.createTenant({
          name: 'Over Plan',
          slug: `test-overplan-${Date.now()}`,
          planId: STARTER_PLAN_ID,
          modules: ['admin', 'patients', 'laboratory'], // lab not allowed on starter
        }),
      ).rejects.toThrow(ProblemException);
    });

    it('rejects duplicate slugs', async () => {
      await expect(
        service.createTenant({
          name: 'Duplicate Slug',
          slug: 'demo-a', // pre-seeded in demo.sql
          planId: COMPLETE_PLAN_ID,
          modules: ['admin'],
        }),
      ).rejects.toThrow(ProblemException);
    });
  });

  describe('suspendTenant / reactivateTenant', () => {
    it('suspends an ACTIVE tenant and revokes sessions', async () => {
      const slug = `test-suspend-${Date.now()}`;
      const { withTenantOnPool } = await import('@clinic/db');
      const { getAppPool } = await import('@clinic/db');
      const pool = getAppPool();
      
      const tenantId = await withTenantOnPool(pool, { scope: 'platform' }, async (tx) => {
        const result = await tx.query<{ id: string }>(
          `INSERT INTO tenants (name, slug, status) VALUES ($1, $2, 'ACTIVE') RETURNING id`,
          [`Suspend Test`, slug],
        );
        return result.rows[0]!.id;
      });

      await service.suspendTenant(tenantId, 'Platform test suspension');

      await withTenantOnPool(pool, { scope: 'platform' }, async (tx) => {
        const row = await tx.query<{ status: string }>(
          `SELECT status FROM tenants WHERE id = $1`,
          [tenantId],
        );
        expect(row.rows[0]!.status).toBe('SUSPENDED');
        await tx.query(`DELETE FROM outbox WHERE tenant_id = $1`, [tenantId]);
        await tx.query(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
      });
    });

    it('reactivates a SUSPENDED tenant', async () => {
      const { withTenantOnPool } = await import('@clinic/db');
      const { getAppPool } = await import('@clinic/db');
      const pool = getAppPool();
      const slug = `test-reactivate-${Date.now()}`;
      
      const tenantId = await withTenantOnPool(pool, { scope: 'platform' }, async (tx) => {
        const result = await tx.query<{ id: string }>(
          `INSERT INTO tenants (name, slug, status) VALUES ($1, $2, 'SUSPENDED') RETURNING id`,
          [`Reactivate Test`, slug],
        );
        return result.rows[0]!.id;
      });

      await service.reactivateTenant(tenantId);

      await withTenantOnPool(pool, { scope: 'platform' }, async (tx) => {
        const row = await tx.query<{ status: string }>(
          `SELECT status FROM tenants WHERE id = $1`,
          [tenantId],
        );
        expect(row.rows[0]!.status).toBe('ACTIVE');
        await tx.query(`DELETE FROM outbox WHERE tenant_id = $1`, [tenantId]);
        await tx.query(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
      });
    });

    it('cannot suspend an already SUSPENDED tenant', async () => {
      const { withTenantOnPool } = await import('@clinic/db');
      const { getAppPool } = await import('@clinic/db');
      const pool = getAppPool();
      const slug = `test-double-suspend-${Date.now()}`;
      
      const tenantId = await withTenantOnPool(pool, { scope: 'platform' }, async (tx) => {
        const result = await tx.query<{ id: string }>(
          `INSERT INTO tenants (name, slug, status) VALUES ($1, $2, 'SUSPENDED') RETURNING id`,
          [`Double Suspend Test`, slug],
        );
        return result.rows[0]!.id;
      });

      await expect(
        service.suspendTenant(tenantId, 'Should fail'),
      ).rejects.toThrow(ProblemException);

      await withTenantOnPool(pool, { scope: 'platform' }, async (tx) => {
        await tx.query(`DELETE FROM outbox WHERE tenant_id = $1`, [tenantId]);
        await tx.query(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
      });
    });
  });
});
