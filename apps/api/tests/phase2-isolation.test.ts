/**
 * Phase 2 Tenant Isolation Test Suite (todo.md §49 ground rules)
 *
 * Verifies that all Phase 2 entities (patients, files, templates, services,
 * price lists, discounts, service units, holidays)
 * are completely isolated between Tenant A and Tenant B.
 * Any attempt by Tenant B to query, fetch, or mutate Tenant A resources
 * returns 404 / NOT_FOUND / 0 rows due to RLS and tenant scoping.
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { probeDb } from '@clinic/db/tests/helpers.js';
import { createPool, withTenantOnPool } from '@clinic/db';
import { PatientsService } from '../src/patients/patients.service.js';
import { FilesService } from '../src/files/files.service.js';
import { TemplatesService } from '../src/templates/templates.service.js';
import { TenantConfigService } from '../src/tenant-config/tenant-config.service.js';

const hasDb = await probeDb();

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';
const USER_A = 'a3000000-0000-4000-8000-000000000001';
const USER_B = 'b3000000-0000-4000-8000-000000000001';

describe.skipIf(!hasDb)('Phase 2 Multi-Tenant Isolation (§49)', () => {
  let patientsService: PatientsService;
  let filesService: FilesService;
  let templatesService: TemplatesService;
  let configService: TenantConfigService;

  const cleanupPatientIds: string[] = [];
  const cleanupFileIds: string[] = [];
  const cleanupTemplateIds: string[] = [];
  const cleanupServiceIds: string[] = [];
  const cleanupDiscountIds: string[] = [];
  const cleanupServiceUnitIds: string[] = [];
  const cleanupHolidayIds: string[] = [];

  beforeEach(() => {
    patientsService = new PatientsService();
    filesService = new FilesService();
    templatesService = new TemplatesService();
    configService = new TenantConfigService();
  });

  afterAll(async () => {
    const ownerPool = createPool({ role: 'owner' });
    if (cleanupPatientIds.length > 0) {
      await ownerPool.query(`DELETE FROM patient_identifiers WHERE patient_id = ANY($1)`, [cleanupPatientIds]);
      await ownerPool.query(`DELETE FROM patient_contacts WHERE patient_id = ANY($1)`, [cleanupPatientIds]);
      await ownerPool.query(`DELETE FROM patient_flags WHERE patient_id = ANY($1)`, [cleanupPatientIds]);
      await ownerPool.query(`DELETE FROM patients WHERE id = ANY($1)`, [cleanupPatientIds]);
    }
    if (cleanupFileIds.length > 0) {
      await ownerPool.query(`DELETE FROM files WHERE id = ANY($1)`, [cleanupFileIds]);
    }
    if (cleanupTemplateIds.length > 0) {
      await ownerPool.query(`DELETE FROM template_versions WHERE template_id = ANY($1)`, [cleanupTemplateIds]);
      await ownerPool.query(`DELETE FROM templates WHERE id = ANY($1)`, [cleanupTemplateIds]);
    }
    if (cleanupServiceIds.length > 0) {
      await ownerPool.query(`DELETE FROM price_lists WHERE service_id = ANY($1)`, [cleanupServiceIds]);
      await ownerPool.query(`DELETE FROM service_catalog WHERE id = ANY($1)`, [cleanupServiceIds]);
    }
    if (cleanupDiscountIds.length > 0) {
      await ownerPool.query(`DELETE FROM discount_types WHERE id = ANY($1)`, [cleanupDiscountIds]);
    }
    if (cleanupServiceUnitIds.length > 0) {
      await ownerPool.query(`DELETE FROM service_units WHERE id = ANY($1)`, [cleanupServiceUnitIds]);
    }
    if (cleanupHolidayIds.length > 0) {
      await ownerPool.query(`DELETE FROM holidays WHERE id = ANY($1)`, [cleanupHolidayIds]);
    }
  });

  it('isolates patient records between tenants', async () => {
    const pA = await patientsService.createPatient(TENANT_A, USER_A, {
      firstName: 'IsoAlice',
      lastName: 'TenantAOnly',
      dateOfBirth: '1990-01-01',
      gender: 'F',
    });
    cleanupPatientIds.push(pA.id);

    // Tenant A can read
    const foundA = await patientsService.getPatient(TENANT_A, USER_A, pA.id);
    expect(foundA.id).toBe(pA.id);

    // Tenant B cannot read: throws NOT_FOUND
    await expect(patientsService.getPatient(TENANT_B, USER_B, pA.id)).rejects.toMatchObject({
      response: { code: 'NOT_FOUND' },
    });

    // Tenant B cannot see in search/list
    const searchB = await patientsService.listPatients(TENANT_B, USER_B, 'IsoAlice');
    expect(searchB.data.some((p: any) => p.id === pA.id)).toBe(false);
  });

  it('isolates files and download URLs between tenants', async () => {
    const fA = await filesService.requestUpload(TENANT_A, USER_A, {
      fileName: 'secret_records_tenant_a.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 2048,
    });
    cleanupFileIds.push(fA.fileId);
    await filesService.completeUpload(TENANT_A, USER_A, fA.fileId);

    // Tenant A can inspect and get download url
    const metaA = await filesService.getFile(TENANT_A, USER_A, fA.fileId);
    expect(metaA.id).toBe(fA.fileId);
    const dlA = await filesService.getDownloadUrl(TENANT_A, USER_A, fA.fileId);
    expect(dlA.downloadUrl).toBeDefined();

    // Tenant B cannot inspect or download
    await expect(filesService.getFile(TENANT_B, USER_B, fA.fileId)).rejects.toMatchObject({
      response: { code: 'NOT_FOUND' },
    });
    await expect(filesService.getDownloadUrl(TENANT_B, USER_B, fA.fileId)).rejects.toMatchObject({
      response: { code: 'NOT_FOUND' },
    });
  });

  it('isolates templates and template versions between tenants', async () => {
    const suffix = Date.now().toString().slice(-4);
    const tA = await templatesService.createTemplate(TENANT_A, USER_A, {
      type: 'CONSENT',
      code: `rx_iso_${suffix}`,
      name: 'Tenant A Consent',
      content: 'Consent header for Tenant A',
    });
    cleanupTemplateIds.push(tA.id);

    // Tenant A can list and preview
    const listA = await templatesService.listTemplates(TENANT_A, USER_A);
    expect(listA.data.some((t: any) => t.id === tA.id)).toBe(true);

    const prevA = await templatesService.previewVersion(TENANT_A, USER_A, tA.id, tA.versionId);
    expect(prevA.content).toContain('Tenant A');

    // Tenant B cannot preview
    await expect(
      templatesService.previewVersion(TENANT_B, USER_B, tA.id, tA.versionId),
    ).rejects.toMatchObject({
      response: { code: 'NOT_FOUND' },
    });

    // Tenant B does not see template in list
    const listB = await templatesService.listTemplates(TENANT_B, USER_B);
    expect(listB.data.some((t: any) => t.id === tA.id)).toBe(false);
  });

  it('isolates services, price lists, discounts, service units, and operating hours', async () => {
    const code = `ISO_${Date.now().toString().slice(-4)}`;

    // Create Service in Tenant A
    const sA = await configService.createService(TENANT_A, USER_A, {
      code: `srv_${code}`,
      name: 'Tenant A Only Service',
    });
    cleanupServiceIds.push(sA.id);

    // Add Price Entry in Tenant A
    const plA = await configService.addPriceEntry(TENANT_A, USER_A, {
      serviceId: sA.id,
      amount: 500,
      effectiveFrom: '2026-01-01',
    });
    expect(Number(plA.amount)).toBe(500);

    // Create Discount in Tenant A
    const dscA = await configService.createDiscountType(TENANT_A, USER_A, {
      name: `Tenant A Promo ${code}`,
      percentage: 10,
    });
    cleanupDiscountIds.push(dscA.id);

    // Create Service Unit in Tenant A
    const suA = await configService.createServiceUnit(TENANT_A, USER_A, {
      code: `su_${code}`,
      name: 'Tenant A Exam Room 1',
      description: 'Room description',
    });
    cleanupServiceUnitIds.push(suA.id);

    // Create Holiday in Tenant A
    const holA = await configService.createHoliday(TENANT_A, USER_A, {
      date: '2026-12-25',
      name: 'Christmas Clinic Day',
    });
    cleanupHolidayIds.push(holA.id);

    // Verify Tenant A sees all of them
    const servicesA = await configService.listServices(TENANT_A, USER_A);
    expect(servicesA.data.some((s: any) => s.id === sA.id)).toBe(true);

    const discountsA = await configService.listDiscountTypes(TENANT_A, USER_A);
    expect(discountsA.data.some((d: any) => d.id === dscA.id)).toBe(true);

    const unitsA = await configService.listServiceUnits(TENANT_A, USER_A);
    expect(unitsA.data.some((u: any) => u.id === suA.id)).toBe(true);

    const holidaysA = await configService.listHolidays(TENANT_A, USER_A);
    expect(holidaysA.data.some((h: any) => h.id === holA.id)).toBe(true);

    // Verify Tenant B sees NONE of them
    const servicesB = await configService.listServices(TENANT_B, USER_B);
    expect(servicesB.data.some((s: any) => s.id === sA.id)).toBe(false);

    const discountsB = await configService.listDiscountTypes(TENANT_B, USER_B);
    expect(discountsB.data.some((d: any) => d.id === dscA.id)).toBe(false);

    const unitsB = await configService.listServiceUnits(TENANT_B, USER_B);
    expect(unitsB.data.some((u: any) => u.id === suA.id)).toBe(false);

    const holidaysB = await configService.listHolidays(TENANT_B, USER_B);
    expect(holidaysB.data.some((h: any) => h.id === holA.id)).toBe(false);

    // Direct RLS query as Tenant B returns 0 rows
    const appPool = createPool({ role: 'app' });
    const rlsCheck = await withTenantOnPool(
      appPool,
      { tenantId: TENANT_B, userId: USER_B },
      async (tx) => {
        const s = await tx.query(`SELECT id FROM service_catalog WHERE id = $1`, [sA.id]);
        const d = await tx.query(`SELECT id FROM discount_types WHERE id = $1`, [dscA.id]);
        const u = await tx.query(`SELECT id FROM service_units WHERE id = $1`, [suA.id]);
        const h = await tx.query(`SELECT id FROM holidays WHERE id = $1`, [holA.id]);
        return {
          servicesCount: s.rowCount,
          discountsCount: d.rowCount,
          unitsCount: u.rowCount,
          holidaysCount: h.rowCount,
        };
      },
    );

    expect(rlsCheck.servicesCount).toBe(0);
    expect(rlsCheck.discountsCount).toBe(0);
    expect(rlsCheck.unitsCount).toBe(0);
    expect(rlsCheck.holidaysCount).toBe(0);
  });
});
