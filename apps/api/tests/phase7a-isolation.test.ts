import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { probeDb } from '@clinic/db/tests/helpers.js';
import { createPool, withTenant } from '@clinic/db';
import { RenalService } from '../src/renal/renal.service.js';
import { SupplyService } from '../src/supply/supply.service.js';
import { ProblemException } from '../src/http/problem.exception.js';
import { seedUsers, NO_SEED_USERS } from '@clinic/db/tests/helpers.js';
import { Reflector } from '@nestjs/core';
import { ModuleGuard } from '../src/rbac/module.guard.js';
import type { ExecutionContext } from '@nestjs/common';

const hasDb = await probeDb();

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const BRANCH_A = 'a1000000-0000-4000-8000-000000000001';
const { DOCTOR_A, NURSE_A } = hasDb ? await seedUsers() : NO_SEED_USERS;

const TENANT_B = '22222222-2222-4222-8222-222222222222';

describe.skipIf(!hasDb)('Phase 7A Multi-Tenant Isolation & Module Guard (§49, AC-23, AC-27)', () => {
  const renalSvc = new RenalService(new SupplyService());
  const ownerPool = createPool({ role: 'owner' });

  let patientAId: string;
  let stationAId: string;
  let machineAId: string;
  let shiftAId: string;
  let accessAId: string;
  let prescriptionAId: string;
  let dialyzerAId: string;
  let sessionAId: string;
  let waterLogAId: string;

  beforeAll(async () => {
    const rand = Math.floor(Math.random() * 1000000);

    // Patient A
    const patA = await ownerPool.query(
      `INSERT INTO patients (tenant_id, first_name, last_name, date_of_birth, gender)
       VALUES ($1, 'IsoPatA', 'Test', '1980-01-01', 'MALE')
       RETURNING id`,
      [TENANT_A],
    );
    patientAId = patA.rows[0].id;

    // Station A
    const st = await renalSvc.createStation(TENANT_A, {
      branchId: BRANCH_A,
      stationNo: `ST-ISO-${rand}`,
      name: `Station Iso ${rand}`,
      isIsolation: false,
    });
    stationAId = st.id;

    // Machine A
    const m = await renalSvc.createMachine(TENANT_A, {
      branchId: BRANCH_A,
      stationId: stationAId,
      serialNo: `MAC-ISO-${rand}`,
      brand: 'Fresenius',
      model: '4008S',
    });
    machineAId = m.id;

    // Shift A
    const sh = await renalSvc.createShift(TENANT_A, {
      branchId: BRANCH_A,
      shiftName: `Morning HD Iso ${rand}`,
      startTime: '07:00:00',
      endTime: '11:00:00',
      daysOfWeek: [2, 4, 6],
    });
    shiftAId = sh.id;

    // Access A
    const acc = await renalSvc.createAccess(TENANT_A, {
      patientId: patientAId,
      accessType: 'AV_FISTULA',
      anatomicalSite: 'Left Brescia-Cimino',
      side: 'LEFT',
      surgeonName: 'Dr. Iso',
      createdDate: '2025-01-01',
    });
    accessAId = acc.id;

    // Prescription A
    const rx = await renalSvc.createPrescription(TENANT_A, {
      patientId: patientAId,
      nephrologistId: DOCTOR_A,
      modality: 'HD',
      frequencyPerWeek: 3,
      durationMinutes: 240,
      targetDryWeightKg: 60.0,
      dialyzerModel: 'FX80 High-Flux',
      dialysateFormula: 'STANDARD_K2',
      potassiumMeq: 2.0,
      calciumMeq: 2.5,
      sodiumMeq: 138,
      bicarbonateMeq: 32,
      bloodFlowRateTarget: 300,
      dialysateFlowRateTarget: 500,
    });
    prescriptionAId = rx.id;
    await renalSvc.signPrescription(TENANT_A, rx.id, { signedBy: DOCTOR_A });

    // Dialyzer A
    const dz = await renalSvc.createDialyzer(TENANT_A, {
      patientId: patientAId,
      serialBarcode: `DZ-ISO-${rand}`,
      dialyzerModel: 'FX80 High-Flux',
      baselineVolumeMl: 100.0,
    });
    dialyzerAId = dz.id;

    // Water Log A
    const wl = await renalSvc.createWaterTreatmentLog(TENANT_A, {
      branchId: BRANCH_A,
      logDate: '2026-10-25',
      testedBy: NURSE_A,
      carbonBreakthroughChlorinePpm: 0.02,
      roConductivityUs: 7.0,
      roRejectionRatePct: 99.0,
    });
    waterLogAId = wl.id;

    // Session A
    const sess = await renalSvc.createSession(TENANT_A, {
      patientId: patientAId,
      branchId: BRANCH_A,
      stationId: stationAId,
      machineId: machineAId,
      prescriptionId: prescriptionAId,
      accessId: accessAId,
      dialyzerId: dialyzerAId,
      scheduledDate: '2026-10-25',
      shiftId: shiftAId,
      primaryNurseId: NURSE_A,
    });
    sessionAId = sess.id;
  });

  afterAll(async () => {
    await ownerPool.end();
  });

  // ── 1. Tenant B Service Access Refusal ──────────────────────────────────────

  it('Tenant B cannot see Tenant A renal stations', async () => {
    const listB = await renalSvc.listStations(TENANT_B);
    const leaked = listB.find((s: any) => s.id === stationAId);
    expect(leaked).toBeUndefined();
  });

  it('Tenant B cannot see Tenant A dialysis machines', async () => {
    const listB = await renalSvc.listMachines(TENANT_B);
    const leaked = listB.find((m: any) => m.id === machineAId);
    expect(leaked).toBeUndefined();
  });

  it('Tenant B cannot see Tenant A vascular accesses', async () => {
    const listB = await renalSvc.listAccesses(TENANT_B, patientAId);
    expect(listB.length).toBe(0);
  });

  it('Tenant B cannot see Tenant A dialyzers', async () => {
    const listB = await renalSvc.listDialyzers(TENANT_B);
    const leaked = listB.find((d: any) => d.id === dialyzerAId);
    expect(leaked).toBeUndefined();
  });

  it('Tenant B cannot fetch Tenant A dialysis session', async () => {
    await expect(renalSvc.getSession(TENANT_B, sessionAId)).rejects.toThrow(ProblemException);
  });

  // ── 2. Forced RLS Table Leak Prevention (All 16 Renal Tables) ──────────────

  it('Direct SQL under Tenant B context returns 0 rows for all Tenant A renal records', async () => {
    await withTenant({ tenantId: TENANT_B }, async (tx) => {
      const qStation = await tx.query(`SELECT id FROM renal_stations WHERE id = $1`, [stationAId]);
      expect(qStation.rows.length).toBe(0);

      const qMachine = await tx.query(`SELECT id FROM dialysis_machines WHERE id = $1`, [machineAId]);
      expect(qMachine.rows.length).toBe(0);

      const qAccess = await tx.query(`SELECT id FROM vascular_accesses WHERE id = $1`, [accessAId]);
      expect(qAccess.rows.length).toBe(0);

      const qRx = await tx.query(`SELECT id FROM dialysis_prescriptions WHERE id = $1`, [prescriptionAId]);
      expect(qRx.rows.length).toBe(0);

      const qShift = await tx.query(`SELECT id FROM dialysis_shifts WHERE id = $1`, [shiftAId]);
      expect(qShift.rows.length).toBe(0);

      const qDz = await tx.query(`SELECT id FROM dialyzers WHERE id = $1`, [dialyzerAId]);
      expect(qDz.rows.length).toBe(0);

      const qWl = await tx.query(`SELECT id FROM water_treatment_logs WHERE id = $1`, [waterLogAId]);
      expect(qWl.rows.length).toBe(0);

      const qSess = await tx.query(`SELECT id FROM dialysis_sessions WHERE id = $1`, [sessionAId]);
      expect(qSess.rows.length).toBe(0);
    });
  });

  // ── 3. ModuleGuard Enforcement for "renal" ──────────────────────────────────

  it('ModuleGuard permits entitled tenant and blocks non-entitled tenant for "renal"', async () => {
    const reflector = new Reflector();
    const guard = new ModuleGuard(reflector);

    function mockCtx(tenantId: string): ExecutionContext {
      class TestController {}
      const handler = function handler() {};
      Reflect.defineMetadata('module', 'renal', handler);

      const req: Record<string, unknown> = {
        method: 'GET',
        authContext: {
          kind: 'user',
          userId: 'u1',
          tenantId,
          sessionId: 's1',
          branchId: null,
          amr: ['pwd'],
          scopes: [],
        },
      };

      return {
        getHandler: () => handler,
        getClass: () => TestController,
        switchToHttp: () => ({ getRequest: () => req }),
      } as unknown as ExecutionContext;
    }

    // Tenant A is entitled to "renal"
    const allowedA = await guard.canActivate(mockCtx(TENANT_A));
    expect(allowedA).toBe(true);

    // Tenant B is not entitled to "renal"
    await expect(guard.canActivate(mockCtx(TENANT_B))).rejects.toThrow();
  });
});
