import { Controller, Post, Get, Body, Param, UseGuards, Req, HttpCode, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { z } from 'zod';
import { ZodValidationPipe } from '../http/zod-validation.pipe.js';
import { AuthGuard } from '../auth/guards/auth.guard.js';
import { ModuleAllowlist } from '../rbac/module.guard.js';
import { ProvisioningService } from './provisioning.service.js';
import { MODULES, type ModuleName } from '../rbac/module.guard.js';
import type { FastifyRequest } from 'fastify';
import type { RequestWithAuth } from '../auth/auth-context.js';

const CreateTenantDto = z.object({
  name: z.string().min(2).max(120),
  slug: z.string().min(2).max(60).regex(/^[a-z0-9-]+$/, 'slug must be lowercase letters, numbers, and hyphens'),
  planId: z.string().uuid(),
  timezone: z.string().optional(),
  modules: z.array(z.enum(Array.from(MODULES) as [string, ...string[]])).min(1),
});
type CreateTenantDtoType = z.infer<typeof CreateTenantDto>;

const SuspendDto = z.object({
  reason: z.string().min(5),
});

@ApiTags('Platform — Tenants')
@ApiBearerAuth()
@Controller('platform/tenants')
@UseGuards(AuthGuard)
@ModuleAllowlist()
export class ProvisioningController {
  constructor(private readonly provisioning: ProvisioningService) {}

  @Get()
  @ApiOperation({ summary: 'List all tenants (platform console)' })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'offset', required: false })
  async listTenants(
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const tenants = await this.provisioning.listTenants({
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
    return { tenants };
  }

  @Get(':tenantId')
  @ApiOperation({ summary: 'Get tenant metadata (platform console)' })
  async getTenant(@Param('tenantId') tenantId: string) {
    const tenant = await this.provisioning.getTenant(tenantId);
    return { tenant };
  }

  /** POST /platform/tenants — wizard step: create tenant with modules */
  @Post()
  @ApiOperation({
    summary: 'Create a new tenant',
    description: 'Creates tenant in PROVISIONING state. JOB-03 seeds entitled modules and activates.',
  })
  async createTenant(
    @Req() request: FastifyRequest & RequestWithAuth,
    @Body(new ZodValidationPipe(CreateTenantDto)) body: CreateTenantDtoType,
  ) {
    const auth = request.authContext;
    const tenant = await this.provisioning.createTenant(
      {
        name: body.name,
        slug: body.slug,
        planId: body.planId,
        timezone: body.timezone,
        modules: body.modules as ModuleName[],
      },
      auth?.userId ?? null,
    );
    return { tenant };
  }

  /** POST /platform/tenants/{id}/provision — retry JOB-03 on failure */
  @Post(':tenantId/provision')
  @HttpCode(202)
  @ApiOperation({ summary: 'Retry tenant provisioning (JOB-03)' })
  async retryProvisioning(@Param('tenantId') tenantId: string) {
    await this.provisioning.retryProvisioning(tenantId);
    return { queued: true };
  }

  /** POST /platform/tenants/{id}/suspend */
  @Post(':tenantId/suspend')
  @HttpCode(204)
  @ApiOperation({ summary: 'Suspend a tenant (G-15, PLT-T2)' })
  async suspendTenant(
    @Req() request: FastifyRequest & RequestWithAuth,
    @Param('tenantId') tenantId: string,
    @Body(new ZodValidationPipe(SuspendDto)) body: { reason: string },
  ) {
    const auth = request.authContext;
    await this.provisioning.suspendTenant(tenantId, body.reason, auth?.userId ?? null);
  }

  /** POST /platform/tenants/{id}/reactivate */
  @Post(':tenantId/reactivate')
  @HttpCode(204)
  @ApiOperation({ summary: 'Reactivate a suspended tenant' })
  async reactivateTenant(
    @Req() request: FastifyRequest & RequestWithAuth,
    @Param('tenantId') tenantId: string,
  ) {
    const auth = request.authContext;
    await this.provisioning.reactivateTenant(tenantId, auth?.userId ?? null);
  }
}
