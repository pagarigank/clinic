import { Controller, Get, Post, Body, Param, Query, UseGuards, Req } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '../auth/guards/auth.guard.js';
import { TenantContextGuard } from '../auth/guards/tenant-context.guard.js';
import { PatientsService } from './patients.service.js';
import type { RequestWithAuth } from '../auth/auth-context.js';

@ApiTags('Patients')
@ApiBearerAuth()
@Controller('patients')
@UseGuards(AuthGuard, TenantContextGuard)
export class PatientsController {
  constructor(private readonly patientsService: PatientsService) {}

  @Get()
  @ApiOperation({ summary: 'List patients' })
  async listPatients(
    @Req() req: RequestWithAuth,
    @Query('q') q?: string,
  ) {
    return this.patientsService.listPatients(req.tenantId!, q);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a patient' })
  async getPatient(
    @Req() req: RequestWithAuth,
    @Param('id') id: string,
  ) {
    return this.patientsService.getPatient(req.tenantId!, id);
  }

  @Post()
  @ApiOperation({ summary: 'Create a patient' })
  async createPatient(
    @Req() req: RequestWithAuth,
    @Body() dto: any, // using any for now as this is a stub
  ) {
    return this.patientsService.createPatient(req.tenantId!, req.authContext!.userId!, dto);
  }
}
