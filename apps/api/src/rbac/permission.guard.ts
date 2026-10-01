import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { FastifyRequest } from "fastify";
import { ProblemException } from "../http/problem.exception.js";
import { IS_PUBLIC_KEY, type AuthContext, type RequestWithAuth } from "../auth/auth-context.js";
import { RbacService } from "./rbac.service.js";
import { REQUIRED_PERMISSION_KEY } from "./require-permission.decorator.js";

/**
 * Sentinel membership meaning "holds every permission". Reserved for
 * platform-scope callers, which have no tenant `user_roles` rows to read.
 * Never grantable through a role: `specification` §2.3 forbids wildcards at
 * grant time, and `RoleCreateSchema` only accepts catalogue codes.
 */
const ALL_PERMISSIONS = "*";

/**
 * Permission guard (todo 1.3, architecture §11.3) — the LAST APP_GUARD.
 * Loads the caller's effective permission set once per request (cached on
 * `request.authPermissions`) and checks the route's `@RequirePermission`.
 *
 * Sources by auth kind:
 *  - interactive user → user_roles ⋈ role_permissions (RLS tenant context)
 *  - api key          → the key's `scopes` array
 *  - platform scope   → allow; platform surfaces gate themselves (and every
 *    action lands in the audit log in 1.4)
 *
 * Order note: registered AFTER StepUpGuard. In 1.6 the module guard slots
 * in BEFORE this one (auth → tenant → step-up → module → permission), so a
 * tenant without a module entitlement never reaches permission checks.
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  // Explicit @Inject: esbuild (tsx) does not emit design:paramtypes metadata.
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(RbacService) private readonly rbac: RbacService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const required = this.reflector.getAllAndOverride<string>(REQUIRED_PERMISSION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    // Routes without @RequirePermission only require authentication.
    if (!required) return true;

    const request = context.switchToHttp().getRequest<
      FastifyRequest & RequestWithAuth & { authPermissions?: ReadonlySet<string> }
    >();
    const auth: AuthContext | undefined = request.authContext;
    if (!auth) throw new ProblemException("FORBIDDEN");

    const permissions =
      request.authPermissions ??
      (request.authPermissions = await this.effectivePermissions(auth));

    // Platform-scope callers carry no tenant role rows, so their set is the
    // ALL_PERMISSIONS sentinel. It must be matched explicitly: `has(required)`
    // would never match the bare string "*" and would deny every platform call.
    if (!permissions.has(ALL_PERMISSIONS) && !permissions.has(required)) {
      throw new ProblemException("FORBIDDEN", {
        detail: `missing permission: ${required}`,
      });
    }
    return true;
  }

  private async effectivePermissions(auth: AuthContext): Promise<ReadonlySet<string>> {
    if (auth.kind === "apikey") return new Set(auth.scopes);
    // Platform-scope bearer tokens (console staff) pass; break-glass writes
    // are audited (1.4) and the console UI enforces its own menu gating.
    if (auth.tenantId === null) return new Set([ALL_PERMISSIONS]);
    return this.rbac.effectivePermissionSet({ tenantId: auth.tenantId, userId: auth.userId });
  }
}
