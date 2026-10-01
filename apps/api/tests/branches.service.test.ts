/**
 * Tests for BranchesService (todo 1.7 ⛔)
 * - Branch lifecycle: create, update, archive, reactivate
 * - Plan quota enforcement (QUOTA_EXCEEDED)
 * - Service profile ↔ module cross-check
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { BranchesService } from '../src/admin/branches.service.js';
import { ProblemException } from '../src/http/problem.exception.js';
import { probeDb } from '@clinic/db/tests/helpers.js';

const hasDb = await probeDb();

// Seeded tenant A from demo.sql
const TENANT_A = '11111111-1111-4111-8111-111111111111';

describe.skipIf(!hasDb)('BranchesService (todo 1.7)', () => {
  let service: BranchesService;

  beforeEach(() => {
    service = new BranchesService();
  });

  describe('createBranch', () => {
    it('creates a branch with default service profile', async () => {
      const TENANT_B = '22222222-2222-4222-8222-222222222222';
      const branch = await service.createBranch(TENANT_B, {
        code: `TST${Date.now().toString().slice(-4)}`,
        name: 'Test Branch',
      });
      expect(branch.serviceProfile).toEqual(['consultation']);
      expect(branch.status).toBe('ACTIVE');

      // Cleanup
      const { getAppPool } = await import('@clinic/db');
      await getAppPool().query(`DELETE FROM branches WHERE id = $1`, [branch.id]);
    });

    it('rejects a duplicate branch code within the same tenant', async () => {
      await expect(
        service.createBranch(TENANT_A, { code: 'MAIN', name: 'Duplicate Main' }),
      ).rejects.toThrow(ProblemException);
    });

    it('rejects a service profile with a module not enabled', async () => {
      // Tenant A only has admin + patients — laboratory is not enabled
      await expect(
        service.createBranch(TENANT_A, {
          code: `LAB${Date.now().toString().slice(-4)}`,
          name: 'Lab Branch',
          serviceProfile: ['consultation', 'embedded_laboratory'],
        }),
      ).rejects.toThrow(ProblemException);
    });

    it('enforces starter plan branch quota (max 1 branch)', async () => {
      // Tenant A has MAIN branch already and is on starter plan
      await expect(
        service.createBranch(TENANT_A, { code: 'EXTRA', name: 'Extra Branch' }),
      ).rejects.toThrow(ProblemException);
    });
  });

  describe('archiveBranch / reactivateBranch', () => {
    it('archives and then reactivates a branch', async () => {
      // Create a fresh branch to test on (Tenant B has complete plan, no quota issue)
      const TENANT_B = '22222222-2222-4222-8222-222222222222';
      const branch = await service.createBranch(TENANT_B, {
        code: `ARC${Date.now().toString().slice(-4)}`,
        name: 'Archive Test Branch',
      });

      await service.archiveBranch(TENANT_B, branch.id);
      const archived = await service.getBranch(TENANT_B, branch.id);
      expect(archived.status).toBe('ARCHIVED');
      expect(archived.deletedAt).not.toBeNull();

      const reactivated = await service.reactivateBranch(TENANT_B, branch.id);
      expect(reactivated.status).toBe('ACTIVE');
      expect(reactivated.deletedAt).toBeNull();

      // Cleanup
      const { getAppPool } = await import('@clinic/db');
      await getAppPool().query(`DELETE FROM branches WHERE id = $1`, [branch.id]);
    });

    it('blocks archive when branch has active users', async () => {
      // MAIN branch in Tenant A has active users
      const MAIN_BRANCH = 'a1000000-0000-4000-8000-000000000001';
      await expect(
        service.archiveBranch(TENANT_A, MAIN_BRANCH),
      ).rejects.toThrow(ProblemException);
    });
  });

  describe('updateBranch', () => {
    it('updates branch name with correct row version', async () => {
      const TENANT_B = '22222222-2222-4222-8222-222222222222';
      const branch = await service.createBranch(TENANT_B, {
        code: `UPD${Date.now().toString().slice(-4)}`,
        name: 'Update Test',
      });

      const updated = await service.updateBranch(TENANT_B, branch.id, { name: 'Updated Name' }, branch.rowVersion);
      expect(updated.name).toBe('Updated Name');
      expect(updated.rowVersion).toBe(branch.rowVersion + 1);

      const { getAppPool } = await import('@clinic/db');
      await getAppPool().query(`DELETE FROM branches WHERE id = $1`, [branch.id]);
    });

    it('rejects update with a stale row version', async () => {
      const TENANT_B = '22222222-2222-4222-8222-222222222222';
      const branch = await service.createBranch(TENANT_B, {
        code: `SRV${Date.now().toString().slice(-4)}`,
        name: 'Stale Version Test',
      });

      await expect(
        service.updateBranch(TENANT_B, branch.id, { name: 'Stale Update' }, 9999),
      ).rejects.toThrow(ProblemException);

      const { getAppPool } = await import('@clinic/db');
      await getAppPool().query(`DELETE FROM branches WHERE id = $1`, [branch.id]);
    });
  });

  describe('getBranch', () => {
    it('returns 404 for branch in another tenant (no existence oracle, G-02)', async () => {
      // MAIN branch of Tenant A should not be visible from Tenant B
      const TENANT_B = '22222222-2222-4222-8222-222222222222';
      const TENANT_A_MAIN = 'a1000000-0000-4000-8000-000000000001';
      await expect(
        service.getBranch(TENANT_B, TENANT_A_MAIN),
      ).rejects.toThrow(ProblemException);
    });
  });
});
