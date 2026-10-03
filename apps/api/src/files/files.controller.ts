import { Inject, Controller, Post, Get, Body, Param, UseGuards, Req, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ZodValidationPipe } from '../http/zod-validation.pipe.js';
import { AuthGuard } from '../auth/guards/auth.guard.js';
import { TenantContextGuard } from '../auth/guards/tenant-context.guard.js';
import { ModuleAllowlist } from '../rbac/module.guard.js';
import { RequirePermission } from '../rbac/require-permission.decorator.js';
import { FilesService } from './files.service.js';
import { CreateFileSchema, type CreateFileRequest } from '@clinic/contracts';
import type { RequestWithAuth } from '../auth/auth-context.js';

@ApiTags('Files')
@ApiBearerAuth()
@Controller('files')
@UseGuards(AuthGuard, TenantContextGuard)
@ModuleAllowlist()
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
  @ApiOperation({ summary: 'Get a short-lived download URL for a file (gated by scan status).' })
  async getDownloadUrl(
    @Req() req: RequestWithAuth,
    @Param('fileId') fileId: string,
    @Query('patientId') patientId?: string,
  ) {
    if (patientId) {
      return this.filesService.getDownloadUrl(req.tenantId!, req.authContext!.userId!, fileId, patientId);
    }
    return this.filesService.getDownloadUrl(req.tenantId!, req.authContext!.userId!, fileId);
  }

  @RequirePermission('files.read')
  @Get(':fileId/download-url')
  @ApiOperation({ summary: 'Get a short-lived download URL for a file (alias).' })
  async getDownloadUrlAlias(
    @Req() req: RequestWithAuth,
    @Param('fileId') fileId: string,
    @Query('patientId') patientId?: string,
  ) {
    if (patientId) {
      return this.filesService.getDownloadUrl(req.tenantId!, req.authContext!.userId!, fileId, patientId);
    }
    return this.filesService.getDownloadUrl(req.tenantId!, req.authContext!.userId!, fileId);
  }

  @RequirePermission('files.read')
  @Get(':fileId/preview')
  @ApiOperation({ summary: 'Get preview URL for inline display.' })
  async getPreviewUrl(
    @Req() req: RequestWithAuth,
    @Param('fileId') fileId: string,
  ) {
    return this.filesService.getPreviewUrl(req.tenantId!, req.authContext!.userId!, fileId);
  }

  @RequirePermission('files.read')
  @Get(':fileId/versions')
  @ApiOperation({ summary: 'List version history for a file.' })
  async listVersions(
    @Req() req: RequestWithAuth,
    @Param('fileId') fileId: string,
  ) {
    return this.filesService.listVersions(req.tenantId!, req.authContext!.userId!, fileId);
  }
}
