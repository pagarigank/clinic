import { Inject, Injectable } from '@nestjs/common';
import { withTenant } from '@clinic/db';
import { renderBarcodeLabel } from '@clinic/print';
import { ProblemException } from '../http/problem.exception.js';
import { SupplyService } from '../supply/supply.service.js';
import { resolveServicePrice } from '../common/pricing.js';
import type {
  CreateLabSectionRequest,
  UpdateLabSectionRequest,
  CreateLabSpecimenTypeRequest,
  CreateLabTestRequest,
  UpdateLabTestRequest,
  CreateLabAnalyteRequest,
  CreateLabReferenceRangeRequest,
  CreateLabDeltaRuleRequest,
  CreateLabInstrumentRequest,
  CreateLabTestReagentRequest,
  CreateLabReportTemplateRequest,
  CreateLabOrderRequest,
  CollectSpecimenRequest,
  ReceiveSpecimenRequest,
  EnterLabResultsRequest,
  AmendLabResultRequest,
  AckCriticalNotificationRequest,
  ReleaseLabReportRequest,
  CreateLabQcMaterialRequest,
  CreateLabQcRunRequest,
  CreateLabSendOutRequest,
  ReceiveLabSendOutResultRequest,
} from '@clinic/contracts';

type Tx = Parameters<Parameters<typeof withTenant>[1]>[0];

@Injectable()
export class LabService {
  // Explicit @Inject: tsx/esbuild does not emit design:paramtypes, so a constructor
  // parameter without it binds undefined and every call that uses it throws
  // "Cannot read properties of undefined" at runtime — never at build time.
  constructor(@Inject(SupplyService) private readonly supplyService: SupplyService) {}

  // ── Sections ───────────────────────────────────────────────────────────────

  async listSections(tenantId: string) {
    return withTenant({ tenantId }, async (tx) => {
      const res = await tx.query(
        `SELECT * FROM lab_sections
         WHERE tenant_id = $1 AND is_active = true
         ORDER BY display_order ASC, name ASC`,
        [tenantId],
      );
      return res.rows;
    });
  }

  async createSection(tenantId: string, dto: CreateLabSectionRequest) {
    return withTenant({ tenantId }, async (tx) => {
      const res = await tx.query(
        `INSERT INTO lab_sections (tenant_id, code, name, display_order, is_active)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [tenantId, dto.code, dto.name, dto.displayOrder ?? 0, dto.isActive ?? true],
      );
      return res.rows[0];
    });
  }

  async updateSection(tenantId: string, id: string, dto: UpdateLabSectionRequest) {
    return withTenant({ tenantId }, async (tx) => {
      const res = await tx.query(
        `UPDATE lab_sections
         SET name = COALESCE($1, name),
             code = COALESCE($2, code),
             display_order = COALESCE($3, display_order),
             is_active = COALESCE($4, is_active),
             updated_at = now()
         WHERE tenant_id = $5 AND id = $6
         RETURNING *`,
        [dto.name, dto.code, dto.displayOrder, dto.isActive, tenantId, id],
      );
      if (!res.rows[0]) throw new ProblemException('NOT_FOUND', { detail: 'Section not found' });
      return res.rows[0];
    });
  }

  async deleteSection(tenantId: string, id: string) {
    return withTenant({ tenantId }, async (tx) => {
      const res = await tx.query(
        `UPDATE lab_sections SET is_active = false WHERE tenant_id = $1 AND id = $2 RETURNING id`,
        [tenantId, id],
      );
      if (!res.rows[0]) throw new ProblemException('NOT_FOUND', { detail: 'Section not found' });
      return { success: true };
    });
  }

  // ── Specimen Types ─────────────────────────────────────────────────────────

  async listSpecimenTypes(tenantId: string) {
    return withTenant({ tenantId }, async (tx) => {
      const res = await tx.query(
        `SELECT * FROM lab_specimen_types
         WHERE tenant_id = $1 AND is_active = true
         ORDER BY name ASC`,
        [tenantId],
      );
      return res.rows;
    });
  }

  async createSpecimenType(tenantId: string, dto: CreateLabSpecimenTypeRequest) {
    return withTenant({ tenantId }, async (tx) => {
      const res = await tx.query(
        `INSERT INTO lab_specimen_types (tenant_id, code, name, default_container, tube_top_color, is_active)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [tenantId, dto.code, dto.name, dto.defaultContainer, dto.tubeTopColor ?? null, dto.isActive ?? true],
      );
      return res.rows[0];
    });
  }

  async deleteSpecimenType(tenantId: string, id: string) {
    return withTenant({ tenantId }, async (tx) => {
      const res = await tx.query(
        `UPDATE lab_specimen_types SET is_active = false WHERE tenant_id = $1 AND id = $2 RETURNING id`,
        [tenantId, id],
      );
      if (!res.rows[0]) throw new ProblemException('NOT_FOUND', { detail: 'Specimen type not found' });
      return { success: true };
    });
  }

  // ── Tests & Panels ─────────────────────────────────────────────────────────

  async listTests(tenantId: string, options?: { isPanel?: boolean; sectionId?: string }) {
    return withTenant({ tenantId }, async (tx) => {
      let query = `
        SELECT lt.*, ls.name as section_name, st.name as specimen_type_name,
               COALESCE(sc.default_price, 0)::float as price, sc.id as service_id
        FROM lab_tests lt
        JOIN lab_sections ls ON ls.id = lt.section_id AND ls.tenant_id = lt.tenant_id
        JOIN lab_specimen_types st ON st.id = lt.specimen_type_id AND st.tenant_id = lt.tenant_id
        LEFT JOIN service_catalog sc ON sc.id = lt.service_id AND sc.tenant_id = lt.tenant_id
        WHERE lt.tenant_id = $1 AND lt.is_active = true
      `;
      const params: any[] = [tenantId];
      if (options?.isPanel !== undefined) {
        params.push(options.isPanel);
        query += ` AND lt.is_panel = $${params.length}`;
      }
      if (options?.sectionId) {
        params.push(options.sectionId);
        query += ` AND lt.section_id = $${params.length}`;
      }
      query += ` ORDER BY lt.name ASC`;
      const res = await tx.query(query, params);
      return res.rows;
    });
  }

  async getTest(tenantId: string, id: string) {
    return withTenant({ tenantId }, async (tx) => {
      const res = await tx.query(
        `SELECT lt.*, ls.name as section_name, st.name as specimen_type_name,
                COALESCE(sc.default_price, 0)::float as price, sc.id as service_id
         FROM lab_tests lt
         JOIN lab_sections ls ON ls.id = lt.section_id AND ls.tenant_id = lt.tenant_id
         JOIN lab_specimen_types st ON st.id = lt.specimen_type_id AND st.tenant_id = lt.tenant_id
         LEFT JOIN service_catalog sc ON sc.id = lt.service_id AND sc.tenant_id = lt.tenant_id
         WHERE lt.tenant_id = $1 AND lt.id = $2`,
        [tenantId, id],
      );
      if (!res.rows[0]) throw new ProblemException('NOT_FOUND', { detail: 'Test not found' });
      const test = res.rows[0];

      // Analytes
      const analytesRes = await tx.query(
        `SELECT * FROM lab_analytes WHERE tenant_id = $1 AND test_id = $2 AND is_active = true ORDER BY sort_order ASC, name ASC`,
        [tenantId, id],
      );
      test.analytes = analytesRes.rows;

      // Panel child tests if is_panel
      if (test.is_panel) {
        const panelRes = await tx.query(
          `SELECT ltp.child_test_id, lt.code, lt.name
           FROM lab_test_panels ltp
           JOIN lab_tests lt ON lt.id = ltp.child_test_id AND lt.tenant_id = ltp.tenant_id
           WHERE ltp.tenant_id = $1 AND ltp.panel_test_id = $2
           ORDER BY ltp.display_order ASC`,
          [tenantId, id],
        );
        test.panelTests = panelRes.rows;
      }

      return test;
    });
  }

  async createTest(tenantId: string, dto: CreateLabTestRequest) {
    return withTenant({ tenantId }, async (tx) => {
      // 1. Transactionally create the billable catalog service with category 'lab' and default price
      const price = dto.price !== undefined ? Number(dto.price) : 0;
      const serviceRes = await tx.query(
        `INSERT INTO service_catalog (tenant_id, code, name, category, default_price, is_active)
         VALUES ($1, $2, $3, 'lab', $4, true)
         RETURNING id`,
        [tenantId, dto.code, dto.name, price],
      );
      const serviceId = serviceRes.rows[0]?.id ?? null;

      if (serviceId && price > 0) {
        await tx.query(
          `INSERT INTO price_lists (tenant_id, service_id, amount, effective_from)
           VALUES ($1, $2, $3, CURRENT_DATE)`,
          [tenantId, serviceId, price],
        );
      }

      // 2. Insert into lab_tests with linked service_id
      const res = await tx.query(
        `INSERT INTO lab_tests (
           tenant_id, section_id, specimen_type_id, code, name, loinc_code,
           tat_minutes, is_stat_allowed,
           is_confidential, fasting_required, fasting_hours, instructions,
           is_panel, requires_pathologist_review, is_active, service_id
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
         RETURNING *`,
        [
          tenantId,
          dto.sectionId,
          dto.specimenTypeId,
          dto.code,
          dto.name,
          dto.loincCode ?? null,
          dto.tatMinutes ?? 60,
          dto.isStatAllowed ?? true,
          dto.isConfidential ?? false,
          dto.fastingRequired ?? false,
          dto.fastingHours ?? null,
          dto.instructions ?? null,
          dto.isPanel ?? false,
          dto.requiresPathologistReview ?? false,
          dto.isActive ?? true,
          serviceId,
        ],
      );
      const test = res.rows[0];
      test.price = price;

      if (dto.isPanel && dto.panelTestIds && dto.panelTestIds.length > 0) {
        for (let i = 0; i < dto.panelTestIds.length; i++) {
          await tx.query(
            `INSERT INTO lab_test_panels (tenant_id, panel_test_id, child_test_id, display_order)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT DO NOTHING`,
            [tenantId, test.id, dto.panelTestIds[i], i],
          );
        }
      }

      return test;
    });
  }

