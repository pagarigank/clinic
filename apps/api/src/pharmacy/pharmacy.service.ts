import { Inject, Injectable } from '@nestjs/common';
import { withTenant, type QueryResultRow } from '@clinic/db';
import {
  renderRxLabel,
  buildReceiptDocument,
  renderPdf,
  renderReceiptHtml,
  renderDispenseLabelHtml,
  type RxQueueDocument,
  type RenderedDocument,
  type DangerousDrugsBookDocument,
  type DangerousDrugsBookRow,
} from '@clinic/print';
import { ProblemException } from '../http/problem.exception.js';
import { SupplyService } from '../supply/supply.service.js';
import type {
  CreateGenericNameRequest,
  UpdateGenericNameRequest,
  CreateDrugProductRequest,
  UpdateDrugProductRequest,
  CreateDrugInteractionRequest,
  CreatePriceRuleRequest,
  VerifyPrescriptionRequest,
  CreateInterventionRequest,
  RecordInteractionDecisionRequest,
  CreateDispenseRequest,
  PostDispenseRequest,
  VoidDispenseRequest,
  CreateSpecialRxRecordRequest,
  CreateOtcSaleRequest,
  CreateMedicationAdminRequest,
  CreatePatientReturnRequest,
} from '@clinic/contracts';

type Tx = Parameters<Parameters<typeof withTenant>[1]>[0];

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function formatDateTime(d: Date): string {
  return d.toISOString().slice(0, 16).replace('T', ' ');
}

@Injectable()
export class PharmacyService {
  // Explicit @Inject: tsx/esbuild does not emit design:paramtypes, so a constructor
  // parameter without it binds undefined and every call that uses it throws
  // "Cannot read properties of undefined" at runtime — never at build time.
  constructor(@Inject(SupplyService) private readonly supplyService: SupplyService) {}

  // ── Generics (PHM-T1) ──────────────────────────────────────────────────────

  async listGenerics(tenantId: string) {
    return withTenant({ tenantId }, async (tx) => {
      const res = await tx.query(
        `SELECT id, name, atc_code, created_at, updated_at
         FROM generic_names
         WHERE tenant_id = $1 AND deleted_at IS NULL
         ORDER BY name ASC`,
        [tenantId],
      );
      return res.rows;
    });
  }

  async getGeneric(tenantId: string, id: string) {
    return withTenant({ tenantId }, async (tx) => {
      const res = await tx.query(
        `SELECT id, name, atc_code, created_at, updated_at
         FROM generic_names
         WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
        [tenantId, id],
      );
      if (!res.rows[0]) {
        throw new ProblemException('NOT_FOUND', { detail: 'Generic name not found' });
      }
      return res.rows[0];
    });
  }

  async createGeneric(tenantId: string, dto: CreateGenericNameRequest) {
    return withTenant({ tenantId }, async (tx) => {
      const res = await tx.query(
        `INSERT INTO generic_names (tenant_id, name, atc_code)
         VALUES ($1, $2, $3)
         RETURNING *`,
        [tenantId, dto.name.trim(), dto.atcCode?.trim() ?? null],
      );
      return res.rows[0];
    });
  }

  async updateGeneric(tenantId: string, id: string, dto: UpdateGenericNameRequest) {
    return withTenant({ tenantId }, async (tx) => {
      const existing = await tx.query(
        `SELECT id FROM generic_names WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
        [tenantId, id],
      );
      if (!existing.rows[0]) {
        throw new ProblemException('NOT_FOUND', { detail: 'Generic name not found' });
      }

      const res = await tx.query(
        `UPDATE generic_names
         SET name = COALESCE($3, name),
             atc_code = COALESCE($4, atc_code),
             updated_at = now()
         WHERE tenant_id = $1 AND id = $2
         RETURNING *`,
        [tenantId, id, dto.name?.trim(), dto.atcCode?.trim()],
      );
      return res.rows[0];
    });
  }

  async deleteGeneric(tenantId: string, id: string) {
    return withTenant({ tenantId }, async (tx) => {
      const res = await tx.query(
        `UPDATE generic_names
         SET deleted_at = now()
         WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
         RETURNING id`,
        [tenantId, id],
      );
      if (!res.rows[0]) {
        throw new ProblemException('NOT_FOUND', { detail: 'Generic name not found' });
      }
      return { success: true, id };
    });
  }

  // ── Drug Products (PHM-T1) ─────────────────────────────────────────────────

  async listProducts(tenantId: string) {
    return withTenant({ tenantId }, async (tx) => {
      const res = await tx.query(
        `SELECT dp.id, dp.item_id, dp.generic_id, dp.brand_name, dp.strength,
                dp.dosage_form, dp.route, dp.pack_size, dp.fda_reg_no,
                dp.rx_required, dp.controlled_schedule, dp.storage,
                dp.is_formulary, dp.high_alert, dp.allergy_class,
                i.service_id, i.code as code, i.code as item_code, i.name as item_name, i.standard_cost, i.base_uom_id,
                gn.name as generic_name, gn.atc_code,
                u.code as uom_code,
                COALESCE(
                  (SELECT pl.amount FROM price_lists pl
                   WHERE pl.service_id = i.service_id AND pl.tenant_id = i.tenant_id
                     AND pl.effective_from <= CURRENT_DATE
                     AND (pl.effective_to IS NULL OR pl.effective_to >= CURRENT_DATE)
                   ORDER BY pl.effective_from DESC, pl.created_at DESC LIMIT 1),
                  sc.default_price,
                  0
                )::numeric as price
         FROM drug_products dp
         JOIN items i ON i.tenant_id = dp.tenant_id AND i.id = dp.item_id
         JOIN generic_names gn ON gn.tenant_id = dp.tenant_id AND gn.id = dp.generic_id
         JOIN uoms u ON u.tenant_id = i.tenant_id AND u.id = i.base_uom_id
         LEFT JOIN service_catalog sc ON sc.id = i.service_id AND sc.tenant_id = i.tenant_id
         WHERE dp.tenant_id = $1 AND dp.deleted_at IS NULL
         ORDER BY dp.brand_name ASC`,
        [tenantId],
      );
      return res.rows;
    });
  }

  async getProduct(tenantId: string, id: string, tx?: Tx) {
    const runner = async (client: Tx) => {
      const res = await client.query(
        `SELECT dp.*,
                i.service_id, i.code as code, i.code as item_code, i.name as item_name, i.standard_cost, i.base_uom_id,
                gn.name as generic_name, gn.atc_code,
                u.code as uom_code,
                COALESCE(
                  (SELECT pl.amount FROM price_lists pl
                   WHERE pl.service_id = i.service_id AND pl.tenant_id = i.tenant_id
                     AND pl.effective_from <= CURRENT_DATE
                     AND (pl.effective_to IS NULL OR pl.effective_to >= CURRENT_DATE)
                   ORDER BY pl.effective_from DESC, pl.created_at DESC LIMIT 1),
                  sc.default_price,
                  0
                )::numeric as price
         FROM drug_products dp
         JOIN items i ON i.tenant_id = dp.tenant_id AND i.id = dp.item_id
         JOIN generic_names gn ON gn.tenant_id = dp.tenant_id AND gn.id = dp.generic_id
         JOIN uoms u ON u.tenant_id = i.tenant_id AND u.id = i.base_uom_id
         LEFT JOIN service_catalog sc ON sc.id = i.service_id AND sc.tenant_id = i.tenant_id
         WHERE dp.tenant_id = $1 AND dp.id = $2 AND dp.deleted_at IS NULL`,
        [tenantId, id],
      );
      if (!res.rows[0]) {
        throw new ProblemException('NOT_FOUND', { detail: 'Drug product not found' });
      }
      return res.rows[0];
    };

    if (tx) return runner(tx);
    return withTenant({ tenantId }, runner);
  }

