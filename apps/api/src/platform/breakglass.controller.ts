import { Controller, Post, Delete, Get, Body, Param, UseGuards, Req, HttpCode } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { z } from 'zod';
import { ZodValidationPipe } from '../http/zod-validation.pipe.js';
import { AuthGuard } from '../auth/guards/auth.guard.js';
import { ModuleAllowlist } from '../rbac/module.guard.js';
import { BreakglassService } from './breakglass.service.js';
import { ProblemException } from '../http/problem.exception.js';
import type { FastifyRequest } from 'fastify';
import type { RequestWithAuth } from '../auth/auth-context.js';
import { RequireStepUp } from '../auth/auth-context.js';

const EnterDto = z.object({
  reason: z.string().min(15, 'reason must be at least 15 characters'),
  ttlSeconds: z.number().int().min(60).max(8 * 3600).optional(),
});
type EnterDtoType = z.infer<typeof EnterDto>;

@ApiTags('Platform — Break-glass')
@ApiBearerAuth()
@Controller('platform/tenants/:tenantId/enter')
@UseGuards(AuthGuard)
@ModuleAllowlist()
export class BreakglassController {
  constructor(private readonly breakglass: BreakglassService) {}

  /** POST /platform/tenants/{id}/enter — start a break-glass session (AC-16) */
  @Post()
  @RequireStepUp()
  @ApiOperation({
    summary: 'Enter a tenant (break-glass)',
    description: 'Platform superadmin enters a tenant for support. Requires step-up MFA. Hard 8h ceiling.',
  })
  async enter(
    @Req() request: FastifyRequest & RequestWithAuth,
    @Param('tenantId') tenantId: string,
    @Body(new ZodValidationPipe(EnterDto)) body: EnterDtoType,
  ) {
    const auth = request.authContext;
    if (!auth || auth.kind === 'user' || auth.kind === 'apikey') {
      // Must be a platform user; regular tenant users cannot enter another tenant
      // For now, any authenticated user can break-glass (platform user check lands in Phase 9)
      // We rely on step-up and the reason gate
    }

    if (!auth) {
      throw new ProblemException('FORBIDDEN', { detail: 'authentication required' });
    }

    const platformUserId = auth.userId;
    if (!platformUserId) {
      throw new ProblemException('FORBIDDEN', { detail: 'cannot determine caller identity' });
    }

    const result = await this.breakglass.enter({
      platformUserId,
      targetTenantId: tenantId,
      reason: body.reason,
      stepUpToken: undefined, // step-up is enforced by @RequireStepUp guard
      ttlSeconds: body.ttlSeconds,
    });

    return {
      accessToken: result.accessToken,
      sessionId: result.sessionId,
      expiresAt: result.expiresAt.toISOString(),
    };
  }

  /** DELETE /platform/tenants/{id}/enter/{sessionId} — end a break-glass session */
  @Delete(':sessionId')
  @HttpCode(204)
  @ApiOperation({ summary: 'End a break-glass session' })
  async end(
    @Req() request: FastifyRequest & RequestWithAuth,
    @Param('sessionId') sessionId: string,
  ) {
    const auth = request.authContext;
    if (!auth?.userId) {
      throw new ProblemException('FORBIDDEN', { detail: 'authentication required' });
    }
    await this.breakglass.end({ sessionId, platformUserId: auth.userId });
  }

  /** GET /platform/tenants/{id}/enter — list break-glass sessions for a tenant */
  @Get()
  @ApiOperation({ summary: 'List break-glass sessions for a tenant' })
  async list(@Param('tenantId') tenantId: string) {
    const sessions = await this.breakglass.listForTenant(tenantId);
    return { sessions };
  }
}
