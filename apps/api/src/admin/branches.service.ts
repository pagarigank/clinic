import { Injectable } from '@nestjs/common';
import { ProblemException } from '../http/problem.exception.js';
import { withTenant } from '@clinic/db';

/** Valid service profile values (todo 1.7, spec §19.8). */
export const VALID_SERVICE_TYPES = [
  'consultation',
  'procedure_room',
  'embedded_laboratory',
  'pharmacy_dispensing',
  'ambulatory_surgical',
  'birthing',
  'dialysis',
] as const;
export type ServiceType = (typeof VALID_SERVICE_TYPES)[number];

export interface BranchRow {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  serviceProfile: ServiceType[];
  status: string;
  timezone: string | null;
  rowVersion: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface CreateBranchDto {
  code: string;
  name: string;
  serviceProfile?: ServiceType[];
  timezone?: string;
}

export interface UpdateBranchDto {
  name?: string;
  serviceProfile?: ServiceType[];
  timezone?: string;
}

/** Module required for each service profile value. */
const SERVICE_MODULE_REQUIREMENTS: Partial<Record<ServiceType, string>> = {
  embedded_laboratory: 'laboratory',
  pharmacy_dispensing: 'pharmacy',
};

@Injectable()
export class BranchesService {
  /**
   * Create a new branch.
   * - Unique code per tenant
   * - Plan branch-count cap (QUOTA_EXCEEDED)
   * - Service profile ↔ module cross-check
   */
  async createBranch(
    tenantId: string,
    dto: CreateBranchDto,
    actorId?: string | null,
  ): Promise<BranchRow> {
    const profile: ServiceType[] = dto.serviceProfile ?? ['consultation'];

    return withTenant({ tenantId, userId: actorId ?? undefined }, async (tx) => {
      // Validate service profile module requirements
      await this.validateServiceProfile(tx, tenantId, profile);

      // Check branch count against plan quota
      const countRows = await tx.query<{ count: string }>(
        `SELECT count(*) FROM branches WHERE tenant_id = $1 AND deleted_at IS NULL`,
        [tenantId],
      );
      const count = parseInt(countRows.rows[0]!.count, 10);

      // Get plan to check branch cap
      const planRows = await tx.query<{ code: string }>(
        `SELECT sp.code FROM subscriptions s JOIN subscription_plans sp ON s.plan_id = sp.id
         WHERE s.tenant_id = $1 AND s.status IN ('TRIAL','ACTIVE','PAST_DUE')`,
        [tenantId],
      );
      if ((planRows.rowCount ?? 0) > 0) {
        const planCode = planRows.rows[0]!.code;
        // Starter plan: max 1 branch; complete plan: no cap
        if (planCode === 'starter' && count >= 1) {
          throw new ProblemException('QUOTA_EXCEEDED', {
            detail: 'starter plan allows only 1 branch',
          });
        }
      }

      // Insert branch
      const result = await tx.query<{
        id: string; tenant_id: string; code: string; name: string;
        service_profile: ServiceType[]; status: string; timezone: string | null;
        row_version: number; created_at: Date; updated_at: Date; deleted_at: Date | null;
      }>(
        `INSERT INTO branches (tenant_id, code, name, service_profile, created_by)
         VALUES ($1, $2, $3, $4::jsonb, $5)
         RETURNING id, tenant_id, code, name, service_profile, status, timezone,
                   row_version, created_at, updated_at, deleted_at`,
        [tenantId, dto.code, dto.name, JSON.stringify(profile), actorId ?? null],
      );

      return this.mapRow(result.rows[0]!);
    });
  }

  /** Update a branch (name, service_profile, timezone). */
  async updateBranch(
    tenantId: string,
    branchId: string,
    dto: UpdateBranchDto,
    rowVersion: number,
    actorId?: string | null,
  ): Promise<BranchRow> {
    return withTenant({ tenantId, userId: actorId ?? undefined }, async (tx) => {
      if (dto.serviceProfile) {
        await this.validateServiceProfile(tx, tenantId, dto.serviceProfile);
      }

      const result = await tx.query<{
        id: string; tenant_id: string; code: string; name: string;
        service_profile: ServiceType[]; status: string; timezone: string | null;
        row_version: number; created_at: Date; updated_at: Date; deleted_at: Date | null;
      }>(
        `UPDATE branches
         SET name = COALESCE($3, name),
             service_profile = COALESCE($4, service_profile),
             timezone = COALESCE($5, timezone),
             updated_at = now(), updated_by = $6, row_version = row_version + 1
         WHERE tenant_id = $1 AND id = $2 AND row_version = $7 AND deleted_at IS NULL
         RETURNING id, tenant_id, code, name, service_profile, status, timezone,
                   row_version, created_at, updated_at, deleted_at`,
        [
          tenantId, branchId,
          dto.name ?? null,
          dto.serviceProfile ? JSON.stringify(dto.serviceProfile) : null,
          dto.timezone ?? null,
          actorId ?? null,
          rowVersion,
        ],
      );

      if ((result.rowCount ?? 0) === 0) {
        // Check if exists
        const existing = await tx.query(`SELECT row_version FROM branches WHERE tenant_id = $1 AND id = $2`, [tenantId, branchId]);
        if ((existing.rowCount ?? 0) === 0) throw new ProblemException('NOT_FOUND', { detail: 'branch not found' });
        throw new ProblemException('STALE_ROW_VERSION', { detail: 'branch was modified by another request' });
      }
      return this.mapRow(result.rows[0]!);
    });
  }

