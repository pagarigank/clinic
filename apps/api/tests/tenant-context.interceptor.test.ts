import { describe, expect, it, vi } from "vitest";
import type { CallHandler, ExecutionContext } from "@nestjs/common";
import { HttpException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { of, firstValueFrom, throwError } from "rxjs";
import { noteTenantTransaction } from "@clinic/db";
import { TenantContextInterceptor } from "../src/auth/tenant-context.interceptor.js";

/**
 * todo 1.1 — the interceptor must make a forgotten `withTenant()` *loud*
 * (TENANT_CONTEXT_MISSING) instead of letting RLS quietly return zero rows
 * (specification AC-2). It must not, however, police @Public routes or
 * platform-scope callers, which legitimately run outside a tenant transaction.
 */

const TENANT_A = "11111111-1111-4111-8111-111111111111";

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

/** Handler that mimics a service which correctly wrapped its work in withTenant. */
function handlerUsingTenant(payload: unknown = { ok: true }): CallHandler {
  return {
    handle: () =>
      of(
        (async () => {
          await Promise.resolve();
          noteTenantTransaction(TENANT_A);
          return payload;
        })(),
      ),
  } as unknown as CallHandler;
}

/** Handler that forgot to open a transaction. */
function handlerWithoutTenant(payload: unknown = { ok: true }): CallHandler {
  return {
    handle: () => of(Promise.resolve(payload)),
  } as unknown as CallHandler;
}

function tenantRequest(): Record<string, unknown> {
  return { authContext: { kind: "user", tenantId: TENANT_A, userId: "u" } };
}

async function problemFrom(promise: Promise<unknown>) {
  const err = (await promise.then(
    () => null,
    (e) => e,
  )) as HttpException | null;
  expect(err).toBeInstanceOf(HttpException);
  return { body: err?.getResponse() as { code?: string; detail?: string }, status: err?.getStatus() };
}

describe("TenantContextInterceptor (todo 1.1)", () => {
  it("passes a tenant-scoped response through when the service used withTenant", async () => {
    const interceptor = new TenantContextInterceptor(reflectorReturning(false));
    const next = handlerUsingTenant({ patients: [] });

    await expect(firstValueFrom(interceptor.intercept(ctxFor(tenantRequest()), next))).resolves.toEqual({
      patients: [],
    });
  });

  it("fails loudly with TENANT_CONTEXT_MISSING when no transaction was opened", async () => {
    const interceptor = new TenantContextInterceptor(reflectorReturning(false));

    const { body, status } = await problemFrom(
      firstValueFrom(interceptor.intercept(ctxFor(tenantRequest()), handlerWithoutTenant())),
    );
    expect(body.code).toBe("TENANT_CONTEXT_MISSING");
    expect(body.detail).toMatch(/must read and write inside withTenant/);
    expect(status).toBe(400);
  });

  it("does not police @Public routes (login, health, ping, metrics)", async () => {
    const interceptor = new TenantContextInterceptor(reflectorReturning(true));
    // Even when a token *is* present, @Public routes are not policed.
    const req = { authContext: { kind: "user", tenantId: TENANT_A, userId: "u" } };

    await expect(
      firstValueFrom(interceptor.intercept(ctxFor(req), handlerWithoutTenant())),
    ).resolves.toEqual({ ok: true });
  });

  it("does not police platform-scope callers, who have no tenant", async () => {
    const interceptor = new TenantContextInterceptor(reflectorReturning(false));
    const req = { authContext: { kind: "user", tenantId: null, userId: "root" } };

    await expect(firstValueFrom(interceptor.intercept(ctxFor(req), handlerWithoutTenant()))).resolves.toEqual(
      { ok: true },
    );
  });

  it("does not police unauthenticated requests", async () => {
    const interceptor = new TenantContextInterceptor(reflectorReturning(false));

    await expect(
      firstValueFrom(interceptor.intercept(ctxFor({ headers: {} }), handlerWithoutTenant())),
    ).resolves.toEqual({ ok: true });
  });

  it("propagates a handler error unchanged and does not mask it with a scope error", async () => {
    const interceptor = new TenantContextInterceptor(reflectorReturning(false));
    const next = {
      handle: () => throwError(() => new HttpException("downstream failed", 502)),
    } as unknown as CallHandler;

    const err = await interceptor
      .intercept(ctxFor(tenantRequest()), next)
      .pipe()
      .toPromise()
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect((err as HttpException).getStatus()).toBe(502);
  });

  it("accepts a service that runs several transactions in one request", async () => {
    const interceptor = new TenantContextInterceptor(reflectorReturning(false));
    const next = {
      handle: () =>
        of(
          (async () => {
            noteTenantTransaction(TENANT_A);
            noteTenantTransaction(TENANT_A);
            return { writes: 2 };
          })(),
        ),
    } as unknown as CallHandler;

    await expect(firstValueFrom(interceptor.intercept(ctxFor(tenantRequest()), next))).resolves.toEqual({
      writes: 2,
    });
  });

  it("surfaces a cross-tenant transaction as a server error rather than bad data", async () => {
    const interceptor = new TenantContextInterceptor(reflectorReturning(false));
    const next = {
      handle: () =>
        of(
          (async () => {
            noteTenantTransaction("22222222-2222-4222-8222-222222222222");
            return { leaked: true };
          })(),
        ),
    } as unknown as CallHandler;

    const err = await firstValueFrom(interceptor.intercept(ctxFor(tenantRequest()), next)).catch(
      (e: unknown) => e,
    );
    expect(String(err)).toMatch(/cross-tenant/);
    expect(vi.isMockFunction(Reflector)).toBe(false);
  });
});
