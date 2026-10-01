import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { FastifyRequest } from "fastify";
import { createHash } from "node:crypto";
import { withTenant } from "@clinic/db";
import { ProblemException } from "../../http/problem.exception.js";
import {
  IS_PUBLIC_KEY,
  type AuthContext,
  type RequestWithAuth,
} from "../auth-context.js";
import { type AccessClaims, type BreakglassClaims, TokenService } from "../crypto/tokens.js";
import { getAppPool } from "@clinic/db";

/**
 * Global authentication guard (APP_GUARD): Bearer access JWT or API key.
 * `@Public()` routes (login, refresh, health, ping, metrics) are exempt.
 * Guard chain order (architecture §11.3): this runs FIRST, before
 * TenantContextGuard → (1.6 module guard) → (1.3 permission guard).
 */
@Injectable()
export class AuthGuard implements CanActivate {
  // Explicit @Inject: esbuild (tsx) does not emit design:paramtypes metadata
  // (same pattern as ping.controller).
  constructor(
    @Inject(TokenService) private readonly tokens: TokenService,
    @Inject(Reflector) private readonly reflector: Reflector,
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
    const header = request.headers.authorization;
    if (!header) throw new ProblemException("INVALID_CREDENTIALS", { detail: "missing bearer token" });

    if (header.startsWith("Bearer ")) {
      const raw = header.slice(7).trim();
      const accessClaims = await this.tokens.verify<AccessClaims>(raw, "access");
      if (accessClaims) {
        request.authContext = {
          kind: "user",
          userId: accessClaims.sub,
          tenantId: accessClaims.tid,
          sessionId: accessClaims.sid,
          branchId: accessClaims.brn,
          amr: accessClaims.amr,
          scopes: [],
          modules: accessClaims.mod,
          modulesVersion: accessClaims.mdv,
        };
        return true;
      }

      const breakglassClaims = await this.tokens.verify<BreakglassClaims>(raw, "breakglass");
      if (breakglassClaims) {
        request.authContext = await this.authenticateBreakglass(breakglassClaims);
        return true;
      }

      throw new ProblemException("INVALID_CREDENTIALS", { detail: "invalid or expired token" });
    }

    if (header.startsWith("ApiKey ")) {
      request.authContext = await this.authenticateApiKey(header.slice(7).trim());
      return true;
    }

    throw new ProblemException("INVALID_CREDENTIALS", { detail: "unsupported authorization scheme" });
  }

  /**
   * Service-account keys (todo 1.2). Wire format `cka_<tenantId>_<secret>`:
   * the tenant id rides in the key so the RLS-scoped lookup in api_keys can
   * run inside that tenant's context; the secret half is stored only as
   * sha-256 (api_keys.key_hash).
   */
  private async authenticateApiKey(raw: string): Promise<AuthContext> {
    const parts = raw.split("_");
    if (parts.length !== 3 || parts[0] !== "cka") {
      throw new ProblemException("INVALID_CREDENTIALS", { detail: "malformed api key" });
    }
    const [, tenantId] = parts as [string, string];
    if (!/^[0-9a-f-]{36}$/.test(tenantId)) {
      throw new ProblemException("INVALID_CREDENTIALS", { detail: "malformed api key" });
    }
    const keyHash = createHash("sha256").update(raw).digest("hex");
    const row = await withTenant({ tenantId }, async (tx) => {
      const result = await tx.query<{
        id: string;
        scopes: string[];
        expires_at: Date | null;
        revoked_at: Date | null;
      }>(
        `UPDATE api_keys SET last_used_at = now()
         WHERE tenant_id = $1 AND key_hash = $2
           AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())
         RETURNING id, scopes::text[] AS scopes, expires_at, revoked_at`,
        [tenantId, keyHash],
      );
      return result.rows[0] ?? null;
    });
    if (!row) {
      throw new ProblemException("INVALID_CREDENTIALS", { detail: "invalid api key" });
    }
    return {
      kind: "apikey",
      userId: null,
      tenantId,
      sessionId: row.id,
      branchId: null,
      amr: ["apikey"],
      scopes: row.scopes ?? [],
    };
  }

  private async authenticateBreakglass(claims: BreakglassClaims): Promise<AuthContext> {
    const pool = getAppPool();
    const result = await pool.query(
      `SELECT tenant_id, platform_user_id
       FROM breakglass_sessions
       WHERE id = $1 AND ended_at IS NULL AND expires_at > now()`,
      [claims.bgl],
    );
    if ((result.rowCount ?? 0) === 0) {
      throw new ProblemException("INVALID_CREDENTIALS", { detail: "break-glass session ended or expired" });
    }
    return {
      kind: "breakglass",
      userId: null,
      tenantId: claims.tid,
      sessionId: claims.bgl,
      branchId: null,
      amr: claims.amr,
      scopes: [],
      breakglassId: claims.bgl,
      platformUserId: claims.sub,
    };
  }
}
