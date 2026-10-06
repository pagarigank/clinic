import { Inject, Controller, Get, Post, Body, Query, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Public } from '../auth/auth-context.js';
import { ModuleAllowlist } from '../rbac/module.guard.js';
import { ZodValidationPipe } from '../http/zod-validation.pipe.js';
import { ProblemException } from '../http/problem.exception.js';
import { TenantResolverService, slugFromHost } from '../auth/tenant-resolver.service.js';
import { ClinicalService } from './clinical.service.js';
import {
  PublicBookAppointmentSchema,
  type PublicBookAppointmentRequest,
  PublicAvailabilityQuerySchema,
  type PublicAvailabilityQueryRequest,
} from '@clinic/contracts';

/**
 * Public appointment scheduling controller.
 * Unauthenticated patient-facing endpoints (no login required).
 * Strictly isolated per-tenant through tenant resolution and withTenant.
 */
@ApiTags('Public Booking')
@Public()
@ModuleAllowlist()
@Controller('public/booking')
export class PublicBookingController {
  constructor(
    @Inject(ClinicalService) private readonly clinicalSvc: ClinicalService,
    @Inject(TenantResolverService) private readonly resolver: TenantResolverService,
  ) {}

  private async resolveTenant(slugOrHeader?: string, hostname?: string) {
    const slug = slugOrHeader || (hostname ? slugFromHost(hostname) : null);
    if (!slug) {
      throw new ProblemException('NOT_FOUND', { detail: 'Clinic slug not specified' });
    }
    const tenant = (await this.resolver.resolveBySlug(slug)) || (await this.resolver.resolveById(slug));
    if (!tenant || tenant.status === 'OFFBOARDED' || tenant.status === 'SUSPENDED') {
      throw new ProblemException('NOT_FOUND', { detail: 'Clinic not found or unavailable' });
    }
    return tenant;
  }

  @Get('clinic')
  @ApiOperation({ summary: 'Get clinic details, branches, and doctors for public appointment booking' })
  async getClinic(
    @Query('slug') slug?: string,
    @Req() req?: FastifyRequest,
  ) {
    const headerTenant = req?.headers?.['x-tenant'] as string | undefined;
    const hostname = req?.hostname;
    const tenant = await this.resolveTenant(slug || headerTenant, hostname);
    return this.clinicalSvc.getPublicBookingConfig(tenant.id);
  }

  @Get('availability')
  @ApiOperation({ summary: 'Get available time slots for a practitioner and date (public)' })
  async getAvailability(
    @Query(new ZodValidationPipe(PublicAvailabilityQuerySchema)) query: PublicAvailabilityQueryRequest,
    @Req() req?: FastifyRequest,
  ) {
    const tenant = await this.resolveTenant(query.slug, req?.hostname);
    return this.clinicalSvc.getAvailability(
      tenant.id,
      undefined,
      query.branchId,
      query.practitionerId,
      query.date,
    );
  }

  @Post('appointments')
  @ApiOperation({ summary: 'Book an appointment without login (double-booking prevented, channel=ONLINE)' })
  async bookAppointment(
    @Body(new ZodValidationPipe(PublicBookAppointmentSchema)) dto: PublicBookAppointmentRequest,
    @Req() req?: FastifyRequest,
  ) {
    const tenant = await this.resolveTenant(dto.slug, req?.hostname);
    return this.clinicalSvc.bookPublicAppointment(tenant.id, dto);
  }
}
