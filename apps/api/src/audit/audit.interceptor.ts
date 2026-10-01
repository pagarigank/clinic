import {
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from "@nestjs/common";
import { createHash } from "node:crypto";
import { Observable } from "rxjs";
import { tap } from "rxjs/operators";
import type { FastifyRequest } from "fastify";
import { getAppPool } from "@clinic/db/src/pool.js";
import type { AuthContext, RequestWithAuth } from "../auth/auth-context.js";
import { redact } from "../observability/logger.js";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Intercepts all mutations (POST, PUT, PATCH, DELETE) and writes an audit log
 * with hash chaining (todo 1.4, AC-14) and sensitive data redaction.
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
        if (!auth) return; // Unauthenticated mutation (e.g. login attempt)

        const tenantId = auth.tenantId;
        if (!tenantId || !UUID_REGEX.test(tenantId)) return; // audit_log requires a valid tenant FK

        const actorId = auth.userId && UUID_REGEX.test(auth.userId) ? auth.userId : null;
        const ip = request.ip;
        const userAgent = (request.headers["user-agent"] as string) ?? null;
        const requestId = request.id;
        const routePath = request.routeOptions?.url ?? request.url;

        const action = `${method} ${routePath}`;
        
        let entityId = "00000000-0000-0000-0000-000000000000";
        if (responseBody && typeof responseBody === "object" && responseBody.id && typeof responseBody.id === "string" && UUID_REGEX.test(responseBody.id)) {
          entityId = responseBody.id;
        } else if (request.params && (request.params as any).id && typeof (request.params as any).id === "string" && UUID_REGEX.test((request.params as any).id)) {
          entityId = (request.params as any).id;
        }

        const entityType = routePath.split("/").filter(Boolean)[0] || "system";
        const breakglassId = auth.breakglassId && UUID_REGEX.test(auth.breakglassId) ? auth.breakglassId : null;
        const actingAsPlatform = breakglassId !== null;

        const pool = getAppPool();
        try {
          // 1. Fetch previous hash for this tenant (hash-chaining per AC-14)
          const prevRes = await pool.query<{ row_hash: string | null }>(
            `SELECT row_hash FROM audit_log WHERE tenant_id = $1 ORDER BY created_at DESC, id DESC LIMIT 1`,
            [tenantId],
          );
          const prevHash = prevRes.rows[0]?.row_hash ?? null;

          // 2. Format created_at to calculate reproducible hash
          const nowIso = new Date().toISOString();
          const parts = [
            prevHash ?? "GENESIS",
            tenantId,
            actorId ?? "NULL",
            action,
            entityType,
            entityId,
            nowIso,
          ];
          const rowHash = createHash("sha256").update(parts.join("|")).digest("hex");

          // 3. Mask sensitive request body keys
          const afterState = request.body ? redact(request.body) : {};

          await pool.query(
            `
            INSERT INTO audit_log (
              tenant_id, created_at, actor_id, acting_as_platform, breakglass_id,
              action, entity_type, entity_id,
              request_id, ip_address, user_agent,
              after_state, prev_hash, row_hash
            ) VALUES (
              $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14
            )
            `,
            [
              tenantId,
              nowIso,
              actorId,
              actingAsPlatform,
              breakglassId,
              action,
              entityType,
              entityId,
              requestId,
              ip,
              userAgent,
              JSON.stringify(afterState),
              prevHash,
              rowHash,
            ],
          );
        } catch (e) {
          request.log.error({ err: e }, "Failed to write audit log");
        }
      }),
    );
  }
}
