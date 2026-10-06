import {
  Inject,
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  Req,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { getAppPool, withTenant } from '@clinic/db';
import { ZodValidationPipe } from '../http/zod-validation.pipe.js';
import { AuthGuard } from '../auth/guards/auth.guard.js';
import { TenantContextGuard } from '../auth/guards/tenant-context.guard.js';
import { Module } from '../rbac/module.guard.js';
import { RequirePermission } from '../rbac/require-permission.decorator.js';
import { TenantConfigService } from './tenant-config.service.js';
import type { RequestWithAuth } from '../auth/auth-context.js';
import {
  CreateServiceSchema, type CreateServiceRequest,
  CreatePriceListSchema, type CreatePriceListRequest,
  BulkPriceAdjustSchema, type BulkPriceAdjustRequest,
  CreateDiscountTypeSchema, type CreateDiscountTypeRequest,
  CreatePaymentMethodSchema, type CreatePaymentMethodRequest,
  CreateHolidaySchema, type CreateHolidayRequest,
  CreateServiceUnitSchema, type CreateServiceUnitRequest,
  CreateOperatingHoursSchema, type CreateOperatingHoursRequest,
  CreateIcd10Schema, type CreateIcd10Request,
  UpdateIcd10Schema, type UpdateIcd10Request,
} from '@clinic/contracts';

@ApiTags('Tenant Configuration')
@ApiBearerAuth()
@Controller('admin')
@UseGuards(AuthGuard, TenantContextGuard)
@Module('admin')
export class TenantConfigController {
  constructor(
    @Inject(TenantConfigService) private readonly svc: TenantConfigService,
  ) {}
  // ── Services ────────────────────────────────────────────────────────────────

  @RequirePermission('admin.service.read')
  @Get('service-catalog')
  @ApiOperation({ summary: 'List active services with price history' })
  async listServiceCatalog(@Req() req: RequestWithAuth) {
    return this.svc.listServices(req.tenantId!, req.authContext!.userId!);
  }

  @RequirePermission('admin.service.read')
  @Get('config/services')
  @ApiOperation({ summary: 'List active services (alias)' })
  async listServicesAlias(@Req() req: RequestWithAuth) {
    return this.svc.listServices(req.tenantId!, req.authContext!.userId!);
  }

  @RequirePermission('admin.service.create')
  @Post('service-catalog')
  @ApiOperation({ summary: 'Create a service in the catalog' })
  async createServiceCatalog(
    @Req() req: RequestWithAuth,
    @Body(new ZodValidationPipe(CreateServiceSchema)) dto: CreateServiceRequest,
  ) {
    return this.svc.createService(req.tenantId!, req.authContext!.userId!, dto);
  }

  @RequirePermission('admin.service.create')
  @Post('config/services')
  @ApiOperation({ summary: 'Create a service (alias)' })
  async createServiceAlias(
    @Req() req: RequestWithAuth,
    @Body(new ZodValidationPipe(CreateServiceSchema)) dto: CreateServiceRequest,
  ) {
    return this.svc.createService(req.tenantId!, req.authContext!.userId!, dto);
  }

  @RequirePermission('admin.service.update')
  @Patch('service-catalog/:id/archive')
  @ApiOperation({ summary: 'Archive a service (soft-delete)' })
  async archiveService(@Req() req: RequestWithAuth, @Param('id') id: string) {
    return this.svc.archiveService(req.tenantId!, req.authContext!.userId!, id);
  }

  @RequirePermission('admin.service.update')
  @Patch('config/services/:id/archive')
  @ApiOperation({ summary: 'Archive a service (alias)' })
  async archiveServiceAlias(@Req() req: RequestWithAuth, @Param('id') id: string) {
    return this.svc.archiveService(req.tenantId!, req.authContext!.userId!, id);
  }

  // ── Price lists ─────────────────────────────────────────────────────────────

  @RequirePermission('admin.price.create')
  @Post('price-lists')
  @ApiOperation({ summary: 'Add an effective-dated price entry for a service' })
  async addPrice(
    @Req() req: RequestWithAuth,
    @Body(new ZodValidationPipe(CreatePriceListSchema)) dto: CreatePriceListRequest,
  ) {
    return this.svc.addPriceEntry(req.tenantId!, req.authContext!.userId!, dto);
  }

  @RequirePermission('admin.price.create')
  @Post('config/prices')
  @ApiOperation({ summary: 'Add price entry (alias)' })
  async addPriceAlias(
    @Req() req: RequestWithAuth,
    @Body(new ZodValidationPipe(CreatePriceListSchema)) dto: CreatePriceListRequest,
  ) {
    return this.svc.addPriceEntry(req.tenantId!, req.authContext!.userId!, dto);
  }

  @RequirePermission('admin.price.create')
  @Post('pricing/bulk-adjust')
  @ApiOperation({ summary: 'Bulk adjust pricing for Laboratory, Pharmacy, or Central Supply' })
  async bulkAdjustPricing(
    @Req() req: RequestWithAuth,
    @Body(new ZodValidationPipe(BulkPriceAdjustSchema)) dto: BulkPriceAdjustRequest,
  ) {
    return this.svc.bulkAdjustPricing(req.tenantId!, req.authContext!.userId!, dto);
  }

  @RequirePermission('admin.price.create')
  @Post('config/pricing/bulk-adjust')
  @ApiOperation({ summary: 'Bulk adjust pricing (alias)' })
  async bulkAdjustPricingAlias(
    @Req() req: RequestWithAuth,
    @Body(new ZodValidationPipe(BulkPriceAdjustSchema)) dto: BulkPriceAdjustRequest,
  ) {
    return this.svc.bulkAdjustPricing(req.tenantId!, req.authContext!.userId!, dto);
  }

  // ── Discount types ──────────────────────────────────────────────────────────

  @RequirePermission('admin.discount.read')
  @Get('discount-types')
  @ApiOperation({ summary: 'List active discount types' })
  async listDiscountTypes(@Req() req: RequestWithAuth) {
    return this.svc.listDiscountTypes(req.tenantId!, req.authContext!.userId!);
  }

  @RequirePermission('admin.discount.read')
  @Get('config/discount-types')
  @ApiOperation({ summary: 'List active discount types (alias)' })
  async listDiscountTypesAlias(@Req() req: RequestWithAuth) {
    return this.svc.listDiscountTypes(req.tenantId!, req.authContext!.userId!);
  }

  @RequirePermission('admin.discount.create')
  @Post('discount-types')
  @ApiOperation({ summary: 'Create a discount type' })
  async createDiscountType(
    @Req() req: RequestWithAuth,
    @Body(new ZodValidationPipe(CreateDiscountTypeSchema)) dto: CreateDiscountTypeRequest,
  ) {
    return this.svc.createDiscountType(req.tenantId!, req.authContext!.userId!, dto);
  }

  @RequirePermission('admin.discount.create')
  @Post('config/discount-types')
  @ApiOperation({ summary: 'Create a discount type (alias)' })
  async createDiscountTypeAlias(
    @Req() req: RequestWithAuth,
    @Body(new ZodValidationPipe(CreateDiscountTypeSchema)) dto: CreateDiscountTypeRequest,
  ) {
    return this.svc.createDiscountType(req.tenantId!, req.authContext!.userId!, dto);
  }

  // ── Payment methods ─────────────────────────────────────────────────────────

  @RequirePermission('admin.payment_method.read')
  @Get('payment-methods')
  @ApiOperation({ summary: 'List active payment methods' })
  async listPaymentMethods(@Req() req: RequestWithAuth) {
    return this.svc.listPaymentMethods(req.tenantId!, req.authContext!.userId!);
  }

  @RequirePermission('admin.payment_method.read')
  @Get('config/payment-methods')
  @ApiOperation({ summary: 'List active payment methods (alias)' })
  async listPaymentMethodsAlias(@Req() req: RequestWithAuth) {
    return this.svc.listPaymentMethods(req.tenantId!, req.authContext!.userId!);
  }

  @RequirePermission('admin.payment_method.create')
  @Post('payment-methods')
  @ApiOperation({ summary: 'Create a payment method' })
  async createPaymentMethod(
    @Req() req: RequestWithAuth,
    @Body(new ZodValidationPipe(CreatePaymentMethodSchema)) dto: CreatePaymentMethodRequest,
  ) {
    return this.svc.createPaymentMethod(req.tenantId!, req.authContext!.userId!, dto);
  }

  @RequirePermission('admin.payment_method.create')
  @Post('config/payment-methods')
  @ApiOperation({ summary: 'Create a payment method (alias)' })
  async createPaymentMethodAlias(
    @Req() req: RequestWithAuth,
    @Body(new ZodValidationPipe(CreatePaymentMethodSchema)) dto: CreatePaymentMethodRequest,
  ) {
    return this.svc.createPaymentMethod(req.tenantId!, req.authContext!.userId!, dto);
  }

  // ── Holidays ────────────────────────────────────────────────────────────────

  @RequirePermission('admin.schedule.read')
  @Get('holidays')
  @ApiOperation({ summary: 'List holidays (optionally filtered by year)' })
  async listHolidays(@Req() req: RequestWithAuth, @Query('year') year?: string) {
    return this.svc.listHolidays(req.tenantId!, req.authContext!.userId!, year ? parseInt(year, 10) : undefined);
  }

  @RequirePermission('admin.schedule.read')
  @Get('config/holidays')
  @ApiOperation({ summary: 'List holidays (alias)' })
  async listHolidaysAlias(@Req() req: RequestWithAuth, @Query('year') year?: string) {
    return this.svc.listHolidays(req.tenantId!, req.authContext!.userId!, year ? parseInt(year, 10) : undefined);
  }

  @RequirePermission('admin.schedule.update')
  @Post('holidays')
  @ApiOperation({ summary: 'Create a holiday' })
  async createHoliday(
    @Req() req: RequestWithAuth,
    @Body(new ZodValidationPipe(CreateHolidaySchema)) dto: CreateHolidayRequest,
  ) {
    return this.svc.createHoliday(req.tenantId!, req.authContext!.userId!, dto);
  }

  @RequirePermission('admin.schedule.update')
  @Post('config/holidays')
  @ApiOperation({ summary: 'Create a holiday (alias)' })
  async createHolidayAlias(
    @Req() req: RequestWithAuth,
    @Body(new ZodValidationPipe(CreateHolidaySchema)) dto: CreateHolidayRequest,
  ) {
    return this.svc.createHoliday(req.tenantId!, req.authContext!.userId!, dto);
  }

  // ── Service units ──────────────────────────────────────────────────────────

  @RequirePermission('admin.service_unit.read')
  @Get('service-units')
  @ApiOperation({ summary: 'List service units (rooms/stations)' })
  async listServiceUnits(@Req() req: RequestWithAuth) {
    return this.svc.listServiceUnits(req.tenantId!, req.authContext!.userId!);
  }

  @RequirePermission('admin.service_unit.create')
  @Post('service-units')
  @ApiOperation({ summary: 'Create a service unit' })
  async createServiceUnit(
    @Req() req: RequestWithAuth,
    @Body(new ZodValidationPipe(CreateServiceUnitSchema)) dto: CreateServiceUnitRequest,
  ) {
    return this.svc.createServiceUnit(req.tenantId!, req.authContext!.userId!, dto);
  }

  // ── Operating hours ────────────────────────────────────────────────────────

  @RequirePermission('admin.schedule.read')
  @Get('operating-hours')
  @ApiOperation({ summary: 'List branch operating hours' })
  async listOperatingHours(@Req() req: RequestWithAuth, @Query('branchId') branchId?: string) {
    return this.svc.listOperatingHours(req.tenantId!, req.authContext!.userId!, branchId);
  }

  @RequirePermission('admin.schedule.update')
  @Post('operating-hours')
  @ApiOperation({ summary: 'Set branch operating hours for a day' })
  async setOperatingHours(
    @Req() req: RequestWithAuth,
    @Body(new ZodValidationPipe(CreateOperatingHoursSchema)) dto: CreateOperatingHoursRequest,
  ) {
    return this.svc.setOperatingHours(req.tenantId!, req.authContext!.userId!, dto);
  }

  // ── ICD-10 Reference Catalog (admin alias) ──────────────────────────────────

  @RequirePermission('reference.read')
  @Get('icd10')
  @ApiOperation({ summary: 'List ICD-10 codes (admin alias)' })
  async listIcd10(
    @Req() req: RequestWithAuth,
    @Query('q') q?: string,
    @Query('limit') limitStr?: string,
    @Query('offset') offsetStr?: string,
  ) {
    return withTenant({ tenantId: req.tenantId, userId: req.authContext?.userId || undefined }, async (tx) => {
      const limit = Math.min(Math.max(parseInt(limitStr || '100', 10) || 100, 1), 1000);
      const offset = Math.max(parseInt(offsetStr || '0', 10) || 0, 0);

      let whereClause = '';
      const params: any[] = [];
      if (q && q.trim()) {
        whereClause = ` WHERE code ILIKE $1 OR description ILIKE $1`;
        params.push(`%${q.trim()}%`);
      }

      const countRes = await tx.query(`SELECT count(*)::int as total FROM ref_icd10${whereClause}`, params);
      const total = countRes.rows[0]?.total ?? 0;

      params.push(limit, offset);
      const query = `SELECT code, description FROM ref_icd10${whereClause} ORDER BY code LIMIT $${params.length - 1} OFFSET $${params.length}`;
      const res = await tx.query(query, params);
      return { data: res.rows, total, limit, offset };
    });
  }

  @RequirePermission('admin.settings.update')
  @Post('icd10')
  @ApiOperation({ summary: 'Create ICD-10 code (admin alias)' })
  async createIcd10(
    @Req() req: RequestWithAuth,
    @Body(new ZodValidationPipe(CreateIcd10Schema)) dto: CreateIcd10Request,
  ) {
    return withTenant({ tenantId: req.tenantId, userId: req.authContext?.userId || undefined }, async (tx) => {
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

  @RequirePermission('admin.settings.update')
  @Put('icd10/:code')
  @ApiOperation({ summary: 'Update ICD-10 code description (admin alias)' })
  async updateIcd10(
    @Req() req: RequestWithAuth,
    @Param('code') rawCode: string,
    @Body(new ZodValidationPipe(UpdateIcd10Schema)) dto: UpdateIcd10Request,
  ) {
    return withTenant({ tenantId: req.tenantId, userId: req.authContext?.userId || undefined }, async (tx) => {
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

  @RequirePermission('admin.settings.update')
  @Delete('icd10/:code')
  @ApiOperation({ summary: 'Delete ICD-10 code (admin alias)' })
  async deleteIcd10(@Req() req: RequestWithAuth, @Param('code') rawCode: string) {
    return withTenant({ tenantId: req.tenantId, userId: req.authContext?.userId || undefined }, async (tx) => {
      const code = decodeURIComponent(rawCode).trim().toUpperCase();

      const res = await tx.query('DELETE FROM ref_icd10 WHERE code = $1 RETURNING code', [code]);
      if (res.rowCount === 0) {
        throw new NotFoundException(`ICD-10 code "${code}" not found.`);
      }
      return { success: true, code };
    });
  }
}
