import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { probeDb } from '@clinic/db/tests/helpers.js';
import { createPool, withTenant } from '@clinic/db';
import { SupplyService } from '../src/supply/supply.service.js';
import { LabService } from '../src/lab/lab.service.js';
import { ProblemException } from '../src/http/problem.exception.js';
import { seedUsers, NO_SEED_USERS } from "@clinic/db/tests/helpers.js";

const hasDb = await probeDb();

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const BRANCH_A = 'a1000000-0000-4000-8000-000000000001';
const { USER_A, DOCTOR_A } = hasDb ? await seedUsers() : NO_SEED_USERS;

const TENANT_B = '22222222-2222-4222-8222-222222222222';
const BRANCH_B = 'b1000000-0000-4000-8000-000000000001';
const { USER_B } = hasDb ? await seedUsers() : NO_SEED_USERS;

describe.skipIf(!hasDb)('Phase 6 Multi-Tenant Isolation (§49)', () => {
  const supplySvc = new SupplyService();
  const labSvc = new LabService(supplySvc);
  const ownerPool = createPool({ role: 'owner' });

  let patientAId: string;
  let sectionAId: string;
  let specTypeAId: string;
  let testAId: string;
  let analyteAId: string;
  let orderAId: string;
  let orderItemId: string;
  let specimenAId: string;
  let resultAId: string;
  let reportAId: string;

  beforeAll(async () => {
    const rand = Math.floor(Math.random() * 1000000);

    // Setup Patient for Tenant A
    const patA = await ownerPool.query(
      `INSERT INTO patients (tenant_id, first_name, last_name, date_of_birth, gender)
       VALUES ($1, 'LabPatient', 'Iso A', '1995-05-15', 'FEMALE')
       RETURNING id`,
      [TENANT_A],
    );
    patientAId = patA.rows[0].id;

    // 1. Create section
    const secA = await labSvc.createSection(TENANT_A, {
      code: `SEC-A-${rand}`,
      name: `Hematology A ${rand}`,
    });
    sectionAId = secA.id;

    // 2. Create specimen type
    const stA = await labSvc.createSpecimenType(TENANT_A, {
      code: `ST-A-${rand}`,
      name: `EDTA Blood A ${rand}`,
      defaultContainer: 'Lavender Tube',
    });
    specTypeAId = stA.id;

    // 3. Create test
    const tA = await labSvc.createTest(TENANT_A, {
      code: `CBC-A-${rand}`,
      name: `CBC A ${rand}`,
      sectionId: sectionAId,
      specimenTypeId: specTypeAId,
      tatMinutes: 45,
    });
    testAId = tA.id;

    // 4. Create analyte
    const aA = await labSvc.createAnalyte(TENANT_A, testAId, {
      testId: testAId,
      code: `WBC-A-${rand}`,
      name: `White Blood Cells ${rand}`,
      defaultUnit: '10^9/L',
    });
    analyteAId = aA.id;

    // 5. Create reference range
    await labSvc.createReferenceRange(TENANT_A, analyteAId, {
      analyteId: analyteAId,
      normalMin: 4.0,
      normalMax: 11.0,
      criticalLow: 2.0,
      criticalHigh: 30.0,
    });

    // 6. Create delta rule
    await labSvc.createDeltaRule(TENANT_A, analyteAId, {
      analyteId: analyteAId,
      deltaType: 'PERCENT',
      maxChange: 50,
    });

    // 7. Create instrument
    await labSvc.createInstrument(TENANT_A, {
      branchId: BRANCH_A,
      sectionId: sectionAId,
      code: `INST-A-${rand}`,
      name: `Sysmex A ${rand}`,
    });

    // 8. Create QC material
    await labSvc.createQcMaterial(TENANT_A, {
      sectionId: sectionAId,
      code: `QC-A-${rand}`,
      name: `CBC Control A ${rand}`,
      lotNo: `LOT-A-${rand}`,
      expiryDate: '2027-12-31',
    });

    // 9. Create lab order
    const orderA = await labSvc.createOrder(TENANT_A, USER_A, {
      branchId: BRANCH_A,
      patientId: patientAId,
      testIds: [testAId],
      priority: 'ROUTINE',
    });
    orderAId = orderA.id;
    orderItemId = orderA.items[0].id;

    // 10. Collect specimen
    const colA = await labSvc.collectSpecimen(TENANT_A, orderAId, orderItemId, USER_A, {
      specimenTypeId: specTypeAId,
    });
    specimenAId = colA.specimen.id;

    // 11. Receive specimen
    await labSvc.receiveSpecimen(TENANT_A, orderAId, orderItemId, USER_A, {
      condition: 'OK',
    });

    // 12. Enter results
    const resA = await labSvc.enterResults(TENANT_A, orderAId, orderItemId, USER_A, {
      results: [
        {
          analyteId: analyteAId,
          valueNum: 7.5,
          unit: '10^9/L',
        },
      ],
    });
    resultAId = resA[0].id;

    // 13. Verify result (using another user in tenant A)
    await withTenant({ tenantId: TENANT_A }, async (tx) => {
      await tx.query(
        `UPDATE lab_results SET status = 'VERIFIED', verified_by = $1, verified_at = now() WHERE id = $2`,
        [DOCTOR_A, resultAId],
      );
    });

    // 14. Release report
    const repA = await labSvc.releaseReport(TENANT_A, orderAId, USER_A, {
      status: 'FINAL',
    });
    reportAId = repA.id;
  });

  afterAll(async () => {
    await ownerPool.end();
  });

  it('Tenant B cannot read Tenant A lab sections', async () => {
    const listB = await labSvc.listSections(TENANT_B);
    const leaked = listB.find((s: any) => s.id === sectionAId);
    expect(leaked).toBeUndefined();
  });

  it('Tenant B cannot read or access Tenant A lab tests', async () => {
    const listB = await labSvc.listTests(TENANT_B);
    const leaked = listB.find((t: any) => t.id === testAId);
    expect(leaked).toBeUndefined();

    await expect(labSvc.getTest(TENANT_B, testAId)).rejects.toThrow(ProblemException);
  });

  it('Tenant B cannot read Tenant A lab orders', async () => {
    const listB = await labSvc.listOrders(TENANT_B);
    const leaked = listB.find((o: any) => o.id === orderAId);
    expect(leaked).toBeUndefined();

    await expect(labSvc.getOrder(TENANT_B, orderAId)).rejects.toThrow(ProblemException);
  });

  it('Tenant B cannot see Tenant A worklist items', async () => {
    const worklistB = await labSvc.getWorklist(TENANT_B);
    const leaked = worklistB.find((w: any) => w.order_id === orderAId || w.item_id === orderItemId);
    expect(leaked).toBeUndefined();
  });

  it('Tenant B cannot access Tenant A lab reports', async () => {
    const reportsB = await labSvc.listReports(TENANT_B, orderAId);
    expect(reportsB.length).toBe(0);

    await expect(labSvc.getReport(TENANT_B, reportAId)).rejects.toThrow(ProblemException);
  });

  it('Direct SQL under Tenant B context returns 0 rows for all Tenant A lab tables', async () => {
    await withTenant({ tenantId: TENANT_B }, async (tx) => {
      const qSec = await tx.query(`SELECT id FROM lab_sections WHERE id = $1`, [sectionAId]);
      expect(qSec.rows.length).toBe(0);

      const qTest = await tx.query(`SELECT id FROM lab_tests WHERE id = $1`, [testAId]);
      expect(qTest.rows.length).toBe(0);

      const qAnalyte = await tx.query(`SELECT id FROM lab_analytes WHERE id = $1`, [analyteAId]);
      expect(qAnalyte.rows.length).toBe(0);

      const qOrder = await tx.query(`SELECT id FROM lab_orders WHERE id = $1`, [orderAId]);
      expect(qOrder.rows.length).toBe(0);

      const qOrderItem = await tx.query(`SELECT id FROM lab_order_items WHERE id = $1`, [orderItemId]);
      expect(qOrderItem.rows.length).toBe(0);

      const qSpecimen = await tx.query(`SELECT id FROM specimens WHERE id = $1`, [specimenAId]);
      expect(qSpecimen.rows.length).toBe(0);

      const qResult = await tx.query(`SELECT id FROM lab_results WHERE id = $1`, [resultAId]);
      expect(qResult.rows.length).toBe(0);

      const qReport = await tx.query(`SELECT id FROM lab_reports WHERE id = $1`, [reportAId]);
      expect(qReport.rows.length).toBe(0);
    });
  });
});
