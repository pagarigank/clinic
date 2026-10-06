/**
 * Tests for Phase 2 API Controllers:
 * - PatientsController
 * - TenantConfigController
 * - TemplatesController
 * - FilesController
 * - ReferenceController
 *
 * Asserts request unpacking, service delegation, and response handling.
 */
import { describe, it, expect, vi } from 'vitest';
import { PatientsController } from '../src/patients/patients.controller.js';
import { TenantConfigController } from '../src/tenant-config/tenant-config.controller.js';
import { TemplatesController } from '../src/templates/templates.controller.js';
import { FilesController } from '../src/files/files.controller.js';
import { ReferenceController } from '../src/reference/reference.controller.js';
import type { RequestWithAuth } from '../src/auth/auth-context.js';
import { seedUsers, NO_SEED_USERS } from "@clinic/db/tests/helpers.js";

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const { USER_A: USER_ID } = await seedUsers();

const mockReq = {
  tenantId: TENANT_ID,
  authContext: { userId: USER_ID },
} as RequestWithAuth;

describe('Phase 2 Controllers unit & delegation coverage', () => {
  describe('PatientsController', () => {
    const mockSvc = {
      createPatient: vi.fn().mockResolvedValue({ id: 'pat-1' }),
      getPatient: vi.fn().mockResolvedValue({ id: 'pat-1' }),
      listPatients: vi.fn().mockResolvedValue({ data: [] }),
      updatePatient: vi.fn().mockResolvedValue({ id: 'pat-1' }),
      deactivatePatient: vi.fn().mockResolvedValue({ id: 'pat-1', status: 'INACTIVE' }),
      markDeceased: vi.fn().mockResolvedValue({ id: 'pat-1', status: 'DECEASED' }),
      addIdentifier: vi.fn().mockResolvedValue({ id: 'id-1' }),
      revealIdentifier: vi.fn().mockResolvedValue({ id: 'id-1', value: 'secret' }),
      addContact: vi.fn().mockResolvedValue({ id: 'cnt-1' }),
      addAllergy: vi.fn().mockResolvedValue({ id: 'alg-1' }),
      addFlag: vi.fn().mockResolvedValue({ id: 'flg-1' }),
      findDuplicates: vi.fn().mockResolvedValue({ data: [] }),
      checkDuplicates: vi.fn().mockResolvedValue({ candidates: [] }),
      acknowledgeDuplicates: vi.fn().mockResolvedValue({ acknowledged: true }),
      mergePatients: vi.fn().mockResolvedValue({ mergeId: 'mrg-1' }),
      unmergePatients: vi.fn().mockResolvedValue({ unmerged: true }),
      captureConsent: vi.fn().mockResolvedValue({ id: 'cst-1' }),
      withdrawConsent: vi.fn().mockResolvedValue({ id: 'cst-1', status: 'WITHDRAWN' }),
      upsertPhilHealth: vi.fn().mockResolvedValue({ pin: '12345' }),
      addPhilHealthDependent: vi.fn().mockResolvedValue({ id: 'dep-1' }),
      getAccessLog: vi.fn().mockResolvedValue({ data: [] }),
      getSummary: vi.fn().mockResolvedValue({ id: 'pat-1' }),
    };

    const ctrl = new PatientsController(mockSvc as any);

    it('delegates CRUD and lifecycle actions', async () => {
      await ctrl.createPatient(mockReq, { firstName: 'Jane', lastName: 'Doe', dateOfBirth: '1990-01-01', gender: 'F' } as any);
      expect(mockSvc.createPatient).toHaveBeenCalledWith(TENANT_ID, USER_ID, expect.anything());

      await ctrl.getPatient(mockReq, 'pat-1');
      expect(mockSvc.getPatient).toHaveBeenCalledWith(TENANT_ID, USER_ID, 'pat-1');

      await ctrl.listPatients(mockReq, 'Jane', 'cursor-1');
      expect(mockSvc.listPatients).toHaveBeenCalledWith(TENANT_ID, USER_ID, 'Jane', 'cursor-1');

      await ctrl.updatePatient(mockReq, 'pat-1', { firstName: 'Janet', rowVersion: 1 } as any);
      expect(mockSvc.updatePatient).toHaveBeenCalledWith(TENANT_ID, USER_ID, 'pat-1', expect.anything());

      await ctrl.deactivatePatient(mockReq, 'pat-1', { reason: 'Moved', rowVersion: 2 } as any);
      expect(mockSvc.deactivatePatient).toHaveBeenCalledWith(TENANT_ID, USER_ID, 'pat-1', expect.anything());

      await ctrl.markDeceased(mockReq, 'pat-1', { dateOfDeath: '2026-01-01', rowVersion: 3 } as any);
      expect(mockSvc.markDeceased).toHaveBeenCalledWith(TENANT_ID, USER_ID, 'pat-1', expect.anything());
    });

    it('delegates identifiers, contacts, allergies, flags', async () => {
      await ctrl.addIdentifier(mockReq, 'pat-1', { type: 'PHILHEALTH', value: '123' } as any);
      expect(mockSvc.addIdentifier).toHaveBeenCalledWith(TENANT_ID, USER_ID, 'pat-1', expect.anything());

      await ctrl.revealIdentifier(mockReq, 'pat-1', 'id-1', { reason: 'Verification' });
      expect(mockSvc.revealIdentifier).toHaveBeenCalledWith(TENANT_ID, USER_ID, 'pat-1', 'id-1', expect.anything());

      await ctrl.addContact(mockReq, 'pat-1', { type: 'MOBILE', value: '0917' } as any);
      expect(mockSvc.addContact).toHaveBeenCalledWith(TENANT_ID, USER_ID, 'pat-1', expect.anything());

      await ctrl.addAllergy(mockReq, 'pat-1', { substance: 'Penicillin', severity: 'SEVERE' } as any);
      expect(mockSvc.addAllergy).toHaveBeenCalledWith(TENANT_ID, USER_ID, 'pat-1', expect.anything());

      await ctrl.addFlag(mockReq, 'pat-1', { title: 'VIP', level: 'INFO' } as any);
      expect(mockSvc.addFlag).toHaveBeenCalledWith(TENANT_ID, USER_ID, 'pat-1', expect.anything());
    });

    it('delegates duplicate checks, merge, unmerge, consent, PhilHealth, access log, summary', async () => {
      await ctrl.findDuplicates(mockReq, 'pat-1');
      expect(mockSvc.findDuplicates).toHaveBeenCalledWith(TENANT_ID, USER_ID, 'pat-1');

      await ctrl.checkDuplicates(mockReq, { firstName: 'Jane', lastName: 'Doe', dateOfBirth: '1990-01-01' } as any);
      expect(mockSvc.checkDuplicates).toHaveBeenCalledWith(TENANT_ID, USER_ID, expect.anything());

      await ctrl.acknowledgeDuplicates(mockReq, 'pat-1', { candidateIds: ['pat-2'], reason: 'Not same person' } as any);
      expect(mockSvc.acknowledgeDuplicates).toHaveBeenCalledWith(TENANT_ID, USER_ID, 'pat-1', expect.anything());

      await ctrl.mergePatients(mockReq, { survivingPatientId: 'pat-1', mergedPatientId: 'pat-2', reason: 'Duplicate' } as any);
      expect(mockSvc.mergePatients).toHaveBeenCalledWith(TENANT_ID, USER_ID, expect.anything());

      await ctrl.mergeIntoThisPatient(mockReq, 'pat-1', { survivingPatientId: 'pat-1', mergedPatientId: 'pat-2', reason: 'Duplicate' } as any);
      expect(mockSvc.mergePatients).toHaveBeenCalledTimes(2);

      await ctrl.unmergePatients(mockReq, 'mrg-1');
      expect(mockSvc.unmergePatients).toHaveBeenCalledWith(TENANT_ID, USER_ID, 'mrg-1');

      await ctrl.captureConsent(mockReq, 'pat-1', { templateVersionId: 'ver-1' } as any);
      expect(mockSvc.captureConsent).toHaveBeenCalledWith(TENANT_ID, USER_ID, 'pat-1', expect.anything());

      await ctrl.withdrawConsent(mockReq, 'pat-1', 'cst-1', { reason: 'Revoked' } as any);
      expect(mockSvc.withdrawConsent).toHaveBeenCalledWith(TENANT_ID, USER_ID, 'pat-1', 'cst-1', expect.anything());

      await ctrl.upsertPhilHealth(mockReq, 'pat-1', { pin: '123', membershipCategory: 'MEMBER' } as any);
      expect(mockSvc.upsertPhilHealth).toHaveBeenCalledWith(TENANT_ID, USER_ID, 'pat-1', expect.anything());

      await ctrl.addPhilHealthDependent(mockReq, 'pat-1', { dependentFirstName: 'Kid', dependentLastName: 'Doe', dependentDob: '2020-01-01', dependentRelationship: 'CHILD' } as any);
      expect(mockSvc.addPhilHealthDependent).toHaveBeenCalledWith(TENANT_ID, USER_ID, 'pat-1', expect.anything());

      await ctrl.getAccessLog(mockReq, 'pat-1');
      expect(mockSvc.getAccessLog).toHaveBeenCalledWith(TENANT_ID, USER_ID, 'pat-1');

      await ctrl.getSummary(mockReq, 'pat-1');
      expect(mockSvc.getSummary).toHaveBeenCalledWith(TENANT_ID, USER_ID, 'pat-1');
    });
  });

  describe('TenantConfigController', () => {
    const mockSvc = {
      listServices: vi.fn().mockResolvedValue({ data: [] }),
      createService: vi.fn().mockResolvedValue({ id: 'srv-1' }),
      archiveService: vi.fn().mockResolvedValue({ archived: true }),
      addPriceEntry: vi.fn().mockResolvedValue({ id: 'pl-1' }),
      listDiscountTypes: vi.fn().mockResolvedValue({ data: [] }),
      createDiscountType: vi.fn().mockResolvedValue({ id: 'dsc-1' }),
      listPaymentMethods: vi.fn().mockResolvedValue({ data: [] }),
      createPaymentMethod: vi.fn().mockResolvedValue({ id: 'pm-1' }),
      listHolidays: vi.fn().mockResolvedValue({ data: [] }),
      createHoliday: vi.fn().mockResolvedValue({ id: 'hol-1' }),
      listServiceUnits: vi.fn().mockResolvedValue({ data: [] }),
      createServiceUnit: vi.fn().mockResolvedValue({ id: 'su-1' }),
      listOperatingHours: vi.fn().mockResolvedValue({ data: [] }),
      setOperatingHours: vi.fn().mockResolvedValue({ id: 'oh-1' }),
    };

    const ctrl = new TenantConfigController(mockSvc as any);

    it('delegates service catalog and price list actions and aliases', async () => {
      await ctrl.listServiceCatalog(mockReq);
      expect(mockSvc.listServices).toHaveBeenCalledWith(TENANT_ID, USER_ID);

      await ctrl.listServicesAlias(mockReq);
      expect(mockSvc.listServices).toHaveBeenCalledTimes(2);

      await ctrl.createServiceCatalog(mockReq, { code: 'SRV', name: 'Service' } as any);
      expect(mockSvc.createService).toHaveBeenCalledWith(TENANT_ID, USER_ID, expect.anything());

      await ctrl.createServiceAlias(mockReq, { code: 'SRV', name: 'Service' } as any);
      expect(mockSvc.createService).toHaveBeenCalledTimes(2);

      await ctrl.archiveService(mockReq, 'srv-1');
      expect(mockSvc.archiveService).toHaveBeenCalledWith(TENANT_ID, USER_ID, 'srv-1');

      await ctrl.archiveServiceAlias(mockReq, 'srv-1');
      expect(mockSvc.archiveService).toHaveBeenCalledTimes(2);

      await ctrl.addPrice(mockReq, { serviceId: 'srv-1', amount: 100, effectiveFrom: '2026-01-01' } as any);
      expect(mockSvc.addPriceEntry).toHaveBeenCalledWith(TENANT_ID, USER_ID, expect.anything());

      await ctrl.addPriceAlias(mockReq, { serviceId: 'srv-1', amount: 100, effectiveFrom: '2026-01-01' } as any);
      expect(mockSvc.addPriceEntry).toHaveBeenCalledTimes(2);
    });

    it('delegates discounts, payments, holidays, units, hours and aliases', async () => {
      await ctrl.listDiscountTypes(mockReq);
      await ctrl.listDiscountTypesAlias(mockReq);
      expect(mockSvc.listDiscountTypes).toHaveBeenCalledTimes(2);

      await ctrl.createDiscountType(mockReq, { name: 'Senior', percentage: 20 } as any);
      await ctrl.createDiscountTypeAlias(mockReq, { name: 'Senior', percentage: 20 } as any);
      expect(mockSvc.createDiscountType).toHaveBeenCalledTimes(2);

      await ctrl.listPaymentMethods(mockReq);
      await ctrl.listPaymentMethodsAlias(mockReq);
      expect(mockSvc.listPaymentMethods).toHaveBeenCalledTimes(2);

      await ctrl.createPaymentMethod(mockReq, { code: 'CASH', name: 'Cash' } as any);
      await ctrl.createPaymentMethodAlias(mockReq, { code: 'CASH', name: 'Cash' } as any);
      expect(mockSvc.createPaymentMethod).toHaveBeenCalledTimes(2);

      await ctrl.listHolidays(mockReq, '2026');
      await ctrl.listHolidaysAlias(mockReq);
      expect(mockSvc.listHolidays).toHaveBeenCalledTimes(2);

      await ctrl.createHoliday(mockReq, { date: '2026-12-25', name: 'Christmas' } as any);
      await ctrl.createHolidayAlias(mockReq, { date: '2026-12-25', name: 'Christmas' } as any);
      expect(mockSvc.createHoliday).toHaveBeenCalledTimes(2);

      await ctrl.listServiceUnits(mockReq);
      expect(mockSvc.listServiceUnits).toHaveBeenCalledWith(TENANT_ID, USER_ID);

      await ctrl.createServiceUnit(mockReq, { code: 'R1', name: 'Room 1' } as any);
      expect(mockSvc.createServiceUnit).toHaveBeenCalledWith(TENANT_ID, USER_ID, expect.anything());

      await ctrl.listOperatingHours(mockReq, 'branch-1');
      expect(mockSvc.listOperatingHours).toHaveBeenCalledWith(TENANT_ID, USER_ID, 'branch-1');

      await ctrl.setOperatingHours(mockReq, { branchId: 'branch-1', dayOfWeek: 1, openTime: '08:00', closeTime: '17:00' } as any);
      expect(mockSvc.setOperatingHours).toHaveBeenCalledWith(TENANT_ID, USER_ID, expect.anything());
    });
  });

  describe('TemplatesController', () => {
    const mockSvc = {
      listTemplates: vi.fn().mockResolvedValue({ data: [] }),
      createTemplate: vi.fn().mockResolvedValue({ id: 'tmpl-1' }),
      addVersion: vi.fn().mockResolvedValue({ id: 'ver-2' }),
      publishVersion: vi.fn().mockResolvedValue({ is_published: true }),
      previewVersion: vi.fn().mockResolvedValue({ content: 'test' }),
    };

    const ctrl = new TemplatesController(mockSvc as any);

    it('delegates templates methods', async () => {
      await ctrl.listTemplates(mockReq, 'CONSENT');
      expect(mockSvc.listTemplates).toHaveBeenCalledWith(TENANT_ID, USER_ID, 'CONSENT');

      await ctrl.createTemplate(mockReq, { type: 'CONSENT', code: 'C1', name: 'Consent', content: 'body' } as any);
      expect(mockSvc.createTemplate).toHaveBeenCalledWith(TENANT_ID, USER_ID, expect.anything());

      await ctrl.addVersion(mockReq, 'tmpl-1', { content: 'body v2' });
      expect(mockSvc.addVersion).toHaveBeenCalledWith(TENANT_ID, USER_ID, 'tmpl-1', 'body v2');

      await ctrl.publishVersion(mockReq, 'tmpl-1', 'ver-2');
      expect(mockSvc.publishVersion).toHaveBeenCalledWith(TENANT_ID, USER_ID, 'tmpl-1', 'ver-2');

      await ctrl.previewVersion(mockReq, 'tmpl-1', 'ver-2');
      expect(mockSvc.previewVersion).toHaveBeenCalledWith(TENANT_ID, USER_ID, 'tmpl-1', 'ver-2');
    });
  });

  describe('FilesController', () => {
    const mockSvc = {
      requestUpload: vi.fn().mockResolvedValue({ uploadUrl: 'http://s3' }),
      completeUpload: vi.fn().mockResolvedValue({ status: 'READY' }),
      getFile: vi.fn().mockResolvedValue({ id: 'file-1' }),
      getDownloadUrl: vi.fn().mockResolvedValue({ downloadUrl: 'http://s3/down' }),
    };

    const ctrl = new FilesController(mockSvc as any);

    it('delegates files methods', async () => {
      await ctrl.requestUpload(mockReq, { fileName: 'test.pdf', mimeType: 'application/pdf', sizeBytes: 100 });
      expect(mockSvc.requestUpload).toHaveBeenCalledWith(TENANT_ID, USER_ID, expect.anything());

      await ctrl.completeUpload(mockReq, 'file-1');
      expect(mockSvc.completeUpload).toHaveBeenCalledWith(TENANT_ID, USER_ID, 'file-1');

      await ctrl.getFile(mockReq, 'file-1');
      expect(mockSvc.getFile).toHaveBeenCalledWith(TENANT_ID, USER_ID, 'file-1');

      await ctrl.getDownloadUrl(mockReq, 'file-1');
      expect(mockSvc.getDownloadUrl).toHaveBeenCalledWith(TENANT_ID, USER_ID, 'file-1');

      await ctrl.getDownloadUrlAlias(mockReq, 'file-1');
      expect(mockSvc.getDownloadUrl).toHaveBeenCalledTimes(2);
    });
  });

  describe('ReferenceController', () => {
    const ctrl = new ReferenceController();

    it('can execute reference queries without throwing', async () => {
      const icd10 = await ctrl.listIcd10('cholera');
      expect(icd10.data).toBeDefined();

      const psgc = await ctrl.listPsgc('NCR');
      expect(psgc.data).toBeDefined();

      const loinc = await ctrl.listLoinc('glucose');
      expect(loinc.data).toBeDefined();

      const drugs = await ctrl.listDrugSchedules();
      expect(drugs.data).toBeDefined();
    });

    it('supports full ICD-10 CRUD lifecycle and duplicate prevention', async () => {
      const testCode = 'T99.9';
      try { await ctrl.deleteIcd10(testCode); } catch {}

      // Create
      const created = await ctrl.createIcd10({ code: testCode, description: 'Test condition for automated check' });
      expect(created.code).toBe(testCode);
      expect(created.description).toBe('Test condition for automated check');

      // Duplicate rejection
      await expect(ctrl.createIcd10({ code: testCode, description: 'Duplicate test' })).rejects.toThrow();

      // Read single
      const fetched = await ctrl.getIcd10(testCode);
      expect(fetched.code).toBe(testCode);

      // Update
      const updated = await ctrl.updateIcd10(testCode, { description: 'Updated test condition' });
      expect(updated.description).toBe('Updated test condition');

      // List with query filter
      const list = await ctrl.listIcd10('Updated test condition');
      expect(list.data.some((d: any) => d.code === testCode)).toBe(true);

      // Seed common (idempotent)
      const seedRes = await ctrl.seedCommonIcd10();
      expect(seedRes.success).toBe(true);

      // Delete
      const deleted = await ctrl.deleteIcd10(testCode);
      expect(deleted.success).toBe(true);

      // Delete again -> 404
      await expect(ctrl.deleteIcd10(testCode)).rejects.toThrow();
    });
  });
});
