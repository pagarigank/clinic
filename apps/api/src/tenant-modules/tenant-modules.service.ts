import { Injectable } from '@nestjs/common';
import { ProblemException } from '../http/problem.exception.js';
import { withTenant } from '@clinic/db';
import type { ModuleName } from '../rbac/module.guard.js';

export const MODULE_DEPENDENCIES: Record<ModuleName, ModuleName[]> = {
  admin: [],
  patients: ['admin'],
  clinical: ['patients'],
  supply: ['admin'],
  laboratory: ['patients'],
  pharmacy: ['patients', 'supply'],
  billing: ['patients'],
  compliance: ['admin'],
  notifications: ['admin'],
  reports: ['admin'],
};

@Injectable()
export class TenantModulesService {
  /**
   * Validate that a given set of modules is valid according to dependencies.
   */
  validateDependencies(modules: Set<ModuleName>) {
    for (const module of modules) {
      const deps = MODULE_DEPENDENCIES[module];
      for (const dep of deps) {
        if (!modules.has(dep)) {
          throw new ProblemException('MODULE_DEPENDENCY_MISSING', {
            detail: `Module '${module}' requires dependency '${dep}'.`,
          });
        }
      }
    }
  }

  async checkPlanValidation(tenantId: string, modules: Set<ModuleName>) {
    return withTenant({ tenantId }, async (tx) => {
      const res = await tx.query(`
        SELECT sp.code 
        FROM subscriptions s
        JOIN subscription_plans sp ON s.plan_id = sp.id
        WHERE s.tenant_id = $1 AND s.status IN ('TRIAL', 'ACTIVE', 'PAST_DUE')
      `, [tenantId]);

      if (res.rowCount === 0) {
        throw new ProblemException('VALIDATION_FAILED', { detail: 'Tenant has no active subscription' });
      }

      const planCode = res.rows[0].code;
      if (planCode === 'starter') {
        const allowedForStarter = new Set(['admin', 'patients', 'clinical', 'billing']);
        for (const mod of modules) {
          if (!allowedForStarter.has(mod)) {
            throw new ProblemException('PLAN_MODULE_NOT_ALLOWED', {
              detail: `Module '${mod}' is not included in the 'starter' plan.`,
            });
          }
        }
      }
    });
  }

  async getTenantModules(tenantId: string) {
    return withTenant({ tenantId }, async (tx) => {
      const res = await tx.query(
        'SELECT id, module, status, seed_status, limits, expires_at, disabled_reason, disabled_by, disabled_at FROM tenant_modules WHERE tenant_id = $1',
        [tenantId]
      );
      return res.rows;
    });
  }
  async enableModule(tenantId: string, module: ModuleName, status: 'TRIAL' | 'ENABLED', userId?: string) {
    return withTenant({ tenantId, userId }, async (tx) => {
      // Get currently active modules
      const { rows } = await tx.query(
        `SELECT module FROM tenant_modules WHERE tenant_id = $1 AND status IN ('TRIAL', 'ENABLED')`,
        [tenantId]
      );
      const activeModules = new Set<ModuleName>(rows.map(r => r.module as ModuleName));
      activeModules.add(module);
      
      // Validate dependencies
      this.validateDependencies(activeModules);

      // Validate plan limits
      await this.checkPlanValidation(tenantId, activeModules);

      await tx.query(
        `INSERT INTO tenant_modules (tenant_id, module, status, seed_status) 
         VALUES ($1, $2, $3, 'PENDING')
         ON CONFLICT (tenant_id, module) DO UPDATE 
         SET status = EXCLUDED.status, disabled_reason = NULL, disabled_by = NULL, disabled_at = NULL`,
        [tenantId, module, status]
      );

      // Bump version
      await tx.query(`UPDATE tenants SET modules_version = modules_version + 1 WHERE id = $1`, [tenantId]);
    });
  }

  async updateModuleStatus(tenantId: string, module: ModuleName, status: 'DRAINING' | 'DISABLED' | 'ENABLED', reason?: string, force?: boolean, userId?: string) {
    return withTenant({ tenantId, userId }, async (tx) => {
      const { rows } = await tx.query(
        `SELECT status FROM tenant_modules WHERE tenant_id = $1 AND module = $2`,
        [tenantId, module]
      );
      if (rows.length === 0) {
        throw new ProblemException('NOT_FOUND', { detail: 'Module not found for tenant' });
      }
      const currentStatus = rows[0].status;

      if (status === 'ENABLED' && currentStatus !== 'DRAINING') {
        throw new ProblemException('VALIDATION_FAILED', { detail: 'Can only reopen to ENABLED from DRAINING state' });
      }

      if (status === 'DISABLED' && !reason) {
        throw new ProblemException('VALIDATION_FAILED', { detail: 'disabled_reason is required' });
      }

      if (status === 'DISABLED' && !force) {
        // Preflight: check for open work inventory
        // e.g. for pharmacy, check if there are pending orders
        const hasOpenWork = false; // TODO: Hook into module-specific open work registries
        if (hasOpenWork) {
          throw new ProblemException('MODULE_HAS_OPEN_WORK', { detail: 'Module has open work and cannot be disabled without force' });
        }
      }

      const { rowCount } = await tx.query(
        `UPDATE tenant_modules 
         SET status = $1, disabled_reason = $2, disabled_by = $3, disabled_at = $4 
         WHERE tenant_id = $5 AND module = $6`,
        [
          status, 
          status === 'DISABLED' ? reason : null, 
          status === 'DISABLED' ? userId : null, 
          status === 'DISABLED' ? new Date() : null,
          tenantId, 
          module
        ]
      );

      if (rowCount === 0) {
        throw new ProblemException('NOT_FOUND', { detail: 'Module not found for tenant' });
      }

      // Bump version
      await tx.query(`UPDATE tenants SET modules_version = modules_version + 1 WHERE id = $1`, [tenantId]);
    });
  }
}
