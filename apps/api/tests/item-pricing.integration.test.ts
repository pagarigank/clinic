import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { probeDb } from '@clinic/db/tests/helpers.js';
import { createPool } from '@clinic/db';
import { SupplyService } from '../src/supply/supply.service.js';
import { PharmacyService } from '../src/pharmacy/pharmacy.service.js';
import { TenantConfigService } from '../src/tenant-config/tenant-config.service.js';

const hasDb = await probeDb();

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = 'a3000000-0000-4000-8000-000000000001';

describe.skipIf(!hasDb)('Pharmacy and Central Supply Item & Pricing Management Integration', () => {
  const supplySvc = new SupplyService();
  const pharmacySvc = new PharmacyService(supplySvc);
  const tenantConfigSvc = new TenantConfigService();
  const ownerPool = createPool({ role: 'owner' });

  let uomId: string;
  let genericId: string;
  const createdItemIds: string[] = [];
  const createdProductIds: string[] = [];
  const createdServiceIds: string[] = [];

  beforeAll(async () => {
    // 1. Ensure a valid UOM exists
    const uom = await supplySvc.createUom(TENANT_ID, {
      code: `UOM-${Date.now().toString().slice(-4)}`,
      name: 'Test Pieces',
    });
    uomId = uom.id;

    // 2. Ensure a valid generic exists
    const gen = await pharmacySvc.createGeneric(TENANT_ID, {
      name: `Amoxicillin + Clavulanic Acid Test ${Date.now()}`,
      atcCode: 'J01CR02',
    });
    genericId = gen.id;
  });

  afterAll(async () => {
    if (createdServiceIds.length > 0) {
      await ownerPool.query(`DELETE FROM price_lists WHERE service_id = ANY($1)`, [createdServiceIds]);
      await ownerPool.query(`UPDATE items SET service_id = NULL WHERE service_id = ANY($1)`, [createdServiceIds]);
      if (createdProductIds.length > 0) {
        await ownerPool.query(`DELETE FROM drug_products WHERE id = ANY($1)`, [createdProductIds]);
      }
      if (createdItemIds.length > 0) {
        await ownerPool.query(`DELETE FROM items WHERE id = ANY($1)`, [createdItemIds]);
      }
      await ownerPool.query(`DELETE FROM items WHERE service_id = ANY($1)`, [createdServiceIds]);
      await ownerPool.query(`DELETE FROM service_catalog WHERE id = ANY($1)`, [createdServiceIds]);
    }
  });

  it('transactionally creates Central Supply item with service_catalog entry and price list', async () => {
    const code = `TEST-SUP-${Date.now().toString().slice(-4)}`;
    const item = await supplySvc.createItem(TENANT_ID, {
      code,
      name: 'Nitrile Examination Gloves',
      itemType: 'SUPPLY',
      baseUomId: uomId,
      standardCost: 120.00,
      price: 180.00,
      isBatchTracked: true,
      isExpiryTracked: true,
      minShelfLifeDaysOnReceipt: 60,
    });

    createdItemIds.push(item.id);
    if (item.service_id) createdServiceIds.push(item.service_id);

    expect(item.id).toBeDefined();
    expect(item.code).toBe(code);
    expect(Number(item.standard_cost)).toBe(120.00);
    expect(Number(item.price)).toBe(180.00);
    expect(item.service_id).toBeDefined();

    // Verify service_catalog entry was created with SUP- prefix
    const catRes = await ownerPool.query(
      `SELECT * FROM service_catalog WHERE tenant_id = $1 AND id = $2`,
      [TENANT_ID, item.service_id],
    );
    expect(catRes.rows.length).toBe(1);
    expect(catRes.rows[0].code).toBe(`SUP-${code}`);
    expect(Number(catRes.rows[0].default_price)).toBe(180.00);

    // Verify price_lists row was created
    const plRes = await ownerPool.query(
      `SELECT * FROM price_lists WHERE tenant_id = $1 AND service_id = $2`,
      [TENANT_ID, item.service_id],
    );
    expect(plRes.rows.length).toBeGreaterThan(0);
    expect(Number(plRes.rows[0].amount)).toBe(180.00);

    // Verify getItem returns price
    const fetched = await supplySvc.getItem(TENANT_ID, item.id);
    expect(Number(fetched.price)).toBe(180.00);

    // Update item price
    const updated = await supplySvc.updateItem(TENANT_ID, item.id, {
      name: 'Nitrile Examination Gloves Extra Thick',
      standardCost: 130.00,
      price: 200.00,
    });
    expect(Number(updated.price)).toBe(200.00);
    expect(Number(updated.standard_cost)).toBe(130.00);
  });

  it('transactionally creates Pharmacy drug product with service_catalog entry and price list', async () => {
    const code = `TEST-RX-${Date.now().toString().slice(-4)}`;
    const product = await pharmacySvc.createProduct(TENANT_ID, {
      code,
      name: 'Augmentin Test 625mg',
      brandName: 'Augmentin Test 625mg',
      genericId,
      dosageForm: 'TABLET',
      strength: '625mg',
      route: 'ORAL',
      rxRequired: 'RX',
      isFormulary: true,
      standardCost: 25.00,
      price: 45.00,
    });

    createdProductIds.push(product.id);
    if (product.service_id) createdServiceIds.push(product.service_id);

    expect(product.id).toBeDefined();
    expect(product.code).toBe(code);
    expect(Number(product.standard_cost)).toBe(25.00);
    expect(Number(product.price)).toBe(45.00);
    expect(product.service_id).toBeDefined();

    // Verify service_catalog entry was created with RX- prefix
    const catRes = await ownerPool.query(
      `SELECT * FROM service_catalog WHERE tenant_id = $1 AND id = $2`,
      [TENANT_ID, product.service_id],
    );
    expect(catRes.rows.length).toBe(1);
    expect(catRes.rows[0].code).toBe(`RX-${code}`);
    expect(Number(catRes.rows[0].default_price)).toBe(45.00);

    // Verify price_lists row was created
    const plRes = await ownerPool.query(
      `SELECT * FROM price_lists WHERE tenant_id = $1 AND service_id = $2`,
      [TENANT_ID, product.service_id],
    );
    expect(plRes.rows.length).toBeGreaterThan(0);
    expect(Number(plRes.rows[0].amount)).toBe(45.00);

    // Verify getProduct returns price
    const fetched = await pharmacySvc.getProduct(TENANT_ID, product.id);
    expect(Number(fetched.price)).toBe(45.00);

    // Update product price
    const updated = await pharmacySvc.updateProduct(TENANT_ID, product.id, {
      brandName: 'Augmentin Test 625mg FC Tablet',
      standardCost: 28.00,
      price: 50.00,
    });
    expect(Number(updated.price)).toBe(50.00);
    expect(Number(updated.standard_cost)).toBe(28.00);
  });

  it('performs bulk pricing adjustments for CENTRAL_SUPPLY and PHARMACY targets', async () => {
    // 1. Bulk adjust Central Supply (+10%)
    const supplyAdjust = await tenantConfigSvc.bulkAdjustPricing(TENANT_ID, USER_ID, {
      target: 'CENTRAL_SUPPLY',
      adjustmentType: 'PERCENTAGE',
      direction: 'INCREASE',
      value: 10,
      reason: 'Annual supply adjustment',
    });
    expect(supplyAdjust.count).toBeGreaterThan(0);

    // Check last created supply item price increased from 200 by 10% -> 220
    const supplyItem = await supplySvc.getItem(TENANT_ID, createdItemIds[0]!);
    expect(Number(supplyItem.price)).toBe(220.00);

    // 2. Bulk adjust Pharmacy (+10%)
    const rxAdjust = await tenantConfigSvc.bulkAdjustPricing(TENANT_ID, USER_ID, {
      target: 'PHARMACY',
      adjustmentType: 'PERCENTAGE',
      direction: 'INCREASE',
      value: 10,
      reason: 'Annual pharmacy formulary adjustment',
    });
    expect(rxAdjust.count).toBeGreaterThan(0);

    // Check last created drug product price increased from 50 by 10% -> 55
    const drugProduct = await pharmacySvc.getProduct(TENANT_ID, createdProductIds[0]!);
    expect(Number(drugProduct.price)).toBe(55.00);
  });
});
