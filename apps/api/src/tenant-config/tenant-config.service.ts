import { Injectable } from '@nestjs/common';
import { withTenant } from '@clinic/db';
import { ProblemException } from '../http/problem.exception.js';
import type {
  CreateServiceRequest,
  CreatePriceListRequest,
  BulkPriceAdjustRequest,
  CreateDiscountTypeRequest,
  CreatePaymentMethodRequest,
  CreateHolidayRequest,
  CreateServiceUnitRequest,
  CreateOperatingHoursRequest,
  UpdateClinicProfileRequest,
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
        `INSERT INTO service_catalog (tenant_id, branch_id, code, name, category, default_price)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, code, name, category, default_price, is_active, created_at`,
        [tenantId, dto.branchId ?? null, dto.code, dto.name, dto.category, dto.defaultPrice],
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

  async bulkAdjustPricing(tenantId: string, userId: string, dto: BulkPriceAdjustRequest) {
    return withTenant({ tenantId, userId }, async (tx) => {
      // 1. Identify services based on target
      let targetServiceIds: string[] = [];
      if (dto.target === 'LABORATORY') {
        const res = await tx.query<{ id: string }>(
          `SELECT sc.id
           FROM service_catalog sc
           WHERE sc.tenant_id = $1 AND sc.deleted_at IS NULL
             AND (sc.category = 'lab' OR sc.id IN (SELECT service_id FROM lab_tests WHERE service_id IS NOT NULL AND tenant_id = $1))`,
          [tenantId],
        );
        targetServiceIds = res.rows.map((r) => r.id);
      } else if (dto.target === 'PHARMACY') {
        const res = await tx.query<{ id: string }>(
          `SELECT sc.id
           FROM service_catalog sc
           WHERE sc.tenant_id = $1 AND sc.deleted_at IS NULL
             AND (sc.code LIKE 'RX-%' OR sc.id IN (SELECT service_id FROM items WHERE item_type = 'MEDICINE' AND service_id IS NOT NULL AND tenant_id = $1))`,
          [tenantId],
        );
        targetServiceIds = res.rows.map((r) => r.id);
      } else if (dto.target === 'CENTRAL_SUPPLY') {
        const res = await tx.query<{ id: string }>(
          `SELECT sc.id
           FROM service_catalog sc
           WHERE sc.tenant_id = $1 AND sc.deleted_at IS NULL
             AND (sc.code LIKE 'SUP-%' OR sc.id IN (SELECT service_id FROM items WHERE item_type IN ('SUPPLY', 'CONSUMABLE', 'EQUIPMENT', 'REAGENT') AND service_id IS NOT NULL AND tenant_id = $1))`,
          [tenantId],
        );
        targetServiceIds = res.rows.map((r) => r.id);
      } else {
        // ALL
        const res = await tx.query<{ id: string }>(
          `SELECT sc.id FROM service_catalog sc WHERE sc.tenant_id = $1 AND sc.deleted_at IS NULL`,
          [tenantId],
        );
        targetServiceIds = res.rows.map((r) => r.id);
      }

      if (targetServiceIds.length === 0) {
        return {
          adjustedCount: 0,
          target: dto.target,
          direction: dto.direction,
          adjustmentType: dto.adjustmentType,
          value: dto.value,
          message: `No matching active items found for ${dto.target}`,
        };
      }

      // 2. Perform adjustment in database
      const isPercent = dto.adjustmentType === 'PERCENTAGE';
      const isIncrease = dto.direction === 'INCREASE';
      const val = Number(dto.value);

      let updateQuery = '';
      if (isPercent) {
        const factor = isIncrease ? 1 + val / 100 : Math.max(0, 1 - val / 100);
        updateQuery = `
          UPDATE service_catalog
          SET default_price = ROUND((default_price * ${factor})::numeric, 2),
              updated_at = now()
          WHERE tenant_id = $1 AND id = ANY($2::uuid[])
          RETURNING id, default_price
        `;
      } else {
        const op = isIncrease ? '+' : '-';
        updateQuery = `
          UPDATE service_catalog
          SET default_price = GREATEST(0, ROUND((default_price ${op} ${val})::numeric, 2)),
              updated_at = now()
          WHERE tenant_id = $1 AND id = ANY($2::uuid[])
          RETURNING id, default_price
        `;
      }

      const updated = await tx.query<{ id: string; default_price: string }>(updateQuery, [
        tenantId,
        targetServiceIds,
      ]);

      // 3. Insert effective-dated entries into price_lists
      for (const row of updated.rows) {
        await tx.query(
          `INSERT INTO price_lists (tenant_id, service_id, amount, effective_from)
           VALUES ($1, $2, $3, COALESCE($4::date, CURRENT_DATE))`,
          [tenantId, row.id, Number(row.default_price), dto.effectiveFrom ?? null],
        );
      }

      return {
        adjustedCount: updated.rowCount ?? 0,
        count: updated.rowCount ?? 0,
        target: dto.target,
        direction: dto.direction,
        adjustmentType: dto.adjustmentType,
        value: dto.value,
        effectiveFrom: dto.effectiveFrom ?? new Date().toISOString().slice(0, 10),
        message: `Successfully adjusted ${updated.rowCount ?? 0} item prices for ${dto.target} (${isIncrease ? '+' : '-'}${dto.value}${isPercent ? '%' : ''}).`,
      };
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

  // ── Clinic Profile & Printout Letterhead ─────────────────────────────────────

  async getClinicProfile(tenantId: string, userId?: string) {
    return withTenant({ tenantId, userId }, async (tx) => {
      const res = await tx.query(
        `SELECT id, name, slug, tagline, address, phone, email, website,
                doh_license_no AS "dohLicenseNo",
                philhealth_accreditation_no AS "philhealthAccreditationNo",
                tin,
                letterhead_footer AS "letterheadFooter"
         FROM tenants
         WHERE id = $1`,
        [tenantId],
      );
      if ((res.rowCount ?? 0) === 0) {
        throw new ProblemException('NOT_FOUND', { detail: 'Tenant profile not found' });
      }
      return res.rows[0];
    });
  }

  async updateClinicProfile(tenantId: string, userId: string, dto: UpdateClinicProfileRequest) {
    return withTenant({ tenantId, userId }, async (tx) => {
      const res = await tx.query(
        `UPDATE tenants
         SET name = $1,
             tagline = $2,
             address = $3,
             phone = $4,
             email = $5,
             website = $6,
             doh_license_no = $7,
             philhealth_accreditation_no = $8,
             tin = $9,
             letterhead_footer = $10,
             updated_at = now(),
             updated_by = $11
         WHERE id = $12
         RETURNING id, name, slug, tagline, address, phone, email, website,
                   doh_license_no AS "dohLicenseNo",
                   philhealth_accreditation_no AS "philhealthAccreditationNo",
                   tin,
                   letterhead_footer AS "letterheadFooter"`,
        [
          dto.name.trim(),
          dto.tagline?.trim() || null,
          dto.address?.trim() || null,
          dto.phone?.trim() || null,
          dto.email?.trim() || null,
          dto.website?.trim() || null,
          dto.dohLicenseNo?.trim() || null,
          dto.philhealthAccreditationNo?.trim() || null,
          dto.tin?.trim() || null,
          dto.letterheadFooter?.trim() || null,
          userId,
          tenantId,
        ],
      );
      if ((res.rowCount ?? 0) === 0) {
        throw new ProblemException('NOT_FOUND', { detail: 'Tenant profile not found' });
      }
      return res.rows[0];
    });
  }
}

