import { describe, expect, it } from "vitest";
import type { ExecutionContext } from "@nestjs/common";
import { HttpException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { TenantContextGuard } from "../src/auth/guards/tenant-context.guard.js";
import { TenantResolverService } from "../src/auth/tenant-resolver.service.js";
import type { RequestWithAuth } from "../src/auth/auth-context.js";

/**
 * Behavioural half of the pipeline-order assertion (see pipeline-order.test.ts).
 * Confirms TenantContextGuard actually enforces the boundary it is responsible
 * for, so a cross-tenant request is refused before any permission lookup —
 * ground rule 1 (todo §49) and 403 TENANT_MISMATCH.
 */

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";

function ctxFor(req: Record<string, unknown>): ExecutionContext {
  return {
    getHandler: () => function handler() {},
    getClass: () => class Controller {},
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

function reflectorReturning(isPublic: boolean): Reflector {
  return { getAllAndOverride: () => isPublic } as unknown as Reflector;
}

/** Resolver that knows both tenants, so slug resolution is exercised. */
function resolver(): TenantResolverService {
  return {
    resolveBySlug: async (slug: string) =>
      slug === "tenant-a" ? { id: TENANT_A } : slug === "tenant-b" ? { id: TENANT_B } : null,
  } as unknown as TenantResolverService;
}

/** Assert an RFC 9457 problem carrying `code` at the given HTTP status. */
async function expectProblem(promise: Promise<unknown>, code: string, status: number) {
  const err = (await promise.then(
    () => null,
    (e) => e,
  )) as HttpException | null;
  expect(err, `expected ${code} to be thrown`).toBeInstanceOf(HttpException);
  const body = err?.getResponse() as { code?: string };
  expect(body?.code).toBe(code);
  expect(err?.getStatus()).toBe(status);
}

describe("TenantContextGuard (todo 1.1, architecture §5.6/§11.3)", () => {
  it("rejects a token whose tenant disagrees with the declared X-Tenant", async () => {
    const guard = new TenantContextGuard(reflectorReturning(false), resolver());
    const req = {
      authContext: { tenantId: TENANT_A },
      headers: { "x-tenant": TENANT_B },
      hostname: "tenant-a.localhost",
    };

    await expectProblem(guard.canActivate(ctxFor(req)), "TENANT_MISMATCH", 403);
  });

  it("rejects a slug that resolves to a different tenant than the token", async () => {
    const guard = new TenantContextGuard(reflectorReturning(false), resolver());
    const req = { authContext: { tenantId: TENANT_A }, headers: {}, hostname: "tenant-b.localhost" };

    await expectProblem(guard.canActivate(ctxFor(req)), "TENANT_MISMATCH", 403);
  });

  it("accepts a matching tenant and pins request.tenantId", async () => {
    const guard = new TenantContextGuard(reflectorReturning(false), resolver());
    const req: Record<string, unknown> = {
      authContext: { tenantId: TENANT_A },
      headers: {},
      hostname: "tenant-a.localhost",
    };

    await expect(guard.canActivate(ctxFor(req))).resolves.toBe(true);
    expect(req.tenantId).toBe(TENANT_A);
  });

  it("compares tenant ids case-insensitively (uuid case must not decide access)", async () => {
    const guard = new TenantContextGuard(reflectorReturning(false), resolver());
    const req = {
      authContext: { tenantId: TENANT_A.toUpperCase() },
      headers: { "x-tenant": TENANT_A },
      hostname: "",
    };

    await expect(guard.canActivate(ctxFor(req))).resolves.toBe(true);
  });

  it("lets @Public routes through without an auth context", async () => {
    const guard = new TenantContextGuard(reflectorReturning(true), resolver());
    await expect(guard.canActivate(ctxFor({ headers: {}, hostname: "" }))).resolves.toBe(true);
  });

  it("passes platform-scope callers (no tenant) through untouched", async () => {
    const guard = new TenantContextGuard(reflectorReturning(false), resolver());
    const req: Record<string, unknown> = { authContext: { scope: "platform" }, headers: {}, hostname: "" };

    await expect(guard.canActivate(ctxFor(req))).resolves.toBe(true);
    expect(req.tenantId).toBeUndefined();
  });

  it("falls back to the token tenant when no tenant is declared", async () => {
    const guard = new TenantContextGuard(reflectorReturning(false), resolver());
    const req: Record<string, unknown> = {
      authContext: { tenantId: TENANT_A } as RequestWithAuth["authContext"],
      headers: {},
      hostname: "localhost",
    };

    await expect(guard.canActivate(ctxFor(req))).resolves.toBe(true);
    expect(req.tenantId).toBe(TENANT_A);
  });
});
