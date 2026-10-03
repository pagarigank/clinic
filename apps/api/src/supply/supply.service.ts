import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { withTenant, getAppPool } from '@clinic/db';
import { ProblemException } from '../http/problem.exception.js';
import { resolveServicePrice } from '../common/pricing.js';
import type {
  CreateItemCategoryRequest,
  CreateUomRequest,
  CreateUomConversionRequest,
  CreateItemRequest,
  UpdateItemRequest,
  CreateItemBarcodeRequest,
  CreateSupplierRequest,
  UpdateSupplierRequest,
  CreateSupplierItemRequest,
  CreateStockLocationRequest,
  UpdateLocationItemParamsRequest,
  PostMovementRequest,
  PostConsumptionRequest,
  PeriodActionRequest,
  QuarantineBatchRequest,
  ReleaseBatchRequest,
  CreatePrRequest,
  ConvertPrToPoRequest,
  CreatePoRequest,
  CreateGrnRequest,
  VoidGrnRequest,
  CreateRequisitionRequest,
  CreateIssueRequest,
  AcknowledgeRequisitionRequest,
  CreateAdjustmentRequest,
  CreateCountRequest,
  EnterCountLinesRequest,
  CreateDisposalRequest,
  CreateRecallRequest,
  CloseRecallRequest,
  BulkImportResult,
  CreateSupplierInvoiceRequest,
  CreateSupplierReturnRequest,
} from '@clinic/contracts';

@Injectable()
export class SupplyService {
  // ── Masters: Categories, UOMs, Items ──────────────────────────────────────

  async listCategories(tenantId: string) {
    return withTenant({ tenantId }, async (tx) => {
      const res = await tx.query(
        `SELECT id, name, parent_id, created_at, updated_at
         FROM item_categories
         WHERE tenant_id = $1
         ORDER BY name ASC`,
        [tenantId],
      );
      return res.rows;
    });
  }

  async createCategory(tenantId: string, dto: CreateItemCategoryRequest) {
    return withTenant({ tenantId }, async (tx) => {
      const res = await tx.query(
        `INSERT INTO item_categories (tenant_id, name, parent_id)
         VALUES ($1, $2, $3)
         RETURNING *`,
        [tenantId, dto.name, dto.parentId ?? null],
      );
      return res.rows[0];
    });
  }

  async listUoms(tenantId: string) {
    return withTenant({ tenantId }, async (tx) => {
      const res = await tx.query(
        `SELECT id, code, name, is_active, created_at
         FROM uoms
         WHERE tenant_id = $1
         ORDER BY code ASC`,
        [tenantId],
      );
      return res.rows;
    });
  }

  async createUom(tenantId: string, dto: CreateUomRequest) {
    return withTenant({ tenantId }, async (tx) => {
      const res = await tx.query(
        `INSERT INTO uoms (tenant_id, code, name)
         VALUES ($1, $2, $3)
         ON CONFLICT (tenant_id, code) DO UPDATE SET name = EXCLUDED.name, is_active = true
         RETURNING *`,
        [tenantId, dto.code.toUpperCase(), dto.name],
      );
      return res.rows[0];
    });
  }

  async createUomConversion(tenantId: string, dto: CreateUomConversionRequest) {
    return withTenant({ tenantId }, async (tx) => {
      const res = await tx.query(
        `INSERT INTO uom_conversions (tenant_id, item_id, from_uom_id, to_uom_id, factor)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (tenant_id, item_id, from_uom_id, to_uom_id) DO UPDATE SET factor = EXCLUDED.factor
         RETURNING *`,
        [tenantId, dto.itemId ?? null, dto.fromUomId, dto.toUomId, dto.factor],
      );
      return res.rows[0];
    });
  }

  async listItems(tenantId: string, filter?: { itemType?: string; search?: string }) {
    return withTenant({ tenantId }, async (tx) => {
      let query = `
        SELECT i.*, u.code as uom_code, c.name as category_name,
               COALESCE((SELECT SUM(b.qty_on_hand) FROM stock_balances b JOIN stock_batches sb ON sb.id = b.batch_id WHERE b.tenant_id = i.tenant_id AND sb.item_id = i.id), 0) as total_on_hand
        FROM items i
        LEFT JOIN uoms u ON u.id = i.base_uom_id
        LEFT JOIN item_categories c ON c.id = i.category_id
        WHERE i.tenant_id = $1
      `;
      const params: unknown[] = [tenantId];
      if (filter?.itemType) {
        params.push(filter.itemType);
        query += ` AND i.item_type = $${params.length}`;
      }
      if (filter?.search) {
        params.push(`%${filter.search}%`);
        query += ` AND (i.name ILIKE $${params.length} OR i.code ILIKE $${params.length})`;
      }
      query += ` ORDER BY i.name ASC`;
      const res = await tx.query(query, params);
      return res.rows;
    });
  }

  async getItem(tenantId: string, id: string) {
    return withTenant({ tenantId }, async (tx) => {
      const res = await tx.query(
        `SELECT i.*, u.code as uom_code, c.name as category_name
         FROM items i
         LEFT JOIN uoms u ON u.id = i.base_uom_id
         LEFT JOIN item_categories c ON c.id = i.category_id
         WHERE i.tenant_id = $1 AND i.id = $2`,
        [tenantId, id],
      );
      if (!res.rows[0]) {
        throw new ProblemException('NOT_FOUND', { detail: 'Item not found' });
      }
      return res.rows[0];
    });
  }

  async createItem(tenantId: string, dto: CreateItemRequest) {
    return withTenant({ tenantId }, async (tx) => {
      const res = await tx.query(
        `INSERT INTO items (
           tenant_id, code, name, item_type, category_id, base_uom_id,
           is_batch_tracked, is_expiry_tracked, storage_conditions, is_hazardous,
           standard_cost, min_shelf_life_days_on_receipt
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         RETURNING *`,
        [
          tenantId, dto.code, dto.name, dto.itemType, dto.categoryId ?? null, dto.baseUomId,
          dto.isBatchTracked ?? false, dto.isExpiryTracked ?? false, dto.storageConditions ?? null,
          dto.isHazardous ?? false, dto.standardCost ?? 0, dto.minShelfLifeDaysOnReceipt ?? 0,
        ],
      );
      return res.rows[0];
    });
  }

  async updateItem(tenantId: string, id: string, dto: UpdateItemRequest) {
    return withTenant({ tenantId }, async (tx) => {
      const existing = await this.getItem(tenantId, id);
      const res = await tx.query(
        `UPDATE items
         SET name = COALESCE($1, name),
             storage_conditions = COALESCE($2, storage_conditions),
             is_hazardous = COALESCE($3, is_hazardous),
             standard_cost = COALESCE($4, standard_cost),
             min_shelf_life_days_on_receipt = COALESCE($5, min_shelf_life_days_on_receipt),
             category_id = COALESCE($6, category_id),
             updated_at = now()
         WHERE tenant_id = $7 AND id = $8
         RETURNING *`,
        [
          dto.name ?? null, dto.storageConditions ?? null, dto.isHazardous ?? null,
          dto.standardCost ?? null, dto.minShelfLifeDaysOnReceipt ?? null,
          dto.categoryId ?? null, tenantId, id,
        ],
      );
      return res.rows[0];
    });
  }

