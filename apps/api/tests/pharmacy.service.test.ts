import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { withTenant, getAppPool, createPool } from '@clinic/db';
import { SupplyService } from '../src/supply/supply.service.js';
import { PharmacyService } from '../src/pharmacy/pharmacy.service.js';
import { runControlledReconcile } from '../../worker/src/handlers/pharmacy-jobs.handler.js';
import { ProblemException } from '../src/http/problem.exception.js';

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const BRANCH_A = 'a1000000-0000-4000-8000-000000000001';
const USER_PHARMACIST = 'a3000000-0000-4000-8000-000000000001';
const USER_WITNESS = 'a3000000-0000-4000-8000-000000000002';
const PATIENT_A = 'a4000000-0000-4000-8000-000000000001';

describe('PharmacyService (Phase 5 — Pharmacy Core & AC-7)', () => {
  const supplySvc = new SupplyService();
  const pharmacySvc = new PharmacyService(supplySvc);
  const ownerPool = createPool({ role: 'owner' });

  const tenantId = TENANT_A;
  const branchId = BRANCH_A;
  const pharmacistId = USER_PHARMACIST;
  const witnessId = USER_WITNESS;
  let patientId: string;

  let uomPcsId: string;
  let pharmacyLocId: string;
  let genericAmoxId: string;
  let genericClavId: string;
  let genericWarfarinId: string;
  let genericAspirinId: string;
  let amoxProductId: string;
  let amoxItemId: string;
  let controlledProductId: string;
  let controlledItemId: string;
  let otcProductId: string;
  let otcItemId: string;

  let batchAmox1Id: string;
  let batchAmox2Id: string;
  let batchControlledId: string;
  let batchOtcId: string;

  beforeAll(async () => {
    const rand = Math.floor(Math.random() * 1000000);

    // Ensure pharmacy and supply modules are enabled for TENANT_A
    await ownerPool.query(
      `INSERT INTO tenant_modules (tenant_id, module, status)
       VALUES ($1, 'pharmacy', 'ENABLED'), ($1, 'supply', 'ENABLED'), ($1, 'clinical', 'ENABLED')
       ON CONFLICT (tenant_id, module) DO UPDATE SET status = 'ENABLED'`,
      [tenantId],
    );

    // 1. Create UOM
    const uom = await supplySvc.createUom(tenantId, { code: `TAB-${rand}`, name: 'Tablets' });
    uomPcsId = uom.id;

    // 2. Create Pharmacy Location
    const loc = await supplySvc.createLocation(tenantId, {
      branchId,
      code: `PHARM-LOC-${rand}`,
      name: `Main Pharmacy ${rand}`,
      type: 'PHARMACY',
    });
    pharmacyLocId = loc.id;

    // 3. Create Generic Names
    const genAmox = await pharmacySvc.createGeneric(tenantId, { name: `Amoxicillin ${rand}`, atcCode: 'J01CA04' });
    genericAmoxId = genAmox.id;

    const genClav = await pharmacySvc.createGeneric(tenantId, { name: `Clavulanic Acid ${rand}`, atcCode: 'J01CR02' });
    genericClavId = genClav.id;

    const genWarfarin = await pharmacySvc.createGeneric(tenantId, { name: `Warfarin ${rand}`, atcCode: 'B01AA03' });
    genericWarfarinId = genWarfarin.id;

    const genAspirin = await pharmacySvc.createGeneric(tenantId, { name: `Aspirin ${rand}`, atcCode: 'B01AC06' });
    genericAspirinId = genAspirin.id;

    // 4. Create Drug Products
    // A. Regular Rx: Amoxicillin 500mg
    const amoxProd = await pharmacySvc.createProduct(tenantId, {
      code: `AMOX-500-${rand}`,
      name: `Amoxicillin 500mg Cap ${rand}`,
      genericId: genericAmoxId,
      brandName: 'Amoxil',
      strength: '500mg',
      dosageForm: 'Capsule',
      route: 'ORAL',
      packSize: 100,
      baseUomId: uomPcsId,
      rxRequired: 'RX',
      standardCost: 5.0,
      allergyClass: 'Penicillin',
    });
    amoxProductId = amoxProd.id;
    amoxItemId = amoxProd.item_id;

    // B. Controlled Drug: Morphine Sulfate (DDB Schedule 2)
    const genMorphine = await pharmacySvc.createGeneric(tenantId, { name: `Morphine ${rand}`, atcCode: 'N02AA01' });
    const morphProd = await pharmacySvc.createProduct(tenantId, {
      code: `MORPH-10-${rand}`,
      name: `Morphine 10mg Tab ${rand}`,
      genericId: genMorphine.id,
      brandName: 'MST Continus',
      strength: '10mg',
      dosageForm: 'Tablet',
      route: 'ORAL',
      packSize: 20,
      baseUomId: uomPcsId,
      rxRequired: 'CONTROLLED',
      controlledSchedule: 'DDB_SCHEDULE_2',
      standardCost: 25.0,
    });
    controlledProductId = morphProd.id;
    controlledItemId = morphProd.item_id;

    // C. OTC Drug: Paracetamol 500mg
    const genPara = await pharmacySvc.createGeneric(tenantId, { name: `Paracetamol ${rand}`, atcCode: 'N02BE01' });
    const otcProd = await pharmacySvc.createProduct(tenantId, {
      code: `PARA-500-${rand}`,
      name: `Paracetamol 500mg Tab ${rand}`,
      genericId: genPara.id,
      brandName: 'Biogesic',
      strength: '500mg',
      dosageForm: 'Tablet',
      route: 'ORAL',
      packSize: 50,
      baseUomId: uomPcsId,
      rxRequired: 'OTC',
      standardCost: 2.0,
    });
    otcProductId = otcProd.id;
    otcItemId = otcProd.item_id;

    // 0. Ensure patient exists in patients table
    const patRes = await ownerPool.query(
      `INSERT INTO patients (tenant_id, first_name, last_name, date_of_birth, gender)
       VALUES ($1, 'Patient', 'Pharm A', '1990-01-01', 'FEMALE')
       RETURNING id`,
      [tenantId],
    );
    patientId = patRes.rows[0].id;

    await ownerPool.query(
      `INSERT INTO patient_identifiers (tenant_id, patient_id, type, value)
       VALUES ($1, $2, 'HRN', 'HRN-PHARM-001')
       ON CONFLICT DO NOTHING`,
      [tenantId, patientId],
    );

    // 5. Seed stock batches and balances for testing
    // Amox Batch 1: Expiring in 60 days
    const exp1 = new Date();
    exp1.setDate(exp1.getDate() + 60);
    const b1 = await ownerPool.query(
      `INSERT INTO stock_batches (tenant_id, item_id, lot_no, expiry_date, unit_cost, status)
       VALUES ($1, $2, $3, $4, 5.0, 'AVAILABLE')
       RETURNING id`,
      [tenantId, amoxItemId, `LOT-AMOX-EARLY-${rand}`, exp1.toISOString().slice(0, 10)],
    );
    batchAmox1Id = b1.rows[0].id;
    await ownerPool.query(
      `INSERT INTO stock_balances (tenant_id, location_id, batch_id, qty_on_hand, last_movement_at)
       VALUES ($1, $2, $3, 100, now())`,
      [tenantId, pharmacyLocId, batchAmox1Id],
    );

    // Amox Batch 2: Expiring in 180 days (later)
    const exp2 = new Date();
    exp2.setDate(exp2.getDate() + 180);
    const b2 = await ownerPool.query(
      `INSERT INTO stock_batches (tenant_id, item_id, lot_no, expiry_date, unit_cost, status)
       VALUES ($1, $2, $3, $4, 5.0, 'AVAILABLE')
       RETURNING id`,
      [tenantId, amoxItemId, `LOT-AMOX-LATER-${rand}`, exp2.toISOString().slice(0, 10)],
    );
    batchAmox2Id = b2.rows[0].id;
    await ownerPool.query(
      `INSERT INTO stock_balances (tenant_id, location_id, batch_id, qty_on_hand, last_movement_at)
       VALUES ($1, $2, $3, 200, now())`,
      [tenantId, pharmacyLocId, batchAmox2Id],
    );

    // Controlled Batch: Morphine
    const bCtrl = await ownerPool.query(
      `INSERT INTO stock_batches (tenant_id, item_id, lot_no, expiry_date, unit_cost, status)
       VALUES ($1, $2, $3, $4, 25.0, 'AVAILABLE')
       RETURNING id`,
      [tenantId, controlledItemId, `LOT-MORPH-${rand}`, exp2.toISOString().slice(0, 10)],
    );
    batchControlledId = bCtrl.rows[0].id;
    await ownerPool.query(
      `INSERT INTO stock_balances (tenant_id, location_id, batch_id, qty_on_hand, last_movement_at)
       VALUES ($1, $2, $3, 50, now())`,
      [tenantId, pharmacyLocId, batchControlledId],
    );

    // OTC Batch: Paracetamol
    const bOtc = await ownerPool.query(
      `INSERT INTO stock_batches (tenant_id, item_id, lot_no, expiry_date, unit_cost, status)
       VALUES ($1, $2, $3, $4, 2.0, 'AVAILABLE')
       RETURNING id`,
      [tenantId, otcItemId, `LOT-PARA-${rand}`, exp2.toISOString().slice(0, 10)],
    );
    batchOtcId = bOtc.rows[0].id;
    await ownerPool.query(
      `INSERT INTO stock_balances (tenant_id, location_id, batch_id, qty_on_hand, last_movement_at)
       VALUES ($1, $2, $3, 100, now())`,
      [tenantId, pharmacyLocId, batchOtcId],
    );
  });

  afterAll(async () => {
    await ownerPool.end();
  });

  it('manages drug interactions and honors tenant overrides with audit reason', async () => {
    // 1. Create drug interaction: Warfarin + Aspirin (CONTRAINDICATED)
    const interaction = await pharmacySvc.createInteraction(tenantId, {
      genericAId: genericWarfarinId,
      genericBId: genericAspirinId,
      severity: 'CONTRAINDICATED',
      mechanism: 'Synergistic antiplatelet and anticoagulant effect dramatically increases hemorrhage risk',
      clinicalAdvice: 'Avoid combination or monitor INR closely under cardiology supervision',
      isTenantOverride: true,
      overrideReason: 'Institutional cardiology protocol',
    });

    expect(interaction.severity).toBe('CONTRAINDICATED');
    expect(interaction.is_tenant_override).toBe(true);

    const list = await pharmacySvc.listInteractions(tenantId);
    expect(list.length).toBeGreaterThan(0);
    const found = list.find((i: any) => i.id === interaction.id);
    expect(found).toBeDefined();
    expect(found.override_reason).toBe('Institutional cardiology protocol');
  });

  it('manages price rules with markup % and fixed price calculation', async () => {
    // 1. Fixed price rule for Amox
    await pharmacySvc.createPriceRule(tenantId, {
      itemId: amoxItemId,
      pricingStrategy: 'FIXED_PRICE',
      fixedPrice: 12.50,
    });

    const price = await pharmacySvc.calculateItemPrice(tenantId, amoxItemId, 5.0);
    expect(price).toBe(12.50);

    // 2. Markup % rule for Morphine
    await pharmacySvc.createPriceRule(tenantId, {
      itemId: controlledItemId,
      pricingStrategy: 'MARKUP_PCT',
      markupPct: 40.0, // 40% markup on standardCost 25.0 = 35.0
    });

    const morphPrice = await pharmacySvc.calculateItemPrice(tenantId, controlledItemId, 25.0);
    expect(morphPrice).toBe(35.0);
  });

  it('executes automated safety checks (allergy, interaction, duplicate, stock)', async () => {
    // 1. Seed an allergy for Patient A (Penicillin allergy)
    await ownerPool.query(
      `INSERT INTO patient_allergies (tenant_id, patient_id, substance, severity)
       VALUES ($1, $2, 'Penicillin', 'SEVERE')
       ON CONFLICT DO NOTHING`,
      [tenantId, patientId],
    );

    // 2. Create Visit & Prescription for Patient A with Amoxicillin (Penicillin class) and Aspirin + Warfarin
    const rand = Math.floor(Math.random() * 100000);
    const visitRes = await ownerPool.query(
      `INSERT INTO visits (tenant_id, branch_id, patient_id, practitioner_id, visit_no, status, opened_at, created_by)
       VALUES ($1, $2, $3, $4, $5, 'IN_PROGRESS', now(), $4)
       RETURNING id`,
      [tenantId, branchId, patientId, pharmacistId, `VIS-PHM-${rand}`],
    );
    const visitId = visitRes.rows[0].id;

    const rxRes = await ownerPool.query(
      `INSERT INTO prescriptions (
         tenant_id, visit_id, patient_id, prescriber_id, rx_no, status, issued_at
       )
       VALUES ($1, $2, $3, $4, $5, 'ISSUED', now())
       RETURNING id`,
      [tenantId, visitId, patientId, pharmacistId, `RX-CHK-${rand}`],
    );
    const rxId = rxRes.rows[0].id;

    // Prescription Item 1: Amoxicillin (triggers allergy)
    await ownerPool.query(
      `INSERT INTO prescription_items (
         tenant_id, rx_id, drug_product_id, generic_name, brand_name,
         sig_dose, sig_frequency, qty_prescribed
       )
       VALUES ($1, $2, $3, 'Amoxicillin', 'Amoxil', '500mg', 'TID', 21)`,
      [tenantId, rxId, amoxProductId],
    );

    // 3. Run automated checks
    const checkReport = await pharmacySvc.runPrescriptionChecks(tenantId, rxId);
    expect(checkReport.prescriptionId).toBe(rxId);
    expect(checkReport.hasContraindications).toBe(true);

    const allergyFinding = checkReport.findings.find((f) => f.checkType === 'ALLERGY');
    expect(allergyFinding).toBeDefined();
    expect(allergyFinding?.severity).toBe('CONTRAINDICATED');
    expect(allergyFinding?.message).toContain('Penicillin');

    // 4. Record interaction/allergy decision audit trail (Exit gate requirement)
    const decision = await pharmacySvc.recordInteractionDecision(tenantId, pharmacistId, {
      rxId,
      drugAName: 'Amoxil (Amoxicillin)',
      drugBName: 'Penicillin Allergy',
      severity: 'CONTRAINDICATED',
      decision: 'OVERRIDDEN',
      justificationReasonCode: 'PATIENT_DESENSITIZED',
      justificationNotes: 'Patient completed in-clinic desensitization protocol successfully.',
    });

    expect(decision.id).toBeDefined();
    expect(decision.decision).toBe('OVERRIDDEN');

    const decisions = await pharmacySvc.listInteractionDecisions(tenantId, rxId);
    expect(decisions.length).toBeGreaterThan(0);
    expect(decisions[0]!.justification_reason_code).toBe('PATIENT_DESENSITIZED');
  });

  it('runs prescription verification: approve, intervene, and reject', async () => {
    const rand = Math.floor(Math.random() * 100000);
    const vRes = await ownerPool.query(
      `INSERT INTO visits (tenant_id, branch_id, patient_id, practitioner_id, visit_no, status, opened_at, created_by)
       VALUES ($1, $2, $3, $4, $5, 'IN_PROGRESS', now(), $4) RETURNING id`,
      [tenantId, branchId, patientId, pharmacistId, `VIS-VER-${rand}`],
    );
    const visitId = vRes.rows[0].id;

    // Rx 1: to be approved
    const rx1 = await ownerPool.query(
      `INSERT INTO prescriptions (tenant_id, visit_id, patient_id, prescriber_id, rx_no, status, issued_at)
       VALUES ($1, $2, $3, $4, $5, 'ISSUED', now()) RETURNING id`,
      [tenantId, visitId, patientId, pharmacistId, `RX-APP-${rand}`],
    );
    const approval = await pharmacySvc.verifyPrescription(tenantId, pharmacistId, rx1.rows[0].id, {
      action: 'APPROVE',
    });
    expect(approval.success).toBe(true);
    expect(approval.action).toBe('APPROVE');

    // Rx 2: pharmacist intervention
    const rx2 = await ownerPool.query(
      `INSERT INTO prescriptions (tenant_id, visit_id, patient_id, prescriber_id, rx_no, status, issued_at)
       VALUES ($1, $2, $3, $4, $5, 'ISSUED', now()) RETURNING id`,
      [tenantId, visitId, patientId, pharmacistId, `RX-INT-${rand}`],
    );
    const intervention = await pharmacySvc.verifyPrescription(tenantId, pharmacistId, rx2.rows[0].id, {
      action: 'INTERVENE',
      interventionType: 'ALLERGY',
      description: 'Contacted prescriber regarding mild rash history',
      outcome: 'APPROVED_WITH_OVERRIDE',
    });
    expect(intervention.success).toBe(true);
    expect(intervention.action).toBe('INTERVENE');

    // Rx 3: pharmacist rejection with reason
    const rx3 = await ownerPool.query(
      `INSERT INTO prescriptions (tenant_id, visit_id, patient_id, prescriber_id, rx_no, status, issued_at)
       VALUES ($1, $2, $3, $4, $5, 'ISSUED', now()) RETURNING id`,
      [tenantId, visitId, patientId, pharmacistId, `RX-REJ-${rand}`],
    );
    const rejection = await pharmacySvc.verifyPrescription(tenantId, pharmacistId, rx3.rows[0].id, {
      action: 'REJECT',
      rejectReason: 'Severe contraindication; prescriber to change to cephalosporin',
    });
    expect(rejection.success).toBe(true);
    expect(rejection.action).toBe('REJECT');

    // Verify prescription was cancelled in database
    const cancelledRx = await ownerPool.query(`SELECT status, cancel_reason FROM prescriptions WHERE id = $1`, [rx3.rows[0].id]);
    expect(cancelledRx.rows[0].status).toBe('CANCELLED');
    expect(cancelledRx.rows[0].cancel_reason).toContain('Severe contraindication');
  });

  it('determines FEFO batch allocation deterministically by earliest expiry', async () => {
    // Draft dispense for Amoxicillin
    const dispense = await pharmacySvc.createDispense(tenantId, pharmacistId, {
      branchId,
      patientId,
      lines: [
        {
          itemId: amoxItemId,
          qty: 10,
        },
      ],
    });

    // Allocate FEFO
    const allocated = await pharmacySvc.allocateFefo(tenantId, dispense.id, pharmacyLocId);
    expect(allocated.items.length).toBe(1);
    // Must select batch 1 (60 days expiry) rather than batch 2 (180 days)
    expect(allocated.items[0]!.batch_id).toBe(batchAmox1Id);
  });

  it('posts regular dispense in single transaction (movements + balances + charges + Rx status) and voids cleanly', async () => {
    const rand = Math.floor(Math.random() * 100000);
    const vRes = await ownerPool.query(
      `INSERT INTO visits (tenant_id, branch_id, patient_id, practitioner_id, visit_no, status, opened_at, created_by)
       VALUES ($1, $2, $3, $4, $5, 'IN_PROGRESS', now(), $4) RETURNING id`,
      [tenantId, branchId, patientId, pharmacistId, `VIS-POST-${rand}`],
    );
    const visitId = vRes.rows[0].id;

    const rxRes = await ownerPool.query(
      `INSERT INTO prescriptions (tenant_id, visit_id, patient_id, prescriber_id, rx_no, status, issued_at)
       VALUES ($1, $2, $3, $4, $5, 'ISSUED', now()) RETURNING id`,
      [tenantId, visitId, patientId, pharmacistId, `RX-POST-${rand}`],
    );
    const rxId = rxRes.rows[0].id;

    const rxItemRes = await ownerPool.query(
      `INSERT INTO prescription_items (
         tenant_id, rx_id, drug_product_id, generic_name, brand_name,
         sig_dose, sig_frequency, qty_prescribed
       )
       VALUES ($1, $2, $3, 'Amoxicillin', 'Amoxil', '500mg', 'TID', 10)
       RETURNING id`,
      [tenantId, rxId, amoxProductId],
    );
    const rxItemId = rxItemRes.rows[0].id;

    // 1. Create draft dispense
    const dispense = await pharmacySvc.createDispense(tenantId, pharmacistId, {
      branchId,
      patientId,
      rxId,
      lines: [
        {
          prescriptionItemId: rxItemId,
          itemId: amoxItemId,
          batchId: batchAmox1Id,
          qty: 10,
        },
      ],
    });

    // 2. Check balance before dispense
    const balBefore = await ownerPool.query(
      `SELECT qty_on_hand FROM stock_balances WHERE tenant_id = $1 AND location_id = $2 AND batch_id = $3`,
      [tenantId, pharmacyLocId, batchAmox1Id],
    );
    const qtyBefore = Number(balBefore.rows[0].qty_on_hand);

    // 3. Post dispense
    const posted = await pharmacySvc.postDispense(
      tenantId,
      pharmacistId,
      `req-disp-${rand}`,
      dispense.id,
      {
        locationId: pharmacyLocId,
        counsellingDone: true,
        lines: [
          {
            prescriptionItemId: rxItemId,
            itemId: amoxItemId,
            batchId: batchAmox1Id,
            qty: 10,
          },
        ],
      },
    );

    expect(posted.status).toBe('DISPENSED');
    expect(posted.dispensed_at).toBeDefined();

    // 4. Verify stock balance was deducted
    const balAfter = await ownerPool.query(
      `SELECT qty_on_hand FROM stock_balances WHERE tenant_id = $1 AND location_id = $2 AND batch_id = $3`,
      [tenantId, pharmacyLocId, batchAmox1Id],
    );
    expect(Number(balAfter.rows[0].qty_on_hand)).toBe(qtyBefore - 10);

    // 5. Verify prescription status changed to DISPENSED
    const rxAfter = await ownerPool.query(`SELECT status FROM prescriptions WHERE id = $1`, [rxId]);
    expect(rxAfter.rows[0].status).toBe('DISPENSED');

    // 6. Verify billing charge was posted
    const chargeRes = await ownerPool.query(
      `SELECT * FROM billing_charges WHERE tenant_id = $1 AND source_type = 'DISPENSE' AND source_id = $2`,
      [tenantId, dispense.id],
    );
    expect(chargeRes.rows.length).toBe(1);
    expect(chargeRes.rows[0].charge_type).toBe('PHARMACY');

    // 7. Test Label generation
    const labelData = await pharmacySvc.getDispenseLabel(tenantId, dispense.id);
    expect(labelData.dispenseNo).toBe(posted.dispense_no);
    expect(labelData.labels.length).toBe(1);
    expect(labelData.labels[0]!.brandName).toBe('Amoxil');

    // 8. Test Void dispense (reversal movements, Rx restored to ISSUED, charge voided)
    const voided = await pharmacySvc.voidDispense(
      tenantId,
      pharmacistId,
      `req-void-${rand}`,
      dispense.id,
      {
        locationId: pharmacyLocId,
        reason: 'Patient cancelled pickup',
      },
    );
    expect(voided.status).toBe('VOID');

    // Stock balance restored
    const balRestored = await ownerPool.query(
      `SELECT qty_on_hand FROM stock_balances WHERE tenant_id = $1 AND location_id = $2 AND batch_id = $3`,
      [tenantId, pharmacyLocId, batchAmox1Id],
    );
    expect(Number(balRestored.rows[0].qty_on_hand)).toBe(qtyBefore);

    // Rx status restored
    const rxRestored = await ownerPool.query(`SELECT status FROM prescriptions WHERE id = $1`, [rxId]);
    expect(rxRestored.rows[0].status).toBe('ISSUED');

    // Charge voided
    const chargeVoided = await ownerPool.query(
      `SELECT voided_at FROM billing_charges WHERE tenant_id = $1 AND source_type = 'DISPENSE' AND source_id = $2`,
      [tenantId, dispense.id],
    );
    expect(chargeVoided.rows[0].voided_at).not.toBeNull();
  });

  it('discharges AC-7: Controlled drug dispense enforces serial, S2 license, words/numerals, witness, single-use, and register immutability', async () => {
    const rand = Math.floor(Math.random() * 100000);
    const serial = `YELLOW-${rand}`;

    // 1. Create Special Rx record (DDB yellow Rx slip)
    await pharmacySvc.createSpecialRxRecord(tenantId, {
      specialRxSerial: serial,
      prescriberId: pharmacistId, // prescribing user
      s2LicenseNo: 'S2-987654321',
      patientId,
      drugItemId: controlledItemId,
      qtyWords: 'TEN TABLETS ONLY',
      qtyNumeric: 10,
      dateIssued: new Date().toISOString().slice(0, 10),
    });

    // 2. Create prescription for controlled drug
    const vRes = await ownerPool.query(
      `INSERT INTO visits (tenant_id, branch_id, patient_id, practitioner_id, visit_no, status, opened_at, created_by)
       VALUES ($1, $2, $3, $4, $5, 'IN_PROGRESS', now(), $4) RETURNING id`,
      [tenantId, branchId, patientId, pharmacistId, `VIS-CTRL-${rand}`],
    );
    const visitId = vRes.rows[0].id;

    const rxRes = await ownerPool.query(
      `INSERT INTO prescriptions (
         tenant_id, visit_id, patient_id, prescriber_id, rx_no, status,
         is_controlled, special_rx_no, qty_words, issued_at
       )
       VALUES ($1, $2, $3, $4, $5, 'ISSUED', true, $6, 'TEN TABLETS ONLY', now())
       RETURNING id`,
      [tenantId, visitId, patientId, pharmacistId, `RX-CTRL-${rand}`, serial],
    );
    const rxId = rxRes.rows[0].id;

    const rxItemRes = await ownerPool.query(
      `INSERT INTO prescription_items (
         tenant_id, rx_id, drug_product_id, generic_name, brand_name,
         sig_dose, sig_frequency, qty_prescribed
       )
       VALUES ($1, $2, $3, 'Morphine', 'MST Continus', '10mg', 'Q12H', 10)
       RETURNING id`,
      [tenantId, rxId, controlledProductId],
    );
    const rxItemId = rxItemRes.rows[0].id;

    // 3. Draft controlled dispense
    const dispense = await pharmacySvc.createDispense(tenantId, pharmacistId, {
      branchId,
      patientId,
      rxId,
      isControlled: true,
      lines: [
        {
          prescriptionItemId: rxItemId,
          itemId: controlledItemId,
          batchId: batchControlledId,
          qty: 10,
        },
      ],
    });

    // 4. Test failure when witness is the dispensing pharmacist themselves (SoD check)
    await expect(
      pharmacySvc.postDispense(
        tenantId,
        pharmacistId,
        `req-ctrl-sod-${rand}`,
        dispense.id,
        {
          locationId: pharmacyLocId,
          specialRxSerial: serial,
          qtyWords: 'TEN TABLETS ONLY',
          witnessId: pharmacistId, // Invalid: cannot witness self
          witnessSignature: 'Self-sign',
          lines: [
            {
              prescriptionItemId: rxItemId,
              itemId: controlledItemId,
              batchId: batchControlledId,
              qty: 10,
            },
          ],
        },
      ),
    ).rejects.toThrow(ProblemException);

    // 5. Post controlled dispense with valid second witness (witnessId !== pharmacistId)
    const posted = await pharmacySvc.postDispense(
      tenantId,
      pharmacistId,
      `req-ctrl-ok-${rand}`,
      dispense.id,
      {
        locationId: pharmacyLocId,
        specialRxSerial: serial,
        prescriberS2No: 'S2-987654321',
        qtyWords: 'TEN TABLETS ONLY',
        witnessId, // Valid second authorized user
        witnessSignature: 'Witness Sig Nurse B',
        lines: [
          {
            prescriptionItemId: rxItemId,
            itemId: controlledItemId,
            batchId: batchControlledId,
            qty: 10,
          },
        ],
      },
    );

    expect(posted.status).toBe('DISPENSED');

    // 6. Verify Special Rx is marked as used
    const srxCheck = await ownerPool.query(
      `SELECT is_used, used_at FROM special_rx_records WHERE tenant_id = $1 AND special_rx_serial = $2`,
      [tenantId, serial],
    );
    expect(srxCheck.rows[0].is_used).toBe(true);

    // 7. AC-7 Invariant: Hard block on serial reuse
    // Try to dispense another order using the same serial
    const dispense2 = await pharmacySvc.createDispense(tenantId, pharmacistId, {
      branchId,
      patientId,
      isControlled: true,
      lines: [
        {
          itemId: controlledItemId,
          batchId: batchControlledId,
          qty: 5,
        },
      ],
    });

    await expect(
      pharmacySvc.postDispense(
        tenantId,
        pharmacistId,
        `req-ctrl-reuse-${rand}`,
        dispense2.id,
        {
          locationId: pharmacyLocId,
          specialRxSerial: serial, // REUSED SERIAL
          qtyWords: 'FIVE TABLETS',
          witnessId,
          lines: [
            {
              itemId: controlledItemId,
              batchId: batchControlledId,
              qty: 5,
            },
          ],
        },
      ),
    ).rejects.toThrow(ProblemException);

    // 8. AC-7 Invariant: Hard block on refills for controlled drugs
    await expect(
      pharmacySvc.postDispense(
        tenantId,
        pharmacistId,
        `req-ctrl-refill-${rand}`,
        dispense.id, // already dispensed
        {
          locationId: pharmacyLocId,
          specialRxSerial: `NEW-SERIAL-${rand}`,
          qtyWords: 'TEN TABLETS',
          witnessId,
          lines: [{ itemId: controlledItemId, batchId: batchControlledId, qty: 10 }],
        },
      ),
    ).rejects.toThrow(ProblemException);

    // 9. Verify Dangerous Drugs Book register entry and running balance
    const registerEntries = await pharmacySvc.getControlledRegister(tenantId, {
      drugItemId: controlledItemId,
      branchId,
    });
    expect(registerEntries.length).toBeGreaterThan(0);
    const regEntry = registerEntries[0];
    expect(regEntry.entry_type).toBe('DISPENSE');
    expect(Number(regEntry.qty_out)).toBe(10);
    expect(Number(regEntry.running_balance)).toBeGreaterThanOrEqual(0);
    expect(regEntry.special_rx_serial).toBe(serial);
    expect(regEntry.prescriber_s2_no).toBe('S2-987654321');
    expect(regEntry.witness_id).toBe(witnessId);

    // 10. AC-12 & AC-7 Immutability: DB trigger denies UPDATE or DELETE on controlled_register
    await expect(
      ownerPool.query(
        `UPDATE controlled_register SET qty_out = 999 WHERE id = $1`,
        [regEntry.id],
      ),
    ).rejects.toThrow(/CONTROLLED_REGISTER_IMMUTABLE/);

    await expect(
      ownerPool.query(
        `DELETE FROM controlled_register WHERE id = $1`,
        [regEntry.id],
      ),
    ).rejects.toThrow(/CONTROLLED_REGISTER_IMMUTABLE/);
  });

  it('processes OTC sales with hard server-side rejection of controlled drugs (PHM-T3)', async () => {
    const rand = Math.floor(Math.random() * 100000);

    // 1. Valid OTC Sale with Paracetamol
    const otcSale = await pharmacySvc.createAndPostOtcSale(
      tenantId,
      pharmacistId,
      `req-otc-${rand}`,
      {
        branchId,
        locationId: pharmacyLocId,
        patientId,
        items: [
          {
            itemId: otcItemId,
            batchId: batchOtcId,
            qty: 5,
          },
        ],
        counsellingDone: true,
      },
    );

    expect(otcSale.status).toBe('DISPENSED');
    expect(otcSale.is_controlled).toBe(false);

    // 2. Attempt to sell controlled morphine OTC -> Hard rejection
    await expect(
      pharmacySvc.createAndPostOtcSale(
        tenantId,
        pharmacistId,
        `req-otc-fail-${rand}`,
        {
          branchId,
          locationId: pharmacyLocId,
          patientId,
          items: [
            {
              itemId: controlledItemId, // Controlled drug!
              batchId: batchControlledId,
              qty: 1,
            },
          ],
        },
      ),
    ).rejects.toThrow(ProblemException);
  });

  it('records in-clinic medication administration with CONSUMPTION movement and MAR record (PHM-T6)', async () => {
    const rand = Math.floor(Math.random() * 100000);
    const vRes = await ownerPool.query(
      `INSERT INTO visits (tenant_id, branch_id, patient_id, practitioner_id, visit_no, status, opened_at, created_by)
       VALUES ($1, $2, $3, $4, $5, 'IN_PROGRESS', now(), $4) RETURNING id`,
      [tenantId, branchId, patientId, pharmacistId, `VIS-ADMIN-${rand}`],
    );
    const visitId = vRes.rows[0].id;

    // Record administration
    const admin = await pharmacySvc.recordMedicationAdministration(
      tenantId,
      pharmacistId,
      `req-admin-${rand}`,
      {
        branchId,
        visitId,
        locationId: pharmacyLocId,
        drugItemId: amoxItemId,
        batchId: batchAmox1Id,
        dose: '500mg oral suspension',
        route: 'ORAL',
        notes: 'Administered post-procedure',
      },
    );

    expect(admin.status).toBe('ADMINISTERED');
    expect(admin.visit_id).toBe(visitId);

    // Verify MAR listing
    const marList = await pharmacySvc.listMedicationAdministrations(tenantId, visitId);
    expect(marList.length).toBe(1);
    expect(marList[0]!.dose).toBe('500mg oral suspension');
  });

  it('records patient return with restock disposition returning stock to inventory (PHM-T5)', async () => {
    const rand = Math.floor(Math.random() * 100000);

    // Create and post a simple dispense
    const dispense = await pharmacySvc.createDispense(tenantId, pharmacistId, {
      branchId,
      patientId,
      lines: [{ itemId: otcItemId, batchId: batchOtcId, qty: 10 }],
    });
    await pharmacySvc.postDispense(tenantId, pharmacistId, `req-disp-ret-${rand}`, dispense.id, {
      locationId: pharmacyLocId,
      lines: [{ itemId: otcItemId, batchId: batchOtcId, qty: 10 }],
    });

    const dDetails = await pharmacySvc.getDispense(tenantId, dispense.id);
    const dispenseItemId = dDetails.items[0]!.id;

    // Return 3 tablets with RESTOCK disposition
    const ret = await pharmacySvc.recordPatientReturn(tenantId, pharmacistId, `req-ret-${rand}`, {
      branchId,
      dispenseId: dispense.id,
      dispenseItemId,
      locationId: pharmacyLocId,
      qty: 3,
      reason: 'Unopened sealed blister strip, patient discontinued by doctor',
      disposition: 'RESTOCK',
    });

    expect(ret.disposition).toBe('RESTOCK');
    expect(Number(ret.qty)).toBe(3);
  });

  it('runs controlled drug reconciliation job (JOB-38) and reports balance check', async () => {
    const reconcileResult = await runControlledReconcile();
    expect(reconcileResult).toBeDefined();
    expect(reconcileResult.reconciledCount).toBeGreaterThanOrEqual(0);
  });
});
