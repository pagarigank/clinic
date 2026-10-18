import { Inject, Injectable } from "@nestjs/common";
import type { PlatformAdminCreate, PlatformAdminSummary, UserList } from "@clinic/contracts";
import { withTenant, type PoolClient } from "@clinic/db";
import { ProblemException } from "../http/problem.exception.js";
import { UsersService } from "../rbac/users.service.js";

/** Role every tenant administrator holds (specification §18.1, lines 1080–1082). */
const TENANT_ADMIN_ROLE = "tenant_admin";

const USER_STATUSES = ["INVITED", "ACTIVE", "LOCKED", "DEACTIVATED"] as const;
type UserStatus = (typeof USER_STATUSES)[number];

interface AdminRow {
  id: string;
  email: string;
  name: string;
  status: string;
  mfa_enabled: boolean;
  last_login_at: Date | null;
}

/**
 * Platform console: tenant administrator lifecycle (specification §18.1).
 *
 * These routes are platform-scoped — they act on a *named* tenant from outside
 * it, so every call passes `scope: "platform"` to `withTenant` and relies on the
 * tenant id in the path (never on the caller's own tenant). The actual writes
 * reuse `UsersService`, which keeps the invitation-shaped creation, password
 * policy and session-revocation behaviour identical to the tenant-side admin
 * surface; this service only adds the platform-specific listing and the
 * "target really is an administrator" check.
 *
 * The list deliberately returns account metadata only — never the `employee`
 * record — so no clinical or HR data crosses the platform boundary
 * (architecture §10). Writes are audited by the global AuditInterceptor.
 */
@Injectable()
export class PlatformAdminsService {
  constructor(@Inject(UsersService) private readonly users: UsersService) {}

  /** Cross-tenant read of a single tenant's administrators. */
  async listAdmins(tenantId: string, actorId: string | null): Promise<PlatformAdminSummary[]> {
    return withTenant({ scope: "platform", tenantId, userId: actorId ?? undefined }, async (tx) => {
      await this.assertTenantExists(tx);
      const admins = await tx.query<AdminRow>(
        `SELECT u.id, u.email, u.name, u.status, u.mfa_enabled, u.last_login_at
         FROM users u
         WHERE u.tenant_id = (SELECT app.tenant_id())
           AND EXISTS (
             SELECT 1 FROM user_roles ur
             JOIN roles ro ON ro.tenant_id = ur.tenant_id AND ro.id = ur.role_id
             WHERE ur.tenant_id = u.tenant_id AND ur.user_id = u.id
               AND ro.code = $1 AND ro.deleted_at IS NULL
           )
         ORDER BY u.name, u.email`,
        [TENANT_ADMIN_ROLE],
      );
      if (admins.rows.length === 0) return [];

      const ids = admins.rows.map((r) => r.id);
      const roleRows = await tx.query<{ user_id: string; id: string; code: string; name: string }>(
        `SELECT ur.user_id, ro.id, ro.code, ro.name
         FROM user_roles ur
         JOIN roles ro ON ro.tenant_id = ur.tenant_id AND ro.id = ur.role_id
         WHERE ur.tenant_id = (SELECT app.tenant_id())
           AND ur.user_id = ANY($1)
           AND ur.branch_id IS NULL
           AND ro.deleted_at IS NULL
         ORDER BY ur.user_id, ro.code`,
        [ids],
      );
      const rolesByUser = new Map<string, PlatformAdminSummary["roles"]>();
      for (const r of roleRows.rows) {
        const list = rolesByUser.get(r.user_id) ?? [];
        list.push({ id: r.id, code: r.code, name: r.name });
        rolesByUser.set(r.user_id, list);
      }

      return admins.rows.map((u) => ({
        id: u.id,
        email: u.email,
        name: u.name,
        status: this.toStatus(u.status),
        mfaEnabled: u.mfa_enabled,
        lastLoginAt: u.last_login_at ? u.last_login_at.toISOString() : null,
        roles: rolesByUser.get(u.id) ?? [],
      }));
    });
  }