  async createItemBarcode(tenantId: string, dto: CreateItemBarcodeRequest) {
    return withTenant({ tenantId }, async (tx) => {
      const res = await tx.query(
        `INSERT INTO item_barcodes (tenant_id, item_id, barcode, uom_id)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [tenantId, dto.itemId, dto.barcode, dto.uomId],
      );
      return res.rows[0];
    });
  }

  // ── Masters: Suppliers ─────────────────────────────────────────────────────

  async listSuppliers(tenantId: string) {
    return withTenant({ tenantId }, async (tx) => {
      const res = await tx.query(
        `SELECT * FROM suppliers WHERE tenant_id = $1 ORDER BY name ASC`,
        [tenantId],
      );
      return res.rows;
    });
  }

  async createSupplier(tenantId: string, dto: CreateSupplierRequest) {
    return withTenant({ tenantId }, async (tx) => {
      const res = await tx.query(
        `INSERT INTO suppliers (tenant_id, code, name, tin, address, terms_days, lead_time_days, rating)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (tenant_id, code) DO UPDATE
         SET name = EXCLUDED.name,
             tin = COALESCE(EXCLUDED.tin, suppliers.tin),
             address = COALESCE(EXCLUDED.address, suppliers.address),
             terms_days = EXCLUDED.terms_days,
             lead_time_days = EXCLUDED.lead_time_days,
             rating = COALESCE(EXCLUDED.rating, suppliers.rating),
             status = 'ACTIVE'
         RETURNING *`,
        [
          tenantId, dto.code, dto.name, dto.tin ?? null, dto.address ?? null,
          dto.termsDays ?? 30, dto.leadTimeDays ?? 7, dto.rating ?? null,
        ],
      );
      return res.rows[0];
    });
  }

  async updateSupplier(tenantId: string, id: string, dto: UpdateSupplierRequest) {
    return withTenant({ tenantId }, async (tx) => {
      const res = await tx.query(
        `UPDATE suppliers
         SET name = COALESCE($1, name),
             tin = COALESCE($2, tin),
             address = COALESCE($3, address),
             terms_days = COALESCE($4, terms_days),
             lead_time_days = COALESCE($5, lead_time_days),
             rating = COALESCE($6, rating),
             updated_at = now()
         WHERE tenant_id = $7 AND id = $8
         RETURNING *`,
        [
          dto.name ?? null, dto.tin ?? null, dto.address ?? null,
          dto.termsDays ?? null, dto.leadTimeDays ?? null, dto.rating ?? null,
          tenantId, id,
        ],
      );
      return res.rows[0];
    });
  }

  async createSupplierItem(tenantId: string, dto: CreateSupplierItemRequest) {
    return withTenant({ tenantId }, async (tx) => {
      const res = await tx.query(
        `INSERT INTO supplier_items (tenant_id, supplier_id, item_id, supplier_sku, last_price, pack_size, uom_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (tenant_id, supplier_id, item_id) DO UPDATE
         SET last_price = EXCLUDED.last_price, supplier_sku = EXCLUDED.supplier_sku, pack_size = EXCLUDED.pack_size
         RETURNING *`,
        [
          tenantId, dto.supplierId, dto.itemId, dto.supplierSku ?? null,
          dto.lastPrice, dto.packSize ?? 1, dto.uomId,
        ],
      );
      return res.rows[0];
    });
  }

  async listSupplierItems(tenantId: string, supplierId: string) {
    return withTenant({ tenantId }, async (tx) => {
      const res = await tx.query(
        `SELECT si.*, i.name as item_name, i.code as item_code, u.code as uom_code
         FROM supplier_items si
         JOIN items i ON i.id = si.item_id
         JOIN uoms u ON u.id = si.uom_id
         WHERE si.tenant_id = $1 AND si.supplier_id = $2`,
        [tenantId, supplierId],
      );
      return res.rows;
    });
  }

  // ── Masters: Locations & Params ────────────────────────────────────────────

  async listLocations(tenantId: string, branchId?: string) {
    return withTenant({ tenantId }, async (tx) => {
      let query = `SELECT * FROM stock_locations WHERE tenant_id = $1`;
      const params: unknown[] = [tenantId];
      if (branchId) {
        params.push(branchId);
        query += ` AND branch_id = $2`;
      }
      query += ` ORDER BY name ASC`;
      const res = await tx.query(query, params);
      return res.rows;
    });
  }

  async createLocation(tenantId: string, dto: CreateStockLocationRequest) {
    return withTenant({ tenantId }, async (tx) => {
      const res = await tx.query(
        `INSERT INTO stock_locations (tenant_id, branch_id, code, name, type, parent_id)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [tenantId, dto.branchId, dto.code, dto.name, dto.type, dto.parentId ?? null],
      );
      return res.rows[0];
    });
  }

  async updateLocationParams(tenantId: string, dto: UpdateLocationItemParamsRequest) {
    return withTenant({ tenantId }, async (tx) => {
      const res = await tx.query(
        `INSERT INTO location_item_params (tenant_id, location_id, item_id, min_qty, max_qty, par_qty, reorder_point)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (tenant_id, location_id, item_id) DO UPDATE
         SET min_qty = EXCLUDED.min_qty, max_qty = EXCLUDED.max_qty, par_qty = EXCLUDED.par_qty, reorder_point = EXCLUDED.reorder_point, updated_at = now()
         RETURNING *`,
        [tenantId, dto.locationId, dto.itemId, dto.minQty ?? 0, dto.maxQty ?? null, dto.parQty ?? null, dto.reorderPoint ?? null],
      );
      return res.rows[0];
    });
  }

  async archiveLocation(tenantId: string, locationId: string) {
    return withTenant({ tenantId }, async (tx) => {
      // Archive guard: zero stock
      const stockRes = await tx.query(
        `SELECT COALESCE(SUM(qty_on_hand), 0)::numeric as total_stock
         FROM stock_balances
         WHERE tenant_id = $1 AND location_id = $2`,
        [tenantId, locationId],
      );
      const totalStock = Number(stockRes.rows[0]?.total_stock ?? 0);
      if (totalStock > 0) {
        throw new ProblemException('CONFLICT', {
          detail: 'Cannot archive location with positive stock balances. Clear or transfer stock first.',
        });
      }
      const res = await tx.query(
        `UPDATE stock_locations
         SET is_active = false, updated_at = now()
         WHERE tenant_id = $1 AND id = $2
         RETURNING *`,
        [tenantId, locationId],
      );
      if (!res.rows[0]) {
        throw new ProblemException('NOT_FOUND', { detail: 'Location not found' });
      }
      return res.rows[0];
    });
  }

  async importLocationParamsCsv(tenantId: string, csvContent: string): Promise<BulkImportResult> {
    return withTenant({ tenantId }, async (tx) => {
      const lines = csvContent.trim().split(/\r?\n/);
      if (lines.length < 2) {
        return { totalRows: 0, importedCount: 0, failedCount: 0, errors: [] };
      }

      const locRes = await tx.query(
        `SELECT id, code FROM stock_locations WHERE tenant_id = $1`,
        [tenantId],
      );
      const locMap = new Map<string, string>(locRes.rows.map((r: any) => [r.code.toLowerCase(), r.id]));

      const itemRes = await tx.query(
        `SELECT id, code FROM items WHERE tenant_id = $1`,
        [tenantId],
      );
      const itemMap = new Map<string, string>(itemRes.rows.map((r: any) => [r.code.toLowerCase(), r.id]));

      const errors: { rowNumber: number; locationCode?: string; itemCode?: string; reason: string }[] = [];
      let importedCount = 0;
      let failedCount = 0;

      const header = lines[0]!.split(',').map((h) => h.trim().toLowerCase());
      const locIdx = header.findIndex((h) => h === 'location_code' || h === 'locationcode');
      const itemIdx = header.findIndex((h) => h === 'item_code' || h === 'itemcode');
      const minIdx = header.findIndex((h) => h === 'min_qty' || h === 'minqty');
      const maxIdx = header.findIndex((h) => h === 'max_qty' || h === 'maxqty');
      const parIdx = header.findIndex((h) => h === 'par_qty' || h === 'parqty');
      const reorderIdx = header.findIndex((h) => h === 'reorder_point' || h === 'reorderpoint');

      if (locIdx === -1 || itemIdx === -1) {
        throw new ProblemException('VALIDATION_FAILED', { detail: 'CSV header must include location_code and item_code' });
      }

      const totalRows = lines.length - 1;

      for (let i = 1; i < lines.length; i++) {
        const line = lines[i]!.trim();
        if (!line) continue;
        const cols = line.split(',').map((c) => c.trim());
        const locCode = cols[locIdx] ?? '';
        const itmCode = cols[itemIdx] ?? '';

        const locationId = locMap.get(locCode.toLowerCase());
        if (!locationId) {
          errors.push({ rowNumber: i + 1, locationCode: locCode, itemCode: itmCode, reason: `Location '${locCode}' not found` });
          failedCount++;
          continue;
        }

        const itemId = itemMap.get(itmCode.toLowerCase());
        if (!itemId) {
          errors.push({ rowNumber: i + 1, locationCode: locCode, itemCode: itmCode, reason: `Item '${itmCode}' not found` });
          failedCount++;
          continue;
        }

        const minQty = minIdx >= 0 && cols[minIdx] !== '' ? Number(cols[minIdx]) : 0;
        const maxQty = maxIdx >= 0 && cols[maxIdx] !== '' ? Number(cols[maxIdx]) : null;
        const parQty = parIdx >= 0 && cols[parIdx] !== '' ? Number(cols[parIdx]) : null;
        const reorderPoint = reorderIdx >= 0 && cols[reorderIdx] !== '' ? Number(cols[reorderIdx]) : null;

        if (Number.isNaN(minQty) || minQty < 0) {
          errors.push({ rowNumber: i + 1, locationCode: locCode, itemCode: itmCode, reason: 'Invalid min_qty' });
          failedCount++;
          continue;
        }

        await tx.query(
          `INSERT INTO location_item_params (tenant_id, location_id, item_id, min_qty, max_qty, par_qty, reorder_point)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (tenant_id, location_id, item_id) DO UPDATE
           SET min_qty = EXCLUDED.min_qty, max_qty = EXCLUDED.max_qty, par_qty = EXCLUDED.par_qty, reorder_point = EXCLUDED.reorder_point, updated_at = now()`,
          [tenantId, locationId, itemId, minQty, maxQty, parQty, reorderPoint],
        );
        importedCount++;
      }

      return { totalRows, importedCount, failedCount, errors };
    });
  }


  // ── Periods & Period Lock (SUP-T13, AC-20) ──────────────────────────────────

  async checkPeriodLock(tenantId: string, date: Date | string, existingTx?: any) {
    const runner = async (tx: any) => {
      const d = typeof date === 'string' ? new Date(date) : date;
      const periodStr = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
      const res = await tx.query(
        `SELECT status FROM periods WHERE tenant_id = $1 AND period = $2`,
        [tenantId, periodStr],
      );
      if (res.rows[0]?.status === 'LOCKED') {
        throw new ProblemException('PERIOD_LOCKED', {
          detail: `Accounting period ${periodStr} is closed. Backdated postings are refused.`,
        });
      }
    };

    if (existingTx) return runner(existingTx);
    return withTenant({ tenantId }, runner);
  }

  async lockPeriod(tenantId: string, userId: string, dto: PeriodActionRequest) {
    return withTenant({ tenantId, userId }, async (tx) => {
      const res = await tx.query(
        `INSERT INTO periods (tenant_id, period, status, locked_by, locked_at)
         VALUES ($1, $2, 'LOCKED', $3, now())
         ON CONFLICT (tenant_id, period) DO UPDATE
         SET status = 'LOCKED', locked_by = EXCLUDED.locked_by, locked_at = now()
         RETURNING *`,
        [tenantId, dto.period, userId],
      );
      return res.rows[0];
    });
  }

  async unlockPeriod(tenantId: string, userId: string, dto: PeriodActionRequest) {
    return withTenant({ tenantId, userId }, async (tx) => {
      const res = await tx.query(
        `UPDATE periods
         SET status = 'OPEN', locked_by = NULL, locked_at = NULL
         WHERE tenant_id = $1 AND period = $2
         RETURNING *`,
        [tenantId, dto.period],
      );
      if (!res.rows[0]) {
        throw new ProblemException('NOT_FOUND', { detail: 'Period not found' });
      }
      return res.rows[0];
    });
  }

  // ── Batches ────────────────────────────────────────────────────────────────

  async getBatch(tenantId: string, batchId: string) {
    return withTenant({ tenantId }, async (tx) => {
      const res = await tx.query(
        `SELECT b.*, i.name as item_name, i.code as item_code
         FROM stock_batches b
         JOIN items i ON i.id = b.item_id
         WHERE b.tenant_id = $1 AND b.id = $2`,
        [tenantId, batchId],
      );
      if (!res.rows[0]) {
        throw new ProblemException('NOT_FOUND', { detail: 'Batch not found' });
      }
      return res.rows[0];
    });
  }

  async quarantineBatch(tenantId: string, batchId: string, dto: QuarantineBatchRequest) {
    return withTenant({ tenantId }, async (tx) => {
      const res = await tx.query(
        `UPDATE stock_batches
         SET status = 'QUARANTINED', quarantine_reason = $1
         WHERE tenant_id = $2 AND id = $3
         RETURNING *`,
        [dto.reason, tenantId, batchId],
      );
      if (!res.rows[0]) {
        throw new ProblemException('NOT_FOUND', { detail: 'Batch not found' });
      }
      return res.rows[0];
    });
  }

  async releaseBatch(tenantId: string, batchId: string, dto: ReleaseBatchRequest) {
    return withTenant({ tenantId }, async (tx) => {
      const res = await tx.query(
        `UPDATE stock_batches
         SET status = 'AVAILABLE', quarantine_reason = NULL
         WHERE tenant_id = $1 AND id = $2
         RETURNING *`,
        [tenantId, batchId],
      );
      if (!res.rows[0]) {
        throw new ProblemException('NOT_FOUND', { detail: 'Batch not found' });
      }
      return res.rows[0];
    });
  }

  // ── Posting Service (Single-Tx Movement + Balance + Lock Guard) ─────────────
  // AC-6 (no oversell under concurrency), AC-12 (immutable ledger), AC-20 (period lock)

  async postMovement(
    tenantId: string,
    userId: string,
    requestId: string,
    dto: PostMovementRequest,
    existingTx?: any,
  ) {
    const runner = async (tx: any) => {
      // 1. Check Period Lock (AC-20)
      const occurredDate = dto.occurredAt ? new Date(dto.occurredAt) : new Date();
      await this.checkPeriodLock(tenantId, occurredDate, tx);

      if (dto.qty === 0) {
        throw new ProblemException('VALIDATION_FAILED', { detail: 'Movement quantity cannot be zero' });
      }

      // 2. Validate batch and location
      if (dto.batchId) {
        const batchRes = await tx.query(
          `SELECT id, status, expiry_date, unit_cost FROM stock_batches WHERE tenant_id = $1 AND id = $2`,
          [tenantId, dto.batchId],
        );
        if (!batchRes.rows[0]) {
          throw new ProblemException('NOT_FOUND', { detail: 'Batch not found' });
        }
        const batch = batchRes.rows[0];
        if (dto.qty < 0) {
          if (batch.status === 'QUARANTINED') {
            throw new ProblemException('BATCH_QUARANTINED', { detail: 'Batch is quarantined' });
          }
          if (batch.status === 'EXPIRED') {
            throw new ProblemException('BATCH_EXPIRED', { detail: 'Batch is expired' });
          }
          if (batch.status === 'RECALLED') {
            throw new ProblemException('BATCH_RECALLED', { detail: 'Batch is recalled' });
          }
        }
        if (!dto.unitCost && batch.unit_cost) {
          dto.unitCost = Number(batch.unit_cost);
        }
      }

      // 3. Serialized lock on stock_balances (AC-6 concurrency guard)
      // When batchId is present, we check per-batch balance.
      // If batchId is null (e.g. non-batch tracked items), we use a placeholder or handle accordingly.
      const batchKey = dto.batchId;
      if (batchKey) {
        // SELECT FOR UPDATE on stock_balances
        const balRes = await tx.query(
          `SELECT qty_on_hand, qty_reserved, hold_until
           FROM stock_balances
           WHERE tenant_id = $1 AND location_id = $2 AND batch_id = $3
           FOR UPDATE`,
          [tenantId, dto.locationId, batchKey],
        );

        const currentBalance = balRes.rows[0] ? Number(balRes.rows[0].qty_on_hand) : 0;
        const currentReserved = balRes.rows[0] ? Number(balRes.rows[0].qty_reserved) : 0;

        // AC-6: Check insufficient stock under concurrency
        if (dto.qty < 0 && currentBalance + dto.qty < 0) {
          throw new ProblemException('STOCK_INSUFFICIENT', {
            detail: `Insufficient stock on hand: requested ${Math.abs(dto.qty)}, available ${currentBalance}`,
          });
        }

        // Update or insert stock_balances
        if (balRes.rows[0]) {
          await tx.query(
            `UPDATE stock_balances
             SET qty_on_hand = stock_balances.qty_on_hand + $4,
                 last_movement_at = now()
             WHERE tenant_id = $1 AND location_id = $2 AND batch_id = $3`,
            [tenantId, dto.locationId, batchKey, dto.qty],
          );
        } else {
          await tx.query(
            `INSERT INTO stock_balances (tenant_id, location_id, batch_id, qty_on_hand, last_movement_at)
             VALUES ($1, $2, $3, $4, now())`,
            [tenantId, dto.locationId, batchKey, dto.qty],
          );
        }
      }

      // 4. Compute Hash Chain for tamper-evidence (AC-12)
      const lastMovement = await tx.query(
        `SELECT row_hash FROM stock_movements WHERE tenant_id = $1 ORDER BY occurred_at DESC, id DESC LIMIT 1`,
        [tenantId],
      );
      const prevHash = lastMovement.rows[0]?.row_hash ?? 'genesis';
      const hashData = `${prevHash}:${tenantId}:${dto.locationId}:${dto.itemId}:${dto.batchId ?? ''}:${dto.qty}:${occurredDate.toISOString()}`;
      const rowHash = createHash('sha256').update(hashData).digest('hex');

      // 5. Append to stock_movements (immutable ledger)
      const movRes = await tx.query(
        `INSERT INTO stock_movements (
           tenant_id, occurred_at, location_id, item_id, batch_id,
           qty, uom_id, unit_cost, movement_type, ref_type, ref_id,
           reversal_of, reason_code, reason_note, posted_by, request_id,
           prev_hash, row_hash
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
         RETURNING *`,
        [
          tenantId, occurredDate, dto.locationId, dto.itemId, dto.batchId ?? null,
          dto.qty, dto.uomId, dto.unitCost ?? 0, dto.movementType,
          dto.refType ?? null, dto.refId ?? null, dto.reversalOf ?? null,
          dto.reasonCode ?? null, dto.reasonNote ?? null,
          userId, requestId, prevHash, rowHash,
        ],
      );

      return movRes.rows[0];
    };

    if (existingTx) {
      return runner(existingTx);
    }
    return withTenant({ tenantId, userId }, runner);
  }

  // ── FEFO Allocation Service ────────────────────────────────────────────────

  async allocateFefo(
    tenantId: string,
    itemId: string,
    locationId: string,
    requiredQty: number,
    txClient?: any,
  ) {
    const client = txClient ?? (await getAppPool());
    // FOR UPDATE serializes concurrent FEFO allocations on the same
    // item/location (AC-6): without the row lock two transactions can both
    // read the same qty_on_hand and allocate stock that no longer exists.
    const res = await client.query(
      `SELECT b.batch_id, b.qty_on_hand, sb.lot_no, sb.expiry_date, sb.unit_cost
       FROM stock_balances b
       JOIN stock_batches sb ON sb.id = b.batch_id
       WHERE b.tenant_id = $1
         AND b.location_id = $2
         AND sb.item_id = $3
         AND sb.status = 'AVAILABLE'
         AND (b.hold_until IS NULL OR b.hold_until < now())
         AND b.qty_on_hand > 0
       ORDER BY sb.expiry_date ASC, sb.received_at ASC
       FOR UPDATE OF b`,
      [tenantId, locationId, itemId],
    );

    const allocations: Array<{
      batchId: string;
      lotNo: string;
      expiryDate: string;
      unitCost: number;
      qty: number;
    }> = [];

    let remaining = requiredQty;
    for (const row of res.rows) {
      if (remaining <= 0) break;
      const onHand = Number(row.qty_on_hand);
      const allocated = Math.min(onHand, remaining);
      allocations.push({
        batchId: row.batch_id,
        lotNo: row.lot_no,
        expiryDate: row.expiry_date,
        unitCost: Number(row.unit_cost),
        qty: allocated,
      });
      remaining -= allocated;
    }

    if (remaining > 0) {
      throw new ProblemException('STOCK_INSUFFICIENT', {
        detail: `Insufficient available stock for item. Needed ${requiredQty}, shortfall ${remaining}`,
      });
    }

    return allocations;
  }

  // ── Consumption Posting (SUP-T10) ──────────────────────────────────────────

  async postConsumption(
    tenantId: string,
    userId: string,
    requestId: string,
    dto: PostConsumptionRequest,
  ) {
    return withTenant({ tenantId, userId }, async (tx) => {
      let batchesToPost: Array<{ batchId: string; qty: number; unitCost?: number }> = [];

      if (dto.batchId) {
        batchesToPost = [{ batchId: dto.batchId, qty: dto.qty }];
      } else {
        // Auto FEFO
        const fefo = await this.allocateFefo(tenantId, dto.itemId, dto.locationId, dto.qty, tx);
        batchesToPost = fefo.map(f => ({ batchId: f.batchId, qty: f.qty, unitCost: f.unitCost }));
      }

      // For a patient-visit issue, capture a SUPPLY charge per consumption line
      // against the visit's invoice (BIL-T1). Price is resolved server-side
      // from the item's catalog service (todo §49).
      let billable: { serviceId: string | null; name: string; branchId: string | null } | null = null;
      if (dto.refType === 'VISIT' && dto.refId) {
        const itemRes = await tx.query(
          `SELECT i.name, i.service_id, l.branch_id
             FROM items i
             JOIN stock_locations l ON l.tenant_id = i.tenant_id AND l.id = $3
            WHERE i.tenant_id = $1 AND i.id = $2`,
          [tenantId, dto.itemId, dto.locationId],
        );
        const row = itemRes.rows[0];
        if (row) {
          billable = { serviceId: row.service_id ?? null, name: row.name, branchId: row.branch_id ?? null };
        }
      }

      for (const b of batchesToPost) {
        await this.postMovement(
          tenantId,
          userId,
          requestId,
          {
            locationId: dto.locationId,
            itemId: dto.itemId,
            batchId: b.batchId,
            qty: -b.qty, // negative for consumption
            uomId: dto.uomId,
            unitCost: b.unitCost,
            movementType: 'CONSUMPTION',
            refType: dto.refType,
            refId: dto.refId,
            reasonNote: dto.notes,
          },
          tx,
        );

        // Record in consumption_logs
        const logRes = await tx.query(
          `INSERT INTO consumption_logs (
             tenant_id, location_id, item_id, batch_id, qty, uom_id, ref_type, ref_id, notes, logged_by
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           RETURNING id`,
          [
            tenantId, dto.locationId, dto.itemId, b.batchId, b.qty,
            dto.uomId, dto.refType, dto.refId ?? null, dto.notes ?? null, userId,
          ],
        );

        if (billable && billable.branchId) {
          const unitPrice = billable.serviceId ? await resolveServicePrice(tx, tenantId, billable.serviceId) : 0;
          const amount = Number((b.qty * unitPrice).toFixed(2));
          await tx.query(
            `INSERT INTO billing_charges
               (tenant_id, branch_id, visit_id, charge_type, source_type, source_id, service_id, description, quantity, unit_price, amount, payer_type, posted_by)
             VALUES ($1, $2, $3, 'SUPPLY', 'consumption', $4, $5, $6, $7, $8, $9, 'PRIVATE_CASH', $10)
             ON CONFLICT (tenant_id, source_type, source_id) DO NOTHING`,
            [
              tenantId, billable.branchId, dto.refId, logRes.rows[0].id,
              billable.serviceId, billable.name, b.qty, unitPrice, amount, userId,
            ],
          );
        }
      }

      return { status: 'POSTED', allocatedCount: batchesToPost.length };
    });
  }

  // ── Goods Receipts (GRN) & Receiving (SUP-T2, AC-8) ─────────────────────────

  async listGoodsReceipts(tenantId: string, filter?: { status?: string }) {
    return withTenant({ tenantId }, async (tx) => {
      let query = `
        SELECT gr.*, s.name as supplier_name, l.name as location_name
        FROM goods_receipts gr
        JOIN suppliers s ON s.id = gr.supplier_id
        JOIN stock_locations l ON l.id = gr.location_id
        WHERE gr.tenant_id = $1
      `;
      const params: unknown[] = [tenantId];
      if (filter?.status) {
        params.push(filter.status);
        query += ` AND gr.status = $2`;
      }
      query += ` ORDER BY gr.received_at DESC`;
      const res = await tx.query(query, params);
      return res.rows;
    });
  }

  async getGoodsReceipt(tenantId: string, id: string, existingTx?: any) {
    const runner = async (tx: any) => {
      const grRes = await tx.query(
        `SELECT gr.*, s.name as supplier_name, l.name as location_name
         FROM goods_receipts gr
         JOIN suppliers s ON s.id = gr.supplier_id
         JOIN stock_locations l ON l.id = gr.location_id
         WHERE gr.tenant_id = $1 AND gr.id = $2`,
        [tenantId, id],
      );
      if (!grRes.rows[0]) {
        throw new ProblemException('NOT_FOUND', { detail: 'Goods receipt not found' });
      }

      const itemsRes = await tx.query(
        `SELECT gri.*, i.name as item_name, i.code as item_code, u.code as uom_code
         FROM goods_receipt_items gri
         JOIN items i ON i.id = gri.item_id
         JOIN uoms u ON u.id = gri.uom_id
         WHERE gri.tenant_id = $1 AND gri.grn_id = $2`,
        [tenantId, id],
      );

      return { ...grRes.rows[0], lines: itemsRes.rows };
    };

    if (existingTx) return runner(existingTx);
    return withTenant({ tenantId }, runner);
  }

  async createGrn(tenantId: string, userId: string, dto: CreateGrnRequest) {
    return withTenant({ tenantId, userId }, async (tx) => {
      const grnNo = `GRN-${Date.now()}`;
      const grRes = await tx.query(
        `INSERT INTO goods_receipts (
           tenant_id, branch_id, location_id, grn_no, po_id, supplier_id,
           delivery_note_no, received_by, status, temperature_celsius,
           temperature_ok, inspection_notes
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'DRAFT', $9, $10, $11)
         RETURNING *`,
        [
          tenantId, dto.branchId, dto.locationId, grnNo, dto.poId ?? null,
          dto.supplierId, dto.deliveryNoteNo ?? null, userId,
          dto.temperatureCelsius ?? null, dto.temperatureOk ?? true,
          dto.inspectionNotes ?? null,
        ],
      );
      const grn = grRes.rows[0];

      for (const line of dto.lines) {
        await tx.query(
          `INSERT INTO goods_receipt_items (
             tenant_id, grn_id, item_id, lot_no, expiry_date,
             qty_received, uom_id, unit_cost, inspection_result, override_reason
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            tenantId, grn.id, line.itemId, line.lotNo, line.expiryDate,
            line.qtyReceived, line.uomId, line.unitCost ?? 0,
            line.inspectionResult ?? 'ACCEPT', line.overrideReason ?? null,
          ],
        );
      }

      return this.getGoodsReceipt(tenantId, grn.id, tx);
    });
  }

  async postGrn(tenantId: string, userId: string, requestId: string, grnId: string) {
    return withTenant({ tenantId, userId }, async (tx) => {
      const grn = await this.getGoodsReceipt(tenantId, grnId, tx);
      if (grn.status !== 'DRAFT') {
        throw new ProblemException('CONFLICT', { detail: `GRN is already ${grn.status}` });
      }

      // Check Period Lock
      await this.checkPeriodLock(tenantId, grn.received_at, tx);

      const today = new Date();
      today.setUTCHours(0, 0, 0, 0);

      for (const line of grn.lines) {
        // Shelf-life rule check (AC-8)
        const itemRes = await tx.query(
          `SELECT name, min_shelf_life_days_on_receipt FROM items WHERE tenant_id = $1 AND id = $2`,
          [tenantId, line.item_id],
        );
        const item = itemRes.rows[0];
        const minShelfLife = item?.min_shelf_life_days_on_receipt ?? 0;

        if (minShelfLife > 0) {
          const expiry = new Date(line.expiry_date);
          expiry.setUTCHours(0, 0, 0, 0);
          const daysRemaining = Math.floor((expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

          if (daysRemaining < minShelfLife && !line.override_reason) {
            throw new ProblemException('SHELF_LIFE_VIOLATION', {
              detail: `Item ${item.name} has only ${daysRemaining} days remaining shelf life (minimum required: ${minShelfLife} days). An authorized override reason is required.`,
            });
          }
        }

        // Create or find stock batch
        const batchStatus = line.inspection_result === 'QUARANTINE' ? 'QUARANTINED' : 'AVAILABLE';
        const batchRes = await tx.query(
          `INSERT INTO stock_batches (
             tenant_id, item_id, lot_no, expiry_date, supplier_id, unit_cost, status, quarantine_reason
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (tenant_id, item_id, lot_no, expiry_date) DO UPDATE
           SET unit_cost = EXCLUDED.unit_cost
           RETURNING id`,
          [
            tenantId, line.item_id, line.lot_no, line.expiry_date,
            grn.supplier_id, line.unit_cost, batchStatus,
            batchStatus === 'QUARANTINED' ? 'Inspection Quarantine' : null,
          ],
        );
        const batchId = batchRes.rows[0].id;

        // Update line with batchId
        await tx.query(
          `UPDATE goods_receipt_items SET batch_id = $1 WHERE tenant_id = $2 AND id = $3`,
          [batchId, tenantId, line.id],
        );

        // Post GRN Movement
        await this.postMovement(
          tenantId,
          userId,
          requestId,
          {
            locationId: grn.location_id,
            itemId: line.item_id,
            batchId,
            qty: Number(line.qty_received), // positive
            uomId: line.uom_id,
            unitCost: Number(line.unit_cost),
            movementType: 'GRN',
            refType: 'GRN',
            refId: grn.id,
            reasonNote: line.override_reason ?? undefined,
          },
          tx,
        );

        // If tied to PO, update qty_received on purchase_order_items
        if (grn.po_id) {
          await tx.query(
            `UPDATE purchase_order_items
             SET qty_received = qty_received + $1
             WHERE tenant_id = $2 AND po_id = $3 AND item_id = $4`,
            [Number(line.qty_received), tenantId, grn.po_id, line.item_id],
          );
        }
      }

      // If tied to PO, check if fully received
      if (grn.po_id) {
        const poLines = await tx.query(
          `SELECT qty_ordered, qty_received FROM purchase_order_items WHERE tenant_id = $1 AND po_id = $2`,
          [tenantId, grn.po_id],
        );
        const allReceived = poLines.rows.every(r => Number(r.qty_received) >= Number(r.qty_ordered));
        const anyReceived = poLines.rows.some(r => Number(r.qty_received) > 0);
        const nextStatus = allReceived ? 'RECEIVED' : anyReceived ? 'PARTIALLY_RECEIVED' : 'APPROVED';
        await tx.query(
          `UPDATE purchase_orders SET status = $1, updated_at = now() WHERE tenant_id = $2 AND id = $3`,
          [nextStatus, tenantId, grn.po_id],
        );
      }

      // Mark GRN as POSTED
      await tx.query(
        `UPDATE goods_receipts SET status = 'POSTED', updated_at = now() WHERE tenant_id = $1 AND id = $2`,
        [tenantId, grnId],
      );

      return this.getGoodsReceipt(tenantId, grnId, tx);
    });
  }

  async voidGrn(tenantId: string, userId: string, requestId: string, grnId: string, dto: VoidGrnRequest) {
    return withTenant({ tenantId, userId }, async (tx) => {
      const grn = await this.getGoodsReceipt(tenantId, grnId, tx);
      if (grn.status !== 'POSTED') {
        throw new ProblemException('CONFLICT', { detail: `Only POSTED receipts can be voided` });
      }

      // Check period lock
      await this.checkPeriodLock(tenantId, new Date(), tx);

      // Reverse movements
      for (const line of grn.lines) {
        await this.postMovement(
          tenantId,
          userId,
          requestId,
          {
            locationId: grn.location_id,
            itemId: line.item_id,
            batchId: line.batch_id,
            qty: -Number(line.qty_received), // negative to reverse
            uomId: line.uom_id,
            unitCost: Number(line.unit_cost),
            movementType: 'REVERSAL',
            refType: 'GRN_VOID',
            refId: grn.id,
            reasonNote: dto.reason,
          },
          tx,
        );
      }

      await tx.query(
        `UPDATE goods_receipts SET status = 'VOID', void_reason = $1, updated_at = now() WHERE tenant_id = $2 AND id = $3`,
        [dto.reason, tenantId, grnId],
      );

      return { status: 'VOID', id: grnId };
    });
  }

  // ── Purchase Requests (PR) & Purchase Orders (PO) (SUP-T1) ─────────────────

  async listPurchaseRequests(tenantId: string) {
    return withTenant({ tenantId }, async (tx) => {
      const res = await tx.query(
        `SELECT pr.*, u.name as requester_name, l.name as location_name
         FROM purchase_requests pr
         JOIN users u ON u.id = pr.requester_id
         JOIN stock_locations l ON l.id = pr.location_id
         WHERE pr.tenant_id = $1
         ORDER BY pr.created_at DESC`,
        [tenantId],
      );
      return res.rows;
    });
  }

  async getPurchaseRequest(tenantId: string, id: string) {
    return withTenant({ tenantId }, async (tx) => {
      const res = await tx.query(
        `SELECT pr.*, u.name as requester_name, l.name as location_name
         FROM purchase_requests pr
         JOIN users u ON u.id = pr.requester_id
         JOIN stock_locations l ON l.id = pr.location_id
         WHERE pr.tenant_id = $1 AND pr.id = $2`,
        [tenantId, id],
      );
      if (!res.rows[0]) throw new ProblemException('NOT_FOUND', { detail: 'Purchase request not found' });
      const items = await tx.query(
        `SELECT pri.*, i.code as item_code, i.name as item_name, u.code as uom_code
         FROM purchase_request_items pri
         JOIN items i ON i.id = pri.item_id
         JOIN uoms u ON u.id = pri.uom_id
         WHERE pri.tenant_id = $1 AND pri.pr_id = $2`,
        [tenantId, id],
      );
      return { ...res.rows[0], items: items.rows };
    });
  }

  async createPr(tenantId: string, userId: string, dto: CreatePrRequest) {
    return this.createPurchaseRequest(tenantId, userId, dto);
  }

  async getPr(tenantId: string, id: string) {
    return this.getPurchaseRequest(tenantId, id);
  }

  async createPurchaseRequest(tenantId: string, userId: string, dto: CreatePrRequest) {
    return withTenant({ tenantId, userId }, async (tx) => {
      const prNo = `PR-${Date.now()}`;
      const prRes = await tx.query(
        `INSERT INTO purchase_requests (
           tenant_id, branch_id, pr_no, requester_id, location_id, needed_by, reason, status
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'DRAFT')
         RETURNING *`,
        [
          tenantId, dto.branchId, prNo, userId, dto.locationId,
          dto.neededBy ?? null, dto.reason ?? null,
        ],
      );
      const pr = prRes.rows[0];

      for (const item of dto.items) {
        await tx.query(
          `INSERT INTO purchase_request_items (tenant_id, pr_id, item_id, qty_requested, uom_id, notes)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [tenantId, pr.id, item.itemId, item.qtyRequested, item.uomId, item.notes ?? null],
        );
      }

      return pr;
    });
  }

  async submitPurchaseRequest(tenantId: string, id: string) {
    return withTenant({ tenantId }, async (tx) => {
      const res = await tx.query(
        `UPDATE purchase_requests SET status = 'SUBMITTED', updated_at = now()
         WHERE tenant_id = $1 AND id = $2 AND status = 'DRAFT'
         RETURNING *`,
        [tenantId, id],
      );
      if (!res.rows[0]) throw new ProblemException('CONFLICT', { detail: 'PR not found or not in DRAFT' });
      return res.rows[0];
    });
  }

  async approvePurchaseRequest(tenantId: string, userId: string, id: string) {
    return withTenant({ tenantId, userId }, async (tx) => {
      const res = await tx.query(
        `UPDATE purchase_requests
         SET status = 'APPROVED', approved_by = $1, approved_at = now(), updated_at = now()
         WHERE tenant_id = $2 AND id = $3 AND status = 'SUBMITTED'
         RETURNING *`,
        [userId, tenantId, id],
      );
      if (!res.rows[0]) throw new ProblemException('CONFLICT', { detail: 'PR not found or not in SUBMITTED' });
      return res.rows[0];
    });
  }

  async convertPrToPo(tenantId: string, userId: string, prId: string, dto: ConvertPrToPoRequest) {
    return withTenant({ tenantId, userId }, async (tx) => {
      const prRes = await tx.query(
        `SELECT * FROM purchase_requests WHERE tenant_id = $1 AND id = $2 AND status = 'APPROVED'`,
        [tenantId, prId],
      );
      if (!prRes.rows[0]) throw new ProblemException('CONFLICT', { detail: 'PR not found or not APPROVED' });
      const pr = prRes.rows[0];

      const itemsRes = await tx.query(
        `SELECT pri.*, COALESCE(si.last_price, i.standard_cost, 0) as unit_price
         FROM purchase_request_items pri
         JOIN items i ON i.id = pri.item_id
         LEFT JOIN supplier_items si ON si.supplier_id = $1 AND si.item_id = pri.item_id
         WHERE pri.tenant_id = $2 AND pri.pr_id = $3`,
        [dto.supplierId, tenantId, prId],
      );

      const poItems = itemsRes.rows.map(r => ({
        itemId: r.item_id,
        qtyOrdered: Number(r.qty_requested),
        unitPrice: Number(r.unit_price),
        uomId: r.uom_id,
      }));

      const po = await this.createPo(tenantId, userId, {
        branchId: pr.branch_id,
        supplierId: dto.supplierId,
        expectedDate: dto.expectedDate,
        termsDays: dto.termsDays ?? 30,
        items: poItems,
      }, tx);

      await tx.query(
        `UPDATE purchase_requests SET status = 'CONVERTED', updated_at = now() WHERE tenant_id = $1 AND id = $2`,
        [tenantId, prId],
      );

      return po;
    });
  }

  async listPurchaseOrders(tenantId: string) {
    return withTenant({ tenantId }, async (tx) => {
      const res = await tx.query(
        `SELECT po.*, s.name as supplier_name
         FROM purchase_orders po
         JOIN suppliers s ON s.id = po.supplier_id
         WHERE po.tenant_id = $1
         ORDER BY po.created_at DESC`,
        [tenantId],
      );
      return res.rows;
    });
  }

  async getPo(tenantId: string, id: string) {
    return withTenant({ tenantId }, async (tx) => {
      const res = await tx.query(
        `SELECT po.*, s.name as supplier_name, b.name as branch_name
         FROM purchase_orders po
         JOIN suppliers s ON s.id = po.supplier_id
         JOIN branches b ON b.id = po.branch_id
         WHERE po.tenant_id = $1 AND po.id = $2`,
        [tenantId, id],
      );
      if (!res.rows[0]) throw new ProblemException('NOT_FOUND', { detail: 'Purchase order not found' });
      const items = await tx.query(
        `SELECT poi.*, i.code as item_code, i.name as item_name, u.code as uom_code
         FROM purchase_order_items poi
         JOIN items i ON i.id = poi.item_id
         JOIN uoms u ON u.id = poi.uom_id
         WHERE poi.tenant_id = $1 AND poi.po_id = $2`,
        [tenantId, id],
      );
      return { ...res.rows[0], items: items.rows };
    });
  }

  async createPo(tenantId: string, userId: string, dto: CreatePoSchemaType, existingTx?: any) {
    const runner = async (tx: any) => {
      const poNo = `PO-${Date.now()}`;
      let total = 0;
      for (const item of dto.items) {
        total += item.qtyOrdered * item.unitPrice;
      }

      const poRes = await tx.query(
        `INSERT INTO purchase_orders (
           tenant_id, branch_id, po_no, supplier_id, status, expected_date,
           terms_days, subtotal, total, created_by
         )
         VALUES ($1, $2, $3, $4, 'DRAFT', $5, $6, $7, $8, $9)
         RETURNING *`,
        [
          tenantId, dto.branchId, poNo, dto.supplierId, dto.expectedDate ?? null,
          dto.termsDays ?? 30, total, total, userId,
        ],
      );
      const po = poRes.rows[0];

      for (const item of dto.items) {
        const itemTotal = item.qtyOrdered * item.unitPrice;
        await tx.query(
          `INSERT INTO purchase_order_items (
             tenant_id, po_id, item_id, qty_ordered, unit_price, uom_id, total_price
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [tenantId, po.id, item.itemId, item.qtyOrdered, item.unitPrice, item.uomId, itemTotal],
        );
      }

      return po;
    };

    if (existingTx) return runner(existingTx);
    return withTenant({ tenantId, userId }, runner);
  }

  async submitPo(tenantId: string, id: string) {
    return withTenant({ tenantId }, async (tx) => {
      const res = await tx.query(
        `UPDATE purchase_orders SET status = 'SUBMITTED', updated_at = now()
         WHERE tenant_id = $1 AND id = $2 AND status = 'DRAFT'
         RETURNING *`,
        [tenantId, id],
      );
      if (!res.rows[0]) throw new ProblemException('CONFLICT', { detail: 'PO not found or not DRAFT' });
      return res.rows[0];
    });
  }

  async approvePo(tenantId: string, userId: string, id: string) {
    return withTenant({ tenantId, userId }, async (tx) => {
      const existing = await tx.query(
        `SELECT created_by, status FROM purchase_orders WHERE tenant_id = $1 AND id = $2`,
        [tenantId, id],
      );
      if (!existing.rows[0]) throw new ProblemException('NOT_FOUND', { detail: 'PO not found' });
      if (existing.rows[0].status !== 'SUBMITTED') {
        throw new ProblemException('CONFLICT', { detail: 'PO is not in SUBMITTED status' });
      }

      // Segregation of Duties check (SoD): Creator cannot approve PO
      if (existing.rows[0].created_by === userId) {
        throw new ProblemException('SEGREGATION_OF_DUTIES', {
          detail: 'Creator cannot approve purchase order (Segregation of Duties required)',
        });
      }

      const res = await tx.query(
        `UPDATE purchase_orders
         SET status = 'APPROVED', approved_by = $1, approved_at = now(), updated_at = now()
         WHERE tenant_id = $2 AND id = $3
         RETURNING *`,
        [userId, tenantId, id],
      );
      return res.rows[0];
    });
  }

  async sendPo(tenantId: string, id: string) {
    return withTenant({ tenantId }, async (tx) => {
      const res = await tx.query(
        `UPDATE purchase_orders SET status = 'SENT', updated_at = now()
         WHERE tenant_id = $1 AND id = $2 AND status = 'APPROVED'
         RETURNING *`,
        [tenantId, id],
      );
      if (!res.rows[0]) throw new ProblemException('CONFLICT', { detail: 'PO not found or not APPROVED' });
      return res.rows[0];
    });
  }

  async closePo(tenantId: string, id: string) {
    return withTenant({ tenantId }, async (tx) => {
      const res = await tx.query(
        `UPDATE purchase_orders SET status = 'CLOSED', updated_at = now()
         WHERE tenant_id = $1 AND id = $2 AND status IN ('APPROVED', 'SENT', 'PARTIALLY_RECEIVED', 'RECEIVED')
         RETURNING *`,
        [tenantId, id],
      );
      if (!res.rows[0]) throw new ProblemException('CONFLICT', { detail: 'PO not found or cannot be closed in current status' });
      return res.rows[0];
    });
  }

  // ── Supplier Invoices & 3-Way Match (SUP-T2, todo §4.3) ──────────────────────

  async createSupplierInvoice(tenantId: string, userId: string, dto: CreateSupplierInvoiceRequest) {
    return withTenant({ tenantId, userId }, async (tx) => {
      let matchStatus: 'MATCHED' | 'VARIANCE' = 'MATCHED';

      if (dto.grnId) {
        const grnRes = await tx.query(
          `SELECT received_by FROM goods_receipts WHERE tenant_id = $1 AND id = $2`,
          [tenantId, dto.grnId],
        );
        if (!grnRes.rows[0]) throw new ProblemException('NOT_FOUND', { detail: 'Goods receipt not found' });

        // Segregation of Duties: User who received/posted GRN cannot match invoice
        if (grnRes.rows[0].received_by === userId) {
          throw new ProblemException('SEGREGATION_OF_DUTIES', {
            detail: 'User who received/posted GRN cannot match supplier invoice (Segregation of Duties required)',
          });
        }

        const linesRes = await tx.query(
          `SELECT COALESCE(SUM(qty_received * unit_cost), 0)::numeric as grn_total
           FROM goods_receipt_items
           WHERE tenant_id = $1 AND grn_id = $2`,
          [tenantId, dto.grnId],
        );
        const grnTotal = Number(linesRes.rows[0]?.grn_total ?? 0);
        if (Math.abs(grnTotal - dto.amount) >= 0.01) {
          matchStatus = 'VARIANCE';
        }
      }

      const res = await tx.query(
        `INSERT INTO supplier_invoices (tenant_id, invoice_no, po_id, grn_id, amount, match_status)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [tenantId, dto.invoiceNo, dto.poId ?? null, dto.grnId ?? null, dto.amount, matchStatus],
      );
      return res.rows[0];
    });
  }

  async listSupplierInvoices(tenantId: string) {
    return withTenant({ tenantId }, async (tx) => {
      const res = await tx.query(
        `SELECT si.*, po.po_no, gr.grn_no
         FROM supplier_invoices si
         LEFT JOIN purchase_orders po ON po.id = si.po_id
         LEFT JOIN goods_receipts gr ON gr.id = si.grn_id
         WHERE si.tenant_id = $1
         ORDER BY si.created_at DESC`,
        [tenantId],
      );
      return res.rows;
    });
  }

  // ── Supplier Returns (SUP-T7, todo §4.3) ────────────────────────────────────

  async createSupplierReturn(tenantId: string, userId: string, dto: CreateSupplierReturnRequest) {
    return withTenant({ tenantId, userId }, async (tx) => {
      const rtvNo = `RTV-${Date.now()}`;
      const res = await tx.query(
        `INSERT INTO supplier_returns (tenant_id, supplier_id, rtv_no, reason, status)
         VALUES ($1, $2, $3, $4, 'DRAFT')
         RETURNING *`,
        [tenantId, dto.supplierId, rtvNo, dto.reason],
      );
      const ret = res.rows[0];

      for (const itm of dto.items) {
        await tx.query(
          `INSERT INTO supplier_return_items (tenant_id, return_id, item_id, batch_id, qty, unit_cost)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [tenantId, ret.id, itm.itemId, itm.batchId, itm.qty, itm.unitCost ?? 0],
        );
      }

      const itemsRes = await tx.query(
        `SELECT sri.*, i.name as item_name, i.code as item_code, sb.lot_no
         FROM supplier_return_items sri
         JOIN items i ON i.id = sri.item_id
         JOIN stock_batches sb ON sb.id = sri.batch_id
         WHERE sri.tenant_id = $1 AND sri.return_id = $2`,
        [tenantId, ret.id],
      );

      return { ...ret, items: itemsRes.rows };
    });
  }

  async postSupplierReturn(tenantId: string, userId: string, requestId: string, returnId: string, locationId: string) {
    return withTenant({ tenantId, userId }, async (tx) => {
      const retRes = await tx.query(
        `SELECT * FROM supplier_returns WHERE tenant_id = $1 AND id = $2`,
        [tenantId, returnId],
      );
      if (!retRes.rows[0]) throw new ProblemException('NOT_FOUND', { detail: 'Return not found' });
      if (retRes.rows[0].status !== 'DRAFT') {
        throw new ProblemException('CONFLICT', { detail: 'Return already processed' });
      }

      await this.checkPeriodLock(tenantId, new Date(), tx);

      const itemsRes = await tx.query(
        `SELECT * FROM supplier_return_items WHERE tenant_id = $1 AND return_id = $2`,
        [tenantId, returnId],
      );

      for (const line of itemsRes.rows) {
        const itemRes = await tx.query(`SELECT base_uom_id FROM items WHERE tenant_id = $1 AND id = $2`, [tenantId, line.item_id]);
        const baseUomId = itemRes.rows[0]?.base_uom_id;
        await this.postMovement(
          tenantId,
          userId,
          `${requestId}-ret-${line.id}`,
          {
            locationId,
            itemId: line.item_id,
            batchId: line.batch_id,
            uomId: baseUomId,
            movementType: 'SUPPLIER_RETURN',
            qty: -Number(line.qty),
            unitCost: Number(line.unit_cost),
            refType: 'SUPPLIER_RETURN',
            refId: returnId,
          },
          tx,
        );
      }

      const updated = await tx.query(
        `UPDATE supplier_returns SET status = 'POSTED'
         WHERE tenant_id = $1 AND id = $2
         RETURNING *`,
        [tenantId, returnId],
      );
      return updated.rows[0];
    });
  }


  // ── Requisitions & Issues (SUP-T3, AC-9) ────────────────────────────────────

  async listRequisitions(tenantId: string) {
    return withTenant({ tenantId }, async (tx) => {
      const res = await tx.query(
        `SELECT r.*, fl.name as from_location_name, tl.name as to_location_name
         FROM requisitions r
         JOIN stock_locations fl ON fl.id = r.from_location_id
         JOIN stock_locations tl ON tl.id = r.to_location_id
         WHERE r.tenant_id = $1
         ORDER BY r.created_at DESC`,
        [tenantId],
      );
      return res.rows;
    });
  }

  async getRequisition(tenantId: string, id: string) {
    return withTenant({ tenantId }, async (tx) => {
      const res = await tx.query(
        `SELECT r.*, fl.name as from_location_name, tl.name as to_location_name
         FROM requisitions r
         JOIN stock_locations fl ON fl.id = r.from_location_id
         JOIN stock_locations tl ON tl.id = r.to_location_id
         WHERE r.tenant_id = $1 AND r.id = $2`,
        [tenantId, id],
      );
      if (!res.rows[0]) throw new ProblemException('NOT_FOUND', { detail: 'Requisition not found' });
      const items = await tx.query(
        `SELECT ri.*, i.code as item_code, i.name as item_name, u.code as uom_code
         FROM requisition_items ri
         JOIN items i ON i.id = ri.item_id
         JOIN uoms u ON u.id = ri.uom_id
         WHERE ri.tenant_id = $1 AND ri.requisition_id = $2`,
        [tenantId, id],
      );
      return { ...res.rows[0], items: items.rows };
    });
  }

  async createRequisition(tenantId: string, userId: string, dto: CreateRequisitionRequest) {
    return withTenant({ tenantId, userId }, async (tx) => {
      const reqNo = `REQ-${Date.now()}`;
      const rRes = await tx.query(
        `INSERT INTO requisitions (
           tenant_id, branch_id, req_no, from_location_id, to_location_id,
           type, status, needed_by, requested_by
         )
         VALUES ($1, $2, $3, $4, $5, $6, 'DRAFT', $7, $8)
         RETURNING *`,
        [
          tenantId, dto.branchId, reqNo, dto.fromLocationId, dto.toLocationId,
          dto.type ?? 'ADHOC', dto.neededBy ?? null, userId,
        ],
      );
      const req = rRes.rows[0];

      for (const item of dto.items) {
        await tx.query(
          `INSERT INTO requisition_items (tenant_id, requisition_id, item_id, qty_requested, uom_id)
           VALUES ($1, $2, $3, $4, $5)`,
          [tenantId, req.id, item.itemId, item.qtyRequested, item.uomId],
        );
      }

      return req;
    });
  }

  async submitRequisition(tenantId: string, id: string) {
    return withTenant({ tenantId }, async (tx) => {
      const res = await tx.query(
        `UPDATE requisitions SET status = 'SUBMITTED', updated_at = now()
         WHERE tenant_id = $1 AND id = $2 AND status = 'DRAFT'
         RETURNING *`,
        [tenantId, id],
      );
      if (!res.rows[0]) throw new ProblemException('CONFLICT', { detail: 'Requisition not found or not in DRAFT' });
      return res.rows[0];
    });
  }

  async approveRequisition(tenantId: string, userId: string, id: string) {
    return withTenant({ tenantId, userId }, async (tx) => {
      const res = await tx.query(
        `UPDATE requisitions
         SET status = 'APPROVED', approved_by = $1, approved_at = now(), updated_at = now()
         WHERE tenant_id = $2 AND id = $3 AND status = 'SUBMITTED'
         RETURNING *`,
        [userId, tenantId, id],
      );
      if (!res.rows[0]) {
        const check = await tx.query(`SELECT id FROM requisitions WHERE tenant_id = $1 AND id = $2`, [tenantId, id]);
        if (!check.rows[0]) throw new ProblemException('NOT_FOUND', { detail: 'Requisition not found' });
        throw new ProblemException('CONFLICT', { detail: 'Requisition not in SUBMITTED status' });
      }

      // Default approved qty = requested qty
      await tx.query(
        `UPDATE requisition_items SET qty_approved = qty_requested WHERE tenant_id = $1 AND requisition_id = $2`,
        [tenantId, id],
      );
      return res.rows[0];
    });
  }

  async createIssue(tenantId: string, userId: string, requestId: string, dto: CreateIssueRequest) {
    return withTenant({ tenantId, userId }, async (tx) => {
      const reqRes = await tx.query(
        `SELECT * FROM requisitions WHERE tenant_id = $1 AND id = $2 AND status IN ('APPROVED', 'PARTIALLY_ISSUED')`,
        [tenantId, dto.requisitionId],
      );
      if (!reqRes.rows[0]) {
        throw new ProblemException('CONFLICT', { detail: 'Requisition not found or not approved' });
      }
      const req = reqRes.rows[0];

      const issueNo = `ISSUE-${Date.now()}`;
      const issueRes = await tx.query(
        `INSERT INTO stock_issues (
           tenant_id, requisition_id, issue_no, from_location_id, to_location_id, issued_by, status
         )
         VALUES ($1, $2, $3, $4, $5, $6, 'ISSUED')
         RETURNING *`,
        [tenantId, req.id, issueNo, req.to_location_id, req.from_location_id, userId],
      );
      const issue = issueRes.rows[0];

      for (const line of dto.lines) {
        // Fetch item UOM
        const itemRes = await tx.query(
          `SELECT base_uom_id FROM items WHERE tenant_id = $1 AND id = $2`,
          [tenantId, line.itemId],
        );
        const uomId = itemRes.rows[0]?.base_uom_id;

        // Post ISSUE_OUT from store location (decreases on-hand)
        await this.postMovement(
          tenantId,
          userId,
          requestId,
          {
            locationId: req.to_location_id,
            itemId: line.itemId,
            batchId: line.batchId,
            qty: -line.qtyIssued, // negative
            uomId,
            movementType: 'ISSUE_OUT',
            refType: 'ISSUE',
            refId: issue.id,
          },
          tx,
        );

        // Record stock_issue_items
        await tx.query(
          `INSERT INTO stock_issue_items (tenant_id, issue_id, item_id, batch_id, qty_issued)
           VALUES ($1, $2, $3, $4, $5)`,
          [tenantId, issue.id, line.itemId, line.batchId, line.qtyIssued],
        );

        // Update requisition item qty_issued
        await tx.query(
          `UPDATE requisition_items
           SET qty_issued = qty_issued + $1
           WHERE tenant_id = $2 AND requisition_id = $3 AND item_id = $4`,
          [line.qtyIssued, tenantId, req.id, line.itemId],
        );
      }

      await tx.query(
        `UPDATE requisitions SET status = 'ISSUED', updated_at = now() WHERE tenant_id = $1 AND id = $2`,
        [tenantId, req.id],
      );

      return issue;
    });
  }

  async acknowledgeRequisition(
    tenantId: string,
    userId: string,
    requestId: string,
    dto: AcknowledgeRequisitionRequest,
  ) {
    return withTenant({ tenantId, userId }, async (tx) => {
      const issueRes = await tx.query(
        `SELECT i.*, r.id as req_id, r.from_location_id as dest_location_id
         FROM stock_issues i
         JOIN requisitions r ON r.id = i.requisition_id
         WHERE i.tenant_id = $1 AND i.id = $2 AND i.status = 'ISSUED'`,
        [tenantId, dto.issueId],
      );
      if (!issueRes.rows[0]) {
        throw new ProblemException('CONFLICT', { detail: 'Issue not found or already acknowledged' });
      }
      const issue = issueRes.rows[0];

      let hasDiscrepancy = false;

      for (const line of dto.lines) {
        const itemRes = await tx.query(
          `SELECT base_uom_id FROM items WHERE tenant_id = $1 AND id = $2`,
          [tenantId, line.itemId],
        );
        const uomId = itemRes.rows[0]?.base_uom_id;

        // Post ISSUE_IN to destination location (increases destination on-hand)
        if (line.qtyReceived > 0) {
          await this.postMovement(
            tenantId,
            userId,
            requestId,
            {
              locationId: issue.dest_location_id,
              itemId: line.itemId,
              batchId: line.batchId,
              qty: line.qtyReceived, // positive
              uomId,
              movementType: 'ISSUE_IN',
              refType: 'ISSUE_ACK',
              refId: issue.id,
              reasonNote: line.discrepancyReason ?? undefined,
            },
            tx,
          );
        }

        // Update issue line
        const issueLine = await tx.query(
          `SELECT qty_issued FROM stock_issue_items
           WHERE tenant_id = $1 AND issue_id = $2 AND item_id = $3 AND batch_id = $4`,
          [tenantId, issue.id, line.itemId, line.batchId],
        );
        const qtyIssued = Number(issueLine.rows[0]?.qty_issued ?? 0);
        if (line.qtyReceived !== qtyIssued) {
          hasDiscrepancy = true;
        }

        await tx.query(
          `UPDATE stock_issue_items
           SET qty_received = $1, discrepancy_reason = $2
           WHERE tenant_id = $3 AND issue_id = $4 AND item_id = $5 AND batch_id = $6`,
          [line.qtyReceived, line.discrepancyReason ?? null, tenantId, issue.id, line.itemId, line.batchId],
        );
      }

      const issueStatus = hasDiscrepancy ? 'DISCREPANCY' : 'ACKNOWLEDGED';
      await tx.query(
        `UPDATE stock_issues SET status = $1 WHERE tenant_id = $2 AND id = $3`,
        [issueStatus, tenantId, issue.id],
      );

      await tx.query(
        `UPDATE requisitions SET status = 'ACKNOWLEDGED', updated_at = now() WHERE tenant_id = $1 AND id = $2`,
        [tenantId, issue.req_id],
      );

      return { status: issueStatus, issueId: issue.id };
    });
  }

  // ── Stock Adjustments (SUP-T5) ──────────────────────────────────────────────

  async listAdjustments(tenantId: string) {
    return withTenant({ tenantId }, async (tx) => {
      const res = await tx.query(
        `SELECT a.*, l.name as location_name
         FROM stock_adjustments a
         JOIN stock_locations l ON l.id = a.location_id
         WHERE a.tenant_id = $1
         ORDER BY a.created_at DESC`,
        [tenantId],
      );
      return res.rows;
    });
  }

  async getAdjustment(tenantId: string, id: string) {
    return withTenant({ tenantId }, async (tx) => {
      const res = await tx.query(
        `SELECT a.*, l.name as location_name
         FROM stock_adjustments a
         JOIN stock_locations l ON l.id = a.location_id
         WHERE a.tenant_id = $1 AND a.id = $2`,
        [tenantId, id],
      );
      if (!res.rows[0]) throw new ProblemException('NOT_FOUND', { detail: 'Adjustment not found' });
      const lines = await tx.query(
        `SELECT sai.*, i.code as item_code, i.name as item_name
         FROM stock_adjustment_items sai
         JOIN items i ON i.id = sai.item_id
         WHERE sai.tenant_id = $1 AND sai.adjustment_id = $2`,
        [tenantId, id],
      );
      return { ...res.rows[0], lines: lines.rows };
    });
  }

  async createAdjustment(tenantId: string, userId: string, dto: CreateAdjustmentRequest) {
    return withTenant({ tenantId, userId }, async (tx) => {
      const adjNo = `ADJ-${Date.now()}`;
      const adjRes = await tx.query(
        `INSERT INTO stock_adjustments (
           tenant_id, branch_id, adj_no, location_id, reason_code, status, requested_by
         )
         VALUES ($1, $2, $3, $4, $5, 'DRAFT', $6)
         RETURNING *`,
        [tenantId, dto.branchId, adjNo, dto.locationId, dto.reasonCode, userId],
      );
      const adj = adjRes.rows[0];

      for (const line of dto.lines) {
        await tx.query(
          `INSERT INTO stock_adjustment_items (
             tenant_id, adjustment_id, item_id, batch_id, qty_delta, unit_cost, notes
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            tenantId, adj.id, line.itemId, line.batchId ?? null,
            line.qtyDelta, line.unitCost ?? 0, line.notes ?? null,
          ],
        );
      }

      return adj;
    });
  }

  async submitAdjustment(tenantId: string, id: string) {
    return withTenant({ tenantId }, async (tx) => {
      const res = await tx.query(
        `UPDATE stock_adjustments SET status = 'PENDING', updated_at = now()
         WHERE tenant_id = $1 AND id = $2 AND status = 'DRAFT'
         RETURNING *`,
        [tenantId, id],
      );
      if (!res.rows[0]) throw new ProblemException('CONFLICT', { detail: 'Adjustment not found or not in DRAFT' });
      return res.rows[0];
    });
  }

  async approveAndPostAdjustment(tenantId: string, userId: string, requestId: string, id: string) {
    return withTenant({ tenantId, userId }, async (tx) => {
      const adjRes = await tx.query(
        `SELECT * FROM stock_adjustments WHERE tenant_id = $1 AND id = $2`,
        [tenantId, id],
      );
      if (!adjRes.rows[0]) throw new ProblemException('NOT_FOUND', { detail: 'Adjustment not found' });
      const adj = adjRes.rows[0];

      if (adj.status !== 'PENDING') {
        throw new ProblemException('CONFLICT', { detail: 'Adjustment is not in PENDING status' });
      }

      // SoD check: creator cannot approve/post adjustment
      if (adj.requested_by === userId) {
        throw new ProblemException('SEGREGATION_OF_DUTIES', {
          detail: 'Adjustment creator cannot approve or post adjustment (Segregation of Duties)',
        });
      }

      const itemsRes = await tx.query(
        `SELECT ai.*, i.base_uom_id
         FROM stock_adjustment_items ai
         JOIN items i ON i.id = ai.item_id
         WHERE ai.tenant_id = $1 AND ai.adjustment_id = $2`,
        [tenantId, id],
      );

      let totalAbsValue = 0;
      for (const line of itemsRes.rows) {
        const delta = Number(line.qty_delta);
        totalAbsValue += Math.abs(delta) * Number(line.unit_cost);
      }
      
      const MAX_ADJUSTMENT_VALUE = 50000;
      if (totalAbsValue > MAX_ADJUSTMENT_VALUE) {
        throw new ProblemException('VALIDATION_FAILED', {
          detail: `Adjustment total value (${totalAbsValue.toFixed(2)}) exceeds maximum allowed threshold of ${MAX_ADJUSTMENT_VALUE}. Requires manual director override.`,
        });
      }

      for (const line of itemsRes.rows) {
        const delta = Number(line.qty_delta);
        const movementType = delta > 0 ? 'ADJ_GAIN' : 'ADJ_LOSS';

        await this.postMovement(
          tenantId,
          userId,
          requestId,
          {
            locationId: adj.location_id,
            itemId: line.item_id,
            batchId: line.batch_id ?? undefined,
            qty: delta,
            uomId: line.base_uom_id,
            unitCost: Number(line.unit_cost),
            movementType,
            refType: 'ADJUSTMENT',
            refId: adj.id,
            reasonCode: adj.reason_code,
            reasonNote: line.notes ?? undefined,
          },
          tx,
        );
      }

      await tx.query(
        `UPDATE stock_adjustments
         SET status = 'POSTED', approved_by = $1, approved_at = now(), updated_at = now()
         WHERE tenant_id = $2 AND id = $3`,
        [userId, tenantId, id],
      );

      return { status: 'POSTED', id };
    });
  }

  // ── Physical Counts (SUP-T6) ────────────────────────────────────────────────

  async listCounts(tenantId: string) {
    return withTenant({ tenantId }, async (tx) => {
      const res = await tx.query(
        `SELECT c.*, l.name as location_name
         FROM physical_counts c
         JOIN stock_locations l ON l.id = c.location_id
         WHERE c.tenant_id = $1
         ORDER BY c.created_at DESC`,
        [tenantId],
      );
      return res.rows;
    });
  }

  async createCount(tenantId: string, userId: string, dto: CreateCountRequest) {
    return withTenant({ tenantId, userId }, async (tx) => {
      const countNo = `CNT-${Date.now()}`;
      const cntRes = await tx.query(
        `INSERT INTO physical_counts (
           tenant_id, branch_id, count_no, location_id, type, blind, snapshot_at, status, created_by
         )
         VALUES ($1, $2, $3, $4, $5, $6, now(), 'COUNTING', $7)
         RETURNING *`,
        [tenantId, dto.branchId, countNo, dto.locationId, dto.type ?? 'FULL', dto.blind ?? false, userId],
      );
      const count = cntRes.rows[0];

      // Snapshot system quantities
      const balances = await tx.query(
        `SELECT b.batch_id, b.qty_on_hand, sb.item_id
         FROM stock_balances b
         JOIN stock_batches sb ON sb.id = b.batch_id
         WHERE b.tenant_id = $1 AND b.location_id = $2 AND b.qty_on_hand > 0`,
        [tenantId, dto.locationId],
      );

      for (const row of balances.rows) {
        await tx.query(
          `INSERT INTO physical_count_items (tenant_id, count_id, item_id, batch_id, system_qty)
           VALUES ($1, $2, $3, $4, $5)`,
          [tenantId, count.id, row.item_id, row.batch_id, row.qty_on_hand],
        );
      }

      return count;
    });
  }

  async enterCountLines(tenantId: string, countId: string, dto: EnterCountLinesRequest) {
    return withTenant({ tenantId }, async (tx) => {
      for (const line of dto.lines) {
        await tx.query(
          `UPDATE physical_count_items
           SET counted_qty = $1, variance = $1 - system_qty, notes = $2
           WHERE tenant_id = $3 AND count_id = $4 AND item_id = $5 AND batch_id = $6`,
          [line.countedQty, line.notes ?? null, tenantId, countId, line.itemId, line.batchId],
        );
      }

      await tx.query(
        `UPDATE physical_counts SET status = 'REVIEW' WHERE tenant_id = $1 AND id = $2`,
        [tenantId, countId],
      );

      return { status: 'REVIEW', countId };
    });
  }

  async postCount(tenantId: string, userId: string, requestId: string, countId: string) {
    return withTenant({ tenantId, userId }, async (tx) => {
      const cntRes = await tx.query(
        `SELECT * FROM physical_counts WHERE tenant_id = $1 AND id = $2`,
        [tenantId, countId],
      );
      if (!cntRes.rows[0]) throw new ProblemException('NOT_FOUND', { detail: 'Count not found' });
      const count = cntRes.rows[0];

      const lines = await tx.query(
        `SELECT pci.*, i.base_uom_id
         FROM physical_count_items pci
         JOIN items i ON i.id = pci.item_id
         WHERE pci.tenant_id = $1 AND pci.count_id = $2 AND pci.variance IS NOT NULL AND pci.variance <> 0`,
        [tenantId, countId],
      );

      for (const line of lines.rows) {
        const variance = Number(line.variance);
        await this.postMovement(
          tenantId,
          userId,
          requestId,
          {
            locationId: count.location_id,
            itemId: line.item_id,
            batchId: line.batch_id,
            qty: variance,
            uomId: line.base_uom_id,
            movementType: 'COUNT_VARIANCE',
            refType: 'PHYSICAL_COUNT',
            refId: count.id,
            reasonCode: 'COUNT_RECONCILE',
            reasonNote: line.notes ?? undefined,
          },
          tx,
        );
      }

      await tx.query(
        `UPDATE physical_counts SET status = 'POSTED', posted_by = $1, posted_at = now() WHERE tenant_id = $2 AND id = $3`,
        [userId, tenantId, countId],
      );

      return { status: 'POSTED', varianceLinesCount: lines.rowCount };
    });
  }

  // ── Disposals (SUP-T8) ─────────────────────────────────────────────────────

  async createDisposal(tenantId: string, userId: string, dto: CreateDisposalRequest) {
    return withTenant({ tenantId, userId }, async (tx) => {
      const disposalNo = `DISP-${Date.now()}`;
      const dRes = await tx.query(
        `INSERT INTO disposals (
           tenant_id, branch_id, disposal_no, location_id, reason, method,
           witness1_id, witness2_id, certificate_url, photo_url, status, disposed_by
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'DRAFT', $11)
         RETURNING *`,
        [
          tenantId, dto.branchId, disposalNo, dto.locationId, dto.reason,
          dto.method, dto.witness1Id ?? null, dto.witness2Id ?? null,
          dto.certificateUrl ?? null, dto.photoUrl ?? null, userId,
        ],
      );
      const disposal = dRes.rows[0];

      for (const line of dto.lines) {
        await tx.query(
          `INSERT INTO disposal_items (tenant_id, disposal_id, item_id, batch_id, qty, unit_cost)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [tenantId, disposal.id, line.itemId, line.batchId, line.qty, line.unitCost ?? 0],
        );
      }

      return disposal;
    });
  }

  async postDisposal(tenantId: string, userId: string, requestId: string, id: string) {
    return withTenant({ tenantId, userId }, async (tx) => {
      const dRes = await tx.query(
        `SELECT * FROM disposals WHERE tenant_id = $1 AND id = $2`,
        [tenantId, id],
      );
      if (!dRes.rows[0]) throw new ProblemException('NOT_FOUND', { detail: 'Disposal not found' });
      const disposal = dRes.rows[0];

      const lines = await tx.query(
        `SELECT di.*, i.base_uom_id
         FROM disposal_items di
         JOIN items i ON i.id = di.item_id
         WHERE di.tenant_id = $1 AND di.disposal_id = $2`,
        [tenantId, id],
      );

      for (const line of lines.rows) {
        await this.postMovement(
          tenantId,
          userId,
          requestId,
          {
            locationId: disposal.location_id,
            itemId: line.item_id,
            batchId: line.batch_id,
            qty: -Number(line.qty), // deduction
            uomId: line.base_uom_id,
            unitCost: Number(line.unit_cost),
            movementType: 'DISPOSAL',
            refType: 'DISPOSAL',
            refId: disposal.id,
            reasonCode: disposal.reason,
          },
          tx,
        );

        // Mark batch as DEPLETED if on hand reaches 0
        const bal = await tx.query(
          `SELECT qty_on_hand FROM stock_balances WHERE tenant_id = $1 AND batch_id = $2`,
          [tenantId, line.batch_id],
        );
        if (Number(bal.rows[0]?.qty_on_hand ?? 0) <= 0) {
          await tx.query(
            `UPDATE stock_batches SET status = 'DEPLETED' WHERE tenant_id = $1 AND id = $2`,
            [tenantId, line.batch_id],
          );
        }
      }

      await tx.query(
        `UPDATE disposals SET status = 'POSTED', disposed_at = now() WHERE tenant_id = $1 AND id = $2`,
        [tenantId, id],
      );

      return { status: 'POSTED', id };
    });
  }

  // ── Recalls (SUP-T9) ───────────────────────────────────────────────────────

  async createRecall(tenantId: string, userId: string, dto: CreateRecallRequest) {
    return withTenant({ tenantId, userId }, async (tx) => {
      const recallNo = `RCL-${Date.now()}`;
      const rRes = await tx.query(
        `INSERT INTO recalls (tenant_id, recall_no, source, reason, status, initiated_by)
         VALUES ($1, $2, $3, $4, 'ACTIVE', $5)
         RETURNING *`,
        [tenantId, recallNo, dto.source, dto.reason, userId],
      );
      const recall = rRes.rows[0];

      for (const b of dto.batches) {
        // Immediately quarantine the affected batches
        await tx.query(
          `UPDATE stock_batches SET status = 'RECALLED', quarantine_reason = $1
           WHERE tenant_id = $2 AND id = $3`,
          [`Recall ${recallNo}: ${dto.reason}`, tenantId, b.batchId],
        );

        // Calculate on hand
        const bal = await tx.query(
          `SELECT COALESCE(SUM(qty_on_hand), 0) as quarantined_qty
           FROM stock_balances WHERE tenant_id = $1 AND batch_id = $2`,
          [tenantId, b.batchId],
        );

        await tx.query(
          `INSERT INTO recall_batches (tenant_id, recall_id, item_id, batch_id, quarantined_qty, action_taken)
           VALUES ($1, $2, $3, $4, $5, 'QUARANTINED')`,
          [tenantId, recall.id, b.itemId, b.batchId, bal.rows[0].quarantined_qty],
        );
      }

      return recall;
    });
  }

  async traceRecall(tenantId: string, recallId: string) {
    return withTenant({ tenantId }, async (tx) => {
      const recallRes = await tx.query(
        `SELECT * FROM recalls WHERE tenant_id = $1 AND id = $2`,
        [tenantId, recallId],
      );
      if (!recallRes.rows[0]) throw new ProblemException('NOT_FOUND', { detail: 'Recall not found' });

      // Trace affected batches to on-hand locations, movements, and any clinical visits/patients
      const batches = await tx.query(
        `SELECT rb.*, sb.lot_no, sb.expiry_date, i.name as item_name
         FROM recall_batches rb
         JOIN stock_batches sb ON sb.id = rb.batch_id
         JOIN items i ON i.id = rb.item_id
         WHERE rb.tenant_id = $1 AND rb.recall_id = $2`,
        [tenantId, recallId],
      );

      const batchIds = batches.rows.map(b => b.batch_id);

      const balances = batchIds.length > 0
        ? (await tx.query(
            `SELECT b.*, sl.name as location_name
             FROM stock_balances b
             JOIN stock_locations sl ON sl.id = b.location_id
             WHERE b.tenant_id = $1 AND b.batch_id = ANY($2::uuid[])`,
            [tenantId, batchIds],
          )).rows
        : [];

      // Patient trace: find immunizations or clinical supplies with these batches
      const patientExposure = batchIds.length > 0
        ? (await tx.query(
            `SELECT imm.id as immunization_id, imm.patient_id, imm.vaccine, imm.given_at,
                    p.first_name, p.last_name, p.id as patient_no
             FROM immunizations imm
             JOIN patients p ON p.tenant_id = imm.tenant_id AND p.id = imm.patient_id
             WHERE imm.tenant_id = $1 AND imm.stock_batch_id = ANY($2::uuid[])`,
            [tenantId, batchIds],
          )).rows
        : [];

      return {
        recall: recallRes.rows[0],
        batches: batches.rows,
        onHandLocations: balances,
        patientExposures: patientExposure,
      };
    });
  }

  async closeRecall(tenantId: string, id: string, dto: CloseRecallRequest) {
    return withTenant({ tenantId }, async (tx) => {
      const res = await tx.query(
        `UPDATE recalls
         SET status = 'CLOSED', checklist = $1, closed_at = now()
         WHERE tenant_id = $2 AND id = $3
         RETURNING *`,
        [JSON.stringify(dto.checklist ?? {}), tenantId, id],
      );
      if (!res.rows[0]) throw new ProblemException('NOT_FOUND', { detail: 'Recall not found' });
      return res.rows[0];
    });
  }

  // ── Stock Explorer & Ledger APIs ───────────────────────────────────────────

  async getStock(
    tenantId: string,
    filter?: { itemId?: string; locationId?: string; nearExpiryDays?: number },
  ) {
    return withTenant({ tenantId }, async (tx) => {
      let query = `
        SELECT b.location_id, b.batch_id, b.qty_on_hand, b.qty_reserved,
               sl.name as location_name,
               sb.lot_no, sb.expiry_date, sb.unit_cost, sb.status as batch_status,
               i.id as item_id, i.name as item_name, i.code as item_code,
               (b.qty_on_hand * sb.unit_cost) as total_value
        FROM stock_balances b
        JOIN stock_locations sl ON sl.id = b.location_id
        JOIN stock_batches sb ON sb.id = b.batch_id
        JOIN items i ON i.id = sb.item_id
        WHERE b.tenant_id = $1 AND b.qty_on_hand > 0
      `;
      const params: unknown[] = [tenantId];

      if (filter?.itemId) {
        params.push(filter.itemId);
        query += ` AND i.id = $${params.length}`;
      }
      if (filter?.locationId) {
        params.push(filter.locationId);
        query += ` AND b.location_id = $${params.length}`;
      }
      if (filter?.nearExpiryDays) {
        params.push(filter.nearExpiryDays);
        query += ` AND sb.expiry_date <= (now() + ($${params.length} || ' days')::interval)::date`;
      }

      query += ` ORDER BY sb.expiry_date ASC, i.name ASC`;
      const res = await tx.query(query, params);
      return res.rows;
    });
  }

  async listStockBalances(tenantId: string, filter?: { itemId?: string; locationId?: string; nearExpiryDays?: number }) {
    return this.getStock(tenantId, filter);
  }

  async getItemLedger(tenantId: string, itemId: string) {
    return withTenant({ tenantId }, async (tx) => {
      const res = await tx.query(
        `SELECT sm.*, sl.name as location_name, sb.lot_no
         FROM stock_movements sm
         JOIN stock_locations sl ON sl.id = sm.location_id
         LEFT JOIN stock_batches sb ON sb.id = sm.batch_id
         WHERE sm.tenant_id = $1 AND sm.item_id = $2
         ORDER BY sm.occurred_at DESC, sm.id DESC`,
        [tenantId, itemId],
      );
      return res.rows;
    });
  }

  async listMovements(tenantId: string, limit = 50) {
    return withTenant({ tenantId }, async (tx) => {
      const res = await tx.query(
        `SELECT sm.*, sl.name as location_name, i.name as item_name, sb.lot_no
         FROM stock_movements sm
         JOIN stock_locations sl ON sl.id = sm.location_id
         JOIN items i ON i.id = sm.item_id
         LEFT JOIN stock_batches sb ON sb.id = sm.batch_id
         WHERE sm.tenant_id = $1
         ORDER BY sm.occurred_at DESC, sm.id DESC
         LIMIT $2`,
        [tenantId, limit],
      );
      return res.rows;
    });
  }

  async getValuationSnapshot(tenantId: string, asOf?: string) {
    return withTenant({ tenantId }, async (tx) => {
      const res = await tx.query(
        `SELECT b.location_id, sl.name as location_name,
                i.id as item_id, i.name as item_name, i.code as item_code,
                SUM(b.qty_on_hand) as total_qty,
                SUM(b.qty_on_hand * sb.unit_cost) as total_value
         FROM stock_balances b
         JOIN stock_locations sl ON sl.id = b.location_id
         JOIN stock_batches sb ON sb.id = b.batch_id
         JOIN items i ON i.id = sb.item_id
         WHERE b.tenant_id = $1 AND b.qty_on_hand > 0
         GROUP BY b.location_id, sl.name, i.id, i.name, i.code
         ORDER BY total_value DESC`,
        [tenantId],
      );
      return res.rows;
    });
  }
}

type CreatePoSchemaType = CreatePoRequest;
