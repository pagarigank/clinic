import { afterAll, describe, expect, it } from "vitest";
import { withTenant } from "@clinic/db";
import { probeDb, seedUsers, NO_SEED_USERS } from "@clinic/db/tests/helpers.js";
import { PlatformAdminsService } from "../src/platform/platform-admins.service.js";
import { UsersService } from "../src/rbac/users.service.js";

const dbUp = await probeDb();

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const UNKNOWN_TENANT = "0f0e0d0c-0b0a-4000-8000-000000000000";
const PLATFORM_OPERATOR = "0706469e-8eb1-4079-83bd-1be24506447a";
const { DOCTOR_A } = dbUp ? await seedUsers() : NO_SEED_USERS;

const admins = new PlatformAdminsService(new UsersService());
const suffix = Date.now();
const createdUserIds: string[] = [];

afterAll(async () => {
  if (!dbUp) return;
  for (const userId of createdUserIds) {
    await withTenant({ tenantId: TENANT_A }, async (tx) => {
      await tx.query(`DELETE FROM users WHERE tenant_id = $1 AND id = $2`, [TENANT_A, userId]);
    });
  }
});

describe.skipIf(!dbUp)("platform tenant admin management (specification §18.1, real DB)", () => {
  it("lists only administrators, with account metadata and no employee record", async () => {
    const list = await admins.listAdmins(TENANT_A, PLATFORM_OPERATOR);
    const seeded = list.find((a) => a.email === "admin@demo-a.test");
    expect(seeded).toBeDefined();
    expect(seeded?.roles.map((r) => r.code)).toContain("tenant_admin");
    expect(list.every((a) => a.roles.some((r) => r.code === "tenant_admin"))).toBe(true);
    expect(Object.keys(seeded ?? {})).not.toContain("employee");
  });

  it("returns NOT_FOUND for an unknown tenant", async () => {
    await expect(admins.listAdmins(UNKNOWN_TENANT, PLATFORM_OPERATOR)).rejects.toMatchObject({
      status: 404,
    });
  });

  it("invites an administrator who is born INVITED with the tenant_admin role", async () => {
    const created = await admins.createAdmin(TENANT_A, PLATFORM_OPERATOR, {
      email: `platform-admin-${suffix}@demo-a.test`,
      name: "Platform Invited Admin",
    });
    createdUserIds.push(created.id);
    expect(created.status).toBe("INVITED");
    expect(created.roles.map((r) => r.code)).toEqual(["tenant_admin"]);

    const list = await admins.listAdmins(TENANT_A, PLATFORM_OPERATOR);
    expect(list.map((a) => a.id)).toContain(created.id);
  });

  it("refuses a duplicate admin email with CONFLICT", async () => {
    await expect(
      admins.createAdmin(TENANT_A, PLATFORM_OPERATOR, {
        email: "admin@demo-a.test",
        name: "Duplicate",
      }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("requires a platform operator identity (FORBIDDEN without one)", async () => {
    await expect(
      admins.createAdmin(TENANT_A, null, {
        email: `no-actor-${suffix}@demo-a.test`,
        name: "No Actor",
      }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("force-resets an admin password (policy-checked) and clears their MFA", async () => {
    const created = await admins.createAdmin(TENANT_A, PLATFORM_OPERATOR, {
      email: `platform-reset-${suffix}@demo-a.test`,
      name: "Platform Reset Admin",
    });
    createdUserIds.push(created.id);

    await withTenant({ tenantId: TENANT_A }, async (tx) => {
      await tx.query(
        `UPDATE users SET mfa_enabled = true WHERE tenant_id = $1 AND id = $2`,
        [TENANT_A, created.id],
      );
    });

    await expect(
      admins.resetAdminPassword(TENANT_A, PLATFORM_OPERATOR, created.id, { newPassword: "short" }),
    ).rejects.toMatchObject({ status: 422 });

    await admins.resetAdminPassword(TENANT_A, PLATFORM_OPERATOR, created.id, {
      newPassword: "Pl4tformFresh!2026",
    });
    await admins.resetAdminMfa(TENANT_A, PLATFORM_OPERATOR, created.id);

    const row = await withTenant({ tenantId: TENANT_A }, async (tx) => {
      const r = await tx.query<{ mfa_enabled: boolean }>(
        `SELECT mfa_enabled FROM users WHERE tenant_id = $1 AND id = $2`,
        [TENANT_A, created.id],
      );
      return r.rows[0];
    });
    expect(row?.mfa_enabled).toBe(false);
  });

  it("refuses password/MFA resets on a non-administrator (NOT_FOUND)", async () => {
    await expect(
      admins.resetAdminPassword(TENANT_A, PLATFORM_OPERATOR, DOCTOR_A, {
        newPassword: "Pl4tformFresh!2026",
      }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      admins.resetAdminMfa(TENANT_A, PLATFORM_OPERATOR, DOCTOR_A),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("unlocks any user of the tenant", async () => {
    await withTenant({ tenantId: TENANT_A }, async (tx) => {
      await tx.query(
        `UPDATE users SET locked_until = now() + interval '1 hour', failed_login_count = 5
         WHERE tenant_id = $1 AND id = $2`,
        [TENANT_A, DOCTOR_A],
      );
    });

    await admins.unlockUser(TENANT_A, PLATFORM_OPERATOR, DOCTOR_A);

    const row = await withTenant({ tenantId: TENANT_A }, async (tx) => {
      const r = await tx.query<{ locked_until: Date | null; failed_login_count: number }>(
        `SELECT locked_until, failed_login_count FROM users WHERE tenant_id = $1 AND id = $2`,
        [TENANT_A, DOCTOR_A],
      );
      return r.rows[0];
    });
    expect(row?.locked_until).toBeNull();
    expect(row?.failed_login_count).toBe(0);
  });
});
