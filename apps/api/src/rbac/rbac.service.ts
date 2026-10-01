import { Injectable } from "@nestjs/common";
import {
  ALL_PERMISSIONS,
  PERMISSION_CATALOGUE,
  RoleCreateSchema,
  RoleUpdateSchema,
  type RoleDto,
  type PermissionDto,
  type UserRoleAssign,
} from "@clinic/contracts";
import { withTenant, type PoolClient } from "@clinic/db";
import { ProblemException } from "../http/problem.exception.js";

interface RoleRow {
  id: string;
  code: string;
  name: string;
  is_system: boolean;
  row_version: number;
}

interface EffectiveRow {
  role_id: string;
  role_code: string;
  role_name: string;
  permission_code: string | null;
}

@Injectable()
export class RbacService {
  // Explicit @Inject: esbuild (tsx) does not emit design:paramtypes metadata.
  constructor() {}

  // ---- effective permissions --------------------------------------------

  /** Effective permission codes for a user across all their tenant roles. */
  async effectivePermissions(tenantId: string, userId: string): Promise<EffectiveRow[]> {
    return withTenant({ tenantId, userId }, async (tx) =>
      this.loadEffective(tx, userId),
    );
  }

  /** Set form used by PermissionGuard (cached per request). */
  async effectivePermissionSet(ids: { tenantId: string; userId: string | null }): Promise<ReadonlySet<string>> {
    if (!ids.userId) return new Set();
    const rows = await this.effectivePermissions(ids.tenantId, ids.userId);
    return new Set(
      rows
        .map((r) => r.permission_code)
        .filter((c): c is string => c !== null),
    );
  }

  private async loadEffective(tx: PoolClient, userId: string): Promise<EffectiveRow[]> {
    const r = await tx.query<EffectiveRow>(
      `SELECT ur.role_id,
              ro.code  AS role_code,
              ro.name  AS role_name,
              p.code   AS permission_code
       FROM user_roles ur
       JOIN roles ro ON ro.tenant_id = ur.tenant_id AND ro.id = ur.role_id
       LEFT JOIN role_permissions rp ON rp.tenant_id = ur.tenant_id AND rp.role_id = ur.role_id
       LEFT JOIN permissions p ON p.id = rp.permission_id
       WHERE ur.tenant_id = (SELECT app.tenant_id())
         AND ur.user_id = $1
         AND ro.deleted_at IS NULL
       ORDER BY ro.code, p.code`,
      [userId],
    );
    return r.rows;
  }

  /** Effective-permissions endpoint payload (contracts EffectivePermissions). */
  async effectiveForCaller(tenantId: string, userId: string, branchId: string | null) {
    const rows = await this.effectivePermissions(tenantId, userId);
    const roles = new Map<string, { id: string; code: string; name: string }>();
    const permissions = new Set<string>();
    for (const row of rows) {
      if (!roles.has(row.role_id)) {
        roles.set(row.role_id, { id: row.role_id, code: row.role_code, name: row.role_name });
      }
      if (row.permission_code) permissions.add(row.permission_code);
    }
    return {
      permissions: [...permissions].sort(),
      roles: [...roles.values()],
      branchId,
    };
  }

  // ---- role CRUD ----------------------------------------------------------

  async listRoles(tenantId: string, userId: string): Promise<RoleDto[]> {
    return withTenant({ tenantId, userId }, async (tx) => {
      const r = await tx.query<RoleRow>(
        `SELECT id, code, name, is_system, row_version
         FROM roles
         WHERE tenant_id = (SELECT app.tenant_id()) AND deleted_at IS NULL
         ORDER BY code`,
      );
      const perms = await tx.query<{ role_id: string; code: string }>(
        `SELECT rp.role_id, p.code
         FROM role_permissions rp
         JOIN permissions p ON p.id = rp.permission_id
         WHERE rp.tenant_id = (SELECT app.tenant_id())`,
      );
      const byRole = new Map<string, string[]>();
      for (const row of perms.rows) {
        const list = byRole.get(row.role_id) ?? [];
        list.push(row.code);
        byRole.set(row.role_id, list);
      }
      return r.rows.map((role) => ({
        id: role.id,
        code: role.code,
        name: role.name,
        isSystem: role.is_system,
        permissions: (byRole.get(role.id) ?? []).sort(),
        rowVersion: role.row_version,
      }));
    });
  }

