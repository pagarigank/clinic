import { describe, expect, it } from "vitest";
import "reflect-metadata";
import { APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core";
import { AppModule } from "../src/app.module.js";
import { AuthModule } from "../src/auth/auth.module.js";
import { TenantContextInterceptor } from "../src/auth/tenant-context.interceptor.js";
import { AuthGuard } from "../src/auth/guards/auth.guard.js";
import { TenantContextGuard } from "../src/auth/guards/tenant-context.guard.js";
import { StepUpGuard } from "../src/auth/guards/step-up.guard.js";

/**
 * todo 1.1 — the interceptor is registered for real, so a tenant-scoped route
 * whose service forgot `withTenant()` fails loudly instead of returning zero
 * rows. Read off the module metadata, so a provider that is declared but never
 * wired fails here rather than in production.
 *
 * Metadata rather than a live DI container: booting the graph needs a reachable
 * database and a full env, and `@nestjs/testing` is deliberately not a
 * dependency of this package. The metadata is the source of truth Nest itself
 * reads, so this still catches a mis-ordered or missing registration.
 *
 * Guard order is the thing architecture §11.3 says must be "asserted by a unit
 * test, not by a comment" — pipeline-order.test.ts covers composition, this
 * covers what each module actually registers.
 */

/** Providers a module contributes to the global chain, in registration order. */
function globalProvidersOf(moduleRef: unknown, token: unknown): { useClass?: unknown }[] {
  const providers = Reflect.getMetadata("providers", moduleRef as object) as unknown[] | undefined;
  return (providers ?? []).filter(
    (p): p is { provide: unknown; useClass?: unknown } =>
      typeof p === "object" &&
      p !== null &&
      "provide" in p &&
      (p as { provide: unknown }).provide === token,
  );
}

describe("AuthModule global providers (todo 1.1)", () => {
  it("registers the tenant-context verifier as an APP_INTERCEPTOR", () => {
    const interceptors = globalProvidersOf(AuthModule, APP_INTERCEPTOR);
    expect(interceptors).toHaveLength(1);
    expect(interceptors[0]?.useClass).toBe(TenantContextInterceptor);
  });

  it("keeps AuthGuard → TenantContextGuard → StepUpGuard in §11.3 order", () => {
    const guards = globalProvidersOf(AuthModule, APP_GUARD).map((p) => p.useClass);
    expect(guards).toEqual([AuthGuard, TenantContextGuard, StepUpGuard]);
  });

  it("registers guards and the interceptor through DI tokens, never useGlobalGuards", () => {
    // An instance-bound guard (useGlobalGuards(new XGuard())) is built outside
    // the injector and silently loses DI — the trap todo 1.6 calls out. Every
    // entry here is a { provide, useClass } pair, so Nest builds it.
    const entries = [
      ...globalProvidersOf(AuthModule, APP_GUARD),
      ...globalProvidersOf(AuthModule, APP_INTERCEPTOR),
    ];
    expect(entries.length).toBe(4);
    for (const entry of entries) {
      expect(entry.useClass).toBeTypeOf("function");
    }
  });
});

describe("AppModule composition (todo 1.1)", () => {
  it("imports the auth module that carries the interceptor", () => {
    const imports = Reflect.getMetadata("imports", AppModule) as unknown[] | undefined;
    expect(imports ?? []).toContain(AuthModule);
  });
});
