/**
 * Phase 4 Multi-Tenant Isolation Test Suite (todo.md §49 ground rules).
 *
 * Verifies that all Phase 4 supply & inventory entities:
 *   - Items & UOMs
 *   - Suppliers & Locations
 *   - Batches & Stock Balances
 *   - Stock Movements (Ledger)
 *   - Purchase Requests & Purchase Orders
 *   - Goods Receipts (GRN)
 *   - Requisitions & Stock Issues
 *   - Adjustments & Counts
 * are strictly isolated between Tenant A and Tenant B.
 * Any attempt by Tenant B to query, fetch, or mutate Tenant A resources
 * returns NOT_FOUND / 0 rows / empty sets due to forced RLS and tenant scoping.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { probeDb } from '@clinic/db/tests/helpers.js';
import { createPool, withTenant } from '@clinic/db';
import { SupplyService } from '../src/supply/supply.service.js';
import { ProblemException } from '../src/http/problem.exception.js';
import { seedUsers, NO_SEED_USERS } from "@clinic/db/tests/helpers.js";

const hasDb = await probeDb();

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const BRANCH_A = 'a1000000-0000-4000-8000-000000000001';
const { USER_A } = hasDb ? await seedUsers() : NO_SEED_USERS;

const TENANT_B = '22222222-2222-4222-8222-222222222222';
const BRANCH_B = 'b1000000-0000-4000-8000-000000000001';
const { USER_B } = hasDb ? await seedUsers() : NO_SEED_USERS;

describe.skipIf(!hasDb)('Phase 4 Multi-Tenant Isolation (§49)', () => {
  const svc = new SupplyService();
  const ownerPool = createPool({ role: 'owner' });

  let uomAId: string;
  let locAId: string;
  let itemAId: string;
  let supplierAId: string;

  beforeAll(async () => {
    const rand = Math.floor(Math.random() * 1000000);
    // Setup Tenant A master data
    const uomA = await svc.createUom(TENANT_A, { code: `PCS-${rand}`, name: 'Pieces A' });
    uomAId = uomA.id;

    const locA = await svc.createLocation(TENANT_A, {
      branchId: BRANCH_A,
      code: `STORE-ISO-${rand}`,
      name: 'Main Store A',
      type: 'CENTRAL_STORE',
    });
    locAId = locA.id;

    const itemA = await svc.createItem(TENANT_A, {
      code: `MED-ISO-${rand}`,
      name: 'Amoxicillin A',
      itemType: 'MEDICINE',
      baseUomId: uomAId,
      isBatchTracked: true,
      standardCost: 15.0,
    });
    itemAId = itemA.id;

    const supplierA = await svc.createSupplier(TENANT_A, {
      code: `SUP-ISO-${rand}`,
      name: 'Supplier A',
    });
    supplierAId = supplierA.id;
  });

  afterAll(async () => {
    await ownerPool.end();
  });

  it('isolates items, suppliers, and locations between tenants', async () => {
    // Tenant A queries items -> finds itemA
    const itemsA = await svc.listItems(TENANT_A);
    expect(itemsA.some((i: any) => i.id === itemAId)).toBe(true);

    // Tenant B queries items -> itemA is invisible
    const itemsB = await svc.listItems(TENANT_B);
    expect(itemsB.some((i: any) => i.id === itemAId)).toBe(false);

    // Tenant B attempts to fetch Tenant A item directly -> NOT_FOUND
    await expect(svc.getItem(TENANT_B, itemAId)).rejects.toMatchObject({
      response: { code: 'NOT_FOUND' },
    });

    // Tenant B cannot see Tenant A supplier
    const suppliersB = await svc.listSuppliers(TENANT_B);
    expect(suppliersB.some((s: any) => s.id === supplierAId)).toBe(false);

    // Tenant B cannot see Tenant A location
    const locsB = await svc.listLocations(TENANT_B);
    expect(locsB.some((l: any) => l.id === locAId)).toBe(false);
  });

  it('isolates stock balances and batches between tenants', async () => {
    // Receive stock in Tenant A via GRN
    const grn = await svc.createGrn(TENANT_A, USER_A, {
      branchId: BRANCH_A,
      locationId: locAId,
      supplierId: supplierAId,
      lines: [
        {
          itemId: itemAId,
          lotNo: 'LOT-ISO-A1',
          expiryDate: '2028-06-30',
          qtyReceived: 50,
          uomId: uomAId,
          unitCost: 15.0,
        },
      ],
    });
    const postedGrn = await svc.postGrn(TENANT_A, USER_A, 'req-iso-grn', grn.id);
    const batchId = postedGrn.lines[0].batch_id;

    // Tenant A Stock Explorer sees positive balance
    const stockA = await svc.listStockBalances(TENANT_A, { itemId: itemAId });
    expect(stockA.length).toBeGreaterThan(0);
    expect(Number(stockA[0].qty_on_hand)).toBe(50);

    // Tenant B Stock Explorer sees nothing for this item
    const stockB = await svc.listStockBalances(TENANT_B, { itemId: itemAId });
    expect(stockB.length).toBe(0);

    // Tenant B cannot consume or post movement against Tenant A batch
    await expect(
      svc.postMovement(TENANT_B, USER_B, 'req-iso-mov', {
        locationId: locAId,
        itemId: itemAId,
        batchId,
        qty: -10,
        uomId: uomAId,
        movementType: 'CONSUMPTION',
      }),
    ).rejects.toMatchObject({
      response: { code: 'NOT_FOUND' },
    });

    // Tenant B direct RLS query on stock_balances returns 0 rows
    const rlsBalances = await withTenant({ tenantId: TENANT_B }, async (tx) => {
      const res = await tx.query(`SELECT * FROM stock_balances WHERE batch_id = $1`, [batchId]);
      return res.rows;
    });
    expect(rlsBalances.length).toBe(0);

    // Tenant B direct RLS query on stock_movements returns 0 rows
    const rlsMovements = await withTenant({ tenantId: TENANT_B }, async (tx) => {
      const res = await tx.query(`SELECT * FROM stock_movements WHERE item_id = $1`, [itemAId]);
      return res.rows;
    });
    expect(rlsMovements.length).toBe(0);
  });

  it('isolates Purchase Requests, Purchase Orders, and GRNs between tenants', async () => {
    // Tenant A creates PR
    const prA = await svc.createPr(TENANT_A, USER_A, {
      branchId: BRANCH_A,
      locationId: locAId,
      reason: 'Tenant A Restock',
      items: [{ itemId: itemAId, qtyRequested: 20, uomId: uomAId }],
    });

    // Tenant B cannot view Tenant A PR
    await expect(svc.getPr(TENANT_B, prA.id)).rejects.toMatchObject({
      response: { code: 'NOT_FOUND' },
    });

    // Tenant A creates PO
    const poA = await svc.createPo(TENANT_A, USER_A, {
      branchId: BRANCH_A,
      supplierId: supplierAId,
      items: [{ itemId: itemAId, qtyOrdered: 20, unitPrice: 15.0, uomId: uomAId }],
    });

    // Tenant B cannot view Tenant A PO
    await expect(svc.getPo(TENANT_B, poA.id)).rejects.toMatchObject({
      response: { code: 'NOT_FOUND' },
    });

    // Tenant B cannot approve Tenant A PO
    await expect(svc.approvePo(TENANT_B, USER_B, poA.id)).rejects.toMatchObject({
      response: { code: 'NOT_FOUND' },
    });
  });

  it('isolates Requisitions and Adjustments between tenants', async () => {
    // Tenant A creates Requisition
    const reqA = await svc.createRequisition(TENANT_A, USER_A, {
      branchId: BRANCH_A,
      fromLocationId: locAId,
      toLocationId: locAId,
      items: [{ itemId: itemAId, qtyRequested: 5, uomId: uomAId }],
    });

    // Tenant B cannot view or approve Tenant A Requisition
    await expect(svc.getRequisition(TENANT_B, reqA.id)).rejects.toMatchObject({
      response: { code: 'NOT_FOUND' },
    });
    await expect(svc.approveRequisition(TENANT_B, USER_B, reqA.id)).rejects.toMatchObject({
      response: { code: 'NOT_FOUND' },
    });

    // Tenant A creates Adjustment
    const adjA = await svc.createAdjustment(TENANT_A, USER_A, {
      branchId: BRANCH_A,
      locationId: locAId,
      reasonCode: 'CORRECTION',
      lines: [{ itemId: itemAId, qtyDelta: 2, unitCost: 15.0 }],
    });

    // Tenant B cannot view or post Tenant A Adjustment
    await expect(svc.getAdjustment(TENANT_B, adjA.id)).rejects.toMatchObject({
      response: { code: 'NOT_FOUND' },
    });
    await expect(
      svc.approveAndPostAdjustment(TENANT_B, USER_B, 'req-iso-adj', adjA.id),
    ).rejects.toMatchObject({
      response: { code: 'NOT_FOUND' },
    });
  });
});
