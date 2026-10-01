import { Controller, Get, UseGuards, Req } from '@nestjs/common';
import { AuthGuard } from '../auth/guards/auth.guard.js';
import { TenantContextGuard } from '../auth/guards/tenant-context.guard.js';
import { Module, ModuleGuard } from '../rbac/module.guard.js';
import { TenantModulesService } from './tenant-modules.service.js';
import type { RequestWithAuth } from '../auth/auth-context.js';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';

@ApiTags('Admin Modules')
@ApiBearerAuth()
@Controller('admin/modules')
@UseGuards(AuthGuard, TenantContextGuard, ModuleGuard)
@Module('admin')
export class AdminModulesController {
  constructor(private readonly modulesService: TenantModulesService) {}

  @Get()
  @ApiOperation({ summary: 'List tenant modules', description: 'Tenant-facing view of entitled modules and their status.' })
  @ApiResponse({ status: 200, description: 'Modules returned successfully' })
  async listModules(@Req() request: FastifyRequest & RequestWithAuth) {
    const auth = request.authContext!;
    if (!auth.tenantId) {
      return { modules: [] };
    }
    const modules = await this.modulesService.getTenantModules(auth.tenantId);
    return { modules };
  }
}
