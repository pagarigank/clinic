import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TenantModulesService } from '../src/tenant-modules/tenant-modules.service.js';
import { ProblemException } from '../src/http/problem.exception.js';

let mockQuery = vi.fn();

// Mock withTenant
vi.mock('@clinic/db', () => ({
  withTenant: vi.fn(async (_opts, fn) => {
    return fn({ query: mockQuery });
  })
}));

describe('TenantModulesService', () => {
  let service: TenantModulesService;

  beforeEach(() => {
    service = new TenantModulesService();
    mockQuery = vi.fn().mockImplementation(async (sql, _params) => {
      if (sql.includes('SELECT sp.code')) {
        return { rowCount: 1, rows: [{ code: 'starter' }] };
      }
      if (sql.includes('SELECT status FROM tenant_modules')) {
        return { rowCount: 1, rows: [{ status: 'DRAINING' }] };
      }
      if (sql.includes('SELECT module FROM tenant_modules WHERE')) {
        return { rowCount: 1, rows: [{ module: 'patients' }] };
      }
      return { rowCount: 1, rows: [] };
    });
  });

  describe('validateDependencies', () => {
    it('throws when dependency is missing', () => {
      expect(() => service.validateDependencies(new Set(['clinical']))).toThrow(ProblemException);
    });

    it('passes when dependencies are met', () => {
      expect(() => service.validateDependencies(new Set(['admin', 'patients', 'clinical']))).not.toThrow();
    });
  });

  describe('checkPlanValidation', () => {
    it('throws when module is not in starter plan', async () => {
      await expect(service.checkPlanValidation('tenant-1', new Set(['laboratory']))).rejects.toThrow(ProblemException);
    });

    it('passes when module is in starter plan', async () => {
      await expect(service.checkPlanValidation('tenant-1', new Set(['patients']))).resolves.not.toThrow();
    });
  });

  describe('preflightModule & open work', () => {
    it('detects open cashier shifts and unposted invoices as blockers for billing', async () => {
      mockQuery.mockImplementation(async (sql) => {
        if (sql.includes('cashier_shifts')) {
          return { rowCount: 1, rows: [{ count: 1 }] };
        }
        if (sql.includes('invoices')) {
          return { rowCount: 1, rows: [{ count: 3 }] };
        }
        if (sql.includes('credit_notes')) {
          return { rowCount: 1, rows: [{ count: 0 }] };
        }
        return { rowCount: 1, rows: [] };
      });

      const res = await service.preflightModule('tenant-1', 'billing');
      expect(res.canDisable).toBe(false);
      expect(res.blockers).toHaveLength(2);
      expect(res.blockers[0]?.type).toBe('OPEN_CASHIER_SHIFTS');
      expect(res.blockers[0]?.count).toBe(1);
      expect(res.blockers[1]?.type).toBe('UNPOSTED_DOCUMENTS');
      expect(res.blockers[1]?.count).toBe(3);
    });

    it('returns canDisable true when no blockers exist for billing', async () => {
      mockQuery.mockImplementation(async (sql) => {
        if (sql.includes('cashier_shifts') || sql.includes('invoices') || sql.includes('credit_notes')) {
          return { rowCount: 1, rows: [{ count: 0 }] };
        }
        return { rowCount: 1, rows: [] };
      });

      const res = await service.preflightModule('tenant-1', 'billing');
      expect(res.canDisable).toBe(true);
      expect(res.blockers).toHaveLength(0);
    });

    it('refuses disable with MODULE_HAS_OPEN_WORK when open work exists and force is false', async () => {
      mockQuery.mockImplementation(async (sql) => {
        if (sql.includes('SELECT status FROM tenant_modules')) {
          return { rowCount: 1, rows: [{ status: 'ENABLED' }] };
        }
        if (sql.includes('cashier_shifts')) {
          return { rowCount: 1, rows: [{ count: 1 }] };
        }
        if (sql.includes('invoices')) {
          return { rowCount: 1, rows: [{ count: 0 }] };
        }
        if (sql.includes('credit_notes')) {
          return { rowCount: 1, rows: [{ count: 0 }] };
        }
        return { rowCount: 1, rows: [] };
      });

      await expect(
        service.updateModuleStatus('tenant-1', 'billing', 'DISABLED', 'Deprecating billing', false)
      ).rejects.toThrow(ProblemException);
    });

    it('allows disable when force is true even if open work exists', async () => {
      mockQuery.mockImplementation(async (sql) => {
        if (sql.includes('SELECT status FROM tenant_modules')) {
          return { rowCount: 1, rows: [{ status: 'ENABLED' }] };
        }
        if (sql.includes('UPDATE tenant_modules')) {
          return { rowCount: 1, rows: [] };
        }
        return { rowCount: 1, rows: [] };
      });

      await expect(
        service.updateModuleStatus('tenant-1', 'billing', 'DISABLED', 'Emergency forced disable', true)
      ).resolves.not.toThrow();
    });

    it('allows transitioning to DRAINING state', async () => {
      mockQuery.mockImplementation(async (sql) => {
        if (sql.includes('SELECT status FROM tenant_modules')) {
          return { rowCount: 1, rows: [{ status: 'ENABLED' }] };
        }
        if (sql.includes('UPDATE tenant_modules')) {
          return { rowCount: 1, rows: [] };
        }
        return { rowCount: 1, rows: [] };
      });

      await expect(
        service.updateModuleStatus('tenant-1', 'billing', 'DRAINING', 'Closing down cashier')
      ).resolves.not.toThrow();
    });
  });
});

