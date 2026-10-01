/**
 * Tests for TenantConfigService (todo 2.1)
 * - Service catalog, effective-dated price lists, archive
 * - Discount types and payment methods
 * - Holidays and year filtering
 * - Service units and operating hours
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { TenantConfigService } from '../src/tenant-config/tenant-config.service.js';
import { probeDb } from '@clinic/db/tests/helpers.js';
import { createPool } from '@clinic/db';

const hasDb = await probeDb();

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const USER_A = 'a3000000-0000-4000-8000-000000000001';

describe.skipIf(!hasDb)('TenantConfigService (todo 2.1)', () => {
  let service: TenantConfigService;
  const createdServiceIds: string[] = [];
  const createdDiscountIds: string[] = [];
  const createdPaymentMethodIds: string[] = [];
  const createdHolidayIds: string[] = [];
  const createdUnitIds: string[] = [];

  beforeEach(() => {
    service = new TenantConfigService();
  });

  afterAll(async () => {
    const ownerPool = createPool({ role: 'owner' });
    if (createdServiceIds.length > 0) {
      await ownerPool.query(`DELETE FROM price_lists WHERE service_id = ANY($1)`, [createdServiceIds]);
      await ownerPool.query(`DELETE FROM service_catalog WHERE id = ANY($1)`, [createdServiceIds]);
    }
    if (createdDiscountIds.length > 0) {
      await ownerPool.query(`DELETE FROM discount_types WHERE id = ANY($1)`, [createdDiscountIds]);
    }
    if (createdPaymentMethodIds.length > 0) {
      await ownerPool.query(`DELETE FROM payment_methods WHERE id = ANY($1)`, [createdPaymentMethodIds]);
    }
    if (createdHolidayIds.length > 0) {
      await ownerPool.query(`DELETE FROM holidays WHERE id = ANY($1)`, [createdHolidayIds]);
    }
    if (createdUnitIds.length > 0) {
      await ownerPool.query(`DELETE FROM service_units WHERE id = ANY($1)`, [createdUnitIds]);
    }
  });

  describe('service catalog & price lists', () => {
    it('creates a service, adds effective price, lists with price history, and archives', async () => {
      const code = `consult_${Date.now().toString().slice(-4)}`;
      const s = await service.createService(TENANT_A, USER_A, {
        code,
        name: 'General Consultation',
      });
      createdServiceIds.push(s.id);
      expect(s.id).toBeDefined();
      expect(s.code).toBe(code);

      // Add effective price
      const price = await service.addPriceEntry(TENANT_A, USER_A, {
        serviceId: s.id,
        amount: 500.0,
        effectiveFrom: '2026-01-01',
      });
      expect(Number(price.amount)).toBe(500.0);

      // List services
      const list = await service.listServices(TENANT_A, USER_A);
      const found = list.data.find((item: any) => item.id === s.id);
      expect(found).toBeDefined();
      expect(found.price_history).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ amount: 500.0 }),
        ]),
      );

      // Archive service
      const archiveRes = await service.archiveService(TENANT_A, USER_A, s.id);
      expect(archiveRes.archived).toBe(true);

      // Archived service disappears from listServices
      const listAfter = await service.listServices(TENANT_A, USER_A);
      expect(listAfter.data.some((item: any) => item.id === s.id)).toBe(false);
    });
  });

  describe('discount types', () => {
    it('creates and lists discount types', async () => {
      const name = `Senior Citizen ${Date.now().toString().slice(-4)}`;
      const dt = await service.createDiscountType(TENANT_A, USER_A, {
        name,
        percentage: 20.0,
      });
      createdDiscountIds.push(dt.id);
      expect(dt.id).toBeDefined();
      expect(Number(dt.percentage)).toBe(20.0);

      const list = await service.listDiscountTypes(TENANT_A, USER_A);
      expect(list.data.some((d: any) => d.id === dt.id)).toBe(true);
    });
  });

  describe('payment methods', () => {
    it('creates and lists payment methods', async () => {
      const code = `gcash_${Date.now().toString().slice(-4)}`;
      const pm = await service.createPaymentMethod(TENANT_A, USER_A, {
        code,
        name: 'GCash e-Wallet',
      });
      createdPaymentMethodIds.push(pm.id);
      expect(pm.id).toBeDefined();

      const list = await service.listPaymentMethods(TENANT_A, USER_A);
      expect(list.data.some((m: any) => m.id === pm.id)).toBe(true);
    });
  });

  describe('holidays', () => {
    it('creates and lists holidays with year filtering', async () => {
      const h = await service.createHoliday(TENANT_A, USER_A, {
        date: '2026-12-25',
        name: 'Christmas Day',
      });
      createdHolidayIds.push(h.id);
      expect(h.name).toBe('Christmas Day');

      const list2026 = await service.listHolidays(TENANT_A, USER_A, 2026);
      expect(list2026.data.some((row: any) => row.id === h.id)).toBe(true);

      const list2025 = await service.listHolidays(TENANT_A, USER_A, 2025);
      expect(list2025.data.some((row: any) => row.id === h.id)).toBe(false);
    });
  });

  describe('service units', () => {
    it('creates and lists service units', async () => {
      const code = `room_${Date.now().toString().slice(-4)}`;
      const unit = await service.createServiceUnit(TENANT_A, USER_A, {
        code,
        name: 'Consultation Room 1',
        description: 'Main general practice examination room',
      });
      createdUnitIds.push(unit.id);
      expect(unit.id).toBeDefined();

      const list = await service.listServiceUnits(TENANT_A, USER_A);
      expect(list.data.some((u: any) => u.id === unit.id)).toBe(true);
    });
  });

  describe('operating hours', () => {
    it('sets and lists operating hours for a branch', async () => {
      const branchId = 'a1000000-0000-4000-8000-000000000001'; // Main branch
      const op = await service.setOperatingHours(TENANT_A, USER_A, {
        branchId,
        dayOfWeek: 1, // Monday
        openTime: '08:00:00',
        closeTime: '17:00:00',
      });
      expect(op.branch_id).toBe(branchId);
      expect(op.day_of_week).toBe(1);

      const list = await service.listOperatingHours(TENANT_A, USER_A, branchId);
      expect(list.data.length).toBeGreaterThan(0);

      // Cleanup
      const ownerPool = createPool({ role: 'owner' });
      await ownerPool.query(`DELETE FROM operating_hours WHERE id = $1`, [op.id]);
    });
  });
});
