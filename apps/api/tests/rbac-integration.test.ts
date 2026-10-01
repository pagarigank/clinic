import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenant } from "@clinic/db";
import { probeDb } from "@clinic/db/tests/helpers.js";
import { RbacService } from "../src/rbac/rbac.service.js";
import { ProblemException } from "../src/http/problem.exception.js";

const dbUp = await probeDb();

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";
const ROLE_A_TENANT_ADMIN = "a2000000-0000-4000-8000-000000000001";
const ROLE_A_DOCTOR = "a2000000-0000-4000-8000-000000000002";
const ROLE_A_RECEPTIONIST = "a2000000-0000-4000-8000-000000000003";
const USER_A_ADMIN = "a3000000-0000-4000-8000-000000000001"; // admin@demo-a.test

const svc = new RbacService();
const suffix = Date.now();
const createdRoleIds: string[] = [];

beforeAll(async () => {
  if (!dbUp) return;
  // Guarantee the demo admin holds the tenant_admin template (seed state).
  await withTenant({ tenantId: TENANT_A }, async (tx) => {
    await tx.query(
      `INSERT INTO user_roles (tenant_id, user_id, role_id, branch_id)
       SELECT $1, $2, $3, NULL WHERE NOT EXISTS (
         SELECT 1 FROM user_roles WHERE tenant_id = $1 AND user_id = $2 AND role_id = $3)`,
      [TENANT_A, USER_A_ADMIN, ROLE_A_TENANT_ADMIN],
    );
  });
});

afterAll(async () => {
  if (!dbUp) return;
  for (const roleId of createdRoleIds) {
    await withTenant({ tenantId: TENANT_A }, async (tx) => {
      await tx.query(`DELETE FROM user_roles WHERE tenant_id = $1 AND role_id = $2`, [TENANT_A, roleId]);
      await tx.query(`DELETE FROM role_permissions WHERE tenant_id = $1 AND role_id = $2`, [TENANT_A, roleId]);
      await tx.query(`DELETE FROM roles WHERE tenant_id = $1 AND id = $2`, [TENANT_A, roleId]);
    });
  }
});

