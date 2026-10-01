import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Post,
  Req,
  Res,
} from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import {
  ForgotPasswordSchema,
  LoginRequestSchema,
  type LoginRequest,
  MfaConfirmSchema,
  MfaLoginVerifySchema,
  ResetPasswordSchema,
  StepUpRequestSchema,
  type ForgotPasswordRequest,
  type ResetPasswordRequest,
  type StepUpRequest,
} from "@clinic/contracts";
import { getConfig } from "../config.js";
import { ZodValidationPipe } from "../http/zod-validation.pipe.js";
import { Public, RequireStepUp, type RequestWithAuth } from "./auth-context.js";
import { ModuleAllowlist } from "../rbac/module.guard.js";
import {
  DEVICE_COOKIE,
  type AuthenticatedResult,
  AuthService,
  type LoginResult,
  REFRESH_COOKIE,
  type RequestMeta,
} from "./auth.service.js";
import { MfaService } from "./mfa.service.js";
import type { MfaEnrollStartResponse, TokenPair } from "@clinic/contracts";

type AuthedRequest = FastifyRequest & RequestWithAuth;

@Controller("api/v1/auth")
// Identity is not a tenant module: login, refresh, logout, step-up and MFA
// management must work for a tenant whose modules are all DISABLED, otherwise a
// lapsed tenant could never sign in to see why. `GET /session` is the
// documented place where the entitled module set is returned (specification
// §1014), so gating it on an entitlement would be circular.
@ModuleAllowlist()
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(MfaService) private readonly mfa: MfaService,
  ) {}

  // ---- credential endpoints (public) ------------------------------------

  @Public()
  @Post("login")
  async login(
    @Body(new ZodValidationPipe(LoginRequestSchema)) dto: LoginRequest,
    @Req() request: FastifyRequest & RequestWithAuth,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<LoginResult | TokenPair> {
    const result = await this.auth.login(dto, this.meta(request));
    if (result.status === "AUTHENTICATED") {
      this.setRefreshCookie(reply, result.refreshToken);
      this.setDeviceCookie(reply, result.deviceCookie);
      return {
        status: "AUTHENTICATED",
        accessToken: result.accessToken,
        tokenType: "Bearer",
        expiresIn: getConfig().ACCESS_TTL_SECONDS,
      } satisfies TokenPair;
    }
    return result;
  }

  @Public()
  @Post("mfa/verify")
  async verifyMfa(
    @Body(new ZodValidationPipe(MfaLoginVerifySchema)) dto: { ticket: string; code: string; rememberDevice?: boolean },
    @Req() request: FastifyRequest & RequestWithAuth,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const result = await this.auth.verifyMfaLogin(dto.ticket, dto.code, dto.rememberDevice, this.meta(request));
    if (result.status === "AUTHENTICATED") {
      this.setRefreshCookie(reply, result.refreshToken);
      this.setDeviceCookie(reply, result.deviceCookie);
      return {
        status: "AUTHENTICATED",
        accessToken: result.accessToken,
        tokenType: "Bearer",
        expiresIn: getConfig().ACCESS_TTL_SECONDS,
      };
    }
    return { status: result.status, ticket: result.ticket };
  }

  @Public()
  @Post("refresh")
  async refresh(
    @Req() request: FastifyRequest & RequestWithAuth,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const token = request.cookies?.[REFRESH_COOKIE];
    const result: AuthenticatedResult = await this.auth.refresh(token ?? "", this.meta(request));
    this.setRefreshCookie(reply, result.refreshToken);
    return {
      status: "AUTHENTICATED",
      accessToken: result.accessToken,
      tokenType: "Bearer",
      expiresIn: getConfig().ACCESS_TTL_SECONDS,
    };
  }

  @Public()
  @HttpCode(202)
  @Post("password/forgot")
  async forgotPassword(
    @Body(new ZodValidationPipe(ForgotPasswordSchema)) dto: ForgotPasswordRequest,
    @Req() request: FastifyRequest & RequestWithAuth,
  ) {
    return this.auth.forgotPassword(dto, this.meta(request));
  }

  @Public()
  @Post("password/reset")
  async resetPassword(
    @Body(new ZodValidationPipe(ResetPasswordSchema)) dto: ResetPasswordRequest,
  ) {
    return this.auth.resetPassword(dto);
  }

  // ---- authenticated session endpoints ----------------------------------

  @Post("logout")
  @HttpCode(204)
  async logout(
    @Req() request: AuthedRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    const auth = request.authContext!;
    if (auth.tenantId && auth.sessionId) {
      await this.auth.logout(auth.tenantId, auth.sessionId);
    }
    const base = this.cookieBase();
    reply.clearCookie(REFRESH_COOKIE, base).clearCookie(DEVICE_COOKIE, base);
  }

  @Get("session")
  async session(@Req() request: AuthedRequest) {
    const auth = request.authContext!;
    return this.auth.sessionInfo(
      auth.tenantId!,
      auth.userId!,
      auth.sessionId!,
      auth.amr,
    );
  }

  // ---- step-up ------------------------------------------------------------

  @Post("step-up")
  async stepUp(
    @Body(new ZodValidationPipe(StepUpRequestSchema)) dto: StepUpRequest,
    @Req() request: AuthedRequest,
  ) {
    const auth = request.authContext!;
    return this.auth.stepUp(
      { tenantId: auth.tenantId!, userId: auth.userId!, sessionId: auth.sessionId!, amr: auth.amr },
      dto,
    );
  }

  // ---- MFA management -----------------------------------------------------

  @RequireStepUp()
  @Post("mfa/enroll")
  async enroll(@Req() request: AuthedRequest): Promise<MfaEnrollStartResponse> {
    const auth = request.authContext!;
    // Enrollment needs the label email — fetch it in the same transaction
    // shape the service uses (RLS-scoped read of the caller's own row).
    const profile = await this.auth.ownEmail(auth.tenantId!, auth.userId!);
    return this.mfa.startEnroll(auth.tenantId!, auth.userId!, profile);
  }

  @Post("mfa/confirm")
  async confirm(
    @Body(new ZodValidationPipe(MfaConfirmSchema)) dto: { code: string },
    @Req() request: AuthedRequest,
  ) {
    const auth = request.authContext!;
    const recoveryCodes = await this.mfa.confirm(auth.tenantId!, auth.userId!, dto.code);
    return { confirmed: true as const, recoveryCodes };
  }

  @RequireStepUp()
  @Post("mfa/recovery-codes")
  async regenerate(@Req() request: AuthedRequest) {
    const auth = request.authContext!;
    const recoveryCodes = await this.mfa.regenerateRecoveryCodes(auth.tenantId!, auth.userId!);
    return { recoveryCodes };
  }

  @RequireStepUp()
  @Delete("mfa")
  async disable(@Req() request: AuthedRequest) {
    const auth = request.authContext!;
    await this.mfa.disable(auth.tenantId!, auth.userId!);
    return { disabled: true as const };
  }

  // ---- helpers -------------------------------------------------------------

  private meta(request: FastifyRequest & RequestWithAuth): RequestMeta {
    const headerTenant = request.headers["x-tenant"];
    const deviceToken = request.cookies?.[DEVICE_COOKIE];
    return {
      ip: request.ip,
      userAgent: request.headers["user-agent"],
      hostname: request.hostname,
      headerTenant: Array.isArray(headerTenant) ? headerTenant[0] : headerTenant,
      deviceToken,
    };
  }

  private cookieBase() {
    return {
      httpOnly: true,
      sameSite: "strict",
      secure: getConfig().NODE_ENV === "production",
      path: "/",
    } as const;
  }

  private setRefreshCookie(reply: FastifyReply, token: string | undefined): void {
    if (!token) return;
    reply.setCookie(REFRESH_COOKIE, token, {
      ...this.cookieBase(),
      maxAge: getConfig().REFRESH_TTL_SECONDS,
    });
  }

  private setDeviceCookie(reply: FastifyReply, token: string | undefined): void {
    if (!token) return;
    reply.setCookie(DEVICE_COOKIE, token, {
      ...this.cookieBase(),
      maxAge: getConfig().TRUSTED_DEVICE_TTL_SECONDS,
    });
  }
}