  async updateTest(tenantId: string, id: string, dto: UpdateLabTestRequest) {
    return withTenant({ tenantId }, async (tx) => {
      const existingRes = await tx.query(`SELECT service_id, name, code FROM lab_tests WHERE tenant_id = $1 AND id = $2`, [tenantId, id]);
      if (!existingRes.rows[0]) throw new ProblemException('NOT_FOUND', { detail: 'Test not found' });
      const existing = existingRes.rows[0];

      let serviceId = existing.service_id;
      if (dto.price !== undefined) {
        const price = Number(dto.price);
        if (!serviceId) {
          const scRes = await tx.query(
            `INSERT INTO service_catalog (tenant_id, code, name, category, default_price, is_active)
             VALUES ($1, $2, $3, 'lab', $4, true)
             RETURNING id`,
            [tenantId, dto.code ?? existing.code, dto.name ?? existing.name, price],
          );
          serviceId = scRes.rows[0]?.id;
          await tx.query(`UPDATE lab_tests SET service_id = $1 WHERE tenant_id = $2 AND id = $3`, [serviceId, tenantId, id]);
        } else {
          await tx.query(
            `UPDATE service_catalog SET default_price = $1, name = COALESCE($2, name), updated_at = now() WHERE tenant_id = $3 AND id = $4`,
            [price, dto.name ?? null, tenantId, serviceId],
          );
        }
        await tx.query(
          `INSERT INTO price_lists (tenant_id, service_id, amount, effective_from)
           VALUES ($1, $2, $3, CURRENT_DATE)`,
          [tenantId, serviceId, price],
        );
      }

      const res = await tx.query(
        `UPDATE lab_tests
         SET name = COALESCE($1, name),
             code = COALESCE($2, code),
             section_id = COALESCE($3, section_id),
             specimen_type_id = COALESCE($4, specimen_type_id),
             tat_minutes = COALESCE($5, tat_minutes),
             is_stat_allowed = COALESCE($6, is_stat_allowed),
             is_confidential = COALESCE($7, is_confidential),
             fasting_required = COALESCE($8, fasting_required),
             fasting_hours = COALESCE($9, fasting_hours),
             instructions = COALESCE($10, instructions),
             requires_pathologist_review = COALESCE($11, requires_pathologist_review),
             is_active = COALESCE($12, is_active),
             service_id = COALESCE($13, service_id),
             updated_at = now()
         WHERE tenant_id = $14 AND id = $15
         RETURNING *`,
        [
          dto.name, dto.code, dto.sectionId, dto.specimenTypeId, dto.tatMinutes,
          dto.isStatAllowed, dto.isConfidential, dto.fastingRequired, dto.fastingHours,
          dto.instructions, dto.requiresPathologistReview, dto.isActive,
          serviceId, tenantId, id,
        ],
      );
      const updated = res.rows[0];
      if (dto.price !== undefined) {
        updated.price = Number(dto.price);
      }
      return updated;
    });
  }

  async deleteTest(tenantId: string, id: string) {
    return withTenant({ tenantId }, async (tx) => {
      const res = await tx.query(
        `UPDATE lab_tests SET is_active = false WHERE tenant_id = $1 AND id = $2 RETURNING id`,
        [tenantId, id],
      );
      if (!res.rows[0]) throw new ProblemException('NOT_FOUND', { detail: 'Test not found' });
      return { success: true };
    });
  }

  // ── Analytes ───────────────────────────────────────────────────────────────

  async listAnalytes(tenantId: string, testId: string) {
    return withTenant({ tenantId }, async (tx) => {
      const res = await tx.query(
        `SELECT * FROM lab_analytes
         WHERE tenant_id = $1 AND test_id = $2 AND is_active = true
         ORDER BY sort_order ASC, name ASC`,
        [tenantId, testId],
      );
      return res.rows;
    });
  }

  async createAnalyte(tenantId: string, testId: string, dto: CreateLabAnalyteRequest) {
    return withTenant({ tenantId }, async (tx) => {
      const res = await tx.query(
        `INSERT INTO lab_analytes (
           tenant_id, test_id, code, name, default_unit, precision_digits,
           is_calculated, calculation_formula, sort_order, is_active
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING *`,
        [
          tenantId, testId, dto.code, dto.name, dto.defaultUnit,
          dto.precisionDigits ?? 2, dto.isCalculated ?? false,
          dto.calculationFormula ?? null, dto.sortOrder ?? 0, dto.isActive ?? true,
        ],
      );
      return res.rows[0];
    });
  }

  async deleteAnalyte(tenantId: string, id: string) {
    return withTenant({ tenantId }, async (tx) => {
      const res = await tx.query(
        `UPDATE lab_analytes SET is_active = false WHERE tenant_id = $1 AND id = $2 RETURNING id`,
        [tenantId, id],
      );
      if (!res.rows[0]) throw new ProblemException('NOT_FOUND', { detail: 'Analyte not found' });
      return { success: true };
    });
  }

  // ── Reference Ranges ───────────────────────────────────────────────────────

  async listReferenceRanges(tenantId: string, analyteId: string) {
    return withTenant({ tenantId }, async (tx) => {
      const res = await tx.query(
        `SELECT * FROM lab_reference_ranges
         WHERE tenant_id = $1 AND analyte_id = $2
         ORDER BY sex ASC, age_min_days ASC`,
        [tenantId, analyteId],
      );
      return res.rows;
    });
  }

  async createReferenceRange(tenantId: string, analyteId: string, dto: CreateLabReferenceRangeRequest) {
    return withTenant({ tenantId }, async (tx) => {
      const res = await tx.query(
        `INSERT INTO lab_reference_ranges (
           tenant_id, analyte_id, sex, age_min_days, age_max_days,
           normal_min, normal_max, critical_low, critical_high, text_range,
           effective_from, effective_to
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, COALESCE($11, now()), $12)
         RETURNING *`,
        [
          tenantId, analyteId, dto.sex ?? 'ALL', dto.ageMinDays ?? 0, dto.ageMaxDays ?? 36500,
          dto.normalMin ?? null, dto.normalMax ?? null, dto.criticalLow ?? null, dto.criticalHigh ?? null,
          dto.textRange ?? null, dto.effectiveFrom ? new Date(dto.effectiveFrom) : null,
          dto.effectiveTo ? new Date(dto.effectiveTo) : null,
        ],
      );
      return res.rows[0];
    });
  }

  // ── Delta Rules ────────────────────────────────────────────────────────────

  async listDeltaRules(tenantId: string, analyteId: string) {
    return withTenant({ tenantId }, async (tx) => {
      const res = await tx.query(
        `SELECT * FROM lab_delta_rules WHERE tenant_id = $1 AND analyte_id = $2`,
        [tenantId, analyteId],
      );
      return res.rows;
    });
  }

  async createDeltaRule(tenantId: string, analyteId: string, dto: CreateLabDeltaRuleRequest) {
    return withTenant({ tenantId }, async (tx) => {
      const res = await tx.query(
        `INSERT INTO lab_delta_rules (tenant_id, analyte_id, delta_type, max_change, lookback_hours)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (tenant_id, analyte_id) DO UPDATE
         SET delta_type = EXCLUDED.delta_type,
             max_change = EXCLUDED.max_change,
             lookback_hours = EXCLUDED.lookback_hours
         RETURNING *`,
        [tenantId, analyteId, dto.deltaType ?? 'PERCENT', dto.maxChange, dto.lookbackHours ?? 72],
      );
      return res.rows[0];
    });
  }

  async deleteDeltaRule(tenantId: string, id: string) {
    return withTenant({ tenantId }, async (tx) => {
      const res = await tx.query(
        `DELETE FROM lab_delta_rules WHERE tenant_id = $1 AND id = $2 RETURNING id`,
        [tenantId, id],
      );
      if (!res.rows[0]) throw new ProblemException('NOT_FOUND', { detail: 'Delta rule not found' });
      return { success: true };
    });
  }

  // ── Reagents (BOM) ─────────────────────────────────────────────────────────

  async getTestReagents(tenantId: string, testId: string) {
    return withTenant({ tenantId }, async (tx) => {
      const res = await tx.query(
        `SELECT ltr.*, i.name as item_name, i.code as item_code, u.name as uom_name
         FROM lab_test_reagents ltr
         JOIN items i ON i.id = ltr.item_id AND i.tenant_id = ltr.tenant_id
         JOIN uoms u ON u.id = ltr.uom_id AND u.tenant_id = ltr.tenant_id
         WHERE ltr.tenant_id = $1 AND ltr.test_id = $2`,
        [tenantId, testId],
      );
      return res.rows;
    });
  }

  async setTestReagents(tenantId: string, testId: string, reagents: CreateLabTestReagentRequest[]) {
    return withTenant({ tenantId }, async (tx) => {
      await tx.query(`DELETE FROM lab_test_reagents WHERE tenant_id = $1 AND test_id = $2`, [tenantId, testId]);
      const inserted = [];
      for (const r of reagents) {
        const res = await tx.query(
          `INSERT INTO lab_test_reagents (tenant_id, test_id, item_id, qty_per_test, uom_id)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING *`,
          [tenantId, testId, r.itemId, r.qtyPerTest, r.uomId],
        );
        inserted.push(res.rows[0]);
      }
      return inserted;
    });
  }

  // ── Instruments ────────────────────────────────────────────────────────────

  async listInstruments(tenantId: string, branchId?: string) {
    return withTenant({ tenantId }, async (tx) => {
      let query = `
        SELECT li.*, ls.name as section_name
        FROM lab_instruments li
        JOIN lab_sections ls ON ls.id = li.section_id AND ls.tenant_id = li.tenant_id
        WHERE li.tenant_id = $1 AND li.is_active = true
      `;
      const params: any[] = [tenantId];
      if (branchId) {
        params.push(branchId);
        query += ` AND li.branch_id = $2`;
      }
      query += ` ORDER BY li.name ASC`;
      const res = await tx.query(query, params);
      return res.rows;
    });
  }

