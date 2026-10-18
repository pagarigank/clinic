import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { probeDb } from '@clinic/db/tests/helpers.js';
import { createPool } from '@clinic/db';
import { RenalService } from '../src/renal/renal.service.js';
import { SupplyService } from '../src/supply/supply.service.js';
import { ReportsService } from '../src/reports/reports.service.js';
import { seedUsers, NO_SEED_USERS } from '@clinic/db/tests/helpers.js';
import {
  runRenalWaterAlert,
  runRenalDialyzerAudit,
  runRenalPhilhealthReconcile,
  runRenalKtvCalculate,
} from '../../worker/src/handlers/renal-jobs.handler.js';

const hasDb = await probeDb();

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const BRANCH_ID = 'a1000000-0000-4000-8000-000000000001';
const { DOCTOR_A, NURSE_A } = hasDb ? await seedUsers() : NO_SEED_USERS;

describe.skipIf(!hasDb)('Phase 7A Renal Care Module Tests (AC-29, AC-30, AC-31, AC-32)', () => {
  const renalSvc = new RenalService(new SupplyService());
  const reportsSvc = new ReportsService();
  const ownerPool = createPool({ role: 'owner' });

  let patientId: string;
  let patientBId: string;
  let visitId: string;
  let stationId: string;
  let machineId: string;
  let shiftId: string;
  let accessId: string;
  let prescriptionId: string;
  let dialyzerId: string;

  beforeAll(async () => {
    const rand = Math.floor(Math.random() * 1000000);

    // 1. Create Patient A
    const patA = await ownerPool.query(
      `INSERT INTO patients (tenant_id, first_name, last_name, date_of_birth, gender)
       VALUES ($1, 'RenalPatA', 'Test', '1975-04-12', 'MALE')
       RETURNING id`,
      [TENANT_ID],
    );
    patientId = patA.rows[0].id;

    // 2. Create Patient B
    const patB = await ownerPool.query(
      `INSERT INTO patients (tenant_id, first_name, last_name, date_of_birth, gender)
       VALUES ($1, 'RenalPatB', 'CrossPatient', '1982-11-20', 'FEMALE')
       RETURNING id`,
      [TENANT_ID],
    );
    patientBId = patB.rows[0].id;

    // 3. Create Visit for Patient A (to verify charge posting)
    const visitRes = await ownerPool.query(
      `INSERT INTO visits (
         tenant_id, branch_id, patient_id, visit_no, status, practitioner_id, created_by
       ) VALUES ($1, $2, $3, $4, 'IN_PROGRESS', $5, $5)
       RETURNING id`,
      [TENANT_ID, BRANCH_ID, patientId, `V-HD-${rand}`, DOCTOR_A],
    );
    visitId = visitRes.rows[0].id;

    // 4. Create Station
    const st = await renalSvc.createStation(TENANT_ID, {
      branchId: BRANCH_ID,
      stationNo: `ST-A-${rand}`,
      name: `Dialysis Station ${rand}`,
      isIsolation: false,
    });
    stationId = st.id;

    // 5. Create Machine
    const m = await renalSvc.createMachine(TENANT_ID, {
      branchId: BRANCH_ID,
      stationId,
      serialNo: `FMC-5008-${rand}`,
      brand: 'Fresenius',
      model: '5008S CorDiax',
      totalOperatingHours: 120,
    });
    machineId = m.id;

    // 6. Create Shift
    const sh = await renalSvc.createShift(TENANT_ID, {
      branchId: BRANCH_ID,
      shiftName: `Morning HD ${rand}`,
      startTime: '06:00:00',
      endTime: '10:30:00',
      daysOfWeek: [1, 3, 5],
    });
    shiftId = sh.id;

    // 7. Create Vascular Access
    const acc = await renalSvc.createAccess(TENANT_ID, {
      patientId,
      accessType: 'AV_FISTULA',
      anatomicalSite: 'Left Radiocephalic (Brescia-Cimino)',
      side: 'LEFT',
      surgeonName: 'Dr. Santos',
      createdDate: '2025-06-15',
      status: 'ACTIVE',
    });
    accessId = acc.id;

    // 8. Create Prescription & Sign it
    const rx = await renalSvc.createPrescription(TENANT_ID, {
      patientId,
      nephrologistId: DOCTOR_A,
      modality: 'HD',
      frequencyPerWeek: 3,
      durationMinutes: 240,
      targetDryWeightKg: 65.5,
      dialyzerModel: 'FX80 High-Flux',
      dialysateFormula: 'STANDARD_K2',
      potassiumMeq: 2.0,
      calciumMeq: 2.5,
      sodiumMeq: 138,
      bicarbonateMeq: 32,
      bloodFlowRateTarget: 350,
      dialysateFlowRateTarget: 500,
      heparinBolusUnits: 2000,
      heparinHourlyUnits: 1000,
      isHeparinFree: false,
    });
    prescriptionId = rx.id;

    await renalSvc.signPrescription(TENANT_ID, rx.id, { signedBy: DOCTOR_A });

    // 9. Register Dialyzer for Patient A
    const dz = await renalSvc.createDialyzer(TENANT_ID, {
      patientId,
      serialBarcode: `DZ-PAT-A-${rand}`,
      dialyzerModel: 'FX80 High-Flux',
      baselineVolumeMl: 100.0,
      maxAllowedReuses: 10,
    });
    dialyzerId = dz.id;
  });

  afterAll(async () => {
    await ownerPool.end();
  });

  // ── Station and Machine Registry ───────────────────────────────────────────

  it('manages renal stations and dialysis machines', async () => {
    const stations = await renalSvc.listStations(TENANT_ID, BRANCH_ID);
    expect(stations.some((s) => s.id === stationId)).toBe(true);

    const updatedM = await renalSvc.serviceMachine(TENANT_ID, machineId, {
      serviceType: 'DISINFECTION',
      operatingHoursDelta: 4,
      statusAfterService: 'ACTIVE',
      notes: 'Heat citric disinfection completed',
    });
    expect(Number(updatedM.total_operating_hours)).toBe(124);
    expect(updatedM.last_disinfected_at).not.toBeNull();
  });

  // ── Chair Rostering & Conflict Detection ───────────────────────────────────

  it('prevents chair double-booking on overlapping shifts and days', async () => {
    // Schedule Patient A on Monday (1)
    await renalSvc.createSchedule(TENANT_ID, {
      patientId,
      branchId: BRANCH_ID,
      stationId,
      shiftId,
      dayOfWeek: 1,
      effectiveFrom: '2026-10-01',
    });

    // Attempt to schedule Patient B on the same station, shift, and Monday
    await expect(
      renalSvc.createSchedule(TENANT_ID, {
        patientId: patientBId,
        branchId: BRANCH_ID,
        stationId,
        shiftId,
        dayOfWeek: 1,
        effectiveFrom: '2026-10-01',
      }),
    ).rejects.toThrowError();
  });

  // ── Pre-cannulation Vascular Assessment ────────────────────────────────────

  it('records pre-cannulation physical examination (thrill/bruit)', async () => {
    const assessment = await renalSvc.createAssessment(TENANT_ID, accessId, {
      assessedBy: NURSE_A,
      thrillPresent: true,
      bruitPresent: true,
      signsOfInfection: false,
      cannulationComplication: null,
      interventionNotes: 'Strong continuous bruit and palpable thrill throughout fistula trunk',
    });
    expect(assessment.thrill_present).toBe(true);
    expect(assessment.bruit_present).toBe(true);
  });

  // ── AC-31: Pre-shift Water Safety Chlorine Breakthrough Lockout ────────────

  it('AC-31: blocks session start if pre-shift water test has chlorine >= 0.1 ppm', async () => {
    const dateStr = '2026-10-19';

    // Log unsafe water test: chlorine breakthrough = 0.15 ppm (threshold < 0.1 ppm)
    await renalSvc.createWaterTreatmentLog(TENANT_ID, {
      branchId: BRANCH_ID,
      logDate: dateStr,
      testedBy: NURSE_A,
      carbonBreakthroughChlorinePpm: 0.15,
      roConductivityUs: 12.5,
      roRejectionRatePct: 98.2,
      notes: 'Carbon bed breakthrough detected!',
    });

    // Create session scheduled for that date
    const session = await renalSvc.createSession(TENANT_ID, {
      patientId,
      visitId,
      branchId: BRANCH_ID,
      stationId,
      machineId,
      prescriptionId,
      accessId,
      dialyzerId,
      scheduledDate: dateStr,
      shiftId,
      primaryNurseId: NURSE_A,
    });

    // Attempting pre-dialysis intake must FAIL-CLOSED due to chlorine >= 0.1 ppm
    await expect(
      renalSvc.startPreDialysis(TENANT_ID, session.id, {
        preWeightKg: 68.2,
        sittingBpSystolic: 140,
        sittingBpDiastolic: 85,
        pulse: 76,
        temp: 36.6,
        dryWeightKg: 65.5,
        targetUfLiters: 2.7,
        nurseSignId: NURSE_A,
      }),
    ).rejects.toMatchObject({ response: { code: 'WATER_SAFETY_LOCKOUT' } });
  });

  it('AC-31: permits session start once compliant water test (< 0.1 ppm) is recorded', async () => {
    const dateStr = '2026-10-20';

    // Log compliant water test
    await renalSvc.createWaterTreatmentLog(TENANT_ID, {
      branchId: BRANCH_ID,
      logDate: dateStr,
      testedBy: NURSE_A,
      carbonBreakthroughChlorinePpm: 0.02, // Well below 0.1 ppm cutoff
      roConductivityUs: 8.4,
      roRejectionRatePct: 99.1,
      notes: 'Carbon filters flushed; total chlorine compliant',
    });

    const session = await renalSvc.createSession(TENANT_ID, {
      patientId,
      visitId,
      branchId: BRANCH_ID,
      stationId,
      machineId,
      prescriptionId,
      accessId,
      dialyzerId,
      scheduledDate: dateStr,
      shiftId,
      primaryNurseId: NURSE_A,
    });

    const started = await renalSvc.startPreDialysis(TENANT_ID, session.id, {
      preWeightKg: 68.0,
      sittingBpSystolic: 135,
      sittingBpDiastolic: 80,
      pulse: 72,
      temp: 36.5,
      dryWeightKg: 65.5,
      targetUfLiters: 2.5,
      nurseSignId: NURSE_A,
    });

    expect(started.status).toBe('IN_PROGRESS');
    expect(started.preAssessment.fluid_gain_kg).toBe('2.50');
  });

  // ── AC-30: Dialyzer Single-Patient Rule & Bundle Volume Cutoff ──────────────

  it('AC-30: rejects using a dialyzer registered to Patient A for Patient B', async () => {
    const dateStr = '2026-10-21';

    // Create prescription for Patient B
    const rxB = await renalSvc.createPrescription(TENANT_ID, {
      patientId: patientBId,
      nephrologistId: DOCTOR_A,
      modality: 'HD',
      frequencyPerWeek: 3,
      durationMinutes: 240,
      targetDryWeightKg: 55.0,
      dialyzerModel: 'FX80 High-Flux',
      dialysateFormula: 'STANDARD_K2',
      potassiumMeq: 2.0,
      calciumMeq: 2.5,
      sodiumMeq: 138,
      bicarbonateMeq: 32,
      bloodFlowRateTarget: 300,
      dialysateFlowRateTarget: 500,
    });
    await renalSvc.signPrescription(TENANT_ID, rxB.id, { signedBy: DOCTOR_A });

    // Create session for Patient B with Patient A's dialyzer
    await expect(
      renalSvc.createSession(TENANT_ID, {
        patientId: patientBId, // Patient B
        visitId: null,
        branchId: BRANCH_ID,
        stationId,
        machineId,
        prescriptionId: rxB.id,
        accessId: null,
        dialyzerId, // Belongs to Patient A!
        scheduledDate: dateStr,
        shiftId,
        primaryNurseId: NURSE_A,
      }),
    ).rejects.toMatchObject({ response: { code: 'DIALYZER_PATIENT_MISMATCH' } });
  });

  it('AC-30: forces dialyzer to DISCARDED when bundle volume is < 80% baseline', async () => {
    const rand = Math.floor(Math.random() * 1000000);
    // Create new dialyzer with baseline volume = 100 mL
    const dz = await renalSvc.createDialyzer(TENANT_ID, {
      patientId,
      serialBarcode: `DZ-VOL-TEST-${rand}`,
      dialyzerModel: 'FX60 Low-Flux',
      baselineVolumeMl: 100.0,
      maxAllowedReuses: 10,
    });

    // Reprocess with measured volume = 75 mL (75% < 80% cutoff)
    const reprocessResult = await renalSvc.reprocessDialyzer(TENANT_ID, dz.id, {
      technicianId: NURSE_A,
      measuredVolumeMl: 75.0,
      pressureLeakTestPassed: true,
      disinfectantAgent: 'PERACETIC_ACID_4PCT',
      notes: 'End of life fiber clotting detected',
    });

    expect(reprocessResult.passed).toBe(false);
    expect(reprocessResult.dialyzer.status).toBe('DISCARDED');
    expect(reprocessResult.discardReason).toContain('Fiber bundle volume below 80%');
  });

  it('AC-30: forces dialyzer to DISCARDED when pressure leak test fails', async () => {
    const rand = Math.floor(Math.random() * 1000000);
    const dz = await renalSvc.createDialyzer(TENANT_ID, {
      patientId,
      serialBarcode: `DZ-LEAK-TEST-${rand}`,
      dialyzerModel: 'FX60 Low-Flux',
      baselineVolumeMl: 100.0,
    });

    // Measured volume 90 mL (90%), but leak test FAILS
    const reprocessResult = await renalSvc.reprocessDialyzer(TENANT_ID, dz.id, {
      technicianId: NURSE_A,
      measuredVolumeMl: 90.0,
      pressureLeakTestPassed: false,
      disinfectantAgent: 'PERACETIC_ACID_4PCT',
      notes: 'Air leak detected at dialysate port header',
    });

    expect(reprocessResult.passed).toBe(false);
    expect(reprocessResult.dialyzer.status).toBe('DISCARDED');
    expect(reprocessResult.discardReason).toContain('leak test');
  });

  // ── AC-29 & AC-32: Full Session Lifecycle, Charge Capture & PhilHealth 156 Cap ─

  it('AC-29 & AC-32: executes full session lifecycle, captures charges, and increments PhilHealth counter', async () => {
    const dateStr = '2026-10-22';

    // 1. Ensure compliant water test exists
    await renalSvc.createWaterTreatmentLog(TENANT_ID, {
      branchId: BRANCH_ID,
      logDate: dateStr,
      testedBy: NURSE_A,
      carbonBreakthroughChlorinePpm: 0.01,
      roConductivityUs: 6.2,
      roRejectionRatePct: 99.4,
    });

    // 2. Create and start session
    const session = await renalSvc.createSession(TENANT_ID, {
      patientId,
      visitId,
      branchId: BRANCH_ID,
      stationId,
      machineId,
      prescriptionId,
      accessId,
      dialyzerId,
      scheduledDate: dateStr,
      shiftId,
      primaryNurseId: NURSE_A,
    });

    await renalSvc.startPreDialysis(TENANT_ID, session.id, {
      preWeightKg: 68.5,
      sittingBpSystolic: 142,
      sittingBpDiastolic: 88,
      pulse: 78,
      temp: 36.7,
      dryWeightKg: 65.5,
      targetUfLiters: 3.0,
      nurseSignId: NURSE_A,
    });

    // 3. Intra-dialytic flowsheet recordings
    await renalSvc.recordFlowsheet(TENANT_ID, session.id, {
      elapsedMinutes: 60,
      bpSystolic: 138,
      bpDiastolic: 84,
      pulse: 76,
      bloodFlowRate: 350,
      dialysateFlowRate: 500,
      arterialPressure: -120,
      venousPressure: 150,
      tmp: 90,
      ufRate: 0.75,
      cumUfVolumeLiters: 0.75,
      heparinAdministered: 1000,
      recordedBy: NURSE_A,
    });

    await renalSvc.recordFlowsheet(TENANT_ID, session.id, {
      elapsedMinutes: 240,
      bpSystolic: 130,
      bpDiastolic: 80,
      pulse: 74,
      bloodFlowRate: 350,
      dialysateFlowRate: 500,
      arterialPressure: -130,
      venousPressure: 160,
      tmp: 110,
      ufRate: 0.75,
      cumUfVolumeLiters: 3.0,
      heparinAdministered: 1000,
      recordedBy: NURSE_A,
    });

    // 4. Post-dialysis close
    const closeResult = await renalSvc.completePostDialysis(TENANT_ID, session.id, {
      postWeightKg: 65.6,
      sittingBpSystolic: 128,
      sittingBpDiastolic: 78,
      pulse: 72,
      temp: 36.6,
      actualUfRemovedLiters: 2.9,
      totalHeparinGiven: 3000,
      accessBruitThrill: true,
      hemostasisMinutes: 15,
      conditionAtDischarge: 'STABLE',
      signedBy: NURSE_A,
    });

    expect(closeResult.session.status).toBe('COMPLETED');
    expect(closeResult.philHealthSequenceNo).toBeGreaterThanOrEqual(1);
    expect(closeResult.claimAmount).toBe(2600.0);
    expect(closeResult.copayAmount).toBe(0.0);

    // 5. Verify billing charge was posted to billing_charges (AC-29)
    const chargeRes = await ownerPool.query(
      `SELECT * FROM billing_charges
       WHERE tenant_id = $1 AND source_type = 'DIALYSIS_SESSION' AND source_id = $2`,
      [TENANT_ID, session.id],
    );
    expect(chargeRes.rows.length).toBe(1);
    expect(chargeRes.rows[0].charge_type).toBe('PROCEDURE');
    expect(Number(chargeRes.rows[0].amount)).toBe(2600.0);

    // 6. Verify PhilHealth usage counter (AC-32)
    const usage = await renalSvc.getPhilHealthUsage(TENANT_ID, patientId);
    expect(usage.sessionCount).toBeGreaterThanOrEqual(1);
    expect(usage.maxBenefitSessions).toBe(156);
    expect(usage.remainingSessions).toBe(156 - usage.sessionCount);
  });

  // ── Background Jobs JOB-51 to JOB-54 ───────────────────────────────────────

  it('runs renal background jobs JOB-51…JOB-54 without errors', async () => {
    const waterAlert = await runRenalWaterAlert(TENANT_ID);
    expect(waterAlert).toHaveProperty('alertedBranches');

    const dialyzerAudit = await runRenalDialyzerAudit(TENANT_ID);
    expect(dialyzerAudit).toHaveProperty('staleDialyzers');

    const philhealthReconcile = await runRenalPhilhealthReconcile(TENANT_ID);
    expect(philhealthReconcile).toHaveProperty('warnedPatients');

    const ktvCalc = await runRenalKtvCalculate(TENANT_ID);
    expect(ktvCalc).toHaveProperty('calculated');
  });

  // ── Reports RPT-REN-01 to RPT-REN-06 ───────────────────────────────────────

  it('generates reports RPT-REN-01…06 scoped to tenant', async () => {
    const rpt1 = await reportsSvc.runReport(TENANT_ID, DOCTOR_A, 'RPT-REN-01');
    expect(rpt1.reportId).toBe('RPT-REN-01');
    expect(Array.isArray(rpt1.data)).toBe(true);

    const rpt2 = await reportsSvc.runReport(TENANT_ID, DOCTOR_A, 'RPT-REN-02');
    expect(rpt2.reportId).toBe('RPT-REN-02');

    const rpt3 = await reportsSvc.runReport(TENANT_ID, DOCTOR_A, 'RPT-REN-03');
    expect(rpt3.reportId).toBe('RPT-REN-03');

    const rpt5 = await reportsSvc.runReport(TENANT_ID, DOCTOR_A, 'RPT-REN-05');
    expect(rpt5.reportId).toBe('RPT-REN-05');
  });

  // ── R-REN-04: HBV isolation enforcement ────────────────────────────────────

  it('R-REN-04: blocks an HBsAg+ patient session on a non-isolation station', async () => {
    const rand = Math.floor(Math.random() * 1000000);

    const rxCohort = await renalSvc.createPrescription(TENANT_ID, {
      patientId: patientBId,
      nephrologistId: DOCTOR_A,
      targetDryWeightKg: 60.0,
      dialyzerModel: 'FX80 High-Flux',
      hbvHbsagPositive: true,
    });
    await renalSvc.signPrescription(TENANT_ID, rxCohort.id, { signedBy: DOCTOR_A });

    const dzCohort = await renalSvc.createDialyzer(TENANT_ID, {
      patientId: patientBId,
      serialBarcode: `DZ-HBV-${rand}`,
      dialyzerModel: 'FX80 High-Flux',
      baselineVolumeMl: 100.0,
      maxAllowedReuses: 10,
    });

    await expect(
      renalSvc.createSession(TENANT_ID, {
        patientId: patientBId,
        branchId: BRANCH_ID,
        stationId, // shared station, is_isolation = false
        machineId,
        prescriptionId: rxCohort.id,
        dialyzerId: dzCohort.id,
        scheduledDate: '2026-10-24',
        shiftId,
        primaryNurseId: NURSE_A,
      }),
    ).rejects.toMatchObject({ response: { code: 'RENAL_ISOLATION_REQUIRED' } });
  });

  // ── R-REN-03: residual disinfectant test gate ──────────────────────────────

  it('R-REN-03: requires a residual test before reusing a reprocessed dialyzer', async () => {
    const rand = Math.floor(Math.random() * 1000000);
    const dateStr = '2026-10-25';

    await renalSvc.createWaterTreatmentLog(TENANT_ID, {
      branchId: BRANCH_ID,
      logDate: dateStr,
      testedBy: NURSE_A,
      carbonBreakthroughChlorinePpm: 0.02,
      roConductivityUs: 12.0,
      roRejectionRatePct: 98.0,
    });

    const dz = await renalSvc.createDialyzer(TENANT_ID, {
      patientId,
      serialBarcode: `DZ-RES-${rand}`,
      dialyzerModel: 'FX80 High-Flux',
      baselineVolumeMl: 100.0,
      maxAllowedReuses: 10,
    });

    // Reprocess successfully but WITHOUT a residual test → reuse_count = 1
    const reprocess = await renalSvc.reprocessDialyzer(TENANT_ID, dz.id, {
      technicianId: NURSE_A,
      measuredVolumeMl: 92.0,
      pressureLeakTestPassed: true,
      disinfectantAgent: 'Citric 50%',
    });
    expect(reprocess.passed).toBe(true);

    const session = await renalSvc.createSession(TENANT_ID, {
      patientId,
      visitId,
      branchId: BRANCH_ID,
      stationId,
      machineId,
      prescriptionId,
      accessId,
      dialyzerId: dz.id,
      scheduledDate: dateStr,
      shiftId,
      primaryNurseId: NURSE_A,
    });

    await expect(
      renalSvc.startPreDialysis(TENANT_ID, session.id, {
        preWeightKg: 68.0,
        sittingBpSystolic: 138,
        sittingBpDiastolic: 82,
        pulse: 74,
        temp: 36.6,
        dryWeightKg: 65.5,
        targetUfLiters: 2.5,
        nurseSignId: NURSE_A,
      }),
    ).rejects.toMatchObject({ response: { code: 'RESIDUAL_TEST_REQUIRED' } });

    // Reprocess again WITH the residual test → start succeeds
    await renalSvc.reprocessDialyzer(TENANT_ID, dz.id, {
      technicianId: NURSE_A,
      measuredVolumeMl: 90.0,
      pressureLeakTestPassed: true,
      disinfectantAgent: 'Citric 50%',
      residualTestPriorUse: true,
    });

    const started = await renalSvc.startPreDialysis(TENANT_ID, session.id, {
      preWeightKg: 68.0,
      sittingBpSystolic: 138,
      sittingBpDiastolic: 82,
      pulse: 74,
      temp: 36.6,
      dryWeightKg: 65.5,
      targetUfLiters: 2.5,
      nurseSignId: NURSE_A,
    });
    expect(started.status).toBe('IN_PROGRESS');
  });

  // ── AC-29: consumables charged to the supply ledger on close ───────────────

  it('AC-29: posts dialysis consumables to the supply ledger on close', async () => {
    const rand = Math.floor(Math.random() * 1000000);
    const dateStr = '2026-10-26';

    await renalSvc.createWaterTreatmentLog(TENANT_ID, {
      branchId: BRANCH_ID,
      logDate: dateStr,
      testedBy: NURSE_A,
      carbonBreakthroughChlorinePpm: 0.02,
      roConductivityUs: 12.0,
      roRejectionRatePct: 98.0,
    });

    // Seed a stocked batch to consume from
    const uomRes = await ownerPool.query(
      `INSERT INTO uoms (tenant_id, code, name) VALUES ($1, $2, 'Pieces') RETURNING id`,
      [TENANT_ID, `UOM-DIAL-${rand}`],
    );
    const uomId = uomRes.rows[0].id;
    const itemRes = await ownerPool.query(
      `INSERT INTO items (tenant_id, code, name, item_type, base_uom_id, is_batch_tracked)
       VALUES ($1, $2, 'Dialyzer Bundle Kit', 'MEDICINE', $3, true) RETURNING id`,
      [TENANT_ID, `ITEM-DIAL-${rand}`, uomId],
    );
    const itemId = itemRes.rows[0].id;
    const locRes = await ownerPool.query(
      `INSERT INTO stock_locations (tenant_id, branch_id, code, name, type)
       VALUES ($1, $2, $3, 'Dialysis Store', 'CENTRAL_STORE') RETURNING id`,
      [TENANT_ID, BRANCH_ID, `LOC-DIAL-${rand}`],
    );
    const locationId = locRes.rows[0].id;
    const batchRes = await ownerPool.query(
      `INSERT INTO stock_batches (tenant_id, item_id, lot_no, expiry_date, unit_cost, status)
       VALUES ($1, $2, $3, '2028-01-01', 5, 'AVAILABLE') RETURNING id`,
      [TENANT_ID, itemId, `LOT-DIAL-${rand}`],
    );
    const batchId = batchRes.rows[0].id;
    await ownerPool.query(
      `INSERT INTO stock_balances (tenant_id, location_id, batch_id, qty_on_hand)
       VALUES ($1, $2, $3, 100)`,
      [TENANT_ID, locationId, batchId],
    );

    const dz = await renalSvc.createDialyzer(TENANT_ID, {
      patientId,
      serialBarcode: `DZ-CON-${rand}`,
      dialyzerModel: 'FX80 High-Flux',
      baselineVolumeMl: 100.0,
      maxAllowedReuses: 10,
    });

    const session = await renalSvc.createSession(TENANT_ID, {
      patientId,
      visitId,
      branchId: BRANCH_ID,
      stationId,
      machineId,
      prescriptionId,
      accessId,
      dialyzerId: dz.id,
      scheduledDate: dateStr,
      shiftId,
      primaryNurseId: NURSE_A,
    });

    await renalSvc.startPreDialysis(TENANT_ID, session.id, {
      preWeightKg: 68.0,
      sittingBpSystolic: 138,
      sittingBpDiastolic: 82,
      pulse: 74,
      temp: 36.6,
      dryWeightKg: 65.5,
      targetUfLiters: 2.5,
      nurseSignId: NURSE_A,
    });

    await renalSvc.completePostDialysis(TENANT_ID, session.id, {
      postWeightKg: 65.4,
      sittingBpSystolic: 130,
      sittingBpDiastolic: 78,
      pulse: 72,
      temp: 36.5,
      actualUfRemovedLiters: 2.6,
      hemostasisMinutes: 10,
      signedBy: NURSE_A,
      consumables: [{ itemId, locationId, batchId, qty: 2, uomId }],
    });

    const mov = await ownerPool.query(
      `SELECT qty, ref_type, ref_id FROM stock_movements
        WHERE tenant_id = $1 AND item_id = $2 AND movement_type = 'CONSUMPTION'`,
      [TENANT_ID, itemId],
    );
    expect(mov.rows).toHaveLength(1);
    expect(Number(mov.rows[0].qty)).toBe(-2);
    expect(mov.rows[0].ref_type).toBe('DIALYSIS_SESSION');
    expect(mov.rows[0].ref_id).toBe(session.id);

    const log = await ownerPool.query(
      `SELECT qty, ref_type, ref_id FROM consumption_logs
        WHERE tenant_id = $1 AND item_id = $2`,
      [TENANT_ID, itemId],
    );
    expect(log.rows).toHaveLength(1);
    expect(log.rows[0].ref_type).toBe('DIALYSIS_SESSION');

    const bal = await ownerPool.query(
      `SELECT qty_on_hand FROM stock_balances
        WHERE tenant_id = $1 AND location_id = $2 AND batch_id = $3`,
      [TENANT_ID, locationId, batchId],
    );
    expect(Number(bal.rows[0].qty_on_hand)).toBe(98);
  });

  // ── JOB-52: dialyzer reuse-ceiling audit ───────────────────────────────────

  it('JOB-52: discards a dialyzer that reached its maximum reuse limit', async () => {
    const rand = Math.floor(Math.random() * 1000000);

    const dz = await renalSvc.createDialyzer(TENANT_ID, {
      patientId,
      serialBarcode: `DZ-MAX-${rand}`,
      dialyzerModel: 'FX80 High-Flux',
      baselineVolumeMl: 100.0,
      maxAllowedReuses: 2,
    });

    // Force the dialyzer to the reuse ceiling without discarding it
    await ownerPool.query(
      `UPDATE dialyzers SET reuse_count = 2, status = 'CLEANED_READY', updated_at = now() WHERE id = $1`,
      [dz.id],
    );

    await runRenalDialyzerAudit(TENANT_ID);

    const after = await ownerPool.query(
      `SELECT status, discard_reason FROM dialyzers WHERE id = $1`,
      [dz.id],
    );
    expect(after.rows[0].status).toBe('DISCARDED');
    expect(after.rows[0].discard_reason).toContain('maximum allowable reuse');
  });
});
