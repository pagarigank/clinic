import { Inject, Controller, Post, Get, Body, Param, UseGuards, Req } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ZodValidationPipe } from '../http/zod-validation.pipe.js';
import { AuthGuard } from '../auth/guards/auth.guard.js';
import { TenantContextGuard } from '../auth/guards/tenant-context.guard.js';
import { Module } from '../rbac/module.guard.js';
import { RequirePermission } from '../rbac/require-permission.decorator.js';
import { FilesService } from './files.service.js';
import { CreateFileSchema, type CreateFileRequest } from '@clinic/contracts';
import type { RequestWithAuth } from '../auth/auth-context.js';

@ApiTags('Files')
@ApiBearerAuth()
@Controller('files')
@UseGuards(AuthGuard, TenantContextGuard)
@Module('admin')
export class FilesController {
  constructor(
    @Inject(FilesService) private readonly filesService: FilesService,
  ) {}
  @RequirePermission('files.write')
  @Post('presign')
  @ApiOperation({ summary: 'Request a presigned URL to upload a file directly to S3.' })
  async requestUpload(
    @Req() req: RequestWithAuth,
    @Body(new ZodValidationPipe(CreateFileSchema)) dto: CreateFileRequest,
  ) {
    return this.filesService.requestUpload(req.tenantId!, req.authContext!.userId!, dto);
  }

  @RequirePermission('files.write')
  @Post(':fileId/complete')
  @ApiOperation({ summary: 'Confirm file upload completion; transitions status to READY.' })
  async completeUpload(
    @Req() req: RequestWithAuth,
    @Param('fileId') fileId: string,
  ) {
    return this.filesService.completeUpload(req.tenantId!, req.authContext!.userId!, fileId);
  }

  @RequirePermission('files.read')
  @Get(':fileId')
  @ApiOperation({ summary: 'Get file metadata and scan status.' })
  async getFile(
    @Req() req: RequestWithAuth,
    @Param('fileId') fileId: string,
  ) {
    return this.filesService.getFile(req.tenantId!, req.authContext!.userId!, fileId);
  }

  @RequirePermission('files.read')
  @Get(':fileId/download')
  @ApiOperation({ summary: 'Get a short-lived download URL for a file.' })
  async getDownloadUrl(
    @Req() req: RequestWithAuth,
    @Param('fileId') fileId: string,
  ) {
    return this.filesService.getDownloadUrl(req.tenantId!, req.authContext!.userId!, fileId);
  }

  @RequirePermission('files.read')
  @Get(':fileId/download-url')
  @ApiOperation({ summary: 'Get a short-lived download URL for a file (alias).' })
  async getDownloadUrlAlias(
    @Req() req: RequestWithAuth,
    @Param('fileId') fileId: string,
  ) {
    return this.filesService.getDownloadUrl(req.tenantId!, req.authContext!.userId!, fileId);
  }
}
