import { type CanActivate, type ExecutionContext, Inject, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { FastifyRequest } from "fastify";
import { ProblemException } from "../../http/problem.exception.js";
import { REQUIRE_STEP_UP_KEY, type RequestWithAuth } from "../auth-context.js";
import { type StepUpClaims, TokenService } from "../crypto/tokens.js";

/**
 * Step-up guard (architecture §10, todo 1.2): routes decorated
 * `@RequireStepUp()` must carry `X-Step-Up-Token` — a short-lived JWT issued
 * by `POST /auth/step-up` after a fresh password (and TOTP, when enrolled)
 * challenge. The token must belong to the same user AND session as the
 * bearer access token, so a stolen step-up token alone grants nothing.
 *
 * The web client hook (passphrase modal) that reacts to 401
 * STEP_UP_REQUIRED is delivered with the first screen that triggers a
 * high-risk action (frontend §9 wiring — Phase 1.7 shells).
 */
@Injectable()
export class StepUpGuard implements CanActivate {
  // Explicit @Inject: esbuild (tsx) does not emit design:paramtypes metadata.
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(TokenService) private readonly tokens: TokenService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<boolean>(REQUIRE_STEP_UP_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required) return true;

    const request = context.switchToHttp().getRequest<FastifyRequest & RequestWithAuth>();
    const auth = request.authContext;
    if (!auth?.userId || !auth.sessionId) {
      throw new ProblemException("STEP_UP_REQUIRED", { detail: "step-up requires an interactive session" });
    }
    const header = request.headers["x-step-up-token"];
    const raw = Array.isArray(header) ? header[0] : header;
    if (!raw) throw new ProblemException("STEP_UP_REQUIRED");

    const claims = await this.tokens.verify<StepUpClaims>(raw, "step-up");
    if (!claims || claims.sub !== auth.userId || claims.sid !== auth.sessionId) {
      throw new ProblemException("STEP_UP_REQUIRED", { detail: "step-up token invalid for this session" });
    }
    return true;
  }
}
