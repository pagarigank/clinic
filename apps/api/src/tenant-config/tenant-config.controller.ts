import { Inject, Controller, Get, Post, Patch, Body, Param, Query, UseGuards, Req } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
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
  CreateDiscountTypeSchema, type CreateDiscountTypeRequest,
  CreatePaymentMethodSchema, type CreatePaymentMethodRequest,
  CreateHolidaySchema, type CreateHolidayRequest,
  CreateServiceUnitSchema, type CreateServiceUnitRequest,
  CreateOperatingHoursSchema, type CreateOperatingHoursRequest,
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
}
