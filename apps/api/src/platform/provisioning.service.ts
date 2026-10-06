import { Injectable } from '@nestjs/common';
import { ProblemException } from '../http/problem.exception.js';
import { withTenant } from '@clinic/db';
import type { ModuleName } from '../rbac/module.guard.js';
import { MODULE_DEPENDENCIES } from '../tenant-modules/tenant-modules.service.js';
import { runTenantExport } from '../../../worker/src/handlers/platform-jobs.handler.js';
import { handleTenantProvision } from '../../../worker/src/handlers/provision.handler.js';

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

export interface StarterCredentialItem {
  role: string;
  email: string;
  name: string;
  description: string;
}

export interface StarterCredentialsPayload {
  defaultPassword: string;
  logins: StarterCredentialItem[];
  formattedText: string;
}

export function buildStarterCredentials(slug: string, name: string): StarterCredentialsPayload {
  const defaultPassword = 'DemoPassw0rd!2026';
  const logins: StarterCredentialItem[] = [
    {
      role: 'Tenant Administrator',
      email: `admintenant@${slug}.emr`,
      name: `${name} — Tenant Admin`,
      description: 'Full clinic configuration, staff user accounts, branches and permissions',
    },
    {
      role: 'Doctor',
      email: `doctor@${slug}.emr`,
      name: `${name} — Doctor`,
      description: 'Consultations, SOAP clinical notes, e-prescriptions and clinical orders',
    },
    {
      role: 'Receptionist',
      email: `receptionist@${slug}.emr`,
      name: `${name} — Receptionist`,
      description: 'Front desk registration, appointment booking, patient triage and queueing',
    },
    {
      role: 'Pharmacist',
      email: `pharmacist@${slug}.emr`,
      name: `${name} — Pharmacist`,
      description: 'Pharmacy inventory, prescription fulfillment and formulary dispensing',
    },
    {
      role: 'Medical Technologist',
      email: `labtech@${slug}.emr`,
      name: `${name} — Medical Technologist`,
      description: 'Laboratory specimen processing, analyte result entry and QC benchwork',
    },
    {
      role: 'Cashier',
      email: `cashier@${slug}.emr`,
      name: `${name} — Cashier`,
      description: 'Cash desk settlement, split payments, official receipts and shift closure',
    },
    {
      role: 'Nurse',
      email: `nurse@${slug}.emr`,
      name: `${name} — Nurse`,
      description: 'Vital signs recording, immunization, procedures and patient preparation',
    },
    {
      role: 'Pharmacist Verifier',
      email: `verifier@${slug}.emr`,
      name: `${name} — Pharmacist Verifier`,
      description: 'Independent clinical prescription review and verification (PHM-T1)',
    },
    {
      role: 'Laboratory Verifier / Pathologist',
      email: `labverify@${slug}.emr`,
      name: `${name} — Lab Verifier`,
      description: 'Independent laboratory test verification and report release (AC-17)',
    },
    {
      role: 'Tenant Admin (Alias)',
      email: `admin@${slug}.emr`,
      name: `${name} — Tenant Admin`,
      description: 'Alternative short admin login',
    },
    {
      role: 'Receptionist (Alias)',
      email: `staff@${slug}.emr`,
      name: `${name} — Front Desk Staff`,
      description: 'Alternative short staff login',
    },
    {
      role: 'Pharmacist (Alias)',
      email: `dispenser@${slug}.emr`,
      name: `${name} — Pharmacist / Dispenser`,
      description: 'Alternative short dispenser login',
    },
  ];

  const formattedText = [
    '============================================================',
    'CLINIC PLATFORM — NEW TENANT CREDENTIALS',
    '============================================================',
    `Tenant Name:      ${name}`,
    `Tenant Slug:      ${slug}`,
    `Login URL:        http://localhost:8085/login`,
    `Default Password: ${defaultPassword}`,
    `(Common email stub: '@${slug}.emr')`,
    '',
    'PRIMARY ROLES & LOGINS:',
    '------------------------------------------------------------',
    ...logins.slice(0, 9).map((l) => `• ${l.role.padEnd(24)} ${l.email}`),
    '',
    'COMPATIBILITY ALIASES:',
    '------------------------------------------------------------',
    ...logins.slice(9).map((l) => `• ${l.role.padEnd(24)} ${l.email}`),
    '============================================================',
  ].join('\n');

  return { defaultPassword, logins, formattedText };
}

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
    const created = await withTenant({ scope: 'platform', userId: actorId ?? undefined }, async (tx) => {
      // Validate slug uniqueness
      const existing = await tx.query(
        `SELECT id FROM tenants WHERE slug = $1`,
        [dto.slug],
      );
      if ((existing.rowCount ?? 0) > 0) {
        throw new ProblemException('CONFLICT', { detail: `slug '${dto.slug}' is already taken` });
      }

      // Validate plan exists
      let planId = dto.planId;
      let planRows = await tx.query<{ id: string; code: string }>(
        `SELECT id, code FROM subscription_plans WHERE id = $1`,
        [planId],
      );
      if ((planRows.rowCount ?? 0) === 0) {
        // Try looking up by plan code (e.g. 'enterprise', 'starter')
        const byCode = await tx.query<{ id: string; code: string }>(
          `SELECT id, code FROM subscription_plans WHERE code = $1`,
          [planId],
        );
        if ((byCode.rowCount ?? 0) > 0) {
          planRows = byCode;
          planId = byCode.rows[0]!.id;
        } else {
          // Fallback to active enterprise, complete, or standard plan if invalid/dummy ID was supplied
          const fallback = await tx.query<{ id: string; code: string }>(
            `SELECT id, code FROM subscription_plans
             WHERE is_active = true
             ORDER BY
               CASE
                 WHEN code = 'enterprise' THEN 1
                 WHEN code = 'complete' THEN 2
                 WHEN code = 'standard' THEN 3
                 ELSE 4
               END, created_at ASC
             LIMIT 1`,
          );
          if ((fallback.rowCount ?? 0) > 0) {
            planRows = fallback;
            planId = fallback.rows[0]!.id;
          } else {
            throw new ProblemException('NOT_FOUND', { detail: 'subscription plan not found' });
          }
        }
      }

      // Validate module dependencies
      const moduleSet = new Set<ModuleName>(dto.modules);

      // Ensure 'admin' is always included (hard requirement)
      if (!moduleSet.has('admin')) moduleSet.add('admin');

      // Dependency validation
      for (const module of moduleSet) {
        const deps = MODULE_DEPENDENCIES[module] || [];
        for (const dep of deps) {
          if (!moduleSet.has(dep)) {
            throw new ProblemException('MODULE_DEPENDENCY_MISSING', {
              detail: `Module '${module}' requires dependency '${dep}'.`,
            });
          }
        }
      }

      // Validate against plan_modules if defined
      const planModulesRes = await tx.query<{ module: string }>(
        `SELECT module FROM plan_modules WHERE plan_id = $1`,
        [planId],
      );
      if ((planModulesRes.rowCount ?? 0) > 0) {
        const allowed = new Set(planModulesRes.rows.map((r) => r.module));
        for (const mod of moduleSet) {
          if (!allowed.has(mod)) {
            throw new ProblemException('PLAN_MODULE_NOT_ALLOWED', {
              detail: `Module '${mod}' is not allowed on this plan.`,
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

      // Set tenant context for RLS
      await tx.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.id]);

      // Create subscription
      await tx.query(
        `INSERT INTO subscriptions (tenant_id, plan_id, status)
         VALUES ($1, $2, 'ACTIVE')`,
        [tenant.id, planId],
      );

      // Create tenant_modules rows
      for (const module of Array.from(moduleSet)) {
        await tx.query(
          `INSERT INTO tenant_modules (tenant_id, module, status, seed_status)
           VALUES ($1, $2, 'DISABLED', 'PENDING')`,
          [tenant.id, module],
        );
      }

      // Enqueue JOB-03 (tenant.provision)
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

      return { tenant, modules: Array.from(moduleSet) };
    });

    if (process.env.NODE_ENV !== 'test') {
      setImmediate(async () => {
        try {
          await handleTenantProvision({
            tenantId: created.tenant.id,
            modules: created.modules,
          });
        } catch (err) {
          console.error(`Auto-provisioning failed for tenant ${created.tenant.id}:`, err);
        }
      });
    }

    return created.tenant;
  }

  /**
   * Retry provisioning for a PROVISIONING_FAILED or stuck tenant.
   */
  async retryProvisioning(tenantId: string): Promise<void> {
    const result = await withTenant({ scope: 'platform', tenantId }, async (tx) => {
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

      return { tenantId, modules };
    });

    if (process.env.NODE_ENV !== 'test') {
      try {
        await handleTenantProvision({ tenantId: result.tenantId, modules: result.modules });
      } catch (err) {
        console.error(`Retry provisioning failed for tenant ${result.tenantId}:`, err);
      }
    }
  }

  /**
   * Suspend a tenant.
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

      await tx.query(
        `UPDATE sessions SET revoked_at = now(), revoked_reason = 'tenant_suspended'
         WHERE tenant_id = $1 AND revoked_at IS NULL`,
        [tenantId],
      );

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

  /**
   * List available subscription plans.
   */
  async listPlans() {
    return withTenant({ scope: 'platform' }, async (tx) => {
      const res = await tx.query(
        `SELECT id, code, name, is_active, created_at
         FROM subscription_plans
         WHERE is_active = true
         ORDER BY created_at ASC`,
      );
      return { plans: res.rows };
    });
  }

  /**
   * Get allowed modules and limits for a plan (feeds the tenant wizard).
   * GET /platform/plans/:id/modules
   */
  async getPlanModules(planId: string) {
    return withTenant({ scope: 'platform' }, async (tx) => {
      const res = await tx.query<{ module: string; limits: any }>(
        `SELECT module, limits
         FROM plan_modules
         WHERE plan_id = $1
         ORDER BY module ASC`,
        [planId],
      );
      return {
        planId,
        modules: res.rows.map((r) => r.module),
        limits: res.rows.reduce((acc, r) => ({ ...acc, [r.module]: r.limits }), {}),
      };
    });
  }

  /**
   * Change tenant subscription plan with Q-15 downgrade orphan protection.
   * POST /platform/tenants/:id/plan
   */
  async changePlan(tenantId: string, newPlanId: string, actorId?: string | null) {
    return withTenant({ scope: 'platform', tenantId, userId: actorId ?? undefined }, async (tx) => {
      // 1. Fetch target plan details
      const planRes = await tx.query<{ id: string; name: string }>(
        `SELECT id, name FROM subscription_plans WHERE id = $1`,
        [newPlanId],
      );
      if ((planRes.rowCount ?? 0) === 0) {
        throw new ProblemException('NOT_FOUND', { detail: 'Subscription plan not found' });
      }

      // 2. Fetch allowed modules for the target plan
      const targetModulesRes = await tx.query<{ module: string }>(
        `SELECT module FROM plan_modules WHERE plan_id = $1`,
        [newPlanId],
      );
      const targetAllowed = new Set(targetModulesRes.rows.map((r) => r.module));

      // 3. Fetch currently entitled (ENABLED or TRIAL) modules for this tenant
      const activeModulesRes = await tx.query<{ module: string; status: string }>(
        `SELECT module, status FROM tenant_modules WHERE tenant_id = $1 AND status IN ('ENABLED', 'TRIAL')`,
        [tenantId],
      );

      // 4. Invariant (Q-15): Reject if any active module would be orphaned by the downgrade!
      for (const row of activeModulesRes.rows) {
        if (!targetAllowed.has(row.module)) {
          throw new ProblemException('CONFLICT', {
            detail: `Cannot downgrade plan: module '${row.module}' is still entitled. Please drain or disable the module first.`,
          });
        }
      }

      // 5. Update subscription
      await tx.query(
        `UPDATE subscriptions
         SET plan_id = $1, updated_at = now(), updated_by = $2
         WHERE tenant_id = $3 AND status IN ('ACTIVE', 'TRIAL')`,
        [newPlanId, actorId ?? null, tenantId],
      );

      // 6. Record audit
      await tx.query(
        `INSERT INTO module_entitlement_audit (tenant_id, module, action, reason, actor_id, is_forced)
         VALUES ($1, 'platform', 'TICK', 'Subscription plan updated to ' || $2, $3, false)`,
        [tenantId, planRes.rows[0]?.name || newPlanId, actorId ?? null],
      );

      return {
        tenantId,
        planId: newPlanId,
        message: 'Plan successfully updated',
      };
    });
  }

  /**
   * Export tenant bundle (JOB-04).
   * POST /platform/tenants/:id/export
   */
  async exportTenant(tenantId: string, actorId: string) {
    const res = await runTenantExport(tenantId, actorId);
    return {
      message: 'Tenant export initiated',
      fileId: res.fileId,
      fileName: res.fileName,
      status: 'COMPLETED',
    };
  }

  /**
   * Offboard tenant with legal hold check (JOB-05).
   * POST /platform/tenants/:id/offboard
   */
  async offboardTenant(tenantId: string, reason: string, actorId?: string | null) {
    return withTenant({ scope: 'platform', tenantId, userId: actorId ?? undefined }, async (tx) => {
      // 1. Check legal holds
      const holdsRes = await tx.query<{ id: string; hold_no: string }>(
        `SELECT id, hold_no FROM legal_holds WHERE tenant_id = $1 AND released_at IS NULL`,
        [tenantId],
      );

      if ((holdsRes.rowCount ?? 0) > 0) {
        throw new ProblemException('CONFLICT', {
          detail: `Cannot purge tenant data while ${holdsRes.rowCount} active legal hold(s) exist.`,
        });
      }

      // 2. Mark tenant as OFFBOARDED
      await tx.query(
        `UPDATE tenants
         SET status = 'OFFBOARDED', updated_at = now(), updated_by = $2
         WHERE id = $1`,
        [tenantId, actorId ?? null],
      );

      return {
        tenantId,
        status: 'OFFBOARDED',
        reason,
        offboardedAt: new Date().toISOString(),
      };
    });
  }

  /**
   * Module Entitlement Transparency Report (RPT-PLT-09).
   * Surfaces no PHI!
   */
  async getEntitlementTransparencyReport(tenantId?: string) {
    return withTenant({ scope: 'platform' }, async (tx) => {
      const filter = tenantId ? 'WHERE a.tenant_id = $1' : '';
      const params = tenantId ? [tenantId] : [];

      const res = await tx.query(
        `SELECT a.id, a.tenant_id, t.name as tenant_name, a.module, a.action, a.reason, a.is_forced, a.created_at, a.actor_id
         FROM module_entitlement_audit a
         JOIN tenants t ON t.id = a.tenant_id
         ${filter}
         ORDER BY a.created_at DESC
         LIMIT 500`,
        params,
      );

      return {
        reportId: 'RPT-PLT-09',
        name: 'Module Entitlement Transparency Audit',
        rows: res.rows,
        meta: {
          total: res.rowCount ?? 0,
          containsPhi: false,
        },
      };
    });
  }

  /**
   * Job monitor and DLQ replay for idempotent jobs.
   */
  async listJobs() {
    return withTenant({ scope: 'platform' }, async (tx) => {
      const res = await tx.query(
        `SELECT id, tenant_id, event_type, created_at, processed_at
         FROM outbox
         ORDER BY created_at DESC
         LIMIT 100`,
      );
      return { jobs: res.rows };
    });
  }

  async replayJob(jobId: string) {
    return withTenant({ scope: 'platform' }, async (tx) => {
      const res = await tx.query(
        `UPDATE outbox
         SET processed_at = NULL
         WHERE id = $1
         RETURNING id, event_type`,
        [jobId],
      );

      if ((res.rowCount ?? 0) === 0) {
        throw new ProblemException('NOT_FOUND', { detail: 'Job not found' });
      }

      return { replayed: true, job: res.rows[0] };
    });
  }
}