  async createProduct(tenantId: string, dto: CreateDrugProductRequest) {
    return withTenant({ tenantId }, async (tx) => {
      // 1. Verify generic exists
      const genRes = await tx.query(
        `SELECT id FROM generic_names WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
        [tenantId, dto.genericId],
      );
      if (!genRes.rows[0]) {
        throw new ProblemException('NOT_FOUND', { detail: 'Generic name not found' });
      }

      // 2. Transactionally insert or update service_catalog entry for retail pricing
      const resolvedName = (dto.name || dto.brandName || dto.code).trim();
      let resolvedBaseUomId = dto.baseUomId;
      if (!resolvedBaseUomId) {
        const uomRes = await tx.query(`SELECT id FROM uoms WHERE tenant_id = $1 ORDER BY code LIMIT 1`, [tenantId]);
        resolvedBaseUomId = uomRes.rows[0]?.id;
      }

      let serviceId: string | null = null;
      const scRes = await tx.query(
        `INSERT INTO service_catalog (tenant_id, code, name, category, default_price, is_active)
         VALUES ($1, $2, $3, 'other', $4, true)
         ON CONFLICT (tenant_id, code) DO UPDATE SET name = EXCLUDED.name, default_price = EXCLUDED.default_price
         RETURNING id`,
        [tenantId, `RX-${dto.code.trim().toUpperCase()}`, resolvedName, dto.price ?? 0],
      );
      serviceId = scRes.rows[0]?.id ?? null;

      if (serviceId && dto.price !== undefined && dto.price > 0) {
        await tx.query(
          `INSERT INTO price_lists (tenant_id, service_id, amount, effective_from)
           VALUES ($1, $2, $3, CURRENT_DATE)`,
          [tenantId, serviceId, dto.price],
        );
      }

      // 3. Create item master record (medication type, batch & expiry tracked, with service_id)
      const itemRes = await tx.query(
        `INSERT INTO items (
           tenant_id, code, name, item_type, base_uom_id, standard_cost,
           is_batch_tracked, is_expiry_tracked, min_shelf_life_days_on_receipt, service_id
         )
         VALUES ($1, $2, $3, 'MEDICINE', $4, $5, true, true, $6, $7)
         ON CONFLICT (tenant_id, code) DO UPDATE SET name = EXCLUDED.name, standard_cost = EXCLUDED.standard_cost, service_id = COALESCE(EXCLUDED.service_id, items.service_id)
         RETURNING id`,
        [
          tenantId,
          dto.code.trim().toUpperCase(),
          resolvedName,
          resolvedBaseUomId,
          dto.standardCost ?? 0,
          dto.minShelfLifeDays ?? 30,
          serviceId,
        ],
      );
      const itemId = itemRes.rows[0].id;

      // 4. Create drug_products record
      const prodRes = await tx.query(
        `INSERT INTO drug_products (
           tenant_id, item_id, generic_id, brand_name, strength, dosage_form, route,
           pack_size, fda_reg_no, rx_required, controlled_schedule, storage,
           is_formulary, high_alert, allergy_class
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
         RETURNING *`,
        [
          tenantId,
          itemId,
          dto.genericId,
          dto.brandName.trim(),
          dto.strength.trim(),
          dto.dosageForm.trim(),
          dto.route.trim(),
          dto.packSize ?? 1,
          dto.fdaRegNo ?? null,
          dto.rxRequired ?? 'RX',
          dto.controlledSchedule ?? null,
          dto.storage ?? 'ROOM',
          dto.isFormulary ?? true,
          dto.highAlert ?? false,
          dto.allergyClass ?? null,
        ],
      );

      return this.getProduct(tenantId, prodRes.rows[0].id, tx);
    });
  }

  async updateProduct(tenantId: string, id: string, dto: UpdateDrugProductRequest) {
    return withTenant({ tenantId }, async (tx) => {
      const existing = await tx.query(
        `SELECT id, item_id FROM drug_products WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
        [tenantId, id],
      );
      if (!existing.rows[0]) {
        throw new ProblemException('NOT_FOUND', { detail: 'Drug product not found' });
      }

      const prod = existing.rows[0];

      if (dto.standardCost !== undefined) {
        await tx.query(
          `UPDATE items SET standard_cost = $3, updated_at = now() WHERE tenant_id = $1 AND id = $2`,
          [tenantId, prod.item_id, dto.standardCost],
        );
      }

      if (dto.price !== undefined) {
        const itemRes = await tx.query(
          `SELECT i.id, i.code, i.name, i.service_id FROM items i WHERE i.tenant_id = $1 AND i.id = $2`,
          [tenantId, prod.item_id],
        );
        const item = itemRes.rows[0];
        let serviceId = item?.service_id;
        if (!serviceId) {
          const scRes = await tx.query(
            `INSERT INTO service_catalog (tenant_id, code, name, category, default_price, is_active)
             VALUES ($1, $2, $3, 'other', $4, true)
             ON CONFLICT (tenant_id, code) DO UPDATE SET default_price = EXCLUDED.default_price
             RETURNING id`,
            [tenantId, `RX-${item?.code || prod.id}`, item?.name || 'Drug Product', dto.price],
          );
          serviceId = scRes.rows[0]?.id;
          if (serviceId) {
            await tx.query(
              `UPDATE items SET service_id = $1 WHERE tenant_id = $2 AND id = $3`,
              [serviceId, tenantId, prod.item_id],
            );
          }
        } else {
          await tx.query(
            `UPDATE service_catalog SET default_price = $1, updated_at = now() WHERE tenant_id = $2 AND id = $3`,
            [dto.price, tenantId, serviceId],
          );
        }

        if (serviceId && dto.price > 0) {
          await tx.query(
            `INSERT INTO price_lists (tenant_id, service_id, amount, effective_from)
             VALUES ($1, $2, $3, CURRENT_DATE)`,
            [tenantId, serviceId, dto.price],
          );
        }
      }

      await tx.query(
        `UPDATE drug_products
         SET brand_name = COALESCE($3, brand_name),
             fda_reg_no = COALESCE($4, fda_reg_no),
             rx_required = COALESCE($5, rx_required),
             controlled_schedule = COALESCE($6, controlled_schedule),
             storage = COALESCE($7, storage),
             is_formulary = COALESCE($8, is_formulary),
             high_alert = COALESCE($9, high_alert),
             allergy_class = COALESCE($10, allergy_class),
             updated_at = now()
         WHERE tenant_id = $1 AND id = $2`,
        [
          tenantId,
          id,
          dto.brandName,
          dto.fdaRegNo,
          dto.rxRequired,
          dto.controlledSchedule,
          dto.storage,
          dto.isFormulary,
          dto.highAlert,
          dto.allergyClass,
        ],
      );

      return this.getProduct(tenantId, id, tx);
    });
  }

  async deleteProduct(tenantId: string, id: string) {
    return withTenant({ tenantId }, async (tx) => {
      const res = await tx.query(
        `UPDATE drug_products SET deleted_at = now() WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL RETURNING id`,
        [tenantId, id],
      );
      if (!res.rows[0]) {
        throw new ProblemException('NOT_FOUND', { detail: 'Drug product not found' });
      }
      return { success: true, id };
    });
  }

  // ── Drug Interactions (PHM-T1) ─────────────────────────────────────────────

  async listInteractions(tenantId: string) {
    return withTenant({ tenantId }, async (tx) => {
      const res = await tx.query(
        `SELECT di.*,
                ga.name as generic_a_name, ga.atc_code as generic_a_atc,
                gb.name as generic_b_name, gb.atc_code as generic_b_atc
         FROM drug_interactions di
         JOIN generic_names ga ON ga.tenant_id = di.tenant_id AND ga.id = di.generic_a_id
         JOIN generic_names gb ON gb.tenant_id = di.tenant_id AND gb.id = di.generic_b_id
         WHERE di.tenant_id = $1
         ORDER BY di.severity ASC, ga.name ASC`,
        [tenantId],
      );
      return res.rows;
    });
  }

  async createInteraction(tenantId: string, dto: CreateDrugInteractionRequest) {
    return withTenant({ tenantId }, async (tx) => {
      const res = await tx.query(
        `INSERT INTO drug_interactions (
           tenant_id, generic_a_id, generic_b_id, severity, mechanism,
           clinical_advice, is_tenant_override, override_reason
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (tenant_id, generic_a_id, generic_b_id) DO UPDATE
           SET severity = EXCLUDED.severity,
               mechanism = EXCLUDED.mechanism,
               clinical_advice = EXCLUDED.clinical_advice,
               is_tenant_override = EXCLUDED.is_tenant_override,
               override_reason = EXCLUDED.override_reason,
               updated_at = now()
         RETURNING *`,
        [
          tenantId,
          dto.genericAId,
          dto.genericBId,
          dto.severity,
          dto.mechanism ?? null,
          dto.clinicalAdvice,
          dto.isTenantOverride ?? false,
          dto.overrideReason ?? null,
        ],
      );
      return res.rows[0];
    });
  }

  async deleteInteraction(tenantId: string, id: string) {
    return withTenant({ tenantId }, async (tx) => {
      const res = await tx.query(
        `DELETE FROM drug_interactions WHERE tenant_id = $1 AND id = $2 RETURNING id`,
        [tenantId, id],
      );
      if (!res.rows[0]) {
        throw new ProblemException('NOT_FOUND', { detail: 'Interaction rule not found' });
      }
      return { success: true, id };
    });
  }

  // ── Price Rules (PHM-T2) ───────────────────────────────────────────────────

  async listPriceRules(tenantId: string, itemId?: string) {
    return withTenant({ tenantId }, async (tx) => {
      const params: any[] = [tenantId];
      let sql = `SELECT pr.*, i.name as item_name, i.code as item_code, i.standard_cost
                 FROM pharmacy_price_rules pr
                 JOIN items i ON i.tenant_id = pr.tenant_id AND i.id = pr.item_id
                 WHERE pr.tenant_id = $1`;
      if (itemId) {
        params.push(itemId);
        sql += ` AND pr.item_id = $${params.length}`;
      }
      sql += ` ORDER BY pr.effective_from DESC`;
      const res = await tx.query(sql, params);
      return res.rows;
    });
  }

  async createPriceRule(tenantId: string, dto: CreatePriceRuleRequest) {
    return withTenant({ tenantId }, async (tx) => {
      const res = await tx.query(
        `INSERT INTO pharmacy_price_rules (
           tenant_id, item_id, pricing_strategy, markup_pct, fixed_price,
           effective_from, effective_to
         )
         VALUES ($1, $2, $3, $4, $5, COALESCE($6::date, CURRENT_DATE), $7::date)
         RETURNING *`,
        [
          tenantId,
          dto.itemId,
          dto.pricingStrategy,
          dto.markupPct ?? null,
          dto.fixedPrice ?? null,
          dto.effectiveFrom ?? null,
          dto.effectiveTo ?? null,
        ],
      );
      return res.rows[0];
    });
  }

  async calculateItemPrice(tenantId: string, itemId: string, standardCost: number, tx?: Tx): Promise<number> {
    const runner = async (client: Tx) => {
      const res = await client.query(
        `SELECT pricing_strategy, markup_pct, fixed_price
         FROM pharmacy_price_rules
         WHERE tenant_id = $1 AND item_id = $2
           AND effective_from <= CURRENT_DATE
           AND (effective_to IS NULL OR effective_to >= CURRENT_DATE)
         ORDER BY effective_from DESC
         LIMIT 1`,
        [tenantId, itemId],
      );
      if (!res.rows[0]) {
        return standardCost > 0 ? standardCost : 0;
      }
      const rule = res.rows[0];
      if (rule.pricing_strategy === 'FIXED_PRICE' && rule.fixed_price != null) {
        return Number(rule.fixed_price);
      }
      if (rule.pricing_strategy === 'MARKUP_PCT' && rule.markup_pct != null) {
        return Number((standardCost * (1 + Number(rule.markup_pct) / 100)).toFixed(4));
      }
      return standardCost;
    };

    if (tx) return runner(tx);
    return withTenant({ tenantId }, runner);
  }

  // ── Verification Queue & Automated Checks (PHM-T1) ─────────────────────────

  async getPrescription(tenantId: string, id: string) {
    return withTenant({ tenantId }, async (tx) => {
      const rxRes = await tx.query(
        `SELECT p.*,
                pt.first_name as patient_first_name, pt.last_name as patient_last_name,
                pt.first_name || ' ' || pt.last_name as patient_name,
                (SELECT value FROM patient_identifiers WHERE tenant_id = pt.tenant_id AND patient_id = pt.id AND type = 'HRN' LIMIT 1) as hrn,
                pt.date_of_birth as birth_date, pt.gender as patient_sex,
                u.name as prescriber_name,
                v.visit_no
         FROM prescriptions p
         JOIN patients pt ON pt.tenant_id = p.tenant_id AND pt.id = p.patient_id
         LEFT JOIN users u ON u.tenant_id = p.tenant_id AND u.id = p.prescriber_id
         LEFT JOIN visits v ON v.tenant_id = p.tenant_id AND v.id = p.visit_id
         WHERE p.tenant_id = $1 AND p.id = $2`,
        [tenantId, id],
      );
      if (!rxRes.rows[0]) {
        throw new ProblemException('NOT_FOUND', { detail: 'Prescription not found' });
      }
      const rx = rxRes.rows[0];

      const itemsRes = await tx.query(
        `SELECT pi.id, pi.drug_product_id, pi.generic_name, pi.brand_name, pi.strength, pi.form,
                pi.route, pi.sig_dose, pi.sig_frequency, pi.sig_duration,
                pi.qty_prescribed, pi.qty_dispensed, pi.dispense_as_written,
                COALESCE(dp.item_id, (SELECT dp2.item_id FROM drug_products dp2 WHERE dp2.tenant_id = pi.tenant_id AND dp2.brand_name ILIKE pi.generic_name LIMIT 1)) as item_id,
                dp.rx_required, dp.controlled_schedule, dp.high_alert, dp.allergy_class,
                COALESCE(i.code, (SELECT i2.code FROM drug_products dp2 JOIN items i2 ON i2.id = dp2.item_id AND i2.tenant_id = dp2.tenant_id WHERE dp2.tenant_id = pi.tenant_id AND dp2.brand_name ILIKE pi.generic_name LIMIT 1)) as item_code,
                COALESCE(i.name, pi.brand_name, pi.generic_name) as item_name
         FROM prescription_items pi
         LEFT JOIN drug_products dp ON dp.tenant_id = pi.tenant_id AND dp.id = pi.drug_product_id
         LEFT JOIN items i ON i.tenant_id = dp.tenant_id AND i.id = dp.item_id
         WHERE pi.tenant_id = $1 AND pi.rx_id = $2
         ORDER BY pi.id ASC`,
        [tenantId, id],
      );

      return { ...rx, items: itemsRes.rows };
    });
  }

  async getVerificationQueue(tenantId: string, status = 'ISSUED') {
    return withTenant({ tenantId }, async (tx) => {
      const res = await tx.query(
        `SELECT p.id, p.rx_no, p.status, p.is_controlled, p.valid_until, p.issued_at, p.notes,
                pt.id as patient_id, pt.first_name as patient_first_name, pt.last_name as patient_last_name,
                (SELECT value FROM patient_identifiers WHERE tenant_id = pt.tenant_id AND patient_id = pt.id AND type = 'HRN' LIMIT 1) as hrn,
                pt.date_of_birth as birth_date,
                u.id as prescriber_id, u.name as prescriber_name,
                v.id as visit_id, v.visit_no,
                (SELECT count(*)::int FROM prescription_items pi WHERE pi.tenant_id = p.tenant_id AND pi.rx_id = p.id) as item_count
         FROM prescriptions p
         JOIN patients pt ON pt.tenant_id = p.tenant_id AND pt.id = p.patient_id
         JOIN users u ON u.tenant_id = p.tenant_id AND u.id = p.prescriber_id
         JOIN visits v ON v.tenant_id = p.tenant_id AND v.id = p.visit_id
         WHERE p.tenant_id = $1 AND p.status = $2
         ORDER BY p.issued_at ASC`,
        [tenantId, status],
      );
      return res.rows;
    });
  }

  /**
   * Map the verification queue to a printable document.
   *
   * Kept in the service (rather than the controller) so the row -> document
   * mapping is unit-testable without going through HTTP.
   */
  async getVerificationQueueDocument(
    tenantId: string,
    status = 'ISSUED',
    meta: { clinicName?: string; branchName?: string; clinicAddress?: string; generatedBy?: string } = {},
  ): Promise<RxQueueDocument> {
    const rows = (await this.getVerificationQueue(tenantId, status)) as Array<{
      rx_no: string;
      status: string;
      is_controlled: boolean;
      valid_until: string | null;
      issued_at: string | null;
      patient_first_name: string;
      patient_last_name: string;
      hrn: string | null;
      birth_date: string | null;
      prescriber_name: string;
      visit_no: string;
      item_count: number | string;
    }>;

    return {
      clinicName: meta.clinicName ?? 'Clinic Medical Center',
      branchName: meta.branchName,
      clinicAddress: meta.clinicAddress,
      status,
      generatedAt: formatDateTime(new Date()),
      generatedBy: meta.generatedBy,
      rows: rows.map((r) => ({
        rxNo: r.rx_no,
        patientName: `${r.patient_last_name}, ${r.patient_first_name}`,
        patientHrn: r.hrn,
        patientDob: r.birth_date ? formatDate(new Date(r.birth_date)) : null,
        prescriberName: r.prescriber_name,
        visitNo: r.visit_no,
        itemCount: Number(r.item_count) || 0,
        isControlled: Boolean(r.is_controlled),
        issuedAt: r.issued_at ? formatDateTime(new Date(r.issued_at)) : null,
        validUntil: r.valid_until ? formatDate(new Date(r.valid_until)) : null,
        status: r.status,
      })),
    };
  }

  async runPrescriptionChecks(tenantId: string, rxId: string) {
    return withTenant({ tenantId }, async (tx) => {
      const rxRes = await tx.query(
        `SELECT p.*, pt.date_of_birth as birth_date
         FROM prescriptions p
         JOIN patients pt ON pt.tenant_id = p.tenant_id AND pt.id = p.patient_id
         WHERE p.tenant_id = $1 AND p.id = $2`,
        [tenantId, rxId],
      );
      if (!rxRes.rows[0]) {
        throw new ProblemException('NOT_FOUND', { detail: 'Prescription not found' });
      }
      const rx = rxRes.rows[0];

      // Prescription items
      const itemsRes = await tx.query(
        `SELECT pi.*, dp.id as product_id, dp.item_id, dp.generic_id, dp.high_alert, dp.allergy_class, dp.rx_required,
                gn.name as standard_generic_name
         FROM prescription_items pi
         LEFT JOIN drug_products dp ON dp.tenant_id = pi.tenant_id AND dp.id = pi.drug_product_id
         LEFT JOIN generic_names gn ON gn.tenant_id = pi.tenant_id AND (gn.id = dp.generic_id OR gn.name ILIKE pi.generic_name)
         WHERE pi.tenant_id = $1 AND pi.rx_id = $2`,
        [tenantId, rxId],
      );
      const items = itemsRes.rows;

      // Patient Allergies
      const allergyRes = await tx.query(
        `SELECT substance, severity FROM patient_allergies WHERE tenant_id = $1 AND patient_id = $2`,
        [tenantId, rx.patient_id],
      );
      const allergies = allergyRes.rows;

      const findings: Array<{
        checkType: 'ALLERGY' | 'INTERACTION' | 'DUPLICATE' | 'DOSE' | 'STOCK' | 'CONTROLLED';
        severity: 'CONTRAINDICATED' | 'MAJOR' | 'MODERATE' | 'MINOR';
        message: string;
        details?: any;
      }> = [];

      // 1. Allergy checks
      for (const item of items) {
        for (const allergy of allergies) {
          const substance = allergy.substance.toLowerCase();
          const genMatch = item.generic_name?.toLowerCase().includes(substance) || item.standard_generic_name?.toLowerCase().includes(substance);
          const brandMatch = item.brand_name?.toLowerCase().includes(substance);
          const classMatch = item.allergy_class?.toLowerCase().includes(substance);

          if (genMatch || brandMatch || classMatch) {
            findings.push({
              checkType: 'ALLERGY',
              severity: 'CONTRAINDICATED',
              message: `Severe allergy match: Patient is allergic to "${allergy.substance}". Matched drug "${item.brand_name || item.generic_name}".`,
              details: { prescriptionItemId: item.id, allergySubstance: allergy.substance, allergySeverity: allergy.severity },
            });
          }
        }
      }

      // 2. Drug-Drug Interactions (pairwise check across items)
      const genericIds = items.map((i: any) => i.generic_id).filter(Boolean);
      for (let i = 0; i < genericIds.length; i++) {
        for (let j = i + 1; j < genericIds.length; j++) {
          const genA = genericIds[i];
          const genB = genericIds[j];
          const interRes = await tx.query(
            `SELECT di.*, ga.name as gen_a_name, gb.name as gen_b_name
             FROM drug_interactions di
             JOIN generic_names ga ON ga.tenant_id = di.tenant_id AND ga.id = di.generic_a_id
             JOIN generic_names gb ON gb.tenant_id = di.tenant_id AND gb.id = di.generic_b_id
             WHERE di.tenant_id = $1
               AND ((di.generic_a_id = $2 AND di.generic_b_id = $3) OR (di.generic_a_id = $3 AND di.generic_b_id = $2))
             ORDER BY di.is_tenant_override DESC, di.created_at DESC
             LIMIT 1`,
            [tenantId, genA, genB],
          );
          if (interRes.rows[0]) {
            const rule = interRes.rows[0];
            findings.push({
              checkType: 'INTERACTION',
              severity: rule.severity,
              message: `Interaction detected between ${rule.gen_a_name} and ${rule.gen_b_name}: ${rule.clinical_advice}`,
              details: {
                interactionId: rule.id,
                genericA: rule.gen_a_name,
                genericB: rule.gen_b_name,
                mechanism: rule.mechanism,
                isTenantOverride: rule.is_tenant_override,
              },
            });
          }
        }
      }

      // 3. Duplicate therapy check
      const genericCounts: Record<string, number> = {};
      for (const item of items) {
        const name = (item.standard_generic_name || item.generic_name || '').toLowerCase();
        if (name) {
          genericCounts[name] = (genericCounts[name] || 0) + 1;
        }
      }
      for (const [name, count] of Object.entries(genericCounts)) {
        if (count > 1) {
          findings.push({
            checkType: 'DUPLICATE',
            severity: 'MODERATE',
            message: `Duplicate therapy detected: Prescribed ${count} products containing ${name}.`,
            details: { genericName: name, count },
          });
        }
      }

      // 4. Controlled drug checks
      if (rx.is_controlled) {
        if (!rx.special_rx_no) {
          findings.push({
            checkType: 'CONTROLLED',
            severity: 'MAJOR',
            message: 'Controlled prescription is missing special yellow Rx serial number.',
          });
        }
        if (!rx.qty_words) {
          findings.push({
            checkType: 'CONTROLLED',
            severity: 'MAJOR',
            message: 'Controlled prescription is missing quantity written in words.',
          });
        }
      }

      // 5. Stock availability check
      for (const item of items) {
        if (item.item_id) {
          const balRes = await tx.query(
            `SELECT COALESCE(SUM(qty_on_hand), 0) as total_on_hand
             FROM stock_balances
             WHERE tenant_id = $1 AND batch_id IN (
               SELECT id FROM stock_batches WHERE tenant_id = $1 AND item_id = $2 AND status = 'AVAILABLE'
             )`,
            [tenantId, item.item_id],
          );
          const onHand = Number(balRes.rows[0]?.total_on_hand ?? 0);
          const needed = Number(item.qty_prescribed);
          if (onHand < needed) {
            findings.push({
              checkType: 'STOCK',
              severity: 'MODERATE',
              message: `Low stock warning for "${item.brand_name || item.generic_name}": On-hand: ${onHand}, Prescribed: ${needed}.`,
              details: { itemId: item.item_id, onHand, needed },
            });
          }
        }
      }

      return {
        prescriptionId: rxId,
        rxNo: rx.rx_no,
        checkedAt: new Date().toISOString(),
        hasContraindications: findings.some((f) => f.severity === 'CONTRAINDICATED'),
        findings,
      };
    });
  }

  async verifyPrescription(tenantId: string, userId: string, rxId: string, dto: VerifyPrescriptionRequest) {
    return withTenant({ tenantId }, async (tx) => {
      const rxRes = await tx.query(
        `SELECT id, status, prescriber_id, rx_no FROM prescriptions WHERE tenant_id = $1 AND id = $2`,
        [tenantId, rxId],
      );
      if (!rxRes.rows[0]) {
        throw new ProblemException('NOT_FOUND', { detail: 'Prescription not found' });
      }
      const rx = rxRes.rows[0];

      // Guard against re-verification: approving an already-cancelled or already
      // dispensed prescription must not silently succeed.
      if (rx.status !== 'ISSUED') {
        throw new ProblemException('CONFLICT', {
          detail: `Prescription ${rx.rx_no} is ${rx.status} and cannot be verified`,
        });
      }

      if (dto.action === 'APPROVE') {
        // This branch used to `return { success: true }` without writing anything, so
        // the UI reported "verified and cleared for dispensing" while nothing changed
        // server-side — the approval gate did not exist.
        //
        // Approval deliberately does NOT move prescriptions.status. Per
        // specification §9.3 the Rx status only changes at dispense time
        // (DISPENSED / PARTIALLY_DISPENSED); verification is a gate that must be
        // evidenced, not a status. The allowed values are
        // DRAFT/ISSUED/PARTIALLY_DISPENSED/DISPENSED/EXPIRED/CANCELLED
        // (specification §5.2 data dictionary) — there is no VERIFIED, and the UI
        // filter chip that offered it was the thing inventing it.
        //
        // So: record the approval in pharmacist_interventions (already the audit
        // table for PHM-T1), keep the Rx ISSUED, and report that truthfully. The
        // dispense step is what later flips it to DISPENSED.
        await tx.query(
          `INSERT INTO pharmacist_interventions (
             tenant_id, rx_id, type, description, outcome, pharmacist_id
           )
           VALUES ($1, $2, 'OTHER', $3, $4, $5)`,
          [
            tenantId,
            rxId,
            dto.description ??
              'Pharmacist clinical review completed; cleared for dispensing',
            dto.outcome ?? 'APPROVED_WITH_OVERRIDE',
            userId,
          ],
        );

        return {
          success: true,
          action: 'APPROVE',
          rxId,
          rxNo: rx.rx_no,
          // The Rx stays ISSUED until it is dispensed (specification §9.3).
          status: rx.status,
          verifiedForDispensing: true,
          message: 'Prescription verified and cleared for dispensing',
        };
      }

      if (dto.action === 'INTERVENE') {
        if (!dto.interventionType || !dto.description || !dto.outcome) {
          throw new ProblemException('VALIDATION_FAILED', {
            detail: 'Intervention type, description, and outcome are required for pharmacist intervention',
          });
        }
        const intRes = await tx.query(
          `INSERT INTO pharmacist_interventions (
             tenant_id, rx_id, type, description, outcome, pharmacist_id
           )
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING *`,
          [tenantId, rxId, dto.interventionType, dto.description, dto.outcome, userId],
        );
        return { success: true, action: 'INTERVENE', intervention: intRes.rows[0] };
      }

      if (dto.action === 'REJECT') {
        if (!dto.rejectReason) {
          throw new ProblemException('VALIDATION_FAILED', { detail: 'Reject reason is required when rejecting prescription' });
        }
        await tx.query(
          `UPDATE prescriptions
           SET status = 'CANCELLED',
               cancel_reason = $3,
               updated_at = now()
           WHERE tenant_id = $1 AND id = $2`,
          [tenantId, rxId, dto.rejectReason],
        );

        // Record rejection intervention
        await tx.query(
          `INSERT INTO pharmacist_interventions (
             tenant_id, rx_id, type, description, outcome, pharmacist_id
           )
           VALUES ($1, $2, 'OTHER', $3, 'REJECTED', $4)`,
          [tenantId, rxId, `Prescription rejected: ${dto.rejectReason}`, userId],
        );

        // JOB-02 notification: enqueue for prescriber
        const rxRes = await tx.query(
          `SELECT prescriber_id FROM prescriptions WHERE tenant_id = $1 AND id = $2`,
          [tenantId, rxId],
        );
        if (rxRes.rows[0]?.prescriber_id) {
          await tx.query(
            `INSERT INTO outbox (tenant_id, event_type, payload)
             VALUES ($1, 'notification.send', $2)`,
            [
              tenantId,
              {
                recipientId: rxRes.rows[0].prescriber_id,
                channel: 'IN_APP',
                template: 'RX_REJECTED',
                data: {
                  rxId,
                  reason: dto.rejectReason,
                },
              },
            ],
          );
        }

        return {
          success: true,
          action: 'REJECT',
          rxId,
          reason: dto.rejectReason,
          message: 'Prescription rejected; prescriber notified',
        };
      }

      throw new ProblemException('VALIDATION_FAILED', { detail: 'Invalid verification action' });
    });
  }

  async recordInteractionDecision(tenantId: string, userId: string, dto: RecordInteractionDecisionRequest) {
    return withTenant({ tenantId }, async (tx) => {
      const res = await tx.query(
        `INSERT INTO interaction_decisions (
           tenant_id, rx_id, interaction_id, drug_a_name, drug_b_name,
           severity, decision, justification_reason_code, justification_notes, pharmacist_id
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING *`,
        [
          tenantId,
          dto.rxId,
          dto.interactionId ?? null,
          dto.drugAName,
          dto.drugBName,
          dto.severity,
          dto.decision,
          dto.justificationReasonCode ?? null,
          dto.justificationNotes ?? null,
          userId,
        ],
      );
      return res.rows[0];
    });
  }

  async listInteractionDecisions(tenantId: string, rxId?: string) {
    return withTenant({ tenantId }, async (tx) => {
      const params: any[] = [tenantId];
      let sql = `SELECT id.*, u.name as pharmacist_name
                 FROM interaction_decisions id
                 JOIN users u ON u.tenant_id = id.tenant_id AND u.id = id.pharmacist_id
                 WHERE id.tenant_id = $1`;
      if (rxId) {
        params.push(rxId);
        sql += ` AND id.rx_id = $${params.length}`;
      }
      sql += ` ORDER BY id.created_at DESC`;
      const res = await tx.query(sql, params);
      return res.rows;
    });
  }

  // ── Dispensing (PHM-T2, PHM-T4, AC-7) ──────────────────────────────────────

  async listDispenses(tenantId: string, filters: { rxId?: string; patientId?: string; status?: string }) {
    return withTenant({ tenantId }, async (tx) => {
      const params: any[] = [tenantId];
      let sql = `SELECT d.*,
                        pt.first_name as patient_first_name, pt.last_name as patient_last_name,
                        (SELECT value FROM patient_identifiers WHERE tenant_id = pt.tenant_id AND patient_id = pt.id AND type = 'HRN' LIMIT 1) as hrn,
                        u.name as pharmacist_name,
                        p.rx_no
                 FROM dispenses d
                 JOIN patients pt ON pt.tenant_id = d.tenant_id AND pt.id = d.patient_id
                 LEFT JOIN users u ON u.tenant_id = d.tenant_id AND u.id = d.pharmacist_id
                 LEFT JOIN prescriptions p ON p.tenant_id = d.tenant_id AND p.id = d.rx_id
                 WHERE d.tenant_id = $1`;

      if (filters.rxId) {
        params.push(filters.rxId);
        sql += ` AND d.rx_id = $${params.length}`;
      }
      if (filters.patientId) {
        params.push(filters.patientId);
        sql += ` AND d.patient_id = $${params.length}`;
      }
      if (filters.status) {
        params.push(filters.status);
        sql += ` AND d.status = $${params.length}`;
      }

      sql += ` ORDER BY d.created_at DESC`;
      const res = await tx.query(sql, params);
      return res.rows;
    });
  }

  async getDispense(tenantId: string, id: string, tx?: Tx) {
    const runner = async (client: Tx) => {
      const dRes = await client.query(
        `SELECT d.*,
                pt.first_name as patient_first_name, pt.last_name as patient_last_name,
                (SELECT value FROM patient_identifiers WHERE tenant_id = pt.tenant_id AND patient_id = pt.id AND type = 'HRN' LIMIT 1) as hrn,
                pt.date_of_birth as birth_date,
                u.name as pharmacist_name,
                p.rx_no, p.visit_id
         FROM dispenses d
         JOIN patients pt ON pt.tenant_id = d.tenant_id AND pt.id = d.patient_id
         LEFT JOIN users u ON u.tenant_id = d.tenant_id AND u.id = d.pharmacist_id
         LEFT JOIN prescriptions p ON p.tenant_id = d.tenant_id AND p.id = d.rx_id
         WHERE d.tenant_id = $1 AND d.id = $2`,
        [tenantId, id],
      );
      if (!dRes.rows[0]) {
        throw new ProblemException('NOT_FOUND', { detail: 'Dispense not found' });
      }
      const dispense = dRes.rows[0];

      const itemsRes = await client.query(
        `SELECT di.*,
                i.code as item_code, i.name as item_name,
                b.lot_no as batch_no, b.expiry_date,
                u.code as uom_code
         FROM dispense_items di
         JOIN items i ON i.tenant_id = di.tenant_id AND i.id = di.item_id
         LEFT JOIN stock_batches b ON b.tenant_id = di.tenant_id AND b.id = di.batch_id
         JOIN uoms u ON u.tenant_id = di.tenant_id AND u.id = di.uom_id
         WHERE di.tenant_id = $1 AND di.dispense_id = $2`,
        [tenantId, id],
      );

      return {
        ...dispense,
        items: itemsRes.rows,
      };
    };

    if (tx) return runner(tx);
    return withTenant({ tenantId }, runner);
  }

  async createDispense(tenantId: string, userId: string, dto: CreateDispenseRequest) {
    return withTenant({ tenantId }, async (tx) => {
      let isControlled = dto.isControlled ?? false;

      if (dto.rxId) {
        const rxRes = await tx.query(
          `SELECT id, status, is_controlled FROM prescriptions WHERE tenant_id = $1 AND id = $2`,
          [tenantId, dto.rxId],
        );
        if (!rxRes.rows[0]) {
          throw new ProblemException('NOT_FOUND', { detail: 'Prescription not found' });
        }
        const rx = rxRes.rows[0];
        if (rx.status === 'CANCELLED' || rx.status === 'EXPIRED') {
          throw new ProblemException('RX_LOCKED', { detail: `Cannot dispense against ${rx.status} prescription` });
        }
        if (rx.is_controlled) {
          isControlled = true;
        }
      }

      const dispenseNo = `DSP-${Date.now().toString(36).toUpperCase()}-${Math.floor(Math.random() * 1000)}`;

      const dRes = await tx.query(
        `INSERT INTO dispenses (
           tenant_id, branch_id, dispense_no, rx_id, patient_id,
           pharmacist_id, status, is_controlled, notes
         )
         VALUES ($1, $2, $3, $4, $5, $6, 'DRAFT', $7, $8)
         RETURNING *`,
        [
          tenantId,
          dto.branchId,
          dispenseNo,
          dto.rxId ?? null,
          dto.patientId,
          userId,
          isControlled,
          dto.notes ?? null,
        ],
      );
      const dispense = dRes.rows[0];

      if (dto.lines && dto.lines.length > 0) {
        for (const line of dto.lines) {
          const itemRes = await tx.query(
            `SELECT i.base_uom_id, i.standard_cost
             FROM items i
             JOIN drug_products dp ON dp.tenant_id = i.tenant_id AND dp.item_id = i.id
             WHERE i.tenant_id = $1 AND i.id = $2`,
            [tenantId, line.itemId],
          );
          if (!itemRes.rows[0]) {
            throw new ProblemException('NOT_FOUND', {
              detail: `Item not found or not a pharmacy drug product: ${line.itemId}`,
            });
          }
          const item = itemRes.rows[0];
          const unitPrice = line.unitPrice ?? (await this.calculateItemPrice(tenantId, line.itemId, Number(item.standard_cost), tx));
          const totalPrice = Number((unitPrice * line.qty).toFixed(4));

          await tx.query(
            `INSERT INTO dispense_items (
               tenant_id, dispense_id, prescription_item_id, item_id, batch_id,
               qty, uom_id, unit_price, total_price,
               substituted_from_item_id, substitution_reason, override_reason
             )
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
            [
              tenantId,
              dispense.id,
              line.prescriptionItemId ?? null,
              line.itemId,
              line.batchId ?? null,
              line.qty,
              item.base_uom_id,
              unitPrice,
              totalPrice,
              line.substitutedFromItemId ?? null,
              line.substitutionReason ?? null,
              line.overrideReason ?? null,
            ],
          );
        }
      }

      return this.getDispense(tenantId, dispense.id, tx);
    });
  }

  async allocateFefo(tenantId: string, dispenseId: string, locationId: string) {
    return withTenant({ tenantId }, async (tx) => {
      const dRes = await tx.query(
        `SELECT id, status FROM dispenses WHERE tenant_id = $1 AND id = $2`,
        [tenantId, dispenseId],
      );
      if (!dRes.rows[0]) {
        throw new ProblemException('NOT_FOUND', { detail: 'Dispense not found' });
      }
      if (dRes.rows[0].status !== 'DRAFT') {
        throw new ProblemException('CONFLICT', { detail: 'Only draft dispenses can be allocated' });
      }

      const lines = await tx.query(
        `SELECT id, item_id, qty, batch_id, override_reason FROM dispense_items WHERE tenant_id = $1 AND dispense_id = $2`,
        [tenantId, dispenseId],
      );

      for (const line of lines.rows) {
        if (!line.batch_id || !line.override_reason) {
          // Suggest earliest active batch via FEFO
          const batchRes = await tx.query(
            `SELECT sb.id as batch_id, sb.lot_no as batch_no, sb.expiry_date, sbal.qty_on_hand
             FROM stock_batches sb
             JOIN stock_balances sbal ON sbal.tenant_id = sb.tenant_id AND sbal.batch_id = sb.id AND sbal.location_id = $2
             WHERE sb.tenant_id = $1 AND sb.item_id = $3 AND sb.status = 'AVAILABLE' AND sbal.qty_on_hand >= $4
             ORDER BY sb.expiry_date ASC, sb.created_at ASC
             LIMIT 1`,
            [tenantId, locationId, line.item_id, line.qty],
          );

          if (batchRes.rows[0]) {
            await tx.query(
              `UPDATE dispense_items SET batch_id = $3 WHERE tenant_id = $1 AND id = $2`,
              [tenantId, line.id, batchRes.rows[0].batch_id],
            );
          }
        }
      }

      return this.getDispense(tenantId, dispenseId, tx);
    });
  }

  /**
   * Post Dispense (PHM-T2, PHM-T4, AC-7):
   * Single-transaction post of movements, balances, charges, Rx status, and controlled register.
   */
  async postDispense(
    tenantId: string,
    userId: string,
    requestId: string,
    dispenseId: string,
    dto: PostDispenseRequest,
  ) {
    return withTenant({ tenantId }, async (tx) => {
      // 1. Fetch dispense and prescription
      const dRes = await tx.query(
        `SELECT d.*, p.visit_id, p.rx_no, p.status as rx_status
         FROM dispenses d
         LEFT JOIN prescriptions p ON p.tenant_id = d.tenant_id AND p.id = d.rx_id
         WHERE d.tenant_id = $1 AND d.id = $2
         FOR UPDATE OF d`,
        [tenantId, dispenseId],
      );
      if (!dRes.rows[0]) {
        throw new ProblemException('NOT_FOUND', { detail: 'Dispense not found' });
      }
      const dispense = dRes.rows[0];
      if (dispense.status !== 'DRAFT' && dispense.status !== 'READY') {
        throw new ProblemException('CONFLICT', { detail: `Cannot post dispense with status ${dispense.status}` });
      }

      // Charges require an open visit (specification §11.3 BIL-T1; §7.2).
      if (dispense.visit_id) {
        const openVisit = await tx.query(
          `SELECT 1 FROM visits WHERE tenant_id = $1 AND id = $2 AND status NOT IN ('CLOSED','CANCELLED')`,
          [tenantId, dispense.visit_id],
        );
        if ((openVisit.rowCount ?? 0) === 0) {
          throw new ProblemException('VISIT_CLOSED', { detail: 'Dispensing requires an open visit.' });
        }
      }

      // 2. Check if supply module is enabled for tenant
      const supplyModRes = await tx.query(
        `SELECT status FROM tenant_modules WHERE tenant_id = $1 AND module = 'supply' AND status IN ('TRIAL', 'ENABLED')`,
        [tenantId],
      );
      const hasSupply = supplyModRes.rows.length > 0;

      // 3. Process lines (either from dto or existing)
      const lines = dto.lines;
      if (!lines || lines.length === 0) {
        throw new ProblemException('VALIDATION_FAILED', { detail: 'Dispense must contain at least one item line' });
      }

      let isControlled = dispense.is_controlled;
      let totalDispenseAmount = 0;

      // Check items for controlled flag and batch availability
      for (const line of lines) {
        const prodRes = await tx.query(
          `SELECT dp.rx_required, dp.brand_name, i.base_uom_id, i.standard_cost
           FROM items i
           LEFT JOIN drug_products dp ON dp.tenant_id = i.tenant_id AND dp.item_id = i.id
           WHERE i.tenant_id = $1 AND i.id = $2`,
          [tenantId, line.itemId],
        );
        if (!prodRes.rows[0]) {
          throw new ProblemException('NOT_FOUND', { detail: `Item not found: ${line.itemId}` });
        }
        const prod = prodRes.rows[0];
        if (prod.rx_required === 'CONTROLLED') {
          isControlled = true;
        }

        // FEFO allocation check if batch is missing
        let batchId = line.batchId;
        if (!batchId && hasSupply) {
          const fefoRes = await tx.query(
            `SELECT sb.id as batch_id, sb.expiry_date
             FROM stock_batches sb
             JOIN stock_balances sbal ON sbal.tenant_id = sb.tenant_id AND sbal.batch_id = sb.id AND sbal.location_id = $2
             WHERE sb.tenant_id = $1 AND sb.item_id = $3 AND sb.status = 'AVAILABLE' AND sbal.qty_on_hand >= $4
             ORDER BY sb.expiry_date ASC, sb.created_at ASC
             LIMIT 1`,
            [tenantId, dto.locationId, line.itemId, line.qty],
          );
          if (!fefoRes.rows[0]) {
            throw new ProblemException('STOCK_INSUFFICIENT', {
              detail: `Insufficient stock on hand for item "${prod.brand_name || line.itemId}" to satisfy quantity ${line.qty}`,
            });
          }
          batchId = fefoRes.rows[0].batch_id;
          line.batchId = batchId;
        }

        const unitPrice = line.unitPrice ?? (await this.calculateItemPrice(tenantId, line.itemId, Number(prod.standard_cost), tx));
        const lineTotal = Number((unitPrice * line.qty).toFixed(4));
        totalDispenseAmount += lineTotal;
      }

      // 4. AC-7 Controlled Drug Dispense Verification
      let specialRxRecord: any = null;
      if (isControlled) {
        if (!dto.specialRxSerial) {
          throw new ProblemException('VALIDATION_FAILED', {
            detail: 'Special Rx serial is mandatory for controlled drug dispensing (AC-7)',
          });
        }

        // Verify serial uniqueness and single-use
        const srxRes = await tx.query(
          `SELECT * FROM special_rx_records WHERE tenant_id = $1 AND special_rx_serial = $2 FOR UPDATE`,
          [tenantId, dto.specialRxSerial],
        );
        if (!srxRes.rows[0]) {
          throw new ProblemException('NOT_FOUND', {
            detail: `Special Rx record not found for serial "${dto.specialRxSerial}"`,
          });
        }
        specialRxRecord = srxRes.rows[0];

        // Hard block on reuse (AC-7)
        if (specialRxRecord.is_used) {
          throw new ProblemException('CONFLICT', {
            detail: `Special Rx serial "${dto.specialRxSerial}" has already been used and cannot be reused (AC-7 single-use invariant)`,
          });
        }

        // Hard block on refills for controlled drugs (AC-7)
        if (dispense.rx_id) {
          const rxRefillCheck = await tx.query(
            `SELECT count(*) as prev_fills
             FROM dispenses
             WHERE tenant_id = $1 AND rx_id = $2 AND status = 'DISPENSED'`,
            [tenantId, dispense.rx_id],
          );
          if (Number(rxRefillCheck.rows[0]?.prev_fills ?? 0) > 0) {
            throw new ProblemException('FORBIDDEN', {
              detail: 'Refills are strictly forbidden for controlled drugs (AC-7 zero-refill policy)',
            });
          }
        }

        // Words + numerals check (AC-7)
        if (!dto.qtyWords || dto.qtyWords.trim().length === 0) {
          throw new ProblemException('VALIDATION_FAILED', {
            detail: 'Quantity in words is mandatory for controlled drug dispensing (AC-7)',
          });
        }

        // Second authorized user witness co-signature check (AC-7)
        if (!dto.witnessId) {
          throw new ProblemException('VALIDATION_FAILED', {
            detail: 'A second authorized witness co-signature is mandatory for controlled drug dispensing (AC-7)',
          });
        }
        if (dto.witnessId === userId) {
          throw new ProblemException('SEGREGATION_OF_DUTIES', {
            detail: 'Witness cannot be the dispensing pharmacist; a second authorized user is required (AC-7)',
          });
        }

        // Verify witness user exists in tenant
        const witRes = await tx.query(
          `SELECT id, name FROM users WHERE tenant_id = $1 AND id = $2`,
          [tenantId, dto.witnessId],
        );
        if (!witRes.rows[0]) {
          throw new ProblemException('NOT_FOUND', { detail: 'Witness user not found' });
        }

        // Mark special Rx record as used
        await tx.query(
          `UPDATE special_rx_records
           SET is_used = true, used_at = now()
           WHERE tenant_id = $1 AND id = $2`,
          [tenantId, specialRxRecord.id],
        );
      }

      // 5. Post stock movements if supply enabled
      if (hasSupply) {
        for (const line of lines) {
          const itemRes = await tx.query(`SELECT base_uom_id FROM items WHERE tenant_id = $1 AND id = $2`, [tenantId, line.itemId]);
          const baseUomId = itemRes.rows[0]?.base_uom_id;

          await this.supplyService.postMovement(
            tenantId,
            userId,
            requestId,
            {
              locationId: dto.locationId,
              itemId: line.itemId,
              batchId: line.batchId,
              qty: -line.qty,
              uomId: baseUomId,
              movementType: 'DISPENSE',
              refType: 'DISPENSE',
              refId: dispenseId,
              reasonCode: line.overrideReason ? 'MANUAL_OVERRIDE' : undefined,
              reasonNote: line.overrideReason,
            },
            tx,
          );
        }
      }

      // 6. Controlled register append-only entries with running balance (AC-7)
      if (isControlled) {
        for (const line of lines) {
          // Advisory transaction lock per drug item & branch to serialize running balance calculation
          await tx.query(
            `SELECT pg_advisory_xact_lock(hashtext('controlled_register:' || $1 || ':' || $2 || ':' || $3))`,
            [tenantId, dispense.branch_id, line.itemId],
          );

          // Get current running balance for this drug item at branch
          const lastRegRes = await tx.query(
            `SELECT running_balance
             FROM controlled_register
             WHERE tenant_id = $1 AND branch_id = $2 AND drug_item_id = $3
             ORDER BY occurred_at DESC, id DESC
             LIMIT 1`,
            [tenantId, dispense.branch_id, line.itemId],
          );

          let currentBal = 0;
          if (lastRegRes.rows[0]) {
            currentBal = Number(lastRegRes.rows[0].running_balance);
          } else if (hasSupply) {
            // Initial balance from stock_balances if no register entries exist yet
            const initBalRes = await tx.query(
              `SELECT COALESCE(SUM(qty_on_hand), 0) as on_hand
               FROM stock_balances
               WHERE tenant_id = $1 AND batch_id IN (
                 SELECT id FROM stock_batches WHERE tenant_id = $1 AND item_id = $2 AND status = 'AVAILABLE'
               )`,
              [tenantId, line.itemId],
            );
            // Since we just deducted line.qty in stock_movements, pre-dispense balance was on_hand + line.qty
            currentBal = Number(initBalRes.rows[0]?.on_hand ?? 0) + line.qty;
          } else {
            currentBal = line.qty;
          }

          const newRunningBalance = currentBal - line.qty;
          if (newRunningBalance < 0) {
            throw new ProblemException('CONFLICT', {
              detail: `Controlled register running balance cannot be negative (current: ${currentBal}, dispensing: ${line.qty})`,
            });
          }

          await tx.query(
            `INSERT INTO controlled_register (
               tenant_id, branch_id, drug_item_id, batch_id, entry_type,
               qty_in, qty_out, running_balance, patient_id, rx_id, dispense_id,
               special_rx_serial, prescriber_s2_no, pharmacist_id, witness_id, witness_signature
             )
             VALUES ($1, $2, $3, $4, 'DISPENSE', 0, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
            [
              tenantId,
              dispense.branch_id,
              line.itemId,
              line.batchId,
              line.qty,
              newRunningBalance,
              dispense.patient_id,
              dispense.rx_id ?? null,
              dispenseId,
              dto.specialRxSerial ?? null,
              dto.prescriberS2No ?? specialRxRecord?.s2_license_no ?? 'S2-VERIFIED',
              userId,
              dto.witnessId,
              dto.witnessSignature ?? 'SIGNED',
            ],
          );
        }
      }

      // 7. Update/insert dispense_items lines
      await tx.query(`DELETE FROM dispense_items WHERE tenant_id = $1 AND dispense_id = $2`, [tenantId, dispenseId]);
      for (const line of lines) {
        const itemRes = await tx.query(`SELECT base_uom_id, standard_cost FROM items WHERE tenant_id = $1 AND id = $2`, [tenantId, line.itemId]);
        const item = itemRes.rows[0];
        const unitPrice = line.unitPrice ?? (await this.calculateItemPrice(tenantId, line.itemId, Number(item.standard_cost), tx));
        const lineTotal = Number((unitPrice * line.qty).toFixed(4));

        await tx.query(
          `INSERT INTO dispense_items (
             tenant_id, dispense_id, prescription_item_id, item_id, batch_id,
             qty, uom_id, unit_price, total_price,
             substituted_from_item_id, substitution_reason, override_reason
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
          [
            tenantId,
            dispenseId,
            line.prescriptionItemId ?? null,
            line.itemId,
            line.batchId,
            line.qty,
            item.base_uom_id,
            unitPrice,
            lineTotal,
            line.substitutedFromItemId ?? null,
            line.substitutionReason ?? null,
            line.overrideReason ?? null,
          ],
        );

        // Update prescription_items qty_dispensed
        if (line.prescriptionItemId) {
          await tx.query(
            `UPDATE prescription_items
             SET qty_dispensed = qty_dispensed + $3
             WHERE tenant_id = $1 AND id = $2`,
            [tenantId, line.prescriptionItemId, line.qty],
          );
        }
      }

      // 8. Update prescription status (PARTIALLY_DISPENSED vs DISPENSED)
      if (dispense.rx_id) {
        const rxItemsRes = await tx.query(
          `SELECT qty_prescribed, qty_dispensed
           FROM prescription_items
           WHERE tenant_id = $1 AND rx_id = $2`,
          [tenantId, dispense.rx_id],
        );
        const allDone = rxItemsRes.rows.every((r: any) => Number(r.qty_dispensed) >= Number(r.qty_prescribed));
        const nextStatus = allDone ? 'DISPENSED' : 'PARTIALLY_DISPENSED';

        await tx.query(
          `UPDATE prescriptions
           SET status = $3, updated_at = now()
           WHERE tenant_id = $1 AND id = $2`,
          [tenantId, dispense.rx_id, nextStatus],
        );
      }

      // 9. Post charge to billing_charges (if visit_id is known)
      if (dispense.visit_id && totalDispenseAmount > 0) {
        await tx.query(
          `INSERT INTO billing_charges (
             tenant_id, branch_id, visit_id, charge_type, source_type, source_id,
             description, quantity, unit_price, amount, posted_by
           )
           VALUES ($1, $2, $3, 'PHARMACY', 'DISPENSE', $4, $5, 1, $6, $6, $7)
           ON CONFLICT (tenant_id, source_type, source_id) DO UPDATE
             SET amount = EXCLUDED.amount, unit_price = EXCLUDED.unit_price`,
          [
            tenantId,
            dispense.branch_id,
            dispense.visit_id,
            dispenseId,
            `Pharmacy Dispense ${dispense.dispense_no}`,
            totalDispenseAmount,
            userId,
          ],
        );
      }

      // 10. Update dispense header to DISPENSED
      const updatedDispense = await tx.query(
        `UPDATE dispenses
         SET status = 'DISPENSED',
             pharmacist_id = $3,
             dispensed_at = now(),
             counselling_done = $4,
             total_amount = $5,
             updated_at = now()
         WHERE tenant_id = $1 AND id = $2
         RETURNING *`,
        [tenantId, dispenseId, userId, dto.counsellingDone ?? true, totalDispenseAmount],
      );

      return this.getDispense(tenantId, dispenseId, tx);
    });
  }

  /**
   * Void Dispense (PHM-T2 reversal)
   */
  async voidDispense(tenantId: string, userId: string, requestId: string, dispenseId: string, dto: VoidDispenseRequest) {
    return withTenant({ tenantId }, async (tx) => {
      const dRes = await tx.query(
        `SELECT d.*, p.visit_id
         FROM dispenses d
         LEFT JOIN prescriptions p ON p.tenant_id = d.tenant_id AND p.id = d.rx_id
         WHERE d.tenant_id = $1 AND d.id = $2
         FOR UPDATE OF d`,
        [tenantId, dispenseId],
      );
      if (!dRes.rows[0]) {
        throw new ProblemException('NOT_FOUND', { detail: 'Dispense not found' });
      }
      const dispense = dRes.rows[0];
      if (dispense.status !== 'DISPENSED') {
        throw new ProblemException('CONFLICT', { detail: 'Only dispensed orders can be voided' });
      }

      // Check supply module
      const supplyModRes = await tx.query(
        `SELECT status FROM tenant_modules WHERE tenant_id = $1 AND module = 'supply' AND status IN ('TRIAL', 'ENABLED')`,
        [tenantId],
      );
      const hasSupply = supplyModRes.rows.length > 0;

      const items = await tx.query(
        `SELECT * FROM dispense_items WHERE tenant_id = $1 AND dispense_id = $2`,
        [tenantId, dispenseId],
      );

      // 1. Reverse stock movements if supply enabled
      if (hasSupply) {
        for (const line of items.rows) {
          await this.supplyService.postMovement(
            tenantId,
            userId,
            requestId,
            {
              locationId: dto.locationId,
              itemId: line.item_id,
              batchId: line.batch_id,
              qty: Number(line.qty),
              uomId: line.uom_id,
              movementType: 'REVERSAL',
              refType: 'DISPENSE',
              refId: dispenseId,
              reasonCode: 'VOID',
              reasonNote: dto.reason,
            },
            tx,
          );
        }
      }

      // 2. Controlled register adjustment entry if controlled
      if (dispense.is_controlled) {
        for (const line of items.rows) {
          await tx.query(
            `SELECT pg_advisory_xact_lock(hashtext('controlled_register:' || $1 || ':' || $2 || ':' || $3))`,
            [tenantId, dispense.branch_id, line.item_id],
          );
          const lastRegRes = await tx.query(
            `SELECT running_balance
             FROM controlled_register
             WHERE tenant_id = $1 AND branch_id = $2 AND drug_item_id = $3
             ORDER BY occurred_at DESC, id DESC
             LIMIT 1`,
            [tenantId, dispense.branch_id, line.item_id],
          );
          const currentBal = Number(lastRegRes.rows[0]?.running_balance ?? 0);
          const newBal = currentBal + Number(line.qty);

          await tx.query(
            `INSERT INTO controlled_register (
               tenant_id, branch_id, drug_item_id, batch_id, entry_type,
               qty_in, qty_out, running_balance, patient_id, rx_id, dispense_id,
               pharmacist_id, witness_id, notes
             )
             VALUES ($1, $2, $3, $4, 'ADJUSTMENT', $5, 0, $6, $7, $8, $9, $10, $10, $11)`,
            [
              tenantId,
              dispense.branch_id,
              line.item_id,
              line.batch_id,
              line.qty,
              newBal,
              dispense.patient_id,
              dispense.rx_id,
              dispenseId,
              userId,
              `Dispense void reversal: ${dto.reason}`,
            ],
          );
        }
      }

      // 3. Rollback prescription item dispensed quantities
      for (const line of items.rows) {
        if (line.prescription_item_id) {
          await tx.query(
            `UPDATE prescription_items
             SET qty_dispensed = GREATEST(0, qty_dispensed - $3)
             WHERE tenant_id = $1 AND id = $2`,
            [tenantId, line.prescription_item_id, line.qty],
          );
        }
      }

      if (dispense.rx_id) {
        await tx.query(
          `UPDATE prescriptions SET status = 'ISSUED', updated_at = now() WHERE tenant_id = $1 AND id = $2`,
          [tenantId, dispense.rx_id],
        );
      }

      // 4. Void billing charge
      await tx.query(
        `UPDATE billing_charges
         SET voided_at = now(), voided_by = $3
         WHERE tenant_id = $1 AND source_type = 'DISPENSE' AND source_id = $2`,
        [tenantId, dispenseId, userId],
      );

      // 5. Update dispense status to VOID
      const updated = await tx.query(
        `UPDATE dispenses
         SET status = 'VOID',
             notes = COALESCE(notes, '') || ' [VOID: ' || $3 || ']',
             updated_at = now()
         WHERE tenant_id = $1 AND id = $2
         RETURNING *`,
        [tenantId, dispenseId, dto.reason],
      );

      return updated.rows[0];
    });
  }

  // ── OTC Sales (PHM-T3) ─────────────────────────────────────────────────────

  async createAndPostOtcSale(tenantId: string, userId: string, requestId: string, dto: CreateOtcSaleRequest) {
    return withTenant({ tenantId }, async (tx) => {
      // Hard server-side rejection of controlled or prescription-only items
      for (const item of dto.items) {
        const prodRes = await tx.query(
          `SELECT dp.rx_required, dp.brand_name
           FROM drug_products dp
           WHERE dp.tenant_id = $1 AND dp.item_id = $2`,
          [tenantId, item.itemId],
        );
        // Membership in drug_products is what makes an item a pharmacy item; an
        // item with no drug product has no rx_required, so absence must not be
        // treated as "unrestricted".
        if (!prodRes.rows[0]) {
          throw new ProblemException('VALIDATION_FAILED', {
            detail: `Item ${item.itemId} is not a pharmacy drug product and cannot be sold OTC`,
          });
        }
        const req = prodRes.rows[0].rx_required;
        if (req === 'CONTROLLED' || req === 'RX') {
          throw new ProblemException('FORBIDDEN', {
            detail: `Item "${prodRes.rows[0].brand_name}" is classified as ${req} and cannot be sold OTC without a prescription`,
          });
        }
      }

      // Check supply module
      const supplyModRes = await tx.query(
        `SELECT status FROM tenant_modules WHERE tenant_id = $1 AND module = 'supply' AND status IN ('TRIAL', 'ENABLED')`,
        [tenantId],
      );
      const hasSupply = supplyModRes.rows.length > 0;

      // Allocate FEFO batches and post
      let totalAmount = 0;
      const resolvedLines: Array<{ itemId: string; batchId: string; qty: number; unitPrice: number; lineTotal: number; uomId: string }> = [];

      for (const item of dto.items) {
        const itemRes = await tx.query(
          `SELECT base_uom_id, standard_cost FROM items WHERE tenant_id = $1 AND id = $2`,
          [tenantId, item.itemId],
        );
        if (!itemRes.rows[0]) {
          throw new ProblemException('NOT_FOUND', { detail: `Item not found: ${item.itemId}` });
        }
        const baseItem = itemRes.rows[0];

        let batchId = item.batchId;
        if (!batchId && hasSupply) {
          const fefoRes = await tx.query(
            `SELECT sb.id as batch_id
             FROM stock_batches sb
             JOIN stock_balances sbal ON sbal.tenant_id = sb.tenant_id AND sbal.batch_id = sb.id AND sbal.location_id = $2
             WHERE sb.tenant_id = $1 AND sb.item_id = $3 AND sb.status = 'AVAILABLE' AND sbal.qty_on_hand >= $4
             ORDER BY sb.expiry_date ASC, sb.created_at ASC
             LIMIT 1`,
            [tenantId, dto.locationId, item.itemId, item.qty],
          );
          if (!fefoRes.rows[0]) {
            throw new ProblemException('STOCK_INSUFFICIENT', {
              detail: `Insufficient stock on hand for OTC item ${item.itemId}`,
            });
          }
          batchId = fefoRes.rows[0].batch_id;
        }

        const unitPrice = item.unitPrice ?? (await this.calculateItemPrice(tenantId, item.itemId, Number(baseItem.standard_cost), tx));
        const lineTotal = Number((unitPrice * item.qty).toFixed(4));
        totalAmount += lineTotal;

        resolvedLines.push({
          itemId: item.itemId,
          batchId: batchId!,
          qty: item.qty,
          unitPrice,
          lineTotal,
          uomId: baseItem.base_uom_id,
        });
      }

      // If patient not specified, use walk-in / generic patient if needed or generate sale
      let patientId = dto.patientId;
      if (!patientId) {
        const pRes = await tx.query(`SELECT id FROM patients WHERE tenant_id = $1 LIMIT 1`, [tenantId]);
        patientId = pRes.rows[0]?.id;
        if (!patientId) {
          throw new ProblemException('NOT_FOUND', { detail: 'A registered patient is required for OTC sale records' });
        }
      }

      const dispenseNo = `OTC-${Date.now().toString(36).toUpperCase()}-${Math.floor(Math.random() * 1000)}`;

      const dRes = await tx.query(
        `INSERT INTO dispenses (
           tenant_id, branch_id, dispense_no, patient_id, pharmacist_id,
           status, is_controlled, counselling_done, total_amount, notes, dispensed_at
         )
         VALUES ($1, $2, $3, $4, $5, 'DISPENSED', false, $6, $7, $8, now())
         RETURNING *`,
        [
          tenantId,
          dto.branchId,
          dispenseNo,
          patientId,
          userId,
          dto.counsellingDone ?? false,
          totalAmount,
          dto.notes ?? 'OTC Walk-in Sale',
        ],
      );
      const dispense = dRes.rows[0];

      // Insert dispense_items & post movements
      for (const line of resolvedLines) {
        await tx.query(
          `INSERT INTO dispense_items (
             tenant_id, dispense_id, item_id, batch_id, qty, uom_id, unit_price, total_price
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [tenantId, dispense.id, line.itemId, line.batchId, line.qty, line.uomId, line.unitPrice, line.lineTotal],
        );

        if (hasSupply) {
          await this.supplyService.postMovement(
            tenantId,
            userId,
            requestId,
            {
              locationId: dto.locationId,
              itemId: line.itemId,
              batchId: line.batchId,
              qty: -line.qty,
              uomId: line.uomId,
              movementType: 'SALE',
              refType: 'OTC_SALE',
              refId: dispense.id,
            },
            tx,
          );
        }
      }

      return this.getDispense(tenantId, dispense.id, tx);
    });
  }

  // ── In-Clinic Medication Administration (PHM-T6) ───────────────────────────

  async recordMedicationAdministration(
    tenantId: string,
    userId: string,
    requestId: string,
    dto: CreateMedicationAdminRequest,
  ) {
    return withTenant({ tenantId }, async (tx) => {
      // 1. Check supply module
      const supplyModRes = await tx.query(
        `SELECT status FROM tenant_modules WHERE tenant_id = $1 AND module = 'supply' AND status IN ('TRIAL', 'ENABLED')`,
        [tenantId],
      );
      const hasSupply = supplyModRes.rows.length > 0;

      const itemRes = await tx.query(
        `SELECT i.base_uom_id, i.standard_cost
         FROM items i
         JOIN drug_products dp ON dp.tenant_id = i.tenant_id AND dp.item_id = i.id
         WHERE i.tenant_id = $1 AND i.id = $2`,
        [tenantId, dto.drugItemId],
      );
      if (!itemRes.rows[0]) {
        throw new ProblemException('NOT_FOUND', { detail: 'Medication item not found or not a pharmacy drug product' });
      }
      const item = itemRes.rows[0];

      // Charges require an open visit (specification §11.3 BIL-T1; §7.2).
      const openVisit = await tx.query(
        `SELECT 1 FROM visits WHERE tenant_id = $1 AND id = $2 AND status NOT IN ('CLOSED','CANCELLED')`,
        [tenantId, dto.visitId],
      );
      if ((openVisit.rowCount ?? 0) === 0) {
        throw new ProblemException('VISIT_CLOSED', { detail: 'Medication administration requires an open visit.' });
      }

      // 2. Insert medication_administrations record
      const adminRes = await tx.query(
        `INSERT INTO medication_administrations (
           tenant_id, branch_id, visit_id, drug_item_id, batch_id,
           dose, route, given_by, status, notes
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'ADMINISTERED', $9)
         RETURNING *`,
        [
          tenantId,
          dto.branchId,
          dto.visitId,
          dto.drugItemId,
          dto.batchId,
          dto.dose,
          dto.route,
          userId,
          dto.notes ?? null,
        ],
      );
      const admin = adminRes.rows[0];

      // 3. Deduct stock as CONSUMPTION if supply enabled
      if (hasSupply) {
        await this.supplyService.postMovement(
          tenantId,
          userId,
          requestId,
          {
            locationId: dto.locationId,
            itemId: dto.drugItemId,
            batchId: dto.batchId,
            qty: -1, // 1 administration dose
            uomId: item.base_uom_id,
            movementType: 'CONSUMPTION',
            refType: 'MEDICATION_ADMINISTRATION',
            refId: admin.id,
          },
          tx,
        );
      }

      // 4. Post billing charge
      const cost = Number(item.standard_cost ?? 0);
      const price = await this.calculateItemPrice(tenantId, dto.drugItemId, cost, tx);
      if (price > 0) {
        await tx.query(
          `INSERT INTO billing_charges (
             tenant_id, branch_id, visit_id, charge_type, source_type, source_id,
             description, quantity, unit_price, amount, posted_by
           )
           VALUES ($1, $2, $3, 'PHARMACY', 'MEDICATION_ADMINISTRATION', $4, $5, 1, $6, $6, $7)
           ON CONFLICT (tenant_id, source_type, source_id) DO NOTHING`,
          [
            tenantId,
            dto.branchId,
            dto.visitId,
            admin.id,
            `Medication Admin: ${dto.dose} (${dto.route})`,
            price,
            userId,
          ],
        );
      }

      return admin;
    });
  }

  async listMedicationAdministrations(tenantId: string, visitId?: string) {
    return withTenant({ tenantId }, async (tx) => {
      const params: any[] = [tenantId];
      let sql = `SELECT ma.*,
                        i.name as item_name, i.code as item_code,
                        b.lot_no as batch_no, b.expiry_date,
                        u.name as given_by_name
                 FROM medication_administrations ma
                 JOIN items i ON i.tenant_id = ma.tenant_id AND i.id = ma.drug_item_id
                 JOIN stock_batches b ON b.tenant_id = ma.tenant_id AND b.id = ma.batch_id
                 JOIN users u ON u.tenant_id = ma.tenant_id AND u.id = ma.given_by
                 WHERE ma.tenant_id = $1`;
      if (visitId) {
        params.push(visitId);
        sql += ` AND ma.visit_id = $${params.length}`;
      }
      sql += ` ORDER BY ma.administered_at DESC`;
      const res = await tx.query(sql, params);
      return res.rows;
    });
  }

  // ── Patient Returns (PHM-T5) ───────────────────────────────────────────────

  async recordPatientReturn(tenantId: string, userId: string, requestId: string, dto: CreatePatientReturnRequest) {
    return withTenant({ tenantId }, async (tx) => {
      const dItemRes = await tx.query(
        `SELECT di.*, d.status as dispense_status, d.patient_id
         FROM dispense_items di
         JOIN dispenses d ON d.tenant_id = di.tenant_id AND d.id = di.dispense_id
         WHERE di.tenant_id = $1 AND di.id = $2`,
        [tenantId, dto.dispenseItemId],
      );
      if (!dItemRes.rows[0]) {
        throw new ProblemException('NOT_FOUND', { detail: 'Dispense item line not found' });
      }
      const item = dItemRes.rows[0];

      // Check supply module
      const supplyModRes = await tx.query(
        `SELECT status FROM tenant_modules WHERE tenant_id = $1 AND module = 'supply' AND status IN ('TRIAL', 'ENABLED')`,
        [tenantId],
      );
      const hasSupply = supplyModRes.rows.length > 0;

      // 1. Insert patient_returns
      const retRes = await tx.query(
        `INSERT INTO patient_returns (
           tenant_id, branch_id, dispense_id, dispense_item_id,
           qty, reason, disposition, credit_note_ref, created_by
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING *`,
        [
          tenantId,
          dto.branchId,
          dto.dispenseId,
          dto.dispenseItemId,
          dto.qty,
          dto.reason,
          dto.disposition,
          dto.creditNoteRef ?? null,
          userId,
        ],
      );
      const ret = retRes.rows[0];

      // 2. If disposition is RESTOCK and supply is active, return to inventory
      if (dto.disposition === 'RESTOCK' && hasSupply) {
        await this.supplyService.postMovement(
          tenantId,
          userId,
          requestId,
          {
            locationId: dto.locationId,
            itemId: item.item_id,
            batchId: item.batch_id,
            qty: dto.qty,
            uomId: item.uom_id,
            movementType: 'PATIENT_RETURN',
            refType: 'PATIENT_RETURN',
            refId: ret.id,
            reasonNote: dto.reason,
          },
          tx,
        );
      }

      return ret;
    });
  }

  // ── Special Rx Records (AC-7) ──────────────────────────────────────────────

  async listSpecialRxRecords(tenantId: string) {
    return withTenant({ tenantId }, async (tx) => {
      const res = await tx.query(
        `SELECT srx.*,
                i.name as drug_name,
                u.name as prescriber_name,
                pt.first_name as patient_first_name, pt.last_name as patient_last_name,
                (SELECT value FROM patient_identifiers WHERE tenant_id = pt.tenant_id AND patient_id = pt.id AND type = 'HRN' LIMIT 1) as hrn
         FROM special_rx_records srx
         JOIN items i ON i.tenant_id = srx.tenant_id AND i.id = srx.drug_item_id
         JOIN users u ON u.tenant_id = srx.tenant_id AND u.id = srx.prescriber_id
         JOIN patients pt ON pt.tenant_id = srx.tenant_id AND pt.id = srx.patient_id
         WHERE srx.tenant_id = $1
         ORDER BY srx.created_at DESC`,
        [tenantId],
      );
      return res.rows;
    });
  }

  async createSpecialRxRecord(tenantId: string, dto: CreateSpecialRxRecordRequest) {
    return withTenant({ tenantId }, async (tx) => {
      const res = await tx.query(
        `INSERT INTO special_rx_records (
           tenant_id, special_rx_serial, prescriber_id, s2_license_no,
           patient_id, drug_item_id, qty_words, qty_numeric, date_issued, copy_status
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::date, $10)
         RETURNING *`,
        [
          tenantId,
          dto.specialRxSerial.trim(),
          dto.prescriberId,
          dto.s2LicenseNo.trim(),
          dto.patientId,
          dto.drugItemId,
          dto.qtyWords.trim(),
          dto.qtyNumeric,
          dto.dateIssued,
          dto.copyStatus ?? 'ORIGINAL',
        ],
      );
      return res.rows[0];
    });
  }

  // ── Controlled Register (Dangerous Drugs Book, AC-7, RPT-PHM-03) ───────────

  async getControlledRegister(tenantId: string, query: { drugItemId?: string; branchId?: string; from?: string; to?: string }) {
    return withTenant({ tenantId }, async (tx) => {
      const params: any[] = [tenantId];
      let sql = `SELECT cr.*,
                        i.name as drug_name,
                        br.name as branch_name,
                        t.name as clinic_name,
                        b.lot_no as batch_no, b.expiry_date,
                        pt.first_name as patient_first_name, pt.last_name as patient_last_name,
                        (SELECT value FROM patient_identifiers WHERE tenant_id = pt.tenant_id AND patient_id = pt.id AND type = 'HRN' LIMIT 1) as hrn,
                        pharm.name as pharmacist_name,
                        wit.name as witness_name,
                        p.rx_no
                 FROM controlled_register cr
                 JOIN items i ON i.tenant_id = cr.tenant_id AND i.id = cr.drug_item_id
                 JOIN stock_batches b ON b.tenant_id = cr.tenant_id AND b.id = cr.batch_id
                 JOIN branches br ON br.tenant_id = cr.tenant_id AND br.id = cr.branch_id
                 JOIN tenants t ON t.id = cr.tenant_id
                 LEFT JOIN patients pt ON pt.tenant_id = cr.tenant_id AND pt.id = cr.patient_id
                 JOIN users pharm ON pharm.tenant_id = cr.tenant_id AND pharm.id = cr.pharmacist_id
                 JOIN users wit ON wit.tenant_id = cr.tenant_id AND wit.id = cr.witness_id
                 LEFT JOIN prescriptions p ON p.tenant_id = cr.tenant_id AND p.id = cr.rx_id
                 WHERE cr.tenant_id = $1`;

      if (query.drugItemId) {
        params.push(query.drugItemId);
        sql += ` AND cr.drug_item_id = $${params.length}`;
      }
      if (query.branchId) {
        params.push(query.branchId);
        sql += ` AND cr.branch_id = $${params.length}`;
      }
      if (query.from) {
        params.push(query.from);
        sql += ` AND cr.occurred_at >= $${params.length}::timestamptz`;
      }
      if (query.to) {
        params.push(query.to);
        sql += ` AND cr.occurred_at <= $${params.length}::timestamptz`;
      }

      sql += ` ORDER BY cr.occurred_at DESC, cr.id DESC`;
      const res = await tx.query(sql, params);
      return res.rows;
    });
  }

  async getControlledBalance(tenantId: string, drugItemId: string, branchId?: string) {
    return withTenant({ tenantId }, async (tx) => {
      const params: any[] = [tenantId, drugItemId];
      let regSql = `SELECT running_balance
                    FROM controlled_register
                    WHERE tenant_id = $1 AND drug_item_id = $2`;
      if (branchId) {
        params.push(branchId);
        regSql += ` AND branch_id = $3`;
      }
      regSql += ` ORDER BY occurred_at DESC, id DESC LIMIT 1`;
      const regRes = await tx.query(regSql, params);

      const balParams: any[] = [tenantId, drugItemId];
      let balSql = `SELECT COALESCE(SUM(sbal.qty_on_hand), 0) as on_hand
                    FROM stock_balances sbal
                    JOIN stock_batches sb ON sb.tenant_id = sbal.tenant_id AND sb.id = sbal.batch_id
                    WHERE sbal.tenant_id = $1 AND sb.item_id = $2 AND sb.status = 'AVAILABLE'`;
      if (branchId) {
        balParams.push(branchId);
        balSql += ` AND sbal.location_id IN (SELECT id FROM stock_locations WHERE tenant_id = $1 AND branch_id = $3)`;
      }
      const balRes = await tx.query(balSql, balParams);

      const runningBalance = Number(regRes.rows[0]?.running_balance ?? 0);
      const onHand = Number(balRes.rows[0]?.on_hand ?? 0);
      const variance = runningBalance - onHand;

      return {
        drugItemId,
        runningBalance,
        onHand,
        variance,
        isReconciled: Math.abs(variance) < 0.001,
      };
    });
  }

  /**
   * Assemble the Dangerous Drugs Book from the append-only controlled register.
   *
   * The register is the source of truth and is never edited, so the book is
   * regenerated from it rather than maintained separately. When no period or drug
   * filter is supplied the book covers the whole register, which is what a
   * regulatory inspection asks for.
   */
  async getDangerousDrugsBookDocument(
    tenantId: string,
    query: { drugItemId?: string; branchId?: string; from?: string; to?: string } = {},
    meta: { generatedBy?: string } = {},
  ): Promise<DangerousDrugsBookDocument> {
    const newestFirst = (await this.getControlledRegister(tenantId, query)) as Array<Record<string, any>>;

    // The register is queried newest-first for the operational screen, but a
    // Dangerous Drugs Book is a chronological record, so the book reverses it.
    const rows = [...newestFirst].reverse();

    // The closing balance is the balance carried by the most recent entry of each
    // drug, which is the first row seen while walking the newest-first result.
    const closing = new Map<string, number>();
    for (const r of newestFirst) {
      const name = String(r.drug_name ?? 'Controlled drug');
      if (!closing.has(name)) closing.set(name, Number(r.running_balance ?? 0));
    }

    return {
      clinicName: String(rows[0]?.clinic_name ?? 'Clinic Medical Center'),
      branchName: query.branchId ? String(rows[0]?.branch_name ?? '') || undefined : undefined,
      drugFilter: query.drugItemId ? String(rows[0]?.drug_name ?? 'Selected drug') : undefined,
      fromDate: query.from,
      toDate: query.to,
      generatedAt: formatDateTime(new Date()),
      generatedBy: meta.generatedBy,
      closingBalances: [...closing.entries()].map(([drugName, runningBalance]) => ({ drugName, runningBalance })),
      rows: rows.map((r) => ({
        occurredAt: formatDateTime(new Date(r.occurred_at)),
        entryType: String(r.entry_type) as DangerousDrugsBookRow['entryType'],
        drugName: String(r.drug_name ?? 'Controlled drug'),
        batchNo: r.batch_no ?? null,
        expiryDate: r.expiry_date ? formatDate(new Date(r.expiry_date)) : null,
        qtyIn: Number(r.qty_in ?? 0),
        qtyOut: Number(r.qty_out ?? 0),
        runningBalance: Number(r.running_balance ?? 0),
        patientName:
          r.patient_first_name || r.patient_last_name
            ? `${r.patient_last_name ?? ''}, ${r.patient_first_name ?? ''}`.replace(/^,\s*/, '')
            : null,
        patientHrn: r.hrn ?? null,
        rxNo: r.rx_no ?? null,
        specialRxSerial: r.special_rx_serial ?? null,
        prescriberS2No: r.prescriber_s2_no ?? null,
        pharmacistName: String(r.pharmacist_name ?? 'Not recorded'),
        witnessName: String(r.witness_name ?? 'Not recorded'),
        witnessSignature: r.witness_signature ?? null,
        notes: r.notes ?? null,
      })),
    };
  }

  // ── Stock View & Rx Label Print ────────────────────────────────────────────

  async listPharmacyLocations(tenantId: string) {
    return withTenant({ tenantId }, async (tx) => {
      const res = await tx.query(
        `SELECT id, branch_id, code, name, type
         FROM stock_locations
         WHERE tenant_id = $1 AND type IN ('PHARMACY', 'CENTRAL_STORE', 'CLINIC_ROOM')
         ORDER BY name ASC`,
        [tenantId],
      );
      return res.rows;
    });
  }

  async getPharmacyStock(tenantId: string, query: { itemId?: string; locationId?: string; nearExpiry?: boolean }) {
    return withTenant({ tenantId }, async (tx) => {
      const params: any[] = [tenantId];
      let sql = `SELECT sbal.location_id, sbal.batch_id, sbal.qty_on_hand, sbal.qty_reserved,
                        sb.lot_no as batch_no, sb.expiry_date, sb.status as batch_status, sb.unit_cost,
                        i.id as item_id, i.name as item_name, i.code as item_code,
                        sl.name as location_name,
                        dp.rx_required, dp.controlled_schedule, dp.storage, dp.high_alert
                 FROM stock_balances sbal
                 JOIN stock_batches sb ON sb.tenant_id = sbal.tenant_id AND sb.id = sbal.batch_id
                 JOIN items i ON i.tenant_id = sbal.tenant_id AND i.id = sb.item_id
                 JOIN stock_locations sl ON sl.tenant_id = sbal.tenant_id AND sl.id = sbal.location_id
                 JOIN drug_products dp ON dp.tenant_id = i.tenant_id AND dp.item_id = i.id
                 WHERE sbal.tenant_id = $1 AND sbal.qty_on_hand > 0`;

      if (query.itemId) {
        params.push(query.itemId);
        sql += ` AND i.id = $${params.length}`;
      }
      if (query.locationId) {
        params.push(query.locationId);
        sql += ` AND sbal.location_id = $${params.length}`;
      }
      if (query.nearExpiry) {
        sql += ` AND sb.expiry_date <= (CURRENT_DATE + INTERVAL '90 days')`;
      }

      sql += ` ORDER BY sb.expiry_date ASC`;
      const res = await tx.query(sql, params);
      return res.rows;
    });
  }

  async getDispenseLabel(tenantId: string, dispenseId: string) {
    return withTenant({ tenantId }, async (tx) => {
      const dRes = await tx.query(
        `SELECT d.*,
                pt.first_name, pt.last_name,
                (SELECT value FROM patient_identifiers WHERE tenant_id = pt.tenant_id AND patient_id = pt.id AND type = 'HRN' LIMIT 1) as hrn,
                pt.date_of_birth as birth_date,
                u.name as pharmacist_name,
                b.name as branch_name,
                p.rx_no
         FROM dispenses d
         JOIN patients pt ON pt.tenant_id = d.tenant_id AND pt.id = d.patient_id
         JOIN branches b ON b.tenant_id = d.tenant_id AND b.id = d.branch_id
         LEFT JOIN users u ON u.tenant_id = d.tenant_id AND u.id = d.pharmacist_id
         LEFT JOIN prescriptions p ON p.tenant_id = d.tenant_id AND p.id = d.rx_id
         WHERE d.tenant_id = $1 AND d.id = $2`,
        [tenantId, dispenseId],
      );
      if (!dRes.rows[0]) {
        throw new ProblemException('NOT_FOUND', { detail: 'Dispense not found' });
      }
      const d = dRes.rows[0];

      const itemsRes = await tx.query(
        `SELECT di.*,
                i.name as item_name,
                dp.brand_name, dp.strength, dp.dosage_form, dp.route,
                gn.name as generic_name,
                sb.lot_no as batch_no, sb.expiry_date,
                pi.sig_dose, pi.sig_frequency, pi.sig_duration
         FROM dispense_items di
         JOIN items i ON i.tenant_id = di.tenant_id AND i.id = di.item_id
         LEFT JOIN drug_products dp ON dp.tenant_id = di.tenant_id AND dp.item_id = di.item_id
         LEFT JOIN generic_names gn ON gn.tenant_id = di.tenant_id AND gn.id = dp.generic_id
         JOIN stock_batches sb ON sb.tenant_id = di.tenant_id AND sb.id = di.batch_id
         LEFT JOIN prescription_items pi ON pi.tenant_id = di.tenant_id AND pi.id = di.prescription_item_id
         WHERE di.tenant_id = $1 AND di.dispense_id = $2`,
        [tenantId, dispenseId],
      );

      const patientFullName = `${d.first_name} ${d.last_name}`;
      
      const labels = itemsRes.rows.map((row: any) => {
        const drugName = row.brand_name || row.item_name;
        const sig = row.sig_dose 
          ? `${row.sig_dose} ${row.sig_frequency || ''} ${row.sig_duration ? 'for ' + row.sig_duration : ''}`.trim()
          : 'Take as directed by prescriber';
        
        const zpl = renderRxLabel({
          patientName: patientFullName,
          drugName,
          strength: row.strength || '',
          sig,
          quantity: String(row.qty),
          batchNo: row.batch_no,
          expiry: row.expiry_date,
          pharmacistName: d.pharmacist_name || 'System',
          serialNo: d.special_rx_serial,
          issuedAt: new Date(d.dispensed_at).toLocaleDateString(),
        });

        return {
          itemId: row.item_id,
          brandName: drugName,
          genericName: row.generic_name,
          strength: row.strength,
          dosageForm: row.dosage_form,
          directionsForUse: sig,
          quantity: row.qty,
          batchNo: row.batch_no,
          expiryDate: row.expiry_date,
          specialRxSerial: d.special_rx_serial,
          zpl,
        };
      });

      return {
        dispenseId,
        dispenseNo: d.dispense_no,
        dispensedAt: d.dispensed_at,
        branchName: d.branch_name,
        pharmacistName: d.pharmacist_name,
        patient: {
          fullName: patientFullName,
          hrn: d.hrn,
          birthDate: d.birth_date,
        },
        labels,
      };
    });
  }
  // ── Official printouts (true vector PDFs via @clinic/print) ───────────────

  /**
   * OTC sale receipt as an official PDF (PHM-T3). The sale *is* a payment:
   * the dispense carries the collected total, so the receipt document is built
   * from the dispense row itself — no client-side money math, and the bytes
   * come from the shared deterministic print pipeline with the SHA-256 header
   * for tamper-evidence.
   */
  async renderOtcSaleReceiptPdf(tenantId: string, userId: string, dispenseId: string): Promise<RenderedDocument> {
    const facts = await withTenant({ tenantId, userId }, async (tx) => {
      const dRes = await tx.query(
        `SELECT d.dispense_no, d.total_amount, d.dispensed_at, d.notes,
                b.name AS clinic_name,
                u.name AS pharmacist_name,
                pt.first_name AS patient_first, pt.last_name AS patient_last,
                (SELECT json_agg(json_build_object(
                            'description', i.name,
                            'qty', di.qty,
                            'unitPrice', di.unit_price,
                            'total', di.total_price) ORDER BY di.id)
                   FROM dispense_items di
                   JOIN items i ON i.tenant_id = di.tenant_id AND i.id = di.item_id
                  WHERE di.tenant_id = $1 AND di.dispense_id = d.id) AS lines
           FROM dispenses d
           JOIN branches b ON b.tenant_id = d.tenant_id AND b.id = d.branch_id
           LEFT JOIN users u ON u.tenant_id = d.tenant_id AND u.id = d.pharmacist_id
           LEFT JOIN patients pt ON pt.tenant_id = d.tenant_id AND pt.id = d.patient_id
          WHERE d.tenant_id = $1 AND d.id = $2`,
        [tenantId, dispenseId],
      );
      if (!dRes.rows[0]) {
        throw new ProblemException('NOT_FOUND', { detail: 'Sale not found.' });
      }
      const d = dRes.rows[0];
      return {
        clinicName: d.clinic_name,
        receiptNo: d.dispense_no,
        issuedAt: new Date(d.dispensed_at).toISOString(),
        cashierName: d.pharmacist_name || 'Pharmacy',
        patientName: d.patient_first && d.patient_last ? `${d.patient_last}, ${d.patient_first}` : undefined,
        lines: (d.lines ?? []).map((l: { description: string; qty: unknown; unitPrice: unknown; total: unknown }) => ({
          description: l.description,
          qty: Number(l.qty),
          unitPrice: Number(l.unitPrice),
          total: Number(l.total),
        })),
        amount: Number(d.total_amount),
        amountTendered: Number(d.total_amount),
        changeGiven: 0,
      };
    });
    const doc = buildReceiptDocument(facts);
    return renderPdf(renderReceiptHtml(doc), { format: 'A4' });
  }

  /**
   * Medication container labels as a printable PDF sheet (PHM-T3). Reuses
   * `getDispenseLabel`, whose rows already carry the ZPL payload for thermal
   * printers — this renders the same content through the shared print pipeline
   * so ordinary A4/A5 printers produce official labels instead of a browser
   * print of the workbench screen.
   */
  async renderDispenseLabelPdf(tenantId: string, userId: string, dispenseId: string): Promise<RenderedDocument> {
    const label = await this.getDispenseLabel(tenantId, dispenseId);
    const doc = {
      clinicName: label.branchName || 'Clinic Pharmacy',
      branchName: label.branchName || undefined,
      dispenseNo: label.dispenseNo,
      dispensedAt: label.dispensedAt ? new Date(label.dispensedAt).toLocaleString('en-PH') : '',
      patientName: label.patient.fullName,
      patientHrn: label.patient.hrn || undefined,
      patientDob: label.patient.birthDate ? String(label.patient.birthDate).slice(0, 10) : undefined,
      pharmacistName: label.pharmacistName || undefined,
      specialRxSerial: label.labels[0]?.specialRxSerial || undefined,
      items: label.labels.map((l: { brandName: string; genericName?: string; strength?: string; dosageForm?: string; directionsForUse: string; quantity: number | string; batchNo?: string; expiryDate?: string }) => ({
        drugName: l.brandName,
        genericName: l.genericName || undefined,
        strength: l.strength || undefined,
        dosageForm: l.dosageForm || undefined,
        directionsForUse: l.directionsForUse,
        quantity: l.quantity,
        batchNo: l.batchNo || undefined,
        expiryDate: l.expiryDate ? String(l.expiryDate).slice(0, 10) : undefined,
      })),
    };
    return renderPdf(renderDispenseLabelHtml(doc), { format: 'A4' });
  }
}