describe.skipIf(!dbUp)("rbac service (real DB, todo 1.3)", () => {
  it("lists seeded roles with template permissions", async () => {
    const roles = await svc.listRoles(TENANT_A, USER_A_ADMIN);
    const admin = roles.find((r) => r.code === "tenant_admin");
    expect(admin?.isSystem).toBe(true);
    expect(admin?.permissions.length).toBeGreaterThanOrEqual(60);
    expect(admin?.permissions).toContain("admin.role.create");
    const receptionist = roles.find((r) => r.code === "receptionist");
    expect(receptionist?.permissions).toEqual(
      expect.arrayContaining(["patient.record.read", "clinical.appointment.create"]),
    );
  });

  it("computes effective permissions as the union across roles", async () => {
    const eff = await svc.effectiveForCaller(TENANT_A, USER_A_ADMIN, null);
    expect(eff.roles.map((r) => r.code)).toContain("tenant_admin");
    expect(eff.permissions).toContain("admin.role.update");
    expect(eff.permissions).toContain("patient.record.read");
  });

  it("creates, updates, clones and soft-deletes a custom role", async () => {
    const created = await svc.createRole(TENANT_A, USER_A_ADMIN, {
      code: `sod_probe_${suffix}`,
      name: "SoD Probe",
      permissions: ["patient.record.read", "clinical.appointment.create"],
    });
    createdRoleIds.push(created.id);
    expect(created.isSystem).toBe(false);
    expect(created.permissions.sort()).toEqual(["clinical.appointment.create", "patient.record.read"]);

    const updated = await svc.updateRole(TENANT_A, USER_A_ADMIN, created.id, undefined, {
      name: "SoD Probe v2",
      permissions: ["patient.record.read", "reference.read"],
    });
    expect(updated.name).toBe("SoD Probe v2");
    expect(updated.rowVersion).toBe(created.rowVersion + 1);

    const clone = await svc.cloneRole(TENANT_A, USER_A_ADMIN, created.id, {
      code: `sod_probe_clone_${suffix}`,
      name: "SoD Probe Clone",
    });
    createdRoleIds.push(clone.id);
    expect(clone.permissions).toEqual(["patient.record.read", "reference.read"]);

    await svc.deleteRole(TENANT_A, USER_A_ADMIN, clone.id);
    await expect(svc.getRole(TENANT_A, USER_A_ADMIN, clone.id)).rejects.toMatchObject({ status: 404 });
  });

  it("rejects unknown permission codes with VALIDATION_FAILED", async () => {
    await expect(
      svc.createRole(TENANT_A, USER_A_ADMIN, {
        code: `bogus_${suffix}`,
        name: "Bogus",
        permissions: ["not.a.permission"],
      }),
    ).rejects.toMatchObject({ status: 422 });
  });

  it("refuses system-role edit and delete", async () => {
    await expect(
      svc.updateRole(TENANT_A, USER_A_ADMIN, ROLE_A_DOCTOR, undefined, { name: "Hacked" }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(svc.deleteRole(TENANT_A, USER_A_ADMIN, ROLE_A_RECEPTIONIST)).rejects.toMatchObject({
      status: 409,
    });
  });

  it("enforces SoD on assignment (result enter + verify)", async () => {
    // Build two roles, each SoD-safe on its own.
    const enter = await svc.createRole(TENANT_A, USER_A_ADMIN, {
      code: `sod_enter_${suffix}`,
      name: "Result Enter",
      permissions: ["lab.result.enter"],
    });
    createdRoleIds.push(enter.id);
    const verify = await svc.createRole(TENANT_A, USER_A_ADMIN, {
      code: `sod_verify_${suffix}`,
      name: "Result Verify",
      permissions: ["lab.result.verify"],
    });
    createdRoleIds.push(verify.id);

    // Assigning both to one user violates AC-17.
    await expect(
      svc.assignUserRoles(TENANT_A, USER_A_ADMIN, {
        userId: USER_A_ADMIN,
        roleIds: [enter.id, verify.id],
      }),
    ).rejects.toBeInstanceOf(ProblemException);
    await expect(
      svc.assignUserRoles(TENANT_A, USER_A_ADMIN, { userId: USER_A_ADMIN, roleIds: [enter.id, verify.id] }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("refuses to create a role that itself holds an SoD pair", async () => {
    // A single role granting both halves is a conflict in waiting: it becomes
    // unassignable the moment anyone is granted it. Refuse at write time.
    await expect(
      svc.createRole(TENANT_A, USER_A_ADMIN, {
        code: `sod_both_${suffix}`,
        name: "Enter And Verify",
        permissions: ["lab.result.enter", "lab.result.verify"],
      }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("refuses to widen a role into an SoD pair via update", async () => {
    const role = await svc.createRole(TENANT_A, USER_A_ADMIN, {
      code: `sod_widen_${suffix}`,
      name: "Widen Target",
      permissions: ["lab.result.enter"],
    });
    createdRoleIds.push(role.id);
    await expect(
      svc.updateRole(TENANT_A, USER_A_ADMIN, role.id, role.rowVersion, {
        permissions: ["lab.result.enter", "lab.result.verify"],
      }),
    ).rejects.toMatchObject({ status: 403 });
    // The refused update must not have partially applied.
    const after = await svc.getRole(TENANT_A, USER_A_ADMIN, role.id);
    expect(after.permissions).toEqual(["lab.result.enter"]);
    expect(after.rowVersion).toBe(role.rowVersion);
  });

  it("refuses to clone a role whose permission set is itself conflicting", async () => {
    // A conflicting source can only exist if it was seeded rather than created
    // through the service, so this asserts the clone path validates too.
    const source = await withTenant({ tenantId: TENANT_A }, async (tx) => {
      const r = await tx.query<{ id: string }>(
        `INSERT INTO roles (tenant_id, code, name, is_system, created_by, updated_by)
         VALUES ($1, $2, 'Conflict Source', false, $3, $3) RETURNING id`,
        [TENANT_A, `sod_src_${suffix}`, USER_A_ADMIN],
      );
      const id = r.rows[0]!.id;
      await tx.query(
        `INSERT INTO role_permissions (tenant_id, role_id, permission_id)
         SELECT $1, $2, id FROM permissions
         WHERE code = ANY($3) ON CONFLICT DO NOTHING`,
        [TENANT_A, id, ["supply.po.submit", "supply.po.approve"]],
      );
      return id;
    });
    createdRoleIds.push(source);

    await expect(
      svc.cloneRole(TENANT_A, USER_A_ADMIN, source, { code: `sod_clone2_${suffix}`, name: "Clone" }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("keeps roles tenant-isolated (B cannot see A's custom role)", async () => {
    const created = await svc.createRole(TENANT_A, USER_A_ADMIN, {
      code: `isolated_${suffix}`,
      name: "Tenant A Only",
      permissions: [],
    });
    createdRoleIds.push(created.id);
    const rolesB = await svc.listRoles(TENANT_B, USER_A_ADMIN);
    expect(rolesB.map((r) => r.id)).not.toContain(created.id);
    await expect(svc.getRole(TENANT_B, USER_A_ADMIN, created.id)).rejects.toMatchObject({ status: 404 });
  });

  it("replaces same-scope grants and reports assigned roles", async () => {
    await svc.assignUserRoles(TENANT_A, USER_A_ADMIN, {
      userId: USER_A_ADMIN,
      roleIds: [ROLE_A_TENANT_ADMIN],
    });
    const assigned = await svc.roleIdsForUser(TENANT_A, USER_A_ADMIN, USER_A_ADMIN);
    expect(assigned.has(ROLE_A_TENANT_ADMIN)).toBe(true);
  });
});
