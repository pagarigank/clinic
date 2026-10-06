import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Query,
  Param,
  Body,
  Req,
  UseGuards,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { withTenant, type TenantContext } from '@clinic/db';
import {
  CreateIcd10Schema,
  type CreateIcd10Request,
  UpdateIcd10Schema,
  type UpdateIcd10Request,
} from '@clinic/contracts';
import { AuthGuard } from '../auth/guards/auth.guard.js';
import type { RequestWithAuth } from '../auth/auth-context.js';
import { ModuleAllowlist } from '../rbac/module.guard.js';
import { RequirePermission } from '../rbac/require-permission.decorator.js';
import { ZodValidationPipe } from '../http/zod-validation.pipe.js';

function getTenantCtx(req?: RequestWithAuth): TenantContext {
  const tenantId = req?.authContext?.tenantId ?? req?.tenantId ?? undefined;
  return {
    tenantId,
    userId: req?.authContext?.userId ?? undefined,
    scope: tenantId ? 'tenant' : 'platform',
  };
}

@ApiTags('Reference Data')
@ApiBearerAuth()
@Controller('reference')
@UseGuards(AuthGuard)
@ModuleAllowlist()
@RequirePermission('reference.read')
export class ReferenceController {
  
  @Get('icd10')
  @ApiOperation({ summary: 'List ICD-10 codes' })
  async listIcd10(
    @Query('q') q?: string,
    @Query('limit') limitStr?: string,
    @Query('offset') offsetStr?: string,
    @Req() req?: RequestWithAuth,
  ) {
    return withTenant(getTenantCtx(req), async (tx) => {
      const limit = Math.min(Math.max(parseInt(limitStr || '100', 10) || 100, 1), 1000);
      const offset = Math.max(parseInt(offsetStr || '0', 10) || 0, 0);

      let whereClause = '';
      const params: any[] = [];
      if (q && q.trim()) {
        whereClause = ` WHERE code ILIKE $1 OR description ILIKE $1`;
        params.push(`%${q.trim()}%`);
      }

      const countRes = await tx.query(
        `SELECT count(*)::int as total FROM ref_icd10${whereClause}`,
        params,
      );
      const total = countRes.rows[0]?.total ?? 0;

      params.push(limit, offset);
      const query = `SELECT code, description FROM ref_icd10${whereClause} ORDER BY code LIMIT $${params.length - 1} OFFSET $${params.length}`;
      const res = await tx.query(query, params);
      return { data: res.rows, total, limit, offset };
    });
  }

  @Get('icd10/:code')
  @ApiOperation({ summary: 'Get single ICD-10 code' })
  async getIcd10(@Param('code') rawCode: string, @Req() req?: RequestWithAuth) {
    return withTenant(getTenantCtx(req), async (tx) => {
      const code = decodeURIComponent(rawCode).trim().toUpperCase();
      const res = await tx.query('SELECT code, description FROM ref_icd10 WHERE code = $1', [code]);
      if (res.rowCount === 0) {
        throw new NotFoundException(`ICD-10 code "${code}" not found.`);
      }
      return res.rows[0];
    });
  }

  @Post('icd10')
  @RequirePermission('admin.settings.update')
  @ApiOperation({ summary: 'Create ICD-10 code' })
  async createIcd10(
    @Body(new ZodValidationPipe(CreateIcd10Schema)) dto: CreateIcd10Request,
    @Req() req?: RequestWithAuth,
  ) {
    return withTenant(getTenantCtx(req), async (tx) => {
      const code = dto.code.trim().toUpperCase();
      const description = dto.description.trim();

      const existing = await tx.query('SELECT code FROM ref_icd10 WHERE code = $1', [code]);
      if (existing.rowCount && existing.rowCount > 0) {
        throw new ConflictException(`ICD-10 code "${code}" already exists.`);
      }

      await tx.query('INSERT INTO ref_icd10 (code, description) VALUES ($1, $2)', [code, description]);
      return { code, description };
    });
  }

  @Put('icd10/:code')
  @RequirePermission('admin.settings.update')
  @ApiOperation({ summary: 'Update ICD-10 code description' })
  async updateIcd10(
    @Param('code') rawCode: string,
    @Body(new ZodValidationPipe(UpdateIcd10Schema)) dto: UpdateIcd10Request,
    @Req() req?: RequestWithAuth,
  ) {
    return withTenant(getTenantCtx(req), async (tx) => {
      const code = decodeURIComponent(rawCode).trim().toUpperCase();
      const description = dto.description.trim();

      const res = await tx.query(
        'UPDATE ref_icd10 SET description = $1 WHERE code = $2 RETURNING code, description',
        [description, code],
      );
      if (res.rowCount === 0) {
        throw new NotFoundException(`ICD-10 code "${code}" not found.`);
      }
      return res.rows[0];
    });
  }

  @Delete('icd10/:code')
  @RequirePermission('admin.settings.update')
  @ApiOperation({ summary: 'Delete ICD-10 code' })
  async deleteIcd10(@Param('code') rawCode: string, @Req() req?: RequestWithAuth) {
    return withTenant(getTenantCtx(req), async (tx) => {
      const code = decodeURIComponent(rawCode).trim().toUpperCase();

      const res = await tx.query('DELETE FROM ref_icd10 WHERE code = $1 RETURNING code', [code]);
      if (res.rowCount === 0) {
        throw new NotFoundException(`ICD-10 code "${code}" not found.`);
      }
      return { success: true, code };
    });
  }

