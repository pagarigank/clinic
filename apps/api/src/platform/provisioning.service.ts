import { Injectable } from '@nestjs/common';
import { ProblemException } from '../http/problem.exception.js';
import { withTenant } from '@clinic/db';
import type { ModuleName } from '../rbac/module.guard.js';
import { MODULE_DEPENDENCIES } from '../tenant-modules/tenant-modules.service.js';

export interface CreateTenantDto {
  name: string;
  slug: string;
  planId: string;
  timezone?: string;
  modules: ModuleName[];
}

export interface TenantRow {
  id: string;
  name: string;
  slug: string;
  status: string;
  timezone: string;
  modules_version: number;
  created_at: Date;
}

/** Modules allowed on the 'starter' plan (consultation + patients only). */
const STARTER_PLAN_MODULES: ModuleName[] = ['admin', 'patients', 'notifications'];

@Injectable()
export class ProvisioningService {
  /**
   * Create a new tenant in PROVISIONING state and enqueue JOB-03.
   * The tenant becomes ACTIVE once JOB-03 seeds all modules.
   */
  async createTenant(
    dto: CreateTenantDto,
    actorId?: string | null,
  ): Promise<TenantRow> {
    return withTenant({ scope: 'platform', userId: actorId ?? undefined }, async (tx) => {
      // Validate slug uniqueness
      const existing = await tx.query(
        `SELECT id FROM tenants WHERE slug = $1`,
        [dto.slug],
      );
      if ((existing.rowCount ?? 0) > 0) {
        throw new ProblemException('CONFLICT', { detail: `slug '${dto.slug}' is already taken` });
      }

      // Validate plan exists
      const planRows = await tx.query<{ id: string; code: string }>(
        `SELECT id, code FROM subscription_plans WHERE id = $1`,
        [dto.planId],
      );
      if ((planRows.rowCount ?? 0) === 0) {
        throw new ProblemException('NOT_FOUND', { detail: 'subscription plan not found' });
      }
      const plan = planRows.rows[0]!;

      // Validate module dependencies
      const moduleSet = new Set<ModuleName>(dto.modules);

      // Ensure 'admin' is always included (hard requirement)
      if (!moduleSet.has('admin')) moduleSet.add('admin');

      // Dependency validation
      for (const module of moduleSet) {
        const deps = MODULE_DEPENDENCIES[module];
        for (const dep of deps) {
          if (!moduleSet.has(dep)) {
            throw new ProblemException('MODULE_DEPENDENCY_MISSING', {
              detail: `Module '${module}' requires dependency '${dep}'.`,
            });
          }
        }
      }

      // Starter plan restrictions
      if (plan.code === 'starter') {
        for (const module of moduleSet) {
          if (!STARTER_PLAN_MODULES.includes(module)) {
            throw new ProblemException('PLAN_MODULE_NOT_ALLOWED', {
              detail: `Module '${module}' is not available on the starter plan.`,
            });
          }
        }
      }

      // Create tenant + subscription + module rows in one transaction (platform scope)
      const result = await tx.query<TenantRow>(
        `INSERT INTO tenants (name, slug, status, timezone, created_by)
         VALUES ($1, $2, 'PROVISIONING', $3, $4)
         RETURNING id, name, slug, status, timezone, modules_version, created_at`,
        [dto.name, dto.slug, dto.timezone ?? 'Asia/Manila', actorId ?? null],
      );
      const tenant = result.rows[0]!;

      // Now set the tenant context so RLS allows inserts into isolated tables
      await tx.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.id]);

      // Create subscription
      await tx.query(
        `INSERT INTO subscriptions (tenant_id, plan_id, status)
         VALUES ($1, $2, 'ACTIVE')`,
        [tenant.id, dto.planId],
      );

      // Create tenant_modules rows (all start as PENDING / seed_status PENDING)
      for (const module of Array.from(moduleSet)) {
        await tx.query(
          `INSERT INTO tenant_modules (tenant_id, module, status, seed_status)
           VALUES ($1, $2, 'DISABLED', 'PENDING')`,
          [tenant.id, module],
        );
      }

      // Enqueue JOB-03 (tenant.provision) to seed and activate
      await tx.query(
        `INSERT INTO outbox (tenant_id, event_type, payload)
         VALUES ($1, 'tenant.provision', $2)`,
        [
          tenant.id,
          JSON.stringify({
            tenantId: tenant.id,
            modules: Array.from(moduleSet),
          }),
        ],
      );

      return tenant;
    });
  }

  /**
   * Retry provisioning for a PROVISIONING_FAILED or stuck tenant.
   * Re-enqueues JOB-03 for any module with seed_status = FAILED | PENDING.
   */
  async retryProvisioning(tenantId: string): Promise<void> {
    return withTenant({ scope: 'platform', tenantId }, async (tx) => {
      const tenantRows = await tx.query<{ status: string }>(
        `SELECT status FROM tenants WHERE id = $1`,
        [tenantId],
      );
      if ((tenantRows.rowCount ?? 0) === 0) {
        throw new ProblemException('NOT_FOUND', { detail: 'tenant not found' });
      }
      const tenantStatus = tenantRows.rows[0]!.status;
      if (!['PROVISIONING', 'ACTIVE'].includes(tenantStatus)) {
        throw new ProblemException('CONFLICT', { detail: `tenant is in ${tenantStatus} status; cannot retry` });
      }

      // Get modules needing seeding
      const modulesRows = await tx.query<{ module: string }>(
        `SELECT module FROM tenant_modules WHERE tenant_id = $1 AND seed_status IN ('FAILED', 'PENDING')`,
        [tenantId],
      );
      const modules = modulesRows.rows.map(r => r.module);

      await tx.query(
        `INSERT INTO outbox (tenant_id, event_type, payload)
         VALUES ($1, 'tenant.provision', $2)`,
        [tenantId, JSON.stringify({ tenantId, modules })],
      );
    });
  }

  /**
   * Suspend a tenant (G-15, PLT-T2, AC-3):
   * - Sets status = SUSPENDED
   * - Revokes all active sessions
   */
  async suspendTenant(tenantId: string, reason: string, actorId?: string | null): Promise<void> {
    if (!reason || reason.trim().length < 5) {
      throw new ProblemException('VALIDATION_FAILED', {
        errors: [{ path: 'reason', message: 'reason is required (min 5 chars)' }],
      });
    }

    return withTenant({ scope: 'platform', tenantId, userId: actorId ?? undefined }, async (tx) => {
      const result = await tx.query(
        `UPDATE tenants
         SET status = 'SUSPENDED', updated_by = $2, updated_at = now(), row_version = row_version + 1
         WHERE id = $1 AND status = 'ACTIVE'
         RETURNING id`,
        [tenantId, actorId ?? null],
      );
      if ((result.rowCount ?? 0) === 0) {
        const existing = await tx.query(`SELECT status FROM tenants WHERE id = $1`, [tenantId]);
        if ((existing.rowCount ?? 0) === 0) {
          throw new ProblemException('NOT_FOUND', { detail: 'tenant not found' });
        }
        throw new ProblemException('CONFLICT', {
          detail: `tenant is ${existing.rows[0]!.status}, cannot suspend`,
        });
      }

      // Revoke all active sessions for the tenant
      // We can do this in the same transaction, setting the tenant id context for RLS is not required if we are platform scoped
      await tx.query(
        `UPDATE sessions SET revoked_at = now(), revoked_reason = 'tenant_suspended'
         WHERE tenant_id = $1 AND revoked_at IS NULL`,
        [tenantId],
      );

      // Audit log
      await tx.query(
        `INSERT INTO outbox (tenant_id, event_type, payload)
         VALUES ($1, 'tenant.suspended', $2)`,
        [tenantId, JSON.stringify({ tenantId, reason, actorId })],
      );
    });
  }

  /**
   * Reactivate a suspended tenant.
   */
  async reactivateTenant(tenantId: string, actorId?: string | null): Promise<void> {
    return withTenant({ scope: 'platform', tenantId, userId: actorId ?? undefined }, async (tx) => {
      const result = await tx.query(
        `UPDATE tenants
         SET status = 'ACTIVE', updated_by = $2, updated_at = now(), row_version = row_version + 1
         WHERE id = $1 AND status = 'SUSPENDED'
         RETURNING id`,
        [tenantId, actorId ?? null],
      );
      if ((result.rowCount ?? 0) === 0) {
        const existing = await tx.query(`SELECT status FROM tenants WHERE id = $1`, [tenantId]);
        if ((existing.rowCount ?? 0) === 0) {
          throw new ProblemException('NOT_FOUND', { detail: 'tenant not found' });
        }
        throw new ProblemException('CONFLICT', {
          detail: `tenant is ${existing.rows[0]!.status}, cannot reactivate`,
        });
      }

      await tx.query(
        `INSERT INTO outbox (tenant_id, event_type, payload)
         VALUES ($1, 'tenant.reactivated', $2)`,
        [tenantId, JSON.stringify({ tenantId, actorId })],
      );
    });
  }

  /** List tenants (platform console). */
  async listTenants(opts: { limit?: number; offset?: number } = {}): Promise<TenantRow[]> {
    return withTenant({ scope: 'platform' }, async (tx) => {
      const rows = await tx.query<TenantRow>(
        `SELECT id, name, slug, status, timezone, modules_version, created_at
         FROM tenants
         ORDER BY created_at DESC
         LIMIT $1 OFFSET $2`,
        [opts.limit ?? 50, opts.offset ?? 0],
      );
      return rows.rows;
    });
  }

  /** Get a single tenant. */
  async getTenant(tenantId: string): Promise<TenantRow> {
    return withTenant({ scope: 'platform', tenantId }, async (tx) => {
      const rows = await tx.query<TenantRow>(
        `SELECT id, name, slug, status, timezone, modules_version, created_at
         FROM tenants WHERE id = $1`,
        [tenantId],
      );
      if ((rows.rowCount ?? 0) === 0) {
        throw new ProblemException('NOT_FOUND', { detail: 'tenant not found' });
      }
      return rows.rows[0]!;
    });
  }
}
