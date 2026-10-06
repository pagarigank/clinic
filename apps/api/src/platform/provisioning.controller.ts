import { Inject, Controller, Post, Get, Body, Param, UseGuards, Req, HttpCode, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { z } from 'zod';
import { ZodValidationPipe } from '../http/zod-validation.pipe.js';
import { AuthGuard } from '../auth/guards/auth.guard.js';
import { ModuleAllowlist } from '../rbac/module.guard.js';
import { RequirePermission } from '../rbac/require-permission.decorator.js';
import { ProvisioningService } from './provisioning.service.js';
import { MODULES, type ModuleName } from '../rbac/module.guard.js';
import type { FastifyRequest } from 'fastify';
import type { RequestWithAuth } from '../auth/auth-context.js';
import { ChangeSubscriptionPlanSchema, type ChangeSubscriptionPlanRequest } from '@clinic/contracts';

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

const OffboardDto = z.object({
  reason: z.string().min(5),
  confirmationPhrase: z.string().optional(),
});

@ApiTags('Platform')
@ApiBearerAuth()
@Controller('platform')
@UseGuards(AuthGuard)
@ModuleAllowlist()
@RequirePermission('platform.tenant.read')
export class ProvisioningController {
  constructor(
    @Inject(ProvisioningService) private readonly provisioning: ProvisioningService,
  ) {}

  @Get('tenants')
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

  @Get('tenants/:tenantId')
  @ApiOperation({ summary: 'Get tenant metadata (platform console, surfaces no PHI)' })
  async getTenant(@Param('tenantId') tenantId: string) {
    const tenant = await this.provisioning.getTenant(tenantId);
    return { tenant };
  }

  /** POST /platform/tenants — wizard step: create tenant with modules */
  @Post('tenants')
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
  @Post('tenants/:tenantId/provision')
  @HttpCode(202)
  @ApiOperation({ summary: 'Retry tenant provisioning (JOB-03)' })
  async retryProvisioning(@Param('tenantId') tenantId: string) {
    await this.provisioning.retryProvisioning(tenantId);
    return { queued: true };
  }

  /** POST /platform/tenants/{id}/suspend */
  @Post('tenants/:tenantId/suspend')
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
  @Post('tenants/:tenantId/reactivate')
  @HttpCode(204)
  @ApiOperation({ summary: 'Reactivate a suspended tenant' })
  async reactivateTenant(
    @Req() request: FastifyRequest & RequestWithAuth,
    @Param('tenantId') tenantId: string,
  ) {
    const auth = request.authContext;
    await this.provisioning.reactivateTenant(tenantId, auth?.userId ?? null);
  }

  /** GET /platform/plans — list subscription plans */
  @Get('plans')
  @ApiOperation({ summary: 'List commercial subscription plans' })
  async listPlans() {
    return this.provisioning.listPlans();
  }

  /** GET /platform/plans/{id}/modules — plan module sets for tenant wizard */
  @Get('plans/:planId/modules')
  @ApiOperation({ summary: 'Get allowed modules and caps for a plan' })
  async getPlanModules(@Param('planId') planId: string) {
    return this.provisioning.getPlanModules(planId);
  }

  /** POST /platform/tenants/{id}/plan — change plan with Q-15 downgrade orphan check */
  @Post('tenants/:tenantId/plan')
  @ApiOperation({ summary: 'Change tenant subscription plan with Q-15 downgrade orphan check' })
  async changePlan(
    @Req() request: FastifyRequest & RequestWithAuth,
    @Param('tenantId') tenantId: string,
    @Body(new ZodValidationPipe(ChangeSubscriptionPlanSchema)) body: ChangeSubscriptionPlanRequest,
  ) {
    const auth = request.authContext;
    return this.provisioning.changePlan(tenantId, body.planId, auth?.userId ?? null);
  }

  /** POST /platform/tenants/{id}/export — JOB-04 tenant export */
  @Post('tenants/:tenantId/export')
  @HttpCode(202)
  @ApiOperation({ summary: 'Export tenant dataset bundle (JOB-04)' })
  async exportTenant(
    @Req() request: FastifyRequest & RequestWithAuth,
    @Param('tenantId') tenantId: string,
  ) {
    const auth = request.authContext;
    return this.provisioning.exportTenant(tenantId, auth?.userId || 'system');
  }

  /** POST /platform/tenants/{id}/offboard — JOB-05 with legal hold protection */
  @Post('tenants/:tenantId/offboard')
  @ApiOperation({ summary: 'Offboard tenant with legal hold check (JOB-05)' })
  async offboardTenant(
    @Req() request: FastifyRequest & RequestWithAuth,
    @Param('tenantId') tenantId: string,
    @Body(new ZodValidationPipe(OffboardDto)) body: { reason: string },
  ) {
    const auth = request.authContext;
    return this.provisioning.offboardTenant(tenantId, body.reason, auth?.userId ?? null);
  }

  /** GET /platform/reports/RPT-PLT-09 — Entitlement transparency report (non-PHI) */
  @Get('reports/RPT-PLT-09')
  @ApiOperation({ summary: 'Module entitlement transparency report (RPT-PLT-09, non-PHI)' })
  async getEntitlementReport(@Query('tenantId') tenantId?: string) {
    return this.provisioning.getEntitlementTransparencyReport(tenantId);
  }

  /** GET /platform/jobs — Job monitor */
  @Get('jobs')
  @ApiOperation({ summary: 'List background and outbox jobs' })
  async listJobs() {
    return this.provisioning.listJobs();
  }

  /** POST /platform/jobs/{id}/replay — DLQ replay for idempotent jobs */
  @Post('jobs/:jobId/replay')
  @ApiOperation({ summary: 'Replay a failed job' })
  async replayJob(@Param('jobId') jobId: string) {
    return this.provisioning.replayJob(jobId);
  }
}
