import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  PlatformLoginRequestSchema,
  PlatformStepUpRequestSchema,
  type PlatformLoginRequest,
  type PlatformStepUpRequest,
  type TokenPair,
} from '@clinic/contracts';
import { getConfig } from '../config.js';
import { ZodValidationPipe } from '../http/zod-validation.pipe.js';
import { Public, type RequestWithAuth } from '../auth/auth-context.js';
import { ModuleAllowlist } from '../rbac/module.guard.js';
import {
  PLATFORM_REFRESH_COOKIE,
  PlatformAuthService,
  type PlatformMeta,
} from './platform-auth.service.js';

type AuthedRequest = FastifyRequest & RequestWithAuth;

/**
 * Platform console credential endpoints (Phase 9). Public where credentials
 * are presented (login/refresh); the authenticated endpoints (`session`,
 * `logout`, `step-up`) rely on a `platform` bearer token from AuthGuard.
 * `@ModuleAllowlist()`: the console is never a tenant module (arch §5.3).
 */
@ApiTags('Platform — Auth')
@ApiBearerAuth()
@Controller('auth/platform')
@ModuleAllowlist()
export class PlatformAuthController {
  constructor(@Inject(PlatformAuthService) private readonly auth: PlatformAuthService) {}

  @Public()
  @Post('login')
  @ApiOperation({ summary: 'Platform console login (password + TOTP when enrolled)' })
  async login(
    @Body(new ZodValidationPipe(PlatformLoginRequestSchema)) dto: PlatformLoginRequest,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<TokenPair> {
    const result = await this.auth.login(dto, this.meta(request));
    this.setRefreshCookie(reply, result.refreshToken);
    return {
      status: 'AUTHENTICATED',
      accessToken: result.accessToken,
      tokenType: 'Bearer',
      expiresIn: getConfig().ACCESS_TTL_SECONDS,
    };
  }

  @Public()
  @Post('refresh')
  @ApiOperation({ summary: 'Rotate the platform console session' })
  async refresh(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<TokenPair> {
    const token = request.cookies?.[PLATFORM_REFRESH_COOKIE];
    const result = await this.auth.refresh(token ?? '', this.meta(request));
    this.setRefreshCookie(reply, result.refreshToken);
    return {
      status: 'AUTHENTICATED',
      accessToken: result.accessToken,
      tokenType: 'Bearer',
      expiresIn: getConfig().ACCESS_TTL_SECONDS,
    };
  }

  @Post('logout')
  @HttpCode(204)
  @ApiOperation({ summary: 'End the platform console session' })
  async logout(
    @Req() request: AuthedRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    const auth = request.authContext;
    if (auth?.platformUserId && auth.sessionId) {
      await this.auth.logout(auth.platformUserId, auth.sessionId);
    }
    reply.clearCookie(PLATFORM_REFRESH_COOKIE, this.cookieBase());
  }

  @Get('session')
  @ApiOperation({ summary: 'Platform console session info' })
  async session(@Req() request: AuthedRequest) {
    const auth = request.authContext!;
    return this.auth.sessionInfo(auth.platformUserId!, auth.sessionId!);
  }

  @Post('step-up')
  @ApiOperation({ summary: 'Re-auth for high-risk console actions (break-glass entry)' })
  async stepUp(
    @Body(new ZodValidationPipe(PlatformStepUpRequestSchema)) dto: PlatformStepUpRequest,
    @Req() request: AuthedRequest,
  ) {
    const auth = request.authContext!;
    return this.auth.stepUp(
      { platformUserId: auth.platformUserId!, sessionId: auth.sessionId! },
      dto,
    );
  }

  // ---- helpers ----------------------------------------------------------

  private meta(request: FastifyRequest): PlatformMeta {
    return {
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    };
  }

  private cookieBase() {
    return {
      httpOnly: true,
      sameSite: 'strict',
      secure: getConfig().NODE_ENV === 'production',
      path: '/',
    } as const;
  }

  private setRefreshCookie(reply: FastifyReply, token: string): void {
    reply.setCookie(PLATFORM_REFRESH_COOKIE, token, {
      ...this.cookieBase(),
      maxAge: getConfig().REFRESH_TTL_SECONDS,
    });
  }
}
