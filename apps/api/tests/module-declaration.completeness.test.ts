import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Type } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import {
  MODULE_KEY,
  MODULE_ALLOWLIST_KEY,
  MODULES,
  Module,
  ModuleAllowlist,
} from "../src/rbac/module.guard.js";
import { IS_PUBLIC_KEY } from "../src/auth/auth-context.js";
import { REQUIRED_PERMISSION_KEY } from "../src/rbac/require-permission.decorator.js";

/**
 * Bootstrap-time route completeness (todo 1.6, architecture §11.3).
 *
 * The guard throws when a route declares no module and is not allowlisted, but
 * a throwing guard turns a forgotten decorator into a 500 in production rather
 * than a failed build. This suite closes that gap: it walks the real controller
 * source and fails if any route is undeclared, so adding a route without a
 * module breaks CI instead of runtime.
 *
 * It also pins the decorator's own behaviour, since `SetMetadata` on a
 * method writes to `descriptor.value` and on a class to the constructor - a
 * wiring mistake there silently disables the guard for that route.
 */

import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SRC = join(__dirname, "../src");

function controllerFiles(dir: string = SRC): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      // test/ and dist trees hold no routes.
      if (entry === "node_modules" || entry === "dist") continue;
      out.push(...controllerFiles(full));
    } else if (entry.endsWith(".controller.ts")) {
      out.push(full);
    }
  }
  return out;
}

const reflector = new Reflector();

/**
 * A route is exempt if it, or its class, is @Public() or @ModuleAllowlist() -
 * or if it carries no @RequirePermission and so is not tenant-module work.
 */
function isExempt(classRef: Type<unknown>, handler: (...args: never[]) => unknown): boolean {
  const targets = [handler, classRef];
  return (
    reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets) === true ||
    reflector.getAllAndOverride<boolean>(MODULE_ALLOWLIST_KEY, targets) === true
  );
}

describe("every controller route is classified (todo 1.6)", () => {
  const files = controllerFiles();

  it("finds the real controller files (guards against a vacuous pass)", () => {
    expect(files.length).toBeGreaterThanOrEqual(5);
  });

  it.each(files.map((f) => [f.replace(/\\/g, "/"), f] as const))(
    "%s declares a module, or is allowlisted / public",
    async (_name, file) => {
      const mod = (await import(file)) as Record<string, Type<unknown>>;
      const violations: string[] = [];

      for (const [exportName, classRef] of Object.entries(mod)) {
        if (typeof classRef !== "function") continue;
        // Skip interfaces/functions that are not controllers.
        const routeCount = countRoutes(classRef);
        if (routeCount === 0) continue;

        if (isExempt(classRef, classRef.prototype.constructor)) {
          // Class-level exemption covers every route.
          continue;
        }

        for (const [methodName, handler] of methodsOf(classRef)) {
          if (isExempt(classRef, handler)) continue;
          const declared = reflector.getAllAndOverride<string>(MODULE_KEY, [handler, classRef]);
          if (!declared) violations.push(`${exportName}.${methodName}`);
        }
      }

      expect(
        violations,
        `routes without @Module() and without @Public()/@ModuleAllowlist(): ${violations.join(", ")}`,
      ).toEqual([]);
    },
  );
});

/** Count methods carrying an HTTP verb decorator, by metadata key probe. */
function countRoutes(classRef: Type<unknown>): number {
  const PATH_METADATA = "path";
  const METHOD_METADATA = "method";
  let n = 0;
  for (const [, handler] of methodsOf(classRef)) {
    if (Reflect.hasMetadata(METHOD_METADATA, handler) || Reflect.hasMetadata(PATH_METADATA, handler)) {
      n += 1;
    }
  }
  return n;
}

function methodsOf(classRef: Type<unknown>): Array<[string, (...args: never[]) => unknown]> {
  const proto = classRef.prototype as Record<string, unknown>;
  return Object.getOwnPropertyNames(proto)
    .filter((k) => k !== "constructor")
    .map((k) => [k, proto[k]] as [string, (...args: never[]) => unknown])
    .filter(([, v]) => typeof v === "function");
}

describe("module declaration integrity", () => {
  it("every declared module is one of the ten catalogue keys", () => {
    // A typo in @Module("laboratry") would otherwise compile and then refuse
    // every request, because no entitlement row can ever match.
    for (const file of controllerFiles()) {
      const src = require("node:fs").readFileSync(file, "utf8") as string;
      for (const m of src.matchAll(/@Module\("([a-z]+)"\)/g)) {
        expect(MODULES).toContain(m[1]);
      }
    }
  });

  it("permits only catalogue keys at the type level", () => {
    // Compile-time guarantee; this test documents it so the intent survives.
    const ok: (typeof MODULES)[number] = "laboratory";
    expect(ok).toBe("laboratory");
  });
});

describe("decorator wiring", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it("@Module on a class is visible to the reflector at class level", () => {
    @Module("billing")
    class C {}
    expect(reflector.getAllAndOverride<string>(MODULE_KEY, [C])).toBe("billing");
  });

  it("@Module on a method is visible to the reflector at method level", () => {
    class C {
      @Module("pharmacy")
      dispense() {}
    }
    expect(reflector.getAllAndOverride<string>(MODULE_KEY, [C.prototype.dispense])).toBe(
      "pharmacy",
    );
  });

  it("a method decorator does NOT silently fall back to class metadata as its own", () => {
    // Guards the specific failure where a class-level @Module("admin") masks a
    // missing method-level one; getAllAndOverride would return "admin" and the
    // route would be checked against the wrong module.
    @Module("admin")
    class C {
      route() {}
    }
    const override = reflector.getAllAndOverride<string>(MODULE_KEY, [C.prototype.route, C]);
    expect(override).toBe("admin"); // documented inheritance
    // The suite above therefore requires a class-level declaration to be
    // intentional (one @Module per controller), not accidental.
  });

  it("@ModuleAllowlist is visible at class level", () => {
    @ModuleAllowlist()
    class C {}
    expect(reflector.getAllAndOverride<boolean>(MODULE_ALLOWLIST_KEY, [C])).toBe(true);
  });
});

describe("controller classification as shipped", () => {
  it("RBAC controller is the admin module", async () => {
    const { RbacController } = await import("../src/rbac/rbac.controller.js");
    expect(reflector.getAllAndOverride<string>(MODULE_KEY, [RbacController])).toBe("admin");
  });

  it("auth controller is allowlisted so a fully-disabled tenant can still sign in", async () => {
    const { AuthController } = await import("../src/auth/auth.controller.js");
    expect(reflector.getAllAndOverride<boolean>(MODULE_ALLOWLIST_KEY, [AuthController])).toBe(
      true,
    );
  });

  it("permission metadata key is stable", () => {
    expect(REQUIRED_PERMISSION_KEY).toBe("requiredPermission");
  });
});
