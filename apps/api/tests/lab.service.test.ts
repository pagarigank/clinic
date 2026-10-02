import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { probeDb } from '@clinic/db/tests/helpers.js';
import { createPool, withTenant } from '@clinic/db';
import { SupplyService } from '../src/supply/supply.service.js';
import { LabService } from '../src/lab/lab.service.js';
import { ProblemException } from '../src/http/problem.exception.js';

const hasDb = await probeDb();

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const BRANCH_ID = 'a1000000-0000-4000-8000-000000000001';
const ENCODER_USER_ID = 'a3000000-0000-4000-8000-000000000001';
const VERIFIER_USER_ID = 'a3000000-0000-4000-8000-000000000002';

describe.skipIf(!hasDb)('Phase 6 Laboratory Service Tests (AC-10, AC-11, AC-17)', () => {
  const supplySvc = new SupplyService();
  const labSvc = new LabService(supplySvc);
  const ownerPool = createPool({ role: 'owner' });

  let patientId: string;
  let sectionId: string;
  let specTypeId: string;
  let singleTestId: string;
  let panelTestId: string;
  let kAnalyteId: string;
  let naAnalyteId: string;

  beforeAll(async () => {
    const rand = Math.floor(Math.random() * 1000000);

    // Create test patient
    const patRes = await ownerPool.query(
      `INSERT INTO patients (tenant_id, first_name, last_name, date_of_birth, gender)
       VALUES ($1, 'LabTest', 'Patient', '1988-08-08', 'MALE')
       RETURNING id`,
      [TENANT_ID],
    );
    patientId = patRes.rows[0].id;

    // Create section
    const sec = await labSvc.createSection(TENANT_ID, {
      code: `CHEM-${rand}`,
      name: `Clinical Chemistry ${rand}`,
    });
    sectionId = sec.id;

    // Create specimen type
    const st = await labSvc.createSpecimenType(TENANT_ID, {
      code: `SERUM-${rand}`,
      name: `Blood Serum ${rand}`,
      defaultContainer: 'Gold Top Tube',
    });
    specTypeId = st.id;

    // Create Potassium test (with panic ranges)
    const kTest = await labSvc.createTest(TENANT_ID, {
      code: `K-${rand}`,
      name: `Potassium Serum ${rand}`,
      sectionId,
      specimenTypeId: specTypeId,
      tatMinutes: 30,
      isStatAllowed: true,
    });
    singleTestId = kTest.id;

    // Potassium Analyte
    const kAnalyte = await labSvc.createAnalyte(TENANT_ID, singleTestId, {
      testId: singleTestId,
      code: `K-AN-${rand}`,
      name: 'Potassium',
      defaultUnit: 'mmol/L',
      precisionDigits: 1,
    });
    kAnalyteId = kAnalyte.id;

    // Reference range for Potassium: normal 3.5 - 5.0, critical < 2.8 (LL), critical > 6.2 (HH)
    await labSvc.createReferenceRange(TENANT_ID, kAnalyteId, {
      analyteId: kAnalyteId,
      normalMin: 3.5,
      normalMax: 5.0,
      criticalLow: 2.8,
      criticalHigh: 6.2,
      textRange: '3.5 - 5.0 mmol/L',
    });

    // Delta rule for Potassium: max 20% change
    await labSvc.createDeltaRule(TENANT_ID, kAnalyteId, {
      analyteId: kAnalyteId,
      deltaType: 'PERCENT',
      maxChange: 20,
    });

    // Create Sodium test
    const naTest = await labSvc.createTest(TENANT_ID, {
      code: `NA-${rand}`,
      name: `Sodium Serum ${rand}`,
      sectionId,
      specimenTypeId: specTypeId,
      tatMinutes: 30,
    });

    const naAnalyte = await labSvc.createAnalyte(TENANT_ID, naTest.id, {
      testId: naTest.id,
      code: `NA-AN-${rand}`,
      name: 'Sodium',
      defaultUnit: 'mmol/L',
    });
    naAnalyteId = naAnalyte.id;

    // Create Electrolytes Panel (combining K and Na)
    const panel = await labSvc.createTest(TENANT_ID, {
      code: `LYTES-${rand}`,
      name: `Electrolytes Panel ${rand}`,
      sectionId,
      specimenTypeId: specTypeId,
      isPanel: true,
      panelTestIds: [singleTestId, naTest.id],
    });
    panelTestId = panel.id;
  });

  afterAll(async () => {
    await ownerPool.end();
  });

  it('LAB-T1: Order placement expands panel tests and generates document numbers', async () => {
    const order = await labSvc.createOrder(TENANT_ID, ENCODER_USER_ID, {
      branchId: BRANCH_ID,
      patientId,
      testIds: [panelTestId],
      priority: 'STAT',
    });

    expect(order).toBeDefined();
    expect(order.order_no).toMatch(/^LAB-/);
    expect(order.priority).toBe('STAT');
    expect(order.status).toBe('ORDERED');
    // Panel expands to 2 individual child tests (K and Na)
    expect(order.items.length).toBe(2);
    expect(order.items[0].status).toBe('ORDERED');
  });

  it('LAB-T2: Specimen collection creates accession number and chain-of-custody event', async () => {
    const order = await labSvc.createOrder(TENANT_ID, ENCODER_USER_ID, {
      branchId: BRANCH_ID,
      patientId,
      testIds: [singleTestId],
      priority: 'ROUTINE',
    });
    const itemId = order.items[0].id;

    const col = await labSvc.collectSpecimen(TENANT_ID, order.id, itemId, ENCODER_USER_ID, {
      specimenTypeId: specTypeId,
      collectionSite: 'Left antecubital fossa',
      twoIdentifiersVerified: true,
    });

    expect(col.accessionNo).toMatch(/^ACC-/);
    expect(col.specimen.condition).toBe('OK');

    // Verify chain-of-custody event
    const events = await labSvc.getSpecimenEvents(TENANT_ID, col.specimen.id);
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[0].event).toBe('COLLECTED');
  });

  it('LAB-T3: Specimen rejection records reason and flags recollect task', async () => {
    const order = await labSvc.createOrder(TENANT_ID, ENCODER_USER_ID, {
      branchId: BRANCH_ID,
      patientId,
      testIds: [singleTestId],
    });
    const itemId = order.items[0].id;

    await labSvc.collectSpecimen(TENANT_ID, order.id, itemId, ENCODER_USER_ID, {
      specimenTypeId: specTypeId,
    });

    const rej = await labSvc.receiveSpecimen(TENANT_ID, order.id, itemId, ENCODER_USER_ID, {
      condition: 'HEMOLYZED',
      rejectionReason: 'Severe gross hemolysis detected upon inspection',
    });

    expect(rej.status).toBe('REJECTED');
    expect(rej.recollectTaskCreated).toBe(true);

    const orderDetail = await labSvc.getOrder(TENANT_ID, order.id);
    expect(orderDetail.items[0].status).toBe('REJECTED');
  });

  it('LAB-T7 & AC-10: Critical panic value (HH) generates notification & read-back acknowledgement', async () => {
    // 1. Create order, collect, receive
    const order = await labSvc.createOrder(TENANT_ID, ENCODER_USER_ID, {
      branchId: BRANCH_ID,
      patientId,
      testIds: [singleTestId],
      priority: 'STAT',
    });
    const itemId = order.items[0].id;

    await labSvc.collectSpecimen(TENANT_ID, order.id, itemId, ENCODER_USER_ID, {
      specimenTypeId: specTypeId,
    });
    await labSvc.receiveSpecimen(TENANT_ID, order.id, itemId, ENCODER_USER_ID, {
      condition: 'OK',
    });

    // 2. Enter result with panic Potassium (6.8 mmol/L > 6.2 critical high HH)
    const results = await labSvc.enterResults(TENANT_ID, order.id, itemId, ENCODER_USER_ID, {
      results: [
        {
          analyteId: kAnalyteId,
          valueNum: 6.8,
          unit: 'mmol/L',
        },
      ],
    });

    expect(results.length).toBe(1);
    expect(results[0].flag).toBe('HH'); // Panic high flag!

    // 3. Verify critical notification was generated in database
    const alerts = await labSvc.listCriticalAlerts(TENANT_ID, false);
    const alert = alerts.find((a: any) => a.result_id === results[0].id);
    expect(alert).toBeDefined();
    expect(alert.flag).toBe('HH');
    expect(alert.acknowledged_at).toBeNull();

    // 4. Acknowledge with mandatory communication method and read-back confirmed (AC-10)
    const ack = await labSvc.acknowledgeCriticalAlert(TENANT_ID, alert.id, VERIFIER_USER_ID, {
      notifiedTo: 'Dr. Gregory House (Attending Physician)',
      method: 'PHONE',
      readBackConfirmed: true,
      readBackText: 'Potassium 6.8 mmol/L critical high verified by telephone read-back',
    });

    expect(ack.acknowledged_at).not.toBeNull();
    expect(ack.read_back_confirmed).toBe(true);
    expect(ack.read_back_text).toContain('Potassium 6.8');
  });

  it('AC-17: Segregation of Duties — Encoder cannot verify own result; second user verifies', async () => {
    // 1. Create order, collect, receive, enter normal potassium result (4.2 mmol/L)
    const order = await labSvc.createOrder(TENANT_ID, ENCODER_USER_ID, {
      branchId: BRANCH_ID,
      patientId,
      testIds: [singleTestId],
    });
    const itemId = order.items[0].id;

    await labSvc.collectSpecimen(TENANT_ID, order.id, itemId, ENCODER_USER_ID, {
      specimenTypeId: specTypeId,
    });
    await labSvc.receiveSpecimen(TENANT_ID, order.id, itemId, ENCODER_USER_ID, {
      condition: 'OK',
    });

    const enteredResults = await labSvc.enterResults(TENANT_ID, order.id, itemId, ENCODER_USER_ID, {
      results: [
        {
          analyteId: kAnalyteId,
          valueNum: 4.2,
          unit: 'mmol/L',
        },
      ],
    });
    const resultId = enteredResults[0].id;
    expect(enteredResults[0].flag).toBe('N');

    // 2. AC-17 ENFORCEMENT: ENCODER_USER_ID attempts to verify own result -> MUST THROW SEGREGATION_OF_DUTIES
    await expect(labSvc.verifyResult(TENANT_ID, resultId, ENCODER_USER_ID)).rejects.toThrowError(
      ProblemException,
    );

    // 3. Second authorized user (VERIFIER_USER_ID) verifies -> SUCCEEDS
    const verified = await labSvc.verifyResult(TENANT_ID, resultId, VERIFIER_USER_ID);
    expect(verified.status).toBe('VERIFIED');
    expect(verified.verified_by).toBe(VERIFIER_USER_ID);
    expect(verified.verified_at).not.toBeNull();
  });

  it('todo.md §49 / Trigger: Verified result cannot be directly edited via UPDATE', async () => {
    const order = await labSvc.createOrder(TENANT_ID, ENCODER_USER_ID, {
      branchId: BRANCH_ID,
      patientId,
      testIds: [singleTestId],
    });
    const itemId = order.items[0].id;

    await labSvc.collectSpecimen(TENANT_ID, order.id, itemId, ENCODER_USER_ID, {
      specimenTypeId: specTypeId,
    });
    await labSvc.receiveSpecimen(TENANT_ID, order.id, itemId, ENCODER_USER_ID, {
      condition: 'OK',
    });
    const results = await labSvc.enterResults(TENANT_ID, order.id, itemId, ENCODER_USER_ID, {
      results: [{ analyteId: kAnalyteId, valueNum: 4.5, unit: 'mmol/L' }],
    });
    const resultId = results[0].id;

    await labSvc.verifyResult(TENANT_ID, resultId, VERIFIER_USER_ID);

    // Attempting direct UPDATE to change value of VERIFIED result MUST BE BLOCKED by DB trigger
    await expect(
      withTenant({ tenantId: TENANT_ID }, async (tx) => {
        await tx.query(
          `UPDATE lab_results SET value_num = 5.2 WHERE id = $1`,
          [resultId],
        );
      }),
    ).rejects.toThrow(/Verified lab results cannot be edited directly/);
  });

  it('LAB-T9 & AC-11: Result Amendment creates audit trail and updates status to AMENDED', async () => {
    const order = await labSvc.createOrder(TENANT_ID, ENCODER_USER_ID, {
      branchId: BRANCH_ID,
      patientId,
      testIds: [singleTestId],
    });
    const itemId = order.items[0].id;

    await labSvc.collectSpecimen(TENANT_ID, order.id, itemId, ENCODER_USER_ID, {
      specimenTypeId: specTypeId,
    });
    await labSvc.receiveSpecimen(TENANT_ID, order.id, itemId, ENCODER_USER_ID, {
      condition: 'OK',
    });
    const results = await labSvc.enterResults(TENANT_ID, order.id, itemId, ENCODER_USER_ID, {
      results: [{ analyteId: kAnalyteId, valueNum: 4.0, unit: 'mmol/L' }],
    });
    const resultId = results[0].id;
    await labSvc.verifyResult(TENANT_ID, resultId, VERIFIER_USER_ID);

    // Amend with reason
    const amendRes = await labSvc.amendResult(TENANT_ID, resultId, VERIFIER_USER_ID, {
      newValue: '4.4',
      reason: 'Transcription error on initial instrument printout check',
    });

    expect(amendRes.result.status).toBe('AMENDED');
    expect(Number(amendRes.result.value_num)).toBe(4.4);
    expect(amendRes.result.version).toBe(2);

    expect(amendRes.amendment.old_value).toBe('4.0000');
    expect(amendRes.amendment.new_value).toBe('4.4');
    expect(amendRes.amendment.reason).toContain('Transcription error');

    // Check amendment history
    const history = await labSvc.getAmendments(TENANT_ID, resultId);
    expect(history.length).toBe(1);
    expect(history[0].new_value).toBe('4.4');
  });

  it('LAB-T8: Report Release produces SHA-256 integrity hash and marks report FINAL', async () => {
    const order = await labSvc.createOrder(TENANT_ID, ENCODER_USER_ID, {
      branchId: BRANCH_ID,
      patientId,
      testIds: [singleTestId],
    });
    const itemId = order.items[0].id;

    await labSvc.collectSpecimen(TENANT_ID, order.id, itemId, ENCODER_USER_ID, {
      specimenTypeId: specTypeId,
    });
    await labSvc.receiveSpecimen(TENANT_ID, order.id, itemId, ENCODER_USER_ID, {
      condition: 'OK',
    });
    const results = await labSvc.enterResults(TENANT_ID, order.id, itemId, ENCODER_USER_ID, {
      results: [{ analyteId: kAnalyteId, valueNum: 4.8, unit: 'mmol/L' }],
    });
    await labSvc.verifyResult(TENANT_ID, results[0].id, VERIFIER_USER_ID);

    const report = await labSvc.releaseReport(TENANT_ID, order.id, VERIFIER_USER_ID, {
      status: 'FINAL',
    });

    expect(report.status).toBe('FINAL');
    expect(report.version).toBe(1);
    // Release records intent, not an artifact. The document digest is the
    // SHA-256 of the rendered PDF, which does not exist until JOB-43 renders
    // it, so both the file reference and the digest are NULL here and
    // JOB-43 fills them in. Hashing the report JSON at release produced a
    // 64-hex value that described the inputs and could never be re-verified
    // against the bytes a download serves.
    expect(report.file_id).toBeNull();
    expect(report.sha256_hash).toBeNull();

    // Releasing a second time produces version 2 marked CORRECTED
    const report2 = await labSvc.releaseReport(TENANT_ID, order.id, VERIFIER_USER_ID, {
      status: 'FINAL',
    });
    expect(report2.version).toBe(2);
    expect(report2.status).toBe('CORRECTED');
  });

  it('LAB-T5: QC run evaluates Westgard rules and marks status', async () => {
    const rand = Math.floor(Math.random() * 1000000);
    const inst = await labSvc.createInstrument(TENANT_ID, {
      branchId: BRANCH_ID,
      sectionId,
      code: `INST-QC-${rand}`,
      name: `QC Instrument ${rand}`,
    });

    const mat = await labSvc.createQcMaterial(TENANT_ID, {
      sectionId,
      code: `MAT-QC-${rand}`,
      name: `Serum Control Normal ${rand}`,
      lotNo: `QC-LOT-${rand}`,
      expiryDate: '2027-01-01',
    });

    // Run within 1 SD: accepted
    const normalRun = await labSvc.createQcRun(TENANT_ID, VERIFIER_USER_ID, {
      instrumentId: inst.id,
      materialId: mat.id,
      results: [
        {
          analyteId: kAnalyteId,
          valueNum: 4.05,
          targetMean: 4.0,
          targetSd: 0.1,
        },
      ],
    });
    expect(normalRun.status).toBe('ACCEPTED');
    expect(normalRun.results[0].zScore).toBe(0.5);

    // Run with outlier > 3 SD (Westgard 1-3s rejection rule)
    const outlierRun = await labSvc.createQcRun(TENANT_ID, VERIFIER_USER_ID, {
      instrumentId: inst.id,
      materialId: mat.id,
      results: [
        {
          analyteId: kAnalyteId,
          valueNum: 4.45, // Diff = 0.45, SD = 0.1 => z = 4.5 >= 3.0 (rejection!)
          targetMean: 4.0,
          targetSd: 0.1,
        },
      ],
      correctiveAction: 'Recalibrate ISE electrode before running patient samples',
    });
    expect(outlierRun.status).toBe('REJECTED');
    expect(outlierRun.results[0].westgard_flags).toContain('1-3s');
  });
});
