import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TenantModulesService } from '../src/tenant-modules/tenant-modules.service.js';
import { ProblemException } from '../src/http/problem.exception.js';

// Mock withTenant
vi.mock('@clinic/db', () => ({
  withTenant: vi.fn(async (_opts, fn) => {
    const mockTx = {
      query: vi.fn().mockImplementation(async (sql, _params) => {
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
      })
    };
    return fn(mockTx);
  })
}));

describe('TenantModulesService', () => {
  let service: TenantModulesService;

  beforeEach(() => {
    service = new TenantModulesService();
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
});
