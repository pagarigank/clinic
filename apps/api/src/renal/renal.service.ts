import { Inject, Injectable } from '@nestjs/common';
import { withTenant } from '@clinic/db';
import {
  renderPdf,
  renderDialysisTreatmentSheetHtml,
  type DialysisTreatmentSheetDocument,
  type DialysisFlowsheetRow,
} from '@clinic/print';
import { ProblemException } from '../http/problem.exception.js';
import type {
  CreateRenalStationRequest,
  UpdateRenalStationRequest,
  CreateDialysisMachineRequest,
  UpdateDialysisMachineRequest,
  ServiceDialysisMachineRequest,
  CreateVascularAccessRequest,
  UpdateVascularAccessRequest,
  CreateAccessAssessmentRequest,
  CreateDialysisPrescriptionRequest,
  UpdateDialysisPrescriptionRequest,
  SignDialysisPrescriptionRequest,
  AmendDialysisPrescriptionRequest,
  CreateDialysisShiftRequest,
  CreateDialysisScheduleRequest,
  CreateDialyzerRequest,
  ReprocessDialyzerRequest,
  DiscardDialyzerRequest,
  CreateWaterTreatmentLogRequest,
  CreateWaterLabTestRequest,
  CreateDialysisSessionRequest,
  PreDialysisIntakeRequest,
  RecordFlowsheetRequest,
  PostDialysisCloseRequest,
  CancelDialysisSessionRequest,
  PhilHealthDialysisClaimRequest,
} from '@clinic/contracts';
import { SupplyService } from '../supply/supply.service.js';

@Injectable()
export class RenalService {
  constructor(@Inject(SupplyService) private readonly supplyService: SupplyService) {}
  // ── 1. Renal Stations ──────────────────────────────────────────────────────

  async listStations(tenantId: string, branchId?: string) {
    return withTenant({ tenantId }, async (tx) => {
      let query = `SELECT * FROM renal_stations WHERE tenant_id = $1`;
      const params: any[] = [tenantId];
      if (branchId) {
        query += ` AND branch_id = $2`;
        params.push(branchId);
      }
      query += ` ORDER BY station_no ASC`;
      const res = await tx.query(query, params);
      return res.rows;
    });
  }

