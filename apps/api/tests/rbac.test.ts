import { describe, expect, it } from "vitest";
import {
  ALL_PERMISSIONS,
  PERMISSION_CATALOGUE,
  SYSTEM_ROLE_CODES,
  SYSTEM_ROLE_TEMPLATES,
  RoleCloneSchema,
  RoleCreateSchema,
  RoleUpdateSchema,
  UserRoleAssignSchema,
} from "@clinic/contracts";
import { RequirePermission, REQUIRED_PERMISSION_KEY } from "../src/rbac/require-permission.decorator.js";
import { RbacService } from "../src/rbac/rbac.service.js";

describe("permission catalogue (todo 1.3, spec §2.3)", () => {
  /**
   * The pairs declared by migration 0007. Kept in sync with `sod_conflicts` so
   * a template that can never be assigned is caught here rather than by a
   * tenant admin at grant time.
   */
  const SOD_PAIRS: ReadonlyArray<readonly [string, string]> = [
    ["supply.adjust.submit", "supply.adjust.approve"],
    ["supply.adjust.approve", "supply.adjust.post"],
    ["supply.po.submit", "supply.po.approve"],
    ["supply.grn.post", "supply.invoice.match"],
    ["lab.result.enter", "lab.result.verify"],
    ["pharmacy.rx.verify", "pharmacy.dispense.post"],
    ["billing.payment.void", "billing.payment.create"],
  ];

  it("exposes a large catalogue with unique codes", () => {
    expect(ALL_PERMISSIONS.length).toBeGreaterThanOrEqual(300);
    expect(new Set(ALL_PERMISSIONS).size).toBe(ALL_PERMISSIONS.length);
  });

  it("names every permission in lower_snake_case dot notation", () => {
    // Module-scoped permissions are module.resource.action; the deliberate
    // cross-cutting set (reference, files, jobs, notifications) is two-part.
    const crossCutting = new Set(["reference", "files", "jobs", "notifications"]);
    const re = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;
    const offenders = ALL_PERMISSIONS.filter((code) => {
      if (!re.test(code)) return true;
      const head = code.split(".")[0] ?? "";
      return code.split(".").length === 2 && !crossCutting.has(head);
    });
    expect(offenders).toEqual([]);
  });

  it("describes every permission", () => {
    const missing = ALL_PERMISSIONS.filter((c) => !(PERMISSION_CATALOGUE[c] ?? "").trim());
    expect(missing).toEqual([]);
  });

  it("covers the §2.1 system roles and template grants resolve to catalogue codes", () => {
    expect(SYSTEM_ROLE_CODES).toContain("tenant_admin");
    expect(SYSTEM_ROLE_CODES).toHaveLength(16);
    for (const [role, perms] of Object.entries(SYSTEM_ROLE_TEMPLATES)) {
      expect(SYSTEM_ROLE_CODES).toContain(role);
      const unknown = perms.filter((p) => !ALL_PERMISSIONS.includes(p));
      expect([role, unknown]).toEqual([role, []]);
    }
  });

  it("keeps tenant_admin as the broadest admin template", () => {
    const admin = SYSTEM_ROLE_TEMPLATES.tenant_admin;
    expect(admin).toContain("admin.role.create");
    expect(admin).toContain("admin.user.update");
    expect(admin).toContain("compliance.audit.read");
  });

  /**
   * KNOWN CONTRADICTION — pending a product decision, not a code fix.
   *
   * `specification` §2.1 grants PHARMACIST both "Verify, dispense", but
   * migration 0007 declares `pharmacy.rx.verify` × `pharmacy.dispense.post` a
   * segregation-of-duties conflict. Both cannot hold: with the pair declared,
   * the `pharmacist` role can never be assigned to anyone, because
   * `assignUserRoles` refuses the union.
   *
   * Resolving this means choosing between two spec statements, so it is a
   * scope question for the product owner, not something to silently patch in
   * the service. Until it is decided this test records the exact conflict.
   */
  it("KNOWN CONTRADICTION: pharmacist template holds a declared SoD pair", () => {
    const perms = SYSTEM_ROLE_TEMPLATES.pharmacist ?? [];
    const held = SOD_PAIRS.filter(([a, b]) => perms.includes(a) && perms.includes(b)).map(
      ([a, b]) => `${a}+${b}`,
    );
    expect(held).toEqual(["pharmacy.rx.verify+pharmacy.dispense.post"]);
  });

  it("keeps every OTHER system template free of declared SoD pairs", () => {
    const offenders: string[] = [];
    for (const [role, perms] of Object.entries(SYSTEM_ROLE_TEMPLATES)) {
      if (role === "pharmacist") continue; // see the contradiction test above
      for (const [a, b] of SOD_PAIRS) {
        if (perms.includes(a) && perms.includes(b)) offenders.push(`${role}:${a}+${b}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("role schemas", () => {
  it("rejects reserved system codes on create/clone", () => {
    expect(RoleCreateSchema.safeParse({ code: "doctor", name: "x" }).success).toBe(false);
    expect(RoleCloneSchema.safeParse({ code: "tenant_admin", name: "x" }).success).toBe(false);
  });

  it("accepts lower_snake_case custom codes", () => {
    const parsed = RoleCreateSchema.parse({ code: "lab_encoder_lite", name: "Lab Encoder Lite" });
    expect(parsed.permissions).toEqual([]);
  });

  it("keeps update partial and validates field values", () => {
    expect(RoleUpdateSchema.safeParse({}).success).toBe(true);
    expect(RoleUpdateSchema.safeParse({ permissions: "nope" }).success).toBe(false);
    expect(RoleUpdateSchema.safeParse({ rowVersion: 0 }).success).toBe(false);
  });

  it("validates assignment payloads", () => {
    expect(
      UserRoleAssignSchema.safeParse({ userId: "00000000-0000-4000-8000-000000000001", roleIds: [] }).success,
    ).toBe(true);
    expect(UserRoleAssignSchema.safeParse({ userId: "not-a-uuid", roleIds: [] }).success).toBe(false);
  });
});

describe("RequirePermission decorator", () => {
  it("stores the permission under the reflector key", () => {
    class Tmp {
      @RequirePermission("admin.role.read")
      handler() {}
    }
    const key = Reflect.getMetadata(REQUIRED_PERMISSION_KEY, Tmp.prototype.handler);
    expect(key).toBe("admin.role.read");
  });
});

describe("RbacService catalogue grouping", () => {
  const svc = new RbacService();

  it("groups the matrix by module prefix, sorted", () => {
    const matrix = svc.permissionMatrix();
    const modules = matrix.map((m) => m.module);
    expect([...modules].sort()).toEqual(modules);
    expect(modules).toContain("admin");
    expect(modules).toContain("lab");
    expect(modules).toContain("billing");
    const lab = matrix.find((m) => m.module === "lab");
    expect(lab?.permissions.some((p) => p.code === "lab.result.verify") ?? false).toBe(true);
  });
});
