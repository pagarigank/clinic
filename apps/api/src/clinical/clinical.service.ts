import { Injectable } from '@nestjs/common';
import { withTenant, type QueryResultRow } from '@clinic/db';
import { ProblemException } from '../http/problem.exception.js';
import type {
  BookAppointmentRequest,
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
  async getAvailability(tenantId: string, userId: string, branchId: string, practitionerId: string, date: string) {
    return withTenant({ tenantId, userId }, async (tx) => {
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
      if (sched.rowCount === 0) return { date, slots: [] };

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
      for (const s of sched.rows) {
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
                updated_at = now(), row_version = row_version + 1
         WHERE tenant_id = $1 AND id = $2 AND row_version = $5
           AND status IN ('BOOKED','CONFIRMED')
         RETURNING *`,
        [tenantId, id, dto.startsAt, dto.endsAt, dto.rowVersion],
      ).catch((err: { code?: string }) => {
        if (err.code === '23P01') throw new ProblemException('APPOINTMENT_CONFLICT', { detail: 'Target slot is taken.' });
        throw err;
      });
      if ((res.rowCount ?? 0) === 0) {
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
    return withTenant({ tenantId, userId }, async (tx) => {
      const v = await tx.query(
        `SELECT v.*, p.first_name || ' ' || p.last_name AS patient_name, p.date_of_birth, p.gender,
                u.name AS practitioner_name
         FROM visits v
         JOIN patients p ON p.id = v.patient_id
         LEFT JOIN users u ON u.id = v.practitioner_id
         WHERE v.tenant_id = $1 AND v.id = $2`,
        [tenantId, visitId],
      );
      if ((v.rowCount ?? 0) === 0) throw new ProblemException('NOT_FOUND', { detail: 'Visit not found' });
      const [vitalsRows, notes, dx, rx, procedures, charges] = await Promise.all([
        tx.query(`SELECT * FROM vitals WHERE tenant_id = $1 AND visit_id = $2 AND voided_at IS NULL ORDER BY recorded_at DESC`, [tenantId, visitId]),
        tx.query(`SELECT * FROM clinical_notes WHERE tenant_id = $1 AND visit_id = $2 ORDER BY version DESC`, [tenantId, visitId]),
        tx.query(`SELECT * FROM visit_diagnoses WHERE tenant_id = $1 AND visit_id = $2`, [tenantId, visitId]),
        tx.query(`SELECT * FROM prescriptions WHERE tenant_id = $1 AND visit_id = $2 ORDER BY created_at DESC`, [tenantId, visitId]),
        tx.query(`SELECT * FROM visit_procedures WHERE tenant_id = $1 AND visit_id = $2 AND voided_at IS NULL`, [tenantId, visitId]),
        tx.query(`SELECT * FROM billing_charges WHERE tenant_id = $1 AND visit_id = $2 AND voided_at IS NULL`, [tenantId, visitId]),
      ]);
      return {
        ...v.rows[0],
        vitals: vitalsRows.rows,
        notes: notes.rows,
        diagnoses: dx.rows,
        prescriptions: rx.rows,
        procedures: procedures.rows,
        charges: charges.rows,
      };
    });
  }

  async listVisits(tenantId: string, userId: string, branchId?: string, status?: string) {
    return withTenant({ tenantId, userId }, async (tx) => {
      const params: unknown[] = [tenantId];
      let where = '';
      if (branchId) { params.push(branchId); where += ` AND v.branch_id = $${params.length}`; }
      if (status) { params.push(status); where += ` AND v.status = $${params.length}`; }
      const res = await tx.query(
        `SELECT v.*, p.first_name || ' ' || p.last_name AS patient_name
         FROM visits v JOIN patients p ON p.id = v.patient_id
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
          `SELECT free_follow_up_days FROM practitioner_profiles WHERE tenant_id = $1 AND user_id = $2`,
          [tenantId, updated.practitioner_id],
        );
        const days = prof.rows[0]?.free_follow_up_days ?? 7;
        freeFollowUpUntil = new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
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
        `INSERT INTO visit_diagnoses (tenant_id, visit_id, icd10_code, dx_type, certainty, created_by)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [tenantId, visitId, dto.icd10Code.toUpperCase(), dto.dxType, dto.certainty, userId],
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
        `SELECT * FROM problem_list WHERE tenant_id = $1 AND patient_id = $2 ORDER BY status, onset_date DESC`,
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
        await tx.query(
          `INSERT INTO prescription_items
             (tenant_id, rx_id, drug_product_id, generic_name, brand_name, strength, form, route, sig_dose, sig_frequency, sig_duration, qty_prescribed, dispense_as_written)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
          [tenantId, rxId, item.drugProductId ?? null, item.genericName, item.brandName ?? null, item.strength ?? null,
           item.form ?? null, item.route ?? null, item.sigDose, item.sigFrequency, item.sigDuration ?? null,
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
      const amount = Number((dto.quantity * dto.unitPrice).toFixed(2));
      const res = await tx.query(
        `INSERT INTO billing_charges
           (tenant_id, branch_id, visit_id, charge_type, source_type, source_id, service_id, description, quantity, unit_price, amount, payer_type, posted_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         ON CONFLICT (tenant_id, source_type, source_id) DO UPDATE
           SET quantity = EXCLUDED.quantity, unit_price = EXCLUDED.unit_price, amount = EXCLUDED.amount, posted_at = now()
         RETURNING *`,
        [tenantId, v.rows[0].branch_id, dto.visitId, dto.chargeType, dto.sourceType, dto.sourceId,
         dto.serviceId ?? null, dto.description, dto.quantity, dto.unitPrice, amount, dto.payerType, userId],
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
      const unitPrice = dto.unitPrice ?? 0;

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
                u.name AS prescriber_name, pp.philhealth_accreditation_no
         FROM prescriptions rx
         JOIN patients p ON p.id = rx.patient_id
         JOIN users u ON u.id = rx.prescriber_id
         LEFT JOIN practitioner_profiles pp ON pp.user_id = rx.prescriber_id AND pp.tenant_id = rx.tenant_id
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
        `SELECT mc.*, p.first_name || ' ' || p.last_name AS patient_name, p.date_of_birth, p.gender,
                u.name AS issuer_name, pp.philhealth_accreditation_no
         FROM medical_certificates mc
         JOIN visits v ON v.id = mc.visit_id
         JOIN patients p ON p.id = v.patient_id
         JOIN users u ON u.id = mc.issued_by
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
}

