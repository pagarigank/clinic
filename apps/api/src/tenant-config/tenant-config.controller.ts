import { Get, Post, Patch, Body, Param, Query, UseGuards, Req } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ZodValidationPipe } from '../http/zod-validation.pipe.js';
import { AuthGuard } from '../auth/guards/auth.guard.js';
import { TenantContextGuard } from '../auth/guards/tenant-context.guard.js';
import { Module } from '../rbac/module.guard.js';
import { TenantConfigService } from './tenant-config.service.js';
import type { RequestWithAuth } from '../auth/auth-context.js';
import {
  CreateServiceSchema, type CreateServiceRequest,
  CreatePriceListSchema, type CreatePriceListRequest,
  CreateDiscountTypeSchema, type CreateDiscountTypeRequest,
  CreatePaymentMethodSchema, type CreatePaymentMethodRequest,
  CreateHolidaySchema, type CreateHolidayRequest,
} from '@clinic/contracts';

@ApiTags('Tenant Configuration')
@ApiBearerAuth()
@UseGuards(AuthGuard, TenantContextGuard)
@Module('admin')
export class TenantConfigController {
  constructor(private readonly svc: TenantConfigService) {}

  // ── Services ────────────────────────────────────────────────────────────────

  @Get('config/services')
  @ApiOperation({ summary: 'List active services with price history' })
  async listServices(@Req() req: RequestWithAuth) {
    return this.svc.listServices(req.tenantId!, req.authContext!.userId!);
  }

  @Post('config/services')
  @ApiOperation({ summary: 'Create a service' })
  async createService(
    @Req() req: RequestWithAuth,
    @Body(new ZodValidationPipe(CreateServiceSchema)) dto: CreateServiceRequest,
  ) {
    return this.svc.createService(req.tenantId!, req.authContext!.userId!, dto);
  }

  @Patch('config/services/:id/archive')
  @ApiOperation({ summary: 'Archive a service (soft-delete)' })
  async archiveService(@Req() req: RequestWithAuth, @Param('id') id: string) {
    return this.svc.archiveService(req.tenantId!, req.authContext!.userId!, id);
  }

  // ── Price lists ─────────────────────────────────────────────────────────────

  @Post('config/prices')
  @ApiOperation({ summary: 'Add an effective-dated price entry for a service' })
  async addPrice(
    @Req() req: RequestWithAuth,
    @Body(new ZodValidationPipe(CreatePriceListSchema)) dto: CreatePriceListRequest,
  ) {
    return this.svc.addPriceEntry(req.tenantId!, req.authContext!.userId!, dto);
  }

  // ── Discount types ──────────────────────────────────────────────────────────

  @Get('config/discount-types')
  @ApiOperation({ summary: 'List active discount types' })
  async listDiscountTypes(@Req() req: RequestWithAuth) {
    return this.svc.listDiscountTypes(req.tenantId!, req.authContext!.userId!);
  }

  @Post('config/discount-types')
  @ApiOperation({ summary: 'Create a discount type' })
  async createDiscountType(
    @Req() req: RequestWithAuth,
    @Body(new ZodValidationPipe(CreateDiscountTypeSchema)) dto: CreateDiscountTypeRequest,
  ) {
    return this.svc.createDiscountType(req.tenantId!, req.authContext!.userId!, dto);
  }

  // ── Payment methods ─────────────────────────────────────────────────────────

  @Get('config/payment-methods')
  @ApiOperation({ summary: 'List active payment methods' })
  async listPaymentMethods(@Req() req: RequestWithAuth) {
    return this.svc.listPaymentMethods(req.tenantId!, req.authContext!.userId!);
  }

  @Post('config/payment-methods')
  @ApiOperation({ summary: 'Create a payment method' })
  async createPaymentMethod(
    @Req() req: RequestWithAuth,
    @Body(new ZodValidationPipe(CreatePaymentMethodSchema)) dto: CreatePaymentMethodRequest,
  ) {
    return this.svc.createPaymentMethod(req.tenantId!, req.authContext!.userId!, dto);
  }

  // ── Holidays ────────────────────────────────────────────────────────────────

  @Get('config/holidays')
  @ApiOperation({ summary: 'List holidays (optionally filtered by year)' })
  async listHolidays(@Req() req: RequestWithAuth, @Query('year') year?: string) {
    return this.svc.listHolidays(req.tenantId!, req.authContext!.userId!, year ? parseInt(year, 10) : undefined);
  }

  @Post('config/holidays')
  @ApiOperation({ summary: 'Create a holiday' })
  async createHoliday(
    @Req() req: RequestWithAuth,
    @Body(new ZodValidationPipe(CreateHolidaySchema)) dto: CreateHolidayRequest,
  ) {
    return this.svc.createHoliday(req.tenantId!, req.authContext!.userId!, dto);
  }
}