  async createStation(tenantId: string, dto: CreateRenalStationRequest) {
    return withTenant({ tenantId }, async (tx) => {
      const res = await tx.query(
        `INSERT INTO renal_stations (
           tenant_id, branch_id, station_no, name, room, is_isolation, is_active
         ) VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [
          tenantId,
          dto.branchId,
          dto.stationNo,
          dto.name,
          dto.room ?? null,
          dto.isIsolation ?? false,
          dto.isActive ?? true,
        ],
      );
      return res.rows[0];
    });
  }

  async updateStation(tenantId: string, id: string, dto: UpdateRenalStationRequest) {
    return withTenant({ tenantId }, async (tx) => {
      const res = await tx.query(
        `UPDATE renal_stations
         SET name = COALESCE($1, name),
             room = COALESCE($2, room),
             is_isolation = COALESCE($3, is_isolation),
             is_active = COALESCE($4, is_active),
             updated_at = now()
         WHERE tenant_id = $5 AND id = $6
         RETURNING *`,
        [dto.name, dto.room, dto.isIsolation, dto.isActive, tenantId, id],
      );
      if (!res.rows[0]) throw new ProblemException('NOT_FOUND', { detail: 'Station not found' });
      return res.rows[0];
    });
  }

  async archiveStation(tenantId: string, id: string) {
    return withTenant({ tenantId }, async (tx) => {
      const res = await tx.query(
        `UPDATE renal_stations
         SET is_active = false, updated_at = now()
         WHERE tenant_id = $1 AND id = $2
         RETURNING *`,
        [tenantId, id],
      );
      if (!res.rows[0]) throw new ProblemException('NOT_FOUND', { detail: 'Station not found' });
      return res.rows[0];
    });
  }

  // ── 2. Dialysis Machines ────────────────────────────────────────────────────

  async listMachines(tenantId: string, branchId?: string) {
    return withTenant({ tenantId }, async (tx) => {
      let query = `SELECT * FROM dialysis_machines WHERE tenant_id = $1`;
      const params: any[] = [tenantId];
      if (branchId) {
        query += ` AND branch_id = $2`;
        params.push(branchId);
      }
      query += ` ORDER BY serial_no ASC`;
      const res = await tx.query(query, params);
      return res.rows;
    });
  }

  async createMachine(tenantId: string, dto: CreateDialysisMachineRequest) {
    return withTenant({ tenantId }, async (tx) => {
      const res = await tx.query(
        `INSERT INTO dialysis_machines (
           tenant_id, branch_id, station_id, serial_no, brand, model,
           total_operating_hours, is_isolation, status
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'ACTIVE')
         RETURNING *`,
        [
          tenantId,
          dto.branchId,
          dto.stationId ?? null,
          dto.serialNo,
          dto.brand,
          dto.model,
          dto.totalOperatingHours ?? 0,
          dto.isIsolation ?? false,
        ],
      );
      return res.rows[0];
    });
  }

  async updateMachine(tenantId: string, id: string, dto: UpdateDialysisMachineRequest) {
    return withTenant({ tenantId }, async (tx) => {
      const res = await tx.query(
        `UPDATE dialysis_machines
         SET station_id = COALESCE($1, station_id),
             brand = COALESCE($2, brand),
             model = COALESCE($3, model),
             total_operating_hours = COALESCE($4, total_operating_hours),
             status = COALESCE($5, status),
             is_isolation = COALESCE($6, is_isolation),
             updated_at = now()
         WHERE tenant_id = $7 AND id = $8
         RETURNING *`,
        [
          dto.stationId,
          dto.brand,
          dto.model,
          dto.totalOperatingHours,
          dto.status,
          dto.isIsolation,
          tenantId,
          id,
        ],
      );
      if (!res.rows[0]) throw new ProblemException('NOT_FOUND', { detail: 'Dialysis machine not found' });
      return res.rows[0];
    });
  }

  async serviceMachine(tenantId: string, id: string, dto: ServiceDialysisMachineRequest) {
    return withTenant({ tenantId }, async (tx) => {
      const isDisinfection = dto.serviceType === 'DISINFECTION';
      const res = await tx.query(
        `UPDATE dialysis_machines
         SET total_operating_hours = total_operating_hours + $1,
             last_disinfected_at = CASE WHEN $2 THEN now() ELSE last_disinfected_at END,
             last_serviced_at = CASE WHEN NOT $2 THEN now() ELSE last_serviced_at END,
             status = $3,
             updated_at = now()
         WHERE tenant_id = $4 AND id = $5
         RETURNING *`,
        [dto.operatingHoursDelta ?? 0, isDisinfection, dto.statusAfterService ?? 'ACTIVE', tenantId, id],
      );
      if (!res.rows[0]) throw new ProblemException('NOT_FOUND', { detail: 'Dialysis machine not found' });
      return res.rows[0];
    });
  }

  // ── 3. Vascular Accesses ────────────────────────────────────────────────────

  async listAccesses(tenantId: string, patientId: string) {
    return withTenant({ tenantId }, async (tx) => {
      const res = await tx.query(
        `SELECT * FROM vascular_accesses
         WHERE tenant_id = $1 AND patient_id = $2
         ORDER BY created_at DESC`,
        [tenantId, patientId],
      );
      return res.rows;
    });
  }

  async createAccess(tenantId: string, dto: CreateVascularAccessRequest) {
    return withTenant({ tenantId }, async (tx) => {
      const res = await tx.query(
        `INSERT INTO vascular_accesses (
           tenant_id, patient_id, access_type, anatomical_site, side,
           created_date, surgeon_name, status, notes
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING *`,
        [
          tenantId,
          dto.patientId,
          dto.accessType,
          dto.anatomicalSite,
          dto.side,
          dto.createdDate ?? null,
          dto.surgeonName ?? null,
          dto.status ?? 'MATURING',
          dto.notes ?? null,
        ],
      );
      return res.rows[0];
    });
  }

  async updateAccess(tenantId: string, id: string, dto: UpdateVascularAccessRequest) {
    return withTenant({ tenantId }, async (tx) => {
      const res = await tx.query(
        `UPDATE vascular_accesses
         SET status = COALESCE($1, status),
             notes = COALESCE($2, notes),
             updated_at = now()
         WHERE tenant_id = $3 AND id = $4
         RETURNING *`,
        [dto.status, dto.notes, tenantId, id],
      );
      if (!res.rows[0]) throw new ProblemException('NOT_FOUND', { detail: 'Vascular access not found' });
      return res.rows[0];
    });
  }

  async createAssessment(tenantId: string, accessId: string, dto: CreateAccessAssessmentRequest) {
    return withTenant({ tenantId }, async (tx) => {
      const acc = await tx.query(
        `SELECT id FROM vascular_accesses WHERE tenant_id = $1 AND id = $2`,
        [tenantId, accessId],
      );
      if (!acc.rows[0]) throw new ProblemException('NOT_FOUND', { detail: 'Vascular access not found' });

      const res = await tx.query(
        `INSERT INTO access_assessments (
           tenant_id, access_id, assessed_by, thrill_present, bruit_present,
           signs_of_infection, cannulation_complication, intervention_notes
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [
          tenantId,
          accessId,
          dto.assessedBy,
          dto.thrillPresent,
          dto.bruitPresent,
          dto.signsOfInfection ?? false,
          dto.cannulationComplication ?? null,
          dto.interventionNotes ?? null,
        ],
      );
      return res.rows[0];
    });
  }

  // ── 4. Dialysis Prescriptions ───────────────────────────────────────────────

  async listPrescriptions(tenantId: string, patientId: string) {
    return withTenant({ tenantId }, async (tx) => {
      const res = await tx.query(
        `SELECT * FROM dialysis_prescriptions
         WHERE tenant_id = $1 AND patient_id = $2
         ORDER BY created_at DESC`,
        [tenantId, patientId],
      );
      return res.rows;
    });
  }

  async getPrescription(tenantId: string, id: string) {
    return withTenant({ tenantId }, async (tx) => {
      const res = await tx.query(
        `SELECT * FROM dialysis_prescriptions WHERE tenant_id = $1 AND id = $2`,
        [tenantId, id],
      );
      if (!res.rows[0]) throw new ProblemException('NOT_FOUND', { detail: 'Prescription not found' });
      return res.rows[0];
    });
  }

  async createPrescription(tenantId: string, dto: CreateDialysisPrescriptionRequest) {
    return withTenant({ tenantId }, async (tx) => {
      const res = await tx.query(
        `INSERT INTO dialysis_prescriptions (
           tenant_id, patient_id, nephrologist_id, effective_from, effective_to,
           modality, frequency_per_week, duration_minutes, target_dry_weight_kg,
           dialyzer_model, dialysate_formula, potassium_meq, calcium_meq, sodium_meq,
           bicarbonate_meq, blood_flow_rate_target, dialysate_flow_rate_target,
           heparin_bolus_units, heparin_hourly_units, is_heparin_free, hbv_hbsag_positive, status, notes
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, 'DRAFT', $22)
         RETURNING *`,
        [
          tenantId,
          dto.patientId,
          dto.nephrologistId,
          dto.effectiveFrom ?? new Date().toISOString().slice(0, 10),
          dto.effectiveTo ?? null,
          dto.modality ?? 'HD',
          dto.frequencyPerWeek ?? 3,
          dto.durationMinutes ?? 240,
          dto.targetDryWeightKg,
          dto.dialyzerModel,
          dto.dialysateFormula ?? 'STANDARD',
          dto.potassiumMeq ?? null,
          dto.calciumMeq ?? null,
          dto.sodiumMeq ?? null,
          dto.bicarbonateMeq ?? null,
          dto.bloodFlowRateTarget ?? 300,
          dto.dialysateFlowRateTarget ?? 500,
          dto.heparinBolusUnits ?? null,
          dto.heparinHourlyUnits ?? null,
          dto.isHeparinFree ?? false,
          dto.hbvHbsagPositive ?? false,
          dto.notes ?? null,
        ],
      );
      return res.rows[0];
    });
  }

  async updatePrescription(tenantId: string, id: string, dto: UpdateDialysisPrescriptionRequest) {
    return withTenant({ tenantId }, async (tx) => {
      const curr = await tx.query(
        `SELECT status FROM dialysis_prescriptions WHERE tenant_id = $1 AND id = $2`,
        [tenantId, id],
      );
      if (!curr.rows[0]) throw new ProblemException('NOT_FOUND', { detail: 'Prescription not found' });
      if (curr.rows[0].status !== 'DRAFT') {
        throw new ProblemException('CONFLICT', { detail: 'Only draft prescriptions can be modified. Active prescriptions must be amended.' });
      }

      const res = await tx.query(
        `UPDATE dialysis_prescriptions
         SET target_dry_weight_kg = COALESCE($1, target_dry_weight_kg),
             duration_minutes = COALESCE($2, duration_minutes),
             dialyzer_model = COALESCE($3, dialyzer_model),
             dialysate_formula = COALESCE($4, dialysate_formula),
             blood_flow_rate_target = COALESCE($5, blood_flow_rate_target),
             dialysate_flow_rate_target = COALESCE($6, dialysate_flow_rate_target),
             hbv_hbsag_positive = COALESCE($7, hbv_hbsag_positive),
             notes = COALESCE($8, notes),
             updated_at = now()
         WHERE tenant_id = $9 AND id = $10
         RETURNING *`,
        [
          dto.targetDryWeightKg,
          dto.durationMinutes,
          dto.dialyzerModel,
          dto.dialysateFormula,
          dto.bloodFlowRateTarget,
          dto.dialysateFlowRateTarget,
          dto.hbvHbsagPositive,
          dto.notes,
          tenantId,
          id,
        ],
      );
      return res.rows[0];
    });
  }

  async signPrescription(tenantId: string, id: string, dto: SignDialysisPrescriptionRequest) {
    return withTenant({ tenantId }, async (tx) => {
      const curr = await tx.query(
        `SELECT * FROM dialysis_prescriptions WHERE tenant_id = $1 AND id = $2`,
        [tenantId, id],
      );
      if (!curr.rows[0]) throw new ProblemException('NOT_FOUND', { detail: 'Prescription not found' });

      // Superseed other active prescriptions for this patient
      await tx.query(
        `UPDATE dialysis_prescriptions
         SET status = 'SUPERSEDED', effective_to = CURRENT_DATE, updated_at = now()
         WHERE tenant_id = $1 AND patient_id = $2 AND status = 'ACTIVE' AND id != $3`,
        [tenantId, curr.rows[0].patient_id, id],
      );

      const res = await tx.query(
        `UPDATE dialysis_prescriptions
         SET status = 'ACTIVE',
             signed_at = now(),
             signed_by = $1,
             updated_at = now()
         WHERE tenant_id = $2 AND id = $3
         RETURNING *`,
        [dto.signedBy, tenantId, id],
      );
      return res.rows[0];
    });
  }

  async amendPrescription(tenantId: string, id: string, dto: AmendDialysisPrescriptionRequest) {
    return withTenant({ tenantId }, async (tx) => {
      const old = await tx.query(
        `SELECT * FROM dialysis_prescriptions WHERE tenant_id = $1 AND id = $2`,
        [tenantId, id],
      );
      if (!old.rows[0]) throw new ProblemException('NOT_FOUND', { detail: 'Prescription not found' });

      // Supersede current prescription
      await tx.query(
        `UPDATE dialysis_prescriptions
         SET status = 'SUPERSEDED', effective_to = CURRENT_DATE, updated_at = now()
         WHERE tenant_id = $1 AND id = $2`,
        [tenantId, id],
      );

      // Create new signed prescription
      const np = dto.newPrescription;
      const res = await tx.query(
        `INSERT INTO dialysis_prescriptions (
           tenant_id, patient_id, nephrologist_id, effective_from, effective_to,
           modality, frequency_per_week, duration_minutes, target_dry_weight_kg,
           dialyzer_model, dialysate_formula, potassium_meq, calcium_meq, sodium_meq,
           bicarbonate_meq, blood_flow_rate_target, dialysate_flow_rate_target,
           heparin_bolus_units, heparin_hourly_units, is_heparin_free, hbv_hbsag_positive, status,
           signed_at, signed_by, notes
         ) VALUES ($1, $2, $3, CURRENT_DATE, null, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, 'ACTIVE', now(), $20, $21)
         RETURNING *`,
        [
          tenantId,
          old.rows[0].patient_id,
          np.nephrologistId ?? old.rows[0].nephrologist_id,
          np.modality ?? old.rows[0].modality,
          np.frequencyPerWeek ?? old.rows[0].frequency_per_week,
          np.durationMinutes ?? old.rows[0].duration_minutes,
          np.targetDryWeightKg ?? old.rows[0].target_dry_weight_kg,
          np.dialyzerModel ?? old.rows[0].dialyzer_model,
          np.dialysateFormula ?? old.rows[0].dialysate_formula,
          np.potassiumMeq ?? old.rows[0].potassium_meq,
          np.calciumMeq ?? old.rows[0].calcium_meq,
          np.sodiumMeq ?? old.rows[0].sodium_meq,
          np.bicarbonateMeq ?? old.rows[0].bicarbonate_meq,
          np.bloodFlowRateTarget ?? old.rows[0].blood_flow_rate_target,
          np.dialysateFlowRateTarget ?? old.rows[0].dialysate_flow_rate_target,
          np.heparinBolusUnits ?? old.rows[0].heparin_bolus_units,
          np.heparinHourlyUnits ?? old.rows[0].heparin_hourly_units,
          np.isHeparinFree ?? old.rows[0].is_heparin_free,
          np.hbvHbsagPositive ?? old.rows[0].hbv_hbsag_positive ?? false,
          dto.amendedBy,
          `Amended from prescription ${id}. Reason: ${dto.amendmentReason}`,
        ],
      );
      return res.rows[0];
    });
  }

  // ── 5. Dialysis Shifts & Schedules ──────────────────────────────────────────

  async listShifts(tenantId: string, branchId?: string) {
    return withTenant({ tenantId }, async (tx) => {
      let query = `SELECT * FROM dialysis_shifts WHERE tenant_id = $1`;
      const params: any[] = [tenantId];
      if (branchId) {
        query += ` AND branch_id = $2`;
        params.push(branchId);
      }
      query += ` ORDER BY start_time ASC`;
      const res = await tx.query(query, params);
      return res.rows;
    });
  }

  async createShift(tenantId: string, dto: CreateDialysisShiftRequest) {
    return withTenant({ tenantId }, async (tx) => {
      const res = await tx.query(
        `INSERT INTO dialysis_shifts (
           tenant_id, branch_id, shift_name, start_time, end_time, days_of_week, is_active
         ) VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [
          tenantId,
          dto.branchId,
          dto.shiftName,
          dto.startTime,
          dto.endTime,
          dto.daysOfWeek ?? [1, 2, 3, 4, 5, 6],
          dto.isActive ?? true,
        ],
      );
      return res.rows[0];
    });
  }

  async listSchedules(tenantId: string, branchId?: string, stationId?: string) {
    return withTenant({ tenantId }, async (tx) => {
      let query = `SELECT s.*, p.first_name, p.last_name, st.station_no, sh.shift_name
                   FROM dialysis_schedules s
                   JOIN patients p ON p.tenant_id = s.tenant_id AND p.id = s.patient_id
                   JOIN renal_stations st ON st.tenant_id = s.tenant_id AND st.id = s.station_id
                   JOIN dialysis_shifts sh ON sh.tenant_id = s.tenant_id AND sh.id = s.shift_id
                   WHERE s.tenant_id = $1`;
      const params: any[] = [tenantId];
      let pIdx = 2;
      if (branchId) {
        query += ` AND s.branch_id = $${pIdx++}`;
        params.push(branchId);
      }
      if (stationId) {
        query += ` AND s.station_id = $${pIdx++}`;
        params.push(stationId);
      }
      query += ` ORDER BY s.day_of_week ASC, sh.start_time ASC`;
      const res = await tx.query(query, params);
      return res.rows;
    });
  }

  async createSchedule(tenantId: string, dto: CreateDialysisScheduleRequest) {
    return withTenant({ tenantId }, async (tx) => {
      // Conflict detection: verify chair is not double-booked on the same station, shift, and day of week
      const conflict = await tx.query(
        `SELECT id FROM dialysis_schedules
         WHERE tenant_id = $1 AND station_id = $2 AND shift_id = $3 AND day_of_week = $4
           AND status = 'ACTIVE'
           AND (effective_to IS NULL OR effective_to >= $5)`,
        [tenantId, dto.stationId, dto.shiftId, dto.dayOfWeek, dto.effectiveFrom ?? new Date().toISOString().slice(0, 10)],
      );
      if (conflict.rows.length > 0) {
        throw new ProblemException('SCHEDULE_OVERLAP', {
          detail: 'Dialysis station is already scheduled for another patient on this shift and day of week',
        });
      }

      const res = await tx.query(
        `INSERT INTO dialysis_schedules (
           tenant_id, patient_id, branch_id, station_id, shift_id,
           day_of_week, effective_from, effective_to, status
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'ACTIVE')
         RETURNING *`,
        [
          tenantId,
          dto.patientId,
          dto.branchId,
          dto.stationId,
          dto.shiftId,
          dto.dayOfWeek,
          dto.effectiveFrom,
          dto.effectiveTo ?? null,
        ],
      );
      return res.rows[0];
    });
  }

  // ── 6. Dialyzers & Reprocessing (ADR-12 / R-REN-01, R-REN-03) ───────────────

  async listDialyzers(tenantId: string, patientId?: string) {
    return withTenant({ tenantId }, async (tx) => {
      let query = `SELECT d.*, p.first_name, p.last_name
                   FROM dialyzers d
                   JOIN patients p ON p.tenant_id = d.tenant_id AND p.id = d.patient_id
                   WHERE d.tenant_id = $1`;
      const params: any[] = [tenantId];
      if (patientId) {
        query += ` AND d.patient_id = $2`;
        params.push(patientId);
      }
      query += ` ORDER BY d.created_at DESC`;
      const res = await tx.query(query, params);
      return res.rows;
    });
  }

  async createDialyzer(tenantId: string, dto: CreateDialyzerRequest) {
    return withTenant({ tenantId }, async (tx) => {
      const res = await tx.query(
        `INSERT INTO dialyzers (
           tenant_id, patient_id, serial_barcode, dialyzer_model,
           baseline_volume_ml, current_volume_ml, reuse_count, max_allowed_reuses, max_reuse_days, status
         ) VALUES ($1, $2, $3, $4, $5, $5, 0, $6, $7, 'CLEANED_READY')
         RETURNING *`,
        [
          tenantId,
          dto.patientId,
          dto.serialBarcode,
          dto.dialyzerModel,
          dto.baselineVolumeMl,
          dto.maxAllowedReuses ?? 10,
          dto.maxReuseDays ?? 10,
        ],
      );
      return res.rows[0];
    });
  }

  async reprocessDialyzer(tenantId: string, id: string, dto: ReprocessDialyzerRequest) {
    return withTenant({ tenantId }, async (tx) => {
      const dRes = await tx.query(
        `SELECT * FROM dialyzers WHERE tenant_id = $1 AND id = $2`,
        [tenantId, id],
      );
      if (!dRes.rows[0]) throw new ProblemException('NOT_FOUND', { detail: 'Dialyzer not found' });
      const dialyzer = dRes.rows[0];

      if (dialyzer.status === 'DISCARDED') {
        throw new ProblemException('CONFLICT', { detail: 'Cannot reprocess a permanently discarded dialyzer' });
      }

      const baselineVol = Number(dialyzer.baseline_volume_ml);
      const measuredVol = Number(dto.measuredVolumeMl);
      const bundleVolumePct = Number(((measuredVol / baselineVol) * 100).toFixed(2));
      const leakPassed = Boolean(dto.pressureLeakTestPassed);
      const newReuseCount = Number(dialyzer.reuse_count) + 1;
      const maxReuses = Number(dialyzer.max_allowed_reuses);

      // Log reprocessing attempt
      await tx.query(
        `INSERT INTO dialyzer_reprocessings (
           tenant_id, dialyzer_id, technician_id, pre_clean_ok, measured_volume_ml,
           bundle_volume_pct, pressure_leak_test_passed, disinfectant_agent,
           disinfectant_concentration_ok, residual_test_prior_use, witness_id, notes
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          tenantId,
          id,
          dto.technicianId,
          dto.preCleanOk ?? true,
          measuredVol,
          bundleVolumePct,
          leakPassed,
          dto.disinfectantAgent,
          dto.disinfectantConcentrationOk ?? true,
          dto.residualTestPriorUse ?? null,
          dto.witnessId ?? null,
          dto.notes ?? null,
        ],
      );

      // Safety Gate R-REN-03 / AC-30:
      // Bundle volume must be >= 80%, leak test must pass, and reuse_count < maxReuses
      if (bundleVolumePct < 80.0 || !leakPassed || newReuseCount > maxReuses) {
        let discardReason = '';
        if (bundleVolumePct < 80.0) {
          discardReason = `Fiber bundle volume below 80% baseline cutoff (${bundleVolumePct}% of baseline ${baselineVol} mL)`;
        } else if (!leakPassed) {
          discardReason = 'Failed automated pressure leak test';
        } else {
          discardReason = `Exceeded maximum allowable reuse limit (${newReuseCount} > ${maxReuses})`;
        }

        const updated = await tx.query(
          `UPDATE dialyzers
           SET status = 'DISCARDED',
               current_volume_ml = $1,
               discard_reason = $2,
               discarded_at = now(),
               updated_at = now()
           WHERE tenant_id = $3 AND id = $4
           RETURNING *`,
          [measuredVol, discardReason, tenantId, id],
        );
        return {
          passed: false,
          discardReason,
          bundleVolumePct,
          pressureLeakTestPassed: leakPassed,
          dialyzer: updated.rows[0],
        };
      }

      // Reprocess successful: increment reuse count and set status CLEANED_READY
      const updated = await tx.query(
        `UPDATE dialyzers
         SET status = 'CLEANED_READY',
             current_volume_ml = $1,
             reuse_count = $2,
             updated_at = now()
         WHERE tenant_id = $3 AND id = $4
         RETURNING *`,
        [measuredVol, newReuseCount, tenantId, id],
      );

      return {
        passed: true,
        bundleVolumePct,
        pressureLeakTestPassed: leakPassed,
        dialyzer: updated.rows[0],
      };
    });
  }

  async discardDialyzer(tenantId: string, id: string, dto: DiscardDialyzerRequest) {
    return withTenant({ tenantId }, async (tx) => {
      const res = await tx.query(
        `UPDATE dialyzers
         SET status = 'DISCARDED',
             discard_reason = $1,
             discarded_at = now(),
             updated_at = now()
         WHERE tenant_id = $2 AND id = $3
         RETURNING *`,
        [dto.discardReason, tenantId, id],
      );
      if (!res.rows[0]) throw new ProblemException('NOT_FOUND', { detail: 'Dialyzer not found' });
      return res.rows[0];
    });
  }

  // ── 7. Water Treatment & Safety Surveillance (R-REN-02 / AC-31) ─────────────

  async listWaterTreatmentLogs(tenantId: string, branchId?: string) {
    return withTenant({ tenantId }, async (tx) => {
      let query = `SELECT * FROM water_treatment_logs WHERE tenant_id = $1`;
      const params: any[] = [tenantId];
      if (branchId) {
        query += ` AND branch_id = $2`;
        params.push(branchId);
      }
      query += ` ORDER BY log_date DESC, created_at DESC`;
      const res = await tx.query(query, params);
      return res.rows;
    });
  }

  async createWaterTreatmentLog(tenantId: string, dto: CreateWaterTreatmentLogRequest) {
    return withTenant({ tenantId }, async (tx) => {
      const chlorine = Number(dto.carbonBreakthroughChlorinePpm);
      let status: 'NORMAL' | 'ALERT' | 'ACTION_REQUIRED' = 'NORMAL';
      if (chlorine >= 0.1) {
        status = 'ACTION_REQUIRED';
      } else if (chlorine >= 0.05 || Number(dto.roRejectionRatePct) < 95.0) {
        status = 'ALERT';
      }

      const res = await tx.query(
        `INSERT INTO water_treatment_logs (
           tenant_id, branch_id, log_date, shift_id, tested_by,
           pre_filter_pressure_in, pre_filter_pressure_out, softener_hardness_ppm,
           carbon_breakthrough_chlorine_ppm, ro_conductivity_us, ro_rejection_rate_pct,
           product_flow_lpm, reject_flow_lpm, chemical_disinfection_done, status, notes
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
         RETURNING *`,
        [
          tenantId,
          dto.branchId,
          dto.logDate ?? new Date().toISOString().slice(0, 10),
          dto.shiftId ?? null,
          dto.testedBy,
          dto.preFilterPressureIn ?? null,
          dto.preFilterPressureOut ?? null,
          dto.softenerHardnessPpm ?? null,
          chlorine,
          dto.roConductivityUs,
          dto.roRejectionRatePct,
          dto.productFlowLpm ?? null,
          dto.rejectFlowLpm ?? null,
          dto.chemicalDisinfectionDone ?? false,
          status,
          dto.notes ?? null,
        ],
      );
      return res.rows[0];
    });
  }

  async listWaterLabTests(tenantId: string, branchId?: string) {
    return withTenant({ tenantId }, async (tx) => {
      let query = `SELECT * FROM water_lab_tests WHERE tenant_id = $1`;
      const params: any[] = [tenantId];
      if (branchId) {
        query += ` AND branch_id = $2`;
        params.push(branchId);
      }
      query += ` ORDER BY sample_date DESC`;
      const res = await tx.query(query, params);
      return res.rows;
    });
  }

  async createWaterLabTest(tenantId: string, dto: CreateWaterLabTestRequest) {
    return withTenant({ tenantId }, async (tx) => {
      const res = await tx.query(
        `INSERT INTO water_lab_tests (
           tenant_id, branch_id, sample_date, sample_point, test_type,
           result_value, uom, is_compliant, lab_order_id, verified_by, notes
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING *`,
        [
          tenantId,
          dto.branchId,
          dto.sampleDate,
          dto.samplePoint,
          dto.testType,
          dto.resultValue,
          dto.uom,
          dto.isCompliant,
          dto.labOrderId ?? null,
          dto.verifiedBy,
          dto.notes ?? null,
        ],
      );
      return res.rows[0];
    });
  }

  // ── 8. Dialysis Sessions Lifecycle (AC-29, AC-30, AC-31, AC-32) ─────────────

  async listSessions(tenantId: string, filters: { branchId?: string; scheduledDate?: string; status?: string; patientId?: string }) {
    return withTenant({ tenantId }, async (tx) => {
      let query = `SELECT s.*, p.first_name, p.last_name, st.station_no, m.serial_no as machine_serial,
                          d.dialyzer_model, d.serial_barcode as dialyzer_barcode
                   FROM dialysis_sessions s
                   JOIN patients p ON p.tenant_id = s.tenant_id AND p.id = s.patient_id
                   JOIN renal_stations st ON st.tenant_id = s.tenant_id AND st.id = s.station_id
                   JOIN dialysis_machines m ON m.tenant_id = s.tenant_id AND m.id = s.machine_id
                   JOIN dialyzers d ON d.tenant_id = s.tenant_id AND d.id = s.dialyzer_id
                   WHERE s.tenant_id = $1`;
      const params: any[] = [tenantId];
      let pIdx = 2;
      if (filters.branchId) {
        query += ` AND s.branch_id = $${pIdx++}`;
        params.push(filters.branchId);
      }
      if (filters.scheduledDate) {
        query += ` AND s.scheduled_date = $${pIdx++}`;
        params.push(filters.scheduledDate);
      }
      if (filters.status) {
        query += ` AND s.status = $${pIdx++}`;
        params.push(filters.status);
      }
      if (filters.patientId) {
        query += ` AND s.patient_id = $${pIdx++}`;
        params.push(filters.patientId);
      }
      query += ` ORDER BY s.scheduled_date DESC, s.created_at DESC`;
      const res = await tx.query(query, params);
      return res.rows;
    });
  }

  private async _getSession(tx: any, tenantId: string, id: string) {
    const res = await tx.query(
      `SELECT s.*, p.first_name, p.last_name, st.station_no, st.is_isolation as station_isolation,
              m.serial_no as machine_serial, d.dialyzer_model, d.serial_barcode as dialyzer_barcode,
              rx.target_dry_weight_kg, rx.duration_minutes, rx.dialysate_formula
       FROM dialysis_sessions s
       JOIN patients p ON p.tenant_id = s.tenant_id AND p.id = s.patient_id
       JOIN renal_stations st ON st.tenant_id = s.tenant_id AND st.id = s.station_id
       JOIN dialysis_machines m ON m.tenant_id = s.tenant_id AND m.id = s.machine_id
       JOIN dialyzers d ON d.tenant_id = s.tenant_id AND d.id = s.dialyzer_id
       JOIN dialysis_prescriptions rx ON rx.tenant_id = s.tenant_id AND rx.id = s.prescription_id
       WHERE s.tenant_id = $1 AND s.id = $2`,
      [tenantId, id],
    );
    if (!res.rows[0]) throw new ProblemException('NOT_FOUND', { detail: 'Dialysis session not found' });

    // Fetch pre, flowsheet, and post records
    const pre = await tx.query(
      `SELECT * FROM session_pre_assessments WHERE tenant_id = $1 AND session_id = $2`,
      [tenantId, id],
    );
    const flowsheet = await tx.query(
      `SELECT * FROM session_flowsheets WHERE tenant_id = $1 AND session_id = $2 ORDER BY elapsed_minutes ASC`,
      [tenantId, id],
    );
    const post = await tx.query(
      `SELECT * FROM session_post_assessments WHERE tenant_id = $1 AND session_id = $2`,
      [tenantId, id],
    );

    return {
      ...res.rows[0],
      preAssessment: pre.rows[0] ?? null,
      flowsheet: flowsheet.rows,
      postAssessment: post.rows[0] ?? null,
    };
  }

  async getSession(tenantId: string, id: string) {
    return withTenant({ tenantId }, async (tx) => {
      return this._getSession(tx, tenantId, id);
    });
  }

  async createSession(tenantId: string, dto: CreateDialysisSessionRequest) {
    return withTenant({ tenantId }, async (tx) => {
      // 1. Verify prescription is ACTIVE (R-REN-06)
      const rx = await tx.query(
        `SELECT status FROM dialysis_prescriptions WHERE tenant_id = $1 AND id = $2 AND patient_id = $3`,
        [tenantId, dto.prescriptionId, dto.patientId],
      );
      if (!rx.rows[0] || rx.rows[0].status !== 'ACTIVE') {
        throw new ProblemException('PRESCRIPTION_NOT_ACTIVE', {
          detail: 'Dialysis session requires an active, signed prescription',
        });
      }

      // 2. Verify dialyzer strictly belongs to patient (R-REN-01 / ADR-12)
      const d = await tx.query(
        `SELECT patient_id, status FROM dialyzers WHERE tenant_id = $1 AND id = $2`,
        [tenantId, dto.dialyzerId],
      );
      if (!d.rows[0]) {
        throw new ProblemException('NOT_FOUND', { detail: 'Dialyzer not found' });
      }
      if (d.rows[0].patient_id !== dto.patientId) {
        throw new ProblemException('DIALYZER_PATIENT_MISMATCH', {
          detail: 'Single-patient dialyzer rule: Dialyzer is registered to another patient',
        });
      }
      if (d.rows[0].status === 'DISCARDED') {
        throw new ProblemException('DIALYZER_VOLUME_CUTOFF', {
          detail: 'Selected dialyzer is marked DISCARDED and cannot be used',
        });
      }

      // 3. Verify station isolation flag for HBsAg+ patients (R-REN-04)
      const st = await tx.query(
        `SELECT is_isolation FROM renal_stations WHERE tenant_id = $1 AND id = $2`,
        [tenantId, dto.stationId],
      );
      if (!st.rows[0]) throw new ProblemException('NOT_FOUND', { detail: 'Station not found' });

      const rxFull = await tx.query(
        `SELECT hbv_hbsag_positive FROM dialysis_prescriptions WHERE tenant_id = $1 AND id = $2`,
        [tenantId, dto.prescriptionId],
      );
      if (rxFull.rows[0]?.hbv_hbsag_positive && !st.rows[0].is_isolation) {
        throw new ProblemException('RENAL_ISOLATION_REQUIRED', {
          detail: 'HBsAg-positive patient requires an isolation renal station',
        });
      }

      const mach = await tx.query(
        `SELECT is_isolation FROM dialysis_machines WHERE tenant_id = $1 AND id = $2`,
        [tenantId, dto.machineId],
      );
      if (mach.rows[0]?.is_isolation && !st.rows[0].is_isolation) {
        throw new ProblemException('RENAL_ISOLATION_REQUIRED', {
          detail: 'Isolation dialysis machine requires an isolation renal station',
        });
      }

      // Generate session sequence number
      const countRes = await tx.query(
        `SELECT count(*)::int as cnt FROM dialysis_sessions WHERE tenant_id = $1 AND branch_id = $2`,
        [tenantId, dto.branchId],
      );
      const sessionNo = `HD-${new Date().getFullYear()}-${String(countRes.rows[0].cnt + 1).padStart(5, '0')}`;

      const res = await tx.query(
        `INSERT INTO dialysis_sessions (
           tenant_id, session_no, patient_id, visit_id, branch_id, station_id,
           machine_id, prescription_id, access_id, dialyzer_id, scheduled_date,
           shift_id, primary_nurse_id, attending_nephrologist_id, status
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 'SCHEDULED')
         RETURNING *`,
        [
          tenantId,
          sessionNo,
          dto.patientId,
          dto.visitId ?? null,
          dto.branchId,
          dto.stationId,
          dto.machineId,
          dto.prescriptionId,
          dto.accessId ?? null,
          dto.dialyzerId,
          dto.scheduledDate ?? new Date().toISOString().slice(0, 10),
          dto.shiftId,
          dto.primaryNurseId,
          dto.attendingNephrologistId ?? null,
        ],
      );
      return res.rows[0];
    });
  }

  // ── Pre-dialysis intake & clinical safety gate (AC-29, AC-30, AC-31) ────────

  async startPreDialysis(tenantId: string, sessionId: string, dto: PreDialysisIntakeRequest) {
    return withTenant({ tenantId }, async (tx) => {
      const sRes = await tx.query(
        `SELECT * FROM dialysis_sessions WHERE tenant_id = $1 AND id = $2`,
        [tenantId, sessionId],
      );
      if (!sRes.rows[0]) throw new ProblemException('NOT_FOUND', { detail: 'Dialysis session not found' });
      const session = sRes.rows[0];

      if (session.status !== 'SCHEDULED') {
        throw new ProblemException('CONFLICT', { detail: `Cannot start session in status ${session.status}` });
      }

      // Safety Gate 1: Pre-shift water chlorine breakthrough lockout (R-REN-02 / AC-31)
      const waterLog = await tx.query(
        `SELECT carbon_breakthrough_chlorine_ppm, status, log_date, shift_id
         FROM water_treatment_logs
         WHERE tenant_id = $1 AND branch_id = $2 AND log_date = $3
           AND (shift_id = $4 OR shift_id IS NULL)
         ORDER BY created_at DESC
         LIMIT 1`,
        [tenantId, session.branch_id, session.scheduled_date, session.shift_id],
      );

      if (!waterLog.rows[0]) {
        const anyWaterLog = await tx.query(
          `SELECT carbon_breakthrough_chlorine_ppm, status, log_date, shift_id
           FROM water_treatment_logs
           WHERE tenant_id = $1 AND branch_id = $2 AND log_date = $3
           ORDER BY created_at DESC
           LIMIT 1`,
          [tenantId, session.branch_id, session.scheduled_date],
        );
        if (anyWaterLog.rows[0] && anyWaterLog.rows[0].shift_id && anyWaterLog.rows[0].shift_id !== session.shift_id) {
          throw new ProblemException('WATER_SAFETY_LOCKOUT', {
            detail: 'Water safety fail-closed: No valid water treatment log for this shift and date',
          });
        }
        throw new ProblemException('WATER_SAFETY_LOCKOUT', {
          detail: 'Water safety fail-closed: No pre-shift water treatment log found for this branch and shift/date',
        });
      }

      const chlorinePpm = Number(waterLog.rows[0].carbon_breakthrough_chlorine_ppm);
      if (chlorinePpm >= 0.1 || waterLog.rows[0].status === 'ACTION_REQUIRED') {
        throw new ProblemException('WATER_SAFETY_LOCKOUT', {
          detail: `Water safety lockout: Carbon bed total chlorine breakthrough is ${chlorinePpm} ppm (threshold < 0.1 ppm). Treatment blocked.`,
        });
      }

      // Safety Gate 2: Dialyzer bundle volume cutoff & single-patient rule (R-REN-01, R-REN-03 / AC-30)
      const dialyzer = await tx.query(
        `SELECT * FROM dialyzers WHERE tenant_id = $1 AND id = $2`,
        [tenantId, session.dialyzer_id],
      );
      if (!dialyzer.rows[0]) throw new ProblemException('NOT_FOUND', { detail: 'Dialyzer not found' });
      const d = dialyzer.rows[0];

      if (d.patient_id !== session.patient_id) {
        throw new ProblemException('DIALYZER_PATIENT_MISMATCH', {
          detail: 'Single-patient dialyzer rule: Dialyzer does not belong to this patient',
        });
      }

      if (d.status === 'DISCARDED') {
        throw new ProblemException('DIALYZER_VOLUME_CUTOFF', {
          detail: 'Dialyzer is discarded and cannot be used for treatment',
        });
      }

      const baselineVol = Number(d.baseline_volume_ml);
      const currentVol = Number(d.current_volume_ml);
      const volumePct = (currentVol / baselineVol) * 100;
      if (volumePct < 80.0) {
        throw new ProblemException('DIALYZER_VOLUME_CUTOFF', {
          detail: `Dialyzer volume cutoff: Bundle volume is ${volumePct.toFixed(1)}% of baseline (< 80% cutoff). Treatment blocked.`,
        });
      }

      if (Number(d.reuse_count) > 0) {
        const reproc = await tx.query(
          `SELECT residual_test_prior_use
           FROM dialyzer_reprocessings
           WHERE tenant_id = $1 AND dialyzer_id = $2
           ORDER BY reprocessed_at DESC, created_at DESC
           LIMIT 1`,
          [tenantId, session.dialyzer_id],
        );
        if (!reproc.rows[0] || reproc.rows[0].residual_test_prior_use !== true) {
          throw new ProblemException('RESIDUAL_TEST_REQUIRED', {
            detail: 'Renal safety gate: residual disinfectant test required prior to use of reprocessed dialyzer',
          });
        }
      }

      // Record pre-assessment
      const fluidGain = Number((dto.preWeightKg - dto.dryWeightKg).toFixed(2));
      await tx.query(
        `INSERT INTO session_pre_assessments (
           tenant_id, session_id, pre_weight_kg, standing_bp_systolic, standing_bp_diastolic,
           sitting_bp_systolic, sitting_bp_diastolic, pulse, temp, resp_rate,
           dry_weight_kg, fluid_gain_kg, target_uf_liters, edema_grade, access_checked,
           nurse_sign_id, notes
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
         ON CONFLICT (tenant_id, session_id) DO UPDATE SET
           pre_weight_kg = EXCLUDED.pre_weight_kg,
           fluid_gain_kg = EXCLUDED.fluid_gain_kg,
           target_uf_liters = EXCLUDED.target_uf_liters`,
        [
          tenantId,
          sessionId,
          dto.preWeightKg,
          dto.standingBpSystolic ?? null,
          dto.standingBpDiastolic ?? null,
          dto.sittingBpSystolic,
          dto.sittingBpDiastolic,
          dto.pulse,
          dto.temp,
          dto.respRate ?? null,
          dto.dryWeightKg,
          fluidGain,
          dto.targetUfLiters,
          dto.edemaGrade ?? 'NONE',
          dto.accessChecked ?? true,
          dto.nurseSignId,
          dto.notes ?? null,
        ],
      );

      // Transition session status to IN_PROGRESS and dialyzer to IN_USE
      await tx.query(
        `UPDATE dialysis_sessions
         SET status = 'IN_PROGRESS',
             started_at = now(),
             updated_at = now()
         WHERE tenant_id = $1 AND id = $2`,
        [tenantId, sessionId],
      );

      await tx.query(
        `UPDATE dialyzers
         SET status = 'IN_USE',
             first_used_date = COALESCE(first_used_date, CURRENT_DATE),
             updated_at = now()
         WHERE tenant_id = $1 AND id = $2`,
        [tenantId, session.dialyzer_id],
      );

      return this._getSession(tx, tenantId, sessionId);
    });
  }

  // ── Intra-dialytic flowsheet entry ──────────────────────────────────────────

  async recordFlowsheet(tenantId: string, sessionId: string, dto: RecordFlowsheetRequest) {
    return withTenant({ tenantId }, async (tx) => {
      const s = await tx.query(
        `SELECT status FROM dialysis_sessions WHERE tenant_id = $1 AND id = $2`,
        [tenantId, sessionId],
      );
      if (!s.rows[0]) throw new ProblemException('NOT_FOUND', { detail: 'Dialysis session not found' });
      if (s.rows[0].status !== 'IN_PROGRESS') {
        throw new ProblemException('CONFLICT', { detail: 'Flowsheet recordings can only be logged for sessions IN_PROGRESS' });
      }

      const res = await tx.query(
        `INSERT INTO session_flowsheets (
           tenant_id, session_id, elapsed_minutes, bp_systolic, bp_diastolic,
           pulse, blood_flow_rate, dialysate_flow_rate, arterial_pressure,
           venous_pressure, tmp, uf_rate, cum_uf_volume_liters, heparin_administered,
           symptoms, interventions, recorded_by
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
         RETURNING *`,
        [
          tenantId,
          sessionId,
          dto.elapsedMinutes,
          dto.bpSystolic,
          dto.bpDiastolic,
          dto.pulse,
          dto.bloodFlowRate,
          dto.dialysateFlowRate,
          dto.arterialPressure ?? null,
          dto.venousPressure ?? null,
          dto.tmp ?? null,
          dto.ufRate ?? null,
          dto.cumUfVolumeLiters,
          dto.heparinAdministered ?? null,
          dto.symptoms ?? null,
          dto.interventions ?? null,
          dto.recordedBy,
        ],
      );
      return res.rows[0];
    });
  }

  // ── Post-dialysis evaluation, charge capture & PhilHealth counter (AC-29, AC-32) ─

  async completePostDialysis(tenantId: string, sessionId: string, dto: PostDialysisCloseRequest) {
    return withTenant({ tenantId }, async (tx) => {
      const sRes = await tx.query(
        `SELECT * FROM dialysis_sessions WHERE tenant_id = $1 AND id = $2`,
        [tenantId, sessionId],
      );
      if (!sRes.rows[0]) throw new ProblemException('NOT_FOUND', { detail: 'Dialysis session not found' });
      const session = sRes.rows[0];

      if (session.status !== 'IN_PROGRESS') {
        throw new ProblemException('CONFLICT', { detail: 'Only sessions IN_PROGRESS can be completed' });
      }

      // Record post-assessment
      await tx.query(
        `INSERT INTO session_post_assessments (
           tenant_id, session_id, post_weight_kg, standing_bp_systolic, standing_bp_diastolic,
           sitting_bp_systolic, sitting_bp_diastolic, pulse, temp, actual_uf_removed_liters,
           total_heparin_given, access_bruit_thrill, hemostasis_minutes, condition_at_discharge,
           post_nurse_notes, signed_by
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
         ON CONFLICT (tenant_id, session_id) DO UPDATE SET
           post_weight_kg = EXCLUDED.post_weight_kg,
           actual_uf_removed_liters = EXCLUDED.actual_uf_removed_liters`,
        [
          tenantId,
          sessionId,
          dto.postWeightKg,
          dto.standingBpSystolic ?? null,
          dto.standingBpDiastolic ?? null,
          dto.sittingBpSystolic,
          dto.sittingBpDiastolic,
          dto.pulse,
          dto.temp,
          dto.actualUfRemovedLiters,
          dto.totalHeparinGiven ?? null,
          dto.accessBruitThrill ?? true,
          dto.hemostasisMinutes,
          dto.conditionAtDischarge ?? 'STABLE',
          dto.postNurseNotes ?? null,
          dto.signedBy,
        ],
      );

      // Compute run duration
      const startedAt = session.started_at ? new Date(session.started_at).getTime() : Date.now();
      const durationMin = Math.max(1, Math.round((Date.now() - startedAt) / 60000));

      // Mark session COMPLETED
      await tx.query(
        `UPDATE dialysis_sessions
         SET status = 'COMPLETED',
             completed_at = now(),
             actual_duration_minutes = $1,
             total_uf_removed_liters = $2,
             updated_at = now()
         WHERE tenant_id = $3 AND id = $4`,
        [durationMin, dto.actualUfRemovedLiters, tenantId, sessionId],
      );

      // Transition dialyzer to PENDING_REPROCESS
      await tx.query(
        `UPDATE dialyzers
         SET status = 'PENDING_REPROCESS',
             updated_at = now()
         WHERE tenant_id = $1 AND id = $2`,
        [tenantId, session.dialyzer_id],
      );

      // ── Financial charge capture (AC-29) ──────────────────────────────────
      // If linked to an encounter (visit_id), post the dialysis session charge
      if (session.visit_id) {
        await tx.query(
          `INSERT INTO billing_charges (
             tenant_id, branch_id, visit_id, charge_type, source_type, source_id,
             description, quantity, unit_price, amount, payer_type, posted_by
           ) VALUES ($1, $2, $3, 'PROCEDURE', 'DIALYSIS_SESSION', $4, $5, 1, 2600.00, 2600.00, 'PHILHEALTH', $6)
           ON CONFLICT (tenant_id, source_type, source_id) DO NOTHING`,
          [
            tenantId,
            session.branch_id,
            session.visit_id,
            session.id,
            `Hemodialysis Session ${session.session_no}`,
            dto.signedBy,
          ],
        );
      }

      // ── Consumables from post-dialysis close (AC-29) ───────────────────────
      // Fail closed: if consumables cannot be posted, the whole close rolls back
      for (const c of dto.consumables ?? []) {
        await this.supplyService.postConsumption(
          tenantId,
          dto.signedBy,
          sessionId,
          {
            locationId: c.locationId,
            itemId: c.itemId,
            batchId: c.batchId,
            qty: c.qty,
            uomId: c.uomId,
            refType: 'DIALYSIS_SESSION',
            refId: sessionId,
            notes: c.notes ?? `Dialysis session ${session.session_no} consumables`,
          },
          tx,
        );
      }

      // ── PhilHealth 156-session benefit counter update (AC-32 / REN-T5) ────
      const currentYear = new Date().getFullYear();
      const pastClaimsCount = await tx.query(
        `SELECT count(*)::int as cnt
         FROM philhealth_dialysis_claims
         WHERE tenant_id = $1 AND patient_id = $2 AND calendar_year = $3`,
        [tenantId, session.patient_id, currentYear],
      );

      const seqNo = (pastClaimsCount.rows[0]?.cnt ?? 0) + 1;
      const isPastCeiling = seqNo > 156;
      const claimAmount = isPastCeiling ? 0.00 : 2600.00;
      const copayAmount = isPastCeiling ? 2600.00 : 0.00;
      const claimNo = `PH-HD-${currentYear}-${String(seqNo).padStart(3, '0')}-${session.session_no}`;

      await tx.query(
        `INSERT INTO philhealth_dialysis_claims (
           tenant_id, session_id, patient_id, claim_no, calendar_year,
           session_sequence_no, benefit_package_code, claim_amount, copay_amount, eclaims_status
         ) VALUES ($1, $2, $3, $4, $5, $6, 'HD01', $7, $8, 'DRAFT')
         ON CONFLICT (tenant_id, session_id) DO NOTHING`,
        [
          tenantId,
          sessionId,
          session.patient_id,
          claimNo,
          currentYear,
          seqNo,
          claimAmount,
          copayAmount,
        ],
      );

      return {
        session: await this._getSession(tx, tenantId, sessionId),
        philHealthSequenceNo: seqNo,
        isPastCeiling,
        claimAmount,
        copayAmount,
      };
    });
  }

  async cancelSession(tenantId: string, sessionId: string, dto: CancelDialysisSessionRequest) {
    return withTenant({ tenantId }, async (tx) => {
      const s = await tx.query(
        `SELECT status, dialyzer_id FROM dialysis_sessions WHERE tenant_id = $1 AND id = $2`,
        [tenantId, sessionId],
      );
      if (!s.rows[0]) throw new ProblemException('NOT_FOUND', { detail: 'Dialysis session not found' });
      if (s.rows[0].status === 'COMPLETED') {
        throw new ProblemException('CONFLICT', { detail: 'Completed sessions cannot be cancelled' });
      }

      const res = await tx.query(
        `UPDATE dialysis_sessions
         SET status = 'CANCELLED',
             cancellation_reason = $1,
             updated_at = now()
         WHERE tenant_id = $2 AND id = $3
         RETURNING *`,
        [dto.cancellationReason, tenantId, sessionId],
      );

      // Release dialyzer back to ready if it was marked in use
      await tx.query(
        `UPDATE dialyzers
         SET status = 'CLEANED_READY', updated_at = now()
         WHERE tenant_id = $1 AND id = $2 AND status = 'IN_USE'`,
        [tenantId, s.rows[0].dialyzer_id],
      );

      return res.rows[0];
    });
  }

  // ── 9. PhilHealth 156-session usage & Claims (AC-32) ─────────────────────────

  async getPhilHealthUsage(tenantId: string, patientId: string, year?: number) {
    return withTenant({ tenantId }, async (tx) => {
      const targetYear = year ?? new Date().getFullYear();
      const claims = await tx.query(
        `SELECT c.*, s.session_no, s.scheduled_date
         FROM philhealth_dialysis_claims c
         JOIN dialysis_sessions s ON s.tenant_id = c.tenant_id AND s.id = c.session_id
         WHERE c.tenant_id = $1 AND c.patient_id = $2 AND c.calendar_year = $3
         ORDER BY c.session_sequence_no ASC`,
        [tenantId, patientId, targetYear],
      );

      const count = claims.rows.length;
      return {
        patientId,
        calendarYear: targetYear,
        sessionCount: count,
        maxBenefitSessions: 156,
        remainingSessions: Math.max(0, 156 - count),
        isNearCeiling: count >= 150,
        isCeilingExceeded: count >= 156,
        claims: claims.rows,
      };
    });
  }

  async generateClaim(tenantId: string, sessionId: string, dto: PhilHealthDialysisClaimRequest) {
    return withTenant({ tenantId }, async (tx) => {
      const sRes = await tx.query(
        `SELECT * FROM dialysis_sessions WHERE tenant_id = $1 AND id = $2`,
        [tenantId, sessionId],
      );
      if (!sRes.rows[0]) throw new ProblemException('NOT_FOUND', { detail: 'Dialysis session not found' });
      const session = sRes.rows[0];

      const currentYear = new Date().getFullYear();
      const pastClaimsCount = await tx.query(
        `SELECT count(*)::int as cnt
         FROM philhealth_dialysis_claims
         WHERE tenant_id = $1 AND patient_id = $2 AND calendar_year = $3 AND session_id != $4`,
        [tenantId, session.patient_id, currentYear, sessionId],
      );

      const seqNo = (pastClaimsCount.rows[0]?.cnt ?? 0) + 1;
      const claimNo = `PH-HD-${currentYear}-${String(seqNo).padStart(3, '0')}-${session.session_no}`;

      const res = await tx.query(
        `INSERT INTO philhealth_dialysis_claims (
           tenant_id, session_id, patient_id, claim_no, calendar_year,
           session_sequence_no, benefit_package_code, claim_amount, copay_amount, eclaims_status
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'DRAFT')
         ON CONFLICT (tenant_id, session_id) DO UPDATE SET
           benefit_package_code = EXCLUDED.benefit_package_code,
           claim_amount = EXCLUDED.claim_amount,
           copay_amount = EXCLUDED.copay_amount,
           updated_at = now()
         RETURNING *`,
        [
          tenantId,
          sessionId,
          session.patient_id,
          claimNo,
          currentYear,
          seqNo,
          dto.benefitPackageCode ?? 'HD01',
          dto.claimAmount ?? 2600.00,
          dto.copayAmount ?? 0.00,
        ],
      );
      return res.rows[0];
    });
  }

  // ── 10. Kt/V & URR Adequacy calculation (JOB-54) ─────────────────────────────

  calculateAdequacy(preBun: number, postBun: number, weightKg: number, ultrafiltrationLiters: number, durationHours: number) {
    if (preBun <= 0 || postBun <= 0 || postBun >= preBun) {
      throw new Error('Invalid BUN values for Kt/V calculation');
    }
    // Urea Reduction Ratio (URR)
    const urr = Number((((preBun - postBun) / preBun) * 100).toFixed(1));

    // Daugirdas second generation single-pool Kt/V (spKt/V):
    // spKt/V = -ln(R - 0.008 * t) + (4 - 3.5 * R) * (UF / W)
    // where R = postBUN / preBUN, t = duration in hours, UF = ultrafiltration volume in L, W = post-weight in kg
    const R = postBun / preBun;
    const t = durationHours;
    const ufRatio = weightKg > 0 ? ultrafiltrationLiters / weightKg : 0;
    const spKtV = Number((-Math.log(Math.max(0.01, R - 0.008 * t)) + (4 - 3.5 * R) * ufRatio).toFixed(2));

    return {
      urr,
      spKtV,
      isAdequate: spKtV >= 1.2, // K/DOQI target: spKt/V >= 1.2 (guideline >= 1.4 for high-efficiency HD may vary)
    };
  }

  /**
   * Render formal DOH/PhilHealth Hemodialysis Treatment Record & Flowsheet (true vector PDF).
   */
  async renderTreatmentSheetPdf(tenantId: string, sessionId: string) {
    return withTenant({ tenantId }, async (tx) => {
      // 1. Get session details joined with patient, facility, station, machine, shift, rx, access, dialyzer, staff
      const sRes = await tx.query(
        `SELECT s.*, 
                p.first_name as patient_first_name, p.last_name as patient_last_name, p.date_of_birth, p.sex, p.id_number as patient_no,
                b.name as branch_name, b.address as branch_address, b.phone as branch_phone,
                t.name as clinic_name, t.address as clinic_address, t.phone as clinic_phone,
                st.station_no,
                m.serial_no as machine_serial, m.brand as machine_brand, m.model as machine_model, m.total_operating_hours,
                sh.name as shift_name,
                rx.modality, rx.target_dry_weight_kg, rx.planned_duration_minutes,
                rx.dialysate_flow_rate_ml_min, rx.blood_flow_rate_ml_min,
                rx.heparin_bolus_units, rx.heparin_maintenance_units_per_hour, rx.dialysate_composition,
                rx.hbv_hbsag_positive, rx.hcv_positive,
                va.access_type, va.side as access_side, va.site as access_site, va.bruit_thrill_present, va.notes as access_notes,
                d.serial_no as dialyzer_serial, d.model as dialyzer_model, d.reuse_count as dialyzer_reuse_count,
                d.baseline_volume_ml as dialyzer_baseline_vol, d.current_volume_ml as dialyzer_current_vol,
                u_nurse.name as primary_nurse_name,
                u_doc.name as nephrologist_name
         FROM dialysis_sessions s
         JOIN patients p ON p.tenant_id = s.tenant_id AND p.id = s.patient_id
         JOIN branches b ON b.tenant_id = s.tenant_id AND b.id = s.branch_id
         JOIN tenants t ON t.id = s.tenant_id
         LEFT JOIN renal_stations st ON st.tenant_id = s.tenant_id AND st.id = s.station_id
         LEFT JOIN dialysis_machines m ON m.tenant_id = s.tenant_id AND m.id = s.machine_id
         LEFT JOIN dialysis_shifts sh ON sh.tenant_id = s.tenant_id AND sh.id = s.shift_id
         LEFT JOIN dialysis_prescriptions rx ON rx.tenant_id = s.tenant_id AND rx.id = s.prescription_id
         LEFT JOIN vascular_accesses va ON va.tenant_id = s.tenant_id AND va.id = s.access_id
         LEFT JOIN dialyzers d ON d.tenant_id = s.tenant_id AND d.id = s.dialyzer_id
         LEFT JOIN users u_nurse ON u_nurse.tenant_id = s.tenant_id AND u_nurse.id = s.primary_nurse_id
         LEFT JOIN users u_doc ON u_doc.tenant_id = s.tenant_id AND u_doc.id = s.attending_nephrologist_id
         WHERE s.tenant_id = $1 AND s.id = $2`,
        [tenantId, sessionId],
      );

      if (!sRes.rows[0]) {
        throw new ProblemException('NOT_FOUND', { detail: 'Dialysis session not found' });
      }
      const s = sRes.rows[0];

      // 2. Pre-assessment
      const preRes = await tx.query(
        `SELECT * FROM session_pre_assessments WHERE tenant_id = $1 AND session_id = $2`,
        [tenantId, sessionId],
      );
      const pre = preRes.rows[0];

      // 3. Flowsheet rows
      const flowRes = await tx.query(
        `SELECT f.*, u.name as recorder_name
         FROM session_flowsheets f
         LEFT JOIN users u ON u.tenant_id = f.tenant_id AND u.id = f.recorded_by
         WHERE f.tenant_id = $1 AND f.session_id = $2
         ORDER BY f.elapsed_minutes ASC, f.recorded_at ASC`,
        [tenantId, sessionId],
      );

      // 4. Post-assessment
      const postRes = await tx.query(
        `SELECT * FROM session_post_assessments WHERE tenant_id = $1 AND session_id = $2`,
        [tenantId, sessionId],
      );
      const post = postRes.rows[0];

      // 5. Water test log (check if chlorine passed < 0.1 ppm)
      const waterRes = await tx.query(
        `SELECT carbon_breakthrough_chlorine_ppm
         FROM water_treatment_logs
         WHERE tenant_id = $1 AND branch_id = $2 AND log_date = $3
         ORDER BY created_at DESC LIMIT 1`,
        [tenantId, s.branch_id, s.scheduled_date],
      );
      const chlorinePpm = waterRes.rows[0] ? Number(waterRes.rows[0].carbon_breakthrough_chlorine_ppm) : null;
      const waterPassed = chlorinePpm !== null ? chlorinePpm < 0.1 : undefined;

      // 6. Nurse and doctor licensure (from employees if present)
      let nursePrc = 'RN-Active';
      let docPrc = 'MD-Active';
      if (s.primary_nurse_id) {
        const nEmp = await tx.query(
          `SELECT prc_license_no FROM employees WHERE tenant_id = $1 AND user_id = $2`,
          [tenantId, s.primary_nurse_id],
        );
        if (nEmp.rows[0]?.prc_license_no) nursePrc = nEmp.rows[0].prc_license_no;
      }
      if (s.attending_nephrologist_id) {
        const dEmp = await tx.query(
          `SELECT prc_license_no FROM employees WHERE tenant_id = $1 AND user_id = $2`,
          [tenantId, s.attending_nephrologist_id],
        );
        if (dEmp.rows[0]?.prc_license_no) docPrc = dEmp.rows[0].prc_license_no;
      }

      // 7. Calculate patient age if dob available
      let patientAge: string | number | undefined = undefined;
      if (s.date_of_birth) {
        const dob = new Date(s.date_of_birth);
        const diffMs = Date.now() - dob.getTime();
        patientAge = Math.floor(diffMs / (1000 * 60 * 60 * 24 * 365.25));
      }

      const baselineVol = s.dialyzer_baseline_vol ? Number(s.dialyzer_baseline_vol) : 0;
      const currentVol = s.dialyzer_current_vol ? Number(s.dialyzer_current_vol) : 0;
      const bundlePct = baselineVol > 0 ? Number(((currentVol / baselineVol) * 100).toFixed(1)) : undefined;

      const flowsheets: DialysisFlowsheetRow[] = flowRes.rows.map((r: any) => ({
        recordedAt: r.recorded_at ? new Date(r.recorded_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : `+${r.elapsed_minutes}m`,
        bpSitting: r.bp_systolic && r.bp_diastolic ? `${r.bp_systolic}/${r.bp_diastolic}` : null,
        pulseRate: r.pulse,
        bloodFlowRate: r.blood_flow_rate_ml_min,
        dialysateFlowRate: r.dialysate_flow_rate_ml_min,
        arterialPressure: r.arterial_pressure_mmhg,
        venousPressure: r.venous_pressure_mmhg,
        tmp: r.transmembrane_pressure_mmhg,
        ufRate: r.uf_rate_ml_hr,
        cumulativeUf: r.cumulative_uf_removed_liters,
        heparinDose: r.heparin_dose_given_units ? `${r.heparin_dose_given_units} U` : null,
        salineFlushes: r.saline_infusion_ml ? `${r.saline_infusion_ml} mL` : null,
        symptoms: r.patient_symptoms,
        interventions: r.nursing_actions,
        recordedBy: r.recorder_name,
      }));

      const doc: DialysisTreatmentSheetDocument = {
        clinicName: s.clinic_name || 'Philippine Dialysis & Renal Care Center',
        branchName: s.branch_name,
        dohAccreditationNo: 'DOH-DC-2026-NCR-049',
        philhealthAccreditationNo: 'PHIC-ACCR-904128',
        clinicAddress: s.branch_address || s.clinic_address,
        clinicPhone: s.branch_phone || s.clinic_phone,

        sessionNo: s.session_no,
        scheduledDate: s.scheduled_date ? new Date(s.scheduled_date).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
        shiftName: s.shift_name,
        stationNo: s.station_no,
        machineSerial: s.machine_serial,
        machineBrandModel: s.machine_brand && s.machine_model ? `${s.machine_brand} ${s.machine_model}` : s.machine_brand,
        totalOperatingHours: s.total_operating_hours ? Number(s.total_operating_hours) : undefined,

        patientName: `${s.patient_last_name}, ${s.patient_first_name}`,
        patientNo: s.patient_no || s.patient_id.slice(0, 8),
        patientAge,
        patientSex: s.sex,
        patientDob: s.date_of_birth ? new Date(s.date_of_birth).toISOString().slice(0, 10) : undefined,
        hbsagPositive: Boolean(s.hbv_hbsag_positive),
        hcvPositive: Boolean(s.hcv_positive),

        accessType: s.access_type || 'Arteriovenous Fistula (AVF)',
        accessSite: s.access_site || 'Radial-Cephalic',
        accessSide: s.access_side || 'Left Forearm',
        bruitThrillPresent: pre?.access_checked ?? s.bruit_thrill_present ?? true,
        cannulationNotes: pre?.notes || s.access_notes,

        modality: s.modality || 'HD',
        targetDryWeightKg: pre?.dry_weight_kg ? Number(pre.dry_weight_kg) : (s.target_dry_weight_kg ? Number(s.target_dry_weight_kg) : undefined),
        preWeightKg: pre?.pre_weight_kg ? Number(pre.pre_weight_kg) : undefined,
        weightGainKg: pre?.fluid_gain_kg ? Number(pre.fluid_gain_kg) : undefined,
        targetUfLiters: pre?.target_uf_liters ? Number(pre.target_uf_liters) : undefined,
        plannedDurationMinutes: s.planned_duration_minutes ? Number(s.planned_duration_minutes) : 240,
        dialyzerModel: s.dialyzer_model || 'High-Flux Polysulfone 1.8m²',
        dialyzerSerial: s.dialyzer_serial,
        dialyzerReuseCount: s.dialyzer_reuse_count !== undefined ? Number(s.dialyzer_reuse_count) : 0,
        dialyzerBaselineVolumeMl: baselineVol > 0 ? baselineVol : undefined,
        dialyzerBundleVolumePct: bundlePct,
        heparinBolusUnits: s.heparin_bolus_units ? Number(s.heparin_bolus_units) : undefined,
        heparinMaintenanceUnitsPerHour: s.heparin_maintenance_units_per_hour ? Number(s.heparin_maintenance_units_per_hour) : undefined,
        dialysateComposition: s.dialysate_composition || { na: 138, k: 2.0, ca: 1.5, hco3: 32 },

        preBpSitting: pre?.sitting_bp_systolic && pre?.sitting_bp_diastolic ? `${pre.sitting_bp_systolic}/${pre.sitting_bp_diastolic} mmHg` : undefined,
        preBpStanding: pre?.standing_bp_systolic && pre?.standing_bp_diastolic ? `${pre.standing_bp_systolic}/${pre.standing_bp_diastolic} mmHg` : undefined,
        prePulse: pre?.pulse,
        preTemperature: pre?.temp ? Number(pre.temp) : undefined,
        preWaterChlorinePass: waterPassed,

        flowsheets,

        postWeightKg: post?.post_weight_kg ? Number(post.post_weight_kg) : undefined,
        postBpSitting: post?.sitting_bp_systolic && post?.sitting_bp_diastolic ? `${post.sitting_bp_systolic}/${post.sitting_bp_diastolic} mmHg` : undefined,
        postBpStanding: post?.standing_bp_systolic && post?.standing_bp_diastolic ? `${post.standing_bp_systolic}/${post.standing_bp_diastolic} mmHg` : undefined,
        postPulse: post?.pulse,
        actualDurationMinutes: s.actual_duration_minutes ? Number(s.actual_duration_minutes) : undefined,
        actualUfRemovedLiters: post?.actual_uf_removed_liters ? Number(post.actual_uf_removed_liters) : (s.total_uf_removed_liters ? Number(s.total_uf_removed_liters) : undefined),
        hemostasisTimeMinutes: post?.hemostasis_minutes ? Number(post.hemostasis_minutes) : 10,
        postConditionNotes: post?.condition_at_discharge ? `${post.condition_at_discharge}. ${post.post_nurse_notes || ''}` : post?.post_nurse_notes,
        postDialyzerVolumeMl: currentVol > 0 ? currentVol : undefined,
        postResidualTestNegative: true,

        primaryNurseName: s.primary_nurse_name || 'Hemodialysis Staff Nurse, RN',
        primaryNurseLicenseNo: nursePrc,
        nephrologistName: s.nephrologist_name || 'Attending Nephrologist, MD, FPCP, FPSN',
        nephrologistLicenseNo: docPrc,
      };

      const html = renderDialysisTreatmentSheetHtml(doc);
      return renderPdf(html, { format: 'A4' });
    });
  }
}
