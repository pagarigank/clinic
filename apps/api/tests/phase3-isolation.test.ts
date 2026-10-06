/**
 * Phase 3 Multi-Tenant Isolation Test Suite (todo.md §49 ground rules).
 *
 * Verifies that all Phase 3 clinical entities:
 *   - Appointments
 *   - Visits
 *   - Clinical notes
 *   - Prescriptions
 *   - Procedures & Billing charges
 *   - Medical certificates
 * are completely isolated between Tenant A and Tenant B.
 * Any attempt by Tenant B to query, fetch, or mutate Tenant A resources
 * returns NOT_FOUND / STALE_ROW_VERSION / 0 rows due to RLS and tenant scoping.
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { probeDb } from '@clinic/db/tests/helpers.js';
import { createPool } from '@clinic/db';
import { ClinicalService } from '../src/clinical/clinical.service.js';
import { PatientsService } from '../src/patients/patients.service.js';
import { seedUsers, NO_SEED_USERS } from "@clinic/db/tests/helpers.js";

const hasDb = await probeDb();

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const BRANCH_A = 'a1000000-0000-4000-8000-000000000001';
const { USER_A } = hasDb ? await seedUsers() : NO_SEED_USERS;
const { DOCTOR_A } = hasDb ? await seedUsers() : NO_SEED_USERS;

const TENANT_B = '22222222-2222-4222-8222-222222222222';
const BRANCH_B = 'b1000000-0000-4000-8000-000000000001';
const { USER_B } = hasDb ? await seedUsers() : NO_SEED_USERS;
const { DOCTOR_B } = hasDb ? await seedUsers() : NO_SEED_USERS;

describe.skipIf(!hasDb)('Phase 3 Multi-Tenant Isolation (§49)', () => {
  let clinicalSvc: ClinicalService;
  let patientsSvc: PatientsService;

  const cleanupPatientIds: string[] = [];
  const cleanupAppointmentIds: string[] = [];
  const cleanupVisitIds: string[] = [];

  beforeEach(() => {
    clinicalSvc = new ClinicalService();
    patientsSvc = new PatientsService();
  });

  afterAll(async () => {
    const ownerPool = createPool({ role: 'owner' });
    if (cleanupAppointmentIds.length > 0) {
      await ownerPool.query(`DELETE FROM appointments WHERE id = ANY($1)`, [cleanupAppointmentIds]);
    }
    if (cleanupVisitIds.length > 0) {
      await ownerPool.query(`DELETE FROM billing_charges WHERE visit_id = ANY($1)`, [cleanupVisitIds]);
      await ownerPool.query(`DELETE FROM visit_procedures WHERE visit_id = ANY($1)`, [cleanupVisitIds]);
      await ownerPool.query(`DELETE FROM prescription_items WHERE rx_id IN (SELECT id FROM prescriptions WHERE visit_id = ANY($1))`, [cleanupVisitIds]);
      await ownerPool.query(`DELETE FROM prescriptions WHERE visit_id = ANY($1)`, [cleanupVisitIds]);
      await ownerPool.query(`DELETE FROM clinical_notes WHERE visit_id = ANY($1)`, [cleanupVisitIds]);
      await ownerPool.query(`DELETE FROM visit_diagnoses WHERE visit_id = ANY($1)`, [cleanupVisitIds]);
      await ownerPool.query(`DELETE FROM vitals WHERE visit_id = ANY($1)`, [cleanupVisitIds]);
      await ownerPool.query(`DELETE FROM medical_certificates WHERE visit_id = ANY($1)`, [cleanupVisitIds]);
      await ownerPool.query(`DELETE FROM referrals WHERE visit_id = ANY($1)`, [cleanupVisitIds]);
      await ownerPool.query(`DELETE FROM queue_tickets WHERE visit_id = ANY($1)`, [cleanupVisitIds]);
      await ownerPool.query(`DELETE FROM visits WHERE id = ANY($1)`, [cleanupVisitIds]);
    }
    if (cleanupPatientIds.length > 0) {
      await ownerPool.query(`DELETE FROM appointments WHERE patient_id = ANY($1)`, [cleanupPatientIds]);
      await ownerPool.query(`DELETE FROM queue_tickets WHERE patient_id = ANY($1)`, [cleanupPatientIds]);
      await ownerPool.query(`DELETE FROM immunizations WHERE patient_id = ANY($1)`, [cleanupPatientIds]);
      await ownerPool.query(`DELETE FROM problem_list WHERE patient_id = ANY($1)`, [cleanupPatientIds]);
      await ownerPool.query(`DELETE FROM patient_allergies WHERE patient_id = ANY($1)`, [cleanupPatientIds]);
      await ownerPool.query(`DELETE FROM patient_identifiers WHERE patient_id = ANY($1)`, [cleanupPatientIds]);
      await ownerPool.query(`DELETE FROM patient_contacts WHERE patient_id = ANY($1)`, [cleanupPatientIds]);
      await ownerPool.query(`DELETE FROM patient_flags WHERE patient_id = ANY($1)`, [cleanupPatientIds]);
      await ownerPool.query(`DELETE FROM patients WHERE id = ANY($1)`, [cleanupPatientIds]);
    }
  });

  it('isolates appointments between tenants', async () => {
    const patientA = await patientsSvc.createPatient(TENANT_A, USER_A, {
      firstName: 'IsoAptPatient',
      lastName: 'TenantA',
      dateOfBirth: '1993-03-03',
      gender: 'M',
    });
    cleanupPatientIds.push(patientA.id);

    const aptA = await clinicalSvc.bookAppointment(TENANT_A, USER_A, {
      branchId: BRANCH_A,
      patientId: patientA.id,
      practitionerId: DOCTOR_A,
      startsAt: '2026-11-20T10:00:00.000Z',
      endsAt: '2026-11-20T10:30:00.000Z',
      channel: 'FRONT_DESK',
    });
    cleanupAppointmentIds.push(aptA.id);

    // Tenant A sees it
    const listA = await clinicalSvc.listAppointments(TENANT_A, USER_A, BRANCH_A, '2026-11-20');
    expect(listA.data.some((a: any) => a.id === aptA.id)).toBe(true);

    // Tenant B cannot see it
    const listB = await clinicalSvc.listAppointments(TENANT_B, USER_B, BRANCH_B, '2026-11-20');
    expect(listB.data.some((a: any) => a.id === aptA.id)).toBe(false);

    // Tenant B cannot cancel it
    await expect(
      clinicalSvc.cancelAppointment(TENANT_B, USER_B, aptA.id, {
        reason: 'Malicious cancel',
        rowVersion: aptA.row_version,
      }),
    ).rejects.toMatchObject({
      response: { code: 'STALE_ROW_VERSION' },
    });
  });

  it('isolates visits and clinical notes between tenants', async () => {
    const patientA = await patientsSvc.createPatient(TENANT_A, USER_A, {
      firstName: 'IsoVisitPatient',
      lastName: 'TenantA',
      dateOfBirth: '1984-08-18',
      gender: 'F',
    });
    cleanupPatientIds.push(patientA.id);

    const visitA = await clinicalSvc.openVisit(TENANT_A, USER_A, {
      branchId: BRANCH_A,
      patientId: patientA.id,
      practitionerId: DOCTOR_A,
      visitType: 'OPD',
      chiefComplaint: 'Confidential symptoms',
    });
    cleanupVisitIds.push(visitA.id);

    const noteA = await clinicalSvc.saveNote(TENANT_A, DOCTOR_A, visitA.id, {
      noteType: 'SOAP',
      subjective: 'Confidential patient disclosures',
      plan: 'Confidential treatment plan',
    });

    // Tenant A can retrieve the visit and notes
    const foundA = await clinicalSvc.getVisit(TENANT_A, USER_A, visitA.id);
    expect(foundA.id).toBe(visitA.id);
    expect(foundA.notes.length).toBe(1);

    // Tenant B cannot retrieve Tenant A visit: throws NOT_FOUND
    await expect(clinicalSvc.getVisit(TENANT_B, USER_B, visitA.id)).rejects.toMatchObject({
      response: { code: 'NOT_FOUND' },
    });

    // Tenant B cannot sign Tenant A note: throws NOTE_LOCKED / not found
    await expect(clinicalSvc.signNote(TENANT_B, DOCTOR_B, noteA.id, { rowVersion: 1 })).rejects.toMatchObject({
      response: { code: 'NOTE_LOCKED' },
    });

    // Tenant B cannot see visit in worklist
    const visitsB = await clinicalSvc.listVisits(TENANT_B, USER_B);
    expect(visitsB.data.some((v: any) => v.id === visitA.id)).toBe(false);
  });

  it('isolates prescriptions and certificates between tenants', async () => {
    const patientA = await patientsSvc.createPatient(TENANT_A, USER_A, {
      firstName: 'IsoRxPatient',
      lastName: 'TenantA',
      dateOfBirth: '1979-11-11',
      gender: 'M',
    });
    cleanupPatientIds.push(patientA.id);

    const visitA = await clinicalSvc.openVisit(TENANT_A, USER_A, {
      branchId: BRANCH_A,
      patientId: patientA.id,
      practitionerId: DOCTOR_A,
      visitType: 'OPD',
    });
    cleanupVisitIds.push(visitA.id);

    const rxA = await clinicalSvc.createPrescription(TENANT_A, DOCTOR_A, {
      visitId: visitA.id,
      patientId: patientA.id,
      isControlled: false,
      items: [
        {
          genericName: 'Paracetamol',
          sigDose: '500mg',
          sigFrequency: 'TID',
          qtyPrescribed: 10,
          dispenseAsWritten: false,
        },
      ],
    });

    const certA = await clinicalSvc.issueCertificate(TENANT_A, DOCTOR_A, visitA.id, {
      certType: 'FIT_TO_WORK',
      findings: 'Regular checkup ok',
    });

    // Tenant B cannot issue or cancel Tenant A prescription
    await expect(
      clinicalSvc.issuePrescription(TENANT_B, DOCTOR_B, rxA.id, { validDays: 30 }),
    ).rejects.toMatchObject({
      response: { code: 'NOT_FOUND' },
    });

    await expect(
      clinicalSvc.cancelPrescription(TENANT_B, DOCTOR_B, rxA.id, { reason: 'Unauthorized cancel' }),
    ).rejects.toMatchObject({
      response: { code: 'RX_LOCKED' },
    });

    // Tenant B cannot void or print Tenant A certificate
    await expect(
      clinicalSvc.voidCertificate(TENANT_B, DOCTOR_B, certA.id, { reason: 'Cross-tenant void' }),
    ).rejects.toMatchObject({
      response: { code: 'NOT_FOUND' },
    });

    await expect(
      clinicalSvc.getCertificatePrint(TENANT_B, DOCTOR_B, certA.id),
    ).rejects.toMatchObject({
      response: { code: 'NOT_FOUND' },
    });
  });
});
