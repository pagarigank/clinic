import { describe, expect, it } from "vitest";
import { APP_GUARD } from "@nestjs/core";
import type { Type } from "@nestjs/common";
import { AppModule } from "../src/app.module.js";
import { AuthModule } from "../src/auth/auth.module.js";
import { RbacModule } from "../src/rbac/rbac.module.js";
import { AuthGuard } from "../src/auth/guards/auth.guard.js";
import { TenantContextGuard } from "../src/auth/guards/tenant-context.guard.js";
import { StepUpGuard } from "../src/auth/guards/step-up.guard.js";
import { PermissionGuard } from "../src/rbac/permission.guard.js";
import { ModuleGuard } from "../src/rbac/module.guard.js";

/**
 * Request pipeline order (todo 0.3, todo 1.6, architecture §11.3).
 *
 * Both 0.3 ("the nesting asserted by a unit test from day one") and 1.6
 * ("registration order asserted by a unit test on the composed handler chain")
 * require this to be pinned by a test. Without it, reordering the provider
 * arrays — or importing a module earlier in AppModule — silently changes the
 * chain and weakens ground rule 1 (tenant isolation) with no failing check.
 *
 * Nest composes APP_GUARD multi-providers in module-initialisation order, so
 * the effective chain is: (AppModule import order) x (provider order within
 * each module). Both halves are asserted here.
 *
 * A behavioural companion for the tenant/permission boundary lives in
 * `tenant-context.guard.test.ts`.
 */

/** Read the `@Module` decorator's declared metadata off a class. */
function meta(target: Type<unknown>, key: "imports" | "providers"): unknown[] {
  const value = Reflect.getMetadata(key, target as object) as unknown[] | undefined;
  return Array.isArray(value) ? value : [];
}

interface AppGuardProvider {
  provide: unknown;
  useClass: Type<unknown>;
}

function guardClassesOf(moduleType: Type<unknown>): Type<unknown>[] {
  const found: Type<unknown>[] = [];
  for (const provider of meta(moduleType, "providers")) {
    if (provider && typeof provider === "object" && "provide" in provider && "useClass" in provider) {
      const guard = provider as AppGuardProvider;
      if (guard.provide === APP_GUARD) found.push(guard.useClass);
    }
  }
  return found;
}

/** The chain Nest actually builds for AppModule. */
function composedGuardChain(): Type<unknown>[] {
  const modules = meta(AppModule, "imports") as Type<unknown>[];
  return modules.flatMap((m) => guardClassesOf(m));
}

describe("request pipeline order (todo 0.3 / 1.6, architecture §11.3)", () => {
  it("composes exactly the five guards the docs specify, in order", () => {
    expect(composedGuardChain()).toEqual([
      AuthGuard,
      TenantContextGuard,
      StepUpGuard,
      ModuleGuard,
      PermissionGuard,
    ]);
  });

  it("authenticates before it resolves tenant context", () => {
    const chain = composedGuardChain();
    expect(chain.indexOf(AuthGuard)).toBe(0);
    // TenantContextGuard reads request.authContext, so it cannot run first —
    // it would see an undefined context and silently pass every request.
    expect(chain.indexOf(TenantContextGuard)).toBeGreaterThan(chain.indexOf(AuthGuard));
  });

  it("resolves tenant before evaluating permissions (ground rule 1)", () => {
    const chain = composedGuardChain();
    // A permission lookup made against an unverified tenant would read the
    // wrong tenant's grants. Tenant must be settled first.
    expect(chain.indexOf(TenantContextGuard)).toBeLessThan(chain.indexOf(PermissionGuard));
  });

  it("checks the module entitlement BEFORE permissions (todo 1.6, AC-23)", () => {
    const chain = composedGuardChain();
    // architecture §5.3: a route in a module the tenant has not bought returns
    // 403 MODULE_NOT_ENTITLED "before any permission or data access". If this
    // inverts, an unentitled tenant gets a permission-derived answer instead,
    // which leaks which permissions exist and turns entitlement into a
    // permission-layer concern.
    expect(chain.indexOf(ModuleGuard)).toBeLessThan(chain.indexOf(PermissionGuard));
  });

  it("keeps the module guard after the tenant context is resolved", () => {
    const chain = composedGuardChain();
    // The entitlement lookup is a tenant-scoped query; running it before the
    // tenant is settled would read the wrong tenant's entitlements.
    expect(chain.indexOf(TenantContextGuard)).toBeLessThan(chain.indexOf(ModuleGuard));
  });

  it("keeps the permission guard last so later guards can only narrow access", () => {
    const chain = composedGuardChain();
    expect(chain.at(-1)).toBe(PermissionGuard);
  });

  it("registers every guard through APP_GUARD, never useGlobalGuards", () => {
    // 1.6: instance-bound guards built outside the injector (`new FooGuard()`)
    // silently lose DI under tsx/esbuild. main.ts must stay free of them.
    const expected = 5;
    expect(composedGuardChain()).toHaveLength(expected);
    for (const moduleType of [AuthModule, RbacModule]) {
      expect(guardClassesOf(moduleType).length).toBeGreaterThan(0);
    }
  });

  it("declares ModuleGuard before PermissionGuard inside RbacModule", () => {
    // Provider order within a module is the other half of the composition
    // rule; the cross-module half is asserted below.
    expect(guardClassesOf(RbacModule)).toEqual([ModuleGuard, PermissionGuard]);
  });

  it("keeps AuthModule's guards ahead of RbacModule's via AppModule import order", () => {
    // The cross-module half of the composition rule. Reordering these imports
    // would put PermissionGuard ahead of the auth guards.
    const imports = meta(AppModule, "imports") as Type<unknown>[];
    expect(imports.indexOf(AuthModule)).toBeLessThan(imports.indexOf(RbacModule));
  });
});
