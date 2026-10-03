import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { withTenant, type PoolClient } from '@clinic/db';
import { buildReceiptDocument, renderPdf, renderReceiptHtml, type ReceiptFacts } from '@clinic/print';
import { ProblemException } from '../http/problem.exception.js';
import { resolveServicePrice } from '../common/pricing.js';
import type {
  CreateInvoiceRequest,
  UpdateInvoiceRequest,
  CreateInvoiceLineRequest,
  ApplyDiscountRequest,
  VoidInvoiceRequest,
  CreatePaymentRequest,
  VoidPaymentRequest,
  ReprintReceiptRequest,
  OpenShiftRequest,
  CloseShiftRequest,
  CreateCreditNoteRequest,
  ApproveCreditNoteRequest,
  CreateChargeRequest,
  DailyCloseRunRequest,
  SaveCashSessionRequest,
} from '@clinic/contracts';

@Injectable()
export class BillingService {
  /**
   * Period lock enforcement shared with Supply (AC-20, todo.md §7.4).
   * Backdated postings are refused when the accounting period is LOCKED.
   */
  private async checkPeriodOpen(tx: PoolClient, tenantId: string, date: Date | string = new Date()): Promise<void> {
    const d = typeof date === 'string' ? new Date(date) : date;
    const periodStr = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    const res = await tx.query(
      `SELECT status FROM periods WHERE tenant_id = $1 AND period = $2`,
      [tenantId, periodStr],
    );
    if (res.rows[0]?.status === 'LOCKED') {
      throw new ProblemException('PERIOD_LOCKED', {
        detail: `Accounting period ${periodStr} is closed. Postings are refused.`,
      });
    }
  }

  /**
   * Gapless document numbering via app.next_doc_no(tenantId, key)
   */
  private async nextDocNo(tx: PoolClient, tenantId: string, prefix: string): Promise<string> {
    const year = new Date().getFullYear();
    const key = `${prefix}-${year}`;
    const res = await tx.query(`SELECT app.next_doc_no($1, $2) as next_val`, [tenantId, key]);
    const num = String(res.rows[0]?.next_val ?? 1).padStart(6, '0');
    return `${prefix}-${year}-${num}`;
  }

  /**
   * Recompute and persist invoice totals from invoice_lines
   */
  private async recalculateInvoiceTotals(tx: PoolClient, tenantId: string, invoiceId: string): Promise<any> {
    const linesRes = await tx.query(
      `SELECT
         COALESCE(SUM(subtotal), 0) as subtotal,
         COALESCE(SUM(discount_amount), 0) as discount_total,
         COALESCE(SUM(tax_amount), 0) as tax_total,
         COALESCE(SUM(net_amount), 0) as total
       FROM invoice_lines
       WHERE tenant_id = $1 AND invoice_id = $2`,
      [tenantId, invoiceId],
    );

    const subtotal = Number(linesRes.rows[0]?.subtotal ?? 0);
    const discountTotal = Number(linesRes.rows[0]?.discount_total ?? 0);
    const taxTotal = Number(linesRes.rows[0]?.tax_total ?? 0);
    const total = Number(linesRes.rows[0]?.total ?? 0);

    const invRes = await tx.query(
      `SELECT paid_amount, status FROM invoices WHERE tenant_id = $1 AND id = $2`,
      [tenantId, invoiceId],
    );
    const paidAmount = Number(invRes.rows[0]?.paid_amount ?? 0);
    const currentStatus = invRes.rows[0]?.status;

    const balance = Math.max(0, total - paidAmount);
    let newStatus = currentStatus;
    if (currentStatus !== 'VOID') {
      if (balance <= 0.001 && total > 0) {
        newStatus = 'PAID';
      } else if (paidAmount > 0.001) {
        newStatus = 'PARTIAL';
      } else if (total > 0) {
        newStatus = 'OPEN';
      } else {
        newStatus = 'DRAFT';
      }
    }

    const updated = await tx.query(
      `UPDATE invoices
       SET subtotal = $1,
           discount_total = $2,
           tax_total = $3,
           total = $4,
           balance = $5,
           status = $6,
           updated_at = now()
       WHERE tenant_id = $7 AND id = $8
       RETURNING *`,
      [subtotal, discountTotal, taxTotal, total, balance, newStatus, tenantId, invoiceId],
    );

    return updated.rows[0];
  }

  // ── 1. Invoices ────────────────────────────────────────────────────────────

