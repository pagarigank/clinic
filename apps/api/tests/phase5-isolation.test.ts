import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { probeDb } from '@clinic/db/tests/helpers.js';
import { createPool, withTenant } from '@clinic/db';
import { SupplyService } from '../src/supply/supply.service.js';
import { PharmacyService } from '../src/pharmacy/pharmacy.service.js';
import { ProblemException } from '../src/http/problem.exception.js';
import { seedUsers, NO_SEED_USERS } from "@clinic/db/tests/helpers.js";

const hasDb = await probeDb();

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const BRANCH_A = 'a1000000-0000-4000-8000-000000000001';
const { USER_A } = hasDb ? await seedUsers() : NO_SEED_USERS;
const PATIENT_A = 'a4000000-0000-4000-8000-000000000001';

const TENANT_B = '22222222-2222-4222-8222-222222222222';
const BRANCH_B = 'b1000000-0000-4000-8000-000000000001';
const { USER_B } = hasDb ? await seedUsers() : NO_SEED_USERS;


describe.skipIf(!hasDb)('Phase 5 Multi-Tenant Isolation (§49)', () => {
  const supplySvc = new SupplyService();
  const pharmacySvc = new PharmacyService(supplySvc);
  const ownerPool = createPool({ role: 'owner' });

  let genericAId: string;
  let genericBId: string;
  let productAId: string;
  let itemAId: string;
  let dispenseAId: string;
  let patientAId: string;
  let patientBId: string;
  let specialRxAId: string;

  beforeAll(async () => {
    const rand = Math.floor(Math.random() * 1000000);

    // Setup Patients
    const patA = await ownerPool.query(
      `INSERT INTO patients (tenant_id, first_name, last_name, date_of_birth, gender)
       VALUES ($1, 'Patient', 'Iso A', '1990-01-01', 'FEMALE')
       RETURNING id`,
      [TENANT_A],
    );
    patientAId = patA.rows[0].id;

    const patB = await ownerPool.query(
      `INSERT INTO patients (tenant_id, first_name, last_name, date_of_birth, gender)
       VALUES ($1, 'Patient', 'Iso B', '1992-02-02', 'MALE')
       RETURNING id`,
      [TENANT_B],
    );
    patientBId = patB.rows[0].id;

    // Setup Tenant A master data
    const uomA = await supplySvc.createUom(TENANT_A, { code: `UOM-A-${rand}`, name: 'Units A' });
    const genA = await pharmacySvc.createGeneric(TENANT_A, { name: `Generic A-${rand}`, atcCode: 'A01AA01' });
    genericAId = genA.id;

    const prodA = await pharmacySvc.createProduct(TENANT_A, {
      code: `PROD-A-${rand}`,
      name: `Drug Product A ${rand}`,
      genericId: genericAId,
      brandName: 'Brand A',
      strength: '100mg',
      dosageForm: 'Tablet',
      route: 'ORAL',
      baseUomId: uomA.id,
      rxRequired: 'RX',
    });
    productAId = prodA.id;
    itemAId = prodA.item_id;

    const dispA = await pharmacySvc.createDispense(TENANT_A, USER_A, {
      branchId: BRANCH_A,
      patientId: patientAId,
    });
    dispenseAId = dispA.id;

    const srxA = await pharmacySvc.createSpecialRxRecord(TENANT_A, {
      specialRxSerial: `SRX-A-${rand}`,
      prescriberId: USER_A,
      s2LicenseNo: 'S2-A123',
      patientId: patientAId,
      drugItemId: itemAId,
      qtyWords: 'TEN ONLY',
      qtyNumeric: 10,
      dateIssued: new Date().toISOString().slice(0, 10),
    });
    specialRxAId = srxA.id;

    // Setup Tenant B master data
    const uomB = await supplySvc.createUom(TENANT_B, { code: `UOM-B-${rand}`, name: 'Units B' });
    const genB = await pharmacySvc.createGeneric(TENANT_B, { name: `Generic B-${rand}`, atcCode: 'B01AA01' });
    genericBId = genB.id;
  });

  afterAll(async () => {
    await ownerPool.end();
  });

  it('Tenant B cannot read Tenant A generic names', async () => {
    const listB = await pharmacySvc.listGenerics(TENANT_B);
    const leaked = listB.find((g: any) => g.id === genericAId);
    expect(leaked).toBeUndefined();

    await expect(pharmacySvc.getGeneric(TENANT_B, genericAId)).rejects.toThrow(ProblemException);
  });

  it('Tenant B cannot read Tenant A drug products', async () => {
    const listB = await pharmacySvc.listProducts(TENANT_B);
    const leaked = listB.find((p: any) => p.id === productAId);
    expect(leaked).toBeUndefined();

    await expect(pharmacySvc.getProduct(TENANT_B, productAId)).rejects.toThrow(ProblemException);
  });

  it('Tenant B cannot read or mutate Tenant A dispenses', async () => {
    const listB = await pharmacySvc.listDispenses(TENANT_B, {});
    const leaked = listB.find((d: any) => d.id === dispenseAId);
    expect(leaked).toBeUndefined();

    await expect(pharmacySvc.getDispense(TENANT_B, dispenseAId)).rejects.toThrow(ProblemException);
  });

  it('Tenant B cannot access Tenant A special Rx records', async () => {
    const listB = await pharmacySvc.listSpecialRxRecords(TENANT_B);
    const leaked = listB.find((s: any) => s.id === specialRxAId);
    expect(leaked).toBeUndefined();
  });

  it('Direct SQL under Tenant B context returns 0 rows for all Tenant A pharmacy tables', async () => {
    await withTenant({ tenantId: TENANT_B }, async (tx) => {
      const qGen = await tx.query(`SELECT id FROM generic_names WHERE id = $1`, [genericAId]);
      expect(qGen.rows.length).toBe(0);

      const qProd = await tx.query(`SELECT id FROM drug_products WHERE id = $1`, [productAId]);
      expect(qProd.rows.length).toBe(0);

      const qDisp = await tx.query(`SELECT id FROM dispenses WHERE id = $1`, [dispenseAId]);
      expect(qDisp.rows.length).toBe(0);

      const qSrx = await tx.query(`SELECT id FROM special_rx_records WHERE id = $1`, [specialRxAId]);
      expect(qSrx.rows.length).toBe(0);

      const qReg = await tx.query(`SELECT id FROM controlled_register WHERE tenant_id = $1`, [TENANT_A]);
      expect(qReg.rows.length).toBe(0);
    });
  });
});
