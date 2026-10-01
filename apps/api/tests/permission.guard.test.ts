import { describe, expect, it } from "vitest";
import type { ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { HttpException } from "@nestjs/common";
import { PermissionGuard } from "../src/rbac/permission.guard.js";
import { RbacService } from "../src/rbac/rbac.service.js";
import { RequirePermission } from "../src/rbac/require-permission.decorator.js";
import { Public, type AuthContext, type RequestWithAuth } from "../src/auth/auth-context.js";

/**
 * PermissionGuard behaviour (todo 1.3, architecture §11.3).
 *
 * The registration order is pinned in `pipeline-order.test.ts`. These tests
 * cover what the guard actually DECIDES, which the ordering test cannot see.
 */

function auth(over: Partial<AuthContext> = {}): AuthContext {
  return {
    kind: "user",
    userId: "00000000-0000-4000-8000-0000000000a1",
    tenantId: "00000000-0000-4000-8000-0000000000b1",
    sessionId: "s-1",
    branchId: null,
    amr: ["pwd"],
    scopes: [],
    ...over,
  };
}

function ctxFor(req: unknown, handler: object, controller: object): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => controller,
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

/** A service stub that records the lookups it is asked to perform. */
function svcStub(perms: string[] = []) {
  const calls: Array<{ tenantId: string; userId: string | null }> = [];
  const stub = {
    calls,
    async effectivePermissionSet(ids: { tenantId: string; userId: string | null }) {
      calls.push(ids);
      return new Set(perms);
    },
  };
  return stub as unknown as RbacService & { calls: typeof calls };
}

describe("PermissionGuard", () => {
  class Ctl {
    @RequirePermission("admin.role.read")
    read() {}

    /**
     * A public route that ALSO declares a permission. The bypass must win:
     * without it this route would demand `admin.role.read` from an anonymous
     * caller and 401/403 a genuinely public endpoint.
     */
    @Public()
    @RequirePermission("admin.role.read")
    open() {}

    bare() {}
  }

  const proto = Ctl.prototype as unknown as Record<string, object>;
  const ctl = new Ctl();

  it("grants a route when the caller holds the required permission", async () => {
    const request = { authContext: auth() } as RequestWithAuth;
    const guard = new PermissionGuard(new Reflector(), svcStub(["admin.role.read"]));
    await expect(guard.canActivate(ctxFor(request, proto.read!, ctl))).resolves.toBe(true);
  });

  it("refuses with 403 FORBIDDEN when the permission is absent", async () => {
    const request = { authContext: auth() } as RequestWithAuth;
    // The caller holds a DIFFERENT admin permission, not the required one.
    const guard = new PermissionGuard(new Reflector(), svcStub(["admin.role.create"]));
    const err = await guard.canActivate(ctxFor(request, proto.read!, ctl)).catch((e) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect((err as HttpException).getStatus()).toBe(403);
    expect(JSON.stringify((err as HttpException).getResponse())).toContain("FORBIDDEN");
  });

  it("does not leak the caller's permission set in the error detail", async () => {
    const request = { authContext: auth() } as RequestWithAuth;
    const guard = new PermissionGuard(new Reflector(), svcStub(["admin.role.create"]));
    const err = (await guard.canActivate(ctxFor(request, proto.read!, ctl)).catch((e) => e)) as HttpException;
    const body = JSON.stringify(err.getResponse());
    expect(body).toContain("admin.role.read");
    // The caller must learn which permission was missing, never what they hold.
    expect(body).not.toContain("admin.role.create");
  });

  it("refuses a tenant caller whose role grants nothing", async () => {
    const request = { authContext: auth() } as RequestWithAuth;
    const guard = new PermissionGuard(new Reflector(), svcStub([]));
    await expect(guard.canActivate(ctxFor(request, proto.read!, ctl))).rejects.toBeInstanceOf(HttpException);
  });

  it("resolves the permission set once per request and reuses it", async () => {
    const request = { authContext: auth() } as RequestWithAuth & { authPermissions?: ReadonlySet<string> };
    const stub = svcStub(["admin.role.read"]);
    const guard = new PermissionGuard(new Reflector(), stub);
    await guard.canActivate(ctxFor(request, proto.read!, ctl));
    await guard.canActivate(ctxFor(request, proto.read!, ctl));
    expect(stub.calls).toHaveLength(1);
  });

  it("looks the caller's permissions up under their own tenant only", async () => {
    const request = { authContext: auth({ tenantId: "tenant-x" }) } as RequestWithAuth;
    const stub = svcStub(["admin.role.read"]);
    const guard = new PermissionGuard(new Reflector(), stub);
    await guard.canActivate(ctxFor(request, proto.read!, ctl));
    expect(stub.calls).toEqual([{ tenantId: "tenant-x", userId: "00000000-0000-4000-8000-0000000000a1" }]);
  });

  it("grants @Public routes without touching the permission service", async () => {
    // Anonymous request, and the route demands a permission the caller cannot
    // have. Only the @Public bypass can admit it.
    const request = {} as RequestWithAuth;
    const stub = svcStub([]);
    const guard = new PermissionGuard(new Reflector(), stub);
    await expect(guard.canActivate(ctxFor(request, proto.open!, ctl))).resolves.toBe(true);
    expect(stub.calls).toHaveLength(0);
  });

  it("treats a route with no @RequirePermission as authentication-only", async () => {
    const request = { authContext: auth() } as RequestWithAuth;
    const stub = svcStub([]);
    const guard = new PermissionGuard(new Reflector(), stub);
    await expect(guard.canActivate(ctxFor(request, proto.bare!, ctl))).resolves.toBe(true);
    expect(stub.calls).toHaveLength(0);
  });

  it("refuses rather than silently passing when auth context is missing", async () => {
    const request = {} as RequestWithAuth;
    const guard = new PermissionGuard(new Reflector(), svcStub(["admin.role.read"]));
    await expect(guard.canActivate(ctxFor(request, proto.read!, ctl))).rejects.toBeInstanceOf(HttpException);
  });

  // ---- API keys ---------------------------------------------------------

  it("authorises an API key by its own scopes, never by user roles", async () => {
    const request = {
      authContext: auth({ kind: "apikey", userId: null, scopes: ["admin.role.read"] }),
    } as RequestWithAuth;
    const stub = svcStub([]);
    const guard = new PermissionGuard(new Reflector(), stub);
    await expect(guard.canActivate(ctxFor(request, proto.read!, ctl))).resolves.toBe(true);
    // No tenant role lookup may happen for a key.
    expect(stub.calls).toHaveLength(0);
  });

  it("refuses an API key that lacks the scope", async () => {
    const request = {
      authContext: auth({ kind: "apikey", userId: null, scopes: ["files.read"] }),
    } as RequestWithAuth;
    const guard = new PermissionGuard(new Reflector(), svcStub([]));
    await expect(guard.canActivate(ctxFor(request, proto.read!, ctl))).rejects.toBeInstanceOf(HttpException);
  });

  // ---- platform scope ---------------------------------------------------

  it("admits a platform-scope caller to any permission-gated route", async () => {
    // architecture §10 / specification §223: break-glass platform tokens reach
    // the tenant's routes; the module guard (1.6) narrows them to the tenant's
    // entitlements, and 1.4 audits every action. The permission layer must not
    // be what stops them, or break-glass is unusable.
    const request = { authContext: auth({ tenantId: null, userId: null }) } as RequestWithAuth;
    const stub = svcStub([]);
    const guard = new PermissionGuard(new Reflector(), stub);
    await expect(guard.canActivate(ctxFor(request, proto.read!, ctl))).resolves.toBe(true);
    expect(stub.calls).toHaveLength(0);
  });
});
