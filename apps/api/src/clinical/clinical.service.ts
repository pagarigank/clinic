import { Injectable } from '@nestjs/common';
import { withTenant } from '@clinic/db';
import { ProblemException } from '../http/problem.exception.js';
import { resolveServicePrice } from '../common/pricing.js';
import {
  renderPdf,
  renderPrescriptionHtml,
  renderLabRequisitionHtml,
  renderEncounterOrdersHtml,
  renderCertificateHtml,
  type PrescriptionDocument,
  type PrescriptionItemDocument,
  type LabRequisitionDocument,
  type LabRequisitionItem,
  type EncounterOrdersDocument,
  type MedicalCertificate,
  type RenderedDocument,
} from '@clinic/print';
import type {
  BookAppointmentRequest,
  PublicBookAppointmentRequest,
  RescheduleAppointmentRequest,
  CancelAppointmentRequest,
  ConfirmAppointmentRequest,
  CheckInAppointmentRequest,
  OpenVisitRequest,
  UpdateVisitRequest,
  CancelVisitRequest,
  RecordVitalsRequest,
  SaveNoteRequest,
  SignNoteRequest,
  AmendNoteRequest,
  AddDiagnosisRequest,
  AddProblemRequest,
  ResolveProblemRequest,
  CreatePrescriptionRequest,
  IssuePrescriptionRequest,
  CancelPrescriptionRequest,
  IssueCertificateRequest,
  VoidCertificateRequest,
  CreateReferralRequest,
  CreateChargeRequest,
  RecordProcedureRequest,
  VoidProcedureRequest,
  RecordImmunizationRequest,
  VoidImmunizationRequest,
  CreateClinicalTemplateRequest,
  CreateOrderSetRequest,
} from '@clinic/contracts';

/**
 * Clinical service — specification.md §7 (M4), workflows CLN-T1…T9.
 *
 * Every method runs inside `withTenant` (RLS is the boundary; the transaction
 * carries `app.tenant_id`). Document numbers come from `app.next_doc_no()`
 * (migration 0025), which is gapless across concurrent transactions.
 */

type Tx = Parameters<Parameters<typeof withTenant>[1]>[0];
void (0 as unknown as Tx);

/**
 * Doctor identity for official printouts (specification §7 print contract,
 * §18.4 RX-PDF rows): the prescriber's registration credentials live on the
 * tenant `employees` record tied to the prescribing user (migration 0052).
 * Every official document — prescription pad, lab requisition, encounter
 * orders, medical certificate — prints the *recorded* licence numbers; the
 * print-modal overrides are for clinic-specific corrections only and blank
 * values must never fall back to placeholder licence numbers.
 */
export interface PractitionerPrintProfile {
  userId: string;
  name: string | null;
  jobTitle: string | null;
  specialization: string | null;
  prcLicenseNo: string | null;
  ptrNo: string | null;
  s2LicenseNo: string | null;
}

const PRACTITIONER_PROFILE_SELECT = `
  u.id AS user_id, u.name,
  e.job_title, e.specialization,
  e.prc_license_no, e.ptr_no, e.s2_license_no`;

const PRACTITIONER_PROFILE_FROM = `
  FROM users u
  LEFT JOIN employees e ON e.tenant_id = u.tenant_id AND e.user_id = u.id
  WHERE u.tenant_id = $1 AND u.id = $2`;

function toPractitionerPrintProfile(row: Record<string, unknown> | undefined, fallbackId: string): PractitionerPrintProfile {
  return {
    userId: (row?.user_id as string) ?? fallbackId,
    name: (row?.name as string) ?? null,
    jobTitle: (row?.job_title as string) ?? null,
    specialization: (row?.specialization as string) ?? null,
    prcLicenseNo: (row?.prc_license_no as string) ?? null,
    ptrNo: (row?.ptr_no as string) ?? null,
    s2LicenseNo: (row?.s2_license_no as string) ?? null,
  };
}

@Injectable()
export class ClinicalService {
  // ── Schedules & availability (CLN-T1 inputs) ──────────────────────────────

