/**
 * Tests for PatientsService (todo 2.2 ⛔)
 * - Patient CRUD with optimistic concurrency
 * - Append-only deactivation & mark deceased (no hard delete)
 * - Identifiers with masked return and reveal-with-reason (logged to phi_access_log)
 * - Trigram duplicate search and acknowledgement
 * - Merge with snapshot and unmerge (AC-9, AC-12)
 * - Consent capture, emergency registration, withdrawal
 * - PhilHealth member data and dependents
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { PatientsService } from '../src/patients/patients.service.js';
import { ProblemException } from '../src/http/problem.exception.js';
import { probeDb } from '@clinic/db/tests/helpers.js';
import { withTenant } from '@clinic/db';

const hasDb = await probeDb();

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const USER_A = 'a3000000-0000-4000-8000-000000000001';

describe.skipIf(!hasDb)('PatientsService (todo 2.2)', () => {
  let service: PatientsService;
  const createdPatientIds: string[] = [];

  beforeEach(() => {
    service = new PatientsService();
  });

  afterAll(async () => {
    if (createdPatientIds.length > 0) {
      const { createPool } = await import('@clinic/db');
      const ownerPool = createPool({ role: 'owner' });
      // Clean up in reverse dependency order
      await ownerPool.query(`DELETE FROM patient_flags WHERE patient_id = ANY($1)`, [createdPatientIds]);
      await ownerPool.query(`DELETE FROM patient_allergies WHERE patient_id = ANY($1)`, [createdPatientIds]);
      await ownerPool.query(`DELETE FROM patient_contacts WHERE patient_id = ANY($1)`, [createdPatientIds]);
      await ownerPool.query(`DELETE FROM patient_identifiers WHERE patient_id = ANY($1)`, [createdPatientIds]);
      await ownerPool.query(`DELETE FROM patient_consents WHERE patient_id = ANY($1)`, [createdPatientIds]);
      await ownerPool.query(`DELETE FROM patient_philhealth_dependents WHERE patient_id = ANY($1)`, [createdPatientIds]);
      await ownerPool.query(`DELETE FROM patient_philhealth WHERE patient_id = ANY($1)`, [createdPatientIds]);
      await ownerPool.query(`DELETE FROM patient_merges WHERE surviving_patient_id = ANY($1) OR merged_patient_id = ANY($1)`, [createdPatientIds]);
      await ownerPool.query(`DELETE FROM patients WHERE id = ANY($1)`, [createdPatientIds]);
    }
  });

  describe('createPatient', () => {
    it('creates standard active patient', async () => {
      const p = await service.createPatient(TENANT_A, USER_A, {
        firstName: 'Juan',
        lastName: 'Dela Cruz',
        middleName: 'Santos',
        dateOfBirth: '1990-05-15',
        gender: 'M',
        registrationType: 'STANDARD',
      });
      createdPatientIds.push(p.id);

      expect(p.id).toBeDefined();
      expect(p.first_name).toBe('Juan');
      expect(p.last_name).toBe('Dela Cruz');
      expect(p.status).toBe('ACTIVE');
      expect(p.row_version).toBe(1);
    });

    it('creates emergency registration with deferred consent flag (todo 2.2, Q-11)', async () => {
      const p = await service.createPatient(TENANT_A, USER_A, {
        firstName: 'Maria',
        lastName: 'Clara',
        dateOfBirth: '1995-10-20',
        gender: 'F',
        registrationType: 'EMERGENCY',
      });
      createdPatientIds.push(p.id);

      const fetched = await service.getPatient(TENANT_A, USER_A, p.id);
      expect(fetched.flags).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ title: 'Emergency Registration', level: 'WARNING' }),
        ]),
      );
    });
  });

  describe('updatePatient (optimistic concurrency)', () => {
    it('updates demographics and increments row_version', async () => {
      const p = await service.createPatient(TENANT_A, USER_A, {
        firstName: 'Test',
        lastName: 'Subject',
        dateOfBirth: '2000-01-01',
        gender: 'OTHER',
      });
      createdPatientIds.push(p.id);

      const updated = await service.updatePatient(TENANT_A, USER_A, p.id, {
        firstName: 'UpdatedName',
        rowVersion: p.row_version,
      });

      expect(updated.row_version).toBe(2);

      const reFetched = await service.getPatient(TENANT_A, USER_A, p.id);
      expect(reFetched.first_name).toBe('UpdatedName');
    });

    it('throws STALE_ROW_VERSION on version mismatch', async () => {
      const p = await service.createPatient(TENANT_A, USER_A, {
        firstName: 'Version',
        lastName: 'Mismatch',
        dateOfBirth: '1992-02-02',
        gender: 'M',
      });
      createdPatientIds.push(p.id);

      await expect(
        service.updatePatient(TENANT_A, USER_A, p.id, {
          firstName: 'Conflict',
          rowVersion: 999, // Stale version
        }),
      ).rejects.toThrow(ProblemException);
    });
  });

  describe('deactivate and mark deceased (append-only, no hard delete)', () => {
    it('deactivates patient and logs flag', async () => {
      const p = await service.createPatient(TENANT_A, USER_A, {
        firstName: 'Deactivate',
        lastName: 'Me',
        dateOfBirth: '1985-03-03',
        gender: 'F',
      });
      createdPatientIds.push(p.id);

      const res = await service.deactivatePatient(TENANT_A, USER_A, p.id, {
        reason: 'Moved to another province',
        rowVersion: p.row_version,
      });
      expect(res.status).toBe('INACTIVE');

      const full = await service.getPatient(TENANT_A, USER_A, p.id);
      expect(full.status).toBe('INACTIVE');
      expect(full.flags).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ title: 'Deactivated' }),
        ]),
      );
    });

    it('marks patient deceased and logs flag', async () => {
      const p = await service.createPatient(TENANT_A, USER_A, {
        firstName: 'Deceased',
        lastName: 'Record',
        dateOfBirth: '1950-01-01',
        gender: 'M',
      });
      createdPatientIds.push(p.id);

      const res = await service.markDeceased(TENANT_A, USER_A, p.id, {
        dateOfDeath: '2026-09-30',
        rowVersion: p.row_version,
      });
      expect(res.status).toBe('DECEASED');

      const full = await service.getPatient(TENANT_A, USER_A, p.id);
      expect(full.status).toBe('DECEASED');
      expect(full.flags).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ title: 'Deceased' }),
        ]),
      );
    });
  });

  describe('identifiers & reveal-with-reason', () => {
    it('masks identifier on creation and unmasks with audited reason in phi_access_log', async () => {
      const p = await service.createPatient(TENANT_A, USER_A, {
        firstName: 'Id',
        lastName: 'Test',
        dateOfBirth: '1988-08-08',
        gender: 'M',
      });
      createdPatientIds.push(p.id);

      const added = await service.addIdentifier(TENANT_A, USER_A, p.id, {
        type: 'NATIONAL_ID',
        value: '1234-5678-9012-3456',
      });
      expect(added.value).toBe('***'); // Masked

      // Reveal with reason
      const revealed = await service.revealIdentifier(TENANT_A, USER_A, p.id, added.id, {
        reason: 'Insurance claim audit verification',
      });
      expect(revealed.value).toBe('1234-5678-9012-3456'); // Unmasked

      // Assert phi_access_log recorded the access!
      const accessLogs = await service.getAccessLog(TENANT_A, USER_A, p.id);
      expect(accessLogs.data).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            resource: `patient_identifier:${added.id}`,
            purpose: 'Insurance claim audit verification',
          }),
        ]),
      );
    });
  });

  describe('duplicate detection & pre-registration check', () => {
    it('detects duplicate candidate by trigram similarity', async () => {
      const p = await service.createPatient(TENANT_A, USER_A, {
        firstName: 'Rodrigo',
        lastName: 'Duterte',
        dateOfBirth: '1945-03-28',
        gender: 'M',
      });
      createdPatientIds.push(p.id);

      const dupCheck = await service.checkDuplicates(TENANT_A, USER_A, {
        firstName: 'Rodrigo',
        lastName: 'Duterte',
        dateOfBirth: '1945-03-28',
      });
      expect(dupCheck.candidates.length).toBeGreaterThan(0);
      expect(dupCheck.candidates.map((c: any) => c.id)).toContain(p.id);

      // Acknowledge flow
      const ack = await service.acknowledgeDuplicates(TENANT_A, USER_A, p.id, {
        candidateIds: [p.id],
        reason: 'Verified distinct individuals (Jr vs Sr)',
      });
      expect(ack.acknowledged).toBe(true);
    });
  });

  describe('patient merge and unmerge (AC-9, AC-12)', () => {
    it('merges patient into survivor and restores on unmerge', async () => {
      const survivor = await service.createPatient(TENANT_A, USER_A, {
        firstName: 'Survivor',
        lastName: 'Patient',
        dateOfBirth: '1980-01-01',
        gender: 'F',
      });
      createdPatientIds.push(survivor.id);

      const toMerge = await service.createPatient(TENANT_A, USER_A, {
        firstName: 'Duplicate',
        lastName: 'Patient',
        dateOfBirth: '1980-01-01',
        gender: 'F',
      });
      createdPatientIds.push(toMerge.id);

      // Add contact to merged patient
      await service.addContact(TENANT_A, USER_A, toMerge.id, {
        type: 'MOBILE',
        value: '09171234567',
        isPrimary: true,
      });

      // Execute merge (AC-9)
      const mergeResult = await service.mergePatients(TENANT_A, USER_A, {
        survivingPatientId: survivor.id,
        mergedPatientId: toMerge.id,
        reason: 'Confirmed duplicate record during chart review',
      });
      expect(mergeResult.mergeId).toBeDefined();

      // Assert merged patient status is MERGED
      const mergedCheck = await withTenant({ tenantId: TENANT_A, userId: USER_A }, async (tx) => {
        const res = await tx.query(`SELECT status FROM patients WHERE id = $1`, [toMerge.id]);
        return res.rows[0];
      });
      expect(mergedCheck.status).toBe('MERGED');

      // Assert sub-resource contact was reparented to survivor
      const survivorAfter = await service.getPatient(TENANT_A, USER_A, survivor.id);
      expect(survivorAfter.contacts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ value: '09171234567' }),
        ]),
      );

      // Execute unmerge (AC-12)
      const unmergeResult = await service.unmergePatients(TENANT_A, USER_A, mergeResult.mergeId);
      expect(unmergeResult.unmerged).toBe(true);

      // Assert merged patient is restored to ACTIVE with snapshot demographics
      const restored = await service.getPatient(TENANT_A, USER_A, toMerge.id);
      expect(restored.status).toBe('ACTIVE');
      expect(restored.first_name).toBe('Duplicate');
    });
  });

  describe('PhilHealth data integration (todo 2.2, Q-16)', () => {
    it('upserts PhilHealth PIN, membership, and adds dependents', async () => {
      const p = await service.createPatient(TENANT_A, USER_A, {
        firstName: 'PhilHealth',
        lastName: 'Member',
        dateOfBirth: '1982-04-12',
        gender: 'M',
      });
      createdPatientIds.push(p.id);

      const ph = await service.upsertPhilHealth(TENANT_A, USER_A, p.id, {
        pin: '12-345678901-2',
        membershipCategory: 'KONSULTA',
        konsultaPcp: 'Dr. Rizal Clinic',
        konsultaStatus: 'REGISTERED',
      });
      expect(ph.pin).toBe('12-345678901-2');
      expect(ph.konsulta_status).toBe('REGISTERED');

      const dep = await service.addPhilHealthDependent(TENANT_A, USER_A, p.id, {
        dependentFirstName: 'Junior',
        dependentLastName: 'Member',
        dependentDob: '2015-06-01',
        dependentRelationship: 'CHILD',
      });
      expect(dep.dependent_first_name).toBe('Junior');
      expect(dep.dependent_relationship).toBe('CHILD');

      // Summary header reflects PhilHealth data
      const summary = await service.getSummary(TENANT_A, USER_A, p.id);
      expect(summary.philhealth).toMatchObject({
        pin: '12-345678901-2',
        konsultaStatus: 'REGISTERED',
      });
    });
  });
});
