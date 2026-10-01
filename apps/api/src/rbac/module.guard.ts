import { Inject, Injectable, Logger, SetMetadata } from "@nestjs/common";
import type { CanActivate, ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { FastifyRequest } from "fastify";
import { withTenant, getAppPool } from "@clinic/db";
import { ProblemException } from "../http/problem.exception.js";
import { IS_PUBLIC_KEY, type AuthContext, type RequestWithAuth } from "../auth/auth-context.js";
import { incCounter } from "../observability/metrics.js";

export const MODULE_KEY = "module";
export const MODULE_ALLOWLIST_KEY = "module:allowlist";

/**
 * The ten module keys (architecture §5.3, specification §4.3 PLT-T7). Kept in
 * code as a closed union so a typo is a compile error, and mirrored by the
 * CHECK constraint on `tenant_modules.module` (migration 0004).
 */
export const MODULES = [
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
] as const;

export type ModuleName = (typeof MODULES)[number];

export type ModuleStatus = "TRIAL" | "ENABLED" | "DRAINING" | "DISABLED";

/**
 * Declares the module a route belongs to (architecture §5.3, §11.3). The global
 * `ModuleGuard` reads this metadata and refuses a tenant that has not bought
 * the module, BEFORE any permission evaluation or data access.
 *
 * ```ts
 * @RequirePermission("laboratory.result.verify")
 * @Module("laboratory")
 * @Post("results/:id/verify")
 * verify() {}
 * ```
 */
export const Module = (module: ModuleName): MethodDecorator & ClassDecorator =>
  SetMetadata(MODULE_KEY, module);

/**
 * Opts a controller OUT of the module guard. Reserved for infrastructure that
 * is not tenant-module work: health, metrics, auth entry points, platform
 * console. Entitlement is a commercial concept, and the platform console is
 * explicitly "never a tenant module" (architecture §5.3).
 */
export const ModuleAllowlist = (): MethodDecorator & ClassDecorator =>
  SetMetadata(MODULE_ALLOWLIST_KEY, true);

interface EntitlementRow {
  status: ModuleStatus;
}

/** Writes are the methods a DRAINING module must refuse (architecture §5.3). */
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Global module-entitlement guard (todo 1.6, architecture §5.3/§11.3,
 * specification AC-23/AC-27). Registered via the `APP_GUARD` token, ordered
 * between `StepUpGuard` and `PermissionGuard`.
 *
 * Properties, in order of blast radius:
 *  1. non-entitled module -> 403 MODULE_NOT_ENTITLED before any permission or
 *     data access, so a user holding every permission still gets 403
 *  2. unreadable entitlement store -> 503 UPSTREAM_UNAVAILABLE. Fail-closed:
 *     it never assumes "entitled" on error (architecture §5.3).
 *  3. DRAINING satisfies reads and refuses writes with 403 MODULE_READ_ONLY
 *  4. a route with neither @Module() nor @ModuleAllowlist() throws, so a
 *     forgotten declaration fails the request instead of skipping the check
 */
@Injectable()
export class ModuleGuard implements CanActivate {
  // Explicit @Inject: esbuild (tsx) does not emit design:paramtypes metadata.
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];

    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) return true;
    if (this.reflector.getAllAndOverride<boolean>(MODULE_ALLOWLIST_KEY, targets)) return true;

    const module = this.reflector.getAllAndOverride<ModuleName>(MODULE_KEY, targets);
    if (!module) {
      // Bootstrap-time guarantee (architecture §11.3): a new route added
      // without a module declaration fails the request rather than leaking a
      // tenant module to any tenant.
      throw new Error(
        `Route ${context.getClass().name}.${String(context.getHandler().name)} carries no ` +
          "@Module() declaration and is not allowlisted. Add @Module('<module>') or " +
          "@ModuleAllowlist() (architecture §11.3).",
      );
    }

    const request = context.switchToHttp().getRequest<FastifyRequest & RequestWithAuth>();
    const auth: AuthContext | undefined = request.authContext;
    if (!auth?.tenantId) {
      // TenantContextGuard runs first, so a missing tenant here means the
      // caller is platform-scoped. The platform console gates itself and is
      // never a tenant module (architecture §5.3: "a break-glass session
      // inherits the tenant's set, so the platform cannot reach a non-entitled
      // module either" - break-glass keeps a tenantId, so it is covered below).
      return true;
    }

    const status = await this.statusOf(auth, module);

    if (status === null || status === "DISABLED") {
      throw new ProblemException("MODULE_NOT_ENTITLED", {
        detail: `module not entitled: ${module}`,
      });
    }

    if (status === "DRAINING" && !SAFE_METHODS.has(request.method.toUpperCase())) {
      throw new ProblemException("MODULE_READ_ONLY", {
        detail: `module ${module} is draining; writes are refused`,
      });
    }

    return true;
  }

  /** Resolve the tenant's status for this module, or null when it has no row. */
  private async statusOf(
    auth: AuthContext,
    module: ModuleName,
  ): Promise<ModuleStatus | null> {
    // 1. If JWT has modules and modulesVersion, we can try to use it.
    // 2. We still need the current modules_version from DB to know if JWT is stale.
    // We cache `modules_version` per tenant for 60s.
    const currentVersion = await this.getTenantModulesVersion(auth.tenantId!);

    // If token has modules and version matches, use it!
    if (auth.modules && auth.modulesVersion === currentVersion) {
      const mod = auth.modules.find(m => m.module === module);
      return mod ? (mod.status as ModuleStatus) : null;
    }

    // Otherwise, fetch from DB and we should return the fresh status.
    // Note: The token is now stale, it will be refreshed by the client eventually,
    // or we evaluate against DB for this request.
    try {
      return await withTenant<ModuleStatus | null>(
        { tenantId: auth.tenantId!, userId: auth.userId ?? undefined },
        async (tx) => {
          const { rows } = await tx.query<EntitlementRow>(
            `SELECT status FROM tenant_modules WHERE tenant_id = $1 AND module = $2`,
            [auth.tenantId, module],
          );
          return rows[0]?.status ?? null;
        },
      );
    } catch (err) {
      incCounter("entitlement_evaluation_failure", { module });
      if (process.env.NODE_ENV !== "test") {
        new Logger(ModuleGuard.name).error(
          "entitlement evaluation failed; refusing request (fail-closed)",
          err instanceof Error ? err.stack : String(err),
        );
      }
      throw new ProblemException("UPSTREAM_UNAVAILABLE", {
        detail: "entitlement store unavailable",
      });
    }
  }

  // Simple in-memory cache for modules_version
  private static versionCache = new Map<string, { version: number; expiresAt: number }>();

  private async getTenantModulesVersion(tenantId: string): Promise<number> {
    const now = Date.now();
    const cached = ModuleGuard.versionCache.get(tenantId);
    if (cached && cached.expiresAt > now) {
      return cached.version;
    }

    try {
      const pool = getAppPool();
      const res = await pool.query('SELECT modules_version FROM tenants WHERE id = $1', [tenantId]);
      if (res.rowCount === 0) {
        throw new Error('TENANT_NOT_FOUND');
      }
      const version = res.rows[0].modules_version;
      // modules_cache_ttl 60 s
      ModuleGuard.versionCache.set(tenantId, { version, expiresAt: now + 60000 });
      return version;
    } catch {
      incCounter("entitlement_evaluation_failure", { module: 'version_check' });
      throw new ProblemException("UPSTREAM_UNAVAILABLE", {
        detail: "entitlement store unavailable",
      });
    }
  }
}

