import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { withTenant, getAppPool, createPool } from '@clinic/db';
import { SupplyService } from '../src/supply/supply.service.js';
import { runStockBalanceReconcile } from '../../worker/src/handlers/supply-jobs.handler.js';
import { ProblemException } from '../src/http/problem.exception.js';

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const BRANCH_A = 'a1000000-0000-4000-8000-000000000001';
const USER_1 = 'a3000000-0000-4000-8000-000000000001';
const USER_2 = 'a3000000-0000-4000-8000-000000000002';

describe('SupplyService (Phase 4 — Supply & Inventory Core)', () => {
  const svc = new SupplyService();
  const ownerPool = createPool({ role: 'owner' });

  const tenantId = TENANT_A;
  const branchId = BRANCH_A;
  const user1Id = USER_1;
  const user2Id = USER_2;

  let uomPcsId: string;
  let centralStoreId: string;
  let pharmacyLocId: string;
  let itemId: string;

  beforeAll(async () => {
    // 1. Create UOM
    const uom = await svc.createUom(tenantId, { code: 'PCS', name: 'Pieces' });
    uomPcsId = uom.id;

    // 2. Create Locations with unique codes per test run
    const rand = Math.floor(Math.random() * 1000000);
    const loc1 = await svc.createLocation(tenantId, {
      branchId,
      code: `STORE-${rand}`,
      name: `Central Store Test ${rand}`,
      type: 'CENTRAL_STORE',
    });
    centralStoreId = loc1.id;

    const loc2 = await svc.createLocation(tenantId, {
      branchId,
      code: `PHARM-${rand}`,
      name: `Pharmacy Store Test ${rand}`,
      type: 'PHARMACY',
    });
    pharmacyLocId = loc2.id;

    // 3. Create Item with 30-day min shelf life
    const item = await svc.createItem(tenantId, {
      code: 'MED-AMOX-' + Math.floor(Math.random() * 100000),
      name: 'Amoxicillin 500mg',
      itemType: 'MEDICINE',
      baseUomId: uomPcsId,
      isBatchTracked: true,
      isExpiryTracked: true,
      standardCost: 10.50,
      minShelfLifeDaysOnReceipt: 30,
    });
    itemId = item.id;
  });

  afterAll(async () => {
    await ownerPool.end();
  });


  it('AC-12: ledger immutability — database-level denial of UPDATE and DELETE on stock_movements', async () => {
    // 1. Post a legitimate movement
    const mov = await svc.postMovement(tenantId, user1Id, 'req-ac12', {
      locationId: centralStoreId,
      itemId,
      qty: 100,
      uomId: uomPcsId,
      unitCost: 10.50,
      movementType: 'GRN',
    });

    expect(mov.id).toBeDefined();

    // 2. Attempt UPDATE on stock_movements directly -> should fail at DB level
    await expect(
      ownerPool.query(
        `UPDATE stock_movements SET qty = 999 WHERE id = $1`,
        [mov.id],
      ),
    ).rejects.toThrow(/append-only/i);

    // 3. Attempt DELETE on stock_movements directly -> should fail at DB level
    await expect(
      ownerPool.query(
        `DELETE FROM stock_movements WHERE id = $1`,
        [mov.id],
      ),
    ).rejects.toThrow(/append-only/i);
  });

  it('AC-20: period lock — postings inside locked periods return PERIOD_LOCKED and write no rows', async () => {
    // 1. Lock period 2025-01
    await svc.lockPeriod(tenantId, user1Id, { period: '2025-01' });

    // 2. Attempt posting backdated to 2025-01-15
    await expect(
      svc.postMovement(tenantId, user1Id, 'req-lock', {
        locationId: centralStoreId,
        itemId,
        qty: 50,
        uomId: uomPcsId,
        movementType: 'GRN',
        occurredAt: '2025-01-15T10:00:00Z',
      }),
    ).rejects.toMatchObject({
      response: { code: 'PERIOD_LOCKED' },
    });

    // 3. Verify no movements written for that date
    const check = await ownerPool.query(
      `SELECT count(*) FROM stock_movements WHERE tenant_id = $1 AND occurred_at = '2025-01-15T10:00:00Z'`,
      [tenantId],
    );
    expect(Number(check.rows[0].count)).toBe(0);
  });

  it('AC-8: min remaining shelf-life on receipt — rejected without override, succeeds with override', async () => {
    const supplier = await svc.createSupplier(tenantId, {
      code: 'SUP-AC8',
      name: 'Pharma Dist Co',
    });

    // Expiry in 10 days (< 30-day min shelf life)
    const in10Days = new Date();
    in10Days.setDate(in10Days.getDate() + 10);
    const expiryStr = in10Days.toISOString().slice(0, 10);

    // 1. Create GRN draft with short shelf life and NO override reason
    const grn = await svc.createGrn(tenantId, user1Id, {
      branchId,
      locationId: centralStoreId,
      supplierId: supplier.id,
      lines: [
        {
          itemId,
          lotNo: 'LOT-SHORT-1',
          expiryDate: expiryStr,
          qtyReceived: 50,
          uomId: uomPcsId,
          unitCost: 10,
        },
      ],
    });

    // Posting without override must fail with SHELF_LIFE_VIOLATION
    await expect(
      svc.postGrn(tenantId, user1Id, 'req-grn-1', grn.id),
    ).rejects.toMatchObject({
      response: { code: 'SHELF_LIFE_VIOLATION' },
    });

    // 2. Create GRN draft with short shelf life WITH override reason
    const grnOverride = await svc.createGrn(tenantId, user1Id, {
      branchId,
      locationId: centralStoreId,
      supplierId: supplier.id,
      lines: [
        {
          itemId,
          lotNo: 'LOT-SHORT-2',
          expiryDate: expiryStr,
          qtyReceived: 50,
          uomId: uomPcsId,
          unitCost: 10,
          overrideReason: 'Emergency stock shortage approved by head doctor',
        },
      ],
    });

    // Posting with override succeeds
    const posted = await svc.postGrn(tenantId, user1Id, 'req-grn-2', grnOverride.id);
    expect(posted.status).toBe('POSTED');
  });

  it('AC-6: concurrency control — two simultaneous dispenses of insufficient stock -> exactly one succeeds', async () => {
    // Setup item and batch with exactly 10 units
    const supplier = await svc.createSupplier(tenantId, {
      code: 'SUP-AC6',
      name: 'Concurrency Supplier',
    });

    const farFuture = new Date();
    farFuture.setFullYear(farFuture.getFullYear() + 2);
    const expiryStr = farFuture.toISOString().slice(0, 10);

    const grn = await svc.createGrn(tenantId, user1Id, {
      branchId,
      locationId: centralStoreId,
      supplierId: supplier.id,
      lines: [
        {
          itemId,
          lotNo: 'LOT-CONCUR-1',
          expiryDate: expiryStr,
          qtyReceived: 10,
          uomId: uomPcsId,
          unitCost: 10,
        },
      ],
    });
    const postedGrn = await svc.postGrn(tenantId, user1Id, 'req-grn-ac6', grn.id);
    const batchId = postedGrn.lines[0].batch_id;

    // Two simultaneous requests wanting 10 units each from the same batch
    const p1 = svc.postMovement(tenantId, user1Id, 'req-c1', {
      locationId: centralStoreId,
      itemId,
      batchId,
      qty: -10,
      uomId: uomPcsId,
      movementType: 'CONSUMPTION',
    });

    const p2 = svc.postMovement(tenantId, user2Id, 'req-c2', {
      locationId: centralStoreId,
      itemId,
      batchId,
      qty: -10,
      uomId: uomPcsId,
      movementType: 'CONSUMPTION',
    });

    const results = await Promise.allSettled([p1, p2]);

    const fulfilled = results.filter(r => r.status === 'fulfilled');
    const rejected = results.filter(r => r.status === 'rejected');

    // Exactly one must succeed, exactly one must fail with STOCK_INSUFFICIENT
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
      response: { code: 'STOCK_INSUFFICIENT' },
    });

    // Balance must be exactly 0 (no negative balance!)
    const bal = await ownerPool.query(
      `SELECT qty_on_hand FROM stock_balances WHERE tenant_id = $1 AND location_id = $2 AND batch_id = $3`,
      [tenantId, centralStoreId, batchId],
    );
    expect(Number(bal.rows[0].qty_on_hand)).toBe(0);
  });

  it('AC-9: Requisition -> issue -> receiving discrepancy flow', async () => {
    // 1. Replenish central store with 100 units
    const supplier = await svc.createSupplier(tenantId, { code: 'SUP-AC9', name: 'Supply AC9' });
    const grn = await svc.createGrn(tenantId, user1Id, {
      branchId,
      locationId: centralStoreId,
      supplierId: supplier.id,
      lines: [
        {
          itemId,
          lotNo: 'LOT-AC9-1',
          expiryDate: '2028-12-31',
          qtyReceived: 100,
          uomId: uomPcsId,
          unitCost: 10,
        },
      ],
    });
    const postedGrn = await svc.postGrn(tenantId, user1Id, 'req-grn-ac9', grn.id);
    const batchId = postedGrn.lines[0].batch_id;

    // 2. Pharmacy creates requisition for 20 units
    const req = await svc.createRequisition(tenantId, user1Id, {
      branchId,
      fromLocationId: pharmacyLocId,
      toLocationId: centralStoreId,
      items: [{ itemId, qtyRequested: 20, uomId: uomPcsId }],
    });
    await svc.submitRequisition(tenantId, req.id);
    await svc.approveRequisition(tenantId, user2Id, req.id);

    // 3. Central store issues 20 units
    const issue = await svc.createIssue(tenantId, user2Id, 'req-issue', {
      requisitionId: req.id,
      lines: [{ itemId, batchId, qtyIssued: 20 }],
    });
    expect(issue.status).toBe('ISSUED');

    // Store balance decreased by 20
    const storeBal = await ownerPool.query(
      `SELECT qty_on_hand FROM stock_balances WHERE tenant_id = $1 AND location_id = $2 AND batch_id = $3`,
      [tenantId, centralStoreId, batchId],
    );
    expect(Number(storeBal.rows[0].qty_on_hand)).toBe(80);

    // 4. Pharmacy acknowledges with discrepancy (only received 18, 2 damaged in transit)
    const ack = await svc.acknowledgeRequisition(tenantId, user1Id, 'req-ack', {
      issueId: issue.id,
      lines: [
        {
          itemId,
          batchId,
          qtyReceived: 18,
          discrepancyReason: '2 units broken in transit',
        },
      ],
    });

    expect(ack.status).toBe('DISCREPANCY');

    // Pharmacy on-hand is 18
    const pharmBal = await ownerPool.query(
      `SELECT qty_on_hand FROM stock_balances WHERE tenant_id = $1 AND location_id = $2 AND batch_id = $3`,
      [tenantId, pharmacyLocId, batchId],
    );
    expect(Number(pharmBal.rows[0].qty_on_hand)).toBe(18);
  });

  it('AC-13: Reconcile (JOB-32) detects an injected imbalance and holds the item', async () => {
    // 1. Ensure a balance exists
    let balRes = await ownerPool.query(
      `SELECT location_id, batch_id, qty_on_hand
       FROM stock_balances
       WHERE tenant_id = $1 AND qty_on_hand > 0
       LIMIT 1`,
      [tenantId],
    );

    if (!balRes.rows[0]) {
      const bRes = await ownerPool.query(
        `INSERT INTO stock_batches (tenant_id, item_id, lot_no, expiry_date, unit_cost, status)
         VALUES ($1, $2, 'LOT-RECON-INIT', '2028-01-01', 10.00, 'AVAILABLE')
         RETURNING id`,
        [tenantId, itemId],
      );
      await ownerPool.query(
        `INSERT INTO stock_balances (tenant_id, location_id, batch_id, qty_on_hand)
         VALUES ($1, $2, $3, 100)`,
        [tenantId, centralStoreId, bRes.rows[0].id],
      );
      await ownerPool.query(
        `INSERT INTO stock_movements (tenant_id, location_id, item_id, batch_id, qty, uom_id, movement_type, posted_by, request_id)
         VALUES ($1, $2, $3, $4, 100, $5, 'GRN', $6, 'req-init')`,
        [tenantId, centralStoreId, itemId, bRes.rows[0].id, uomPcsId, user1Id],
      );
      balRes = await ownerPool.query(
        `SELECT location_id, batch_id, qty_on_hand
         FROM stock_balances
         WHERE tenant_id = $1 AND qty_on_hand > 0
         LIMIT 1`,
        [tenantId],
      );
    }
    const target = balRes.rows[0];

    // Inject imbalance directly into stock_balances
    await ownerPool.query(
      `UPDATE stock_balances
       SET qty_on_hand = qty_on_hand + 50
       WHERE tenant_id = $1 AND location_id = $2 AND batch_id = $3`,
      [tenantId, target.location_id, target.batch_id],
    );

    // 2. Run JOB-32 reconcile
    const result = await runStockBalanceReconcile(tenantId);
    expect(result.mismatches).toBeGreaterThan(0);

    // 3. Verify item is placed on hold (hold_until is set in the future)
    const afterReconcile = await ownerPool.query(
      `SELECT hold_until FROM stock_balances
       WHERE tenant_id = $1 AND location_id = $2 AND batch_id = $3`,
      [tenantId, target.location_id, target.batch_id],
    );
    expect(afterReconcile.rows[0].hold_until).not.toBeNull();
    const holdDate = new Date(afterReconcile.rows[0].hold_until);
    expect(holdDate.getTime()).toBeGreaterThan(Date.now());
  });

  it('enforces Segregation of Duties (SoD) on PO approval and Adjustment posting', async () => {
    const supplier = await svc.createSupplier(tenantId, { code: 'SUP-SOD', name: 'SoD Supplier' });

    // PO SoD
    const po = await svc.createPo(tenantId, user1Id, {
      branchId,
      supplierId: supplier.id,
      items: [{ itemId, qtyOrdered: 10, unitPrice: 5, uomId: uomPcsId }],
    });
    await svc.submitPo(tenantId, po.id);

    // user1 (creator) cannot approve PO
    await expect(
      svc.approvePo(tenantId, user1Id, po.id),
    ).rejects.toMatchObject({
      response: { code: 'SEGREGATION_OF_DUTIES' },
    });

    // user2 (different user) CAN approve PO
    const approvedPo = await svc.approvePo(tenantId, user2Id, po.id);
    expect(approvedPo.status).toBe('APPROVED');

    // Adjustment SoD
    const adj = await svc.createAdjustment(tenantId, user1Id, {
      branchId,
      locationId: centralStoreId,
      reasonCode: 'CORRECTION',
      lines: [{ itemId, qtyDelta: 5, unitCost: 10 }],
    });
    await svc.submitAdjustment(tenantId, adj.id);

    // user1 (creator) cannot approve adjustment
    await expect(
      svc.approveAndPostAdjustment(tenantId, user1Id, 'req-adj-sod', adj.id),
    ).rejects.toMatchObject({
      response: { code: 'SEGREGATION_OF_DUTIES' },
    });

    // user2 (different user) CAN approve adjustment
    const postedAdj = await svc.approveAndPostAdjustment(tenantId, user2Id, 'req-adj-sod-ok', adj.id);
    expect(postedAdj.status).toBe('POSTED');
  });

  it('Recalls: auto-quarantines batches and traces exposure to clinical immunizations', async () => {
    // 1. Create batch
    const bRes = await ownerPool.query(
      `INSERT INTO stock_batches (tenant_id, item_id, lot_no, expiry_date, unit_cost, status)
       VALUES ($1, $2, 'LOT-RECALL-TEST', '2028-01-01', 15.00, 'AVAILABLE')
       RETURNING id`,
      [tenantId, itemId],
    );
    const recallBatchId = bRes.rows[0].id;

    // 2. Simulate patient immunization using this batch
    const patient = await ownerPool.query(
      `INSERT INTO patients (tenant_id, first_name, last_name, date_of_birth, gender)
       VALUES ($1, 'Vaccinated', 'Patient', '1995-05-05', 'FEMALE')
       RETURNING id`,
      [tenantId],
    );
    await ownerPool.query(
      `INSERT INTO immunizations (tenant_id, patient_id, vaccine, stock_batch_id, given_by)
       VALUES ($1, $2, 'Amox Suspension', $3, $4)`,
      [tenantId, patient.rows[0].id, recallBatchId, user1Id],
    );

    // 3. Issue recall
    const recall = await svc.createRecall(tenantId, user1Id, {
      source: 'FDA',
      reason: 'Packaging defect',
      batches: [{ itemId, batchId: recallBatchId }],
    });

    // Batch status must be set to RECALLED immediately
    const batchCheck = await ownerPool.query(
      `SELECT status FROM stock_batches WHERE tenant_id = $1 AND id = $2`,
      [tenantId, recallBatchId],
    );
    expect(batchCheck.rows[0].status).toBe('RECALLED');

    // 4. Trace recall
    const trace = await svc.traceRecall(tenantId, recall.id);
    expect(trace.batches.length).toBe(1);
    expect(trace.patientExposures.length).toBe(1);
    expect(trace.patientExposures[0].patient_id).toBe(patient.rows[0].id);
  });

  it('location archive guard: blocks archiving when location has positive stock, succeeds when empty', async () => {
    const rand = Math.floor(Math.random() * 1000000);
    const loc = await svc.createLocation(tenantId, {
      branchId,
      code: `LOC-ARCH-${rand}`,
      name: `Archive Guard Loc ${rand}`,
      type: 'CLINIC_ROOM',
    });

    // 1. When empty, archiving succeeds
    const archived = await svc.archiveLocation(tenantId, loc.id);
    expect(archived.is_active).toBe(false);

    // 2. Location with stock: put stock in centralStoreId
    await expect(
      svc.archiveLocation(tenantId, centralStoreId),
    ).rejects.toMatchObject({
      response: { code: 'CONFLICT' },
    });
  });

  it('bulk CSV import of location item params with error report', async () => {
    const rand = Math.floor(Math.random() * 1000000);
    const loc = await svc.createLocation(tenantId, {
      branchId,
      code: `LOC-CSV-${rand}`,
      name: `CSV Test Loc ${rand}`,
      type: 'CLINIC_ROOM',
    });

    const itemRes = await svc.getItem(tenantId, itemId);
    const itemCode = itemRes.code;

    const csvContent = `location_code,item_code,min_qty,max_qty,par_qty,reorder_point
LOC-CSV-${rand},${itemCode},15,100,50,25
INVALID_LOC,${itemCode},10,50,20,15
LOC-CSV-${rand},INVALID_ITEM,10,50,20,15
`;

    const report = await svc.importLocationParamsCsv(tenantId, csvContent);
    expect(report.totalRows).toBe(3);
    expect(report.importedCount).toBe(1);
    expect(report.failedCount).toBe(2);
    expect(report.errors.length).toBe(2);
    expect(report.errors[0]!.reason).toContain('Location');
    expect(report.errors[1]!.reason).toContain('Item');
  });

  it('PO lifecycle and supplier invoice 3-way match with SoD', async () => {
    const supplier = await svc.createSupplier(tenantId, {
      code: 'SUP-3WAY-' + Math.floor(Math.random() * 10000),
      name: 'Three Way Match Supplier',
    });

    // 1. Create and approve PO (user1 creates, user2 approves)
    const po = await svc.createPo(tenantId, user1Id, {
      branchId,
      supplierId: supplier.id,
      items: [
        {
          itemId,
          qtyOrdered: 20,
          unitPrice: 15,
          uomId: uomPcsId,
        },
      ],
    });
    await svc.submitPo(tenantId, po.id);
    const approvedPo = await svc.approvePo(tenantId, user2Id, po.id);
    expect(approvedPo.status).toBe('APPROVED');

    // 2. Receive goods against PO (user1 receives)
    const grn = await svc.createGrn(tenantId, user1Id, {
      branchId,
      locationId: centralStoreId,
      poId: po.id,
      supplierId: supplier.id,
      lines: [
        {
          itemId,
          lotNo: 'LOT-3WAY-1',
          expiryDate: new Date(Date.now() + 180 * 86400000).toISOString().slice(0, 10),
          qtyReceived: 20,
          uomId: uomPcsId,
          unitCost: 15,
        },
      ],
    });
    const postedGrn = await svc.postGrn(tenantId, user1Id, 'req-grn-3way', grn.id);
    expect(postedGrn.status).toBe('POSTED');

    // 3. User1 (who posted GRN) attempts to match invoice -> Segregation of Duties rejected
    await expect(
      svc.createSupplierInvoice(tenantId, user1Id, {
        invoiceNo: 'INV-' + Date.now(),
        poId: po.id,
        grnId: grn.id,
        amount: 300, // 20 * 15
      }),
    ).rejects.toMatchObject({
      response: { code: 'SEGREGATION_OF_DUTIES' },
    });

    // 4. User2 matches invoice: amount matches -> MATCHED
    const invMatched = await svc.createSupplierInvoice(tenantId, user2Id, {
      invoiceNo: 'INV-' + Date.now(),
      poId: po.id,
      grnId: grn.id,
      amount: 300,
    });
    expect(invMatched.match_status).toBe('MATCHED');

    // 5. Invoice with amount variance -> VARIANCE
    const invVariance = await svc.createSupplierInvoice(tenantId, user2Id, {
      invoiceNo: 'INV-VAR-' + Date.now(),
      poId: po.id,
      grnId: grn.id,
      amount: 350,
    });
    expect(invVariance.match_status).toBe('VARIANCE');

    // 6. Close PO
    const closedPo = await svc.closePo(tenantId, po.id);
    expect(closedPo.status).toBe('CLOSED');
  });

  it('supplier return (RTV) posts negative movement out of stock', async () => {
    const supplier = await svc.createSupplier(tenantId, {
      code: 'SUP-RTV-' + Math.floor(Math.random() * 10000),
      name: 'RTV Supplier',
    });

    // Receive 10 units first
    const grn = await svc.createGrn(tenantId, user1Id, {
      branchId,
      locationId: centralStoreId,
      supplierId: supplier.id,
      lines: [
        {
          itemId,
          lotNo: 'LOT-RTV-1',
          expiryDate: new Date(Date.now() + 180 * 86400000).toISOString().slice(0, 10),
          qtyReceived: 10,
          uomId: uomPcsId,
          unitCost: 12,
        },
      ],
    });
    const postedGrn = await svc.postGrn(tenantId, user1Id, 'req-grn-rtv', grn.id);
    const batchId = postedGrn.lines[0].batch_id;

    // Create supplier return for 5 units
    const ret = await svc.createSupplierReturn(tenantId, user1Id, {
      supplierId: supplier.id,
      locationId: centralStoreId,
      reason: 'Defective batch packaging',
      items: [
        {
          itemId,
          batchId,
          qty: 5,
          unitCost: 12,
        },
      ],
    });
    expect(ret.status).toBe('DRAFT');

    // Post return
    const postedRet = await svc.postSupplierReturn(tenantId, user1Id, 'req-rtv-post', ret.id, centralStoreId);
    expect(postedRet.status).toBe('POSTED');
  });

  it('BIL-T1: posts a SUPPLY charge when consumption is tied to a visit', async () => {
    // Catalog service priced at 12.50, mapped to the item.
    const svcRes = await ownerPool.query(
      `INSERT INTO service_catalog (tenant_id, code, name, category, default_price, is_active)
       VALUES ($1, $2, 'Amoxicillin 500mg (issue)', 'other', 12.50, true) RETURNING id`,
      [tenantId, `SUPSVC-${Math.floor(Math.random() * 1000000)}`],
    );
    const serviceId = svcRes.rows[0].id;
    await ownerPool.query(`UPDATE items SET service_id = $2 WHERE tenant_id = $1 AND id = $3`, [tenantId, serviceId, itemId]);

    // Stock the central store with a batch.
    const supplier = await svc.createSupplier(tenantId, { code: `SUP-BIL-${Date.now()}`, name: 'Billing Supply Co' });
    const grn = await svc.createGrn(tenantId, user1Id, {
      branchId,
      locationId: centralStoreId,
      supplierId: supplier.id,
      lines: [{
        itemId,
        lotNo: 'LOT-BIL-1',
        expiryDate: new Date(Date.now() + 180 * 86400000).toISOString().slice(0, 10),
        qtyReceived: 10,
        uomId: uomPcsId,
        unitCost: 5,
      }],
    });
    const postedGrn = await svc.postGrn(tenantId, user1Id, `req-grn-bil-${Date.now()}`, grn.id);
    const batchId = postedGrn.lines[0].batch_id;

    // Open the visit the supply is issued against.
    const pRes = await ownerPool.query(
      `INSERT INTO patients (tenant_id, first_name, last_name, date_of_birth, gender)
       VALUES ($1, 'Supply', 'Visit', '1990-01-01', 'MALE') RETURNING id`,
      [tenantId],
    );
    const patientId = pRes.rows[0].id;
    const vRes = await ownerPool.query(
      `INSERT INTO visits (tenant_id, branch_id, visit_no, patient_id, practitioner_id, visit_type, status, opened_at, created_by)
       VALUES ($1, $2, $3, $4, $5, 'OPD', 'IN_PROGRESS', now(), $6)
       RETURNING id`,
      [tenantId, branchId, `VIS-SUP-${Date.now()}`, patientId, user2Id, user1Id],
    );
    const visitId = vRes.rows[0].id;

    const res = await svc.postConsumption(tenantId, user1Id, `req-cons-${Date.now()}`, {
      locationId: centralStoreId,
      itemId,
      batchId,
      qty: 3,
      uomId: uomPcsId,
      refType: 'VISIT',
      refId: visitId,
    });
    expect(res.status).toBe('POSTED');

    const charge = await ownerPool.query(
      `SELECT charge_type, service_id, quantity, unit_price, amount, visit_id
         FROM billing_charges
        WHERE tenant_id = $1 AND charge_type = 'SUPPLY' AND visit_id = $2`,
      [tenantId, visitId],
    );
    expect(charge.rows).toHaveLength(1);
    expect(charge.rows[0].service_id).toBe(serviceId);
    expect(Number(charge.rows[0].quantity)).toBe(3);
    expect(Number(charge.rows[0].unit_price)).toBe(12.5);
    expect(Number(charge.rows[0].amount)).toBe(37.5);

    await ownerPool.query(`DELETE FROM billing_charges WHERE tenant_id = $1 AND visit_id = $2`, [tenantId, visitId]);
    await ownerPool.query(`DELETE FROM consumption_logs WHERE tenant_id = $1 AND ref_id = $2`, [tenantId, visitId]);
    await ownerPool.query(`DELETE FROM visits WHERE id = $1`, [visitId]);
    await ownerPool.query(`DELETE FROM patients WHERE id = $1`, [patientId]);
    await ownerPool.query(`UPDATE items SET service_id = NULL WHERE tenant_id = $1 AND id = $2`, [tenantId, itemId]);
    await ownerPool.query(`DELETE FROM service_catalog WHERE id = $1`, [serviceId]);
  });
});