  /**
   * Archive a branch (append-only; blocked on open work, active users, stock on hand).
   * Phase 1: only check active users — full stock/work check lands in Phase 4+.
   */
  async archiveBranch(
    tenantId: string,
    branchId: string,
    actorId?: string | null,
  ): Promise<void> {
    return withTenant({ tenantId, userId: actorId ?? undefined }, async (tx) => {
      // Check active users assigned to this branch
      const userCount = await tx.query<{ count: string }>(
        `SELECT count(*) FROM user_branches ub
         JOIN users u ON u.tenant_id = ub.tenant_id AND u.id = ub.user_id
         WHERE ub.tenant_id = $1 AND ub.branch_id = $2 AND u.status = 'ACTIVE'`,
        [tenantId, branchId],
      );
      if (parseInt(userCount.rows[0]!.count, 10) > 0) {
        throw new ProblemException('CONFLICT', {
          detail: 'branch has active users; reassign them before archiving',
        });
      }

      const result = await tx.query(
        `UPDATE branches
         SET deleted_at = now(), status = 'ARCHIVED', updated_by = $3, updated_at = now()
         WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
        [tenantId, branchId, actorId ?? null],
      );
      if ((result.rowCount ?? 0) === 0) {
        throw new ProblemException('NOT_FOUND', { detail: 'branch not found or already archived' });
      }
    });
  }

  /** Reactivate an archived branch. */
  async reactivateBranch(
    tenantId: string,
    branchId: string,
    actorId?: string | null,
  ): Promise<BranchRow> {
    return withTenant({ tenantId, userId: actorId ?? undefined }, async (tx) => {
      const result = await tx.query<{
        id: string; tenant_id: string; code: string; name: string;
        service_profile: ServiceType[]; status: string; timezone: string | null;
        row_version: number; created_at: Date; updated_at: Date; deleted_at: Date | null;
      }>(
        `UPDATE branches
         SET deleted_at = NULL, status = 'ACTIVE', updated_by = $3, updated_at = now()
         WHERE tenant_id = $1 AND id = $2 AND status = 'ARCHIVED'
         RETURNING id, tenant_id, code, name, service_profile, status, timezone,
                   row_version, created_at, updated_at, deleted_at`,
        [tenantId, branchId, actorId ?? null],
      );
      if ((result.rowCount ?? 0) === 0) {
        throw new ProblemException('NOT_FOUND', { detail: 'branch not found or not archived' });
      }
      return this.mapRow(result.rows[0]!);
    });
  }

  /** List branches for a tenant. */
  async listBranches(
    tenantId: string,
    includeArchived = false,
  ): Promise<BranchRow[]> {
    return withTenant({ tenantId }, async (tx) => {
      const rows = await tx.query<{
        id: string; tenant_id: string; code: string; name: string;
        service_profile: ServiceType[]; status: string; timezone: string | null;
        row_version: number; created_at: Date; updated_at: Date; deleted_at: Date | null;
      }>(
        `SELECT id, tenant_id, code, name, service_profile, status, timezone,
                row_version, created_at, updated_at, deleted_at
         FROM branches WHERE tenant_id = $1 ${includeArchived ? '' : "AND deleted_at IS NULL"}
         ORDER BY code`,
        [tenantId],
      );
      return rows.rows.map(r => this.mapRow(r));
    });
  }

  /** Get a single branch (returns 404 if not in this tenant). */
  async getBranch(tenantId: string, branchId: string): Promise<BranchRow> {
    return withTenant({ tenantId }, async (tx) => {
      const rows = await tx.query<{
        id: string; tenant_id: string; code: string; name: string;
        service_profile: ServiceType[]; status: string; timezone: string | null;
        row_version: number; created_at: Date; updated_at: Date; deleted_at: Date | null;
      }>(
        `SELECT id, tenant_id, code, name, service_profile, status, timezone,
                row_version, created_at, updated_at, deleted_at
         FROM branches WHERE tenant_id = $1 AND id = $2`,
        [tenantId, branchId],
      );
      if ((rows.rowCount ?? 0) === 0) {
        // 404 — no existence oracle (G-02)
        throw new ProblemException('NOT_FOUND', { detail: 'branch not found' });
      }
      return this.mapRow(rows.rows[0]!);
    });
  }

  /** Validate that service profile types are allowed given the tenant's modules. */
  private async validateServiceProfile(
    tx: { query: Function },
    tenantId: string,
    profile: ServiceType[],
  ): Promise<void> {
    for (const serviceType of profile) {
      const requiredModule = SERVICE_MODULE_REQUIREMENTS[serviceType];
      if (!requiredModule) continue; // no module requirement

      const moduleRows = await tx.query(
        `SELECT status FROM tenant_modules WHERE tenant_id = $1 AND module = $2`,
        [tenantId, requiredModule],
      );
      const status = moduleRows.rows[0]?.status;
      if (!status || status === 'DISABLED') {
        throw new ProblemException('MODULE_DEPENDENCY_MISSING', {
          detail: `service profile '${serviceType}' requires module '${requiredModule}' to be enabled`,
        });
      }
    }
  }

  private mapRow(row: {
    id: string; tenant_id: string; code: string; name: string;
    service_profile: ServiceType[]; status: string; timezone: string | null;
    row_version: number; created_at: Date; updated_at: Date; deleted_at: Date | null;
  }): BranchRow {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      code: row.code,
      name: row.name,
      serviceProfile: Array.isArray(row.service_profile)
        ? row.service_profile
        : JSON.parse(row.service_profile as unknown as string),
      status: row.status,
      timezone: row.timezone,
      rowVersion: row.row_version,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      deletedAt: row.deleted_at,
    };
  }
}
