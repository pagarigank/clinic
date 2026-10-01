import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { ExecutionContext } from "@nestjs/common";
import { HttpException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { withTenant } from "@clinic/db";
import { renderPrometheus } from "../src/observability/metrics.js";

// The guard must never reach a real database in a unit test. `vi.mock` is
// hoisted above the imports by vitest; vi.spyOn on an ES module namespace
// would not intercept the guard's own import binding.
vi.mock("@clinic/db", () => ({ 
  withTenant: vi.fn(),
  getAppPool: vi.fn(() => ({
    query: vi.fn().mockResolvedValue({ rowCount: 1, rows: [{ modules_version: 1 }] })
  }))
}));

import {
  MODULE_KEY,
  MODULE_ALLOWLIST_KEY,
  Module,
  ModuleAllowlist,
  ModuleGuard,
  MODULES,
} from "../src/rbac/module.guard.js";

/**
 * Module entitlement enforcement (todo 1.6, architecture §5.3/§11.3,
 * specification AC-23 "enforced server-side", AC-27 "fails closed").
 *
 * Properties, in order of blast radius:
 *  1. a non-entitled tenant is refused BEFORE any permission or data access
 *  2. an unreadable entitlement store returns 503 and never grants
 *  3. DRAINING satisfies reads and refuses writes
 *  4. a route declaring no module throws rather than silently passing
 */

const withTenantMock = vi.mocked(withTenant);

type Status = "TRIAL" | "ENABLED" | "DRAINING" | "DISABLED";

/** Make withTenant resolve with the given entitlement status. */
function stubStatus(status: Status | null) {
  withTenantMock.mockImplementation((async () => status) as never);
}

function stubThrow(err: Error) {
  withTenantMock.mockImplementation((async () => {
    throw err;
  }) as never);
}

const reflector = new Reflector();

function ctxFor(opts: {
  module?: string;
  allowlist?: boolean;
  isPublic?: boolean;
  method?: string;
  tenantId?: string | null;
  userId?: string;
} = {}): ExecutionContext {
  class Ctrl {}
  const handler = function handler() {};
  if (opts.module) Reflect.defineMetadata(MODULE_KEY, opts.module, handler);
  if (opts.allowlist) Reflect.defineMetadata(MODULE_ALLOWLIST_KEY, true, Ctrl);
  if (opts.isPublic) Reflect.defineMetadata("isPublic", true, handler);

  const req: Record<string, unknown> = {
    method: opts.method ?? "GET",
    authContext: {
      kind: "user",
      userId: opts.userId ?? "u1",
      tenantId: opts.tenantId === undefined ? "t1" : opts.tenantId,
      sessionId: "s1",
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

/** Assert the thrown problem+json code. */
function expectCode(fn: () => Promise<boolean>, code: string, status: number) {
  return fn().then(
    () => {
      throw new Error(`expected ${code} but the request was allowed`);
    },
    (err: unknown) => {
      expect(err).toBeInstanceOf(HttpException);
      const ex = err as HttpException;
      const res = ex.getResponse() as { code?: string };
      expect(res.code).toBe(code);
      expect(ex.getStatus()).toBe(status);
    },
  );
}

beforeEach(() => {
  withTenantMock.mockReset();
  // We need to clear the static cache, but it's private.
  // We can use (ModuleGuard as any).versionCache.clear();
  (ModuleGuard as any).versionCache.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ModuleGuard - entitled access", () => {
  it("allows a read on an ENABLED module", async () => {
    stubStatus("ENABLED");
    await expect(new ModuleGuard(reflector).canActivate(ctxFor({ module: "laboratory" }))).resolves.toBe(
      true,
    );
  });

  it("allows a write on an ENABLED module", async () => {
    stubStatus("ENABLED");
    await expect(
      new ModuleGuard(reflector).canActivate(ctxFor({ module: "billing", method: "POST" })),
    ).resolves.toBe(true);
  });

  it("allows a read on a TRIAL module (a trial is a real entitlement)", async () => {
    stubStatus("TRIAL");
    await expect(new ModuleGuard(reflector).canActivate(ctxFor({ module: "pharmacy" }))).resolves.toBe(
      true,
    );
  });

  it("reads the entitlement inside a withTenant transaction scoped to the caller", async () => {
    stubStatus("ENABLED");
    await new ModuleGuard(reflector).canActivate(ctxFor({ module: "clinical", userId: "u-42" }));
    expect(withTenantMock).toHaveBeenCalledWith({ tenantId: "t1", userId: "u-42" }, expect.any(Function));
  });
});

describe("ModuleGuard - non-entitled tenants (403 before permission checks)", () => {
  it("refuses a tenant with no entitlement row for the module", async () => {
    stubStatus(null);
    await expectCode(
      () => new ModuleGuard(reflector).canActivate(ctxFor({ module: "supply" })),
      "MODULE_NOT_ENTITLED",
      403,
    );
  });

  it("refuses an explicitly DISABLED module", async () => {
    stubStatus("DISABLED");
    await expectCode(
      () => new ModuleGuard(reflector).canActivate(ctxFor({ module: "billing" })),
      "MODULE_NOT_ENTITLED",
      403,
    );
  });

  it("does not leak module status in the detail field", async () => {
    stubStatus(null);
    const err = (await new ModuleGuard(reflector)
      .canActivate(ctxFor({ module: "supply" }))
      .catch((e: unknown) => e)) as HttpException;
    const res = err.getResponse() as { detail?: string };
    expect(res.detail).not.toMatch(/TRIAL|ENABLED|DRAINING|DISABLED/);
  });
});

describe("ModuleGuard - fail closed (AC-27)", () => {
  it("returns 503 UPSTREAM_UNAVAILABLE when the entitlement store is unreadable", async () => {
    stubThrow(new Error("ECONNREFUSED 5432"));
    await expectCode(
      () => new ModuleGuard(reflector).canActivate(ctxFor({ module: "clinical" })),
      "UPSTREAM_UNAVAILABLE",
      503,
    );
  });

  it("never grants a normally-entitled module when evaluation fails", async () => {
    // The dangerous case: a module the tenant HAS, checked while the store is
    // down. Fail-open here would quietly widen access during an outage.
    stubThrow(new Error("pool exhausted"));
    await expectCode(
      () => new ModuleGuard(reflector).canActivate(ctxFor({ module: "patients" })),
      "UPSTREAM_UNAVAILABLE",
      503,
    );
  });

  it("refuses even when the failure is a not-a-permission SQL error", async () => {
    // Guards against a future "treat DB errors as 403" shortcut: a
    // misconfigured query must not be reported as an ordinary refusal,
    // because then the outage is invisible in the error budget.
    stubThrow(new Error('permission denied for table tenant_modules'));
    await expectCode(
      () => new ModuleGuard(reflector).canActivate(ctxFor({ module: "clinical" })),
      "UPSTREAM_UNAVAILABLE",
      503,
    );
  });

  it("exports an entitlement_evaluation_failure counter for alerting", async () => {
    withTenantMock.mockImplementationOnce((async () => 1) as never);
    withTenantMock.mockImplementationOnce((async () => { throw new Error("boom"); }) as never);
    await new ModuleGuard(reflector).canActivate(ctxFor({ module: "reports" })).catch(() => {});
    expect(renderPrometheus()).toMatch(/entitlement_evaluation_failure\{module=reports\} 1/);
  });
});

describe("ModuleGuard - DRAINING is read-only", () => {
  it("allows reads and HEAD", async () => {
    stubStatus("DRAINING");
    const guard = new ModuleGuard(reflector);
    await expect(guard.canActivate(ctxFor({ module: "reports", method: "GET" }))).resolves.toBe(true);
    await expect(guard.canActivate(ctxFor({ module: "reports", method: "HEAD" }))).resolves.toBe(true);
  });

  it("refuses every write method with MODULE_READ_ONLY", async () => {
    stubStatus("DRAINING");
    const guard = new ModuleGuard(reflector);
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      await expectCode(
        () => guard.canActivate(ctxFor({ module: "reports", method })),
        "MODULE_READ_ONLY",
        403,
      );
    }
  });
});

describe("ModuleGuard - declaration is mandatory", () => {
  it("throws when a route declares no module and is not allowlisted", async () => {
    // architecture §11.3: a route added without a module must fail the request
    // rather than skip the entitlement check.
    await expect(new ModuleGuard(reflector).canActivate(ctxFor({}))).rejects.toThrow(
      /no @Module\(\) declaration/,
    );
  });

  it("throws for @Public() routes? no - public is exempt", async () => {
    // Health/login style routes carry no tenant, so they must not be gated.
    await expect(
      new ModuleGuard(reflector).canActivate(ctxFor({ isPublic: true, tenantId: null })),
    ).resolves.toBe(true);
    expect(withTenantMock).not.toHaveBeenCalled();
  });

  it("skips the entitlement check for an allowlisted controller", async () => {
    await expect(
      new ModuleGuard(reflector).canActivate(ctxFor({ allowlist: true, tenantId: null })),
    ).resolves.toBe(true);
    expect(withTenantMock).not.toHaveBeenCalled();
  });
});

describe("ModuleGuard - platform scope", () => {
  it("lets a platform-scope caller (no tenantId) through, as the console gates itself", async () => {
    // architecture §5.3: break-glass sessions KEEP a tenantId and so are
    // covered by the lookup; a true platform operator has no tenant module to
    // be entitled to.
    await expect(
      new ModuleGuard(reflector).canActivate(ctxFor({ module: "admin", tenantId: null })),
    ).resolves.toBe(true);
    expect(withTenantMock).not.toHaveBeenCalled();
  });

  it("still subjects a break-glass session to its tenant's entitlement set", async () => {
    // tenantId is present (break-glass), so the tenant's modules apply - the
    // platform cannot reach a module the tenant did not buy (§5.3).
    stubStatus(null);
    await expectCode(
      () => new ModuleGuard(reflector).canActivate(ctxFor({ module: "laboratory", tenantId: "t1" })),
      "MODULE_NOT_ENTITLED",
      403,
    );
  });
});

describe("module key catalogue", () => {
  it("declares exactly the ten module keys from architecture §5.3", () => {
    expect([...MODULES]).toEqual([
      "admin",
      "patients",
      "clinical",
      "supply",
      "laboratory",
      "pharmacy",
      "billing",
      "compliance",
      "notifications",
      "reports",
    ]);
  });
});

describe("@Module / @ModuleAllowlist metadata", () => {
  it("attaches the module name to the handler", () => {
    class Ctrl {
      @Module("laboratory")
      verify() {}
    }
    expect(Reflect.getMetadata(MODULE_KEY, Ctrl.prototype.verify)).toBe("laboratory");
  });

  it("attaches the allowlist flag to the class", () => {
    @ModuleAllowlist()
    class HealthController {}
    expect(Reflect.getMetadata(MODULE_ALLOWLIST_KEY, HealthController)).toBe(true);
  });
});