  async getRole(tenantId: string, userId: string, roleId: string): Promise<RoleDto> {
    return withTenant({ tenantId, userId }, async (tx) => {
      const role = await this.findRole(tx, roleId);
      const perms = await tx.query<{ code: string }>(
        `SELECT p.code
         FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id
         WHERE rp.tenant_id = (SELECT app.tenant_id()) AND rp.role_id = $1
         ORDER BY p.code`,
        [roleId],
      );
      return {
        id: role.id,
        code: role.code,
        name: role.name,
        isSystem: role.is_system,
        permissions: perms.rows.map((p) => p.code),
        rowVersion: role.row_version,
      };
    });
  }

  async createRole(tenantId: string, userId: string, dto: unknown): Promise<RoleDto> {
    const input = RoleCreateSchema.parse(dto);
    await this.assertKnownPermissions(input.permissions);

    return withTenant({ tenantId, userId }, async (tx) => {
      const dup = await tx.query<{ id: string }>(
        `SELECT id FROM roles WHERE tenant_id = (SELECT app.tenant_id()) AND code = $1 AND deleted_at IS NULL`,
        [input.code],
      );
      if (dup.rows.length > 0) {
        throw new ProblemException("CONFLICT", { detail: `role code '${input.code}' already exists` });
      }
      // Permissions are a global catalogue; role grants stay tenant-scoped.
      const r = await tx.query<RoleRow>(
        `INSERT INTO roles (tenant_id, code, name, is_system, created_by, updated_by)
         VALUES ((SELECT app.tenant_id()), $1, $2, false, $3, $3)
         RETURNING id, code, name, is_system, row_version`,
        [input.code, input.name, userId],
      );
      const role = mustRow(r.rows, "role insert");
      await this.assertNoSoDConflicts(tx, new Set(input.permissions));
      await this.replacePermissions(tx, role.id, input.permissions);
      return { ...toDto(role), permissions: input.permissions.slice().sort() };
    });
  }

  async updateRole(
    tenantId: string,
    userId: string,
    roleId: string,
    rowVersion: number | undefined,
    dto: unknown,
  ): Promise<RoleDto> {
    const input = RoleUpdateSchema.parse(dto);
    if (input.permissions) await this.assertKnownPermissions(input.permissions);

    return withTenant({ tenantId, userId }, async (tx) => {
      const role = await this.findRole(tx, roleId);
      if (role.is_system) {
        throw new ProblemException("CONFLICT", {
          detail: "system roles are template-managed; create a custom role instead",
        });
      }
      if (rowVersion !== undefined && rowVersion !== role.row_version) {
        throw new ProblemException("STALE_ROW_VERSION");
      }
      // Checked before the UPDATE so a refused grant cannot bump row_version.
      if (input.permissions) await this.assertNoSoDConflicts(tx, new Set(input.permissions));
      const r = await tx.query<RoleRow>(
        `UPDATE roles SET name = $2, row_version = row_version + 1, updated_at = now(), updated_by = $3
         WHERE tenant_id = (SELECT app.tenant_id()) AND id = $1
         RETURNING id, code, name, is_system, row_version`,
        [roleId, input.name ?? role.name, userId],
      );
      if (input.permissions) await this.replacePermissions(tx, roleId, input.permissions);
      const final = mustRow(r.rows, "role update");
      const perms = await tx.query<{ code: string }>(
        `SELECT p.code
         FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id
         WHERE rp.tenant_id = (SELECT app.tenant_id()) AND rp.role_id = $1
         ORDER BY p.code`,
        [roleId],
      );
      return { ...toDto(final), permissions: perms.rows.map((p) => p.code) };
    });
  }

