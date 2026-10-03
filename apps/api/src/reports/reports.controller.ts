import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  UseGuards,
  Req,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '../auth/guards/auth.guard.js';
import { ModuleAllowlist } from '../rbac/module.guard.js';
import { ZodValidationPipe } from '../http/zod-validation.pipe.js';
import {
  RunReportSchema,
  ReportScheduleSchema,
  ReportExportSchema,
  type RunReportRequest,
  type ReportScheduleRequest,
  type ReportExportRequest,
} from '@clinic/contracts';
import { ReportsService } from './reports.service.js';
import type { FastifyRequest } from 'fastify';
import type { RequestWithAuth } from '../auth/auth-context.js';
import { ProblemException } from '../http/problem.exception.js';

@ApiTags('Reports')
@ApiBearerAuth()
@Controller()
@UseGuards(AuthGuard)
@ModuleAllowlist()
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('reports/catalog')
  @ApiOperation({ summary: 'Get report catalogue strictly filtered to entitled modules (AC-21)' })
  async getCatalog(@Req() req: FastifyRequest & RequestWithAuth) {
    const auth = req.authContext;
    if (!auth?.tenantId || !auth?.userId) {
      throw new ProblemException('TENANT_CONTEXT_MISSING', { detail: 'Authenticated user and tenant required' });
    }

    return this.reportsService.getCatalog(auth.tenantId, auth.userId);
  }

  @Post('reports/:reportId/run')
  @ApiOperation({ summary: 'Execute a report and return rows inline (checks module entitlement)' })
  async runReport(
    @Req() req: FastifyRequest & RequestWithAuth,
    @Param('reportId') reportId: string,
    @Body(new ZodValidationPipe(RunReportSchema)) body: RunReportRequest,
  ) {
    const auth = req.authContext;
    if (!auth?.tenantId || !auth?.userId) {
      throw new ProblemException('TENANT_CONTEXT_MISSING', { detail: 'Authenticated user and tenant required' });
    }

    return this.reportsService.runReport(auth.tenantId, auth.userId, reportId, body);
  }

  @Post('reports/:reportId/export')
  @ApiOperation({ summary: 'Generate asynchronous export of report (AC-21)' })
  async exportReport(
    @Req() req: FastifyRequest & RequestWithAuth,
    @Param('reportId') reportId: string,
    @Body(new ZodValidationPipe(ReportExportSchema)) body: ReportExportRequest,
  ) {
    const auth = req.authContext;
    if (!auth?.tenantId || !auth?.userId) {
      throw new ProblemException('TENANT_CONTEXT_MISSING', { detail: 'Authenticated user and tenant required' });
    }

    return this.reportsService.exportReport(auth.tenantId, auth.userId, reportId, body);
  }

  @Get(['me/report-schedules', 'reports/schedules'])
  @ApiOperation({ summary: 'List scheduled reports for current tenant' })
  async listSchedules(@Req() req: FastifyRequest & RequestWithAuth) {
    const auth = req.authContext;
    if (!auth?.tenantId || !auth?.userId) {
      throw new ProblemException('TENANT_CONTEXT_MISSING', { detail: 'Authenticated user and tenant required' });
    }

    return this.reportsService.listSchedules(auth.tenantId, auth.userId);
  }

  @Post(['me/report-schedules', 'reports/schedules'])
  @ApiOperation({ summary: 'Create a scheduled report delivery' })
  async createSchedule(
    @Req() req: FastifyRequest & RequestWithAuth,
    @Body(new ZodValidationPipe(ReportScheduleSchema)) body: ReportScheduleRequest,
  ) {
    const auth = req.authContext;
    if (!auth?.tenantId || !auth?.userId) {
      throw new ProblemException('TENANT_CONTEXT_MISSING', { detail: 'Authenticated user and tenant required' });
    }

    return this.reportsService.createSchedule(auth.tenantId, auth.userId, body);
  }

  @Delete(['me/report-schedules/:id', 'reports/schedules/:id'])
  @ApiOperation({ summary: 'Delete or cancel a scheduled report delivery' })
  async deleteSchedule(
    @Req() req: FastifyRequest & RequestWithAuth,
    @Param('id') id: string,
  ) {
    const auth = req.authContext;
    if (!auth?.tenantId || !auth?.userId) {
      throw new ProblemException('TENANT_CONTEXT_MISSING', { detail: 'Authenticated user and tenant required' });
    }

    return this.reportsService.deleteSchedule(auth.tenantId, auth.userId, id);
  }
}
