import {
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Observable } from "rxjs";
import { tap } from "rxjs/operators";
import type { FastifyRequest } from "fastify";
import { getAppPool } from "@clinic/db/src/pool.js";
import type { AuthContext, RequestWithAuth } from "../auth/auth-context.js";
import { PHI_ACCESS_KEY, type PhiAccessOptions } from "./phi-access.decorator.js";

/**
 * Intercepts GET requests marked with @PhiAccess and logs them to phi_access_log.
 */
@Injectable()
export class PhiAccessInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const options = this.reflector.get<PhiAccessOptions>(
      PHI_ACCESS_KEY,
      context.getHandler()
    );

    // Only intercept if decorated with @PhiAccess
    if (!options) {
      return next.handle();
    }

    const ctx = context.switchToHttp();
    const request = ctx.getRequest<FastifyRequest & RequestWithAuth>();

    return next.handle().pipe(
      tap(async (responseBody) => {
        const auth: AuthContext | undefined = request.authContext;
        if (!auth) return;

        const tenantId = auth.tenantId;
        const actorId = auth.userId ?? null;
        const ip = request.ip;
        const userAgent = request.headers["user-agent"] ?? null;
        const requestId = request.id;
        
        // Extract patientId
        const paramName = options.patientIdParam ?? "patientId";
        let patientId = (request.params as any)?.[paramName];
        
        if (!patientId && responseBody && responseBody.patientId) {
          patientId = responseBody.patientId;
        }

        if (!patientId) {
          // If we still can't find a patient ID, we can't log PHI access effectively.
          return;
        }

        // For GETs, purpose is often just reading, but could be passed in headers or inferred.
        const purpose = (request.headers["x-access-purpose"] as string) ?? "view_record";

        const pool = getAppPool();
        try {
          await pool.query(
            `
            INSERT INTO phi_access_log (
              tenant_id, actor_id, patient_id, resource, purpose,
              request_id, ip_address, user_agent
            ) VALUES (
              $1, $2, $3, $4, $5, $6, $7, $8
            )
            `,
            [
              tenantId,
              actorId,
              patientId,
              options.resource,
              purpose,
              requestId,
              ip,
              userAgent,
            ]
          );
        } catch (e) {
          request.log.error({ err: e }, "Failed to write phi_access_log");
        }
      })
    );
  }
}
