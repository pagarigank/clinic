import { Inject, Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards, Req, Res } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { sendPdf } from '../http/pdf-response.js';
import { AuthGuard } from '../auth/guards/auth.guard.js';
import { TenantContextGuard } from '../auth/guards/tenant-context.guard.js';
import { Module } from '../rbac/module.guard.js';
import { RequirePermission } from '../rbac/require-permission.decorator.js';
import { BillingService } from './billing.service.js';
import type { RequestWithAuth } from '../auth/auth-context.js';
import { RequireStepUp } from '../auth/auth-context.js';
import {
  CreateInvoiceSchema, type CreateInvoiceRequest,
  UpdateInvoiceSchema, type UpdateInvoiceRequest,
  AddInvoiceLineSchema, type AddInvoiceLineRequest,
  ConsumeChargesSchema, type ConsumeChargesRequest,
  ApplyDiscountSchema, type ApplyDiscountRequest,
  VoidInvoiceSchema, type VoidInvoiceRequest,
  CreatePaymentSchema, type CreatePaymentRequest,
  VoidPaymentSchema, type VoidPaymentRequest,
  ReprintReceiptSchema, type ReprintReceiptRequest,
  OpenShiftSchema, type OpenShiftRequest,
  CloseShiftSchema, type CloseShiftRequest,
  CreateCreditNoteSchema, type CreateCreditNoteRequest,
  ApproveCreditNoteSchema, type ApproveCreditNoteRequest,
  CreateChargeSchema, type CreateChargeRequest,
  DailyCloseRunSchema, type DailyCloseRunRequest,
  SaveCashSessionSchema, type SaveCashSessionRequest,
} from '@clinic/contracts';

@ApiTags('Billing')
@ApiBearerAuth()
@Controller('billing')
@UseGuards(AuthGuard, TenantContextGuard)
@Module('billing')
export class BillingController {
  constructor(
    @Inject(BillingService) private readonly svc: BillingService,
  ) {}
  // ── 1. Invoices (BIL-T1) ───────────────────────────────────────────────────

