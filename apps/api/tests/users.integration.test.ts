import { afterAll, describe, expect, it } from "vitest";
import { withTenant } from "@clinic/db";
import { probeDb } from "@clinic/db/tests/helpers.js";
import { UsersService } from "../src/rbac/users.service.js";
import { RbacService } from "../src/rbac/rbac.service.js";
import { PasswordService } from "../src/auth/crypto/password.js";
import { ProblemException } from "../src/http/problem.exception.js";

const dbUp = await probeDb();

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const USER_A_ADMIN = "a3000000-0000-4000-8000-000000000001"; // admin@demo-a.test
const ROLE_A_RECEPTIONIST = "a2000000-0000-4000-8000-000000000003";

const users = new UsersService();
const rbac = new RbacService();
const passwords = new PasswordService();
const suffix = Date.now();
const createdUserIds: string[] = [];

afterAll(async () => {
  if (!dbUp) return;
  for (const userId of createdUserIds) {
    // sessions/mfa_secrets/user_roles/user_branches/password_resets all
    // cascade from users (migration 0005); delete the parent directly.
    await withTenant({ tenantId: TENANT_A }, async (tx) => {
      await tx.query(`DELETE FROM users WHERE tenant_id = $1 AND id = $2`, [TENANT_A, userId]);
    });
  }
});

