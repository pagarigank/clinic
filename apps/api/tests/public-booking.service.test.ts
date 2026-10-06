import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { probeDb } from '@clinic/db/tests/helpers.js';
import { createPool } from '@clinic/db';
import { ClinicalService } from '../src/clinical/clinical.service.js';
import { seedUsers, NO_SEED_USERS } from '@clinic/db/tests/helpers.js';

const hasDb = await probeDb();

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const BRANCH_A = 'a1000000-0000-4000-8000-000000000001';
const { DOCTOR_A, USER_A } = hasDb ? await seedUsers() : NO_SEED_USERS;

describe.skipIf(!hasDb)('Public Booking (Independent Patient Scheduling)', () => {
  let clinicalSvc: ClinicalService;
  const cleanupAppointmentIds: string[] = [];
  const cleanupPatientIds: string[] = [];

  beforeEach(() => {
    clinicalSvc = new ClinicalService();
  });

  afterAll(async () => {
    const ownerPool = createPool({ role: 'owner' });
    if (cleanupAppointmentIds.length > 0) {
      await ownerPool.query(`DELETE FROM appointments WHERE id = ANY($1)`, [cleanupAppointmentIds]);
    }
    if (cleanupPatientIds.length > 0) {
      await ownerPool.query(`DELETE FROM patient_contacts WHERE patient_id = ANY($1)`, [cleanupPatientIds]);
      await ownerPool.query(`DELETE FROM patient_identifiers WHERE patient_id = ANY($1)`, [cleanupPatientIds]);
      await ownerPool.query(`DELETE FROM patients WHERE id = ANY($1)`, [cleanupPatientIds]);
    }
  });

  it('retrieves public booking configuration with clinic, branches, and practitioners', async () => {
    const config = await clinicalSvc.getPublicBookingConfig(TENANT_A);
    expect(config.clinic).toBeDefined();
    expect(config.clinic.slug).toBe('demo-a');
    expect(config.branches.length).toBeGreaterThan(0);
    expect(config.practitioners.length).toBeGreaterThan(0);
    expect(config.practitioners.some((p: any) => p.id === DOCTOR_A)).toBe(true);
  });

  it('generates availability slots for a doctor on a clinic weekday', async () => {
    // 2026-11-20 is a Friday (weekday 5)
    const avail = await clinicalSvc.getAvailability(TENANT_A, undefined, BRANCH_A, DOCTOR_A, '2026-11-20');
    expect(avail.date).toBe('2026-11-20');
    expect(avail.slots.length).toBeGreaterThan(0);
    expect(avail.slots[0]!.available).toBe(true);
  });

  it('allows a patient to book an appointment without login, creating patient and ONLINE appointment', async () => {
    const startsAt = '2026-11-20T10:00:00.000Z';
    const endsAt = '2026-11-20T10:30:00.000Z';

    const ownerPool = createPool({ role: 'owner' });
    await ownerPool.query(
      `DELETE FROM appointments WHERE practitioner_id = $1 AND starts_at = $2`,
      [DOCTOR_A, startsAt],
    );

    const result = await clinicalSvc.bookPublicAppointment(TENANT_A, {
      slug: 'demo-a',
      branchId: BRANCH_A,
      practitionerId: DOCTOR_A,
      startsAt,
      endsAt,
      firstName: 'PublicGuest',
      lastName: 'BookingTest',
      dateOfBirth: '1993-08-14',
      gender: 'M',
      phone: '09181234567',
      email: 'publicguest@test.local',
      notes: 'Initial consultation booked online via portal',
    });

    expect(result.appointmentId).toBeDefined();
    expect(result.status).toBe('BOOKED');
    expect(result.channel).toBe('ONLINE');
    expect(result.referenceNo).toBeDefined();
    expect(result.patientName).toBe('PublicGuest BookingTest');
    cleanupAppointmentIds.push(result.appointmentId);
    cleanupPatientIds.push(result.patientId);

    // Verify it surfaces on the doctor's existing scheduling query
    const dayAppointments = await clinicalSvc.listAppointments(TENANT_A, USER_A, BRANCH_A, '2026-11-20');
    const matched = dayAppointments.data.find((a: any) => a.id === result.appointmentId);
    expect(matched).toBeDefined();
    expect(matched.patient_name).toBe('PublicGuest BookingTest');
    expect(matched.channel).toBe('ONLINE');
    expect(matched.status).toBe('BOOKED');

    // Attempting to double-book the same slot must fail with APPOINTMENT_CONFLICT
    await expect(
      clinicalSvc.bookPublicAppointment(TENANT_A, {
        slug: 'demo-a',
        branchId: BRANCH_A,
        practitionerId: DOCTOR_A,
        startsAt,
        endsAt,
        firstName: 'Another',
        lastName: 'Patient',
        dateOfBirth: '1990-01-01',
        gender: 'F',
        phone: '09170001111',
      }),
    ).rejects.toMatchObject({
      response: { code: 'APPOINTMENT_CONFLICT' },
    });
  });
});