  async createInstrument(tenantId: string, dto: CreateLabInstrumentRequest) {
    return withTenant({ tenantId }, async (tx) => {
      const res = await tx.query(
        `INSERT INTO lab_instruments (
           tenant_id, branch_id, section_id, code, name, model, serial_no,
           calibration_due_at, last_calibrated_at, is_active
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING *`,
        [
          tenantId, dto.branchId, dto.sectionId, dto.code, dto.name,
          dto.model ?? null, dto.serialNo ?? null,
          dto.calibrationDueAt ? new Date(dto.calibrationDueAt) : null,
          dto.lastCalibratedAt ? new Date(dto.lastCalibratedAt) : null,
          dto.isActive ?? true,
        ],
      );
      return res.rows[0];
    });
  }

  async deleteInstrument(tenantId: string, id: string) {
    return withTenant({ tenantId }, async (tx) => {
      const res = await tx.query(
        `UPDATE lab_instruments SET is_active = false WHERE tenant_id = $1 AND id = $2 RETURNING id`,
        [tenantId, id],
      );
      if (!res.rows[0]) throw new ProblemException('NOT_FOUND', { detail: 'Instrument not found' });
      return { success: true };
    });
  }

  // ── Panels & Templates ─────────────────────────────────────────────────────

  async addPanelItem(tenantId: string, panelId: string, childTestId: string, displayOrder = 0) {
    return withTenant({ tenantId }, async (tx) => {
      const res = await tx.query(
        `INSERT INTO lab_test_panels (tenant_id, panel_test_id, child_test_id, display_order)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (tenant_id, panel_test_id, child_test_id) DO UPDATE
         SET display_order = EXCLUDED.display_order
         RETURNING *`,
        [tenantId, panelId, childTestId, displayOrder],
      );
      return res.rows[0];
    });
  }

  async listReportTemplates(tenantId: string) {
    return withTenant({ tenantId }, async (tx) => {
      const res = await tx.query(
        `SELECT lrt.*, ls.name as section_name
         FROM lab_report_templates lrt
         LEFT JOIN lab_sections ls ON ls.id = lrt.section_id AND ls.tenant_id = lrt.tenant_id
         WHERE lrt.tenant_id = $1
         ORDER BY lrt.name ASC`,
        [tenantId],
      );
      return res.rows;
    });
  }

