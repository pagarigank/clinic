import { Controller, Post, Patch, Body, Param, Get, UseGuards, Req } from '@nestjs/common';
import { AuthGuard } from '../auth/guards/auth.guard.js';
import { TenantContextGuard } from '../auth/guards/tenant-context.guard.js';
import { Module, ModuleGuard, type ModuleName, MODULES } from '../rbac/module.guard.js';
import { TenantModulesService } from './tenant-modules.service.js';
import type { RequestWithAuth } from '../auth/auth-context.js';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { z } from 'zod';
import { ZodValidationPipe } from '../http/zod-validation.pipe.js';
import { ProblemException } from '../http/problem.exception.js';
import type { FastifyRequest } from 'fastify';

const CreateModuleDto = z.object({
  module: z.enum(Array.from(MODULES) as [string, ...string[]]),
  status: z.enum(['TRIAL', 'ENABLED']).default('ENABLED'),
});
type CreateModuleDtoType = z.infer<typeof CreateModuleDto>;

const UpdateModuleStatusDto = z.object({
  status: z.enum(['DRAINING', 'DISABLED', 'ENABLED']),
  reason: z.string().optional(),
  force: z.boolean().optional(),
});
type UpdateModuleStatusDtoType = z.infer<typeof UpdateModuleStatusDto>;

@ApiTags('Platform Modules')
@ApiBearerAuth()
@Controller('platform/tenants/:tenantId/modules')
@UseGuards(AuthGuard, TenantContextGuard, ModuleGuard)
@Module('admin')
export class PlatformModulesController {
  constructor(private readonly modulesService: TenantModulesService) {}

  @Get()
  @ApiOperation({ summary: 'List tenant modules for platform', description: 'Platform-facing view of a tenant\'s modules.' })
  async listModules(@Param('tenantId') tenantId: string) {
    const modules = await this.modulesService.getTenantModules(tenantId);
    return { modules };
  }

  @Post()
  @ApiOperation({ summary: 'Enable module for tenant', description: 'Platform operator grants a module to a tenant.' })
  async enableModule(
    @Req() request: FastifyRequest & RequestWithAuth,
    @Param('tenantId') tenantId: string,
    @Body(new ZodValidationPipe(CreateModuleDto)) body: CreateModuleDtoType,
  ) {
    const auth = request.authContext!;
    // Only platform users should hit /platform endpoints, but just in case:
    if (auth.tenantId && auth.tenantId !== tenantId) {
       throw new ProblemException('FORBIDDEN', { detail: 'Cannot manage modules for other tenants' });
    }
    
    await this.modulesService.enableModule(tenantId, body.module as ModuleName, body.status, auth.userId ?? undefined);
    return { success: true };
  }

  @Patch(':module')
  @ApiOperation({ summary: 'Update module status', description: 'Platform operator drains or disables a module.' })
  async updateModuleStatus(
    @Req() request: FastifyRequest & RequestWithAuth,
    @Param('tenantId') tenantId: string,
    @Param('module') module: string,
    @Body(new ZodValidationPipe(UpdateModuleStatusDto)) body: UpdateModuleStatusDtoType,
  ) {
    const auth = request.authContext!;
    if (auth.tenantId && auth.tenantId !== tenantId) {
       throw new ProblemException('FORBIDDEN', { detail: 'Cannot manage modules for other tenants' });
    }
    
    await this.modulesService.updateModuleStatus(tenantId, module as ModuleName, body.status, body.reason, body.force, auth.userId ?? undefined);
    return { success: true };
  }
}