  @RequirePermission('billing.invoice.read')
  @Get('invoices')
  @ApiOperation({ summary: 'List invoices' })
  async getInvoices(
    @Req() req: RequestWithAuth,
    @Query('branchId') branchId?: string,
    @Query('patientId') patientId?: string,
    @Query('visitId') visitId?: string,
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.svc.getInvoices(req.tenantId!, {
      branchId,
      patientId,
      visitId,
      status,
      search,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
  }

  @RequirePermission('billing.invoice.read')
  @Get('invoices/:id')
  @ApiOperation({ summary: 'Get invoice by ID' })
  async getInvoiceById(@Req() req: RequestWithAuth, @Param('id') id: string) {
    return this.svc.getInvoiceById(req.tenantId!, id);
  }

  @RequirePermission('billing.invoice.read')
  @Get('invoices/:id/print-profile')
  @ApiOperation({ summary: 'Get invoice and clinic print profile for letterhead customization' })
  async getInvoicePrintProfile(@Req() req: RequestWithAuth, @Param('id') id: string) {
    return this.svc.getInvoicePrintProfile(req.tenantId!, req.authContext!.userId!, id);
  }

  @RequirePermission('billing.invoice.read')
  @Get('invoices/:id/pdf')
  @ApiOperation({ summary: 'Official billing invoice as a true vector PDF (shared print pipeline, deterministic SHA-256)' })
  async getInvoicePdf(
    @Req() req: RequestWithAuth,
    @Param('id') id: string,
    @Res() reply: FastifyReply,
    @Query('clinicName') clinicName?: string,
    @Query('branchName') branchName?: string,
    @Query('clinicAddress') clinicAddress?: string,
    @Query('clinicPhone') clinicPhone?: string,
    @Query('clinicEmail') clinicEmail?: string,
    @Query('tin') tin?: string,
    @Query('dohLicenseNo') dohLicenseNo?: string,
    @Query('philhealthNo') philhealthNo?: string,
    @Query('billingOfficer') billingOfficer?: string,
    @Query('notes') notes?: string,
  ) {
    const overrides = {
      clinicName,
      branchName,
      clinicAddress,
      clinicPhone,
      clinicEmail,
      tin,
      dohLicenseNo,
      philhealthNo,
      billingOfficer,
      notes,
    };
    const cleanOverrides = Object.fromEntries(
      Object.entries(overrides).filter(([_, v]) => typeof v === 'string' && v.trim().length > 0)
    ) as Record<string, string>;

    const doc = await this.svc.renderInvoicePdf(req.tenantId!, req.authContext!.userId!, id, cleanOverrides);
    void sendPdf(reply, doc, `Invoice-${id.slice(0, 8)}.pdf`);
  }

  @RequirePermission('billing.invoice.create')
  @Post('invoices')
  @ApiOperation({ summary: 'Create invoice' })
  async createInvoice(@Req() req: RequestWithAuth, @Body() body: CreateInvoiceRequest) {
    const parsed = CreateInvoiceSchema.parse(body);
    return this.svc.createInvoice(req.tenantId!, req.authContext!.userId!, parsed);
  }

  @RequirePermission('billing.invoice.update')
  @Patch('invoices/:id')
  @ApiOperation({ summary: 'Update draft invoice' })
  async updateInvoice(@Req() req: RequestWithAuth, @Param('id') id: string, @Body() body: UpdateInvoiceRequest) {
    const parsed = UpdateInvoiceSchema.parse(body);
    return this.svc.updateInvoice(req.tenantId!, req.authContext!.userId!, id, parsed);
  }

  @RequirePermission('billing.invoice.update')
  @Post('invoices/:id/lines')
  @ApiOperation({ summary: 'Add line to draft invoice' })
  async addInvoiceLine(@Req() req: RequestWithAuth, @Param('id') id: string, @Body() body: AddInvoiceLineRequest) {
    const parsed = AddInvoiceLineSchema.parse(body);
    return this.svc.addInvoiceLine(req.tenantId!, req.authContext!.userId!, id, parsed);
  }

  @RequirePermission('billing.invoice.update')
  @Delete('invoices/:id/lines/:lineId')
  @ApiOperation({ summary: 'Remove line from draft invoice' })
  async removeInvoiceLine(
    @Req() req: RequestWithAuth,
    @Param('id') id: string,
    @Param('lineId') lineId: string,
  ) {
    return this.svc.removeInvoiceLine(req.tenantId!, req.authContext!.userId!, id, lineId);
  }

  @RequirePermission('billing.invoice.update')
  @Post('invoices/:id/consume-charges')
  @ApiOperation({ summary: 'Consume captured charges into draft invoice' })
  async consumeCharges(@Req() req: RequestWithAuth, @Param('id') id: string, @Body() body: ConsumeChargesRequest) {
    const parsed = ConsumeChargesSchema.parse(body);
    return this.svc.consumeCharges(req.tenantId!, req.authContext!.userId!, id, parsed.chargeIds);
  }

  @RequirePermission('billing.invoice.void')
  @Post('invoices/:id/void')
  @ApiOperation({ summary: 'Void invoice' })
  async voidInvoice(@Req() req: RequestWithAuth, @Param('id') id: string, @Body() body: VoidInvoiceRequest) {
    const parsed = VoidInvoiceSchema.parse(body);
    return this.svc.voidInvoice(req.tenantId!, req.authContext!.userId!, id, parsed);
  }

  // ── 2. Discounts (BIL-T2) ──────────────────────────────────────────────────

  @RequirePermission('billing.discount.read')
  @Get('discounts')
  @ApiOperation({ summary: 'List discount types' })
  async getDiscounts(@Req() req: RequestWithAuth) {
    return this.svc.getDiscounts(req.tenantId!);
  }

  @RequirePermission('billing.discount.create')
  @Post('invoices/:id/discounts')
  @ApiOperation({ summary: 'Apply discount to invoice' })
  async applyDiscount(@Req() req: RequestWithAuth, @Param('id') id: string, @Body() body: ApplyDiscountRequest) {
    const parsed = ApplyDiscountSchema.parse(body);
    return this.svc.applyDiscount(req.tenantId!, req.authContext!.userId!, id, parsed);
  }

  @RequirePermission('billing.discount.revoke')
  @Post('discounts/:id/revoke')
  @ApiOperation({ summary: 'Revoke discount application' })
  async revokeDiscount(@Req() req: RequestWithAuth, @Param('id') id: string) {
    return this.svc.revokeDiscount(req.tenantId!, req.authContext!.userId!, id);
  }

  // ── 3. Payments (BIL-T3) ───────────────────────────────────────────────────

  @RequirePermission('billing.payment.read')
  @Get('payments')
  @ApiOperation({ summary: 'List payments' })
  async getPayments(
    @Req() req: RequestWithAuth,
    @Query('invoiceId') invoiceId?: string,
    @Query('shiftId') shiftId?: string,
    @Query('branchId') branchId?: string,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.svc.getPayments(req.tenantId!, {
      invoiceId,
      shiftId,
      branchId,
      status,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
  }

  @RequirePermission('billing.payment.read')
  @Get('payments/:id')
  @ApiOperation({ summary: 'Get payment by ID' })
  async getPaymentById(@Req() req: RequestWithAuth, @Param('id') id: string) {
    return this.svc.getPaymentById(req.tenantId!, id);
  }

  @RequirePermission('billing.payment.read')
  @Get('payments/:id/receipt')
  @ApiOperation({ summary: 'Get payment official receipt' })
  async getPaymentReceipt(@Req() req: RequestWithAuth, @Param('id') id: string) {
    return this.svc.getPaymentReceipt(req.tenantId!, id);
  }

  @RequirePermission('billing.payment.read')
  @Get('payments/:id/print-profile')
  @ApiOperation({ summary: 'Get payment receipt print profile for letterhead customization' })
  async getPaymentPrintProfile(@Req() req: RequestWithAuth, @Param('id') id: string) {
    return this.svc.getPaymentPrintProfile(req.tenantId!, req.authContext!.userId!, id);
  }

  @RequirePermission('billing.payment.read')
  @Get('payments/:id/receipt-pdf')
  @ApiOperation({ summary: 'Official receipt as a true vector PDF (shared print pipeline, deterministic SHA-256)' })
  async getPaymentReceiptPdf(
    @Req() req: RequestWithAuth,
    @Param('id') id: string,
    @Res() reply: FastifyReply,
    @Query('clinicName') clinicName?: string,
    @Query('branchName') branchName?: string,
    @Query('clinicAddress') clinicAddress?: string,
    @Query('clinicPhone') clinicPhone?: string,
    @Query('clinicEmail') clinicEmail?: string,
    @Query('tin') tin?: string,
    @Query('dohAccreditationNo') dohAccreditationNo?: string,
    @Query('philhealthAccreditationNo') philhealthAccreditationNo?: string,
    @Query('cashierName') cashierName?: string,
  ) {
    const overrides = {
      clinicName,
      branchName,
      clinicAddress,
      clinicPhone,
      clinicEmail,
      tin,
      dohAccreditationNo,
      philhealthAccreditationNo,
      cashierName,
    };
    const cleanOverrides = Object.fromEntries(
      Object.entries(overrides).filter(([_, v]) => typeof v === 'string' && v.trim().length > 0)
    ) as Record<string, string>;

    const doc = await this.svc.renderPaymentReceiptPdf(req.tenantId!, req.authContext!.userId!, id, cleanOverrides);
    void sendPdf(reply, doc, `Receipt-${id.slice(0, 8)}.pdf`);
  }

  @RequirePermission('billing.payment.create')
  @Post('payments')
  @ApiOperation({ summary: 'Take payment (split tender supported)' })
  async createPayment(@Req() req: RequestWithAuth, @Body() body: CreatePaymentRequest) {
    const parsed = CreatePaymentSchema.parse(body);
    return this.svc.createPayment(req.tenantId!, req.authContext!.userId!, parsed);
  }

  @RequirePermission('billing.payment.read')
  @Post('payments/:id/reprint')
  @ApiOperation({ summary: 'Reprint receipt with audit log' })
  async reprintReceipt(@Req() req: RequestWithAuth, @Param('id') id: string, @Body() body: ReprintReceiptRequest) {
    const parsed = ReprintReceiptSchema.parse(body);
    return this.svc.reprintReceipt(req.tenantId!, req.authContext!.userId!, id, parsed);
  }

  @RequirePermission('billing.payment.void')
  @RequireStepUp()
  @Post('payments/:id/void')
  @ApiOperation({ summary: 'Void payment (requires step-up auth)' })
  async voidPayment(@Req() req: RequestWithAuth, @Param('id') id: string, @Body() body: VoidPaymentRequest) {
    const parsed = VoidPaymentSchema.parse(body);
    return this.svc.voidPayment(req.tenantId!, req.authContext!.userId!, id, parsed);
  }

  // ── 3.5 Cash Sessions (POS State) ──────────────────────────────────────────

  @RequirePermission('billing.payment.create')
  @Get('sessions')
  @ApiOperation({ summary: 'List active POS sessions for cashier' })
  async listCashSessions(@Req() req: RequestWithAuth) {
    return this.svc.listCashSessions(req.tenantId!, req.authContext!.userId!);
  }

  @RequirePermission('billing.payment.create')
  @Post('sessions/:id')
  @ApiOperation({ summary: 'Save or update POS session' })
  async saveCashSession(@Req() req: RequestWithAuth, @Param('id') id: string, @Body() body: SaveCashSessionRequest) {
    const parsed = SaveCashSessionSchema.parse(body);
    return this.svc.saveCashSession(req.tenantId!, req.authContext!.userId!, id, parsed);
  }

  // ── 4. Cashier Shifts (BIL-T5) ─────────────────────────────────────────────

  @RequirePermission('billing.shift.read')
  @Get('shifts')
  @ApiOperation({ summary: 'List cashier shifts' })
  async getShifts(
    @Req() req: RequestWithAuth,
    @Query('branchId') branchId?: string,
    @Query('cashierId') cashierId?: string,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.svc.getShifts(req.tenantId!, {
      branchId,
      cashierId,
      status,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
  }

  /**
   * Declared before `shifts/:id` on purpose: Nest resolves routes in
   * declaration order, so a later `shifts/active` would be swallowed by
   * `shifts/:id` and looked up as a shift id.
   */
  @RequirePermission('billing.shift.read')
  @Get('shifts/active')
  @ApiOperation({ summary: 'Get the caller’s currently open cashier shift' })
  async getActiveShift(@Req() req: RequestWithAuth) {
    return this.svc.getActiveShift(
      req.tenantId!,
      req.authContext!.userId!,
      // branchId is `string | null` on the auth context; the service takes an
      // optional filter, so a caller without an active branch must not be read
      // as "filter to the empty string".
      req.authContext!.branchId ?? undefined,
    );
  }

  @RequirePermission('billing.shift.read')
  @Get('shifts/:id')
  @ApiOperation({ summary: 'Get cashier shift and X/Z report metrics' })
  async getShiftById(@Req() req: RequestWithAuth, @Param('id') id: string) {
    return this.svc.getShiftById(req.tenantId!, id);
  }

  @RequirePermission('billing.shift.open')
  @Post('shifts/open')
  @ApiOperation({ summary: 'Open cashier shift' })
  async openShift(@Req() req: RequestWithAuth, @Body() body: OpenShiftRequest) {
    const parsed = OpenShiftSchema.parse(body);
    return this.svc.openShift(req.tenantId!, req.authContext!.userId!, parsed);
  }

  @RequirePermission('billing.shift.close')
  @Post('shifts/:id/close')
  @ApiOperation({ summary: 'Close cashier shift with blind count' })
  async closeShift(@Req() req: RequestWithAuth, @Param('id') id: string, @Body() body: CloseShiftRequest) {
    const parsed = CloseShiftSchema.parse(body);
    return this.svc.closeShift(req.tenantId!, req.authContext!.userId!, id, parsed);
  }

  // ── 5. Credit Notes (BIL-T4) ───────────────────────────────────────────────

  @RequirePermission('billing.credit.read')
  @Get('credit-notes')
  @ApiOperation({ summary: 'List credit notes' })
  async getCreditNotes(
    @Req() req: RequestWithAuth,
    @Query('invoiceId') invoiceId?: string,
    @Query('branchId') branchId?: string,
    @Query('status') status?: string,
  ) {
    return this.svc.getCreditNotes(req.tenantId!, { invoiceId, branchId, status });
  }

  @RequirePermission('billing.credit.create')
  @Post('credit-notes')
  @ApiOperation({ summary: 'Create credit note' })
  async createCreditNote(@Req() req: RequestWithAuth, @Body() body: CreateCreditNoteRequest) {
    const parsed = CreateCreditNoteSchema.parse(body);
    return this.svc.createCreditNote(req.tenantId!, req.authContext!.userId!, parsed);
  }

  @RequirePermission('billing.credit.approve')
  @Post('credit-notes/:id/approve')
  @ApiOperation({ summary: 'Approve credit note' })
  async approveCreditNote(@Req() req: RequestWithAuth, @Param('id') id: string, @Body() body: ApproveCreditNoteRequest) {
    const parsed = ApproveCreditNoteSchema.parse(body);
    return this.svc.approveCreditNote(req.tenantId!, req.authContext!.userId!, id, parsed);
  }

  // ── 6. Charges (Staging) ───────────────────────────────────────────────────

  @RequirePermission('billing.invoice.read')
  @Get('charges')
  @ApiOperation({ summary: 'List captured billing charges' })
  async getCharges(
    @Req() req: RequestWithAuth,
    @Query('visitId') visitId?: string,
    @Query('unbilledOnly') unbilledOnly?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.svc.getCharges(req.tenantId!, {
      visitId,
      unbilledOnly: unbilledOnly === 'true',
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
  }

  @RequirePermission('billing.charge.create')
  @Post('charges')
  @ApiOperation({ summary: 'Create/post a charge line' })
  async createCharge(@Req() req: RequestWithAuth, @Body() body: CreateChargeRequest) {
    const parsed = CreateChargeSchema.parse(body);
    return this.svc.createCharge(req.tenantId!, req.authContext!.userId!, parsed);
  }

  // ── 7. Daily Close & Reports ───────────────────────────────────────────────

  @RequirePermission('billing.shift.read')
  @Get('daily-close')
  @ApiOperation({ summary: 'Get daily close collections summary (JOB-48 output)' })
  async getDailyClose(
    @Req() req: RequestWithAuth,
    @Query('date') date?: string,
    @Query('branchId') branchId?: string,
  ) {
    return this.svc.getDailyClose(req.tenantId!, date, branchId);
  }

  @RequirePermission('billing.shift.read')
  @Get('daily-close/pdf')
  @ApiOperation({ summary: 'Render Daily Close Collections Summary (JOB-48) as a true vector PDF' })
  async getDailyClosePdf(
    @Req() req: RequestWithAuth,
    @Query('date') date: string | undefined,
    @Query('branchId') branchId: string | undefined,
    @Res() reply: FastifyReply,
  ) {
    const doc = await this.svc.renderDailyClosePdf(req.tenantId!, date, branchId);
    void sendPdf(reply, doc, `DailyClose-${date || new Date().toISOString().slice(0, 10)}.pdf`);
  }

  @RequirePermission('billing.shift.close')
  @Post('daily-close')
  @ApiOperation({ summary: 'Trigger daily close summary on demand' })
  async runDailyClose(@Req() req: RequestWithAuth, @Body() body: DailyCloseRunRequest) {
    const parsed = DailyCloseRunSchema.parse(body);
    return this.svc.runDailyClose(req.tenantId!, req.authContext!.userId!, parsed);
  }

  @RequirePermission('billing.invoice.read')
  @Get('reports/konsulta-tally')
  @ApiOperation({ summary: 'Get daily PhilHealth Konsulta tally (Q-16 / todo.md §7.4)' })
  async getKonsultaTally(
    @Req() req: RequestWithAuth,
    @Query('date') date: string,
    @Query('providerId') providerId?: string,
  ) {
    const targetDate = date ?? new Date().toISOString().slice(0, 10);
    return this.svc.getKonsultaTally(req.tenantId!, targetDate, providerId);
  }

  // ── 8. Finance Reports & Patient Statements ──────────────────────────────────

  @RequirePermission('billing.invoice.read')
  @Get('patients/:patientId/statement')
  @ApiOperation({ summary: 'Get Patient Statement of Account (SOA, todo.md §7.1)' })
  async getPatientStatement(@Req() req: RequestWithAuth, @Param('patientId') patientId: string) {
    return this.svc.getPatientStatement(req.tenantId!, patientId);
  }

  @RequirePermission('billing.invoice.read')
  @Get('patients/:patientId/statement-pdf')
  @ApiOperation({ summary: 'Render Patient Statement of Account (SOA) as a true vector PDF' })
  async getPatientStatementPdf(
    @Req() req: RequestWithAuth,
    @Param('patientId') patientId: string,
    @Res() reply: FastifyReply,
  ) {
    const doc = await this.svc.renderPatientStatementPdf(req.tenantId!, patientId);
    void sendPdf(reply, doc, `Statement-${patientId.slice(0, 8)}.pdf`);
  }

  @RequirePermission('billing.invoice.read')
  @Get('reports/receivables')
  @ApiOperation({ summary: 'Get accounts receivables and aging report (RPT-BIL-03)' })
  async getReceivablesReport(
    @Req() req: RequestWithAuth,
    @Query('asOfDate') asOfDate?: string,
    @Query('branchId') branchId?: string,
    @Query('payerType') payerType?: string,
  ) {
    return this.svc.getReceivablesReport(req.tenantId!, { asOfDate, branchId, payerType });
  }

  @RequirePermission('billing.invoice.read')
  @Get('reports/receivables-pdf')
  @ApiOperation({ summary: 'Render Accounts Receivables & Aging Report (RPT-BIL-03) as a true vector PDF' })
  async getReceivablesReportPdf(
    @Req() req: RequestWithAuth,
    @Query('asOfDate') asOfDate: string | undefined,
    @Query('branchId') branchId: string | undefined,
    @Query('payerType') payerType: string | undefined,
    @Res() reply: FastifyReply,
  ) {
    const doc = await this.svc.renderReceivablesReportPdf(req.tenantId!, { asOfDate, branchId, payerType });
    void sendPdf(reply, doc, `Receivables-Aging-${asOfDate || new Date().toISOString().slice(0, 10)}.pdf`);
  }

  @RequirePermission('billing.discount.read')
  @Get('reports/discounts')
  @ApiOperation({ summary: 'Get statutory and promo discounts log (RPT-BIL-04)' })
  async getDiscountsReport(
    @Req() req: RequestWithAuth,
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
    @Query('branchId') branchId?: string,
  ) {
    return this.svc.getDiscountsReport(req.tenantId!, { fromDate, toDate, branchId });
  }

  @RequirePermission('billing.payment.read')
  @Get('reports/voids')
  @ApiOperation({ summary: 'Get voided invoices and payments audit log (RPT-BIL-05)' })
  async getVoidsReport(
    @Req() req: RequestWithAuth,
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
    @Query('branchId') branchId?: string,
  ) {
    return this.svc.getVoidsReport(req.tenantId!, { fromDate, toDate, branchId });
  }

  @RequirePermission('billing.shift.read')
  @Get('shifts/:id/x-report')
  @ApiOperation({ summary: 'Get mid-shift inquiry X-Report (todo.md §7.3)' })
  async getShiftXReport(@Req() req: RequestWithAuth, @Param('id') id: string) {
    return this.svc.getShiftXReport(req.tenantId!, id);
  }

  @RequirePermission('billing.shift.read')
  @Get('shifts/:id/x-report-pdf')
  @ApiOperation({ summary: 'Render Cashier X-Report (Mid-Shift Inquiry) as a true vector PDF' })
  async getShiftXReportPdf(
    @Req() req: RequestWithAuth,
    @Param('id') id: string,
    @Res() reply: FastifyReply,
  ) {
    const doc = await this.svc.renderShiftReportPdf(req.tenantId!, id, 'X');
    void sendPdf(reply, doc, `Shift-XReport-${id.slice(0, 8)}.pdf`);
  }

  @RequirePermission('billing.shift.read')
  @Get('shifts/:id/z-report')
  @ApiOperation({ summary: 'Get end-of-shift Z-Report (todo.md §7.3, RPT-BIL-01)' })
  async getShiftZReport(@Req() req: RequestWithAuth, @Param('id') id: string) {
    return this.svc.getShiftZReport(req.tenantId!, id);
  }

  @RequirePermission('billing.shift.read')
  @Get('shifts/:id/z-report-pdf')
  @ApiOperation({ summary: 'Render Cashier Z-Report (End-of-Shift Settlement) as a true vector PDF' })
  async getShiftZReportPdf(
    @Req() req: RequestWithAuth,
    @Param('id') id: string,
    @Res() reply: FastifyReply,
  ) {
    const doc = await this.svc.renderShiftReportPdf(req.tenantId!, id, 'Z');
    void sendPdf(reply, doc, `Shift-ZReport-${id.slice(0, 8)}.pdf`);
  }
}