  async createInvoice(tenantId: string, userId: string, dto: CreateInvoiceRequest) {
    return withTenant({ tenantId, userId }, async (tx) => {
      await this.checkPeriodOpen(tx, tenantId);

      const invoiceNo = await this.nextDocNo(tx, tenantId, 'INV');

      // Create base draft invoice
      const invRes = await tx.query(
        `INSERT INTO invoices (
           tenant_id, branch_id, invoice_no, patient_id, visit_id,
           status, payer_type, notes, created_by, issued_at, due_at
         ) VALUES ($1, $2, $3, $4, $5, 'DRAFT', $6, $7, $8, now(), now() + INTERVAL '30 days')
         RETURNING *`,
        [
          tenantId,
          dto.branchId,
          invoiceNo,
          dto.patientId ?? null,
          dto.visitId ?? null,
          dto.payerType ?? 'PRIVATE_CASH',
          dto.notes ?? null,
          userId,
        ],
      );
      const invoice = invRes.rows[0];

      let lineNo = 1;

      // 1. Add manual lines if provided
      if (dto.lines && dto.lines.length > 0) {
        for (const line of dto.lines) {
          const qty = Number(line.qty ?? 1);
          const unitPrice = Number(line.unitPrice);
          const subtotal = qty * unitPrice;
          const discountAmount = 0;
          const taxAmount = 0;
          const netAmount = subtotal - discountAmount + taxAmount;

          await tx.query(
            `INSERT INTO invoice_lines (
               tenant_id, invoice_id, line_no, source_type, source_id,
               description, qty, unit_price, subtotal, discount_amount,
               tax_code, tax_amount, net_amount, payer_type, is_professional_fee
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
            [
              tenantId,
              invoice.id,
              lineNo++,
              line.sourceType ?? 'MANUAL',
              line.sourceId ?? null,
              line.description,
              qty,
              unitPrice,
              subtotal,
              discountAmount,
              line.taxCode ?? 'VAT_EXEMPT',
              taxAmount,
              netAmount,
              line.payerType ?? dto.payerType ?? 'PRIVATE_CASH',
              Boolean(line.isProfessionalFee),
            ],
          );
        }
      }

      // 2. Consume charges from Phase 3 charge capture service if provided
      if (dto.consumeChargeIds && dto.consumeChargeIds.length > 0) {
        const chargesRes = await tx.query(
          `SELECT * FROM billing_charges
           WHERE tenant_id = $1 AND id = ANY($2::uuid[])
             AND voided_at IS NULL AND invoice_id IS NULL`,
          [tenantId, dto.consumeChargeIds],
        );

        for (const ch of chargesRes.rows) {
          const qty = Number(ch.quantity ?? 1);
          const unitPrice = Number(ch.unit_price);
          const subtotal = Number(ch.amount ?? qty * unitPrice);
          const isProfFee = ch.charge_type === 'CONSULT';

          const lineIns = await tx.query(
            `INSERT INTO invoice_lines (
               tenant_id, invoice_id, line_no, source_type, source_id,
               description, qty, unit_price, subtotal, discount_amount,
               tax_code, tax_amount, net_amount, payer_type, is_professional_fee
             ) VALUES ($1, $2, $3, 'CHARGE', $4, $5, $6, $7, $8, 0, 'VAT_EXEMPT', 0, $8, $9, $10)
             RETURNING id`,
            [
              tenantId,
              invoice.id,
              lineNo++,
              ch.id,
              ch.description,
              qty,
              unitPrice,
              subtotal,
              ch.payer_type ?? 'PRIVATE_CASH',
              isProfFee,
            ],
          );

          // Mark charge as consumed
          await tx.query(
            `UPDATE billing_charges
             SET invoice_id = $1, invoice_line_id = $2
             WHERE tenant_id = $3 AND id = $4`,
            [invoice.id, lineIns.rows[0].id, tenantId, ch.id],
          );
        }
      }

      // Recalculate totals
      const updated = await this.recalculateInvoiceTotals(tx, tenantId, invoice.id);
      return this.getInvoiceByIdWithTx(tx, tenantId, updated.id);
    });
  }

  async getInvoices(
    tenantId: string,
    query: {
      branchId?: string;
      patientId?: string;
      visitId?: string;
      status?: string;
      search?: string;
      limit?: number;
      offset?: number;
    },
  ) {
    return withTenant({ tenantId }, async (tx) => {
      const conditions: string[] = ['i.tenant_id = $1'];
      const params: any[] = [tenantId];
      let pIdx = 2;

      if (query.branchId) {
        conditions.push(`i.branch_id = $${pIdx++}`);
        params.push(query.branchId);
      }
      if (query.patientId) {
        conditions.push(`i.patient_id = $${pIdx++}`);
        params.push(query.patientId);
      }
      if (query.visitId) {
        conditions.push(`i.visit_id = $${pIdx++}`);
        params.push(query.visitId);
      }
      if (query.status) {
        conditions.push(`i.status = $${pIdx++}`);
        params.push(query.status);
      }
      if (query.search) {
        conditions.push(`(i.invoice_no ILIKE $${pIdx} OR p.first_name ILIKE $${pIdx} OR p.last_name ILIKE $${pIdx})`);
        params.push(`%${query.search}%`);
        pIdx++;
      }

      const limit = query.limit ?? 50;
      const offset = query.offset ?? 0;

      const res = await tx.query(
        `SELECT i.*,
                p.first_name as patient_first_name,
                p.last_name as patient_last_name,
                (SELECT value FROM patient_identifiers pi WHERE pi.tenant_id = p.tenant_id AND pi.patient_id = p.id LIMIT 1) as patient_number,
                b.name as branch_name,
                (SELECT count(*)::int FROM invoice_lines il WHERE il.invoice_id = i.id) as line_count
         FROM invoices i
         LEFT JOIN patients p ON p.tenant_id = i.tenant_id AND p.id = i.patient_id
         LEFT JOIN branches b ON b.tenant_id = i.tenant_id AND b.id = i.branch_id
         WHERE ${conditions.join(' AND ')}
         ORDER BY i.created_at DESC
         LIMIT $${pIdx++} OFFSET $${pIdx++}`,
        [...params, limit, offset],
      );

      const countRes = await tx.query(
        `SELECT count(*)::int as total
         FROM invoices i
         LEFT JOIN patients p ON p.tenant_id = i.tenant_id AND p.id = i.patient_id
         WHERE ${conditions.join(' AND ')}`,
        params,
      );

      return {
        data: res.rows,
        total: countRes.rows[0]?.total ?? 0,
        limit,
        offset,
      };
    });
  }

  private async getInvoiceByIdWithTx(tx: PoolClient, tenantId: string, id: string) {
    const invRes = await tx.query(
      `SELECT i.*,
              p.first_name as patient_first_name,
              p.last_name as patient_last_name,
              (SELECT value FROM patient_identifiers pi WHERE pi.tenant_id = p.tenant_id AND pi.patient_id = p.id LIMIT 1) as patient_number,
              p.date_of_birth as patient_dob,
              b.name as branch_name,
              u.name as creator_name
       FROM invoices i
       LEFT JOIN patients p ON p.tenant_id = i.tenant_id AND p.id = i.patient_id
       LEFT JOIN branches b ON b.tenant_id = i.tenant_id AND b.id = i.branch_id
       LEFT JOIN users u ON u.tenant_id = i.tenant_id AND u.id = i.created_by
       WHERE i.tenant_id = $1 AND i.id = $2`,
      [tenantId, id],
    );

    if (invRes.rowCount === 0) {
      throw new ProblemException('NOT_FOUND', { detail: `Invoice ${id} not found.` });
    }
    const invoice = invRes.rows[0];

    const linesRes = await tx.query(
      `SELECT il.*, dt.name as discount_name, dt.code as discount_code
       FROM invoice_lines il
       LEFT JOIN discount_types dt ON dt.tenant_id = il.tenant_id AND dt.id = il.discount_type_id
       WHERE il.tenant_id = $1 AND il.invoice_id = $2
       ORDER BY il.line_no ASC`,
      [tenantId, id],
    );

    const discRes = await tx.query(
      `SELECT da.*, dt.name as discount_name, dt.code as discount_code, dt.legal_basis, u.name as verifier_name
       FROM discount_applications da
       JOIN discount_types dt ON dt.tenant_id = da.tenant_id AND dt.id = da.discount_type_id
       JOIN users u ON u.tenant_id = da.tenant_id AND u.id = da.verified_by
       WHERE da.tenant_id = $1 AND da.invoice_id = $2`,
      [tenantId, id],
    );

    const payRes = await tx.query(
      `SELECT p.*, pm.code as method_code, pm.name as method_name, u.name as cashier_name
       FROM payments p
       JOIN payment_methods pm ON pm.tenant_id = p.tenant_id AND pm.id = p.method_id
       JOIN users u ON u.tenant_id = p.tenant_id AND u.id = p.received_by
       WHERE p.tenant_id = $1 AND p.invoice_id = $2
       ORDER BY p.received_at DESC`,
      [tenantId, id],
    );

    const cnRes = await tx.query(
      `SELECT cn.*, u.name as creator_name, au.name as approver_name
       FROM credit_notes cn
       JOIN users u ON u.tenant_id = cn.tenant_id AND u.id = cn.created_by
       LEFT JOIN users au ON au.tenant_id = cn.tenant_id AND au.id = cn.approved_by
       WHERE cn.tenant_id = $1 AND cn.invoice_id = $2
       ORDER BY cn.created_at DESC`,
      [tenantId, id],
    );

    return {
      ...invoice,
      lines: linesRes.rows,
      discounts: discRes.rows,
      payments: payRes.rows,
      creditNotes: cnRes.rows,
    };
  }

  async getInvoiceById(tenantId: string, id: string) {
    return withTenant({ tenantId }, async (tx) => {
      return this.getInvoiceByIdWithTx(tx, tenantId, id);
    });
  }

  async updateInvoice(tenantId: string, userId: string, id: string, dto: UpdateInvoiceRequest) {
    return withTenant({ tenantId, userId }, async (tx) => {
      const inv = await tx.query(`SELECT status FROM invoices WHERE tenant_id = $1 AND id = $2`, [tenantId, id]);
      if (inv.rowCount === 0) throw new ProblemException('NOT_FOUND', { detail: 'Invoice not found' });
      if (inv.rows[0].status !== 'DRAFT') {
        throw new ProblemException('INVOICE_NOT_DRAFT', { detail: 'Only draft invoices can be edited.' });
      }

      await tx.query(
        `UPDATE invoices
         SET notes = COALESCE($1, notes),
             payer_type = COALESCE($2, payer_type),
             updated_at = now()
         WHERE tenant_id = $3 AND id = $4`,
        [dto.notes ?? null, dto.payerType ?? null, tenantId, id],
      );

      return this.getInvoiceByIdWithTx(tx, tenantId, id);
    });
  }

  async addInvoiceLine(tenantId: string, userId: string, invoiceId: string, dto: CreateInvoiceLineRequest) {
    return withTenant({ tenantId, userId }, async (tx) => {
      await this.checkPeriodOpen(tx, tenantId);

      const inv = await tx.query(`SELECT status FROM invoices WHERE tenant_id = $1 AND id = $2`, [tenantId, invoiceId]);
      if (inv.rowCount === 0) throw new ProblemException('NOT_FOUND', { detail: 'Invoice not found' });
      if (inv.rows[0].status !== 'DRAFT') {
        throw new ProblemException('INVOICE_NOT_DRAFT', { detail: 'Only draft invoices can accept new lines.' });
      }

      const nextLineRes = await tx.query(
        `SELECT COALESCE(MAX(line_no), 0) + 1 as next_line FROM invoice_lines WHERE tenant_id = $1 AND invoice_id = $2`,
        [tenantId, invoiceId],
      );
      const lineNo = nextLineRes.rows[0].next_line;

      const qty = Number(dto.qty ?? 1);
      const unitPrice = Number(dto.unitPrice);
      const subtotal = qty * unitPrice;
      const discountAmount = 0;
      // Tax calculation: VAT_12 lines attract Philippine VAT at 12%.
      // All other codes (VAT_EXEMPT, VAT_ZERO) yield zero tax.
      // todo.md §446 defect: taxAmount was hardcoded to 0, making a line with
      // taxCode='VAT_12' misstate its own tax treatment.
      const resolvedTaxCode = dto.taxCode ?? 'VAT_EXEMPT';
      const taxRate = resolvedTaxCode === 'VAT_12' ? 0.12 : 0;
      const taxAmount = Number((subtotal * taxRate).toFixed(2));
      const netAmount = subtotal - discountAmount + taxAmount;

      await tx.query(
        `INSERT INTO invoice_lines (
           tenant_id, invoice_id, line_no, source_type, source_id,
           description, qty, unit_price, subtotal, discount_amount,
           tax_code, tax_amount, net_amount, payer_type, is_professional_fee
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
        [
          tenantId,
          invoiceId,
          lineNo,
          dto.sourceType ?? 'MANUAL',
          dto.sourceId ?? null,
          dto.description,
          qty,
          unitPrice,
          subtotal,
          discountAmount,
          dto.taxCode ?? 'VAT_EXEMPT',
          taxAmount,
          netAmount,
          dto.payerType ?? 'PRIVATE_CASH',
          Boolean(dto.isProfessionalFee),
        ],
      );

      await this.recalculateInvoiceTotals(tx, tenantId, invoiceId);
      return this.getInvoiceByIdWithTx(tx, tenantId, invoiceId);
    });
  }

  async removeInvoiceLine(tenantId: string, userId: string, invoiceId: string, lineId: string) {
    return withTenant({ tenantId, userId }, async (tx) => {
      const inv = await tx.query(`SELECT status FROM invoices WHERE tenant_id = $1 AND id = $2`, [tenantId, invoiceId]);
      if (inv.rowCount === 0) throw new ProblemException('NOT_FOUND', { detail: 'Invoice not found' });
      if (inv.rows[0].status !== 'DRAFT') {
        throw new ProblemException('INVOICE_NOT_DRAFT', { detail: 'Cannot delete lines from non-draft invoices.' });
      }

      // Check if line was linked to a charge
      const lineRes = await tx.query(
        `SELECT source_id, source_type FROM invoice_lines WHERE tenant_id = $1 AND id = $2 AND invoice_id = $3`,
        [tenantId, lineId, invoiceId],
      );
      if ((lineRes.rowCount ?? 0) > 0 && lineRes.rows[0].source_type === 'CHARGE') {
        await tx.query(
          `UPDATE billing_charges
           SET invoice_id = NULL, invoice_line_id = NULL
           WHERE tenant_id = $1 AND id = $2`,
          [tenantId, lineRes.rows[0].source_id],
        );
      }

      await tx.query(`DELETE FROM invoice_lines WHERE tenant_id = $1 AND id = $2 AND invoice_id = $3`, [
        tenantId,
        lineId,
        invoiceId,
      ]);

      await this.recalculateInvoiceTotals(tx, tenantId, invoiceId);
      return this.getInvoiceByIdWithTx(tx, tenantId, invoiceId);
    });
  }

  async consumeCharges(tenantId: string, userId: string, invoiceId: string, chargeIds: string[]) {
    return withTenant({ tenantId, userId }, async (tx) => {
      await this.checkPeriodOpen(tx, tenantId);

      const inv = await tx.query(`SELECT status FROM invoices WHERE tenant_id = $1 AND id = $2`, [tenantId, invoiceId]);
      if (inv.rowCount === 0) throw new ProblemException('NOT_FOUND', { detail: 'Invoice not found' });
      if (inv.rows[0].status !== 'DRAFT') {
        throw new ProblemException('INVOICE_NOT_DRAFT', { detail: 'Charges can only be consumed into draft invoices.' });
      }

      const chargesRes = await tx.query(
        `SELECT * FROM billing_charges
         WHERE tenant_id = $1 AND id = ANY($2::uuid[])
           AND voided_at IS NULL AND invoice_id IS NULL`,
        [tenantId, chargeIds],
      );

      const nextLineRes = await tx.query(
        `SELECT COALESCE(MAX(line_no), 0) as max_line FROM invoice_lines WHERE tenant_id = $1 AND invoice_id = $2`,
        [tenantId, invoiceId],
      );
      let lineNo = nextLineRes.rows[0].max_line + 1;

      for (const ch of chargesRes.rows) {
        const qty = Number(ch.quantity ?? 1);
        const unitPrice = Number(ch.unit_price);
        const subtotal = Number(ch.amount ?? qty * unitPrice);
        const isProfFee = ch.charge_type === 'CONSULT';

        const lineIns = await tx.query(
          `INSERT INTO invoice_lines (
             tenant_id, invoice_id, line_no, source_type, source_id,
             description, qty, unit_price, subtotal, discount_amount,
             tax_code, tax_amount, net_amount, payer_type, is_professional_fee
           ) VALUES ($1, $2, $3, 'CHARGE', $4, $5, $6, $7, $8, 0, 'VAT_EXEMPT', 0, $8, $9, $10)
           RETURNING id`,
          [
            tenantId,
            invoiceId,
            lineNo++,
            ch.id,
            ch.description,
            qty,
            unitPrice,
            subtotal,
            ch.payer_type ?? 'PRIVATE_CASH',
            isProfFee,
          ],
        );

        await tx.query(
          `UPDATE billing_charges
           SET invoice_id = $1, invoice_line_id = $2
           WHERE tenant_id = $3 AND id = $4`,
          [invoiceId, lineIns.rows[0].id, tenantId, ch.id],
        );
      }

      await this.recalculateInvoiceTotals(tx, tenantId, invoiceId);
      return this.getInvoiceByIdWithTx(tx, tenantId, invoiceId);
    });
  }

  async voidInvoice(tenantId: string, userId: string, id: string, dto: VoidInvoiceRequest) {
    return withTenant({ tenantId, userId }, async (tx) => {
      await this.checkPeriodOpen(tx, tenantId);

      const invRes = await tx.query(`SELECT status, paid_amount FROM invoices WHERE tenant_id = $1 AND id = $2`, [
        tenantId,
        id,
      ]);
      if (invRes.rowCount === 0) throw new ProblemException('NOT_FOUND', { detail: 'Invoice not found' });
      const inv = invRes.rows[0];

      if (inv.status === 'VOID') {
        throw new ProblemException('CONFLICT', { detail: 'Invoice is already voided.' });
      }
      if (Number(inv.paid_amount) > 0) {
        throw new ProblemException('CONFLICT', {
          detail: 'Invoice has posted payments. Void payments first before voiding the invoice.',
        });
      }

      // Unlink any consumed charges
      await tx.query(
        `UPDATE billing_charges
         SET invoice_id = NULL, invoice_line_id = NULL
         WHERE tenant_id = $1 AND invoice_id = $2`,
        [tenantId, id],
      );

      const reason = typeof dto === 'string' ? dto : (dto?.reason ?? 'Voided');
      await tx.query(
        `UPDATE invoices
         SET status = 'VOID',
             voided_at = now(),
             voided_by = $1,
             void_reason = $2,
             balance = 0,
             updated_at = now()
         WHERE tenant_id = $3 AND id = $4`,
        [userId, reason, tenantId, id],
      );

      return this.getInvoiceByIdWithTx(tx, tenantId, id);
    });
  }

  // ── 2. Discounts ───────────────────────────────────────────────────────────

  async applyDiscount(tenantId: string, userId: string, invoiceId: string, dto: ApplyDiscountRequest) {
    return withTenant({ tenantId, userId }, async (tx) => {
      await this.checkPeriodOpen(tx, tenantId);

      const invRes = await tx.query(
        `SELECT status, paid_amount, total FROM invoices WHERE tenant_id = $1 AND id = $2`,
        [tenantId, invoiceId],
      );
      if (invRes.rowCount === 0) throw new ProblemException('NOT_FOUND', { detail: 'Invoice not found' });
      const inv = invRes.rows[0];

      if (inv.status === 'PAID' || inv.status === 'VOID') {
        throw new ProblemException('CONFLICT', {
          detail: `Cannot apply discount to an invoice in ${inv.status} status.`,
        });
      }

      const discTypeRes = await tx.query(
        `SELECT * FROM discount_types WHERE tenant_id = $1 AND id = $2 AND is_active = true`,
        [tenantId, dto.discountTypeId],
      );
      if (discTypeRes.rowCount === 0) {
        throw new ProblemException('NOT_FOUND', { detail: 'Discount type not found or inactive.' });
      }
      const discType = discTypeRes.rows[0];

      // BIL-T2 ID capture requirement
      if (discType.requires_id && (!dto.idNumber || dto.idNumber.trim().length === 0)) {
        throw new ProblemException('DISCOUNT_ID_REQUIRED', {
          detail: `Discount '${discType.name}' legally requires ID capture (${discType.legal_basis ?? 'Mandatory ID'}). Please provide the ID number.`,
        });
      }

      // Calculate discount amount
      let discountAmount = 0;
      if (dto.invoiceLineId) {
        const lineRes = await tx.query(
          `SELECT subtotal FROM invoice_lines WHERE tenant_id = $1 AND id = $2 AND invoice_id = $3`,
          [tenantId, dto.invoiceLineId, invoiceId],
        );
        if (lineRes.rowCount === 0) throw new ProblemException('NOT_FOUND', { detail: 'Invoice line not found' });
        const lineSubtotal = Number(lineRes.rows[0].subtotal);

        if (discType.fixed_amount && Number(discType.fixed_amount) > 0) {
          discountAmount = Math.min(lineSubtotal, Number(discType.fixed_amount));
        } else {
          discountAmount = Number(((lineSubtotal * Number(discType.percentage)) / 100).toFixed(2));
        }

        await tx.query(
          `UPDATE invoice_lines
           SET discount_type_id = $1,
               discount_amount = $2,
               net_amount = subtotal - $2 + tax_amount
           WHERE tenant_id = $3 AND id = $4`,
          [discType.id, discountAmount, tenantId, dto.invoiceLineId],
        );
      } else {
        // Apply across all invoice lines proportionally
        const lines = await tx.query(
          `SELECT id, subtotal FROM invoice_lines WHERE tenant_id = $1 AND invoice_id = $2`,
          [tenantId, invoiceId],
        );
        for (const l of lines.rows) {
          const lSub = Number(l.subtotal);
          const lDisc = Number(((lSub * Number(discType.percentage)) / 100).toFixed(2));
          discountAmount += lDisc;
          await tx.query(
            `UPDATE invoice_lines
             SET discount_type_id = $1,
                 discount_amount = $2,
                 net_amount = subtotal - $2 + tax_amount
             WHERE tenant_id = $3 AND id = $4`,
            [discType.id, lDisc, tenantId, l.id],
          );
        }
      }

      // Record in discount_applications
      await tx.query(
        `INSERT INTO discount_applications (
           tenant_id, invoice_id, invoice_line_id, discount_type_id,
           id_number, id_type, discount_amount, verified_by
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          tenantId,
          invoiceId,
          dto.invoiceLineId ?? null,
          discType.id,
          dto.idNumber ?? null,
          dto.idType ?? (discType.code === 'SENIOR' ? 'SENIOR_CITIZEN_ID' : discType.code === 'PWD' ? 'PWD_ID' : 'OTHER'),
          discountAmount,
          userId,
        ],
      );

      await this.recalculateInvoiceTotals(tx, tenantId, invoiceId);
      return this.getInvoiceByIdWithTx(tx, tenantId, invoiceId);
    });
  }

  async revokeDiscount(tenantId: string, userId: string, discountAppId: string) {
    return withTenant({ tenantId, userId }, async (tx) => {
      await this.checkPeriodOpen(tx, tenantId);

      const discRes = await tx.query(
        `SELECT da.*, i.status as invoice_status, i.paid_amount
         FROM discount_applications da
         JOIN invoices i ON i.tenant_id = da.tenant_id AND i.id = da.invoice_id
         WHERE da.tenant_id = $1 AND da.id = $2`,
        [tenantId, discountAppId],
      );
      if (discRes.rowCount === 0) throw new ProblemException('NOT_FOUND', { detail: 'Discount application not found' });
      const disc = discRes.rows[0];

      if (Number(disc.paid_amount) > 0) {
        throw new ProblemException('CONFLICT', {
          detail: 'Discounts can only be revoked before payments are posted (BIL-T2).',
        });
      }

      // Reset lines
      if (disc.invoice_line_id) {
        await tx.query(
          `UPDATE invoice_lines
           SET discount_type_id = NULL,
               discount_amount = 0,
               net_amount = subtotal + tax_amount
           WHERE tenant_id = $1 AND id = $2`,
          [tenantId, disc.invoice_line_id],
        );
      } else {
        await tx.query(
          `UPDATE invoice_lines
           SET discount_type_id = NULL,
               discount_amount = 0,
               net_amount = subtotal + tax_amount
           WHERE tenant_id = $1 AND invoice_id = $2`,
          [tenantId, disc.invoice_id],
        );
      }

      await tx.query(`DELETE FROM discount_applications WHERE tenant_id = $1 AND id = $2`, [tenantId, discountAppId]);

      await this.recalculateInvoiceTotals(tx, tenantId, disc.invoice_id);
      return this.getInvoiceByIdWithTx(tx, tenantId, disc.invoice_id);
    });
  }

  async getDiscounts(tenantId: string) {
    return withTenant({ tenantId }, async (tx) => {
      const res = await tx.query(
        `SELECT * FROM discount_types WHERE tenant_id = $1 ORDER BY name ASC`,
        [tenantId],
      );
      return res.rows;
    });
  }

  // ── 3. Payments ────────────────────────────────────────────────────────────

  async createPayment(tenantId: string, userId: string, dto: CreatePaymentRequest) {
    return withTenant({ tenantId, userId }, async (tx) => {
      await this.checkPeriodOpen(tx, tenantId);

      // Verify active cashier shift
      let shiftId = dto.shiftId;
      if (!shiftId) {
        const activeShift = await tx.query(
          `SELECT id FROM cashier_shifts
           WHERE tenant_id = $1 AND branch_id = $2 AND cashier_id = $3 AND status = 'OPEN'`,
          [tenantId, dto.branchId, userId],
        );
        if (activeShift.rowCount === 0) {
          throw new ProblemException('ACTIVE_SHIFT_REQUIRED', {
            detail: 'You must open a cashier shift before collecting payments (BIL-T5).',
          });
        }
        shiftId = activeShift.rows[0].id;
      } else {
        const checkShift = await tx.query(
          `SELECT status FROM cashier_shifts WHERE tenant_id = $1 AND id = $2`,
          [tenantId, shiftId],
        );
        if (checkShift.rows[0]?.status !== 'OPEN') {
          throw new ProblemException('SHIFT_CLOSED', { detail: 'Specified cashier shift is closed.' });
        }
      }

      // Check invoice
      const invRes = await tx.query(
        `SELECT id, invoice_no, total, paid_amount, balance, status, patient_id
         FROM invoices
         WHERE tenant_id = $1 AND id = $2`,
        [tenantId, dto.invoiceId],
      );
      if (invRes.rowCount === 0) throw new ProblemException('NOT_FOUND', { detail: 'Invoice not found.' });
      const inv = invRes.rows[0];

      if (inv.status === 'VOID') throw new ProblemException('CONFLICT', { detail: 'Cannot pay a voided invoice.' });
      if (inv.status === 'PAID') throw new ProblemException('CONFLICT', { detail: 'Invoice is already fully paid.' });

      const amount = Number(dto.amount);
      const balance = Number(inv.balance);

      if (amount > balance + 0.001) {
        throw new ProblemException('PAYMENT_EXCEEDS_BALANCE', {
          detail: `Payment amount (${amount.toFixed(2)}) exceeds invoice balance (${balance.toFixed(2)}).`,
        });
      }

      const tenderedAmount = Number(dto.tenderedAmount ?? amount);
      if (tenderedAmount < amount - 0.001) {
        throw new ProblemException('INSUFFICIENT_PAYMENT', {
          detail: `Tendered amount (${tenderedAmount.toFixed(2)}) is less than payment amount (${amount.toFixed(2)}).`,
        });
      }
      const changeAmount = Math.max(0, Number((tenderedAmount - amount).toFixed(2)));

      // Generate Official Receipt number
      const paymentNo = await this.nextDocNo(tx, tenantId, 'OR');

      // Create Payment
      const payRes = await tx.query(
        `INSERT INTO payments (
           tenant_id, branch_id, shift_id, payment_no, patient_id, invoice_id,
           method_id, amount, tendered_amount, change_amount, reference,
           payer_type, received_by, status
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'POSTED')
         RETURNING *`,
        [
          tenantId,
          dto.branchId,
          shiftId,
          paymentNo,
          inv.patient_id,
          inv.id,
          dto.methodId,
          amount,
          tenderedAmount,
          changeAmount,
          dto.reference ?? null,
          dto.payerType ?? 'PRIVATE_CASH',
          userId,
        ],
      );
      const payment = payRes.rows[0];

      // Record allocation
      await tx.query(
        `INSERT INTO payment_allocations (tenant_id, payment_id, invoice_id, amount)
         VALUES ($1, $2, $3, $4)`,
        [tenantId, payment.id, inv.id, amount],
      );

      // Split tender: validate total and persist each line to payment_splits.
      // The old code accepted the splits array from the contract but never
      // wrote it, so the POS derived the breakdown client-side — violating the
      // ground rule that no money computation happens on the client (todo.md §7.2).
      if (dto.splits && dto.splits.length > 0) {
        const splitSum = dto.splits.reduce((acc, s) => acc + Number(s.amount), 0);
        if (Math.abs(splitSum - amount) > 0.01) {
          throw new ProblemException('VALIDATION_FAILED', {
            detail: `Split tender methods total (${splitSum.toFixed(2)}) does not match payment amount (${amount.toFixed(2)}).`,
          });
        }

        for (const split of dto.splits) {
          await tx.query(
            `INSERT INTO payment_splits (tenant_id, payment_id, method_id, amount, tendered_amount, reference)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [
              tenantId,
              payment.id,
              split.methodId,
              Number(split.amount),
              Number(split.tenderedAmount ?? split.amount),
              split.reference ?? null,
            ],
          );
        }
      }

      // Update invoice paid_amount, balance, and status
      const newPaid = Number(inv.paid_amount) + amount;
      const newBalance = Math.max(0, Number(inv.total) - newPaid);
      const newStatus = newBalance <= 0.001 ? 'PAID' : 'PARTIAL';

      await tx.query(
        `UPDATE invoices
         SET paid_amount = $1, balance = $2, status = $3, updated_at = now()
         WHERE tenant_id = $4 AND id = $5`,
        [newPaid, newBalance, newStatus, tenantId, inv.id],
      );

      return {
        payment,
        changeAmount,
        invoice: {
          id: inv.id,
          invoiceNo: inv.invoice_no,
          total: Number(inv.total),
          paidAmount: newPaid,
          balance: newBalance,
          status: newStatus,
        },
      };
    });
  }

  async getPayments(
    tenantId: string,
    query: {
      invoiceId?: string;
      shiftId?: string;
      branchId?: string;
      status?: string;
      limit?: number;
      offset?: number;
    },
  ) {
    return withTenant({ tenantId }, async (tx) => {
      const conditions: string[] = ['p.tenant_id = $1'];
      const params: any[] = [tenantId];
      let pIdx = 2;

      if (query.invoiceId) {
        conditions.push(`p.invoice_id = $${pIdx++}`);
        params.push(query.invoiceId);
      }
      if (query.shiftId) {
        conditions.push(`p.shift_id = $${pIdx++}`);
        params.push(query.shiftId);
      }
      if (query.branchId) {
        conditions.push(`p.branch_id = $${pIdx++}`);
        params.push(query.branchId);
      }
      if (query.status) {
        conditions.push(`p.status = $${pIdx++}`);
        params.push(query.status);
      }

      const limit = query.limit ?? 50;
      const offset = query.offset ?? 0;

      const res = await tx.query(
        `SELECT p.*,
                pm.code as method_code, pm.name as method_name,
                u.name as cashier_name,
                i.invoice_no,
                pt.first_name as patient_first_name,
                pt.last_name as patient_last_name,
                (SELECT value FROM patient_identifiers pi WHERE pi.tenant_id = pt.tenant_id AND pi.patient_id = pt.id LIMIT 1) as patient_number
         FROM payments p
         JOIN payment_methods pm ON pm.tenant_id = p.tenant_id AND pm.id = p.method_id
         JOIN users u ON u.tenant_id = p.tenant_id AND u.id = p.received_by
         LEFT JOIN invoices i ON i.tenant_id = p.tenant_id AND i.id = p.invoice_id
         LEFT JOIN patients pt ON pt.tenant_id = p.tenant_id AND pt.id = p.patient_id
         WHERE ${conditions.join(' AND ')}
         ORDER BY p.received_at DESC
         LIMIT $${pIdx++} OFFSET $${pIdx++}`,
        [...params, limit, offset],
      );

      return {
        data: res.rows,
        limit,
        offset,
      };
    });
  }

  private async getPaymentByIdWithTx(tx: PoolClient, tenantId: string, id: string) {
    const res = await tx.query(
      `SELECT p.*,
              pm.code as method_code, pm.name as method_name,
              u.name as cashier_name,
              i.invoice_no, i.total as invoice_total, i.balance as invoice_balance,
              pt.first_name as patient_first_name,
              pt.last_name as patient_last_name,
              (SELECT value FROM patient_identifiers pi WHERE pi.tenant_id = pt.tenant_id AND pi.patient_id = pt.id LIMIT 1) as patient_number
       FROM payments p
       JOIN payment_methods pm ON pm.tenant_id = p.tenant_id AND pm.id = p.method_id
       JOIN users u ON u.tenant_id = p.tenant_id AND u.id = p.received_by
       LEFT JOIN invoices i ON i.tenant_id = p.tenant_id AND i.id = p.invoice_id
       LEFT JOIN patients pt ON pt.tenant_id = p.tenant_id AND pt.id = p.patient_id
       WHERE p.tenant_id = $1 AND p.id = $2`,
      [tenantId, id],
    );
    if (res.rowCount === 0) throw new ProblemException('NOT_FOUND', { detail: 'Payment not found.' });
    return res.rows[0];
  }

  async getPaymentById(tenantId: string, id: string) {
    return withTenant({ tenantId }, async (tx) => this.getPaymentByIdWithTx(tx, tenantId, id));
  }

  private async getPaymentReceiptWithTx(tx: PoolClient, tenantId: string, id: string) {
    const payment = await this.getPaymentByIdWithTx(tx, tenantId, id);
    const invoice = await this.getInvoiceByIdWithTx(tx, tenantId, payment.invoice_id);

    // Q-17 Invariant: private consult receipts show professional fee and deductible items only.
    // Internal fields (revenue share, fee splits) never print.
    const patientFacingLines = (invoice.lines || []).map((l: any) => ({
      description: l.description,
      qty: Number(l.qty),
      unitPrice: Number(l.unit_price),
      amount: Number(l.net_amount),
      isProfessionalFee: Boolean(l.is_professional_fee),
    }));

    return {
      receiptNumber: payment.payment_no,
      date: payment.received_at,
      patientName: `${invoice.patient_first_name || ''} ${invoice.patient_last_name || ''}`.trim(),
      patientNumber: invoice.patient_number,
      invoiceNo: invoice.invoice_no,
      cashier: payment.cashier_name,
      paymentMethod: payment.method_name,
      reference: payment.reference,
      amountPaid: Number(payment.amount),
      tendered: Number(payment.tendered_amount),
      change: Number(payment.change_amount),
      remainingBalance: Number(invoice.balance),
      isReprint: Number(payment.reprint_count) > 0,
      reprintCount: Number(payment.reprint_count),
      lines: patientFacingLines,
      discounts: invoice.discounts,
    };
  }

  async getPaymentReceipt(tenantId: string, id: string) {
    return withTenant({ tenantId }, async (tx) => this.getPaymentReceiptWithTx(tx, tenantId, id));
  }

  /**
   * Reissue a receipt (todo.md §7.2, specification §11.1 BIL-T5).
   *
   * A reprint reissues the *original* document bytes. It deliberately does not
   * re-render from current invoice state: a receipt number must never carry two
   * different sets of numbers, so if invoice lines moved after the payment the
   * patient still receives the copy they were originally issued. The reprint row
   * records the digest of exactly those bytes, which is what makes the audit
   * trail worth anything.
   *
   * The one case that has to render is a payment whose original never existed -
   * JOB-50 has not swept it yet, or its render failed. Handing over an
   * unevidenced copy would be worse than a slightly late document, so the
   * receipt is rendered here instead and stored as its own artifact.
   */
  async reprintReceipt(tenantId: string, userId: string, paymentId: string, dto: ReprintReceiptRequest) {
    // Read and render before the transaction opens. A PDF render must never
    // hold a transaction open, and nothing written here depends on the lock.
    const pre = await withTenant({ tenantId }, async (tx) =>
      this.loadReprintFacts(tx, tenantId, paymentId),
    );

    let rendered: { bytes: Buffer; sha256: string; receiptNo: string } | null = null;
    if (!pre.originalFileId) {
      const doc = buildReceiptDocument({ ...pre.facts, reprintedFrom: pre.facts.receiptNo });
      const out = await renderPdf(renderReceiptHtml(doc), { format: 'A4' });
      rendered = { bytes: out.bytes, sha256: out.sha256, receiptNo: doc.receiptNo };
    }

    return withTenant({ tenantId, userId }, async (tx) => {
      // Re-read under the write lock: a concurrent JOB-50 tick may have issued
      // the original since the read above, and reissuing it is always the right
      // answer, so the fallback render is simply not needed.
      const payRes = await tx.query(
        `SELECT id, payment_no, reprint_count, receipt_file_id, receipt_sha256
         FROM payments WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
        [tenantId, paymentId],
      );
      if (payRes.rowCount === 0) throw new ProblemException('NOT_FOUND', { detail: 'Payment not found.' });
      const pay = payRes.rows[0];

      let fileId: string | null = pay.receipt_file_id;
      let sha256: string | null = pay.receipt_sha256;
      let reissued = true;

      if (!fileId) {
        if (!rendered) {
          // Unreachable in practice: `rendered` is produced exactly when no
          // original was visible, and this transaction owns the row from here.
          throw new ProblemException('CONFLICT', {
            detail: 'Receipt is not available to reprint yet. Try again once it has been generated.',
          });
        }
        reissued = false;
        const objectKey = `t/${tenantId}/receipt/${paymentId}-reprint-${randomUUID().slice(0, 8)}`;
        const ins = await tx.query<{ id: string }>(
          `INSERT INTO files (tenant_id, object_key, file_name, mime_type, size_bytes,
                              uploaded_by, origin, content, sha256, status)
           VALUES ($1, $2, $3, 'application/pdf', $4, $5, 'GENERATED', $6, $7, 'READY')
           RETURNING id`,
          [
            tenantId,
            objectKey,
            `receipt-${rendered.receiptNo}-reprint.pdf`,
            rendered.bytes.length,
            userId,
            rendered.bytes,
            rendered.sha256,
          ],
        );
        fileId = ins.rows[0]!.id;
        sha256 = rendered.sha256;
      }

      // The audit row, the artifact pointer and the counter commit together:
      // a reprint can never be counted without recording what was handed over.
      const reprint = await tx.query<{ id: string; reprinted_at: Date }>(
        `INSERT INTO payment_reprints (tenant_id, payment_id, reprinted_by, reason, format, file_id, sha256_hash)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, reprinted_at`,
        [tenantId, paymentId, userId, dto.reason, dto.format ?? 'PDF', fileId, sha256],
      );

      await tx.query(
        `UPDATE payments SET reprint_count = reprint_count + 1 WHERE tenant_id = $1 AND id = $2`,
        [tenantId, paymentId],
      );

      // No dedup_key: every reprint is a distinct audited act, even for the
      // same payment on the same day.
      await tx.query(
        `INSERT INTO outbox (tenant_id, aggregate_type, aggregate_id, event_type, payload)
         VALUES ($1, 'payment', $2::text, 'billing.receipt.reprinted', $3::jsonb)`,
        [
          tenantId,
          paymentId,
          JSON.stringify({
            paymentId,
            invoiceNo: pay.payment_no,
            reprintId: reprint.rows[0]!.id,
            reason: dto.reason,
            fileId,
            sha256,
            // Whether the patient received the original bytes or a document
            // rendered on the spot, so an auditor can tell which happened.
            reissuedOriginal: reissued,
          }),
        ],
      );

      const receipt = await this.getPaymentReceiptWithTx(tx, tenantId, paymentId);
      return {
        ...receipt,
        reprintId: reprint.rows[0]!.id,
        reprintedAt: reprint.rows[0]!.reprinted_at,
        document: { fileId, sha256, reissuedOriginal: reissued },
      };
    });
  }

  /**
   * The tenant's own receipt facts, plus the original artifact when one exists.
   *
   * Q-17: only patient-safe columns are selected. Invoice `notes`, PF rates and
   * practitioner revenue shares are never read, so they cannot reach a document.
   */
  private async loadReprintFacts(
    tx: PoolClient,
    tenantId: string,
    paymentId: string,
  ): Promise<{ facts: ReceiptFacts; originalFileId: string | null }> {
    const res = await tx.query(
      `SELECT p.id, p.payment_no, p.amount, p.tendered_amount, p.change_amount,
              p.payer_type, p.received_at, p.invoice_id, p.receipt_file_id,
              pm.name as method_name,
              u.id as cashier_id, u.name as cashier_name,
              b.name as clinic_name,
              i.total as invoice_total, i.discount_total,
              pt.first_name as patient_first, pt.last_name as patient_last,
              (SELECT json_agg(json_build_object(
                          'description', il.description,
                          'qty', il.qty,
                          'unitPrice', il.unit_price,
                          'total', il.net_amount) ORDER BY il.line_no)
                 FROM invoice_lines il
                WHERE il.tenant_id = p.tenant_id AND il.invoice_id = p.invoice_id) as invoice_lines
       FROM payments p
       JOIN payment_methods pm ON pm.tenant_id = p.tenant_id AND pm.id = p.method_id
       JOIN users u ON u.tenant_id = p.tenant_id AND u.id = p.received_by
       JOIN branches b ON b.tenant_id = p.tenant_id AND b.id = p.branch_id
       LEFT JOIN invoices i ON i.tenant_id = p.tenant_id AND i.id = p.invoice_id
       LEFT JOIN patients pt ON pt.tenant_id = p.tenant_id AND pt.id = p.patient_id
       WHERE p.tenant_id = $1 AND p.id = $2`,
      [tenantId, paymentId],
    );
    if (res.rowCount === 0) throw new ProblemException('NOT_FOUND', { detail: 'Payment not found.' });
    const p = res.rows[0];

    return {
      originalFileId: p.receipt_file_id ?? null,
      facts: {
        clinicName: p.clinic_name,
        receiptNo: p.payment_no,
        issuedAt: new Date(p.received_at).toISOString(),
        cashierName: p.cashier_name,
        patientName:
          p.patient_first && p.patient_last
            ? `${p.patient_last}, ${p.patient_first}`
            : undefined,
        lines: p.invoice_lines ?? [],
        invoiceTotal: p.invoice_total != null ? Number(p.invoice_total) : null,
        discountTotal: p.discount_total != null ? Number(p.discount_total) : null,
        amount: Number(p.amount),
        amountTendered: Number(p.tendered_amount),
        changeGiven: Number(p.change_amount),
        payer: p.payer_type,
      },
    };
  }

  async voidPayment(tenantId: string, userId: string, paymentId: string, dto: VoidPaymentRequest) {
    return withTenant({ tenantId, userId }, async (tx) => {
      await this.checkPeriodOpen(tx, tenantId);

      const payRes = await tx.query(
        `SELECT id, invoice_id, amount, status, received_by FROM payments WHERE tenant_id = $1 AND id = $2`,
        [tenantId, paymentId],
      );
      if (payRes.rowCount === 0) throw new ProblemException('NOT_FOUND', { detail: 'Payment not found.' });
      const pay = payRes.rows[0];

      if (pay.status === 'VOIDED') {
        throw new ProblemException('CONFLICT', { detail: 'Payment has already been voided.' });
      }

      // Mark payment VOIDED
      await tx.query(
        `UPDATE payments
         SET status = 'VOIDED',
             voided_at = now(),
             voided_by = $1,
             void_reason = $2
         WHERE tenant_id = $3 AND id = $4`,
        [userId, dto.reason, tenantId, paymentId],
      );

      // Reverse invoice balance
      const invRes = await tx.query(
        `SELECT total, paid_amount FROM invoices WHERE tenant_id = $1 AND id = $2`,
        [tenantId, pay.invoice_id],
      );
      if ((invRes.rowCount ?? 0) > 0) {
        const inv = invRes.rows[0];
        const newPaid = Math.max(0, Number(inv.paid_amount) - Number(pay.amount));
        const newBalance = Number(inv.total) - newPaid;
        const newStatus = newPaid <= 0 ? 'OPEN' : 'PARTIAL';

        await tx.query(
          `UPDATE invoices
           SET paid_amount = $1, balance = $2, status = $3, updated_at = now()
           WHERE tenant_id = $4 AND id = $5`,
          [newPaid, newBalance, newStatus, tenantId, pay.invoice_id],
        );
      }

      return { status: 'VOIDED', paymentId };
    });
  }

  // ── 4. Cashier Shifts ──────────────────────────────────────────────────────

  async openShift(tenantId: string, userId: string, dto: OpenShiftRequest) {
    return withTenant({ tenantId, userId }, async (tx) => {
      // Period lock applies to shift operations: opening a shift in a locked
      // period would allow posting cash into a closed accounting period (todo.md §7.4).
      await this.checkPeriodOpen(tx, tenantId);

      // Check if user already has an open shift on this branch
      const existing = await tx.query(
        `SELECT * FROM cashier_shifts
         WHERE tenant_id = $1 AND branch_id = $2 AND cashier_id = $3 AND status = 'OPEN'`,
        [tenantId, dto.branchId, userId],
      );
      if ((existing.rowCount ?? 0) > 0) {
        return existing.rows[0];
      }

      const shiftNo = await this.nextDocNo(tx, tenantId, 'SH');

      const res = await tx.query(
        `INSERT INTO cashier_shifts (
           tenant_id, branch_id, shift_no, cashier_id, opening_cash, notes, status
         ) VALUES ($1, $2, $3, $4, $5, $6, 'OPEN')
         RETURNING *`,
        [tenantId, dto.branchId, shiftNo, userId, Number(dto.openingCash ?? 0), dto.notes ?? null],
      );

      return res.rows[0];
    });
  }

  async closeShift(tenantId: string, userId: string, shiftId: string, dto: CloseShiftRequest) {
    return withTenant({ tenantId, userId }, async (tx) => {
      // Period lock applies: shift-close records are immutable summaries and
      // must not be written into a locked accounting period (todo.md §7.4).
      await this.checkPeriodOpen(tx, tenantId);

      const shiftRes = await tx.query(
        `SELECT * FROM cashier_shifts WHERE tenant_id = $1 AND id = $2`,
        [tenantId, shiftId],
      );
      if (shiftRes.rowCount === 0) throw new ProblemException('NOT_FOUND', { detail: 'Shift not found.' });
      const shift = shiftRes.rows[0];

      if (shift.status === 'CLOSED') {
        throw new ProblemException('CONFLICT', { detail: 'Shift is already closed.' });
      }

      // Compute expected cash from opening cash + posted cash payments - cash voids
      const cashPayRes = await tx.query(
        `SELECT COALESCE(SUM(p.amount), 0) as cash_collected
         FROM payments p
         JOIN payment_methods pm ON pm.tenant_id = p.tenant_id AND pm.id = p.method_id
         WHERE p.tenant_id = $1 AND p.shift_id = $2
           AND p.status = 'POSTED' AND pm.code = 'CASH'`,
        [tenantId, shiftId],
      );
      const cashCollected = Number(cashPayRes.rows[0]?.cash_collected ?? 0);
      const openingCash = Number(shift.opening_cash ?? 0);
      const expectedCash = openingCash + cashCollected;

      const countedCash = Number(dto.countedCash);
      const variance = Number((countedCash - expectedCash).toFixed(2));

      const updated = await tx.query(
        `UPDATE cashier_shifts
         SET status = 'CLOSED',
             closed_at = now(),
             counted_cash = $1,
             expected_cash = $2,
             variance = $3,
             notes = COALESCE($4, notes),
             updated_at = now()
         WHERE tenant_id = $5 AND id = $6
         RETURNING *`,
        [countedCash, expectedCash, variance, dto.notes ?? null, tenantId, shiftId],
      );

      return updated.rows[0];
    });
  }

  // ── Cash Sessions (POS state) ───────────────────────────────────────────────

  async listCashSessions(tenantId: string, cashierId: string) {
    return withTenant({ tenantId }, async (tx) => {
      const res = await tx.query(
        `SELECT id, branch_id, status, patient_id, invoice_id, session_data, created_at, updated_at, row_version
         FROM cash_sessions
         WHERE tenant_id = $1 AND cashier_id = $2 AND status IN ('OPEN', 'HELD')
         ORDER BY updated_at DESC`,
        [tenantId, cashierId],
      );
      return { data: res.rows };
    });
  }

  async saveCashSession(tenantId: string, userId: string, sessionId: string, dto: SaveCashSessionRequest) {
    return withTenant({ tenantId, userId }, async (tx) => {
      if (sessionId === 'new') {
        const res = await tx.query(
          `INSERT INTO cash_sessions (tenant_id, branch_id, cashier_id, patient_id, invoice_id, status, session_data)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING *`,
          [tenantId, dto.branchId, userId, dto.patientId ?? null, dto.invoiceId ?? null, dto.status, dto.sessionData],
        );
        return res.rows[0];
      }

      const res = await tx.query(
        `UPDATE cash_sessions
         SET patient_id = COALESCE($3, patient_id),
             invoice_id = COALESCE($4, invoice_id),
             status = COALESCE($5, status),
             session_data = COALESCE($6, session_data),
             updated_at = now(), row_version = row_version + 1
         WHERE tenant_id = $1 AND id = $2 AND row_version = $7
         RETURNING *`,
        [tenantId, sessionId, dto.patientId ?? null, dto.invoiceId ?? null, dto.status, dto.sessionData, dto.rowVersion ?? 1],
      );
      if (res.rowCount === 0) {
        throw new ProblemException('STALE_ROW_VERSION', { detail: 'Session was updated concurrently.' });
      }
      return res.rows[0];
    });
  }

  async getShifts(
    tenantId: string,
    query: {
      branchId?: string;
      cashierId?: string;
      status?: string;
      limit?: number;
      offset?: number;
    },
  ) {
    return withTenant({ tenantId }, async (tx) => {
      const conditions: string[] = ['s.tenant_id = $1'];
      const params: any[] = [tenantId];
      let pIdx = 2;

      if (query.branchId) {
        conditions.push(`s.branch_id = $${pIdx++}`);
        params.push(query.branchId);
      }
      if (query.cashierId) {
        conditions.push(`s.cashier_id = $${pIdx++}`);
        params.push(query.cashierId);
      }
      if (query.status) {
        conditions.push(`s.status = $${pIdx++}`);
        params.push(query.status);
      }

      const limit = query.limit ?? 50;
      const offset = query.offset ?? 0;

      const res = await tx.query(
        `SELECT s.*,
                b.name as branch_name,
                u.name as cashier_name
         FROM cashier_shifts s
         JOIN branches b ON b.tenant_id = s.tenant_id AND b.id = s.branch_id
         JOIN users u ON u.tenant_id = s.tenant_id AND u.id = s.cashier_id
         WHERE ${conditions.join(' AND ')}
         ORDER BY s.opened_at DESC
         LIMIT $${pIdx++} OFFSET $${pIdx++}`,
        [...params, limit, offset],
      );

      return {
        data: res.rows,
        limit,
        offset,
      };
    });
  }

  async getShiftById(tenantId: string, id: string) {
    return withTenant({ tenantId }, async (tx) => {
      const res = await tx.query(
        `SELECT s.*,
                b.name as branch_name,
                u.name as cashier_name
         FROM cashier_shifts s
         JOIN branches b ON b.tenant_id = s.tenant_id AND b.id = s.branch_id
         JOIN users u ON u.tenant_id = s.tenant_id AND u.id = s.cashier_id
         WHERE s.tenant_id = $1 AND s.id = $2`,
        [tenantId, id],
      );
      if (res.rowCount === 0) throw new ProblemException('NOT_FOUND', { detail: 'Shift not found.' });
      const shift = res.rows[0];

      // Shift X/Z metrics
      const payMetrics = await tx.query(
        `SELECT
           COALESCE(COUNT(*), 0)::int as total_transactions,
           COALESCE(SUM(p.amount), 0) as total_collected,
           COALESCE(SUM(CASE WHEN pm.code = 'CASH' THEN p.amount ELSE 0 END), 0) as total_cash,
           COALESCE(SUM(CASE WHEN pm.code = 'CARD' THEN p.amount ELSE 0 END), 0) as total_card,
           COALESCE(SUM(CASE WHEN pm.code IN ('GCASH', 'MAYA', 'ONLINE', 'BANK_TRANSFER') THEN p.amount ELSE 0 END), 0) as total_online
         FROM payments p
         JOIN payment_methods pm ON pm.tenant_id = p.tenant_id AND pm.id = p.method_id
         WHERE p.tenant_id = $1 AND p.shift_id = $2 AND p.status = 'POSTED'`,
        [tenantId, id],
      );

      return {
        ...shift,
        metrics: payMetrics.rows[0],
      };
    });
  }

  // ── 5. Credit Notes ────────────────────────────────────────────────────────

  async createCreditNote(tenantId: string, userId: string, dto: CreateCreditNoteRequest) {
    return withTenant({ tenantId, userId }, async (tx) => {
      await this.checkPeriodOpen(tx, tenantId);

      const cnNo = await this.nextDocNo(tx, tenantId, 'CN');

      const res = await tx.query(
        `INSERT INTO credit_notes (
           tenant_id, branch_id, cn_no, invoice_id, amount, reason, status, created_by
         ) VALUES ($1, $2, $3, $4, $5, $6, 'DRAFT', $7)
         RETURNING *`,
        [tenantId, dto.branchId, cnNo, dto.invoiceId, Number(dto.amount), dto.reason, userId],
      );

      return res.rows[0];
    });
  }

  async approveCreditNote(tenantId: string, userId: string, id: string, dto: ApproveCreditNoteRequest) {
    return withTenant({ tenantId, userId }, async (tx) => {
      await this.checkPeriodOpen(tx, tenantId);

      const cnRes = await tx.query(`SELECT * FROM credit_notes WHERE tenant_id = $1 AND id = $2`, [tenantId, id]);
      if (cnRes.rowCount === 0) throw new ProblemException('NOT_FOUND', { detail: 'Credit note not found.' });
      const cn = cnRes.rows[0];

      if (cn.status === 'APPROVED') throw new ProblemException('CONFLICT', { detail: 'Credit note is already approved.' });

      const updated = await tx.query(
        `UPDATE credit_notes
         SET status = 'APPROVED',
             approved_by = $1,
             approved_at = now()
         WHERE tenant_id = $2 AND id = $3
         RETURNING *`,
        [userId, tenantId, id],
      );

      // Reduce invoice balance if applicable
      const invRes = await tx.query(
        `SELECT balance, total FROM invoices WHERE tenant_id = $1 AND id = $2`,
        [tenantId, cn.invoice_id],
      );
      if ((invRes.rowCount ?? 0) > 0) {
        const inv = invRes.rows[0];
        const newBalance = Math.max(0, Number(inv.balance) - Number(cn.amount));
        await tx.query(
          `UPDATE invoices SET balance = $1, updated_at = now() WHERE tenant_id = $2 AND id = $3`,
          [newBalance, tenantId, cn.invoice_id],
        );
      }

      return updated.rows[0];
    });
  }

  async getCreditNotes(
    tenantId: string,
    query: {
      invoiceId?: string;
      branchId?: string;
      status?: string;
    },
  ) {
    return withTenant({ tenantId }, async (tx) => {
      const conditions: string[] = ['cn.tenant_id = $1'];
      const params: any[] = [tenantId];
      let pIdx = 2;

      if (query.invoiceId) {
        conditions.push(`cn.invoice_id = $${pIdx++}`);
        params.push(query.invoiceId);
      }
      if (query.branchId) {
        conditions.push(`cn.branch_id = $${pIdx++}`);
        params.push(query.branchId);
      }
      if (query.status) {
        conditions.push(`cn.status = $${pIdx++}`);
        params.push(query.status);
      }

      const res = await tx.query(
        `SELECT cn.*,
                i.invoice_no,
                u.name as creator_name,
                au.name as approver_name
         FROM credit_notes cn
         JOIN invoices i ON i.tenant_id = cn.tenant_id AND i.id = cn.invoice_id
         JOIN users u ON u.tenant_id = cn.tenant_id AND u.id = cn.created_by
         LEFT JOIN users au ON au.tenant_id = cn.tenant_id AND au.id = cn.approved_by
         WHERE ${conditions.join(' AND ')}
         ORDER BY cn.created_at DESC`,
        params,
      );

      return res.rows;
    });
  }

  // ── 6. Billing Charges (Staging) ───────────────────────────────────────────

  async getCharges(
    tenantId: string,
    query: {
      visitId?: string;
      unbilledOnly?: boolean;
      limit?: number;
      offset?: number;
    },
  ) {
    return withTenant({ tenantId }, async (tx) => {
      const conditions: string[] = ['bc.tenant_id = $1 AND bc.voided_at IS NULL'];
      const params: any[] = [tenantId];
      let pIdx = 2;

      if (query.visitId) {
        conditions.push(`bc.visit_id = $${pIdx++}`);
        params.push(query.visitId);
      }
      if (query.unbilledOnly) {
        conditions.push(`bc.invoice_id IS NULL`);
      }

      const limit = query.limit ?? 50;
      const offset = query.offset ?? 0;

      const res = await tx.query(
        `SELECT bc.*,
                v.visit_type,
                p.first_name as patient_first_name,
                p.last_name as patient_last_name,
                (SELECT value FROM patient_identifiers pi WHERE pi.tenant_id = p.tenant_id AND pi.patient_id = p.id LIMIT 1) as patient_number
         FROM billing_charges bc
         JOIN visits v ON v.tenant_id = bc.tenant_id AND v.id = bc.visit_id
         JOIN patients p ON p.tenant_id = v.tenant_id AND p.id = v.patient_id
         WHERE ${conditions.join(' AND ')}
         ORDER BY bc.posted_at DESC
         LIMIT $${pIdx++} OFFSET $${pIdx++}`,
        [...params, limit, offset],
      );

      return res.rows;
    });
  }

  async createCharge(tenantId: string, userId: string, dto: CreateChargeRequest) {
    return withTenant({ tenantId, userId }, async (tx) => {
      const vRes = await tx.query(`SELECT branch_id FROM visits WHERE tenant_id = $1 AND id = $2`, [
        tenantId,
        dto.visitId,
      ]);
      const branchId = vRes.rows[0]?.branch_id;
      if (!branchId) throw new ProblemException('NOT_FOUND', { detail: 'Visit not found' });

      const qty = Number(dto.quantity ?? 1);
      const unitPrice = await resolveServicePrice(tx, tenantId, dto.serviceId);
      const amount = Number((qty * unitPrice).toFixed(2));

      const res = await tx.query(
        `INSERT INTO billing_charges (
           tenant_id, branch_id, visit_id, charge_type, source_type, source_id,
           service_id, description, quantity, unit_price, amount, payer_type, posted_by
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         RETURNING *`,
        [
          tenantId,
          branchId,
          dto.visitId,
          dto.chargeType,
          dto.sourceType,
          dto.sourceId,
          dto.serviceId,
          dto.description,
          qty,
          unitPrice,
          amount,
          dto.payerType ?? 'PRIVATE_CASH',
          userId,
        ],
      );

      return res.rows[0];
    });
  }

  // ── 7. Daily Close & Tallies ───────────────────────────────────────────────

  async getDailyClose(tenantId: string, dateStr?: string, branchId?: string) {
    return withTenant({ tenantId }, async (tx) => {
      const targetDate = dateStr ?? new Date().toISOString().slice(0, 10);

      const conditions: string[] = ['tenant_id = $1', 'close_date = $2'];
      const params: any[] = [tenantId, targetDate];

      if (branchId) {
        conditions.push('branch_id = $3');
        params.push(branchId);
      }

      const res = await tx.query(
        `SELECT dcs.*, b.name as branch_name
         FROM daily_cashier_summaries dcs
         JOIN branches b ON b.tenant_id = dcs.tenant_id AND b.id = dcs.branch_id
         WHERE ${conditions.join(' AND ')}`,
        params,
      );

      return {
        date: targetDate,
        summaries: res.rows,
      };
    });
  }

  async runDailyClose(tenantId: string, userId: string, dto: DailyCloseRunRequest) {
    return withTenant({ tenantId, userId }, async (tx) => {
      const targetDate = dto.date ?? new Date().toISOString().slice(0, 10);
      const branchCond = dto.branchId ? 'AND b.id = $2' : '';
      const params = dto.branchId ? [tenantId, dto.branchId] : [tenantId];

      const branches = await tx.query(
        `SELECT id as branch_id FROM branches b WHERE b.tenant_id = $1 AND b.is_active = true ${branchCond}`,
        params,
      );

      const results = [];
      for (const b of branches.rows) {
        const branchId = b.branch_id;

        // Count open shifts
        const openRes = await tx.query(
          `SELECT count(*)::int as open_count FROM cashier_shifts
           WHERE tenant_id = $1 AND branch_id = $2 AND status = 'OPEN'`,
          [tenantId, branchId],
        );
        const openShiftsCount = openRes.rows[0]?.open_count ?? 0;

        // Invoiced totals
        const invRes = await tx.query(
          `SELECT COALESCE(SUM(total), 0) as total_invoiced,
                  COALESCE(SUM(discount_total), 0) as total_discounts
           FROM invoices
           WHERE tenant_id = $1 AND branch_id = $2 AND status != 'VOID'
             AND DATE(created_at AT TIME ZONE 'Asia/Manila') = $3::date`,
          [tenantId, branchId, targetDate],
        );

        // Payments
        const payRes = await tx.query(
          `SELECT
             COALESCE(SUM(p.amount), 0) as total_collected,
             COALESCE(SUM(CASE WHEN pm.code = 'CASH' THEN p.amount ELSE 0 END), 0) as total_cash,
             COALESCE(SUM(CASE WHEN pm.code = 'CARD' THEN p.amount ELSE 0 END), 0) as total_card,
             COALESCE(SUM(CASE WHEN pm.code IN ('GCASH', 'MAYA', 'ONLINE', 'BANK_TRANSFER') THEN p.amount ELSE 0 END), 0) as total_online,
             COALESCE(SUM(CASE WHEN p.payer_type = 'HMO' THEN p.amount ELSE 0 END), 0) as total_hmo,
             COALESCE(SUM(CASE WHEN p.payer_type = 'PHILHEALTH' THEN p.amount ELSE 0 END), 0) as total_philhealth,
             COALESCE(SUM(CASE WHEN p.payer_type = 'CORPORATE' THEN p.amount ELSE 0 END), 0) as total_corporate
           FROM payments p
           JOIN payment_methods pm ON pm.tenant_id = p.tenant_id AND pm.id = p.method_id
           WHERE p.tenant_id = $1 AND p.branch_id = $2 AND p.status = 'POSTED'
             AND DATE(p.received_at AT TIME ZONE 'Asia/Manila') = $3::date`,
          [tenantId, branchId, targetDate],
        );
        const pRow = payRes.rows[0] ?? {};

        // Credit notes
        const cnRes = await tx.query(
          `SELECT COALESCE(SUM(amount), 0) as total_cn
           FROM credit_notes
           WHERE tenant_id = $1 AND branch_id = $2 AND status = 'APPROVED'
             AND DATE(approved_at AT TIME ZONE 'Asia/Manila') = $3::date`,
          [tenantId, branchId, targetDate],
        );

        const insRes = await tx.query(
          `INSERT INTO daily_cashier_summaries (
             tenant_id, branch_id, close_date, total_invoiced, total_collected,
             total_cash, total_card, total_online, total_hmo, total_philhealth,
             total_corporate, total_discounts, total_credit_notes, open_shifts_count,
             closed_by, closed_at, is_locked
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, now(), true)
           ON CONFLICT (tenant_id, branch_id, close_date)
           DO UPDATE SET
             total_invoiced = EXCLUDED.total_invoiced,
             total_collected = EXCLUDED.total_collected,
             total_cash = EXCLUDED.total_cash,
             total_card = EXCLUDED.total_card,
             total_online = EXCLUDED.total_online,
             total_hmo = EXCLUDED.total_hmo,
             total_philhealth = EXCLUDED.total_philhealth,
             total_corporate = EXCLUDED.total_corporate,
             total_discounts = EXCLUDED.total_discounts,
             total_credit_notes = EXCLUDED.total_credit_notes,
             open_shifts_count = EXCLUDED.open_shifts_count,
             closed_by = EXCLUDED.closed_by,
             closed_at = now()
           RETURNING *`,
          [
            tenantId,
            branchId,
            targetDate,
            Number(invRes.rows[0]?.total_invoiced ?? 0),
            Number(pRow.total_collected ?? 0),
            Number(pRow.total_cash ?? 0),
            Number(pRow.total_card ?? 0),
            Number(pRow.total_online ?? 0),
            Number(pRow.total_hmo ?? 0),
            Number(pRow.total_philhealth ?? 0),
            Number(pRow.total_corporate ?? 0),
            Number(invRes.rows[0]?.total_discounts ?? 0),
            Number(cnRes.rows[0]?.total_cn ?? 0),
            openShiftsCount,
            userId,
          ],
        );
        results.push(insRes.rows[0]);
      }

      return { date: targetDate, summaries: results };
    });
  }

  /**
   * Daily PhilHealth Konsulta tally (Q-16 / todo.md §7.4).
   * Per-day, per-physician summary of Konsulta encounters and rendered services.
   */
  async getKonsultaTally(tenantId: string, dateStr: string, practitionerId?: string) {
    return withTenant({ tenantId }, async (tx) => {
      const conditions: string[] = [
        'v.tenant_id = $1',
        "(DATE(v.opened_at AT TIME ZONE 'Asia/Manila') = $2::date OR DATE(v.opened_at AT TIME ZONE 'UTC') = $2::date OR DATE(v.opened_at) = $2::date)",
      ];
      const params: any[] = [tenantId, dateStr];

      if (practitionerId) {
        conditions.push('v.practitioner_id = $3');
        params.push(practitionerId);
      }

      const res = await tx.query(
        `SELECT
           v.id as visit_id,
           v.opened_at,
           v.practitioner_id,
           u.name as physician_name,
           (SELECT pp.philhealth_accreditation_no FROM practitioner_profiles pp WHERE pp.tenant_id = u.tenant_id AND pp.user_id = u.id LIMIT 1) as physician_license,
           p.id as patient_id,
           p.first_name,
           p.last_name,
           (SELECT value FROM patient_identifiers pi WHERE pi.tenant_id = p.tenant_id AND pi.patient_id = p.id LIMIT 1) as patient_number,
           ph.pin as philhealth_pin,
           ph.membership_category,
           ph.konsulta_status,
           (
             SELECT json_agg(json_build_object(
               'description', il.description,
               'sourceType', il.source_type,
               'amount', il.net_amount
             ))
             FROM invoice_lines il
             JOIN invoices inv ON inv.id = il.invoice_id
             WHERE inv.visit_id = v.id AND il.payer_type = 'PHILHEALTH'
           ) as rendered_services
         FROM visits v
         JOIN users u ON u.tenant_id = v.tenant_id AND u.id = v.practitioner_id
         JOIN patients p ON p.tenant_id = v.tenant_id AND p.id = v.patient_id
         LEFT JOIN patient_philhealth ph ON ph.tenant_id = p.tenant_id AND ph.patient_id = p.id
         WHERE ${conditions.join(' AND ')}
         ORDER BY u.name ASC, v.opened_at ASC`,
        params,
      );

      // Group by physician
      const grouped: Record<string, { physician: string; license: string; encounters: any[] }> = {};
      for (const row of res.rows) {
        const key = row.practitioner_id;
        if (!grouped[key]) {
          grouped[key] = {
            physician: row.physician_name,
            license: row.physician_license,
            encounters: [],
          };
        }
        grouped[key].encounters.push({
          visitId: row.visit_id,
          openedAt: row.opened_at,
          patientName: `${row.first_name} ${row.last_name}`,
          patientNumber: row.patient_number,
          pin: row.philhealth_pin,
          category: row.membership_category,
          konsultaStatus: row.konsulta_status,
          services: row.rendered_services ?? [],
        });
      }

      return {
        date: dateStr,
        totalEncounters: res.rowCount,
        physicianTallies: Object.values(grouped),
      };
    });
  }

  // ── 8. Finance Reports (RPT-BIL-*) & Patient Statements ──────────────────────

  async getPatientStatement(tenantId: string, patientId: string) {
    return withTenant({ tenantId }, async (tx) => {
      const patRes = await tx.query(
        `SELECT p.id, p.first_name, p.last_name, p.date_of_birth, p.gender,
                (SELECT pi.value FROM patient_identifiers pi WHERE pi.tenant_id = p.tenant_id AND pi.patient_id = p.id LIMIT 1) as patient_number
         FROM patients p
         WHERE p.tenant_id = $1 AND p.id = $2`,
        [tenantId, patientId],
      );
      if (patRes.rowCount === 0) {
        throw new ProblemException('NOT_FOUND', { detail: 'Patient not found' });
      }
      const patient = patRes.rows[0];

      const invRes = await tx.query(
        `SELECT i.id, i.invoice_no, i.issued_at, i.due_at, i.status, i.subtotal,
                i.discount_total, i.tax_total, i.total, i.paid_amount, i.balance, i.payer_type,
                (
                  SELECT json_agg(json_build_object(
                    'description', il.description,
                    'qty', il.qty,
                    'unitPrice', il.unit_price,
                    'netAmount', il.net_amount,
                    'isProfessionalFee', il.is_professional_fee
                  ))
                  FROM invoice_lines il
                  WHERE il.tenant_id = i.tenant_id AND il.invoice_id = i.id
                ) as lines,
                (
                  SELECT json_agg(json_build_object(
                    'paymentNo', p.payment_no,
                    'amount', pa.amount,
                    'receivedAt', p.received_at,
                    'method', pm.name
                  ))
                  FROM payment_allocations pa
                  JOIN payments p ON p.tenant_id = pa.tenant_id AND p.id = pa.payment_id
                  JOIN payment_methods pm ON pm.tenant_id = p.tenant_id AND pm.id = p.method_id
                  WHERE pa.tenant_id = i.tenant_id AND pa.invoice_id = i.id AND p.status = 'POSTED'
                ) as payments
         FROM invoices i
         WHERE i.tenant_id = $1 AND i.patient_id = $2 AND i.status != 'VOID'
         ORDER BY i.issued_at DESC`,
        [tenantId, patientId],
      );

      const invoices = invRes.rows;
      let totalBilled = 0;
      let totalPaid = 0;
      let totalBalance = 0;

      const aging = {
        current_0_30: 0,
        days_31_60: 0,
        days_61_90: 0,
        over_90: 0,
      };

      const now = Date.now();
      for (const inv of invoices) {
        const total = Number(inv.total || 0);
        const paid = Number(inv.paid_amount || 0);
        const balance = Number(inv.balance || 0);
        totalBilled += total;
        totalPaid += paid;
        totalBalance += balance;

        if (balance > 0) {
          const issuedTime = new Date(inv.issued_at).getTime();
          const ageDays = Math.floor((now - issuedTime) / (1000 * 60 * 60 * 24));
          if (ageDays <= 30) {
            aging.current_0_30 += balance;
          } else if (ageDays <= 60) {
            aging.days_31_60 += balance;
          } else if (ageDays <= 90) {
            aging.days_61_90 += balance;
          } else {
            aging.over_90 += balance;
          }
        }
      }

      return {
        patient: {
          id: patient.id,
          name: `${patient.first_name} ${patient.last_name}`,
          patientNumber: patient.patient_number || 'P-UNKNOWN',
          dateOfBirth: patient.date_of_birth,
          sex: patient.sex,
          phone: patient.phone,
          email: patient.email,
        },
        asOfDate: new Date().toISOString(),
        totalBilled: Number(totalBilled.toFixed(2)),
        totalPaid: Number(totalPaid.toFixed(2)),
        totalBalance: Number(totalBalance.toFixed(2)),
        aging: {
          current_0_30: Number(aging.current_0_30.toFixed(2)),
          days_31_60: Number(aging.days_31_60.toFixed(2)),
          days_61_90: Number(aging.days_61_90.toFixed(2)),
          over_90: Number(aging.over_90.toFixed(2)),
        },
        invoices,
      };
    });
  }

  async getReceivablesReport(
    tenantId: string,
    opts: { asOfDate?: string; branchId?: string; payerType?: string } = {},
  ) {
    return withTenant({ tenantId }, async (tx) => {
      const conditions: string[] = ["i.tenant_id = $1", "i.status IN ('OPEN', 'PARTIAL')", "i.balance > 0"];
      const params: any[] = [tenantId];
      let pIdx = 2;

      if (opts.branchId) {
        conditions.push(`i.branch_id = $${pIdx++}`);
        params.push(opts.branchId);
      }
      if (opts.payerType) {
        conditions.push(`i.payer_type = $${pIdx++}`);
        params.push(opts.payerType);
      }

      const res = await tx.query(
        `SELECT i.id, i.invoice_no, i.issued_at, i.due_at, i.total, i.paid_amount, i.balance, i.payer_type,
                p.id as patient_id, p.first_name, p.last_name,
                (SELECT pi.value FROM patient_identifiers pi WHERE pi.tenant_id = p.tenant_id AND pi.patient_id = p.id LIMIT 1) as patient_number,
                b.name as branch_name
         FROM invoices i
         JOIN branches b ON b.tenant_id = i.tenant_id AND b.id = i.branch_id
         LEFT JOIN patients p ON p.tenant_id = i.tenant_id AND p.id = i.patient_id
         WHERE ${conditions.join(' AND ')}
         ORDER BY i.issued_at ASC`,
        params,
      );

      const now = Date.now();
      const aging = {
        current_0_30: 0,
        days_31_60: 0,
        days_61_90: 0,
        over_90: 0,
      };

      const byPayer: Record<string, { count: number; total: number; balance: number }> = {
        PRIVATE_CASH: { count: 0, total: 0, balance: 0 },
        HMO: { count: 0, total: 0, balance: 0 },
        PHILHEALTH: { count: 0, total: 0, balance: 0 },
        CORPORATE: { count: 0, total: 0, balance: 0 },
      };

      const items = res.rows.map((row) => {
        const balance = Number(row.balance || 0);
        const total = Number(row.total || 0);
        const issuedTime = new Date(row.issued_at).getTime();
        const ageDays = Math.floor((now - issuedTime) / (1000 * 60 * 60 * 24));

        if (ageDays <= 30) aging.current_0_30 += balance;
        else if (ageDays <= 60) aging.days_31_60 += balance;
        else if (ageDays <= 90) aging.days_61_90 += balance;
        else aging.over_90 += balance;

        const payer = row.payer_type || 'PRIVATE_CASH';
        if (!byPayer[payer]) {
          byPayer[payer] = { count: 0, total: 0, balance: 0 };
        }
        byPayer[payer]!.count += 1;
        byPayer[payer]!.total += total;
        byPayer[payer]!.balance += balance;

        return {
          id: row.id,
          invoiceNo: row.invoice_no,
          issuedAt: row.issued_at,
          dueAt: row.due_at,
          ageDays,
          patientName: row.first_name ? `${row.first_name} ${row.last_name}` : 'Walk-in / Unknown',
          patientNumber: row.patient_number || '—',
          branchName: row.branch_name,
          payerType: row.payer_type,
          total,
          paidAmount: Number(row.paid_amount || 0),
          balance,
        };
      });

      const totalBalance = items.reduce((acc, i) => acc + i.balance, 0);

      return {
        asOfDate: new Date().toISOString(),
        totalReceivables: Number(totalBalance.toFixed(2)),
        totalInvoices: items.length,
        aging: {
          current_0_30: Number(aging.current_0_30.toFixed(2)),
          days_31_60: Number(aging.days_31_60.toFixed(2)),
          days_61_90: Number(aging.days_61_90.toFixed(2)),
          over_90: Number(aging.over_90.toFixed(2)),
        },
        byPayer,
        items,
      };
    });
  }

  async getDiscountsReport(
    tenantId: string,
    opts: { fromDate?: string; toDate?: string; branchId?: string } = {},
  ) {
    return withTenant({ tenantId }, async (tx) => {
      const conditions: string[] = ['da.tenant_id = $1'];
      const params: any[] = [tenantId];
      let pIdx = 2;

      if (opts.fromDate) {
        conditions.push(`da.created_at >= $${pIdx++}`);
        params.push(new Date(opts.fromDate));
      }
      if (opts.toDate) {
        conditions.push(`da.created_at <= $${pIdx++}`);
        params.push(new Date(opts.toDate));
      }
      if (opts.branchId) {
        conditions.push(`i.branch_id = $${pIdx++}`);
        params.push(opts.branchId);
      }

      const res = await tx.query(
        `SELECT da.id, da.id_number, da.id_type, da.discount_amount, da.created_at,
                dt.code as discount_code, dt.name as discount_name, dt.percentage,
                i.invoice_no, i.id as invoice_id,
                p.first_name, p.last_name,
                u.name as verified_by_name
         FROM discount_applications da
         JOIN discount_types dt ON dt.tenant_id = da.tenant_id AND dt.id = da.discount_type_id
         JOIN invoice_lines il ON il.tenant_id = da.tenant_id AND il.id = da.invoice_line_id
         JOIN invoices i ON i.tenant_id = il.tenant_id AND i.id = il.invoice_id
         LEFT JOIN patients p ON p.tenant_id = i.tenant_id AND p.id = i.patient_id
         LEFT JOIN users u ON u.tenant_id = da.tenant_id AND u.id = da.verified_by
         WHERE ${conditions.join(' AND ')}
         ORDER BY da.created_at DESC`,
        params,
      );

      const byCode: Record<string, { count: number; totalAmount: number }> = {};
      let grandTotal = 0;

      const items = res.rows.map((row) => {
        const amount = Number(row.discount_amount || 0);
        grandTotal += amount;
        const code = row.discount_code;
        if (!byCode[code]) {
          byCode[code] = { count: 0, totalAmount: 0 };
        }
        byCode[code]!.count += 1;
        byCode[code]!.totalAmount += amount;

        return {
          id: row.id,
          discountCode: row.discount_code,
          discountName: row.discount_name,
          percentage: Number(row.percentage || 0),
          discountAmount: amount,
          idType: row.id_type,
          idNumber: row.id_number,
          invoiceNo: row.invoice_no,
          invoiceId: row.invoice_id,
          patientName: row.first_name ? `${row.first_name} ${row.last_name}` : 'Unknown',
          verifiedBy: row.verified_by_name,
          createdAt: row.created_at,
        };
      });

      return {
        totalDiscounts: Number(grandTotal.toFixed(2)),
        count: items.length,
        byCode,
        items,
      };
    });
  }

  async getVoidsReport(
    tenantId: string,
    opts: { fromDate?: string; toDate?: string; branchId?: string } = {},
  ) {
    return withTenant({ tenantId }, async (tx) => {
      const conditionsInv: string[] = ["i.tenant_id = $1", "i.status = 'VOID'"];
      const conditionsPay: string[] = ["p.tenant_id = $1", "p.status = 'VOIDED'"];
      const params: any[] = [tenantId];
      let pIdx = 2;

      if (opts.fromDate) {
        conditionsInv.push(`i.voided_at >= $${pIdx}`);
        conditionsPay.push(`p.voided_at >= $${pIdx}`);
        params.push(new Date(opts.fromDate));
        pIdx++;
      }
      if (opts.toDate) {
        conditionsInv.push(`i.voided_at <= $${pIdx}`);
        conditionsPay.push(`p.voided_at <= $${pIdx}`);
        params.push(new Date(opts.toDate));
        pIdx++;
      }
      if (opts.branchId) {
        conditionsInv.push(`i.branch_id = $${pIdx}`);
        conditionsPay.push(`p.branch_id = $${pIdx}`);
        params.push(opts.branchId);
        pIdx++;
      }

      const res = await tx.query(
        `SELECT 'INVOICE' as entity_type, i.id, i.invoice_no as document_no, i.total as amount,
                i.void_reason as reason, i.voided_at, u.name as voided_by_name
         FROM invoices i
         LEFT JOIN users u ON u.tenant_id = i.tenant_id AND u.id = i.voided_by
         WHERE ${conditionsInv.join(' AND ')}
         UNION ALL
         SELECT 'PAYMENT' as entity_type, p.id, p.payment_no as document_no, p.amount,
                p.void_reason as reason, p.voided_at, u.name as voided_by_name
         FROM payments p
         LEFT JOIN users u ON u.tenant_id = p.tenant_id AND u.id = p.voided_by
         WHERE ${conditionsPay.join(' AND ')}
         ORDER BY voided_at DESC`,
        params,
      );

      const items = res.rows.map((r) => ({
        entityType: r.entity_type,
        id: r.id,
        documentNo: r.document_no,
        amount: Number(r.amount || 0),
        reason: r.reason,
        voidedAt: r.voided_at,
        voidedBy: r.voided_by_name,
      }));

      const totalVoidedAmount = items.reduce((acc, i) => acc + i.amount, 0);

      return {
        totalVoidedAmount: Number(totalVoidedAmount.toFixed(2)),
        count: items.length,
        items,
      };
    });
  }

  async getShiftXReport(tenantId: string, shiftId: string) {
    return withTenant({ tenantId }, async (tx) => {
      const shift = await this.getShiftById(tenantId, shiftId);
      const openingCash = Number(shift.opening_cash || 0);
      const totalCash = Number(shift.metrics?.total_cash || 0);
      const estimatedDrawerCash = Number((openingCash + totalCash).toFixed(2));

      return {
        reportType: 'X_REPORT',
        title: 'Mid-Shift Inquiry (X-Reading)',
        timestamp: new Date().toISOString(),
        shiftId: shift.id,
        shiftNo: shift.shift_no,
        cashier: shift.cashier_name,
        branch: shift.branch_name,
        openedAt: shift.opened_at,
        status: shift.status,
        openingCash,
        estimatedDrawerCash,
        metrics: shift.metrics,
      };
    });
  }

  async getShiftZReport(tenantId: string, shiftId: string) {
    return withTenant({ tenantId }, async (tx) => {
      const shift = await this.getShiftById(tenantId, shiftId);
      return {
        reportType: 'Z_REPORT',
        title: 'End-of-Shift Final Settlement (Z-Reading)',
        timestamp: shift.closed_at || new Date().toISOString(),
        shiftId: shift.id,
        shiftNo: shift.shift_no,
        cashier: shift.cashier_name,
        branch: shift.branch_name,
        openedAt: shift.opened_at,
        closedAt: shift.closed_at,
        status: shift.status,
        openingCash: Number(shift.opening_cash || 0),
        countedCash: Number(shift.counted_cash ?? 0),
        expectedCash: Number(shift.expected_cash ?? 0),
        variance: Number(shift.variance ?? 0),
        notes: shift.notes,
        metrics: shift.metrics,
      };
    });
  }
}

