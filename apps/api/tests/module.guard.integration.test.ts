import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ExecutionContext } from "@nestjs/common";
import { HttpException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { withTenant } from "@clinic/db";
import { probeDb } from "@clinic/db/tests/helpers.js";
import { MODULE_KEY, ModuleGuard } from "../src/rbac/module.guard.js";

/**
 * Module entitlement against the real database (todo 1.6, architecture §5.3,
 * specification AC-23 "enforced server-side").
 *
 * The unit suite proves the guard's decision table with a stubbed store. This
 * one proves the *lookup* is tenant-correct against real RLS: the query runs
 * inside `withTenant`, so a guard bug that read the wrong tenant (or bypassed
 * RLS) would show up as tenant A seeing tenant B's entitlements.
 */

const dbUp = await probeDb();
const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";
const reflector = new Reflector();
const guard = new ModuleGuard(reflector);

interface Module {
  module: string;
  status: string;
}


function ctxFor(module: string, tenantId: string, method = "GET"): ExecutionContext {
  class Ctrl {}
  const handler = function handler() {};
  Reflect.defineMetadata(MODULE_KEY, module, handler);
  const req = {
    method,
    authContext: {
      kind: "user",
      userId: "a3000000-0000-4000-8000-000000000001",
      tenantId,
      sessionId: null,
      branchId: null,
      amr: ["pwd"],
      scopes: [],
    },
  };
  return {
    getHandler: () => handler,
    getClass: () => Ctrl,
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

async function codeOf(p: Promise<boolean>): Promise<string> {
  try {
    await p;
    return "ALLOWED";
  } catch (err) {
    expect(err).toBeInstanceOf(HttpException);
    return ((err as HttpException).getResponse() as { code: string }).code;
  }
}

/** Set a module's status for a tenant, restoring nothing (transactional test). */
async function setStatus(tenantId: string, module: string, status: string): Promise<void> {
  await withTenant({ tenantId }, async (tx) => {
    await tx.query(
      `INSERT INTO tenant_modules (tenant_id, module, status)
       VALUES ($1, $2, $3)
       ON CONFLICT (tenant_id, module)
       DO UPDATE SET status = EXCLUDED.status, updated_at = now()`,
      [tenantId, module, status],
    );
  });
}

async function dropModule(tenantId: string, module: string): Promise<void> {
  await withTenant({ tenantId }, async (tx) => {
    await tx.query(`DELETE FROM tenant_modules WHERE tenant_id = $1 AND module = $2`, [
      tenantId,
      module,
    ]);
  });
}

/** Entitlement rows as they were before the test mutated them. */
const saved = new Map<string, Module[]>();

beforeAll(async () => {
  if (!dbUp) return;
  for (const tenantId of [TENANT_A, TENANT_B]) {
    const rows = await withTenant({ tenantId }, async (tx) => {
      const { rows: r } = await tx.query<Module>(
        `SELECT module, status FROM tenant_modules WHERE tenant_id = $1`,
        [tenantId],
      );
      return r;
    });
    saved.set(tenantId, rows.map((r) => ({ ...r })));
  }
});

afterAll(async () => {
  if (!dbUp) return;
  for (const tenantId of [TENANT_A, TENANT_B]) {
    const original = saved.get(tenantId) ?? [];
    await withTenant({ tenantId }, async (tx) => {
      await tx.query(`DELETE FROM tenant_modules WHERE tenant_id = $1`, [tenantId]);
      for (const row of original) {
        await tx.query(
          `INSERT INTO tenant_modules (tenant_id, module, status) VALUES ($1, $2, $3)`,
          [tenantId, row.module, row.status],
        );
      }
    });
  }
});

describe.skipIf(!dbUp)("ModuleGuard against the real DB (todo 1.6)", () => {
  it("allows a module the tenant is entitled to (seeded admin/patients)", async () => {
    expect(await codeOf(guard.canActivate(ctxFor("admin", TENANT_A)))).toBe("ALLOWED");
  });

  it("refuses a module with no entitlement row", async () => {
    expect(await codeOf(guard.canActivate(ctxFor("laboratory", TENANT_A)))).toBe(
      "MODULE_NOT_ENTITLED",
    );
  });

  it("is tenant-scoped: tenant A's entitlement does not entitle tenant B", async () => {
    // Both tenants are seeded with `admin`, so the discriminating case is a
    // module granted to A only. If RLS were bypassed, B would be allowed.
    await setStatus(TENANT_A, "supply", "ENABLED");
    try {
      expect(await codeOf(guard.canActivate(ctxFor("supply", TENANT_A)))).toBe("ALLOWED");
      expect(await codeOf(guard.canActivate(ctxFor("supply", TENANT_B)))).toBe(
        "MODULE_NOT_ENTITLED",
      );
    } finally {
      await dropModule(TENANT_A, "supply");
    }
  });

  it("refuses DISABLED with MODULE_NOT_ENTITLED", async () => {
    await setStatus(TENANT_B, "billing", "DISABLED");
    expect(await codeOf(guard.canActivate(ctxFor("billing", TENANT_B)))).toBe(
      "MODULE_NOT_ENTITLED",
    );
  });

  it("allows reads but refuses writes while DRAINING", async () => {
    await setStatus(TENANT_A, "pharmacy", "DRAINING");
    expect(await codeOf(guard.canActivate(ctxFor("pharmacy", TENANT_A, "GET")))).toBe("ALLOWED");
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      expect(await codeOf(guard.canActivate(ctxFor("pharmacy", TENANT_A, method)))).toBe(
        "MODULE_READ_ONLY",
      );
    }
  });

  it("allows TRIAL for both reads and writes (a trial is a real entitlement)", async () => {
    await setStatus(TENANT_A, "reports", "TRIAL");
    expect(await codeOf(guard.canActivate(ctxFor("reports", TENANT_A, "GET")))).toBe("ALLOWED");
    expect(await codeOf(guard.canActivate(ctxFor("reports", TENANT_A, "POST")))).toBe("ALLOWED");
  });

  it("returns 503 rather than granting when the lookup cannot run", async () => {
    // A tenant id that does not exist still resolves a pool; simulate an
    // unreadable store by using a syntactically invalid tenant context that
    // makes set_config fail, proving the catch path yields 503 not ALLOWED.
    const brokenTenant = "not-a-uuid";
    const code = await codeOf(guard.canActivate(ctxFor("clinical", brokenTenant)));
    expect(code).toBe("UPSTREAM_UNAVAILABLE");
  });
});