  async createReportTemplate(tenantId: string, dto: CreateLabReportTemplateRequest) {
    return withTenant({ tenantId }, async (tx) => {
      const res = await tx.query(
        `INSERT INTO lab_report_templates (tenant_id, section_id, name, template_html, is_default)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [tenantId, dto.sectionId ?? null, dto.name, dto.templateHtml, dto.isDefault ?? false],
      );
      return res.rows[0];
    });
  }

  // ── Worklist & Orders ──────────────────────────────────────────────────────

  async getWorklist(
    tenantId: string,
    filters?: { sectionId?: string; priority?: string; status?: string; ageHours?: number },
  ) {
    return withTenant({ tenantId }, async (tx) => {
      let query = `
        SELECT loi.id as item_id, loi.status as item_status, loi.created_at as item_created_at,
               lo.id as order_id, lo.order_no, lo.priority, lo.source, lo.ordered_at,
               p.id as patient_id, (SELECT value FROM patient_identifiers WHERE patient_id = p.id AND type = 'MRN' LIMIT 1) as mrn,
               p.last_name as family_name, p.first_name as given_name, p.gender as sex, p.date_of_birth,
               lt.id as test_id, lt.code as test_code, lt.name as test_name, lt.is_confidential,
               ls.id as section_id, ls.name as section_name,
               s.id as specimen_id, s.accession_no, s.condition as specimen_condition
        FROM lab_order_items loi
        JOIN lab_orders lo ON lo.id = loi.order_id AND lo.tenant_id = loi.tenant_id
        JOIN patients p ON p.id = lo.patient_id AND p.tenant_id = lo.tenant_id
        JOIN lab_tests lt ON lt.id = loi.test_id AND lt.tenant_id = loi.tenant_id
        JOIN lab_sections ls ON ls.id = lt.section_id AND ls.tenant_id = lt.tenant_id
        LEFT JOIN specimens s ON s.order_id = lo.id AND s.specimen_type_id = lt.specimen_type_id AND s.tenant_id = loi.tenant_id
        WHERE loi.tenant_id = $1 AND lo.status != 'CANCELLED'
      `;
      const params: any[] = [tenantId];

      if (filters?.sectionId) {
        params.push(filters.sectionId);
        query += ` AND ls.id = $${params.length}`;
      }
      if (filters?.priority) {
        params.push(filters.priority);
        query += ` AND lo.priority = $${params.length}`;
      }
      if (filters?.status) {
        params.push(filters.status);
        query += ` AND loi.status = $${params.length}`;
      }
      if (filters?.ageHours) {
        params.push(filters.ageHours);
        query += ` AND lo.ordered_at < now() - ($${params.length} || ' hours')::interval`;
      }

      query += ` ORDER BY CASE WHEN lo.priority = 'STAT' THEN 1 WHEN lo.priority = 'URGENT' THEN 2 ELSE 3 END, lo.ordered_at ASC`;

      const res = await tx.query(query, params);
      return res.rows;
    });
  }

  async listOrders(tenantId: string, branchId?: string, status?: string) {
    return withTenant({ tenantId }, async (tx) => {
      let query = `
        SELECT lo.*, (SELECT value FROM patient_identifiers WHERE patient_id = p.id AND type = 'MRN' LIMIT 1) as mrn,
               p.last_name as family_name, p.first_name as given_name, u.name as ordered_by_name,
               (SELECT COUNT(*)::int FROM lab_order_items WHERE order_id = lo.id AND tenant_id = lo.tenant_id) as item_count
        FROM lab_orders lo
        JOIN patients p ON p.id = lo.patient_id AND p.tenant_id = lo.tenant_id
        JOIN users u ON u.id = lo.ordered_by AND u.tenant_id = lo.tenant_id
        WHERE lo.tenant_id = $1
      `;
      const params: any[] = [tenantId];
      if (branchId) {
        params.push(branchId);
        query += ` AND lo.branch_id = $2`;
      }
      if (status) {
        params.push(status);
        query += ` AND lo.status = $${params.length}`;
      }
      query += ` ORDER BY lo.ordered_at DESC`;
      const res = await tx.query(query, params);
      return res.rows;
    });
  }

  async getOrder(tenantId: string, id: string) {
    return withTenant({ tenantId }, async (tx) => {
      const res = await tx.query(
        `SELECT lo.*, (SELECT value FROM patient_identifiers WHERE patient_id = p.id AND type = 'MRN' LIMIT 1) as mrn,
                p.last_name as family_name, p.first_name as given_name, p.gender as sex, p.date_of_birth,
                u.name as ordered_by_name
         FROM lab_orders lo
         JOIN patients p ON p.id = lo.patient_id AND p.tenant_id = lo.tenant_id
         JOIN users u ON u.id = lo.ordered_by AND u.tenant_id = lo.tenant_id
         WHERE lo.tenant_id = $1 AND lo.id = $2`,
        [tenantId, id],
      );
      if (!res.rows[0]) throw new ProblemException('NOT_FOUND', { detail: 'Lab order not found' });
      const order = res.rows[0];

      const itemsRes = await tx.query(
        `SELECT loi.*, lt.code as test_code, lt.name as test_name, lt.is_confidential,
                s.accession_no, s.condition as specimen_condition
         FROM lab_order_items loi
         JOIN lab_tests lt ON lt.id = loi.test_id AND lt.tenant_id = loi.tenant_id
         LEFT JOIN specimens s ON s.order_id = loi.order_id AND s.specimen_type_id = lt.specimen_type_id AND s.tenant_id = loi.tenant_id
         WHERE loi.tenant_id = $1 AND loi.order_id = $2
         ORDER BY loi.created_at ASC`,
        [tenantId, id],
      );
      order.items = itemsRes.rows;

      return order;
    });
  }

  async createOrder(tenantId: string, userId: string, dto: CreateLabOrderRequest) {
    return withTenant({ tenantId }, async (tx) => {
      // 1. Generate gapless order number
      const docNoRes = await tx.query(`SELECT app.next_doc_no($1, 'lab_order') as doc_no`, [tenantId]);
      const seq = docNoRes.rows[0]?.doc_no ?? '1';
      const orderNo = `LAB-${new Date().getFullYear()}-${String(seq).padStart(6, '0')}`;

      // 2. Insert order header
      const orderRes = await tx.query(
        `INSERT INTO lab_orders (
           tenant_id, branch_id, order_no, patient_id, visit_id, ordered_by,
           priority, clinical_info, status, source
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'ORDERED', $9)
         RETURNING *`,
        [
          tenantId,
          dto.branchId,
          orderNo,
          dto.patientId,
          dto.visitId ?? null,
          userId,
          dto.priority ?? 'ROUTINE',
          dto.clinicalInfo ?? null,
          dto.source ?? 'VISIT',
        ],
      );
      const order = orderRes.rows[0];

      // 3. Expand panels if any test is a panel
      const finalTestIds: string[] = [];
      for (const testId of dto.testIds) {
        const testRes = await tx.query(
          `SELECT is_panel FROM lab_tests WHERE tenant_id = $1 AND id = $2`,
          [tenantId, testId],
        );
        if (testRes.rows[0]?.is_panel) {
          const panelItems = await tx.query(
            `SELECT child_test_id FROM lab_test_panels WHERE tenant_id = $1 AND panel_test_id = $2 ORDER BY display_order ASC`,
            [tenantId, testId],
          );
          if (panelItems.rows.length > 0) {
            for (const pi of panelItems.rows) {
              if (!finalTestIds.includes(pi.child_test_id)) {
                finalTestIds.push(pi.child_test_id);
              }
            }
          } else {
            finalTestIds.push(testId);
          }
        } else {
          if (!finalTestIds.includes(testId)) {
            finalTestIds.push(testId);
          }
        }
      }

      // 4. Insert order items
      const createdItems = [];
      for (const tId of finalTestIds) {
        const itemRes = await tx.query(
          `INSERT INTO lab_order_items (tenant_id, order_id, test_id, status)
           VALUES ($1, $2, $3, 'ORDERED')
           RETURNING *`,
          [tenantId, order.id, tId],
        );
        const item = itemRes.rows[0];

        // 5. Capture a LAB charge against the visit's invoice (BIL-T1, CLN-T6).
        // Price is resolved server-side from the catalog (todo §49).
        // Charges require an open visit (specification §11.3 BIL-T1; §7.2).
        if (dto.visitId) {
          const openVisit = await tx.query(
            `SELECT 1 FROM visits WHERE tenant_id = $1 AND id = $2 AND status NOT IN ('CLOSED','CANCELLED')`,
            [tenantId, dto.visitId],
          );
          if ((openVisit.rowCount ?? 0) === 0) {
            throw new ProblemException('VISIT_CLOSED', { detail: 'Lab orders require an open visit.' });
          }
          const testRes = await tx.query(
            `SELECT name, service_id FROM lab_tests WHERE tenant_id = $1 AND id = $2`,
            [tenantId, tId],
          );
          const test = testRes.rows[0];
          const serviceId: string | null = test?.service_id ?? null;
          const unitPrice = serviceId ? await resolveServicePrice(tx, tenantId, serviceId) : 0;
          const charge = await tx.query(
            `INSERT INTO billing_charges
               (tenant_id, branch_id, visit_id, charge_type, source_type, source_id, service_id, description, quantity, unit_price, amount, payer_type, posted_by)
             VALUES ($1, $2, $3, 'LAB', 'lab_order_item', $4, $5, $6, 1, $7, $7, 'PRIVATE_CASH', $8)
             ON CONFLICT (tenant_id, source_type, source_id) DO NOTHING
             RETURNING id`,
            [tenantId, dto.branchId, dto.visitId, item.id, serviceId, test?.name ?? 'Lab test', unitPrice, userId],
          );
          if (charge.rows[0]) {
            await tx.query(
              `UPDATE lab_order_items SET charge_line_id = $3 WHERE tenant_id = $1 AND id = $2`,
              [tenantId, item.id, charge.rows[0].id],
            );
            item.charge_line_id = charge.rows[0].id;
          }
        }

        createdItems.push(item);
      }

      order.items = createdItems;
      return order;
    });
  }

  async cancelOrder(tenantId: string, id: string, userId: string, reason: string) {
    return withTenant({ tenantId }, async (tx) => {
      const orderRes = await tx.query(
        `SELECT status FROM lab_orders WHERE tenant_id = $1 AND id = $2`,
        [tenantId, id],
      );
      if (!orderRes.rows[0]) throw new ProblemException('NOT_FOUND', { detail: 'Order not found' });
      if (orderRes.rows[0].status === 'CANCELLED') {
        throw new ProblemException('CONFLICT', { detail: 'Order already cancelled' });
      }

      // Update order status
      const res = await tx.query(
        `UPDATE lab_orders
         SET status = 'CANCELLED',
             cancelled_at = now(),
             cancelled_by = $1,
             cancel_reason = $2
         WHERE tenant_id = $3 AND id = $4
         RETURNING *`,
        [userId, reason, tenantId, id],
      );

      // Cancel items
      await tx.query(
        `UPDATE lab_order_items
         SET status = 'CANCELLED'
         WHERE tenant_id = $1 AND order_id = $2 AND status NOT IN ('VERIFIED', 'RELEASED')`,
        [tenantId, id],
      );

      // Void the charges captured at order time (BIL-T4: void posts a reversal).
      // Only never-consumed charges are voided; a charge already consumed into an
      // invoice line would leave a dangling reference, so refuse those.
      const consumed = await tx.query(
        `SELECT count(*)::int AS n
         FROM billing_charges
         WHERE tenant_id = $1 AND source_type = 'lab_order_item'
           AND source_id IN (SELECT id FROM lab_order_items WHERE tenant_id = $1 AND order_id = $2)
           AND voided_at IS NULL AND invoice_id IS NOT NULL`,
        [tenantId, id],
      );
      if ((consumed.rows[0]?.n ?? 0) > 0) {
        throw new ProblemException('CONFLICT', {
          detail: 'Order has charges already consumed into an invoice. Void the invoice line first.',
        });
      }
      await tx.query(
        `UPDATE billing_charges
         SET voided_at = now(), voided_by = $3
         WHERE tenant_id = $1 AND source_type = 'lab_order_item'
           AND source_id IN (SELECT id FROM lab_order_items WHERE tenant_id = $1 AND order_id = $2)
           AND voided_at IS NULL`,
        [tenantId, id, userId],
      );

      return res.rows[0];
    });
  }

  // ── Specimen Lifecycle (LAB-T2, LAB-T3) ────────────────────────────────────

  async collectSpecimen(
    tenantId: string,
    orderId: string,
    itemId: string,
    userId: string,
    dto: CollectSpecimenRequest,
  ) {
    return withTenant({ tenantId }, async (tx) => {
      // 1. Verify item exists and is in ORDERED
      const itemRes = await tx.query(
        `SELECT loi.*, lo.patient_id, lo.order_no
         FROM lab_order_items loi
         JOIN lab_orders lo ON lo.id = loi.order_id AND lo.tenant_id = loi.tenant_id
         WHERE loi.tenant_id = $1 AND loi.order_id = $2 AND loi.id = $3`,
        [tenantId, orderId, itemId],
      );
      if (!itemRes.rows[0]) throw new ProblemException('NOT_FOUND', { detail: 'Order item not found' });

      // 2. Generate accession number
      const accRes = await tx.query(`SELECT app.next_doc_no($1, 'lab_accession') as accession_no`, [tenantId]);
      const seq = accRes.rows[0]?.accession_no ?? '1';
      const accessionNo = `ACC-${new Date().getFullYear()}-${String(seq).padStart(6, '0')}`;

      // 3. Create specimen
      const specimenRes = await tx.query(
        `INSERT INTO specimens (
           tenant_id, accession_no, order_id, specimen_type_id,
           collected_by, collected_at, collection_site, condition, storage_location
         )
         VALUES ($1, $2, $3, $4, $5, COALESCE($6, now()), $7, 'OK', $8)
         RETURNING *`,
        [
          tenantId,
          accessionNo,
          orderId,
          dto.specimenTypeId,
          userId,
          dto.collectedAt ? new Date(dto.collectedAt) : null,
          dto.collectionSite ?? null,
          dto.storageLocation ?? null,
        ],
      );
      const specimen = specimenRes.rows[0];

      // 4. Log chain of custody event
      await tx.query(
        `INSERT INTO specimen_events (tenant_id, specimen_id, event, by_user_id, note)
         VALUES ($1, $2, 'COLLECTED', $3, $4)`,
        [tenantId, specimen.id, userId, `Collected with 2-identifier verification: ${dto.twoIdentifiersVerified}`],
      );

      // 5. Update order item
      await tx.query(
        `UPDATE lab_order_items
         SET status = 'COLLECTED'
         WHERE tenant_id = $1 AND id = $2`,
        [tenantId, itemId],
      );

      // 6. Update order status if needed
      await tx.query(
        `UPDATE lab_orders
         SET status = 'COLLECTED'
         WHERE tenant_id = $1 AND id = $2 AND status = 'ORDERED'`,
        [tenantId, orderId],
      );

      return {
        specimen,
        accessionNo,
        barcodeData: {
          accessionNo,
          orderNo: itemRes.rows[0].order_no,
          collectedAt: specimen.collected_at,
          collectorId: userId,
        },
      };
    });
  }

  async receiveSpecimen(
    tenantId: string,
    orderId: string,
    itemId: string,
    userId: string,
    dto: ReceiveSpecimenRequest,
  ) {
    return withTenant({ tenantId }, async (tx) => {
      const itemRes = await tx.query(
        `SELECT loi.*, s.id as specimen_id, lo.order_no
         FROM lab_order_items loi
         JOIN lab_tests lt ON lt.id = loi.test_id AND lt.tenant_id = loi.tenant_id
         JOIN lab_orders lo ON lo.id = loi.order_id AND lo.tenant_id = loi.tenant_id
         LEFT JOIN specimens s ON s.order_id = lo.id AND s.specimen_type_id = lt.specimen_type_id AND s.tenant_id = loi.tenant_id
         WHERE loi.tenant_id = $1 AND loi.order_id = $2 AND loi.id = $3`,
        [tenantId, orderId, itemId],
      );
      if (!itemRes.rows[0]) throw new ProblemException('NOT_FOUND', { detail: 'Order item not found' });
      const item = itemRes.rows[0];
      if (!item.specimen_id) throw new ProblemException('VALIDATION_FAILED', { detail: 'Specimen not yet collected' });

      if (dto.condition === 'OK') {
        // Accept
        await tx.query(
          `UPDATE specimens
           SET received_by = $1, received_at = now(), condition = 'OK', storage_location = COALESCE($2, storage_location)
           WHERE tenant_id = $3 AND id = $4`,
          [userId, dto.storageLocation ?? null, tenantId, item.specimen_id],
        );

        await tx.query(
          `INSERT INTO specimen_events (tenant_id, specimen_id, event, by_user_id, note)
           VALUES ($1, $2, 'RECEIVED', $3, 'Received in laboratory in good condition')`,
          [tenantId, item.specimen_id, userId],
        );

        await tx.query(
          `UPDATE lab_order_items SET status = 'RECEIVED' WHERE tenant_id = $1 AND id = $2`,
          [tenantId, itemId],
        );

        return { status: 'RECEIVED', specimenId: item.specimen_id };
      } else {
        // Reject
        await tx.query(
          `UPDATE specimens
           SET condition = $1, rejection_reason = $2, rejected_at = now(), rejected_by = $3
           WHERE tenant_id = $4 AND id = $5`,
          [dto.condition, dto.rejectionReason ?? 'Specimen rejected', userId, tenantId, item.specimen_id],
        );

        await tx.query(
          `INSERT INTO specimen_events (tenant_id, specimen_id, event, by_user_id, note)
           VALUES ($1, $2, 'REJECTED', $3, $4)`,
          [tenantId, item.specimen_id, userId, `Rejected: ${dto.condition} - ${dto.rejectionReason}`],
        );

        await tx.query(
          `UPDATE lab_order_items SET status = 'REJECTED' WHERE tenant_id = $1 AND id = $2`,
          [tenantId, itemId],
        );

        // Auto-recollect notification / task in outbox
        await tx.query(
          `INSERT INTO outbox (tenant_id, event_type, payload)
           VALUES ($1, 'lab.specimen.rejected', $2)
           ON CONFLICT DO NOTHING`,
          [
            tenantId,
            JSON.stringify({
              orderId,
              orderItemId: itemId,
              reason: dto.rejectionReason,
              condition: dto.condition,
              rejectedBy: userId,
            }),
          ],
        );

        return { status: 'REJECTED', specimenId: item.specimen_id, recollectTaskCreated: true };
      }
    });
  }

  async startRun(tenantId: string, orderId: string, itemId: string, userId: string) {
    return withTenant({ tenantId }, async (tx) => {
      const res = await tx.query(
        `UPDATE lab_order_items
         SET status = 'IN_PROGRESS'
         WHERE tenant_id = $1 AND order_id = $2 AND id = $3
         RETURNING *`,
        [tenantId, orderId, itemId],
      );
      if (!res.rows[0]) throw new ProblemException('NOT_FOUND', { detail: 'Order item not found' });

      await tx.query(
        `UPDATE lab_orders SET status = 'IN_PROGRESS' WHERE tenant_id = $1 AND id = $2 AND status IN ('ORDERED', 'COLLECTED')`,
        [tenantId, orderId],
      );

      return res.rows[0];
    });
  }

  // ── Results (LAB-T4, LAB-T6, LAB-T7, LAB-T9) ───────────────────────────────

  async getItemResults(
    tenantId: string,
    orderId: string,
    itemId: string,
    userRoles?: string[],
    confidentialReason?: string,
  ) {
    return withTenant({ tenantId }, async (tx) => {
      // 1. Check if test is confidential
      const testRes = await tx.query(
        `SELECT lt.is_confidential, lt.name as test_name, lo.patient_id
         FROM lab_order_items loi
         JOIN lab_tests lt ON lt.id = loi.test_id AND lt.tenant_id = loi.tenant_id
         JOIN lab_orders lo ON lo.id = loi.order_id AND lo.tenant_id = loi.tenant_id
         WHERE loi.tenant_id = $1 AND loi.order_id = $2 AND loi.id = $3`,
        [tenantId, orderId, itemId],
      );
      if (!testRes.rows[0]) throw new ProblemException('NOT_FOUND', { detail: 'Order item not found' });
      const test = testRes.rows[0];

      if (test.is_confidential) {
        // Log access in phi_access_log if accessible
        await tx.query(
          `INSERT INTO phi_access_log (tenant_id, patient_id, record_type, record_id, reason)
           VALUES ($1, $2, 'LAB_CONFIDENTIAL_RESULT', $3, $4)
           ON CONFLICT DO NOTHING`,
          [tenantId, test.patient_id, itemId, confidentialReason ?? 'Confidential lab result view'],
        );
      }

      const res = await tx.query(
        `SELECT lr.*, la.name as analyte_name, la.code as analyte_code, la.is_calculated,
                u1.name as entered_by_name, u2.name as verified_by_name,
                li.name as instrument_name
         FROM lab_results lr
         JOIN lab_analytes la ON la.id = lr.analyte_id AND la.tenant_id = lr.tenant_id
         JOIN users u1 ON u1.id = lr.entered_by AND u1.tenant_id = lr.tenant_id
         LEFT JOIN users u2 ON u2.id = lr.verified_by AND u2.tenant_id = lr.tenant_id
         LEFT JOIN lab_instruments li ON li.id = lr.instrument_id AND li.tenant_id = lr.tenant_id
         WHERE lr.tenant_id = $1 AND lr.order_item_id = $2
         ORDER BY la.sort_order ASC, la.name ASC`,
        [tenantId, itemId],
      );

      return res.rows;
    });
  }

  async enterResults(
    tenantId: string,
    orderId: string,
    itemId: string,
    userId: string,
    dto: EnterLabResultsRequest,
  ) {
    return withTenant({ tenantId }, async (tx) => {
      // 1. Fetch item and patient details for range auto-flagging
      const itemRes = await tx.query(
        `SELECT loi.*, lo.patient_id, p.gender, p.date_of_birth, lt.id as test_id
         FROM lab_order_items loi
         JOIN lab_orders lo ON lo.id = loi.order_id AND lo.tenant_id = loi.tenant_id
         JOIN patients p ON p.id = lo.patient_id AND p.tenant_id = lo.tenant_id
         JOIN lab_tests lt ON lt.id = loi.test_id AND lt.tenant_id = loi.tenant_id
         WHERE loi.tenant_id = $1 AND loi.order_id = $2 AND loi.id = $3`,
        [tenantId, orderId, itemId],
      );
      if (!itemRes.rows[0]) throw new ProblemException('NOT_FOUND', { detail: 'Order item not found' });
      const item = itemRes.rows[0];

      // Calculate patient age in days
      const dob = new Date(item.date_of_birth);
      const ageDays = Math.max(0, Math.floor((Date.now() - dob.getTime()) / (1000 * 60 * 60 * 24)));
      const patientSex = (item.gender === 'M' || item.gender === 'MALE') ? 'MALE' : (item.gender === 'F' || item.gender === 'FEMALE') ? 'FEMALE' : 'ALL';

      const insertedResults = [];

      for (const r of dto.results) {
        // 2. Find matching reference range
        const rangeRes = await tx.query(
          `SELECT * FROM lab_reference_ranges
           WHERE tenant_id = $1 AND analyte_id = $2
             AND (sex = 'ALL' OR sex = $3)
             AND age_min_days <= $4 AND age_max_days >= $4
             AND effective_from <= now() AND (effective_to IS NULL OR effective_to >= now())
           ORDER BY (sex != 'ALL') DESC
           LIMIT 1`,
          [tenantId, r.analyteId, patientSex, ageDays],
        );
        const refRange = rangeRes.rows[0];

        // 3. Determine Flag: N, L, H, LL, HH, A
        let flag = 'N';
        let refRangeText = refRange?.text_range ?? null;

        if (r.valueNum !== undefined && r.valueNum !== null) {
          const val = Number(r.valueNum);
          if (refRange) {
            const cLow = refRange.critical_low !== null ? Number(refRange.critical_low) : null;
            const cHigh = refRange.critical_high !== null ? Number(refRange.critical_high) : null;
            const nMin = refRange.normal_min !== null ? Number(refRange.normal_min) : null;
            const nMax = refRange.normal_max !== null ? Number(refRange.normal_max) : null;

            if (cLow !== null && val < cLow) flag = 'LL';
            else if (cHigh !== null && val > cHigh) flag = 'HH';
            else if (nMin !== null && val < nMin) flag = 'L';
            else if (nMax !== null && val > nMax) flag = 'H';
            else flag = 'N';

            refRangeText = refRangeText ?? `${nMin ?? '—'} - ${nMax ?? '—'}`;
          }
        } else if (r.valueText) {
          if (refRangeText && !r.valueText.toLowerCase().includes('negative') && !r.valueText.toLowerCase().includes('normal')) {
            flag = 'A';
          }
        }

        // 4. Delta check against previous verified result for same patient and analyte
        let deltaFlag: string | null = null;
        if (r.valueNum !== undefined && r.valueNum !== null) {
          const prevRes = await tx.query(
            `SELECT lr.value_num, lr.entered_at
             FROM lab_results lr
             JOIN lab_order_items loi ON loi.id = lr.order_item_id AND loi.tenant_id = lr.tenant_id
             JOIN lab_orders lo ON lo.id = loi.order_id AND lo.tenant_id = lr.tenant_id
             WHERE lr.tenant_id = $1 AND lo.patient_id = $2 AND lr.analyte_id = $3
               AND lr.status = 'VERIFIED' AND lr.value_num IS NOT NULL
             ORDER BY lr.verified_at DESC
             LIMIT 1`,
            [tenantId, item.patient_id, r.analyteId],
          );

          if (prevRes.rows[0]) {
            const prevVal = Number(prevRes.rows[0].value_num);
            const deltaRuleRes = await tx.query(
              `SELECT * FROM lab_delta_rules WHERE tenant_id = $1 AND analyte_id = $2`,
              [tenantId, r.analyteId],
            );
            const rule = deltaRuleRes.rows[0];
            if (rule) {
              const maxChange = Number(rule.max_change);
              if (rule.delta_type === 'PERCENT' && prevVal !== 0) {
                const pct = (Math.abs(Number(r.valueNum) - prevVal) / Math.abs(prevVal)) * 100;
                deltaFlag = pct > maxChange ? 'DELTA_WARN' : 'DELTA_PASS';
              } else {
                const diff = Math.abs(Number(r.valueNum) - prevVal);
                deltaFlag = diff > maxChange ? 'DELTA_WARN' : 'DELTA_PASS';
              }
            }
          }
        }

        // 5. Insert result
        const insertRes = await tx.query(
          `INSERT INTO lab_results (
             tenant_id, order_item_id, analyte_id, value_num, value_text,
             unit, flag, ref_range_text, delta_flag, status, entered_by, instrument_id
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'ENTERED', $10, $11)
           RETURNING *`,
          [
            tenantId, itemId, r.analyteId, r.valueNum ?? null, r.valueText ?? null,
            r.unit, flag, refRangeText, deltaFlag, userId, r.instrumentId ?? null,
          ],
        );
        const result = insertRes.rows[0];
        insertedResults.push(result);

        // 6. Critical Alert workflow (LAB-T7, AC-10): HH or LL value
        if (flag === 'LL' || flag === 'HH') {
          await tx.query(
            `INSERT INTO lab_critical_notifications (
               tenant_id, result_id, detected_at, notified_to, notified_by, method, read_back_confirmed
             )
             VALUES ($1, $2, now(), 'Responsible Clinician', $3, 'IN_APP', false)`,
            [tenantId, result.id, userId],
          );

          // Emit outbox alert
          await tx.query(
            `INSERT INTO outbox (tenant_id, event_type, payload)
             VALUES ($1, 'lab.critical.detected', $2)
             ON CONFLICT DO NOTHING`,
            [
              tenantId,
              JSON.stringify({
                resultId: result.id,
                orderId,
                orderItemId: itemId,
                flag,
                value: r.valueNum ?? r.valueText,
                detectedAt: new Date().toISOString(),
              }),
            ],
          );
        }
      }

      // 7. Update order item status to RESULTED
      await tx.query(
        `UPDATE lab_order_items SET status = 'RESULTED' WHERE tenant_id = $1 AND id = $2`,
        [tenantId, itemId],
      );

      // 8. Reagent consumption BOM posting (Soft dependency on Supply)
      if (dto.locationId) {
        const supplyModRes = await tx.query(
          `SELECT status FROM tenant_modules WHERE tenant_id = $1 AND module = 'supply' AND status IN ('TRIAL', 'ENABLED')`,
          [tenantId],
        );
        if (supplyModRes.rows.length > 0) {
          const reagents = await tx.query(
            `SELECT * FROM lab_test_reagents WHERE tenant_id = $1 AND test_id = $2`,
            [tenantId, item.test_id],
          );
          for (const reg of reagents.rows) {
            try {
              await this.supplyService.postMovement(
                tenantId,
                userId,
                `reagent-${itemId}-${reg.item_id}`,
                {
                  locationId: dto.locationId,
                  itemId: reg.item_id,
                  qty: -Number(reg.qty_per_test),
                  uomId: reg.uom_id,
                  movementType: 'CONSUMPTION',
                  refType: 'LAB_REAGENT_CONSUMPTION',
                  refId: itemId,
                },
                tx,
              );
            } catch {
              // Reagent inventory deduction degradation (soft dependency)
            }
          }
          await tx.query(
            `UPDATE lab_order_items SET reagents_consumed_at = now() WHERE tenant_id = $1 AND id = $2`,
            [tenantId, itemId],
          );
        }
      }

      return insertedResults;
    });
  }

  async verifyResult(tenantId: string, resultId: string, userId: string) {
    return withTenant({ tenantId }, async (tx) => {
      // 1. Fetch result
      const res = await tx.query(
        `SELECT lr.*, loi.order_id, loi.id as item_id, loi.test_id
         FROM lab_results lr
         JOIN lab_order_items loi ON loi.id = lr.order_item_id AND loi.tenant_id = lr.tenant_id
         WHERE lr.tenant_id = $1 AND lr.id = $2`,
        [tenantId, resultId],
      );
      if (!res.rows[0]) throw new ProblemException('NOT_FOUND', { detail: 'Result not found' });
      const result = res.rows[0];

      // 2. AC-17 Segregation of Duties: encoder cannot verify own result
      if (result.entered_by === userId) {
        throw new ProblemException('SEGREGATION_OF_DUTIES', {
          detail: 'Encoder cannot verify own result (AC-17)',
        });
      }

      if (result.status === 'VERIFIED') {
        return result; // Idempotent
      }

      // 3. Mark VERIFIED
      const updated = await tx.query(
        `UPDATE lab_results
         SET status = 'VERIFIED',
             verified_by = $1,
             verified_at = now(),
             updated_at = now()
         WHERE tenant_id = $2 AND id = $3
         RETURNING *`,
        [userId, tenantId, resultId],
      );

      // Check if all results for this order item are verified
      const unverified = await tx.query(
        `SELECT id FROM lab_results
         WHERE tenant_id = $1 AND order_item_id = $2 AND status != 'VERIFIED'`,
        [tenantId, result.item_id],
      );
      if (unverified.rows.length === 0) {
        await tx.query(
          `UPDATE lab_order_items SET status = 'VERIFIED' WHERE tenant_id = $1 AND id = $2`,
          [tenantId, result.item_id],
        );
      }

      return updated.rows[0];
    });
  }

  async amendResult(tenantId: string, resultId: string, userId: string, dto: AmendLabResultRequest) {
    return withTenant({ tenantId }, async (tx) => {
      const res = await tx.query(
        `SELECT lr.*, loi.order_id, lo.order_no, lo.ordered_by
         FROM lab_results lr
         JOIN lab_order_items loi ON loi.id = lr.order_item_id AND loi.tenant_id = lr.tenant_id
         JOIN lab_orders lo ON lo.id = loi.order_id AND lo.tenant_id = lr.tenant_id
         WHERE lr.tenant_id = $1 AND lr.id = $2`,
        [tenantId, resultId],
      );
      if (!res.rows[0]) throw new ProblemException('NOT_FOUND', { detail: 'Result not found' });
      const current = res.rows[0];

      // AC-11 Result integrity: Must be previously verified to amend
      if (current.status !== 'VERIFIED' && current.status !== 'AMENDED') {
        throw new ProblemException('VALIDATION_FAILED', { detail: 'Only verified results can be amended' });
      }

      const oldValue = current.value_num !== null ? String(current.value_num) : (current.value_text ?? '');

      // 1. Record amendment in append-only table lab_result_amendments
      const amendRes = await tx.query(
        `INSERT INTO lab_result_amendments (
           tenant_id, result_id, old_value, new_value, reason, amended_by, notified_to_user_id
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [tenantId, resultId, oldValue, dto.newValue, dto.reason, userId, dto.notifiedToUserId ?? current.ordered_by],
      );

      // 2. Update result to AMENDED and increment version
      const numVal = isNaN(Number(dto.newValue)) ? null : Number(dto.newValue);
      const textVal = isNaN(Number(dto.newValue)) ? dto.newValue : null;

      const updated = await tx.query(
        `UPDATE lab_results
         SET status = 'AMENDED',
             value_num = $1,
             value_text = $2,
             version = version + 1,
             updated_at = now()
         WHERE tenant_id = $3 AND id = $4
         RETURNING *`,
        [numVal, textVal, tenantId, resultId],
      );

      // 3. Notify ordering clinician
      await tx.query(
        `INSERT INTO outbox (tenant_id, event_type, payload)
         VALUES ($1, 'lab.result.amended', $2)
         ON CONFLICT DO NOTHING`,
        [
          tenantId,
          JSON.stringify({
            resultId,
            orderId: current.order_id,
            orderNo: current.order_no,
            oldValue,
            newValue: dto.newValue,
            reason: dto.reason,
            amendedBy: userId,
            notifiedTo: dto.notifiedToUserId ?? current.ordered_by,
          }),
        ],
      );

      return {
        result: updated.rows[0],
        amendment: amendRes.rows[0],
      };
    });
  }

  async getAmendments(tenantId: string, resultId: string) {
    return withTenant({ tenantId }, async (tx) => {
      const res = await tx.query(
        `SELECT lra.*, u.name as amended_by_name
         FROM lab_result_amendments lra
         JOIN users u ON u.id = lra.amended_by AND u.tenant_id = lra.tenant_id
         WHERE lra.tenant_id = $1 AND lra.result_id = $2
         ORDER BY lra.amended_at DESC`,
        [tenantId, resultId],
      );
      return res.rows;
    });
  }

  // ── Critical Alerts (LAB-T7, AC-10) ────────────────────────────────────────

  async listCriticalAlerts(tenantId: string, acknowledged?: boolean) {
    return withTenant({ tenantId }, async (tx) => {
      let query = `
        SELECT lcn.*, lr.value_num, lr.value_text, lr.unit, lr.flag, lr.ref_range_text,
               la.name as analyte_name, la.code as analyte_code,
               lo.order_no, lo.priority, lo.branch_id,
               p.id as patient_id, (SELECT value FROM patient_identifiers WHERE patient_id = p.id AND type = 'MRN' LIMIT 1) as mrn,
               p.last_name as family_name, p.first_name as given_name, p.date_of_birth, p.gender as sex,
               u.name as notified_by_name
        FROM lab_critical_notifications lcn
        JOIN lab_results lr ON lr.id = lcn.result_id AND lr.tenant_id = lcn.tenant_id
        JOIN lab_analytes la ON la.id = lr.analyte_id AND la.tenant_id = lcn.tenant_id
        JOIN lab_order_items loi ON loi.id = lr.order_item_id AND loi.tenant_id = lcn.tenant_id
        JOIN lab_orders lo ON lo.id = loi.order_id AND lo.tenant_id = lcn.tenant_id
        JOIN patients p ON p.id = lo.patient_id AND p.tenant_id = lcn.tenant_id
        JOIN users u ON u.id = lcn.notified_by AND u.tenant_id = lcn.tenant_id
        WHERE lcn.tenant_id = $1
      `;
      const params: any[] = [tenantId];
      if (acknowledged !== undefined) {
        if (acknowledged) {
          query += ` AND lcn.acknowledged_at IS NOT NULL`;
        } else {
          query += ` AND lcn.acknowledged_at IS NULL`;
        }
      }
      query += ` ORDER BY lcn.detected_at DESC`;
      const res = await tx.query(query, params);
      return res.rows;
    });
  }

  async acknowledgeCriticalAlert(
    tenantId: string,
    alertId: string,
    userId: string,
    dto: AckCriticalNotificationRequest,
  ) {
    return withTenant({ tenantId }, async (tx) => {
      const res = await tx.query(
        `UPDATE lab_critical_notifications
         SET acknowledged_at = now(),
             notified_to = $1,
             method = $2,
             read_back_confirmed = $3,
             read_back_text = $4
         WHERE tenant_id = $5 AND id = $6
         RETURNING *`,
        [dto.notifiedTo, dto.method, dto.readBackConfirmed, dto.readBackText, tenantId, alertId],
      );
      if (!res.rows[0]) throw new ProblemException('NOT_FOUND', { detail: 'Critical alert not found' });
      return res.rows[0];
    });
  }

  // ── Reports (LAB-T8) ───────────────────────────────────────────────────────

  async releaseReport(tenantId: string, orderId: string, userId: string, dto: ReleaseLabReportRequest) {
    return withTenant({ tenantId }, async (tx) => {
      // 1. Fetch order and results to assemble report payload
      const orderRes = await tx.query(
        `SELECT lo.*, (SELECT value FROM patient_identifiers WHERE patient_id = p.id AND type = 'MRN' LIMIT 1) as mrn,
                p.last_name as family_name, p.first_name as given_name, p.gender as sex, p.date_of_birth,
                b.name as branch_name
         FROM lab_orders lo
         JOIN patients p ON p.id = lo.patient_id AND p.tenant_id = lo.tenant_id
         JOIN branches b ON b.id = lo.branch_id AND b.tenant_id = lo.tenant_id
         WHERE lo.tenant_id = $1 AND lo.id = $2`,
        [tenantId, orderId],
      );
      if (!orderRes.rows[0]) throw new ProblemException('NOT_FOUND', { detail: 'Order not found' });
      const order = orderRes.rows[0];

      // 2. Fetch order items and verified results
      const itemsRes = await tx.query(
        `SELECT loi.*, lt.code as test_code, lt.name as test_name
         FROM lab_order_items loi
         JOIN lab_tests lt ON lt.id = loi.test_id AND lt.tenant_id = loi.tenant_id
         WHERE loi.tenant_id = $1 AND loi.order_id = $2`,
        [tenantId, orderId],
      );

      const resultsRes = await tx.query(
        `SELECT lr.*, la.code as analyte_code, la.name as analyte_name
         FROM lab_results lr
         JOIN lab_analytes la ON la.id = lr.analyte_id AND la.tenant_id = lr.tenant_id
         JOIN lab_order_items loi ON loi.id = lr.order_item_id AND loi.tenant_id = lr.tenant_id
         WHERE lr.tenant_id = $1 AND loi.order_id = $2`,
        [tenantId, orderId],
      );

      // Confidentiality gating
      const hasConfidentialTest = itemsRes.rows.some((item) => item.is_confidential === true || item.is_confidential === 't');
      
      if (hasConfidentialTest) {
        if (!dto.confidentialReleaseReason) {
          throw new ProblemException('VALIDATION_FAILED', {
            detail: 'confidentialReleaseReason is required when releasing a report containing confidential tests',
          });
        }
        await tx.query(
          `INSERT INTO phi_access_log (tenant_id, patient_id, record_type, record_id, reason)
           VALUES ($1, $2, 'LAB_CONFIDENTIAL_RELEASE', $3, $4)
           ON CONFLICT DO NOTHING`,
          [tenantId, order.patient_id, orderId, dto.confidentialReleaseReason]
        );
      }

      // Check current max version
      const vRes = await tx.query(
        `SELECT COALESCE(MAX(version), 0) as max_v FROM lab_reports WHERE tenant_id = $1 AND order_id = $2`,
        [tenantId, orderId],
      );
      const currentMaxV = Number(vRes.rows[0].max_v);
      const version = currentMaxV + 1;
      const status = currentMaxV > 0 ? 'CORRECTED' : (dto.status ?? 'FINAL');

      const reportData = {
        order,
        items: itemsRes.rows,
        results: resultsRes.rows,
        releasedBy: userId,
        releasedAt: new Date().toISOString(),
        notes: dto.notes ?? null,
        confidentialReleaseReason: hasConfidentialTest ? dto.confidentialReleaseReason : null,
      };

      // 3. Release records intent, not an artifact. The document's SHA-256 is
      //    the digest of the rendered PDF, which does not exist until JOB-43
      //    renders it, so sha256_hash stays NULL here and file_id IS NULL marks
      //    the report as awaiting rendering. Hashing reportData instead would
      //    produce a well-formed digest that describes the inputs rather than
      //    the document, and could never be re-verified against served bytes.
      const sha256 = null;

      // 4. Insert report
      const repRes = await tx.query(
        `INSERT INTO lab_reports (
           tenant_id, order_id, version, sha256_hash, status, report_data, issued_by
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [tenantId, orderId, version, sha256, status, JSON.stringify(reportData), userId],
      );

      // 5. Update items to RELEASED
      await tx.query(
        `UPDATE lab_order_items SET status = 'RELEASED' WHERE tenant_id = $1 AND order_id = $2`,
        [tenantId, orderId],
      );

      // 6. Update order status to RELEASED
      await tx.query(
        `UPDATE lab_orders SET status = 'RELEASED' WHERE tenant_id = $1 AND id = $2`,
        [tenantId, orderId],
      );

      // 7. Queue distribution event
      await tx.query(
        `INSERT INTO outbox (tenant_id, event_type, payload)
         VALUES ($1, 'lab.report.released', $2)`,
        [
          tenantId,
          {
            orderId,
            reportId: repRes.rows[0].id,
            patientId: order.patient_id,
            visitId: order.visit_id,
          },
        ]
      );

      return repRes.rows[0];
    });
  }

  async listReports(tenantId: string, orderId: string) {
    return withTenant({ tenantId }, async (tx) => {
      const res = await tx.query(
        `SELECT lr.*, u.name as issued_by_name
         FROM lab_reports lr
         JOIN users u ON u.id = lr.issued_by AND u.tenant_id = lr.tenant_id
         WHERE lr.tenant_id = $1 AND lr.order_id = $2
         ORDER BY lr.version DESC`,
        [tenantId, orderId],
      );
      return res.rows;
    });
  }

  async getReport(tenantId: string, reportId: string) {
    return withTenant({ tenantId }, async (tx) => {
      const res = await tx.query(
        `SELECT lr.*, u.name as issued_by_name, lo.patient_id, lo.order_no
         FROM lab_reports lr
         JOIN lab_orders lo ON lo.id = lr.order_id AND lo.tenant_id = lr.tenant_id
         JOIN users u ON u.id = lr.issued_by AND u.tenant_id = lr.tenant_id
         WHERE lr.tenant_id = $1 AND lr.id = $2`,
        [tenantId, reportId],
      );
      if (!res.rows[0]) throw new ProblemException('NOT_FOUND', { detail: 'Report not found' });
      return res.rows[0];
    });
  }

  /**
   * Fetch the stored rendered PDF for a released report.
   *
   * The report artifact is produced by the asynchronous lab job (JOB-43) and
   * sealed with a SHA-256 hash. We deliberately serve the stored bytes rather
   * than re-rendering: an official, hash-sealed document must remain byte
   * identical to what was sealed.
   */
async getReportArtifact(
    tenantId: string,
    reportId: string,
  ): Promise<{ bytes: Buffer; fileName: string; sha256: string | null; byteLength: number }> {
    return withTenant({ tenantId }, async (tx) => {
      const rep = await tx.query<{ file_id: string | null }>(
        `SELECT file_id FROM lab_reports WHERE tenant_id = $1 AND id = $2`,
        [tenantId, reportId],
      );
      if (!rep.rows[0]) throw new ProblemException('NOT_FOUND', { detail: 'Report not found' });
      const fileId = rep.rows[0].file_id;
      if (!fileId) {
        throw new ProblemException('CONFLICT', {
          detail: 'The report PDF has not been rendered yet. Try again once the report finishes processing.',
        });
      }
      const file = await tx.query<{ content: Buffer | null; file_name: string; sha256: string | null }>(
        `SELECT content, file_name, sha256 FROM files
              WHERE tenant_id = $1 AND id = $2 AND origin = 'GENERATED'`,
        [tenantId, fileId],
      );
      const row = file.rows[0];
      if (!row || !row.content) throw new ProblemException('NOT_FOUND', { detail: 'Report artifact not found' });
      return {
        bytes: row.content,
        fileName: row.file_name,
        sha256: row.sha256,
        byteLength: row.content.byteLength,
      };
    });
  }

  // ── Quality Control (QC) ───────────────────────────────────────────────────

  async listQcMaterials(tenantId: string, sectionId?: string) {
    return withTenant({ tenantId }, async (tx) => {
      let query = `
        SELECT lqm.*, ls.name as section_name
        FROM lab_qc_materials lqm
        JOIN lab_sections ls ON ls.id = lqm.section_id AND ls.tenant_id = lqm.tenant_id
        WHERE lqm.tenant_id = $1 AND lqm.is_active = true
      `;
      const params: any[] = [tenantId];
      if (sectionId) {
        params.push(sectionId);
        query += ` AND lqm.section_id = $2`;
      }
      query += ` ORDER BY lqm.name ASC`;
      const res = await tx.query(query, params);
      return res.rows;
    });
  }

  async createQcMaterial(tenantId: string, dto: CreateLabQcMaterialRequest) {
    return withTenant({ tenantId }, async (tx) => {
      const res = await tx.query(
        `INSERT INTO lab_qc_materials (
           tenant_id, section_id, code, name, manufacturer, lot_no, expiry_date, is_active
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [
          tenantId, dto.sectionId, dto.code, dto.name, dto.manufacturer ?? null,
          dto.lotNo, dto.expiryDate, dto.isActive ?? true,
        ],
      );
      return res.rows[0];
    });
  }

  async listQcRuns(tenantId: string, instrumentId?: string) {
    return withTenant({ tenantId }, async (tx) => {
      let query = `
        SELECT lqr.*, li.name as instrument_name, lqm.name as material_name, lqm.lot_no,
               u.name as run_by_name
        FROM lab_qc_runs lqr
        JOIN lab_instruments li ON li.id = lqr.instrument_id AND li.tenant_id = lqr.tenant_id
        JOIN lab_qc_materials lqm ON lqm.id = lqr.material_id AND lqm.tenant_id = lqr.tenant_id
        JOIN users u ON u.id = lqr.run_by AND u.tenant_id = lqr.tenant_id
        WHERE lqr.tenant_id = $1
      `;
      const params: any[] = [tenantId];
      if (instrumentId) {
        params.push(instrumentId);
        query += ` AND lqr.instrument_id = $2`;
      }
      query += ` ORDER BY lqr.run_at DESC`;
      const res = await tx.query(query, params);
      return res.rows;
    });
  }

  async createQcRun(tenantId: string, userId: string, dto: CreateLabQcRunRequest) {
    return withTenant({ tenantId }, async (tx) => {
      // 1. Evaluate Westgard Rules for each result
      let anyRejection = false;
      const evaluatedResults = dto.results.map((r) => {
        const diff = r.valueNum - r.targetMean;
        const zScore = r.targetSd > 0 ? diff / r.targetSd : 0;
        const absZ = Math.abs(zScore);

        const violations: string[] = [];
        if (absZ >= 3.0) violations.push('1-3s (Random/Systematic error)');
        else if (absZ >= 2.0) violations.push('1-2s (Warning)');

        const isAccepted = absZ < 3.0;
        if (!isAccepted) anyRejection = true;

        return {
          ...r,
          zScore: Number(zScore.toFixed(2)),
          violations: violations.join(', '),
          isAccepted,
        };
      });

      const runStatus = anyRejection ? 'REJECTED' : (dto.status ?? 'ACCEPTED');

      // 2. Insert run header
      const runRes = await tx.query(
        `INSERT INTO lab_qc_runs (
           tenant_id, instrument_id, material_id, run_at, run_by, status, corrective_action
         )
         VALUES ($1, $2, $3, now(), $4, $5, $6)
         RETURNING *`,
        [tenantId, dto.instrumentId, dto.materialId, userId, runStatus, dto.correctiveAction ?? null],
      );
      const run = runRes.rows[0];

      // 3. Insert results
      const inserted = [];
      for (const er of evaluatedResults) {
        const itemRes = await tx.query(
          `INSERT INTO lab_qc_results (
             tenant_id, qc_run_id, analyte_id, value_num, target_mean,
             target_sd, z_score, westgard_flags, is_accepted
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           RETURNING *`,
          [
            tenantId, run.id, er.analyteId, er.valueNum, er.targetMean,
            er.targetSd, er.zScore, er.violations || null, er.isAccepted,
          ],
        );
        inserted.push({
          ...itemRes.rows[0],
          zScore: er.zScore,
          violations: er.violations,
        });
      }

      run.results = inserted;
      return run;
    });
  }

  // ── Send-outs (LAB-T11) ────────────────────────────────────────────────────

  async listSendOuts(tenantId: string) {
    return withTenant({ tenantId }, async (tx) => {
      const res = await tx.query(
        `SELECT lso.*, lt.name as test_name, lt.code as test_code, lo.order_no,
                (SELECT value FROM patient_identifiers WHERE patient_id = p.id AND type = 'MRN' LIMIT 1) as mrn,
                p.last_name as family_name, p.first_name as given_name, u.name as sent_by_name
         FROM lab_send_outs lso
         JOIN lab_order_items loi ON loi.id = lso.order_item_id AND loi.tenant_id = lso.tenant_id
         JOIN lab_tests lt ON lt.id = loi.test_id AND lt.tenant_id = lso.tenant_id
         JOIN lab_orders lo ON lo.id = loi.order_id AND lo.tenant_id = lso.tenant_id
         JOIN patients p ON p.id = lo.patient_id AND p.tenant_id = lso.tenant_id
         JOIN users u ON u.id = lso.sent_by AND u.tenant_id = lso.tenant_id
         WHERE lso.tenant_id = $1
         ORDER BY lso.sent_at DESC`,
        [tenantId],
      );
      return res.rows;
    });
  }

  async createSendOut(tenantId: string, userId: string, dto: CreateLabSendOutRequest) {
    return withTenant({ tenantId }, async (tx) => {
      const res = await tx.query(
        `INSERT INTO lab_send_outs (
           tenant_id, order_item_id, reference_lab_name, tracking_no, sent_at, sent_by, notes
         )
         VALUES ($1, $2, $3, $4, now(), $5, $6)
         RETURNING *`,
        [tenantId, dto.orderItemId, dto.referenceLabName, dto.trackingNo ?? null, userId, dto.notes ?? null],
      );
      return res.rows[0];
    });
  }

  async receiveSendOutResult(
    tenantId: string,
    id: string,
    userId: string,
    dto: ReceiveLabSendOutResultRequest,
  ) {
    return withTenant({ tenantId }, async (tx) => {
      const res = await tx.query(
        `UPDATE lab_send_outs
         SET result_received_at = now(),
             notes = COALESCE($1, notes)
         WHERE tenant_id = $2 AND id = $3
         RETURNING *`,
        [dto.reportNotes ?? null, tenantId, id],
      );
      if (!res.rows[0]) throw new ProblemException('NOT_FOUND', { detail: 'Send out record not found' });
      return res.rows[0];
    });
  }

  // ── Specimens Chain of Custody ─────────────────────────────────────────────

  async listSpecimens(tenantId: string, accessionNo?: string) {
    return withTenant({ tenantId }, async (tx) => {
      let query = `
        SELECT s.*, st.name as specimen_type_name, lo.order_no,
               u1.name as collected_by_name, u2.name as received_by_name
        FROM specimens s
        JOIN lab_specimen_types st ON st.id = s.specimen_type_id AND st.tenant_id = s.tenant_id
        JOIN lab_orders lo ON lo.id = s.order_id AND lo.tenant_id = s.tenant_id
        LEFT JOIN users u1 ON u1.id = s.collected_by AND u1.tenant_id = s.tenant_id
        LEFT JOIN users u2 ON u2.id = s.received_by AND u2.tenant_id = s.tenant_id
        WHERE s.tenant_id = $1
      `;
      const params: any[] = [tenantId];
      if (accessionNo) {
        params.push(accessionNo);
        query += ` AND s.accession_no = $2`;
      }
      query += ` ORDER BY s.created_at DESC`;
      const res = await tx.query(query, params);
      return res.rows;
    });
  }

  async getSpecimenEvents(tenantId: string, specimenId: string) {
    return withTenant({ tenantId }, async (tx) => {
      const res = await tx.query(
        `SELECT se.*, u.name as performed_by_name
         FROM specimen_events se
         JOIN users u ON u.id = se.by_user_id AND u.tenant_id = se.tenant_id
         WHERE se.tenant_id = $1 AND se.specimen_id = $2
         ORDER BY se.occurred_at ASC`,
        [tenantId, specimenId],
      );
      return res.rows;
    });
  }

  async getSpecimenLabel(tenantId: string, specimenId: string) {
    return withTenant({ tenantId }, async (tx) => {
      const res = await tx.query(
        `SELECT s.accession_no, s.collected_at,
                st.name as specimen_type_name,
                p.first_name, p.last_name, p.date_of_birth,
                lo.order_no
         FROM specimens s
         JOIN lab_specimen_types st ON st.id = s.specimen_type_id AND st.tenant_id = s.tenant_id
         JOIN lab_orders lo ON lo.id = s.order_id AND lo.tenant_id = s.tenant_id
         JOIN patients p ON p.id = lo.patient_id AND p.tenant_id = s.tenant_id
         WHERE s.tenant_id = $1 AND s.id = $2`,
        [tenantId, specimenId],
      );
      if (!res.rows[0]) throw new ProblemException('NOT_FOUND', { detail: 'Specimen not found' });
      
      const row = res.rows[0];
      const patientFullName = `${row.first_name} ${row.last_name}`;
      
      const zpl = renderBarcodeLabel({
        title: 'LAB SPECIMEN',
        barcodeValue: row.accession_no,
        lines: [
          patientFullName,
          `DOB: ${new Date(row.date_of_birth).toLocaleDateString()}`,
          `Type: ${row.specimen_type_name}`,
          `Collected: ${row.collected_at ? new Date(row.collected_at).toLocaleString() : 'N/A'}`
        ],
        qrValue: `clinic://specimen/${row.accession_no}`,
        size: '4x2',
      });

      return {
        specimenId,
        accessionNo: row.accession_no,
        patientName: patientFullName,
        specimenType: row.specimen_type_name,
        zpl,
      };
    });
  }

  // ── Turnaround Time Metrics (TAT) ──────────────────────────────────────────

  async getTatMetrics(tenantId: string) {
    return withTenant({ tenantId }, async (tx) => {
      const res = await tx.query(
        `SELECT
           COUNT(DISTINCT lo.id)::int as total_orders,
           COUNT(DISTINCT CASE WHEN lo.priority = 'STAT' THEN lo.id END)::int as stat_orders,
           AVG(EXTRACT(EPOCH FROM (s.collected_at - lo.ordered_at)) / 60)::int as avg_order_to_collect_min,
           AVG(EXTRACT(EPOCH FROM (s.received_at - s.collected_at)) / 60)::int as avg_collect_to_receive_min,
           AVG(EXTRACT(EPOCH FROM (lr.verified_at - s.received_at)) / 60)::int as avg_receive_to_verify_min
         FROM lab_orders lo
         LEFT JOIN specimens s ON s.order_id = lo.id AND s.tenant_id = lo.tenant_id
         LEFT JOIN lab_order_items loi ON loi.order_id = lo.id AND loi.tenant_id = lo.tenant_id
         LEFT JOIN lab_results lr ON lr.order_item_id = loi.id AND lr.tenant_id = lo.tenant_id
         WHERE lo.tenant_id = $1 AND lo.status != 'CANCELLED'
           AND lo.ordered_at >= CURRENT_DATE - INTERVAL '30 days'`,
        [tenantId],
      );
      return res.rows[0];
    });
  }
}
