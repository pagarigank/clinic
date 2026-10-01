import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards, Req, Headers, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiHeader } from '@nestjs/swagger';
import { z } from 'zod';
import { ZodValidationPipe } from '../http/zod-validation.pipe.js';
import { AuthGuard } from '../auth/guards/auth.guard.js';
import { TenantContextGuard } from '../auth/guards/tenant-context.guard.js';
import { Module, ModuleGuard } from '../rbac/module.guard.js';
import { BranchesService, VALID_SERVICE_TYPES } from './branches.service.js';
import type { FastifyRequest } from 'fastify';
import type { RequestWithAuth } from '../auth/auth-context.js';
import { ProblemException } from '../http/problem.exception.js';

const SERVICE_TYPES_ENUM = VALID_SERVICE_TYPES as unknown as [string, ...string[]];

const CreateBranchDto = z.object({
  code: z.string().min(1).max(20).regex(/^[A-Z0-9-]+$/, 'code must be uppercase letters, numbers, and hyphens'),
  name: z.string().min(2).max(120),
  serviceProfile: z.array(z.enum(SERVICE_TYPES_ENUM)).optional(),
  timezone: z.string().optional(),
});

const UpdateBranchDto = z.object({
  name: z.string().min(2).max(120).optional(),
  serviceProfile: z.array(z.enum(SERVICE_TYPES_ENUM)).optional(),
  timezone: z.string().optional(),
});

@ApiTags('Admin — Branches')
@ApiBearerAuth()
@Controller('admin/branches')
@UseGuards(AuthGuard, TenantContextGuard, ModuleGuard)
@Module('admin')
export class BranchesController {
  constructor(private readonly branches: BranchesService) {}

  @Get()
  @ApiOperation({ summary: 'List branches' })
  async list(
    @Req() request: FastifyRequest & RequestWithAuth,
    @Query('includeArchived') includeArchived?: string,
  ) {
    const auth = request.authContext!;
    if (!auth.tenantId) throw new ProblemException('TENANT_CONTEXT_MISSING', {});
    const results = await this.branches.listBranches(auth.tenantId, includeArchived === 'true');
    return { branches: results };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get branch' })
  async get(
    @Req() request: FastifyRequest & RequestWithAuth,
    @Param('id') id: string,
  ) {
    const auth = request.authContext!;
    if (!auth.tenantId) throw new ProblemException('TENANT_CONTEXT_MISSING', {});
    const branch = await this.branches.getBranch(auth.tenantId, id);
    return { branch };
  }

  @Post()
  @ApiOperation({ summary: 'Create a branch' })
  async create(
    @Req() request: FastifyRequest & RequestWithAuth,
    @Body(new ZodValidationPipe(CreateBranchDto)) body: z.infer<typeof CreateBranchDto>,
  ) {
    const auth = request.authContext!;
    if (!auth.tenantId) throw new ProblemException('TENANT_CONTEXT_MISSING', {});
    const branch = await this.branches.createBranch(auth.tenantId, body as any, auth.userId ?? null);
    return { branch };
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a branch' })
  @ApiHeader({ name: 'If-Match', description: 'Row version for optimistic concurrency', required: true })
  async update(
    @Req() request: FastifyRequest & RequestWithAuth,
    @Param('id') id: string,
    @Headers('if-match') ifMatch: string | undefined,
    @Body(new ZodValidationPipe(UpdateBranchDto)) body: z.infer<typeof UpdateBranchDto>,
  ) {
    const auth = request.authContext!;
    if (!auth.tenantId) throw new ProblemException('TENANT_CONTEXT_MISSING', {});
    const rowVersion = parseInt(ifMatch ?? '0', 10);
    if (!rowVersion) throw new ProblemException('VALIDATION_FAILED', { errors: [{ path: 'If-Match', message: 'required' }] });
    const branch = await this.branches.updateBranch(auth.tenantId, id, body as any, rowVersion, auth.userId ?? null);
    return { branch };
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Archive a branch (append-only; blocked on active users or open work)' })
  async archive(
    @Req() request: FastifyRequest & RequestWithAuth,
    @Param('id') id: string,
  ) {
    const auth = request.authContext!;
    if (!auth.tenantId) throw new ProblemException('TENANT_CONTEXT_MISSING', {});
    await this.branches.archiveBranch(auth.tenantId, id, auth.userId ?? null);
    return { archived: true };
  }

  @Post(':id/reactivate')
  @ApiOperation({ summary: 'Reactivate an archived branch' })
  async reactivate(
    @Req() request: FastifyRequest & RequestWithAuth,
    @Param('id') id: string,
  ) {
    const auth = request.authContext!;
    if (!auth.tenantId) throw new ProblemException('TENANT_CONTEXT_MISSING', {});
    const branch = await this.branches.reactivateBranch(auth.tenantId, id, auth.userId ?? null);
    return { branch };
  }
}
