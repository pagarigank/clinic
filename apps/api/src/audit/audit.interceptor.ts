import {
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from "@nestjs/common";
import { Observable } from "rxjs";
import { tap } from "rxjs/operators";
import type { FastifyRequest } from "fastify";
import { getAppPool } from "@clinic/db/src/pool.js";
import type { AuthContext, RequestWithAuth } from "../auth/auth-context.js";

/**
 * Intercepts all mutations (POST, PUT, PATCH, DELETE) and writes an audit log.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const ctx = context.switchToHttp();
    const request = ctx.getRequest<FastifyRequest & RequestWithAuth>();
    const method = request.method.toUpperCase();

    // Only intercept mutations
    if (method === "GET" || method === "OPTIONS" || method === "HEAD") {
      return next.handle();
    }

    return next.handle().pipe(
      tap(async (responseBody) => {
        const auth: AuthContext | undefined = request.authContext;
        if (!auth) return; // Unauthenticated mutation? (e.g. login)

        const tenantId = auth.tenantId;
        const actorId = auth.userId ?? null; // System/API keys might not have a user
        const ip = request.ip;
        const userAgent = request.headers["user-agent"] ?? null;
        const requestId = request.id;
        const routePath = request.routeOptions?.url ?? request.url;

        // Determine action based on route path and method
        const action = `${method} ${routePath}`;
        
        // Try to infer entityId from params or response
        let entityId = null;
        if (responseBody && typeof responseBody === "object" && responseBody.id) {
          entityId = responseBody.id;
        } else if (request.params && (request.params as any).id) {
          entityId = (request.params as any).id;
        }

        const entityType = routePath.split("/").filter(Boolean)[0] || "system";
        const breakglassId = null; // not implemented in AuthContext yet
        const actingAsPlatform = tenantId === null || breakglassId !== null;

        // Perform the audit log insert out-of-band using the app pool
        const pool = getAppPool();
        try {
          await pool.query(
            `
            INSERT INTO audit_log (
              tenant_id, actor_id, acting_as_platform, breakglass_id,
              action, entity_type, entity_id,
              request_id, ip_address, user_agent,
              after
            ) VALUES (
              $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11
            )
            `,
            [
              tenantId,
              actorId,
              actingAsPlatform,
              breakglassId,
              action,
              entityType,
              entityId ?? "00000000-0000-0000-0000-000000000000",
              requestId,
              ip,
              userAgent,
              JSON.stringify(request.body ?? {}), // store request body as 'after' state for now
            ]
          );
        } catch (e) {
          request.log.error({ err: e }, "Failed to write audit log");
        }
      })
    );
  }
}