  async deleteRole(tenantId: string, userId: string, roleId: string): Promise<void> {
    await withTenant({ tenantId, userId }, async (tx) => {
      const role = await this.findRole(tx, roleId);
      if (role.is_system) {
        throw new ProblemException("CONFLICT", { detail: "system roles cannot be deleted" });
      }
      const inUse = await tx.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM user_roles WHERE tenant_id = (SELECT app.tenant_id()) AND role_id = $1`,
        [roleId],
      );
      const inUseCount = inUse.rows[0]?.n ?? 0;
      if (inUseCount > 0) {
        throw new ProblemException("CONFLICT", {
          detail: `role still assigned to ${inUseCount} user(s)`,
        });
      }
      await tx.query(
        `UPDATE roles SET deleted_at = now(), updated_by = $2, row_version = row_version + 1
         WHERE tenant_id = (SELECT app.tenant_id()) AND id = $1`,
        [roleId, userId],
      );
    });
  }

  /** Clone an existing role's permission set into a new custom role. */
  async cloneRole(
    tenantId: string,
    userId: string,
    roleId: string,
    body: { code: string; name: string },
  ): Promise<RoleDto> {
    const parsed = RoleCreateSchema.parse({ ...body, permissions: [] });
    return withTenant({ tenantId, userId }, async (tx) => {
      // Confirm the source role exists (404 otherwise) before cloning.
      await this.findRole(tx, roleId);
      const dup = await tx.query<{ id: string }>(
        `SELECT id FROM roles WHERE tenant_id = (SELECT app.tenant_id()) AND code = $1 AND deleted_at IS NULL`,
        [parsed.code],
      );
      if (dup.rows.length > 0) {
        throw new ProblemException("CONFLICT", { detail: `role code '${parsed.code}' already exists` });
      }
      const r = await tx.query<RoleRow>(
        `INSERT INTO roles (tenant_id, code, name, is_system, created_by, updated_by)
         VALUES ((SELECT app.tenant_id()), $1, $2, false, $3, $3)
         RETURNING id, code, name, is_system, row_version`,
        [parsed.code, parsed.name, userId],
      );
      const role = mustRow(r.rows, "role clone");
      const sourcePerms = await tx.query<{ code: string }>(
        `SELECT p.code
         FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id
         WHERE rp.tenant_id = (SELECT app.tenant_id()) AND rp.role_id = $1`,
        [roleId],
      );
      await this.assertNoSoDConflicts(tx, new Set(sourcePerms.rows.map((p) => p.code)));
      await tx.query(
        `INSERT INTO role_permissions (tenant_id, role_id, permission_id)
         SELECT (SELECT app.tenant_id()), $1, permission_id
         FROM role_permissions WHERE tenant_id = (SELECT app.tenant_id()) AND role_id = $2
         ON CONFLICT DO NOTHING`,
        [role.id, roleId],
      );
      const perms = await tx.query<{ code: string }>(
        `SELECT p.code
         FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id
         WHERE rp.tenant_id = (SELECT app.tenant_id()) AND rp.role_id = $1
         ORDER BY p.code`,
        [role.id],
      );
      return { ...toDto(role), permissions: perms.rows.map((p) => p.code) };
    });
  }

  // ---- user-role assignment ----------------------------------------------

  /**
   * Replace the target user's grants AT ONE SCOPE (tenant-wide when
   * `branchId` is null, that branch otherwise) with `roleIds`. SoD is
   * checked against the user's FINAL effective permission set — grants at
   * the other scope survive and count toward the union.
   */
  async assignUserRoles(tenantId: string, actorId: string, dto: UserRoleAssign): Promise<void> {
    void actorId;
    return withTenant({ tenantId, userId: actorId }, async (tx) => {
      const wanted = new Set(dto.roleIds);
      const roles = await tx.query<{ id: string }>(
        `SELECT id FROM roles
         WHERE tenant_id = (SELECT app.tenant_id()) AND id = ANY($1) AND deleted_at IS NULL
         FOR UPDATE`,
        [dto.roleIds],
      );
      if (roles.rows.length !== wanted.size) {
        throw new ProblemException("NOT_FOUND", { detail: "one or more roles do not exist" });
      }

      // Permissions retained from the other scope (not being replaced).
      const retained = await tx.query<{ permission_code: string }>(
        `SELECT DISTINCT p.code AS permission_code
         FROM user_roles ur
         JOIN role_permissions rp ON rp.tenant_id = ur.tenant_id AND rp.role_id = ur.role_id
         JOIN permissions p ON p.id = rp.permission_id
         WHERE ur.tenant_id = (SELECT app.tenant_id()) AND ur.user_id = $1
           AND branch_id IS NOT DISTINCT FROM $2
           AND ur.role_id <> ALL($3)`,
        [dto.userId, dto.branchId ?? null, dto.roleIds],
      );
      // Permissions carried by the incoming roles.
      const incoming = await tx.query<{ permission_code: string }>(
        `SELECT DISTINCT p.code AS permission_code
         FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id
         WHERE rp.tenant_id = (SELECT app.tenant_id()) AND rp.role_id = ANY($1)`,
        [dto.roleIds],
      );
      const finalUnion = new Set<string>([
        ...retained.rows.map((r) => r.permission_code),
        ...incoming.rows.map((r) => r.permission_code),
      ]);
      await this.assertNoSoDConflicts(tx, finalUnion);

      await tx.query(
        `DELETE FROM user_roles
         WHERE tenant_id = (SELECT app.tenant_id()) AND user_id = $1
           AND branch_id IS NOT DISTINCT FROM $2`,
        [dto.userId, dto.branchId ?? null],
      );
      for (const roleId of wanted) {
        await tx.query(
          `INSERT INTO user_roles (tenant_id, user_id, role_id, branch_id)
           VALUES ((SELECT app.tenant_id()), $1, $2, $3)
           ON CONFLICT DO NOTHING`,
          [dto.userId, roleId, dto.branchId ?? null],
        );
      }
    });
  }

  /** Role ids currently granted to a user (all scopes). */
  async roleIdsForUser(tenantId: string, userId: string, targetUserId: string): Promise<ReadonlySet<string>> {
    return withTenant({ tenantId, userId }, async (tx) => {
      const r = await tx.query<{ role_id: string }>(
        `SELECT role_id FROM user_roles
         WHERE tenant_id = (SELECT app.tenant_id()) AND user_id = $1`,
        [targetUserId],
      );
      return new Set(r.rows.map((row) => row.role_id));
    });
  }

  // ---- catalogue + SoD ----------------------------------------------------

  /** Grouped permission catalogue for the admin permission-matrix screen. */
  permissionMatrix(): Array<{ module: string; permissions: PermissionDto[] }> {
    const modules = new Map<string, PermissionDto[]>();
    for (const code of ALL_PERMISSIONS) {
      const module = code.split(".")[0] ?? code;
      const list = modules.get(module) ?? [];
      list.push({ code, description: PERMISSION_CATALOGUE[code] ?? "" });
      modules.set(module, list);
    }
    return [...modules.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([module, permissions]) => ({ module, permissions }));
  }

  /** Refuse any SoD pair fully contained in the proposed permission union. */
  private async assertNoSoDConflicts(tx: PoolClient, union: Set<string>): Promise<void> {
    const conflicts = await tx.query<{ permission_a: string; permission_b: string; rationale: string }>(
      `SELECT permission_a, permission_b, rationale FROM sod_conflicts`,
    );
    for (const row of conflicts.rows) {
      if (union.has(row.permission_a) && union.has(row.permission_b)) {
        throw new ProblemException("SEGREGATION_OF_DUTIES", {
          detail: `${row.permission_a} + ${row.permission_b} may not be held together: ${row.rationale}`,
        });
      }
    }
  }

  /** Permissions must exist in the global catalogue (typo-proof grants). */
  private async assertKnownPermissions(codes: readonly string[]): Promise<void> {
    const unknown = codes.filter((c) => !ALL_PERMISSIONS.includes(c));
    if (unknown.length > 0) {
      throw new ProblemException("VALIDATION_FAILED", {
        detail: `unknown permissions: ${unknown.join(", ")}`,
      });
    }
  }

  private async replacePermissions(tx: PoolClient, roleId: string, codes: readonly string[]): Promise<void> {
    await tx.query(
      `DELETE FROM role_permissions WHERE tenant_id = (SELECT app.tenant_id()) AND role_id = $1`,
      [roleId],
    );
    for (const code of codes) {
      await tx.query(
        `INSERT INTO role_permissions (tenant_id, role_id, permission_id)
         SELECT (SELECT app.tenant_id()), $1, id FROM permissions WHERE code = $2
         ON CONFLICT DO NOTHING`,
        [roleId, code],
      );
    }
  }

  private async findRole(tx: PoolClient, roleId: string): Promise<RoleRow> {
    const r = await tx.query<RoleRow>(
      `SELECT id, code, name, is_system, row_version
       FROM roles
       WHERE tenant_id = (SELECT app.tenant_id()) AND id = $1 AND deleted_at IS NULL`,
      [roleId],
    );
    const role = r.rows[0];
    if (!role) throw new ProblemException("NOT_FOUND", { detail: "role not found" });
    return role;
  }
}

function toDto(row: RoleRow) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    isSystem: row.is_system,
    rowVersion: row.row_version,
  };
}

/** Postgres RETURNING always yields the row for these statements; fail loud if not. */
function mustRow(rows: readonly RoleRow[], what: string): RoleRow {
  const row = rows[0];
  if (!row) throw new ProblemException("CONFLICT", { detail: `${what} returned no row` });
  return row;
}
