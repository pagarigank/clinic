import { Inject, Controller, Get, Post, Patch, Body, Param, Query, UseGuards, Req } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { z } from 'zod';
import { ZodValidationPipe } from '../http/zod-validation.pipe.js';
import { AuthGuard } from '../auth/guards/auth.guard.js';
import { TenantContextGuard } from '../auth/guards/tenant-context.guard.js';
import { Module } from '../rbac/module.guard.js';
import { RequirePermission } from '../rbac/require-permission.decorator.js';
import { TemplatesService } from './templates.service.js';
import type { RequestWithAuth } from '../auth/auth-context.js';
import { CreateTemplateSchema, type CreateTemplateRequest } from '@clinic/contracts';

const AddVersionSchema = z.object({ content: z.string().min(1) });

@ApiTags('Templates')
@ApiBearerAuth()
@UseGuards(AuthGuard, TenantContextGuard)
@Module('admin')
@Controller('templates')
export class TemplatesController {
  constructor(
    @Inject(TemplatesService) private readonly svc: TemplatesService,
  ) {}
  @RequirePermission('admin.template.read')
  @Get()
  @ApiOperation({ summary: 'List templates with version history' })
  async listTemplates(@Req() req: RequestWithAuth, @Query('type') type?: string) {
    return this.svc.listTemplates(req.tenantId!, req.authContext!.userId!, type);
  }

  @RequirePermission('admin.template.create')
  @Post()
  @ApiOperation({ summary: 'Create a template (creates version 1 as draft)' })
  async createTemplate(
    @Req() req: RequestWithAuth,
    @Body(new ZodValidationPipe(CreateTemplateSchema)) dto: CreateTemplateRequest,
  ) {
    return this.svc.createTemplate(req.tenantId!, req.authContext!.userId!, dto);
  }

  @RequirePermission('admin.template.update')
  @Post(':id/versions')
  @ApiOperation({ summary: 'Add a new draft version to a template' })
  async addVersion(
    @Req() req: RequestWithAuth,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(AddVersionSchema)) dto: { content: string },
  ) {
    return this.svc.addVersion(req.tenantId!, req.authContext!.userId!, id, dto.content);
  }

  @RequirePermission('admin.template.update')
  @Patch(':id/versions/:vid/publish')
  @ApiOperation({ summary: 'Publish a specific version (unpublishes all others)' })
  async publishVersion(
    @Req() req: RequestWithAuth,
    @Param('id') id: string,
    @Param('vid') vid: string,
  ) {
    return this.svc.publishVersion(req.tenantId!, req.authContext!.userId!, id, vid);
  }

  @RequirePermission('admin.template.read')
  @Get(':id/versions/:vid/preview')
  @ApiOperation({ summary: 'Preview a template version content' })
  async previewVersion(
    @Req() req: RequestWithAuth,
    @Param('id') id: string,
    @Param('vid') vid: string,
  ) {
    return this.svc.previewVersion(req.tenantId!, req.authContext!.userId!, id, vid);
  }
}
