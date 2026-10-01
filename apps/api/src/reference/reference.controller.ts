import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { getAppPool } from '@clinic/db';
import { AuthGuard } from '../auth/guards/auth.guard.js';
import { ModuleAllowlist } from '../rbac/module.guard.js';
import { RequirePermission } from '../rbac/require-permission.decorator.js';

@ApiTags('Reference Data')
@ApiBearerAuth()
@Controller('reference')
@UseGuards(AuthGuard)
@ModuleAllowlist()
@RequirePermission('reference.read')
export class ReferenceController {
  
  @Get('icd10')
  @ApiOperation({ summary: 'List ICD-10 codes' })
  async listIcd10(@Query('q') q?: string) {
    const pool = getAppPool();
    let query = `SELECT code, description FROM ref_icd10`;
    const params: string[] = [];
    if (q) {
      query += ` WHERE code ILIKE $1 OR description ILIKE $1`;
      params.push(`%${q}%`);
    }
    query += ` ORDER BY code LIMIT 50`;
    const res = await pool.query(query, params);
    return { data: res.rows };
  }

  @Get('psgc')
  @ApiOperation({ summary: 'List PSGC codes' })
  async listPsgc(@Query('q') q?: string) {
    const pool = getAppPool();
    let query = `SELECT code, name, level FROM ref_psgc`;
    const params: string[] = [];
    if (q) {
      query += ` WHERE name ILIKE $1 OR code ILIKE $1`;
      params.push(`%${q}%`);
    }
    query += ` ORDER BY code LIMIT 50`;
    const res = await pool.query(query, params);
    return { data: res.rows };
  }

  @Get('loinc')
  @ApiOperation({ summary: 'List LOINC codes' })
  async listLoinc(@Query('q') q?: string) {
    const pool = getAppPool();
    let query = `SELECT code, component, property, system FROM ref_loinc`;
    const params: string[] = [];
    if (q) {
      query += ` WHERE component ILIKE $1 OR code ILIKE $1`;
      params.push(`%${q}%`);
    }
    query += ` ORDER BY code LIMIT 50`;
    const res = await pool.query(query, params);
    return { data: res.rows };
  }

  @Get('drug-schedules')
  @ApiOperation({ summary: 'List Drug Schedules' })
  async listDrugSchedules() {
    const pool = getAppPool();
    const res = await pool.query(`SELECT code, description FROM ref_drug_schedules ORDER BY code`);
    return { data: res.rows };
  }
}