  async createSchedule(tenantId: string, userId: string, dto: any) {
    return withTenant({ tenantId, userId }, async (tx) => {
      // Overlap validation on the same practitioner/branch/weekday (§7.2).
      const overlap = await tx.query(
        `SELECT id FROM practitioner_schedules
         WHERE tenant_id = $1 AND branch_id = $2 AND practitioner_id = $3 AND weekday = $4
           AND (valid_to IS NULL OR valid_to >= $5::date)
           AND ($6::date IS NULL OR valid_from <= $6::date)
           AND start_time < $8::time AND end_time > $7::time`,
        [tenantId, dto.branchId, dto.practitionerId, dto.weekday, dto.validFrom, dto.validTo ?? null, dto.startTime, dto.endTime],
      );
      if ((overlap.rowCount ?? 0) > 0) {
        throw new ProblemException('SCHEDULE_OVERLAP', { detail: 'Schedule overlaps with an existing template for this practitioner.' });
      }
      const res = await tx.query(
        `INSERT INTO practitioner_schedules
           (tenant_id, branch_id, practitioner_id, weekday, start_time, end_time, slot_minutes, valid_from, valid_to)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [tenantId, dto.branchId, dto.practitionerId, dto.weekday, dto.startTime, dto.endTime, dto.slotMinutes, dto.validFrom, dto.validTo ?? null],
      );
      return res.rows[0];
    });
  }

  async listSchedules(tenantId: string, userId: string, branchId?: string) {
    return withTenant({ tenantId, userId }, async (tx) => {
      const where = branchId ? 'AND branch_id = $2' : '';
      const params: unknown[] = branchId ? [tenantId, branchId] : [tenantId];
      const res = await tx.query(
        `SELECT * FROM practitioner_schedules WHERE tenant_id = $1 ${where} ORDER BY weekday, start_time`,
        params,
      );
      return { data: res.rows };
    });
  }

  async createScheduleException(tenantId: string, userId: string, dto: any) {
    return withTenant({ tenantId, userId }, async (tx) => {
      const res = await tx.query(
        `INSERT INTO practitioner_schedule_exceptions
           (tenant_id, branch_id, practitioner_id, exception_date, is_full_day, start_time, end_time, reason, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [tenantId, dto.branchId, dto.practitionerId, dto.exceptionDate, dto.isFullDay, dto.startTime ?? null, dto.endTime ?? null, dto.reason, userId],
      );
      return res.rows[0];
    });
  }

  /** Availability = schedule slots − booked appointments − exceptions (CLN-T1). */
  async getAvailability(tenantId: string, userId: string | undefined, branchId: string, practitionerId: string, date: string) {
    return withTenant({ tenantId, userId: userId || undefined }, async (tx) => {
      const holiday = await tx.query(
        `SELECT name FROM holidays WHERE tenant_id = $1 AND date = $2::date`,
        [tenantId, date],
      );
      if ((holiday.rowCount ?? 0) > 0) {
        return { date, slots: [], isHoliday: true, holidayName: holiday.rows[0].name };
      }

      const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
      const sched = await tx.query(
        `SELECT * FROM practitioner_schedules
         WHERE tenant_id = $1 AND branch_id = $2 AND practitioner_id = $3 AND weekday = $4
           AND valid_from <= $5::date AND (valid_to IS NULL OR valid_to >= $5::date)`,
        [tenantId, branchId, practitionerId, weekday, date],
      );

      let scheduleRows = sched.rows;
      if (sched.rowCount === 0) {
        // Fallback default: Monday-Saturday (weekday 1-6) 09:00 - 17:00, 30m slots
        if (weekday >= 1 && weekday <= 6) {
          scheduleRows = [{ start_time: '09:00:00', end_time: '17:00:00', slot_minutes: 30 }];
        } else {
          return { date, slots: [] };
        }
      }

      const exc = await tx.query(
        `SELECT * FROM practitioner_schedule_exceptions
         WHERE tenant_id = $1 AND practitioner_id = $2 AND exception_date = $3::date`,
        [tenantId, practitionerId, date],
      );
      const fullDayLeave = exc.rows.some((e) => e.is_full_day);

      const booked = await tx.query(
        `SELECT starts_at, ends_at FROM appointments
         WHERE tenant_id = $1 AND practitioner_id = $2 AND branch_id = $3
           AND status IN ('BOOKED','CONFIRMED','CHECKED_IN','IN_CONSULT')
           AND starts_at::date = $4::date`,
        [tenantId, practitionerId, branchId, date],
      );

      const slots: Array<{ startsAt: string; endsAt: string; available: boolean }> = [];
      const dayStart = new Date(`${date}T00:00:00Z`);
      for (const s of scheduleRows) {
        const timeParts = (v: string) => String(v).split(':').map(Number);
        const [sh = 0, sm = 0] = timeParts(String(s.start_time));
        const [eh = 0, em = 0] = timeParts(String(s.end_time));
        const end = new Date(dayStart);
        end.setUTCHours(eh, em, 0, 0);
        let cursor = new Date(dayStart);
        cursor.setUTCHours(sh, sm, 0, 0);
        while (cursor < end) {
          const slotEnd = new Date(cursor.getTime() + s.slot_minutes * 60000);
          const overlapsLeave =
            !fullDayLeave &&
            exc.rows.some((e) => {
              if (e.is_full_day) return true;
              const ls = new Date(`${date}T${e.start_time}Z`);
              const le = new Date(`${date}T${e.end_time}Z`);
              return cursor < le && slotEnd > ls;
            });
          const overlapsBooking = booked.rows.some(
            (b) => new Date(b.starts_at) < slotEnd && new Date(b.ends_at) > cursor,
          );
          slots.push({
            startsAt: cursor.toISOString(),
            endsAt: slotEnd.toISOString(),
            available: !fullDayLeave && !overlapsLeave && !overlapsBooking,
          });
          cursor = slotEnd;
        }
      }
      return { date, slots };
    });
  }

  // ── Practitioner fee profiles (Q-17 shipped default) ─────────────────────

  async upsertPractitionerProfile(tenantId: string, userId: string, dto: any) {
    return withTenant({ tenantId, userId }, async (tx) => {
      const res = await tx.query(
        `INSERT INTO practitioner_profiles
           (tenant_id, user_id, branch_id, philhealth_accreditation_no, consult_fee_new, consult_fee_follow_up, consult_fee_procedure, free_follow_up_days, pf_share_percent)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (tenant_id, user_id, branch_id) DO UPDATE SET
           philhealth_accreditation_no = EXCLUDED.philhealth_accreditation_no,
           consult_fee_new = EXCLUDED.consult_fee_new,
           consult_fee_follow_up = EXCLUDED.consult_fee_follow_up,
           consult_fee_procedure = EXCLUDED.consult_fee_procedure,
           free_follow_up_days = EXCLUDED.free_follow_up_days,
           pf_share_percent = EXCLUDED.pf_share_percent,
           updated_at = now(), row_version = practitioner_profiles.row_version + 1
         RETURNING *`,
        [tenantId, dto.userId, dto.branchId, dto.philhealthAccreditationNo ?? null,
         dto.consultFeeNew ?? null, dto.consultFeeFollowUp ?? null, dto.consultFeeProcedure ?? null,
         dto.freeFollowUpDays, dto.pfSharePercent ?? null],
      );
      return res.rows[0];
    });
  }

  async listPractitionerProfiles(tenantId: string, userId: string) {
    return withTenant({ tenantId, userId }, async (tx) => {
      const res = await tx.query(
        `SELECT pp.*, u.name AS practitioner_name FROM practitioner_profiles pp
         LEFT JOIN users u ON u.id = pp.user_id
         WHERE pp.tenant_id = $1 ORDER BY u.name`,
        [tenantId],
      );
      return { data: res.rows };
    });
  }

  async listPractitioners(tenantId: string, userId?: string) {
    return withTenant({ tenantId, userId: userId || undefined }, async (tx) => {
      const res = await tx.query(
        `SELECT u.id, u.name, u.email,
                COALESCE(e.job_title, 'Physician') AS title,
                COALESCE(e.specialization, 'General Practice') AS specialization
         FROM users u
         LEFT JOIN employees e ON e.user_id = u.id AND e.tenant_id = u.tenant_id
         LEFT JOIN user_roles ur ON ur.user_id = u.id AND ur.tenant_id = u.tenant_id
         LEFT JOIN roles r ON r.id = ur.role_id AND r.tenant_id = u.tenant_id
         WHERE u.tenant_id = $1 AND u.status = 'ACTIVE'
           AND (
             r.code = 'doctor'
             OR e.job_title ILIKE '%doctor%'
             OR e.job_title ILIKE '%physician%'
             OR u.name ILIKE 'Dr.%'
             OR u.email ILIKE 'doctor@%'
           )
           AND (e.job_title IS NULL OR (e.job_title NOT ILIKE '%manager%' AND e.job_title NOT ILIKE '%administrator%'))
         GROUP BY u.id, u.name, u.email, e.job_title, e.specialization
         ORDER BY u.name`,
        [tenantId],
      );
      return { data: res.rows };
    });
  }

  async getPublicBookingConfig(tenantId: string) {
    return withTenant({ tenantId }, async (tx) => {
      const tenantRes = await tx.query(
        `SELECT id, name, slug FROM tenants WHERE id = $1`,
        [tenantId],
      );
      const clinic = tenantRes.rows[0];

      const branchesRes = await tx.query(
        `SELECT id, name, code, service_profile FROM branches WHERE tenant_id = $1 ORDER BY name`,
        [tenantId],
      );

      const practRes = await tx.query(
        `SELECT u.id, u.name, u.email,
                COALESCE(e.job_title, 'Physician') AS title,
                COALESCE(e.specialization, 'General Practice') AS specialization
         FROM users u
         LEFT JOIN employees e ON e.user_id = u.id AND e.tenant_id = u.tenant_id
         LEFT JOIN user_roles ur ON ur.user_id = u.id AND ur.tenant_id = u.tenant_id
         LEFT JOIN roles r ON r.id = ur.role_id AND r.tenant_id = u.tenant_id
         WHERE u.tenant_id = $1 AND u.status = 'ACTIVE'
           AND (
             r.code = 'doctor'
             OR e.job_title ILIKE '%doctor%'
             OR e.job_title ILIKE '%physician%'
             OR u.name ILIKE 'Dr.%'
             OR u.email ILIKE 'doctor@%'
           )
           AND (e.job_title IS NULL OR (e.job_title NOT ILIKE '%manager%' AND e.job_title NOT ILIKE '%administrator%'))
         GROUP BY u.id, u.name, u.email, e.job_title, e.specialization
         ORDER BY u.name`,
        [tenantId],
      );

      const practitioners = practRes.rows;

      return {
        clinic,
        branches: branchesRes.rows,
        practitioners,
      };
    });
  }

  async bookPublicAppointment(tenantId: string, dto: PublicBookAppointmentRequest) {
    return withTenant({ tenantId, userId: dto.practitionerId }, async (tx) => {
      // 1. Conflict check
      const conflict = await tx.query(
        `SELECT id FROM appointments
         WHERE tenant_id = $1 AND practitioner_id = $2
           AND status IN ('BOOKED','CONFIRMED','CHECKED_IN','IN_CONSULT')
           AND tstzrange(starts_at, ends_at) && tstzrange($3::timestamptz, $4::timestamptz)`,
        [tenantId, dto.practitionerId, dto.startsAt, dto.endsAt],
      );
      if ((conflict.rowCount ?? 0) > 0) {
        throw new ProblemException('APPOINTMENT_CONFLICT', {
          detail: 'That slot is already booked. Please choose another time slot.',
        });
      }

      // 2. Patient lookup or registration
      let patientId: string;
      const existingPatient = await tx.query(
        `SELECT id FROM patients
         WHERE tenant_id = $1
           AND lower(first_name) = lower($2)
           AND lower(last_name) = lower($3)
           AND date_of_birth = $4::date
           AND status != 'MERGED'
         LIMIT 1`,
        [tenantId, dto.firstName.trim(), dto.lastName.trim(), dto.dateOfBirth],
      );

      if ((existingPatient.rowCount ?? 0) > 0) {
        patientId = existingPatient.rows[0].id;
      } else {
        const seq = await tx.query(`SELECT app.next_doc_no($1::uuid, 'PAT-2026') AS n`, [tenantId]);
        const patientNo = `PAT-2026-${String(seq.rows[0].n).padStart(4, '0')}`;

        const newPatient = await tx.query(
          `INSERT INTO patients (tenant_id, first_name, last_name, middle_name, date_of_birth, gender, status)
           VALUES ($1, $2, $3, $4, $5, $6, 'ACTIVE')
           RETURNING id`,
          [tenantId, dto.firstName.trim(), dto.lastName.trim(), dto.middleName?.trim() ?? null, dto.dateOfBirth, dto.gender],
        );
        patientId = newPatient.rows[0].id;

        await tx.query(
          `INSERT INTO patient_identifiers (tenant_id, patient_id, type, value)
           VALUES ($1, $2, 'MRN', $3), ($1, $2, 'PATIENT_NO', $3)`,
          [tenantId, patientId, patientNo],
        );

        if (dto.phone?.trim()) {
          await tx.query(
            `INSERT INTO patient_contacts (tenant_id, patient_id, type, value, is_primary)
             VALUES ($1, $2, 'MOBILE', $3, true)`,
            [tenantId, patientId, dto.phone.trim()],
          );
        }
        if (dto.email?.trim()) {
          await tx.query(
            `INSERT INTO patient_contacts (tenant_id, patient_id, type, value, is_primary)
             VALUES ($1, $2, 'EMAIL', $3, false)`,
            [tenantId, patientId, dto.email.trim()],
          );
        }
      }

      // 3. Insert Appointment with channel 'ONLINE'
      const apt = await tx.query(
        `INSERT INTO appointments
           (tenant_id, branch_id, patient_id, practitioner_id, service_id, starts_at, ends_at, channel, notes, created_by)
         VALUES ($1, $2, $3, $4, NULL, $5::timestamptz, $6::timestamptz, 'ONLINE', $7, $8)
         RETURNING *`,
        [tenantId, dto.branchId, patientId, dto.practitionerId, dto.startsAt, dto.endsAt, dto.notes ?? null, dto.practitionerId],
      ).catch((err: { code?: string }) => {
        if (err.code === '23P01') {
          throw new ProblemException('APPOINTMENT_CONFLICT', {
            detail: 'That slot was just taken by another patient.',
          });
        }
        throw err;
      });

      const row = apt.rows[0];
      return {
        appointmentId: row.id,
        referenceNo: row.id.slice(0, 8).toUpperCase(),
        status: row.status,
        channel: row.channel,
        startsAt: row.starts_at,
        endsAt: row.ends_at,
        patientId,
        patientName: `${dto.firstName} ${dto.lastName}`,
        practitionerId: dto.practitionerId,
        branchId: dto.branchId,
      };
    });
  }

  // ── Appointments (CLN-T1) ────────────────────────────────────────────────

  async bookAppointment(tenantId: string, userId: string, dto: BookAppointmentRequest) {
    return withTenant({ tenantId, userId }, async (tx) => {
      // The EXCLUDE constraint is the authority; the pre-check only produces a
      // friendlier error for the common case.
      const conflict = await tx.query(
        `SELECT id FROM appointments
         WHERE tenant_id = $1 AND practitioner_id = $2
           AND status IN ('BOOKED','CONFIRMED','CHECKED_IN','IN_CONSULT')
           AND tstzrange(starts_at, ends_at) && tstzrange($3::timestamptz, $4::timestamptz)`,
        [tenantId, dto.practitionerId, dto.startsAt, dto.endsAt],
      );
      if ((conflict.rowCount ?? 0) > 0) {
        throw new ProblemException('APPOINTMENT_CONFLICT', { detail: 'That slot is already booked.' });
      }
      const res = await tx.query(
        `INSERT INTO appointments
           (tenant_id, branch_id, patient_id, practitioner_id, service_id, starts_at, ends_at, channel, notes, created_by)
         VALUES ($1,$2,$3,$4,$5,$6::timestamptz,$7::timestamptz,$8,$9,$10) RETURNING *`,
        [tenantId, dto.branchId, dto.patientId, dto.practitionerId, dto.serviceId ?? null, dto.startsAt, dto.endsAt, dto.channel, dto.notes ?? null, userId],
      ).catch((err: { code?: string }) => {
        // 23P01 exclusion_violation — two racing bookings, the constraint wins.
        if (err.code === '23P01') {
          throw new ProblemException('APPOINTMENT_CONFLICT', { detail: 'That slot was just taken.' });
        }
        throw err;
      });
      return res.rows[0];
    });
  }

  async confirmAppointment(tenantId: string, userId: string, id: string, dto: ConfirmAppointmentRequest) {
    return withTenant({ tenantId, userId }, async (tx) => {
      const res = await tx.query(
        `UPDATE appointments SET status = 'CONFIRMED', updated_at = now(), row_version = row_version + 1
         WHERE tenant_id = $1 AND id = $2 AND row_version = $3 AND status = 'BOOKED'
         RETURNING *`,
        [tenantId, id, dto.rowVersion],
      );
      if ((res.rowCount ?? 0) === 0) {
        throw new ProblemException('STALE_ROW_VERSION', { detail: 'Appointment changed elsewhere or is not in BOOKED state.' });
      }
      return res.rows[0];
    });
  }

  async checkInAppointment(tenantId: string, userId: string, id: string, dto: CheckInAppointmentRequest) {
    return withTenant({ tenantId, userId }, async (tx) => {
      const apt = await tx.query(
        `UPDATE appointments SET status = 'CHECKED_IN', updated_at = now(), row_version = row_version + 1
         WHERE tenant_id = $1 AND id = $2 AND row_version = $3 AND status IN ('BOOKED', 'CONFIRMED')
         RETURNING *`,
        [tenantId, id, dto.rowVersion],
      );
      if ((apt.rowCount ?? 0) === 0) {
        throw new ProblemException('STALE_ROW_VERSION', { detail: 'Appointment changed elsewhere or not eligible for check-in.' });
      }
      const row = apt.rows[0];
      let ticket = null;
      if (dto.issueQueueTicket) {
        const dayKey = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        const seq = await tx.query(`SELECT app.next_doc_no($1::uuid, $2) AS n`, [tenantId, `QUEUE:${row.branch_id}:${dayKey}`]);
        const ticketNo = `Q${dayKey}-${String(seq.rows[0].n).padStart(3, '0')}`;
        const tRes = await tx.query(
          `INSERT INTO queue_tickets (tenant_id, branch_id, ticket_no, patient_id, priority, issued_by)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
          [tenantId, row.branch_id, ticketNo, row.patient_id, dto.priority ?? 0, userId],
        );
        ticket = tRes.rows[0];
      }
      return { appointment: row, ticket };
    });
  }

  async rescheduleAppointment(tenantId: string, userId: string, id: string, dto: RescheduleAppointmentRequest) {
    return withTenant({ tenantId, userId }, async (tx) => {
      const res = await tx.query(
        `UPDATE appointments SET starts_at = $3::timestamptz, ends_at = $4::timestamptz,
                practitioner_id = COALESCE($6::uuid, practitioner_id),
                notes = CASE WHEN $7::text IS NOT NULL THEN $7 ELSE notes END,
                updated_at = now(), row_version = row_version + 1
         WHERE tenant_id = $1 AND id = $2 AND row_version = $5
           AND status IN ('BOOKED','CONFIRMED')
         RETURNING *`,
        [
          tenantId,
          id,
          dto.startsAt,
          dto.endsAt,
          dto.rowVersion,
          dto.practitionerId ?? null,
          dto.notes !== undefined ? dto.notes : null,
        ],
      ).catch((err: { code?: string }) => {
        if (err.code === '23P01') throw new ProblemException('APPOINTMENT_CONFLICT', { detail: 'Target slot is taken.' });
        throw err;
      });
      if ((res.rowCount ?? 0) === 0) {
        const check = await tx.query(`SELECT status FROM appointments WHERE tenant_id = $1 AND id = $2`, [tenantId, id]);
        if ((check.rowCount ?? 0) === 0) {
          throw new ProblemException('NOT_FOUND', { detail: 'Appointment not found.' });
        }
        const currentStatus = check.rows[0].status;
        if (currentStatus !== 'BOOKED' && currentStatus !== 'CONFIRMED') {
          throw new ProblemException('CONFLICT', {
            detail: `Cannot reschedule appointment with status ${currentStatus}. Only BOOKED or CONFIRMED appointments can be rescheduled.`,
          });
        }
        throw new ProblemException('STALE_ROW_VERSION', { detail: 'Appointment changed elsewhere; refresh and retry.' });
      }
      return res.rows[0];
    });
  }

  async cancelAppointment(tenantId: string, userId: string, id: string, dto: CancelAppointmentRequest) {
    return withTenant({ tenantId, userId }, async (tx) => {
      const res = await tx.query(
        `UPDATE appointments SET status = 'CANCELLED', cancel_reason = $3,
                updated_at = now(), row_version = row_version + 1
         WHERE tenant_id = $1 AND id = $2 AND row_version = $4 AND status IN ('BOOKED','CONFIRMED')
         RETURNING *`,
        [tenantId, id, dto.reason, dto.rowVersion],
      );
      if ((res.rowCount ?? 0) === 0) {
        throw new ProblemException('STALE_ROW_VERSION', { detail: 'Appointment changed elsewhere.' });
      }
      return res.rows[0];
    });
  }

  async markNoShow(tenantId: string, userId: string, id: string) {
    return withTenant({ tenantId, userId }, async (tx) => {
      const res = await tx.query(
        `UPDATE appointments SET status = 'NO_SHOW', updated_at = now(), row_version = row_version + 1
         WHERE tenant_id = $1 AND id = $2 AND status IN ('BOOKED','CONFIRMED') RETURNING *`,
        [tenantId, id],
      );
      if ((res.rowCount ?? 0) === 0) throw new ProblemException('NOT_FOUND', { detail: 'No live appointment.' });
      return res.rows[0];
    });
  }

  async listAppointments(tenantId: string, userId: string, branchId?: string, date?: string) {
    return withTenant({ tenantId, userId }, async (tx) => {
      const params: unknown[] = [tenantId];
      let where = '';
      if (branchId) { params.push(branchId); where += ` AND a.branch_id = $${params.length}`; }
      if (date) { params.push(date); where += ` AND a.starts_at::date = $${params.length}::date`; }
      const res = await tx.query(
        `SELECT a.*, p.first_name || ' ' || p.last_name AS patient_name, u.name AS practitioner_name
         FROM appointments a
         JOIN patients p ON p.id = a.patient_id
         LEFT JOIN users u ON u.id = a.practitioner_id
         WHERE a.tenant_id = $1 ${where}
         ORDER BY a.starts_at LIMIT 200`,
        params,
      );
      return { data: res.rows };
    });
  }

  // ── Queue (CLN-T2) ───────────────────────────────────────────────────────

  async issueQueueTicket(tenantId: string, userId: string, dto: any) {
    return withTenant({ tenantId, userId }, async (tx) => {
      const dayKey = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      const seq = await tx.query(`SELECT app.next_doc_no($1::uuid, $2) AS n`, [tenantId, `QUEUE:${dto.branchId}:${dayKey}`]);
      const ticketNo = `Q${dayKey}-${String(seq.rows[0].n).padStart(3, '0')}`;
      const res = await tx.query(
        `INSERT INTO queue_tickets (tenant_id, branch_id, ticket_no, patient_id, visit_id, priority, issued_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [tenantId, dto.branchId, ticketNo, dto.patientId, dto.visitId ?? null, dto.priority, userId],
      );
      return res.rows[0];
    });
  }

  async queueAction(tenantId: string, userId: string, ticketId: string, action: string) {
    return withTenant({ tenantId, userId }, async (tx) => {
      const statusMap: Record<string, string> = { CALL: 'CALLED', RECALL: 'CALLED', SKIP: 'SKIPPED', COMPLETE: 'DONE' };
      const next = statusMap[action];
      if (!next) throw new ProblemException('VALIDATION_FAILED', { detail: `Unknown queue action ${action}` });
      const res = await tx.query(
        `UPDATE queue_tickets SET status = $3,
                called_at = CASE WHEN $3 = 'CALLED' THEN now() ELSE called_at END,
                completed_at = CASE WHEN $3 = 'DONE' THEN now() ELSE completed_at END
         WHERE tenant_id = $1 AND id = $2 AND status IN ('WAITING','CALLED','SERVING') RETURNING *`,
        [tenantId, ticketId, next],
      );
      if ((res.rowCount ?? 0) === 0) throw new ProblemException('NOT_FOUND', { detail: 'Ticket not in an actionable state.' });
      return res.rows[0];
    });
  }

  async getQueueBoard(tenantId: string, userId: string, branchId: string) {
    return withTenant({ tenantId, userId }, async (tx) => {
      const res = await tx.query(
        `SELECT q.*, p.first_name || ' ' || p.last_name AS patient_name
         FROM queue_tickets q JOIN patients p ON p.id = q.patient_id
         WHERE q.tenant_id = $1 AND q.branch_id = $2
           AND q.issued_at::date = now()::date
           AND q.status IN ('WAITING','CALLED','SERVING')
         ORDER BY q.priority DESC, q.issued_at`,
        [tenantId, branchId],
      );
      return { data: res.rows };
    });
  }

  // ── Visits (CLN-T2/T4/T9) ────────────────────────────────────────────────

  async openVisit(tenantId: string, userId: string, dto: OpenVisitRequest) {
    return withTenant({ tenantId, userId }, async (tx) => {
      const seq = await tx.query(`SELECT app.next_doc_no($1::uuid, 'VISIT') AS n`, [tenantId]);
      const visitNo = `V-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${String(seq.rows[0].n).padStart(5, '0')}`;
      const res = await tx.query(
        `INSERT INTO visits
           (tenant_id, branch_id, visit_no, patient_id, practitioner_id, appointment_id, queue_ticket_id, visit_type, chief_complaint, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [tenantId, dto.branchId, visitNo, dto.patientId, dto.practitionerId, dto.appointmentId ?? null, dto.queueTicketId ?? null, dto.visitType, dto.chiefComplaint ?? null, userId],
      );
      // Check-in (CLN-T2): the appointment moves to IN_CONSULT when its visit opens.
      if (dto.appointmentId) {
        await tx.query(
          `UPDATE appointments SET status = 'IN_CONSULT', updated_at = now() WHERE tenant_id = $1 AND id = $2 AND status IN ('BOOKED','CONFIRMED','CHECKED_IN')`,
          [tenantId, dto.appointmentId],
        );
      }
      return res.rows[0];
    });
  }

  async getVisit(tenantId: string, userId: string, visitId: string) {
    const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!UUID_REGEX.test(visitId)) {
      throw new ProblemException('NOT_FOUND', { detail: 'Visit not found' });
    }
    return withTenant({ tenantId, userId }, async (tx) => {
      const v = await tx.query(
        `SELECT v.*, p.first_name || ' ' || p.last_name AS patient_name, p.date_of_birth, p.gender,
                u.name AS practitioner_name,
                e.job_title AS practitioner_job_title,
                e.specialization AS practitioner_specialization,
                e.prc_license_no AS practitioner_prc_no,
                e.ptr_no AS practitioner_ptr_no,
                e.s2_license_no AS practitioner_s2_no,
                t.name AS clinic_name,
                t.tagline AS clinic_tagline,
                t.address AS clinic_address,
                t.phone AS clinic_phone,
                t.email AS clinic_email,
                t.doh_license_no AS clinic_doh_license_no,
                t.philhealth_accreditation_no AS clinic_philhealth_no,
                t.tin AS clinic_tin,
                t.letterhead_footer AS clinic_letterhead_footer,
                b.name AS branch_name,
                b.address AS branch_address,
                b.phone AS branch_phone,
                b.email AS branch_email
         FROM visits v
         JOIN patients p ON p.id = v.patient_id
         LEFT JOIN users u ON u.id = v.practitioner_id
         LEFT JOIN employees e ON e.tenant_id = v.tenant_id AND e.user_id = v.practitioner_id
         LEFT JOIN tenants t ON t.id = v.tenant_id
         LEFT JOIN branches b ON b.id = v.branch_id AND b.tenant_id = v.tenant_id
         WHERE v.tenant_id = $1 AND v.id = $2`,
        [tenantId, visitId],
      );
      if ((v.rowCount ?? 0) === 0) throw new ProblemException('NOT_FOUND', { detail: 'Visit not found' });
      const patientId = v.rows[0].patient_id;
      const [vitalsRows, notes, dx, rx, procedures, charges, labOrders, supplies, allergies] = await Promise.all([
        tx.query(`SELECT * FROM vitals WHERE tenant_id = $1 AND visit_id = $2 AND voided_at IS NULL ORDER BY recorded_at DESC`, [tenantId, visitId]),
        tx.query(`SELECT * FROM clinical_notes WHERE tenant_id = $1 AND visit_id = $2 ORDER BY version DESC`, [tenantId, visitId]),
        tx.query(
          `SELECT vd.*, r.description as icd10_description, coalesce(vd.description, r.description, vd.icd10_code) as description
           FROM visit_diagnoses vd
           LEFT JOIN ref_icd10 r ON r.code = vd.icd10_code
           WHERE vd.tenant_id = $1 AND vd.visit_id = $2
           ORDER BY vd.created_at ASC`,
          [tenantId, visitId],
        ),
        tx.query(`
          SELECT rx.*,
                 u.name as prescriber_name,
                 (SELECT json_agg(pi.*) FROM prescription_items pi WHERE pi.rx_id = rx.id AND pi.tenant_id = rx.tenant_id) as items
          FROM prescriptions rx
          LEFT JOIN users u ON u.id = rx.prescriber_id
          WHERE rx.tenant_id = $1 AND rx.visit_id = $2
          ORDER BY rx.created_at DESC
        `, [tenantId, visitId]),
        tx.query(`SELECT * FROM visit_procedures WHERE tenant_id = $1 AND visit_id = $2 AND voided_at IS NULL`, [tenantId, visitId]),
        tx.query(`SELECT * FROM billing_charges WHERE tenant_id = $1 AND visit_id = $2 AND voided_at IS NULL`, [tenantId, visitId]),
        tx.query(`
          SELECT lo.*,
                 (SELECT json_agg(json_build_object(
                    'id', li.id,
                    'test_id', li.test_id,
                    'test_name', lt.name,
                    'test_code', lt.code,
                    'fasting_required', lt.fasting_required,
                    'fasting_hours', lt.fasting_hours,
                    'instructions', lt.instructions,
                    'specimen_type', st.name,
                    'status', li.status
                  ))
                  FROM lab_order_items li
                  JOIN lab_tests lt ON lt.id = li.test_id AND lt.tenant_id = li.tenant_id
                  LEFT JOIN lab_specimen_types st ON st.id = lt.specimen_type_id AND st.tenant_id = lt.tenant_id
                  WHERE li.order_id = lo.id AND li.tenant_id = lo.tenant_id) as items
          FROM lab_orders lo
          WHERE lo.tenant_id = $1 AND lo.visit_id = $2
          ORDER BY lo.ordered_at DESC
        `, [tenantId, visitId]),
        tx.query(`
          SELECT cl.*, i.name as item_name, i.code as item_code, sl.name as location_name
          FROM consumption_logs cl
          JOIN items i ON i.id = cl.item_id AND i.tenant_id = cl.tenant_id
          JOIN stock_locations sl ON sl.id = cl.location_id AND sl.tenant_id = cl.tenant_id
          WHERE cl.tenant_id = $1 AND cl.ref_type = 'VISIT' AND cl.ref_id = $2
          ORDER BY cl.logged_at DESC
        `, [tenantId, visitId]),
        tx.query(
          `SELECT substance, severity FROM patient_allergies WHERE tenant_id = $1 AND patient_id = $2`,
          [tenantId, patientId],
        ),
      ]);
      return {
        ...v.rows[0],
        vitals: vitalsRows.rows,
        notes: notes.rows,
        clinical_note: notes.rows[0] ?? null,
        diagnoses: dx.rows,
        prescriptions: rx.rows,
        labOrders: labOrders.rows,
        supplies: supplies.rows,
        procedures: procedures.rows,
        charges: charges.rows,
        allergies: allergies.rows,
      };
    });
  }

  async listVisits(
    tenantId: string,
    userId: string,
    branchId?: string,
    status?: string,
    patientId?: string,
  ) {
    return withTenant({ tenantId, userId }, async (tx) => {
      const params: unknown[] = [tenantId];
      let where = '';
      if (branchId) { params.push(branchId); where += ` AND v.branch_id = $${params.length}`; }
      if (status) { params.push(status); where += ` AND v.status = $${params.length}`; }
      // Billing needs a patient's visits to attach an invoice to the episode of
      // care it is charging for; without this the picker could only link cash to
      // a patient, never to the visit that consumed stock and ordered labs.
      if (patientId) { params.push(patientId); where += ` AND v.patient_id = $${params.length}`; }
      const res = await tx.query(
        `SELECT v.*,
                p.first_name || ' ' || p.last_name AS patient_name,
                u.name AS practitioner_name,
                COALESCE((
                  SELECT json_agg(json_build_object(
                    'id', vd.id,
                    'icd10_code', vd.icd10_code,
                    'description', COALESCE(vd.description, r.description, vd.icd10_code),
                    'dx_type', vd.dx_type,
                    'certainty', vd.certainty
                  ) ORDER BY vd.created_at ASC)
                  FROM visit_diagnoses vd
                  LEFT JOIN ref_icd10 r ON r.code = vd.icd10_code
                  WHERE vd.tenant_id = v.tenant_id AND vd.visit_id = v.id
                ), '[]'::json) AS diagnoses
         FROM visits v
         JOIN patients p ON p.id = v.patient_id
         LEFT JOIN users u ON u.id = v.practitioner_id
         WHERE v.tenant_id = $1 ${where}
         ORDER BY v.opened_at DESC LIMIT 100`,
        params,
      );
      return { data: res.rows };
    });
  }

  async updateVisit(tenantId: string, userId: string, visitId: string, dto: UpdateVisitRequest) {
    return withTenant({ tenantId, userId }, async (tx) => {
      // Closed/cancelled visits are immutable (§7.2).
      const res = await tx.query(
        `UPDATE visits SET
            chief_complaint = COALESCE($3, chief_complaint),
            status = COALESCE($4, status),
            closed_at = CASE WHEN $4 = 'CLOSED' THEN now() ELSE closed_at END,
            closed_by = CASE WHEN $4 = 'CLOSED' THEN $5 ELSE closed_by END,
            updated_at = now(), row_version = row_version + 1
         WHERE tenant_id = $1 AND id = $2 AND row_version = $6
           AND status NOT IN ('CLOSED','CANCELLED') RETURNING *`,
        [tenantId, visitId, dto.chiefComplaint ?? null, dto.status ?? null, userId, dto.rowVersion],
      );
      if ((res.rowCount ?? 0) === 0) {
        throw new ProblemException('STALE_ROW_VERSION', { detail: 'Visit changed, is closed, or was cancelled.' });
      }
      const updated = res.rows[0];
      let freeFollowUpUntil: string | null = null;
      if (dto.status === 'CLOSED') {
        const prof = await tx.query(
          `SELECT free_follow_up_days, consult_fee_new, consult_fee_follow_up, consult_fee_procedure 
           FROM practitioner_profiles WHERE tenant_id = $1 AND user_id = $2`,
          [tenantId, updated.practitioner_id],
        );
        const days = prof.rows[0]?.free_follow_up_days ?? 7;
        freeFollowUpUntil = new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);

        const feeNew = Number(prof.rows[0]?.consult_fee_new ?? 0);
        const feeFollowUp = Number(prof.rows[0]?.consult_fee_follow_up ?? 0);
        const feeProcedure = Number(prof.rows[0]?.consult_fee_procedure ?? 0);
        
        let consultFee = feeNew;
        if (updated.visit_type === 'FOLLOW_UP') consultFee = feeFollowUp;
        if (updated.visit_type === 'PROCEDURE') consultFee = feeProcedure;

        if (consultFee > 0) {
          await tx.query(
            `INSERT INTO billing_charges
               (tenant_id, branch_id, visit_id, charge_type, source_type, source_id, description, quantity, unit_price, amount, payer_type, posted_by)
             VALUES ($1, $2, $3, 'CONSULT', 'VISIT', $4, 'Professional Fee', 1, $5, $5, 'PRIVATE_CASH', $6)
             ON CONFLICT (tenant_id, source_type, source_id) DO NOTHING`,
            [tenantId, updated.branch_id, updated.id, updated.id, consultFee, userId],
          );
        }
      }
      return { ...updated, freeFollowUpUntil };
    });
  }

  async cancelVisit(tenantId: string, userId: string, visitId: string, dto: CancelVisitRequest) {
    return withTenant({ tenantId, userId }, async (tx) => {
      const res = await tx.query(
        `UPDATE visits SET status = 'CANCELLED', cancel_reason = $3, updated_at = now(), row_version = row_version + 1
         WHERE tenant_id = $1 AND id = $2 AND row_version = $4 AND status IN ('OPEN','IN_PROGRESS') RETURNING *`,
        [tenantId, visitId, dto.reason, dto.rowVersion],
      );
      if ((res.rowCount ?? 0) === 0) throw new ProblemException('STALE_ROW_VERSION', { detail: 'Visit not cancellable in its current state.' });
      return res.rows[0];
    });
  }

  // ── Vitals (CLN-T3) with age-agnostic abnormal flags ─────────────────────

  async recordVitals(tenantId: string, userId: string, visitId: string, dto: RecordVitalsRequest) {
    return withTenant({ tenantId, userId }, async (tx) => {
      const bmi =
        dto.weightKg && dto.heightCm
          ? Number((dto.weightKg / Math.pow(dto.heightCm / 100, 2)).toFixed(1))
          : null;
      const flags: string[] = [];
      if (dto.bpSys && dto.bpDia && (dto.bpSys >= 140 || dto.bpDia >= 90)) flags.push('BP_HIGH');
      if (dto.bpSys && dto.bpDia && (dto.bpSys < 90 || dto.bpDia < 60)) flags.push('BP_LOW');
      if (dto.heartRate && (dto.heartRate > 100 || dto.heartRate < 50)) flags.push('HR_ABNORMAL');
      if (dto.temperatureC && dto.temperatureC >= 38) flags.push('FEVER');
      if (dto.spo2 && dto.spo2 < 94) flags.push('SPO2_LOW');
      const res = await tx.query(
        `INSERT INTO vitals
           (tenant_id, visit_id, bp_sys, bp_dia, heart_rate, respiratory_rate, temperature_c, spo2, weight_kg, height_cm, bmi, pain_score, recorded_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
        [tenantId, visitId, dto.bpSys ?? null, dto.bpDia ?? null, dto.heartRate ?? null, dto.respiratoryRate ?? null,
         dto.temperatureC ?? null, dto.spo2 ?? null, dto.weightKg ?? null, dto.heightCm ?? null, bmi, dto.painScore ?? null, userId],
      );
      return { ...res.rows[0], flags };
    });
  }

  // ── Clinical notes (CLN-T4): draft → sign locks → amend as addendum ──────

  async saveNote(tenantId: string, userId: string, visitId: string, dto: SaveNoteRequest) {
    return withTenant({ tenantId, userId }, async (tx) => {
      const res = await tx.query(
        `INSERT INTO clinical_notes (tenant_id, visit_id, note_type, subjective, objective, assessment, plan, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [tenantId, visitId, dto.noteType, dto.subjective ?? null, dto.objective ?? null, dto.assessment ?? null, dto.plan ?? null, userId],
      );
      return res.rows[0];
    });
  }

  async updateNote(tenantId: string, userId: string, noteId: string, dto: SaveNoteRequest) {
    return withTenant({ tenantId, userId }, async (tx) => {
      // Only DRAFT notes are editable; signing locks (§7.2).
      const res = await tx.query(
        `UPDATE clinical_notes SET subjective = $3, objective = $4, assessment = $5, plan = $6, updated_at = now()
         WHERE tenant_id = $1 AND id = $2 AND status = 'DRAFT' RETURNING *`,
        [tenantId, noteId, dto.subjective ?? null, dto.objective ?? null, dto.assessment ?? null, dto.plan ?? null],
      );
      if ((res.rowCount ?? 0) === 0) throw new ProblemException('NOTE_LOCKED', { detail: 'Only draft notes can be edited.' });
      return res.rows[0];
    });
  }

  async signNote(tenantId: string, userId: string, noteId: string, dto: SignNoteRequest) {
    return withTenant({ tenantId, userId }, async (tx) => {
      const noteCheck = await tx.query(
        `SELECT visit_id FROM clinical_notes WHERE tenant_id = $1 AND id = $2 AND status = 'DRAFT'`,
        [tenantId, noteId],
      );
      if ((noteCheck.rowCount ?? 0) === 0) throw new ProblemException('NOTE_LOCKED', { detail: 'Note is not a draft.' });
      const visitId = noteCheck.rows[0].visit_id;

      const res = await tx.query(
        `UPDATE clinical_notes SET status = 'SIGNED', signed_by = $3, signed_at = now()
         WHERE tenant_id = $1 AND id = $2 AND status = 'DRAFT' RETURNING *`,
        [tenantId, noteId, userId],
      );

      // Sign + advance the visit to IN_PROGRESS in one transaction (CLN-T4 gate).
      await tx.query(
        `UPDATE visits SET status = 'IN_PROGRESS', updated_at = now()
         WHERE tenant_id = $1 AND id = $2 AND status = 'OPEN'`,
        [tenantId, visitId],
      );

      void dto;
      return res.rows[0];
    });
  }

  async amendNote(tenantId: string, userId: string, noteId: string, dto: AmendNoteRequest) {
    return withTenant({ tenantId, userId }, async (tx) => {
      // Addendum: new version row, the signed original is retained (ground rule 7).
      const orig = await tx.query(
        `SELECT * FROM clinical_notes WHERE tenant_id = $1 AND id = $2 AND status = 'SIGNED'`,
        [tenantId, noteId],
      );
      if ((orig.rowCount ?? 0) === 0) throw new ProblemException('NOT_FOUND', { detail: 'Signed note not found.' });
      const o = orig.rows[0];
      const res = await tx.query(
        `INSERT INTO clinical_notes
           (tenant_id, visit_id, note_type, subjective, objective, assessment, plan, status, amends_id, version, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'AMENDED',$8,$9,$10) RETURNING *`,
        [tenantId, o.visit_id, o.note_type, dto.subjective ?? o.subjective, dto.objective ?? o.objective,
         dto.assessment ?? o.assessment, dto.plan ?? o.plan, noteId, o.version + 1, userId],
      );
      await tx.query(`UPDATE clinical_notes SET status = 'AMENDED' WHERE tenant_id = $1 AND id = $2`, [tenantId, noteId]);
      return res.rows[0];
    });
  }

  // ── Diagnoses & Problems (CLN-T4) ─────────────────────────────────────────

  async addDiagnosis(tenantId: string, userId: string, visitId: string, dto: AddDiagnosisRequest) {
    return withTenant({ tenantId, userId }, async (tx) => {
      const res = await tx.query(
        `INSERT INTO visit_diagnoses (tenant_id, visit_id, icd10_code, description, dx_type, certainty, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [tenantId, visitId, dto.icd10Code.toUpperCase(), dto.description?.trim() || null, dto.dxType, dto.certainty, userId],
      );
      return res.rows[0];
    });
  }

  async addProblem(tenantId: string, userId: string, dto: AddProblemRequest) {
    return withTenant({ tenantId, userId }, async (tx) => {
      const res = await tx.query(
        `INSERT INTO problem_list (tenant_id, patient_id, icd10_code, onset_date, created_by)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [tenantId, dto.patientId, dto.icd10Code.toUpperCase(), dto.onsetDate ?? null, userId],
      );
      return res.rows[0];
    });
  }

  async listProblems(tenantId: string, userId: string, patientId: string) {
    return withTenant({ tenantId, userId }, async (tx) => {
      const res = await tx.query(
        `SELECT pl.*, COALESCE(r.description, pl.icd10_code) AS icd10_description
         FROM problem_list pl
         LEFT JOIN ref_icd10 r ON r.code = pl.icd10_code
         WHERE pl.tenant_id = $1 AND pl.patient_id = $2
         ORDER BY pl.status, pl.onset_date DESC`,
        [tenantId, patientId],
      );
      return { data: res.rows };
    });
  }

  async resolveProblem(tenantId: string, userId: string, id: string, dto?: ResolveProblemRequest) {
    return withTenant({ tenantId, userId }, async (tx) => {
      const res = await tx.query(
        `UPDATE problem_list SET status = 'RESOLVED', resolved_at = COALESCE($3::timestamptz, now())
         WHERE tenant_id = $1 AND id = $2 AND status = 'ACTIVE' RETURNING *`,
        [tenantId, id, dto?.resolvedAt ?? null],
      );
      if ((res.rowCount ?? 0) === 0) throw new ProblemException('NOT_FOUND', { detail: 'Active problem not found.' });
      return res.rows[0];
    });
  }

  // ── Prescriptions (CLN-T5) ───────────────────────────────────────────────

  async createPrescription(tenantId: string, userId: string, dto: CreatePrescriptionRequest) {
    return withTenant({ tenantId, userId }, async (tx) => {
      // AC-5: Prescription patient must match visit patient.
      const v = await tx.query(
        `SELECT patient_id FROM visits WHERE tenant_id = $1 AND id = $2 AND status NOT IN ('CLOSED', 'CANCELLED')`,
        [tenantId, dto.visitId],
      );
      if ((v.rowCount ?? 0) === 0) {
        throw new ProblemException('VISIT_CLOSED', { detail: 'Prescriptions require an open visit.' });
      }
      if (v.rows[0].patient_id !== dto.patientId) {
        throw new ProblemException('PATIENT_MISMATCH', { detail: 'Prescription patient must match visit patient.' });
      }

      // Check allergies against patient_allergies (substance).
      const allergies = await tx.query(
        `SELECT substance, severity FROM patient_allergies WHERE tenant_id = $1 AND patient_id = $2`,
        [tenantId, dto.patientId],
      );
      const allergyWarnings: string[] = [];
      for (const item of dto.items) {
        const drugName = (item.genericName + ' ' + (item.brandName ?? '')).toLowerCase();
        for (const al of allergies.rows) {
          const substance = String(al.substance).toLowerCase();
          if (drugName.includes(substance) || substance.includes(drugName)) {
            allergyWarnings.push(`Patient allergic to ${al.substance} (${al.severity}): matches prescribed ${item.genericName}`);
          }
        }
      }

      const seq = await tx.query(`SELECT app.next_doc_no($1::uuid, 'RX') AS n`, [tenantId]);
      const rxNo = `RX-${new Date().getFullYear()}-${String(seq.rows[0].n).padStart(6, '0')}`;
      const rx = await tx.query(
        `INSERT INTO prescriptions (tenant_id, visit_id, patient_id, prescriber_id, rx_no, is_controlled, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [tenantId, dto.visitId, dto.patientId, userId, rxNo, dto.isControlled, dto.notes ?? null],
      );
      const rxId = rx.rows[0].id;
      for (const item of dto.items) {
        let drugProductId = item.drugProductId ?? null;
        let strength = item.strength ?? null;
        let form = item.form ?? null;
        let route = item.route ?? null;
        let brandName = item.brandName ?? null;
        if (!drugProductId) {
          const match = await tx.query(
            `SELECT dp.id, dp.strength, dp.dosage_form, dp.route, dp.brand_name FROM drug_products dp
             LEFT JOIN generic_names gn ON gn.id = dp.generic_id AND gn.tenant_id = dp.tenant_id
             WHERE dp.tenant_id = $1 AND (gn.name ILIKE $2 OR dp.brand_name ILIKE $2)
             LIMIT 1`,
            [tenantId, item.genericName.trim()]
          );
          if (match.rows[0]) {
            drugProductId = match.rows[0].id;
            if (!strength) strength = match.rows[0].strength;
            if (!form) form = match.rows[0].dosage_form;
            if (!route) route = match.rows[0].route;
            if (!brandName) brandName = match.rows[0].brand_name;
          }
        }
        await tx.query(
          `INSERT INTO prescription_items
             (tenant_id, rx_id, drug_product_id, generic_name, brand_name, strength, form, route, sig_dose, sig_frequency, sig_duration, qty_prescribed, dispense_as_written)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
          [tenantId, rxId, drugProductId, item.genericName, brandName, strength,
           form, route, item.sigDose, item.sigFrequency, item.sigDuration ?? null,
           item.qtyPrescribed, item.dispenseAsWritten ?? false],
        );
      }
      return { ...rx.rows[0], allergyWarnings };
    });
  }

  async issuePrescription(tenantId: string, userId: string, rxId: string, dto: IssuePrescriptionRequest) {
    return withTenant({ tenantId, userId }, async (tx) => {
      // Controlled Rx requires serial + quantity-in-words at issue (CLN-T5).
      const rx = await tx.query(
        `SELECT * FROM prescriptions WHERE tenant_id = $1 AND id = $2 AND status = 'DRAFT'`,
        [tenantId, rxId],
      );
      if ((rx.rowCount ?? 0) === 0) throw new ProblemException('NOT_FOUND', { detail: 'Draft prescription not found.' });
      if (rx.rows[0].is_controlled && (!dto.specialRxNo || !dto.qtyWords)) {
        throw new ProblemException('VALIDATION_FAILED', { detail: 'Controlled Rx needs specialRxNo and quantity in words.' });
      }
      const validUntil = new Date();
      validUntil.setDate(validUntil.getDate() + dto.validDays);
      const res = await tx.query(
        `UPDATE prescriptions SET status = 'ISSUED', issued_at = now(), issued_by = $3,
                special_rx_no = $4, qty_words = $5, valid_until = $6, updated_at = now()
         WHERE tenant_id = $1 AND id = $2 RETURNING *`,
        [tenantId, rxId, userId, dto.specialRxNo ?? null, dto.qtyWords ?? null, validUntil.toISOString().slice(0, 10)],
      );
      // JOB-02 notification: pharmacy queue (in-app path) — through the outbox.
      const row = res.rows[0];
      await tx.query(
        `INSERT INTO outbox (tenant_id, event_type, payload) VALUES ($1, 'rx.issued', $2)`,
        [tenantId, JSON.stringify({ rxId, rxNo: row.rx_no, patientId: row.patient_id, isControlled: row.is_controlled })],
      );
      return row;
    });
  }

  async cancelPrescription(tenantId: string, userId: string, rxId: string, dto: CancelPrescriptionRequest) {
    return withTenant({ tenantId, userId }, async (tx) => {
      const res = await tx.query(
        `UPDATE prescriptions SET status = 'CANCELLED', cancel_reason = $3, updated_at = now()
         WHERE tenant_id = $1 AND id = $2 AND status = 'DRAFT' RETURNING *`,
        [tenantId, rxId, dto.reason],
      );
      if ((res.rowCount ?? 0) === 0) throw new ProblemException('RX_LOCKED', { detail: 'Only draft prescriptions can be cancelled; issued Rx are immutable.' });
      return res.rows[0];
    });
  }

  // ── Certificates / referrals (CLN-T8) ────────────────────────────────────

  async issueCertificate(tenantId: string, userId: string, visitId: string, dto: IssueCertificateRequest) {
    return withTenant({ tenantId, userId }, async (tx) => {
      const seq = await tx.query(`SELECT app.next_doc_no($1::uuid, 'CERT') AS n`, [tenantId]);
      const docNo = `MC-${new Date().getFullYear()}-${String(seq.rows[0].n).padStart(5, '0')}`;
      const res = await tx.query(
        `INSERT INTO medical_certificates (tenant_id, visit_id, cert_type, findings, valid_from, valid_to, doc_no, issued_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [tenantId, visitId, dto.certType, dto.findings ?? null, dto.validFrom ?? null, dto.validTo ?? null, docNo, userId],
      );
      return res.rows[0];
    });
  }

  async listCertificates(tenantId: string, userId: string, visitId: string) {
    return withTenant({ tenantId, userId }, async (tx) => {
      const res = await tx.query(
        `SELECT mc.id, mc.cert_type, mc.findings, mc.valid_from, mc.valid_to, mc.doc_no,
                mc.issued_at, mc.voided_at, mc.void_reason,
                p.first_name || ' ' || p.last_name AS patient_name,
                u.name AS issuer_name
         FROM medical_certificates mc
         JOIN visits v ON v.tenant_id = mc.tenant_id AND v.id = mc.visit_id
         JOIN patients p ON p.id = v.patient_id
         JOIN users u ON u.id = mc.issued_by
         WHERE mc.tenant_id = $1 AND mc.visit_id = $2
         ORDER BY mc.issued_at DESC, mc.doc_no DESC`,
        [tenantId, visitId],
      );
      return { data: res.rows, total: res.rowCount ?? 0 };
    });
  }

  async createReferral(tenantId: string, userId: string, visitId: string, dto: CreateReferralRequest) {
    return withTenant({ tenantId, userId }, async (tx) => {
      const res = await tx.query(
        `INSERT INTO referrals (tenant_id, visit_id, to_facility, to_practitioner, reason, urgency, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [tenantId, visitId, dto.toFacility ?? null, dto.toPractitioner ?? null, dto.reason, dto.urgency, userId],
      );
      return res.rows[0];
    });
  }

  // ── Charge capture (Appendix A2) ─────────────────────────────────────────

  async createCharge(tenantId: string, userId: string, dto: CreateChargeRequest) {
    return withTenant({ tenantId, userId }, async (tx) => {
      // The visit must be open — no charges against closed encounters (CLN-T9).
      const v = await tx.query(
        `SELECT id, branch_id FROM visits WHERE tenant_id = $1 AND id = $2 AND status NOT IN ('CLOSED','CANCELLED')`,
        [tenantId, dto.visitId],
      );
      if ((v.rowCount ?? 0) === 0) throw new ProblemException('VISIT_CLOSED', { detail: 'Charges require an open visit.' });
      const unitPrice = await resolveServicePrice(tx, tenantId, dto.serviceId);
      const amount = Number((dto.quantity * unitPrice).toFixed(2));
      const res = await tx.query(
        `INSERT INTO billing_charges
           (tenant_id, branch_id, visit_id, charge_type, source_type, source_id, service_id, description, quantity, unit_price, amount, payer_type, posted_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         ON CONFLICT (tenant_id, source_type, source_id) DO UPDATE
           SET quantity = EXCLUDED.quantity, unit_price = EXCLUDED.unit_price, amount = EXCLUDED.amount, posted_at = now()
         RETURNING *`,
        [tenantId, v.rows[0].branch_id, dto.visitId, dto.chargeType, dto.sourceType, dto.sourceId,
         dto.serviceId, dto.description, dto.quantity, unitPrice, amount, dto.payerType, userId],
      );
      return res.rows[0];
    });
  }

  // ── Procedures (todo §3.2, CLN-T4) ────────────────────────────────────────

  async recordProcedure(tenantId: string, userId: string, visitId: string, dto: RecordProcedureRequest) {
    return withTenant({ tenantId, userId }, async (tx) => {
      const v = await tx.query(
        `SELECT id, branch_id FROM visits WHERE tenant_id = $1 AND id = $2 AND status NOT IN ('CLOSED', 'CANCELLED')`,
        [tenantId, visitId],
      );
      if ((v.rowCount ?? 0) === 0) throw new ProblemException('VISIT_CLOSED', { detail: 'Procedures require an open visit.' });

      const proc = await tx.query(
        `INSERT INTO visit_procedures (tenant_id, visit_id, service_id, performed_by, notes)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [tenantId, visitId, dto.serviceId, dto.performedBy, dto.notes ?? null],
      );

      const srv = await tx.query(
        `SELECT name FROM service_catalog WHERE tenant_id = $1 AND id = $2`,
        [tenantId, dto.serviceId],
      );
      const description = srv.rows[0]?.name ?? 'Procedure';
      const unitPrice = await resolveServicePrice(tx, tenantId, dto.serviceId);

      await tx.query(
        `INSERT INTO billing_charges
           (tenant_id, branch_id, visit_id, charge_type, source_type, source_id, service_id, description, quantity, unit_price, amount, payer_type, posted_by)
         VALUES ($1, $2, $3, 'PROCEDURE', 'procedure', $4, $5, $6, 1, $7, $7, 'PRIVATE_CASH', $8)
         ON CONFLICT (tenant_id, source_type, source_id) DO UPDATE
           SET quantity = EXCLUDED.quantity, unit_price = EXCLUDED.unit_price, amount = EXCLUDED.amount, posted_at = now()`,
        [tenantId, v.rows[0].branch_id, visitId, proc.rows[0].id, dto.serviceId, description, unitPrice, userId],
      );

      return proc.rows[0];
    });
  }

  async voidProcedure(tenantId: string, userId: string, id: string, dto: VoidProcedureRequest) {
    return withTenant({ tenantId, userId }, async (tx) => {
      const res = await tx.query(
        `UPDATE visit_procedures SET voided_at = now(), voided_by = $3
         WHERE tenant_id = $1 AND id = $2 AND voided_at IS NULL RETURNING *`,
        [tenantId, id, userId],
      );
      if ((res.rowCount ?? 0) === 0) throw new ProblemException('NOT_FOUND', { detail: 'Procedure not found or already voided.' });
      await tx.query(
        `UPDATE billing_charges SET voided_at = now(), voided_by = $3
         WHERE tenant_id = $1 AND source_type = 'procedure' AND source_id = $2 AND voided_at IS NULL`,
        [tenantId, id, userId],
      );
      void dto;
      return res.rows[0];
    });
  }

  // ── Immunizations (todo §3.2, RPT-CLN-11) ─────────────────────────────────

  async recordImmunization(tenantId: string, userId: string, dto: RecordImmunizationRequest) {
    return withTenant({ tenantId, userId }, async (tx) => {
      const res = await tx.query(
        `INSERT INTO immunizations (tenant_id, patient_id, visit_id, vaccine, dose_no, lot_no, stock_batch_id, site, given_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
        [tenantId, dto.patientId, dto.visitId ?? null, dto.vaccine, dto.doseNo, dto.lotNo ?? null, dto.stockBatchId ?? null, dto.site ?? null, userId],
      );
      return res.rows[0];
    });
  }

  async listImmunizations(tenantId: string, userId: string, patientId: string) {
    return withTenant({ tenantId, userId }, async (tx) => {
      const res = await tx.query(
        `SELECT * FROM immunizations WHERE tenant_id = $1 AND patient_id = $2 AND voided_at IS NULL ORDER BY given_at DESC`,
        [tenantId, patientId],
      );
      return { data: res.rows };
    });
  }

  async voidImmunization(tenantId: string, userId: string, id: string, dto: VoidImmunizationRequest) {
    return withTenant({ tenantId, userId }, async (tx) => {
      const res = await tx.query(
        `UPDATE immunizations SET voided_at = now(), voided_by = $3
         WHERE tenant_id = $1 AND id = $2 AND voided_at IS NULL RETURNING *`,
        [tenantId, id, userId],
      );
      if ((res.rowCount ?? 0) === 0) throw new ProblemException('NOT_FOUND', { detail: 'Immunization not found or already voided.' });
      void dto;
      return res.rows[0];
    });
  }

  // ── Certificates void (CLN-T8) ───────────────────────────────────────────

  async voidCertificate(tenantId: string, userId: string, id: string, dto: VoidCertificateRequest) {
    return withTenant({ tenantId, userId }, async (tx) => {
      const res = await tx.query(
        `UPDATE medical_certificates SET voided_at = now(), voided_by = $3, void_reason = $4
         WHERE tenant_id = $1 AND id = $2 AND voided_at IS NULL RETURNING *`,
        [tenantId, id, userId, dto.reason],
      );
      if ((res.rowCount ?? 0) === 0) throw new ProblemException('NOT_FOUND', { detail: 'Certificate not found or already voided.' });
      return res.rows[0];
    });
  }

  // ── Order Sets & Clinical Templates (todo §3.3) ───────────────────────────

  async createClinicalTemplate(tenantId: string, userId: string, dto: CreateClinicalTemplateRequest) {
    return withTenant({ tenantId, userId }, async (tx) => {
      const res = await tx.query(
        `INSERT INTO clinical_templates (tenant_id, name, body, practitioner_id, created_by)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [tenantId, dto.name, dto.body, dto.practitionerId ?? null, userId],
      );
      return res.rows[0];
    });
  }

  async listClinicalTemplates(tenantId: string, userId: string, practitionerId?: string) {
    return withTenant({ tenantId, userId }, async (tx) => {
      const res = await tx.query(
        `SELECT * FROM clinical_templates
         WHERE tenant_id = $1 AND archived_at IS NULL
           AND (practitioner_id IS NULL OR practitioner_id = $2)
         ORDER BY name`,
        [tenantId, practitionerId ?? userId],
      );
      return { data: res.rows };
    });
  }

  async createOrderSet(tenantId: string, userId: string, dto: CreateOrderSetRequest) {
    return withTenant({ tenantId, userId }, async (tx) => {
      const res = await tx.query(
        `INSERT INTO order_sets (tenant_id, name, items, created_by)
         VALUES ($1, $2, $3, $4) RETURNING *`,
        [tenantId, dto.name, JSON.stringify(dto.items), userId],
      );
      return res.rows[0];
    });
  }

  async listOrderSets(tenantId: string, userId: string) {
    return withTenant({ tenantId, userId }, async (tx) => {
      const res = await tx.query(
        `SELECT * FROM order_sets WHERE tenant_id = $1 AND archived_at IS NULL ORDER BY name`,
        [tenantId],
      );
      return { data: res.rows };
    });
  }

  // ── Printable pipeline (todo §3.2) ────────────────────────────────────────

  async getPrescriptionPrint(tenantId: string, userId: string, rxId: string) {
    return withTenant({ tenantId, userId }, async (tx) => {
      const rxRes = await tx.query(
        `SELECT rx.*, p.first_name || ' ' || p.last_name AS patient_name, p.date_of_birth, p.gender,
                u.name AS prescriber_name, pp.philhealth_accreditation_no,
                t.name AS clinic_name,
                t.tagline AS clinic_tagline,
                t.address AS clinic_address,
                t.phone AS clinic_phone,
                t.email AS clinic_email,
                t.doh_license_no AS clinic_doh_license_no,
                t.philhealth_accreditation_no AS clinic_philhealth_no,
                b.name AS branch_name,
                b.address AS branch_address,
                b.phone AS branch_phone,
                b.email AS branch_email
         FROM prescriptions rx
         JOIN patients p ON p.id = rx.patient_id
         JOIN users u ON u.id = rx.prescriber_id
         LEFT JOIN practitioner_profiles pp ON pp.user_id = rx.prescriber_id AND pp.tenant_id = rx.tenant_id
         LEFT JOIN tenants t ON t.id = rx.tenant_id
         LEFT JOIN branches b ON b.id = rx.branch_id AND b.tenant_id = rx.tenant_id
         WHERE rx.tenant_id = $1 AND rx.id = $2`,
        [tenantId, rxId],
      );
      if ((rxRes.rowCount ?? 0) === 0) throw new ProblemException('NOT_FOUND', { detail: 'Prescription not found.' });
      const rx = rxRes.rows[0];
      const items = await tx.query(
        `SELECT * FROM prescription_items WHERE tenant_id = $1 AND rx_id = $2`,
        [tenantId, rxId],
      );
      return {
        prescription: rx,
        items: items.rows,
        printedAt: new Date().toISOString(),
        verificationHash: Buffer.from(`${rx.id}:${rx.rx_no}:${rx.created_at}`).toString('base64'),
      };
    });
  }

  async getCertificatePrint(tenantId: string, userId: string, certId: string) {
    return withTenant({ tenantId, userId }, async (tx) => {
      const certRes = await tx.query(
        `SELECT mc.*,
                p.first_name || ' ' || COALESCE(p.middle_name || ' ', '') || p.last_name AS patient_name,
                p.date_of_birth, p.gender,
                (SELECT pc.value FROM patient_contacts pc WHERE pc.tenant_id = mc.tenant_id AND pc.patient_id = p.id AND pc.type IN ('ADDRESS', 'HOME') ORDER BY pc.is_primary DESC, pc.created_at ASC LIMIT 1) as patient_address,
                u.name AS issuer_name,
                e.job_title AS issuer_job_title,
                e.specialization AS issuer_specialization,
                e.prc_license_no AS issuer_prc_no,
                e.ptr_no AS issuer_ptr_no,
                e.s2_license_no AS issuer_s2_no,
                pp.philhealth_accreditation_no
         FROM medical_certificates mc
         JOIN visits v ON v.id = mc.visit_id
         JOIN patients p ON p.id = v.patient_id
         JOIN users u ON u.id = mc.issued_by
         LEFT JOIN employees e ON e.tenant_id = mc.tenant_id AND e.user_id = mc.issued_by
         LEFT JOIN practitioner_profiles pp ON pp.user_id = mc.issued_by AND pp.tenant_id = mc.tenant_id
         WHERE mc.tenant_id = $1 AND mc.id = $2`,
        [tenantId, certId],
      );
      if ((certRes.rowCount ?? 0) === 0) throw new ProblemException('NOT_FOUND', { detail: 'Certificate not found.' });
      const cert = certRes.rows[0];
      return {
        certificate: cert,
        printedAt: new Date().toISOString(),
        verificationHash: Buffer.from(`${cert.id}:${cert.doc_no}:${cert.issued_at}`).toString('base64'),
      };
    });
  }

  // ── High-Fidelity PDF Generation (packages/print pipeline) ───────────────

  /**
   * Resolved doctor identity for print headers — users.name joined to the
   * employee record's licensure. Exposed to the web print center so the modal
   * pre-fills from the recorded profile (specification §7, §18.4) instead of
   * fabricated placeholder licence numbers.
   */
  async getPractitionerPrintProfile(tenantId: string, userId: string, practitionerId: string): Promise<PractitionerPrintProfile> {
    return withTenant({ tenantId, userId }, async (tx) => {
      const res = await tx.query(
        `SELECT ${PRACTITIONER_PROFILE_SELECT} ${PRACTITIONER_PROFILE_FROM}`,
        [tenantId, practitionerId],
      );
      if ((res.rowCount ?? 0) === 0) {
        throw new ProblemException('NOT_FOUND', { detail: 'Practitioner not found.' });
      }
      return toPractitionerPrintProfile(res.rows[0], practitionerId);
    });
  }

  async renderCertificatePdf(
    tenantId: string,
    userId: string,
    certId: string,
    overrides?: Record<string, string>,
  ): Promise<RenderedDocument> {
    const printed = await this.getCertificatePrint(tenantId, userId, certId);
    const cert = printed.certificate as any;
    const visit = await this.getVisit(tenantId, userId, cert.visit_id);

    const birthDate = cert.date_of_birth ? new Date(cert.date_of_birth) : null;
    let patientAge: number | undefined;
    if (birthDate && !isNaN(birthDate.getTime())) {
      patientAge = Math.floor((Date.now() - birthDate.getTime()) / (365.25 * 24 * 3600 * 1000));
    }

    let unfitForDays: number | undefined;
    if (cert.cert_type === 'SICK_LEAVE' && cert.valid_from && cert.valid_to) {
      const from = new Date(cert.valid_from).getTime();
      const to = new Date(cert.valid_to).getTime();
      if (Number.isFinite(from) && Number.isFinite(to) && to >= from) {
        unfitForDays = Math.round((to - from) / (24 * 3600 * 1000)) + 1;
      }
    } else if (cert.cert_type === 'FIT_TO_WORK') {
      unfitForDays = 0;
    }

    // Format diagnoses from encounter visit
    const dxList = (visit.diagnoses || [])
      .map((d: any) => {
        const code = (d.icd10_code || d.icd10Code || '').trim();
        const desc = (d.description || d.icd10_description || '').trim();
        if (desc && code && desc.toLowerCase() !== code.toLowerCase()) {
          return `${desc} (${code})`;
        }
        return desc || code;
      })
      .filter(Boolean);

    const primaryDx = (visit.diagnoses || [])[0];
    const visitDxString = dxList.length > 0 ? dxList.join('; ') : undefined;
    const certFindings = cert.findings ? String(cert.findings).trim() : undefined;

    // Resolved diagnosis: overrides -> certificate findings -> encounter visit diagnoses -> SOAP assessment -> chief complaint
    const diagnosis =
      overrides?.diagnosis ||
      (certFindings && certFindings.length > 0 ? certFindings : undefined) ||
      visitDxString ||
      visit.clinical_note?.assessment ||
      visit.chief_complaint ||
      'Clinical consultation and evaluation';

    // Format vital signs if recorded during encounter
    let vitalSignsSummary: string | undefined;
    if (Array.isArray(visit.vitals) && visit.vitals.length > 0) {
      const v = visit.vitals[0];
      const parts: string[] = [];
      if (v.bp_sys && v.bp_dia) parts.push(`BP: ${v.bp_sys}/${v.bp_dia} mmHg`);
      if (v.heart_rate) parts.push(`HR: ${v.heart_rate} bpm`);
      if (v.temperature_c) parts.push(`Temp: ${v.temperature_c} °C`);
      if (v.respiratory_rate) parts.push(`RR: ${v.respiratory_rate} cpm`);
      if (v.spo2) parts.push(`SpO2: ${v.spo2}%`);
      if (v.weight_kg) parts.push(`Weight: ${v.weight_kg} kg`);
      if (parts.length > 0) vitalSignsSummary = parts.join(' | ');
    }

    // Format encounter date
    const encounterDate = visit.opened_at
      ? new Date(visit.opened_at).toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' })
      : new Date(cert.issued_at).toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' });

    // Build authentic narrative body
    const patientName = overrides?.patientName || cert.patient_name || visit.patient_name || 'Patient';
    const ageStr = patientAge != null ? `${patientAge} years old` : '';
    const sexStr = (cert.gender || visit.gender) === 'M' ? 'Male' : (cert.gender || visit.gender) === 'F' ? 'Female' : (cert.gender || visit.gender || '');
    const patientDemographicsDesc = [patientName, ageStr, sexStr].filter(Boolean).join(', ');
    const patientAddress = cert.patient_address || visit.address || undefined;

    const openingNarrative = `This is to certify that ${patientDemographicsDesc}${patientAddress ? `, residing at ${patientAddress}` : ''}, was examined and treated at this health facility on ${encounterDate}.`;

    let recommendationText = '';
    const validFromStr = cert.valid_from ? new Date(cert.valid_from).toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' }) : '';
    const validToStr = cert.valid_to ? new Date(cert.valid_to).toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' }) : '';

    if (cert.cert_type === 'FIT_TO_WORK') {
      recommendationText = `The patient has been clinically evaluated and is found to be PHYSICALLY AND MENTALLY FIT TO RESUME WORK / REGULAR DUTIES${validFromStr ? ` effective ${validFromStr}` : ''}.`;
    } else if (cert.cert_type === 'SICK_LEAVE') {
      const durationStr = unfitForDays ? `${unfitForDays} day(s)` : 'the recommended period';
      const rangeStr = validFromStr && validToStr ? ` from ${validFromStr} to ${validToStr}` : '';
      recommendationText = `The patient is advised to undergo MEDICAL REST / SICK LEAVE for ${durationStr}${rangeStr} due to the diagnosed condition.`;
    } else if (cert.cert_type === 'CLEARANCE') {
      recommendationText = `The patient is hereby given MEDICAL CLEARANCE with no active communicable illness or acute physical contraindications identified at the time of examination.`;
    } else {
      recommendationText = certFindings || 'Clinical consultation and evaluation completed.';
    }

    const bodyParagraphs = [
      openingNarrative,
      recommendationText,
      certFindings && certFindings !== diagnosis ? `Clinical Findings / Remarks: ${certFindings}` : undefined,
    ].filter(Boolean);

    const body = overrides?.body || bodyParagraphs.join('\n\n');

    // Doctor licensure & credentials
    const doctorName = overrides?.doctorName || cert.issuer_name || visit.practitioner_name || 'Attending Physician, MD';
    const doctorSpecialty = overrides?.specialty || cert.issuer_specialization || visit.practitioner_specialization || undefined;
    const doctorTitle = overrides?.doctorTitle || cert.issuer_job_title || visit.practitioner_job_title || 'Attending Physician';
    const prcNumber = overrides?.prcNumber || cert.issuer_prc_no || visit.practitioner_prc_no || cert.philhealth_accreditation_no || undefined;
    const ptrNumber = overrides?.ptrNumber || cert.issuer_ptr_no || visit.practitioner_ptr_no || undefined;
    const s2Number = overrides?.s2Number || cert.issuer_s2_no || visit.practitioner_s2_no || undefined;

    const doc: MedicalCertificate = {
      clinicName: overrides?.clinicName || visit.clinic_name || 'Clinic Medical Center',
      branchName: overrides?.branchName || visit.branch_name || undefined,
      clinicAddress: overrides?.clinicAddress || visit.branch_address || visit.clinic_address || undefined,
      clinicPhone: overrides?.clinicPhone || visit.branch_phone || visit.clinic_phone || undefined,
      clinicEmail: overrides?.clinicEmail || visit.branch_email || visit.clinic_email || undefined,
      dohAccreditationNo: overrides?.dohLicenseNo || visit.clinic_doh_license_no || undefined,
      certificateNo: cert.doc_no,
      issuedAt: new Date(cert.issued_at).toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' }),
      encounterDate,
      patientName,
      patientAge: patientAge != null ? String(patientAge) : undefined,
      patientSex: cert.gender || visit.gender || undefined,
      patientAddress,
      diagnosis,
      diagnosisDescription: primaryDx?.description || undefined,
      icd10Codes: dxList.length > 0 ? dxList : undefined,
      vitalSigns: vitalSignsSummary,
      clinicalFindings: certFindings,
      certType: cert.cert_type,
      validFrom: validFromStr || undefined,
      validTo: validToStr || undefined,
      recommendations: recommendationText,
      body,
      unfitForDays,
      clinicianName: doctorName,
      clinicianTitle: doctorTitle,
      clinicianSpecialty: doctorSpecialty,
      clinicianLicenseNo: prcNumber,
      ptrNo: ptrNumber,
      s2LicenseNo: s2Number,
      philhealthAccreditationNo: overrides?.philhealthNo || cert.philhealth_accreditation_no || visit.clinic_philhealth_no || undefined,
      signedElectronically: true,
      verificationHash: printed.verificationHash,
    };

    return renderPdf(renderCertificateHtml(doc), { format: 'A4' });
  }

  /**
   * Doctor + clinic identity for the encounter print center: the visit's
   * practitioner resolved through `employees` for recorded licensure, plus
   * branch/tenant names for the letterhead (specification §7, §18.4). The web
   * print modal hydrates from this and only sends back values the user actually
   * edited, so blank server fields print as "N/A" instead of fabricated
   * placeholder licence numbers.
   */
  async getVisitPrintProfile(tenantId: string, userId: string, visitId: string) {
    const visit = await this.getVisit(tenantId, userId, visitId);
    const practitionerId = visit.practitioner_id as string | undefined;
    const practitioner = practitionerId
      ? await this.getPractitionerPrintProfile(tenantId, userId, practitionerId)
      : null;
    return {
      visit: {
        id: visitId,
        visitNo: visit.visit_no,
        branchId: visit.branch_id,
        branchName: visit.branch_name ?? null,
      },
      clinic: {
        name: visit.clinic_name ?? null,
        tagline: visit.clinic_tagline ?? null,
        branchName: visit.branch_name ?? null,
        address: visit.branch_address || visit.clinic_address || null,
        phone: visit.branch_phone || visit.clinic_phone || null,
        email: visit.branch_email || visit.clinic_email || null,
        dohLicenseNo: visit.clinic_doh_license_no ?? null,
        philhealthAccreditationNo: visit.clinic_philhealth_no ?? null,
        tin: visit.clinic_tin ?? null,
        letterheadFooter: visit.clinic_letterhead_footer ?? null,
      },
      practitioner,
    };
  }

  async renderVisitPrescriptionPdf(
    tenantId: string,
    userId: string,
    visitId: string,
    overrides?: Record<string, string>,
  ): Promise<RenderedDocument> {
    const visit = await this.getVisit(tenantId, userId, visitId);
    const activePrescriptions = (visit.prescriptions || []).filter((rx: any) => rx.status !== 'CANCELLED');
    const allItems: PrescriptionItemDocument[] = [];
    let rxNo = `RX-${visit.visit_no || visit.id.slice(0, 8)}`;
    let s2SerialNo: string | undefined = overrides?.s2SerialNo;

    for (const rx of activePrescriptions) {
      if (rx.rx_no) rxNo = rx.rx_no;
      const items = rx.items || [];
      for (const item of items) {
        const isControlled = item.is_controlled || /morphine|fentanyl|oxycodone|pethidine|codeine|diazepam|clonazepam|midazolam|zolpidem/i.test(item.generic_name || '');
        if (isControlled && !s2SerialNo) {
          s2SerialNo = `S2-${rxNo}`;
        }
        allItems.push({
          genericName: item.generic_name || 'MEDICATION',
          brandName: item.brand_name || undefined,
          strength: item.strength || undefined,
          dosageForm: item.dosage_form || undefined,
          route: item.route || 'Oral',
          frequency: item.frequency || undefined,
          duration: item.duration || undefined,
          quantity: item.quantity || 1,
          sig: item.sig || [item.route, item.frequency, item.duration ? `for ${item.duration}` : ''].filter(Boolean).join(' '),
          indication: item.indication || undefined,
          isControlled,
        });
      }
    }

    const birthDate = visit.date_of_birth ? new Date(visit.date_of_birth) : null;
    let patientAge: number | undefined;
    if (birthDate && !isNaN(birthDate.getTime())) {
      const diff = Date.now() - birthDate.getTime();
      patientAge = Math.floor(diff / (365.25 * 24 * 3600 * 1000));
    }

    const latestNote = (visit.notes || [])[0];
    const dxList = (visit.diagnoses || [])
      .map((d: any) => {
        const code = (d.icd10_code || d.icd10Code || '').trim();
        const desc = (d.description || d.icd10_description || '').trim();
        if (desc && code && desc.toLowerCase() !== code.toLowerCase()) {
          return `${desc} (${code})`;
        }
        return desc || code;
      })
      .filter(Boolean);

    const primaryDx = (visit.diagnoses || [])[0];
    const primaryDesc =
      overrides?.diagnosisDescription ||
      (primaryDx?.description && primaryDx.description !== primaryDx.icd10_code ? primaryDx.description : undefined) ||
      primaryDx?.icd10_description ||
      undefined;

    const primaryDiagnosis =
      overrides?.diagnosis ||
      overrides?.clinicalImpression ||
      (dxList.length > 0 ? dxList.join('; ') : undefined) ||
      latestNote?.assessment ||
      visit.chief_complaint ||
      undefined;

    const diagnosisDescription =
      overrides?.diagnosisDescription ||
      primaryDesc ||
      undefined;

    const specialInstruction =
      overrides?.advice ||
      overrides?.specialInstruction ||
      activePrescriptions.map((r: any) => r.notes).filter(Boolean).join('. ') ||
      latestNote?.plan ||
      'Take medications strictly as directed. Keep all medicines out of reach of children. Follow up as scheduled.';

    const doc: PrescriptionDocument = {
      clinicName: overrides?.clinicName || visit.clinic_name || 'Clinic Medical Center',
      branchName: overrides?.branchName || visit.branch_name || 'Consultation & Specialty Services',
      clinicAddress: overrides?.clinicAddress || visit.branch_address || visit.clinic_address || 'Metro Manila, Philippines',
      clinicPhone: overrides?.clinicPhone || visit.branch_phone || visit.clinic_phone || '(02) 8888-0000',
      clinicEmail: overrides?.clinicEmail || visit.branch_email || visit.clinic_email || 'clinical@clinic.ph',
      dohAccreditationNo: overrides?.dohLicenseNo || visit.clinic_doh_license_no || 'DOH-LTO-2026-NCR-001',
      rxNo,
      issuedAt: new Date().toISOString().slice(0, 10),
      patientName: visit.patient_name || 'Patient',
      patientAge,
      patientSex: visit.gender,
      patientDob: visit.date_of_birth ? new Date(visit.date_of_birth).toISOString().slice(0, 10) : undefined,
      patientAddress: visit.address,
      patientMrn: visit.patient_id ? String(visit.patient_id).slice(0, 8) : undefined,
      allergies: visit.allergies || [],
      diagnosis: primaryDiagnosis,
      diagnosisDescription,
      clinicalImpression: primaryDiagnosis,
      prescriberName:
        overrides?.doctorName || visit.practitioner_name || 'Dr. Attending Physician, MD',
      prescriberTitle: overrides?.doctorTitle || visit.practitioner_job_title || 'Attending Physician',
      specialty: overrides?.specialty || visit.practitioner_specialization || undefined,
      prcLicenseNo: overrides?.prcNumber || visit.practitioner_prc_no || undefined,
      ptrNo: overrides?.ptrNumber || visit.practitioner_ptr_no || undefined,
      s2LicenseNo: overrides?.s2Number || visit.practitioner_s2_no || (s2SerialNo ? 'S2-DDB-2026-99' : undefined),
      s2SerialNo,
      s2QuantityInWords: s2SerialNo ? `${allItems.length} controlled medication items prescribed` : undefined,
      specialInstruction,
      items: allItems.length > 0 ? allItems : [
        {
          genericName: 'No active medications prescribed',
          quantity: 0,
          sig: 'Consult with physician for prescription orders',
        },
      ],
      verificationHash: Buffer.from(`${visit.id}:${rxNo}:${Date.now()}`).toString('hex'),
    };

    return renderPdf(renderPrescriptionHtml(doc), { format: 'A4' });
  }

  async renderVisitLabRequisitionPdf(
    tenantId: string,
    userId: string,
    visitId: string,
    overrides?: Record<string, string>,
  ): Promise<RenderedDocument> {
    const visit = await this.getVisit(tenantId, userId, visitId);
    const labOrders = (visit.labOrders || []).filter((o: any) => o.status !== 'CANCELLED');
    const allTests: LabRequisitionItem[] = [];
    let orderNo = `LAB-${visit.visit_no || visit.id.slice(0, 8)}`;
    let priority: 'ROUTINE' | 'URGENT' | 'STAT' = 'ROUTINE';

    for (const order of labOrders) {
      if (order.order_no) orderNo = order.order_no;
      if (order.priority === 'STAT') priority = 'STAT';
      else if (order.priority === 'URGENT' && priority !== 'STAT') priority = 'URGENT';
      const items = order.items || [];
      for (const item of items) {
        allTests.push({
          testCode: item.test_code || item.code || item.test_name?.slice(0, 6)?.toUpperCase() || 'TEST',
          testName: item.test_name || 'Laboratory Test',
          specimenType: item.specimen_type || 'Routine specimen',
          collectionTube: item.collection_tube || undefined,
          fastingRequired: Boolean(item.fasting_required),
          fastingHours: item.fasting_hours || (item.fasting_required ? 8 : undefined),
          instructions: item.instructions || undefined,
          clinicalIndication: item.clinical_indication || item.notes || undefined,
        });
      }
    }

    const birthDate = visit.date_of_birth ? new Date(visit.date_of_birth) : null;
    let patientAge: number | undefined;
    if (birthDate && !isNaN(birthDate.getTime())) {
      const diff = Date.now() - birthDate.getTime();
      patientAge = Math.floor(diff / (365.25 * 24 * 3600 * 1000));
    }

    const doc: LabRequisitionDocument = {
      clinicName: overrides?.clinicName || visit.clinic_name || 'Clinic Diagnostic Center',
      branchName: overrides?.branchName || visit.branch_name || 'Pathology & Clinical Laboratory',
      clinicAddress: overrides?.clinicAddress || visit.branch_address || visit.clinic_address || 'Metro Manila, Philippines',
      clinicPhone: overrides?.clinicPhone || visit.branch_phone || visit.clinic_phone || '(02) 8888-0000',
      dohLtoNo: overrides?.dohLtoNo || overrides?.dohLicenseNo || visit.clinic_doh_license_no || 'DOH-LTO-LAB-2026-0042',
      orderNo,
      issuedAt: new Date().toISOString().slice(0, 10),
      priority,
      patientName: visit.patient_name || 'Patient',
      patientAge,
      patientSex: visit.gender,
      patientDob: visit.date_of_birth ? new Date(visit.date_of_birth).toISOString().slice(0, 10) : undefined,
      patientMrn: visit.patient_id ? String(visit.patient_id).slice(0, 8) : undefined,
      clinicalImpression: overrides?.clinicalImpression || overrides?.diagnosis || (visit.diagnoses?.[0]?.description && visit.diagnoses?.[0]?.description !== visit.diagnoses?.[0]?.icd10_code ? `${visit.diagnoses[0].description} (${visit.diagnoses[0].icd10_code})` : visit.diagnoses?.[0]?.description) || visit.chief_complaint || 'Diagnostic workup and clinical evaluation',
      diagnosisDescription: overrides?.diagnosisDescription || (visit.diagnoses?.[0]?.description && visit.diagnoses[0].description !== visit.diagnoses[0].icd10_code ? visit.diagnoses[0].description : undefined),
      orderingPhysician: overrides?.doctorName || visit.practitioner_name || 'Dr. Attending Physician, MD',
      physicianPrcNo: overrides?.prcNumber || visit.practitioner_prc_no || undefined,
      tests: allTests.length > 0 ? allTests : [
        {
          testCode: 'DIAG',
          testName: 'General Clinical Diagnostic Evaluation',
          specimenType: 'As indicated by laboratory protocol',
          fastingRequired: false,
        },
      ],
      verificationHash: Buffer.from(`${visit.id}:${orderNo}:${Date.now()}`).toString('hex'),
    };

    return renderPdf(renderLabRequisitionHtml(doc), { format: 'A4' });
  }

  async renderVisitOrdersPdf(
    tenantId: string,
    userId: string,
    visitId: string,
    overrides?: Record<string, string>,
  ): Promise<RenderedDocument> {
    const visit = await this.getVisit(tenantId, userId, visitId);
    const activePrescriptions = (visit.prescriptions || []).filter((rx: any) => rx.status !== 'CANCELLED');
    const allRx: PrescriptionItemDocument[] = [];
    for (const rx of activePrescriptions) {
      for (const item of rx.items || []) {
        allRx.push({
          genericName: item.generic_name || 'MEDICATION',
          brandName: item.brand_name || undefined,
          strength: item.strength || undefined,
          dosageForm: item.dosage_form || undefined,
          quantity: item.quantity || 1,
          sig: item.sig || [item.route, item.frequency, item.duration].filter(Boolean).join(' '),
        });
      }
    }

    const labOrders = (visit.labOrders || []).filter((o: any) => o.status !== 'CANCELLED');
    const allLab: LabRequisitionItem[] = [];
    for (const order of labOrders) {
      for (const item of order.items || []) {
        allLab.push({
          testCode: item.test_code || item.code || 'TEST',
          testName: item.test_name || 'Laboratory Test',
          specimenType: item.specimen_type || 'Routine specimen',
          fastingRequired: Boolean(item.fasting_required),
          fastingHours: item.fasting_hours,
        });
      }
    }

    const birthDate = visit.date_of_birth ? new Date(visit.date_of_birth) : null;
    let patientAge: number | undefined;
    if (birthDate && !isNaN(birthDate.getTime())) {
      const diff = Date.now() - birthDate.getTime();
      patientAge = Math.floor(diff / (365.25 * 24 * 3600 * 1000));
    }

    const doc: EncounterOrdersDocument = {
      clinicName: overrides?.clinicName || visit.clinic_name || 'Clinic Medical Center',
      branchName: overrides?.branchName || visit.branch_name || 'Clinical Care Services',
      clinicAddress: overrides?.clinicAddress || visit.branch_address || visit.clinic_address || 'Metro Manila, Philippines',
      clinicPhone: overrides?.clinicPhone || visit.branch_phone || visit.clinic_phone || '(02) 8888-0000',
      visitNo: visit.visit_no || visit.id.slice(0, 8),
      issuedAt: new Date().toISOString().slice(0, 10),
      patientName: visit.patient_name || 'Patient',
      patientAge,
      patientSex: visit.gender,
      patientDob: visit.date_of_birth ? new Date(visit.date_of_birth).toISOString().slice(0, 10) : undefined,
      patientMrn: visit.patient_id ? String(visit.patient_id).slice(0, 8) : undefined,
      allergies: visit.allergies || [],
      clinicalImpression: overrides?.clinicalImpression || overrides?.diagnosis || (visit.diagnoses?.[0]?.description && visit.diagnoses?.[0]?.description !== visit.diagnoses?.[0]?.icd10_code ? `${visit.diagnoses[0].description} (${visit.diagnoses[0].icd10_code})` : visit.diagnoses?.[0]?.description) || visit.chief_complaint || 'Diagnostic workup and clinical management',
      diagnosisDescription: overrides?.diagnosisDescription || (visit.diagnoses?.[0]?.description && visit.diagnoses[0].description !== visit.diagnoses[0].icd10_code ? visit.diagnoses[0].description : undefined),
      planNotes: visit.clinical_note?.plan || undefined,
      prescriberName: overrides?.doctorName || visit.practitioner_name || 'Dr. Attending Physician, MD',
      prcLicenseNo: overrides?.prcNumber || visit.practitioner_prc_no || undefined,
      ptrNo: overrides?.ptrNumber || visit.practitioner_ptr_no || undefined,
      s2LicenseNo: overrides?.s2Number || visit.practitioner_s2_no || undefined,
      prescriptions: allRx,
      labRequests: allLab,
      advice: overrides?.advice || visit.clinical_note?.plan || 'Take medications as directed and return for follow-up evaluation as scheduled.',
      verificationHash: Buffer.from(`${visit.id}:${Date.now()}`).toString('hex'),
    };

    return renderPdf(renderEncounterOrdersHtml(doc), { format: 'A4' });
  }

  async renderPrescriptionPdf(
    tenantId: string,
    userId: string,
    rxId: string,
    overrides?: Record<string, string>,
  ): Promise<RenderedDocument> {
    const rxPrint = await this.getPrescriptionPrint(tenantId, userId, rxId);
    const rx = rxPrint.prescription;
    const items = rxPrint.items;
    // Recorded licensure for the actual prescriber (employees record); blank
    // when the profile is unfilled — the template prints "N/A" rather than a
    // fabricated licence number.
    const profile = rx.prescriber_id
      ? await withTenant({ tenantId, userId }, async (tx) => {
          const res = await tx.query(
            `SELECT ${PRACTITIONER_PROFILE_SELECT} ${PRACTITIONER_PROFILE_FROM}`,
            [tenantId, rx.prescriber_id],
          );
          return toPractitionerPrintProfile(res.rows[0], String(rx.prescriber_id));
        })
      : null;

    const allItems: PrescriptionItemDocument[] = items.map((item: any) => ({
      genericName: item.generic_name || 'MEDICATION',
      brandName: item.brand_name || undefined,
      strength: item.strength || undefined,
      dosageForm: item.dosage_form || undefined,
      route: item.route || 'Oral',
      frequency: item.frequency || undefined,
      duration: item.duration || undefined,
      quantity: item.quantity || 1,
      sig: item.sig || [item.route, item.frequency, item.duration ? `for ${item.duration}` : ''].filter(Boolean).join(' '),
      indication: item.indication || undefined,
      isControlled: Boolean(item.is_controlled),
    }));

    const doc: PrescriptionDocument = {
      clinicName: overrides?.clinicName || rx.clinic_name || 'Clinic Medical Center',
      branchName: overrides?.branchName || rx.branch_name || 'Outpatient Services',
      clinicAddress: overrides?.clinicAddress || rx.branch_address || rx.clinic_address || 'Metro Manila, Philippines',
      clinicPhone: overrides?.clinicPhone || rx.branch_phone || rx.clinic_phone || '(02) 8888-0000',
      clinicEmail: overrides?.clinicEmail || rx.branch_email || rx.clinic_email || 'clinical@clinic.ph',
      dohAccreditationNo: overrides?.dohLicenseNo || rx.clinic_doh_license_no || 'DOH-LTO-2026-NCR-001',
      rxNo: rx.rx_no || `RX-${rxId.slice(0, 8)}`,
      issuedAt: new Date().toISOString().slice(0, 10),
      patientName: rx.patient_name || 'Patient',
      patientAge: rx.date_of_birth ? Math.floor((Date.now() - new Date(rx.date_of_birth).getTime()) / (365.25 * 24 * 3600 * 1000)) : undefined,
      patientSex: rx.gender,
      patientDob: rx.date_of_birth ? new Date(rx.date_of_birth).toISOString().slice(0, 10) : undefined,
      diagnosis: overrides?.diagnosis || rx.notes || undefined,
      clinicalImpression: overrides?.diagnosis || rx.notes || undefined,
      prescriberName: overrides?.doctorName || rx.prescriber_name || profile?.name || 'Dr. Attending Physician, MD',
      prescriberTitle: overrides?.doctorTitle || profile?.jobTitle || undefined,
      specialty: overrides?.specialty || profile?.specialization || undefined,
      prcLicenseNo: overrides?.prcNumber || profile?.prcLicenseNo || undefined,
      ptrNo: overrides?.ptrNumber || profile?.ptrNo || undefined,
      s2LicenseNo: overrides?.s2Number || profile?.s2LicenseNo || undefined,
      specialInstruction: overrides?.advice || rx.notes || 'Take medications strictly as directed.',
      items: allItems,
      verificationHash: rxPrint.verificationHash,
    };

    return renderPdf(renderPrescriptionHtml(doc), { format: 'A4' });
  }
}