  @Post('icd10/seed-common')
  @RequirePermission('admin.settings.update')
  @ApiOperation({ summary: 'Seed common primary care ICD-10 codes' })
  async seedCommonIcd10(@Req() req?: RequestWithAuth) {
    return withTenant(getTenantCtx(req), async (tx) => {
      const commonCodes: [string, string][] = [
        ['A09', 'Infectious gastroenteritis and colitis, unspecified'],
        ['A90', 'Dengue fever [classical dengue]'],
        ['B01.9', 'Varicella without complication (Chickenpox)'],
        ['B05.9', 'Measles without complication'],
        ['B34.9', 'Viral infection, unspecified'],
        ['E11.9', 'Type 2 diabetes mellitus without complications'],
        ['E11.65', 'Type 2 diabetes mellitus with hyperglycemia'],
        ['E78.5', 'Hyperlipidemia, unspecified'],
        ['H10.9', 'Unspecified conjunctivitis (Pink eye)'],
        ['H66.90', 'Otitis media, unspecified'],
        ['I10', 'Essential (primary) hypertension'],
        ['J00', 'Acute nasopharyngitis (common cold)'],
        ['J01.90', 'Acute sinusitis, unspecified'],
        ['J02.9', 'Acute pharyngitis, unspecified'],
        ['J03.90', 'Acute tonsillitis, unspecified'],
        ['J04.0', 'Acute laryngitis'],
        ['J06.9', 'Acute upper respiratory infection, unspecified'],
        ['J18.9', 'Pneumonia, unspecified organism'],
        ['J20.9', 'Acute bronchitis, unspecified'],
        ['J30.9', 'Allergic rhinitis, unspecified'],
        ['J45.909', 'Asthma, unspecified, uncomplicated'],
        ['K02.9', 'Dental caries, unspecified'],
        ['K21.9', 'Gastro-esophageal reflux disease without esophagitis'],
        ['K29.70', 'Gastritis, unspecified, without bleeding'],
        ['K52.9', 'Noninfective gastroenteritis and colitis, unspecified'],
        ['L20.9', 'Atopic dermatitis, unspecified'],
        ['L30.9', 'Dermatitis, unspecified (Eczema)'],
        ['M25.50', 'Pain in unspecified joint (Arthralgia)'],
        ['M54.5', 'Low back pain'],
        ['M79.1', 'Myalgia (Muscle pain)'],
        ['N39.0', 'Urinary tract infection, site not specified'],
        ['R05', 'Cough'],
        ['R10.9', 'Unspecified abdominal pain'],
        ['R11.2', 'Nausea with vomiting, unspecified'],
        ['R42', 'Dizziness and giddiness (Vertigo)'],
        ['R50.9', 'Fever, unspecified'],
        ['R51', 'Headache'],
        ['R53.83', 'Other fatigue / malaise'],
        ['R69', 'Illness, unspecified'],
        ['U07.1', 'COVID-19'],
        ['Z00.00', 'General adult medical examination without abnormal findings'],
        ['Z01.00', 'Encounter for examination of eyes and vision'],
        ['Z01.10', 'Encounter for examination of ears and hearing'],
        ['Z02.1', 'Encounter for pre-employment examination'],
        ['Z23', 'Encounter for immunization'],
        ['Z76.0', 'Issue of repeat prescription'],
      ];

      let inserted = 0;
      for (const [code, desc] of commonCodes) {
        const res = await tx.query(
          'INSERT INTO ref_icd10 (code, description) VALUES ($1, $2) ON CONFLICT (code) DO NOTHING',
          [code, desc],
        );
        if (res.rowCount && res.rowCount > 0) inserted++;
      }
      return { success: true, inserted, totalCommon: commonCodes.length };
    });
  }

  @Get('psgc')
  @ApiOperation({ summary: 'List PSGC codes' })
  async listPsgc(@Query('q') q?: string, @Req() req?: RequestWithAuth) {
    return withTenant(getTenantCtx(req), async (tx) => {
      let query = `SELECT code, name, level FROM ref_psgc`;
      const params: string[] = [];
      if (q) {
        query += ` WHERE name ILIKE $1 OR code ILIKE $1`;
        params.push(`%${q}%`);
      }
      query += ` ORDER BY code LIMIT 50`;
      const res = await tx.query(query, params);
      return { data: res.rows };
    });
  }

  @Get('loinc')
  @ApiOperation({ summary: 'List LOINC codes' })
  async listLoinc(@Query('q') q?: string, @Req() req?: RequestWithAuth) {
    return withTenant(getTenantCtx(req), async (tx) => {
      let query = `SELECT code, component, property, system FROM ref_loinc`;
      const params: string[] = [];
      if (q) {
        query += ` WHERE component ILIKE $1 OR code ILIKE $1`;
        params.push(`%${q}%`);
      }
      query += ` ORDER BY code LIMIT 50`;
      const res = await tx.query(query, params);
      return { data: res.rows };
    });
  }

  @Get('drug-schedules')
  @ApiOperation({ summary: 'List Drug Schedules' })
  async listDrugSchedules(@Req() req?: RequestWithAuth) {
    return withTenant(getTenantCtx(req), async (tx) => {
      const res = await tx.query(`SELECT code, description FROM ref_drug_schedules ORDER BY code`);
      return { data: res.rows };
    });
  }
}
