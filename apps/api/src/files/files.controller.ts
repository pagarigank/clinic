import { Controller, Post, Get, Body, Param, UseGuards, Req } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ZodValidationPipe } from '../http/zod-validation.pipe.js';
import { AuthGuard } from '../auth/guards/auth.guard.js';
import { TenantContextGuard } from '../auth/guards/tenant-context.guard.js';
import { FilesService } from './files.service.js';
import { CreateFileSchema, type CreateFileRequest } from '@clinic/contracts';
import type { RequestWithAuth } from '../auth/auth-context.js';

@ApiTags('Files')
@ApiBearerAuth()
@Controller('files')
@UseGuards(AuthGuard, TenantContextGuard)
export class FilesController {
  constructor(private readonly filesService: FilesService) {}

  @Post('presign')
  @ApiOperation({ summary: 'Request a presigned URL to upload a file directly to S3.' })
  async requestUpload(
    @Req() req: RequestWithAuth,
    @Body(new ZodValidationPipe(CreateFileSchema)) dto: CreateFileRequest,
  ) {
    return this.filesService.requestUpload(req.tenantId!, req.authContext!.userId!, dto);
  }

  @Get(':fileId/download')
  @ApiOperation({ summary: 'Get a short-lived download URL for a file.' })
  async getDownloadUrl(
    @Req() req: RequestWithAuth,
    @Param('fileId') fileId: string,
  ) {
    return this.filesService.getDownloadUrl(req.tenantId!, req.authContext!.userId!, fileId);
  }
}
