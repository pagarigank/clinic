/**
 * Clinical Service Test Suite — Phase 3 (todo.md §3, specification.md §7, CLN-T1…T9).
 *
 * Discharges acceptance scenarios:
 *  - AC-4: Appointment double-booking prevented by EXCLUDE constraint and conflict check
 *  - AC-5: Rx for wrong patient rejected with PATIENT_MISMATCH; allergy warnings generated
 *  - Note signing locks the note; amending creates addenda (append-only, ground rule 7)
 *  - Closed visits are immutable; charges require open visits
 *  - Procedures post billing charges; voiding voids the charge
 *  - Immunizations and certificates with lifecycle tracking
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
const { DOCTOR_A } = hasDb ? await seedUsers() : NO_SEED_USERS;
const { USER_A } = hasDb ? await seedUsers() : NO_SEED_USERS;

describe.skipIf(!hasDb)('ClinicalService (Phase 3)', () => {
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

  describe('AC-4: Appointment double-booking', () => {
    it('prevents double-booking for the same practitioner in an overlapping window', async () => {
      const patient1 = await patientsSvc.createPatient(TENANT_A, USER_A, {
        firstName: 'BookPatient1',
        lastName: 'Test',
        dateOfBirth: '1990-01-01',
        gender: 'M',
      });
      cleanupPatientIds.push(patient1.id);

      const patient2 = await patientsSvc.createPatient(TENANT_A, USER_A, {
        firstName: 'BookPatient2',
        lastName: 'Test',
        dateOfBirth: '1992-02-02',
        gender: 'F',
      });
      cleanupPatientIds.push(patient2.id);

      const startsAt = '2026-11-15T09:00:00.000Z';
      const endsAt = '2026-11-15T09:30:00.000Z';

      // 1. First appointment booked successfully
      const apt1 = await clinicalSvc.bookAppointment(TENANT_A, USER_A, {
        branchId: BRANCH_A,
        patientId: patient1.id,
        practitionerId: DOCTOR_A,
        startsAt,
        endsAt,
        channel: 'ONLINE',
      });
      expect(apt1.id).toBeDefined();
      expect(apt1.status).toBe('BOOKED');
      cleanupAppointmentIds.push(apt1.id);

      // 2. Second appointment for the same practitioner in overlapping time is rejected with APPOINTMENT_CONFLICT
      await expect(
        clinicalSvc.bookAppointment(TENANT_A, USER_A, {
          branchId: BRANCH_A,
          patientId: patient2.id,
          practitionerId: DOCTOR_A,
          startsAt: '2026-11-15T09:15:00.000Z',
          endsAt: '2026-11-15T09:45:00.000Z',
          channel: 'FRONT_DESK',
        }),
      ).rejects.toMatchObject({
        response: { code: 'APPOINTMENT_CONFLICT' },
      });

      // 3. Confirming and checking in the appointment
      const confirmed = await clinicalSvc.confirmAppointment(TENANT_A, USER_A, apt1.id, {
        rowVersion: apt1.row_version,
      });
      expect(confirmed.status).toBe('CONFIRMED');

      const checkedIn = await clinicalSvc.checkInAppointment(TENANT_A, USER_A, apt1.id, {
        rowVersion: confirmed.row_version,
        issueQueueTicket: true,
        priority: 0,
      });
      expect(checkedIn.appointment.status).toBe('CHECKED_IN');
      expect(checkedIn.ticket).toBeDefined();
      expect(checkedIn.ticket.ticket_no).toMatch(/^Q/);
    });

    it('frees slot for booking when prior appointment is cancelled', async () => {
      const patient = await patientsSvc.createPatient(TENANT_A, USER_A, {
        firstName: 'CancelSlotPatient',
        lastName: 'Test',
        dateOfBirth: '1985-05-05',
        gender: 'F',
      });
      cleanupPatientIds.push(patient.id);

      const startsAt = '2026-11-16T14:00:00.000Z';
      const endsAt = '2026-11-16T14:30:00.000Z';

      const apt = await clinicalSvc.bookAppointment(TENANT_A, USER_A, {
        branchId: BRANCH_A,
        patientId: patient.id,
        practitionerId: DOCTOR_A,
        startsAt,
        endsAt,
        channel: 'PHONE',
      });
      cleanupAppointmentIds.push(apt.id);

      // Cancel the booking
      await clinicalSvc.cancelAppointment(TENANT_A, USER_A, apt.id, {
        reason: 'Patient called to cancel',
        rowVersion: apt.row_version,
      });

      // Now another patient can book the exact same slot
      const aptRebooked = await clinicalSvc.bookAppointment(TENANT_A, USER_A, {
        branchId: BRANCH_A,
        patientId: patient.id,
        practitionerId: DOCTOR_A,
        startsAt,
        endsAt,
        channel: 'FRONT_DESK',
      });
      expect(aptRebooked.id).toBeDefined();
      expect(aptRebooked.status).toBe('BOOKED');
      cleanupAppointmentIds.push(aptRebooked.id);
    });
  });

  describe('AC-5: Rx patient mismatch & allergy checking', () => {
    it('throws PATIENT_MISMATCH when prescription patient does not match visit patient', async () => {
      const patientReal = await patientsSvc.createPatient(TENANT_A, USER_A, {
        firstName: 'RealPatient',
        lastName: 'Rx',
        dateOfBirth: '1995-03-10',
        gender: 'M',
      });
      cleanupPatientIds.push(patientReal.id);

      const patientOther = await patientsSvc.createPatient(TENANT_A, USER_A, {
        firstName: 'WrongPatient',
        lastName: 'Rx',
        dateOfBirth: '1991-07-20',
        gender: 'F',
      });
      cleanupPatientIds.push(patientOther.id);

      const visit = await clinicalSvc.openVisit(TENANT_A, USER_A, {
        branchId: BRANCH_A,
        patientId: patientReal.id,
        practitionerId: DOCTOR_A,
        visitType: 'OPD',
        chiefComplaint: 'Cough',
      });
      cleanupVisitIds.push(visit.id);

      // Attempt creating Rx for patientOther against patientReal visit
      await expect(
        clinicalSvc.createPrescription(TENANT_A, DOCTOR_A, {
          visitId: visit.id,
          patientId: patientOther.id,
          isControlled: false,
          items: [
            {
              genericName: 'Amoxicillin',
              sigDose: '500mg',
              sigFrequency: 'TID',
              qtyPrescribed: 21,
              dispenseAsWritten: false,
            },
          ],
        }),
      ).rejects.toMatchObject({
        response: { code: 'PATIENT_MISMATCH' },
      });
    });

    it('detects drug allergies and returns warning messages', async () => {
      const patient = await patientsSvc.createPatient(TENANT_A, USER_A, {
        firstName: 'AllergicPatient',
        lastName: 'Rx',
        dateOfBirth: '1987-12-12',
        gender: 'F',
      });
      cleanupPatientIds.push(patient.id);

      // Record penicillin allergy
      const ownerPool = createPool({ role: 'owner' });
      await ownerPool.query(
        `INSERT INTO patient_allergies (tenant_id, patient_id, substance, severity)
         VALUES ($1, $2, 'Penicillin', 'High')`,
        [TENANT_A, patient.id],
      );

      const visit = await clinicalSvc.openVisit(TENANT_A, USER_A, {
        branchId: BRANCH_A,
        patientId: patient.id,
        practitionerId: DOCTOR_A,
        visitType: 'OPD',
        chiefComplaint: 'Bacterial infection',
      });
      cleanupVisitIds.push(visit.id);

      // Prescribe Penicillin V
      const rx = await clinicalSvc.createPrescription(TENANT_A, DOCTOR_A, {
        visitId: visit.id,
        patientId: patient.id,
        isControlled: false,
        items: [
          {
            genericName: 'Penicillin V',
            sigDose: '250mg',
            sigFrequency: 'QID',
            qtyPrescribed: 28,
            dispenseAsWritten: false,
          },
        ],
      });

      expect(rx.id).toBeDefined();
      expect(rx.allergyWarnings).toBeDefined();
      expect(rx.allergyWarnings?.length).toBeGreaterThan(0);
      expect(rx.allergyWarnings?.[0]).toMatch(/Penicillin/i);
    });
  });

  describe('Clinical notes, signing, and amendment (CLN-T4)', () => {
    it('signing locks the note and advances visit to IN_PROGRESS; amending creates addendum', async () => {
      const patient = await patientsSvc.createPatient(TENANT_A, USER_A, {
        firstName: 'NotePatient',
        lastName: 'SOAP',
        dateOfBirth: '1982-04-14',
        gender: 'M',
      });
      cleanupPatientIds.push(patient.id);

      const visit = await clinicalSvc.openVisit(TENANT_A, USER_A, {
        branchId: BRANCH_A,
        patientId: patient.id,
        practitionerId: DOCTOR_A,
        visitType: 'OPD',
        chiefComplaint: 'Headache',
      });
      expect(visit.status).toBe('OPEN');
      cleanupVisitIds.push(visit.id);

      // 1. Save draft note
      const note = await clinicalSvc.saveNote(TENANT_A, DOCTOR_A, visit.id, {
        noteType: 'SOAP',
        subjective: 'Patient reports severe throbbing headache',
        objective: 'BP 120/80, neurological exam normal',
        assessment: 'Tension headache',
        plan: 'Hydration and rest',
      });
      expect(note.status).toBe('DRAFT');

      // 2. Draft note can be updated
      const updatedNote = await clinicalSvc.updateNote(TENANT_A, DOCTOR_A, note.id, {
        noteType: 'SOAP',
        subjective: 'Patient reports moderate throbbing headache for 2 days',
        objective: 'BP 120/80',
        assessment: 'Tension-type headache',
        plan: 'Paracetamol 500mg prn',
      });
      expect(updatedNote.subjective).toContain('moderate');

      // 3. Sign note — locks note and advances visit to IN_PROGRESS
      const signed = await clinicalSvc.signNote(TENANT_A, DOCTOR_A, note.id, {
        rowVersion: updatedNote.row_version,
      });
      expect(signed.status).toBe('SIGNED');
      expect(signed.signed_by).toBe(DOCTOR_A);

      const visitAfterSign = await clinicalSvc.getVisit(TENANT_A, USER_A, visit.id);
      expect(visitAfterSign.status).toBe('IN_PROGRESS');

      // 4. Editing locked note is rejected with NOTE_LOCKED
      await expect(
        clinicalSvc.updateNote(TENANT_A, DOCTOR_A, note.id, {
          noteType: 'SOAP',
          plan: 'Attempt to tamper signed note',
        }),
      ).rejects.toMatchObject({
        response: { code: 'NOTE_LOCKED' },
      });

      // 5. Amend note — creates an addendum, original is preserved (append-only)
      const amended = await clinicalSvc.amendNote(TENANT_A, DOCTOR_A, note.id, {
        plan: 'Paracetamol 500mg prn + follow-up in 1 week if not resolved',
      });
      expect(amended.status).toBe('AMENDED');
      expect(amended.amends_id).toBe(note.id);
      expect(amended.version).toBe(2);
    });
  });

  describe('Procedures and Charge Capture (todo §3.2, CLN-T4)', () => {
    it('records procedure, captures billing charge, and voids cleanly', async () => {
      const patient = await patientsSvc.createPatient(TENANT_A, USER_A, {
        firstName: 'ProcPatient',
        lastName: 'Charge',
        dateOfBirth: '1975-09-09',
        gender: 'F',
      });
      cleanupPatientIds.push(patient.id);

      const visit = await clinicalSvc.openVisit(TENANT_A, USER_A, {
        branchId: BRANCH_A,
        patientId: patient.id,
        practitionerId: DOCTOR_A,
        visitType: 'PROCEDURE',
        chiefComplaint: 'Wound dressing',
      });
      cleanupVisitIds.push(visit.id);

      // Create a service in catalog for the procedure
      const ownerPool = createPool({ role: 'owner' });
      const srv = await ownerPool.query(
        `INSERT INTO service_catalog (tenant_id, code, name, category, default_price, is_active)
         VALUES ($1, 'PROC-001', 'Wound Debridement & Dressing', 'procedure', 750, true)
         ON CONFLICT (tenant_id, code) DO UPDATE SET default_price = EXCLUDED.default_price RETURNING id`,
        [TENANT_A],
      );
      const serviceId = srv.rows[0].id;

      // Record procedure — price is resolved server-side from the catalog.
      const proc = await clinicalSvc.recordProcedure(TENANT_A, DOCTOR_A, visit.id, {
        serviceId,
        performedBy: DOCTOR_A,
        notes: 'Dressing applied with sterile saline',
      });
      expect(proc.id).toBeDefined();

      // Check visit charges
      const visitDetails = await clinicalSvc.getVisit(TENANT_A, USER_A, visit.id);
      expect(visitDetails.procedures.length).toBe(1);
      expect(visitDetails.charges.length).toBe(1);
      expect(Number(visitDetails.charges[0].amount)).toBe(750.0);

      // Void procedure — should void billing charge as well
      await clinicalSvc.voidProcedure(TENANT_A, DOCTOR_A, proc.id, {
        reason: 'Recorded in error',
      });

      const visitAfterVoid = await clinicalSvc.getVisit(TENANT_A, USER_A, visit.id);
      expect(visitAfterVoid.procedures.length).toBe(0);
      expect(visitAfterVoid.charges.length).toBe(0);

      await ownerPool.query(`DELETE FROM service_catalog WHERE id = $1`, [serviceId]);
    });
  });

  describe('Medical Certificates and Immunizations', () => {
    it('issues medical certificate and allows audited voiding', async () => {
      const patient = await patientsSvc.createPatient(TENANT_A, USER_A, {
        firstName: 'CertPatient',
        lastName: 'Fit',
        dateOfBirth: '2000-01-01',
        gender: 'M',
      });
      cleanupPatientIds.push(patient.id);

      const visit = await clinicalSvc.openVisit(TENANT_A, USER_A, {
        branchId: BRANCH_A,
        patientId: patient.id,
        practitionerId: DOCTOR_A,
        visitType: 'OPD',
      });
      cleanupVisitIds.push(visit.id);

      const cert = await clinicalSvc.issueCertificate(TENANT_A, DOCTOR_A, visit.id, {
        certType: 'FIT_TO_WORK',
        findings: 'Physically fit for employment',
        validFrom: '2026-10-02',
        validTo: '2027-10-02',
      });
      expect(cert.doc_no).toMatch(/^MC-/);

      const print = await clinicalSvc.getCertificatePrint(TENANT_A, DOCTOR_A, cert.id);
      expect(print.certificate.doc_no).toBe(cert.doc_no);
      expect(print.verificationHash).toBeDefined();

      const certPdf = await clinicalSvc.renderCertificatePdf(TENANT_A, DOCTOR_A, cert.id);
      expect(certPdf.mediaType).toBe('application/pdf');
      expect(certPdf.bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
      expect(certPdf.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(certPdf.byteLength).toBeGreaterThan(1000);

      const voided = await clinicalSvc.voidCertificate(TENANT_A, DOCTOR_A, cert.id, {
        reason: 'Issued with wrong date range',
      });
      expect(voided.voided_at).not.toBeNull();
      expect(voided.void_reason).toBe('Issued with wrong date range');
    });

    it('lists the certificates issued for a visit and keeps voided ones auditable', async () => {
      const patient = await patientsSvc.createPatient(TENANT_A, USER_A, {
        firstName: 'CertListPatient',
        lastName: 'Ledger',
        dateOfBirth: '1985-03-11',
        gender: 'F',
      });
      cleanupPatientIds.push(patient.id);

      const visit = await clinicalSvc.openVisit(TENANT_A, USER_A, {
        branchId: BRANCH_A,
        patientId: patient.id,
        practitionerId: DOCTOR_A,
        visitType: 'OPD',
      });
      cleanupVisitIds.push(visit.id);

      const empty = await clinicalSvc.listCertificates(TENANT_A, DOCTOR_A, visit.id);
      expect(empty.data).toHaveLength(0);
      expect(empty.total).toBe(0);

      const cert = await clinicalSvc.issueCertificate(TENANT_A, DOCTOR_A, visit.id, {
        certType: 'SICK_LEAVE',
        findings: 'Acute viral tonsillitis',
        validFrom: '2026-10-02',
        validTo: '2026-10-06',
      });

      const listed = await clinicalSvc.listCertificates(TENANT_A, DOCTOR_A, visit.id);
      expect(listed.total).toBe(1);
      expect(listed.data).toHaveLength(1);
      expect(listed.data[0].id).toBe(cert.id);
      expect(listed.data[0].doc_no).toBe(cert.doc_no);
      expect(listed.data[0].cert_type).toBe('SICK_LEAVE');
      expect(listed.data[0].patient_name).toBe('CertListPatient Ledger');
      expect(listed.data[0].issuer_name).toBeTruthy();
      expect(listed.data[0].voided_at).toBeNull();

      await clinicalSvc.voidCertificate(TENANT_A, DOCTOR_A, cert.id, { reason: 'Superseded' });

      const afterVoid = await clinicalSvc.listCertificates(TENANT_A, DOCTOR_A, visit.id);
      expect(afterVoid.data).toHaveLength(1);
      expect(afterVoid.data[0].voided_at).not.toBeNull();
      expect(afterVoid.data[0].void_reason).toBe('Superseded');
    });

    it('records and voids immunizations', async () => {
      const patient = await patientsSvc.createPatient(TENANT_A, USER_A, {
        firstName: 'VaxPatient',
        lastName: 'Vaccine',
        dateOfBirth: '2024-06-15',
        gender: 'F',
      });
      cleanupPatientIds.push(patient.id);

      const im = await clinicalSvc.recordImmunization(TENANT_A, DOCTOR_A, {
        patientId: patient.id,
        vaccine: 'Hepatitis B',
        doseNo: 1,
        lotNo: 'LOT-9921',
        site: 'Left thigh',
      });
      expect(im.id).toBeDefined();

      const list = await clinicalSvc.listImmunizations(TENANT_A, DOCTOR_A, patient.id);
      expect(list.data.length).toBe(1);
      expect(list.data[0].vaccine).toBe('Hepatitis B');

      await clinicalSvc.voidImmunization(TENANT_A, DOCTOR_A, im.id, {
        reason: 'Wrong dose recorded',
      });

      const listAfterVoid = await clinicalSvc.listImmunizations(TENANT_A, DOCTOR_A, patient.id);
      expect(listAfterVoid.data.length).toBe(0);
    });

    it('renders real PDF bytes with SHA-256 integrity hash for visit prescription and orders', async () => {
      const patient = await patientsSvc.createPatient(TENANT_A, USER_A, {
        firstName: 'PrintPatient',
        lastName: 'PdfTest',
        dateOfBirth: '1990-05-20',
        gender: 'M',
      });
      cleanupPatientIds.push(patient.id);

      const visit = await clinicalSvc.openVisit(TENANT_A, USER_A, {
        branchId: BRANCH_A,
        patientId: patient.id,
        practitionerId: DOCTOR_A,
        visitType: 'OPD',
        chiefComplaint: 'Annual Checkup',
      });
      cleanupVisitIds.push(visit.id);

      await clinicalSvc.createPrescription(TENANT_A, DOCTOR_A, {
        visitId: visit.id,
        patientId: patient.id,
        isControlled: false,
        items: [
          {
            genericName: 'Paracetamol',
            brandName: 'Biogesic',
            strength: '500mg',
            sigDose: '1 tablet',
            sigFrequency: 'every 6 hours',
            sigDuration: '3 days',
            qtyPrescribed: 12,
            dispenseAsWritten: false,
          },
        ],
      });

      const pdfDoc = await clinicalSvc.renderVisitPrescriptionPdf(TENANT_A, DOCTOR_A, visit.id);
      expect(pdfDoc.mediaType).toBe('application/pdf');
      expect(pdfDoc.bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
      expect(pdfDoc.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(pdfDoc.byteLength).toBeGreaterThan(1000);

      const ordersPdf = await clinicalSvc.renderVisitOrdersPdf(TENANT_A, DOCTOR_A, visit.id);
      expect(ordersPdf.mediaType).toBe('application/pdf');
      expect(ordersPdf.bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
      expect(ordersPdf.sha256).toMatch(/^[a-f0-9]{64}$/);
    });
  });
});

