import { type CanActivate, type ExecutionContext, Inject, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { FastifyRequest } from "fastify";
import { ProblemException } from "../../http/problem.exception.js";
import { IS_PUBLIC_KEY, type RequestWithAuth } from "../auth-context.js";
import { slugFromHost, TenantResolverService } from "../tenant-resolver.service.js";

/**
 * Tenant context guard (todo 1.1 deferred item, architecture §5.6/§11.3):
 * runs AFTER AuthGuard. Cross-checks the request's declared tenant
 * (subdomain or `X-Tenant` header, either a slug or a tenant id) against the
 * authenticated tenant from the token/API key → `403 TENANT_MISMATCH` on
 * disagreement. Unauthenticated (@Public) routes resolve their own tenant
 * inside the login flow.
 */
@Injectable()
export class TenantContextGuard implements CanActivate {
  // Explicit @Inject: esbuild (tsx) does not emit design:paramtypes metadata.
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(TenantResolverService) private readonly resolver: TenantResolverService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<
      FastifyRequest & RequestWithAuth
    >();
    const auth = request.authContext;
    if (!auth?.tenantId) return true; // platform-scope routes

    const headerTenant = request.headers["x-tenant"];
    const declared = (
      Array.isArray(headerTenant) ? headerTenant[0] : headerTenant
    ) ?? slugFromHost(request.hostname);
    if (!declared) {
      request.tenantId = auth.tenantId;
      return true;
    }

    const declaredId = isUuid(declared)
      ? declared.toLowerCase()
      : ((await this.resolver.resolveBySlug(declared))?.id ?? declared.toLowerCase());
    if (declaredId !== auth.tenantId.toLowerCase()) {
      throw new ProblemException("TENANT_MISMATCH", {
        detail: "request tenant does not match the authenticated tenant",
      });
    }

    request.tenantId = auth.tenantId;
    return true;
  }
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
