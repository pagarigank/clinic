import { Injectable } from '@nestjs/common';
import { withTenant } from '@clinic/db';
import { ProblemException } from '../http/problem.exception.js';
import type {
  CreateServiceRequest,
  CreatePriceListRequest,
  CreateDiscountTypeRequest,
  CreatePaymentMethodRequest,
  CreateHolidayRequest,
  CreateServiceUnitRequest,
  CreateOperatingHoursRequest,
} from '@clinic/contracts';

@Injectable()
export class TenantConfigService {
  // ── Service catalog ────────────────────────────────────────────────────────

  async listServices(tenantId: string, userId: string) {
    return withTenant({ tenantId, userId }, async (tx) => {
      const res = await tx.query(
        `SELECT sc.*, 
                (SELECT json_agg(json_build_object('id', pl.id, 'amount', pl.amount, 'effectiveFrom', pl.effective_from, 'effectiveTo', pl.effective_to))
                 FROM price_lists pl WHERE pl.service_id = sc.id) AS price_history
         FROM service_catalog sc WHERE sc.deleted_at IS NULL ORDER BY sc.name`,
      );
      return { data: res.rows };
    });
  }

  async createService(tenantId: string, userId: string, dto: CreateServiceRequest) {
    return withTenant({ tenantId, userId }, async (tx) => {
      const res = await tx.query(
        `INSERT INTO service_catalog (tenant_id, branch_id, code, name)
         VALUES ($1, $2, $3, $4) RETURNING id, code, name, is_active, created_at`,
        [tenantId, dto.branchId ?? null, dto.code, dto.name],
      );
      return res.rows[0];
    });
  }

  async archiveService(tenantId: string, userId: string, serviceId: string) {
    return withTenant({ tenantId, userId }, async (tx) => {
      const res = await tx.query(
        `UPDATE service_catalog SET deleted_at = now(), is_active = false WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL RETURNING id`,
        [serviceId, tenantId],
      );
      if ((res.rowCount ?? 0) === 0) throw new ProblemException('NOT_FOUND', { detail: 'Service not found or already archived' });
      return { archived: true };
    });
  }

  // ── Price lists ────────────────────────────────────────────────────────────

  async addPriceEntry(tenantId: string, userId: string, dto: CreatePriceListRequest) {
    return withTenant({ tenantId, userId }, async (tx) => {
      const res = await tx.query(
        `INSERT INTO price_lists (tenant_id, service_id, amount, effective_from, effective_to)
         VALUES ($1, $2, $3, $4, $5) RETURNING id, amount, effective_from, effective_to`,
        [tenantId, dto.serviceId, dto.amount, dto.effectiveFrom, dto.effectiveTo ?? null],
      );
      return res.rows[0];
    });
  }

  // ── Discount types ─────────────────────────────────────────────────────────

  async listDiscountTypes(tenantId: string, userId: string) {
    return withTenant({ tenantId, userId }, async (tx) => {
      const res = await tx.query(`SELECT * FROM discount_types WHERE is_active = true ORDER BY name`);
      return { data: res.rows };
    });
  }

  async createDiscountType(tenantId: string, userId: string, dto: CreateDiscountTypeRequest) {
    return withTenant({ tenantId, userId }, async (tx) => {
      const res = await tx.query(
        `INSERT INTO discount_types (tenant_id, name, percentage)
         VALUES ($1, $2, $3) RETURNING id, name, percentage, is_active`,
        [tenantId, dto.name, dto.percentage],
      );
      return res.rows[0];
    });
  }

  // ── Payment methods ────────────────────────────────────────────────────────

  async listPaymentMethods(tenantId: string, userId: string) {
    return withTenant({ tenantId, userId }, async (tx) => {
      const res = await tx.query(`SELECT * FROM payment_methods WHERE is_active = true ORDER BY name`);
      return { data: res.rows };
    });
  }

  async createPaymentMethod(tenantId: string, userId: string, dto: CreatePaymentMethodRequest) {
    return withTenant({ tenantId, userId }, async (tx) => {
      const res = await tx.query(
        `INSERT INTO payment_methods (tenant_id, code, name)
         VALUES ($1, $2, $3) RETURNING id, code, name, is_active`,
        [tenantId, dto.code, dto.name],
      );
      return res.rows[0];
    });
  }

  // ── Holidays ───────────────────────────────────────────────────────────────

  async listHolidays(tenantId: string, userId: string, year?: number) {
    return withTenant({ tenantId, userId }, async (tx) => {
      const params: unknown[] = [];
      let where = '';
      if (year) {
        params.push(year);
        where = `AND EXTRACT(YEAR FROM date) = $${params.length}`;
      }
      const res = await tx.query(`SELECT * FROM holidays WHERE true ${where} ORDER BY date`, params);
      return { data: res.rows };
    });
  }

  async createHoliday(tenantId: string, userId: string, dto: CreateHolidayRequest) {
    return withTenant({ tenantId, userId }, async (tx) => {
      const res = await tx.query(
        `INSERT INTO holidays (tenant_id, date, name) VALUES ($1, $2, $3) RETURNING id, date, name`,
        [tenantId, dto.date, dto.name],
      );
      return res.rows[0];
    });
  }

  // ── Service units ──────────────────────────────────────────────────────────

  async listServiceUnits(tenantId: string, userId: string) {
    return withTenant({ tenantId, userId }, async (tx) => {
      const res = await tx.query(`SELECT * FROM service_units ORDER BY name`);
      return { data: res.rows };
    });
  }

  async createServiceUnit(tenantId: string, userId: string, dto: CreateServiceUnitRequest) {
    return withTenant({ tenantId, userId }, async (tx) => {
      const res = await tx.query(
        `INSERT INTO service_units (tenant_id, code, name, description)
         VALUES ($1, $2, $3, $4) RETURNING id, code, name, description, created_at`,
        [tenantId, dto.code, dto.name, dto.description ?? null],
      );
      return res.rows[0];
    });
  }

  // ── Operating hours ────────────────────────────────────────────────────────

  async listOperatingHours(tenantId: string, userId: string, branchId?: string) {
    return withTenant({ tenantId, userId }, async (tx) => {
      const params: unknown[] = [];
      let where = '';
      if (branchId) {
        params.push(branchId);
        where = `AND branch_id = $${params.length}`;
      }
      const res = await tx.query(`SELECT * FROM operating_hours WHERE true ${where} ORDER BY day_of_week`, params);
      return { data: res.rows };
    });
  }

  async setOperatingHours(tenantId: string, userId: string, dto: CreateOperatingHoursRequest) {
    return withTenant({ tenantId, userId }, async (tx) => {
      const res = await tx.query(
        `INSERT INTO operating_hours (tenant_id, branch_id, day_of_week, open_time, close_time)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, branch_id, day_of_week, open_time, close_time`,
        [tenantId, dto.branchId, dto.dayOfWeek, dto.openTime, dto.closeTime],
      );
      return res.rows[0];
    });
  }
}