describe.skipIf(!dbUp)("admin user CRUD (specification §18.2, real DB)", () => {
  it("creates an INVITED user with tenant-wide roles and lists it", async () => {
    const created = await users.create(TENANT_A, USER_A_ADMIN, {
      email: `crud-probe-${suffix}@demo-a.test`,
      name: "CRUD Probe",
      roleIds: [ROLE_A_RECEPTIONIST],
    });
    createdUserIds.push(created.id);
    expect(created.status).toBe("INVITED");
    expect(created.roles.map((r) => r.code)).toEqual(["receptionist"]);
    expect(created.rowVersion).toBe(1);

    const list = await users.list(TENANT_A, USER_A_ADMIN);
    const found = list.find((u) => u.id === created.id);
    expect(found?.email).toBe(`crud-probe-${suffix}@demo-a.test`);
    expect(found?.roles.length).toBe(1);
  });

  it("refuses duplicate email with CONFLICT", async () => {
    await expect(
      users.create(TENANT_A, USER_A_ADMIN, {
        email: "admin@demo-a.test",
        name: "Duplicate Probe",
      }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("refuses unknown role ids with NOT_FOUND before any insert", async () => {
    await expect(
      users.create(TENANT_A, USER_A_ADMIN, {
        email: `ghost-role-${suffix}@demo-a.test`,
        name: "Ghost Probe",
        roleIds: ["00000000-0000-4000-8000-0000000009de"],
      }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("enforces SoD on the created user's permission union", async () => {
    // Two roles, each SoD-safe alone; together they hit the lab enter/verify
    // pair — creation must refuse exactly like role assignment does (AC-17).
    const enter = await rbac.createRole(TENANT_A, USER_A_ADMIN, {
      code: `ucr_enter_${suffix}`,
      name: "SoD Enter",
      permissions: ["lab.result.enter"],
    });
    const verify = await rbac.createRole(TENANT_A, USER_A_ADMIN, {
      code: `ucr_verify_${suffix}`,
      name: "SoD Verify",
      permissions: ["lab.result.verify"],
    });
    try {
      await expect(
        users.create(TENANT_A, USER_A_ADMIN, {
          email: `sod-user-${suffix}@demo-a.test`,
          name: "SoD User",
          roleIds: [enter.id, verify.id],
        }),
      ).rejects.toMatchObject({ status: 403 });
    } finally {
      await withTenant({ tenantId: TENANT_A }, async (tx) => {
        for (const roleId of [enter.id, verify.id]) {
          await tx.query(`DELETE FROM role_permissions WHERE tenant_id = $1 AND role_id = $2`, [TENANT_A, roleId]);
          await tx.query(`DELETE FROM roles WHERE tenant_id = $1 AND id = $2`, [TENANT_A, roleId]);
        }
      });
    }
  });

  it("updates the name with rowVersion and refuses stale writes (412)", async () => {
    const created = await users.create(TENANT_A, USER_A_ADMIN, {
      email: `upd-probe-${suffix}@demo-a.test`,
      name: "Update Probe",
    });
    createdUserIds.push(created.id);
    const updated = await users.update(TENANT_A, USER_A_ADMIN, created.id, {
      name: "Update Probe v2",
      rowVersion: created.rowVersion,
    });
    expect(updated.name).toBe("Update Probe v2");
    expect(updated.rowVersion).toBe(created.rowVersion + 1);
    await expect(
      users.update(TENANT_A, USER_A_ADMIN, created.id, { name: "Stale", rowVersion: created.rowVersion }),
    ).rejects.toMatchObject({ status: 412 });
  });

  it("deactivates (revoking sessions), refuses self-deactivation, and reactivates to INVITED", async () => {
    const created = await users.create(TENANT_A, USER_A_ADMIN, {
      email: `life-probe-${suffix}@demo-a.test`,
      name: "Lifecycle Probe",
    });
    createdUserIds.push(created.id);

    // A live session that must die with the deactivation.
    await withTenant({ tenantId: TENANT_A }, async (tx) => {
      await tx.query(
        `INSERT INTO sessions (tenant_id, user_id, refresh_hash, expires_at)
         VALUES ($1, $2, 'integration-probe', now() + interval '1 hour')`,
        [TENANT_A, created.id],
      );
    });

    await expect(users.deactivate(TENANT_A, USER_A_ADMIN, USER_A_ADMIN)).rejects.toMatchObject({
      status: 409,
    });

    await users.deactivate(TENANT_A, USER_A_ADMIN, created.id);
    let row = await withTenant({ tenantId: TENANT_A }, async (tx) => {
      const r = await tx.query<{ status: string }>(
        `SELECT status FROM users WHERE tenant_id = $1 AND id = $2`,
        [TENANT_A, created.id],
      );
      return r.rows[0];
    });
    expect(row?.status).toBe("DEACTIVATED");
    const openSessions = await withTenant({ tenantId: TENANT_A }, async (tx) => {
      const r = await tx.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM sessions WHERE tenant_id = $1 AND user_id = $2 AND revoked_at IS NULL`,
        [TENANT_A, created.id],
      );
      return r.rows[0]?.n ?? 0;
    });
    expect(openSessions).toBe(0);

    await users.reactivate(TENANT_A, USER_A_ADMIN, created.id);
    row = await withTenant({ tenantId: TENANT_A }, async (tx) => {
      const r = await tx.query<{ status: string }>(
        `SELECT status FROM users WHERE tenant_id = $1 AND id = $2`,
        [TENANT_A, created.id],
      );
      return r.rows[0];
    });
    expect(row?.status).toBe("INVITED");
  });

  it("unlocks, resets MFA, and force-resets the password (policy-checked)", async () => {
    const created = await users.create(TENANT_A, USER_A_ADMIN, {
      email: `secure-probe-${suffix}@demo-a.test`,
      name: "Security Probe",
    });
    createdUserIds.push(created.id);
    await withTenant({ tenantId: TENANT_A }, async (tx) => {
      await tx.query(
        `UPDATE users SET locked_until = now() + interval '1 hour', failed_login_count = 5, mfa_enabled = true
         WHERE tenant_id = $1 AND id = $2`,
        [TENANT_A, created.id],
      );
    });

    await users.unlock(TENANT_A, USER_A_ADMIN, created.id);
    await users.resetMfa(TENANT_A, USER_A_ADMIN, created.id);
    const row = await withTenant({ tenantId: TENANT_A }, async (tx) => {
      const r = await tx.query<{ locked_until: Date | null; failed_login_count: number; mfa_enabled: boolean }>(
        `SELECT locked_until, failed_login_count, mfa_enabled FROM users WHERE tenant_id = $1 AND id = $2`,
        [TENANT_A, created.id],
      );
      return r.rows[0];
    });
    expect(row?.locked_until).toBeNull();
    expect(row?.failed_login_count).toBe(0);
    expect(row?.mfa_enabled).toBe(false);

    await expect(
      users.forcePasswordReset(TENANT_A, USER_A_ADMIN, created.id, { newPassword: "short" }),
    ).rejects.toMatchObject({ status: 422 });
    await users.forcePasswordReset(TENANT_A, USER_A_ADMIN, created.id, { newPassword: "FreshPassw0rd!2026" });
    const hashRow = await withTenant({ tenantId: TENANT_A }, async (tx) => {
      const r = await tx.query<{ password_hash: string }>(
        `SELECT password_hash FROM users WHERE tenant_id = $1 AND id = $2`,
        [TENANT_A, created.id],
      );
      return r.rows[0];
    });
    expect(hashRow && (await passwords.verifyPassword("FreshPassw0rd!2026", hashRow.password_hash))).toBe(true);
  });
});