  /**
   * Invite a tenant administrator ({@link PlatformAdminCreate}, specification
   * §18.1). The account is born `INVITED` — the invitee sets their own
   * credentials through the audited forgot flow, so no working secret ever
   * leaves this call.
   */
  async createAdmin(
    tenantId: string,
    actorId: string | null,
    dto: PlatformAdminCreate,
  ): Promise<UserList> {
    const actor = this.requireActor(actorId);
    const roleId = await withTenant({ scope: "platform", tenantId, userId: actor }, async (tx) => {
      await this.assertTenantExists(tx);
      return this.tenantAdminRoleId(tx);
    });
    return this.users.create(tenantId, actor, {
      email: dto.email,
      name: dto.name,
      roleIds: [roleId],
    });
  }

  /** Force a password reset on a tenant administrator (step-up protected). */
  async resetAdminPassword(
    tenantId: string,
    actorId: string | null,
    targetId: string,
    dto: unknown,
  ): Promise<{ reset: true }> {
    const actor = this.requireActor(actorId);
    await this.assertTargetIsAdmin(tenantId, actor, targetId);
    return this.users.forcePasswordReset(tenantId, actor, targetId, dto);
  }

  /** Clear a tenant administrator's MFA enrolment and sessions (step-up). */
  async resetAdminMfa(
    tenantId: string,
    actorId: string | null,
    targetId: string,
  ): Promise<{ reset: true }> {
    const actor = this.requireActor(actorId);
    await this.assertTargetIsAdmin(tenantId, actor, targetId);
    return this.users.resetMfa(tenantId, actor, targetId);
  }

  /** Clear a lockout on any of a tenant's users (step-up protected). */
  async unlockUser(
    tenantId: string,
    actorId: string | null,
    targetId: string,
  ): Promise<{ unlocked: true }> {
    const actor = this.requireActor(actorId);
    return this.users.unlock(tenantId, actor, targetId);
  }

  // ---- helpers ------------------------------------------------------------

  private requireActor(actorId: string | null): string {
    if (!actorId) {
      throw new ProblemException("FORBIDDEN", {
        detail: "a platform operator identity is required for this action",
      });
    }
    return actorId;
  }

  private async assertTenantExists(tx: PoolClient): Promise<void> {
    const r = await tx.query<{ id: string }>(
      `SELECT id FROM tenants WHERE id = (SELECT app.tenant_id())`,
    );
    if (!r.rows[0]) {
      throw new ProblemException("NOT_FOUND", { detail: "tenant not found" });
    }
  }

  private async tenantAdminRoleId(tx: PoolClient): Promise<string> {
    const r = await tx.query<{ id: string }>(
      `SELECT id FROM roles
       WHERE tenant_id = (SELECT app.tenant_id()) AND code = $1 AND deleted_at IS NULL`,
      [TENANT_ADMIN_ROLE],
    );
    if (!r.rows[0]) {
      throw new ProblemException("NOT_FOUND", {
        detail: "the tenant_admin role is not provisioned for this clinic",
      });
    }
    return r.rows[0].id;
  }

  /**
   * Password and MFA resets only ever target an administrator; a plain user id
   * must not be reachable through the `/admins/{uid}` route (specification
   * §18.1).
   */
  private async assertTargetIsAdmin(
    tenantId: string,
    actorId: string,
    targetId: string,
  ): Promise<void> {
    await withTenant({ scope: "platform", tenantId, userId: actorId }, async (tx) => {
      const r = await tx.query(
        `SELECT 1 FROM user_roles ur
         JOIN roles ro ON ro.tenant_id = ur.tenant_id AND ro.id = ur.role_id
         WHERE ur.tenant_id = (SELECT app.tenant_id()) AND ur.user_id = $1
           AND ro.code = $2 AND ro.deleted_at IS NULL
         LIMIT 1`,
        [targetId, TENANT_ADMIN_ROLE],
      );
      if (!r.rows[0]) {
        throw new ProblemException("NOT_FOUND", { detail: "not a tenant administrator" });
      }
    });
  }

  private toStatus(status: string): UserStatus {
    return (USER_STATUSES as readonly string[]).includes(status) ? (status as UserStatus) : "ACTIVE";
  }
}
