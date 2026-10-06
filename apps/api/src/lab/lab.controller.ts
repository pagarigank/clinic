import { Inject, Controller, Get, Post, Patch, Delete, Put, Body, Param, Query, UseGuards, Req, Res } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { verifyDocument } from '@clinic/print';
import { ProblemException } from '../http/problem.exception.js';
import { sendPdf } from '../http/pdf-response.js';
import { AuthGuard } from '../auth/guards/auth.guard.js';
import { TenantContextGuard } from '../auth/guards/tenant-context.guard.js';
import { Module } from '../rbac/module.guard.js';
import { RequirePermission } from '../rbac/require-permission.decorator.js';
import { LabService } from './lab.service.js';
import type { RequestWithAuth } from '../auth/auth-context.js';
import {
  CreateLabSectionSchema, type CreateLabSectionRequest,
  UpdateLabSectionSchema, type UpdateLabSectionRequest,
  CreateLabSpecimenTypeSchema, type CreateLabSpecimenTypeRequest,
  CreateLabTestSchema, type CreateLabTestRequest,
  UpdateLabTestSchema, type UpdateLabTestRequest,
  CreateLabAnalyteSchema, type CreateLabAnalyteRequest,
  CreateLabReferenceRangeSchema, type CreateLabReferenceRangeRequest,
  CreateLabDeltaRuleSchema, type CreateLabDeltaRuleRequest,
  CreateLabInstrumentSchema, type CreateLabInstrumentRequest,
  type CreateLabTestReagentRequest,
  CreateLabReportTemplateSchema, type CreateLabReportTemplateRequest,
  CreateLabOrderSchema, type CreateLabOrderRequest,
  CancelLabOrderSchema, type CancelLabOrderRequest,
  CollectSpecimenSchema, type CollectSpecimenRequest,
  ReceiveSpecimenSchema, type ReceiveSpecimenRequest,
  EnterLabResultsSchema, type EnterLabResultsRequest,
  AmendLabResultSchema, type AmendLabResultRequest,
  AckCriticalNotificationSchema, type AckCriticalNotificationRequest,
  ReleaseLabReportSchema, type ReleaseLabReportRequest,
  CreateLabQcMaterialSchema, type CreateLabQcMaterialRequest,
  CreateLabQcRunSchema, type CreateLabQcRunRequest,
  CreateLabSendOutSchema, type CreateLabSendOutRequest,
  ReceiveLabSendOutResultSchema, type ReceiveLabSendOutResultRequest,
} from '@clinic/contracts';

@ApiTags('Laboratory')
@ApiBearerAuth()
@Controller('lab')
@UseGuards(AuthGuard, TenantContextGuard)
@Module('laboratory')
export class LabController {
  constructor(
    @Inject(LabService) private readonly svc: LabService,
  ) {}
  // ── Configuration: Sections ────────────────────────────────────────────────

  @RequirePermission('lab.config.read')
  @Get('sections')
  @ApiOperation({ summary: 'List lab sections' })
  async listSections(@Req() req: RequestWithAuth) {
    return this.svc.listSections(req.tenantId!);
  }

  @RequirePermission('lab.config.create')
  @Post('sections')
  @ApiOperation({ summary: 'Create lab section' })
  async createSection(@Req() req: RequestWithAuth, @Body() body: CreateLabSectionRequest) {
    const parsed = CreateLabSectionSchema.parse(body);
    return this.svc.createSection(req.tenantId!, parsed);
  }

  @RequirePermission('lab.config.update')
  @Patch('sections/:id')
  @ApiOperation({ summary: 'Update lab section' })
  async updateSection(@Req() req: RequestWithAuth, @Param('id') id: string, @Body() body: UpdateLabSectionRequest) {
    const parsed = UpdateLabSectionSchema.parse(body);
    return this.svc.updateSection(req.tenantId!, id, parsed);
  }

  @RequirePermission('lab.config.delete')
  @Delete('sections/:id')
  @ApiOperation({ summary: 'Delete lab section' })
  async deleteSection(@Req() req: RequestWithAuth, @Param('id') id: string) {
    return this.svc.deleteSection(req.tenantId!, id);
  }

  // ── Configuration: Specimen Types ──────────────────────────────────────────

  @RequirePermission('lab.config.read')
  @Get('specimen-types')
  @ApiOperation({ summary: 'List specimen types' })
  async listSpecimenTypes(@Req() req: RequestWithAuth) {
    return this.svc.listSpecimenTypes(req.tenantId!);
  }

  @RequirePermission('lab.config.create')
  @Post('specimen-types')
  @ApiOperation({ summary: 'Create specimen type' })
  async createSpecimenType(@Req() req: RequestWithAuth, @Body() body: CreateLabSpecimenTypeRequest) {
    const parsed = CreateLabSpecimenTypeSchema.parse(body);
    return this.svc.createSpecimenType(req.tenantId!, parsed);
  }

  @RequirePermission('lab.config.delete')
  @Delete('specimen-types/:id')
  @ApiOperation({ summary: 'Delete specimen type' })
  async deleteSpecimenType(@Req() req: RequestWithAuth, @Param('id') id: string) {
    return this.svc.deleteSpecimenType(req.tenantId!, id);
  }

  // ── Configuration: Tests & Panels ──────────────────────────────────────────

  @RequirePermission('lab.config.read')
  @Get('tests')
  @ApiOperation({ summary: 'List lab tests' })
  async listTests(
    @Req() req: RequestWithAuth,
    @Query('isPanel') isPanel?: string,
    @Query('sectionId') sectionId?: string,
  ) {
    return this.svc.listTests(req.tenantId!, {
      isPanel: isPanel !== undefined ? isPanel === 'true' : undefined,
      sectionId,
    });
  }

  @RequirePermission('lab.config.read')
  @Get('tests/:id')
  @ApiOperation({ summary: 'Get lab test details' })
  async getTest(@Req() req: RequestWithAuth, @Param('id') id: string) {
    return this.svc.getTest(req.tenantId!, id);
  }

  @RequirePermission('lab.config.create')
  @Post('tests')
  @ApiOperation({ summary: 'Create lab test or panel' })
  async createTest(@Req() req: RequestWithAuth, @Body() body: CreateLabTestRequest) {
    const parsed = CreateLabTestSchema.parse(body);
    return this.svc.createTest(req.tenantId!, parsed);
  }

  @RequirePermission('lab.config.update')
  @Patch('tests/:id')
  @ApiOperation({ summary: 'Update lab test' })
  async updateTest(@Req() req: RequestWithAuth, @Param('id') id: string, @Body() body: UpdateLabTestRequest) {
    const parsed = UpdateLabTestSchema.parse(body);
    return this.svc.updateTest(req.tenantId!, id, parsed);
  }

  @RequirePermission('lab.config.delete')
  @Delete('tests/:id')
  @ApiOperation({ summary: 'Delete lab test' })
  async deleteTest(@Req() req: RequestWithAuth, @Param('id') id: string) {
    return this.svc.deleteTest(req.tenantId!, id);
  }

  // ── Configuration: Analytes ────────────────────────────────────────────────

  @RequirePermission('lab.config.read')
  @Get('tests/:id/analytes')
  @ApiOperation({ summary: 'List analytes for test' })
  async listAnalytes(@Req() req: RequestWithAuth, @Param('id') testId: string) {
    return this.svc.listAnalytes(req.tenantId!, testId);
  }

  @RequirePermission('lab.config.create')
  @Post('tests/:id/analytes')
  @ApiOperation({ summary: 'Add analyte to test' })
  async createAnalyte(
    @Req() req: RequestWithAuth,
    @Param('id') testId: string,
    @Body() body: CreateLabAnalyteRequest,
  ) {
    const parsed = CreateLabAnalyteSchema.parse(body);
    return this.svc.createAnalyte(req.tenantId!, testId, parsed);
  }

  @RequirePermission('lab.config.delete')
  @Delete('analytes/:id')
  @ApiOperation({ summary: 'Delete analyte' })
  async deleteAnalyte(@Req() req: RequestWithAuth, @Param('id') id: string) {
    return this.svc.deleteAnalyte(req.tenantId!, id);
  }

  // ── Configuration: Reference Ranges ────────────────────────────────────────

  @RequirePermission('lab.config.read')
  @Get('analytes/:id/ranges')
  @ApiOperation({ summary: 'List reference ranges for analyte' })
  async listReferenceRanges(@Req() req: RequestWithAuth, @Param('id') analyteId: string) {
    return this.svc.listReferenceRanges(req.tenantId!, analyteId);
  }

  @RequirePermission('lab.config.create')
  @Post('analytes/:id/ranges')
  @ApiOperation({ summary: 'Add reference range to analyte' })
  async createReferenceRange(
    @Req() req: RequestWithAuth,
    @Param('id') analyteId: string,
    @Body() body: CreateLabReferenceRangeRequest,
  ) {
    const parsed = CreateLabReferenceRangeSchema.parse(body);
    return this.svc.createReferenceRange(req.tenantId!, analyteId, parsed);
  }

  // ── Configuration: Delta Rules ─────────────────────────────────────────────

  @RequirePermission('lab.config.read')
  @Get('analytes/:id/delta-rules')
  @ApiOperation({ summary: 'Get delta check rule for analyte' })
  async listDeltaRules(@Req() req: RequestWithAuth, @Param('id') analyteId: string) {
    return this.svc.listDeltaRules(req.tenantId!, analyteId);
  }

  @RequirePermission('lab.config.create')
  @Post('analytes/:id/delta-rules')
  @ApiOperation({ summary: 'Create/update delta rule for analyte' })
  async createDeltaRule(
    @Req() req: RequestWithAuth,
    @Param('id') analyteId: string,
    @Body() body: CreateLabDeltaRuleRequest,
  ) {
    const parsed = CreateLabDeltaRuleSchema.parse(body);
    return this.svc.createDeltaRule(req.tenantId!, analyteId, parsed);
  }

  @RequirePermission('lab.config.delete')
  @Delete('analytes/delta-rules/:id')
  @ApiOperation({ summary: 'Delete delta rule' })
  async deleteDeltaRule(@Req() req: RequestWithAuth, @Param('id') id: string) {
    return this.svc.deleteDeltaRule(req.tenantId!, id);
  }

  // ── Configuration: Reagents BOM ────────────────────────────────────────────

  @RequirePermission('lab.config.read')
  @Get('tests/:id/reagents')
  @ApiOperation({ summary: 'Get reagent BOM for test' })
  async getTestReagents(@Req() req: RequestWithAuth, @Param('id') testId: string) {
    return this.svc.getTestReagents(req.tenantId!, testId);
  }

  @RequirePermission('lab.config.create')
  @Put('tests/:id/reagents')
  @ApiOperation({ summary: 'Set reagent BOM for test' })
  async setTestReagents(
    @Req() req: RequestWithAuth,
    @Param('id') testId: string,
    @Body() body: CreateLabTestReagentRequest[],
  ) {
    return this.svc.setTestReagents(req.tenantId!, testId, body);
  }

  // ── Configuration: Instruments ─────────────────────────────────────────────

  @RequirePermission('lab.config.read')
  @Get('instruments')
  @ApiOperation({ summary: 'List lab instruments' })
  async listInstruments(@Req() req: RequestWithAuth, @Query('branchId') branchId?: string) {
    return this.svc.listInstruments(req.tenantId!, branchId);
  }

  @RequirePermission('lab.config.create')
  @Post('instruments')
  @ApiOperation({ summary: 'Create lab instrument' })
  async createInstrument(@Req() req: RequestWithAuth, @Body() body: CreateLabInstrumentRequest) {
    const parsed = CreateLabInstrumentSchema.parse(body);
    return this.svc.createInstrument(req.tenantId!, parsed);
  }

  @RequirePermission('lab.config.delete')
  @Delete('instruments/:id')
  @ApiOperation({ summary: 'Delete lab instrument' })
  async deleteInstrument(@Req() req: RequestWithAuth, @Param('id') id: string) {
    return this.svc.deleteInstrument(req.tenantId!, id);
  }

  // ── Configuration: QC Materials ────────────────────────────────────────────

  @RequirePermission('lab.qc.read')
  @Get('qc-materials')
  @ApiOperation({ summary: 'List QC materials' })
  async listQcMaterials(@Req() req: RequestWithAuth, @Query('sectionId') sectionId?: string) {
    return this.svc.listQcMaterials(req.tenantId!, sectionId);
  }

  @RequirePermission('lab.qc.create')
  @Post('qc-materials')
  @ApiOperation({ summary: 'Create QC material' })
  async createQcMaterial(@Req() req: RequestWithAuth, @Body() body: CreateLabQcMaterialRequest) {
    const parsed = CreateLabQcMaterialSchema.parse(body);
    return this.svc.createQcMaterial(req.tenantId!, parsed);
  }

  // ── Configuration: Report Templates ────────────────────────────────────────

  @RequirePermission('lab.config.read')
  @Get('report-templates')
  @ApiOperation({ summary: 'List report templates' })
  async listReportTemplates(@Req() req: RequestWithAuth) {
    return this.svc.listReportTemplates(req.tenantId!);
  }

  @RequirePermission('lab.config.create')
  @Post('report-templates')
  @ApiOperation({ summary: 'Create report template' })
  async createReportTemplate(@Req() req: RequestWithAuth, @Body() body: CreateLabReportTemplateRequest) {
    const parsed = CreateLabReportTemplateSchema.parse(body);
    return this.svc.createReportTemplate(req.tenantId!, parsed);
  }

  // ── Worklist & Orders (LAB-T1) ──────────────────────────────────────────────

  @RequirePermission('lab.order.read')
  @Get('worklist')
  @ApiOperation({ summary: 'Laboratory primary worklist' })
  async getWorklist(
    @Req() req: RequestWithAuth,
    @Query('sectionId') sectionId?: string,
    @Query('priority') priority?: string,
    @Query('status') status?: string,
    @Query('ageHours') ageHours?: string,
  ) {
    return this.svc.getWorklist(req.tenantId!, {
      sectionId,
      priority,
      status,
      ageHours: ageHours ? Number(ageHours) : undefined,
    });
  }

  @RequirePermission('lab.order.read')
  @Get('orders')
  @ApiOperation({ summary: 'List lab orders' })
  async listOrders(
    @Req() req: RequestWithAuth,
    @Query('branchId') branchId?: string,
    @Query('status') status?: string,
  ) {
    return this.svc.listOrders(req.tenantId!, branchId, status);
  }

  @RequirePermission('lab.order.create')
  @Post('orders')
  @ApiOperation({ summary: 'Create lab order (expands panels)' })
  async createOrder(@Req() req: RequestWithAuth, @Body() body: CreateLabOrderRequest) {
    const parsed = CreateLabOrderSchema.parse(body);
    return this.svc.createOrder(req.tenantId!, req.authContext?.userId!, parsed);
  }

  @RequirePermission('lab.order.read')
  @Get('orders/:id')
  @ApiOperation({ summary: 'Get lab order details' })
  async getOrder(@Req() req: RequestWithAuth, @Param('id') id: string) {
    return this.svc.getOrder(req.tenantId!, id);
  }

  @RequirePermission('lab.order.create')
  @Post('orders/:id/cancel')
  @ApiOperation({ summary: 'Cancel lab order' })
  async cancelOrder(@Req() req: RequestWithAuth, @Param('id') id: string, @Body() body: CancelLabOrderRequest) {
    const parsed = CancelLabOrderSchema.parse(body);
    return this.svc.cancelOrder(req.tenantId!, id, req.authContext?.userId!, parsed.reason);
  }

  // ── Specimen Lifecycle (LAB-T2, LAB-T3) ────────────────────────────────────

  @RequirePermission('lab.specimen.collect')
  @Post('orders/:id/items/:iid/collect')
  @ApiOperation({ summary: 'Collect specimen for order item' })
  async collectSpecimen(
    @Req() req: RequestWithAuth,
    @Param('id') orderId: string,
    @Param('iid') itemId: string,
    @Body() body: CollectSpecimenRequest,
  ) {
    const parsed = CollectSpecimenSchema.parse(body);
    return this.svc.collectSpecimen(req.tenantId!, orderId, itemId, req.authContext?.userId!, parsed);
  }

  @RequirePermission('lab.specimen.receive')
  @Post('orders/:id/items/:iid/receive')
  @ApiOperation({ summary: 'Receive or reject specimen' })
  async receiveSpecimen(
    @Req() req: RequestWithAuth,
    @Param('id') orderId: string,
    @Param('iid') itemId: string,
    @Body() body: ReceiveSpecimenRequest,
  ) {
    const parsed = ReceiveSpecimenSchema.parse(body);
    return this.svc.receiveSpecimen(req.tenantId!, orderId, itemId, req.authContext?.userId!, parsed);
  }

  @RequirePermission('lab.result.enter')
  @Post('orders/:id/items/:iid/start')
  @ApiOperation({ summary: 'Start run on order item' })
  async startRun(
    @Req() req: RequestWithAuth,
    @Param('id') orderId: string,
    @Param('iid') itemId: string,
  ) {
    return this.svc.startRun(req.tenantId!, orderId, itemId, req.authContext?.userId!);
  }

  // ── Results & Verification (LAB-T4, LAB-T6, LAB-T9, AC-17) ─────────────────

  @RequirePermission('lab.result.read')
  @Get('orders/:id/items/:iid/results')
  @ApiOperation({ summary: 'Get results for order item' })
  async getItemResults(
    @Req() req: RequestWithAuth,
    @Param('id') orderId: string,
    @Param('iid') itemId: string,
    @Query('confidentialReason') confidentialReason?: string,
  ) {
    return this.svc.getItemResults(req.tenantId!, orderId, itemId, undefined, confidentialReason);
  }

  @RequirePermission('lab.result.enter')
  @Post('orders/:id/items/:iid/results')
  @ApiOperation({ summary: 'Enter results with auto-flags and delta check' })
  async enterResults(
    @Req() req: RequestWithAuth,
    @Param('id') orderId: string,
    @Param('iid') itemId: string,
    @Body() body: EnterLabResultsRequest,
  ) {
    const parsed = EnterLabResultsSchema.parse(body);
    return this.svc.enterResults(req.tenantId!, orderId, itemId, req.authContext?.userId!, parsed);
  }

  @RequirePermission('lab.result.verify')
  @Post('results/:rid/verify')
  @ApiOperation({ summary: 'Verify result (Enforces AC-17 SoD: encoder cannot verify)' })
  async verifyResult(
    @Req() req: RequestWithAuth,
    @Param('rid') resultId: string,
  ) {
    return this.svc.verifyResult(req.tenantId!, resultId, req.authContext?.userId!);
  }

  @RequirePermission('lab.result.amend')
  @Post('results/:rid/amend')
  @ApiOperation({ summary: 'Amend verified result (AC-11)' })
  async amendResult(
    @Req() req: RequestWithAuth,
    @Param('rid') resultId: string,
    @Body() body: AmendLabResultRequest,
  ) {
    const parsed = AmendLabResultSchema.parse(body);
    return this.svc.amendResult(req.tenantId!, resultId, req.authContext?.userId!, parsed);
  }

  @RequirePermission('lab.result.read')
  @Get('results/:rid/amendments')
  @ApiOperation({ summary: 'Get amendment history for result' })
  async getAmendments(@Req() req: RequestWithAuth, @Param('rid') resultId: string) {
    return this.svc.getAmendments(req.tenantId!, resultId);
  }

  // ── Critical Alerts (LAB-T7, AC-10) ────────────────────────────────────────

  @RequirePermission('lab.result.read')
  @Get('critical-alerts')
  @ApiOperation({ summary: 'List critical alert notifications' })
  async listCriticalAlerts(
    @Req() req: RequestWithAuth,
    @Query('acknowledged') acknowledged?: string,
  ) {
    return this.svc.listCriticalAlerts(
      req.tenantId!,
      acknowledged !== undefined ? acknowledged === 'true' : undefined,
    );
  }

  @RequirePermission('lab.critical.ack')
  @Post('critical-alerts/:id/acknowledge')
  @ApiOperation({ summary: 'Acknowledge critical alert with read-back (AC-10)' })
  async acknowledgeCriticalAlert(
    @Req() req: RequestWithAuth,
    @Param('id') alertId: string,
    @Body() body: AckCriticalNotificationRequest,
  ) {
    const parsed = AckCriticalNotificationSchema.parse(body);
    return this.svc.acknowledgeCriticalAlert(req.tenantId!, alertId, req.authContext?.userId!, parsed);
  }

  // ── Reports (LAB-T8) ───────────────────────────────────────────────────────

  @RequirePermission('lab.report.release')
  @Post('orders/:id/report')
  @ApiOperation({ summary: 'Release laboratory report with SHA-256 integrity hash' })
  async releaseReport(
    @Req() req: RequestWithAuth,
    @Param('id') orderId: string,
    @Body() body: ReleaseLabReportRequest,
  ) {
    const parsed = ReleaseLabReportSchema.parse(body);
    return this.svc.releaseReport(req.tenantId!, orderId, req.authContext?.userId!, parsed);
  }

  @RequirePermission('lab.report.read')
  @Get('orders/:id/reports')
  @ApiOperation({ summary: 'List reports for order' })
  async listReports(@Req() req: RequestWithAuth, @Param('id') orderId: string) {
    return this.svc.listReports(req.tenantId!, orderId);
  }

  @RequirePermission('lab.report.read')
  @Get('reports/:id')
  @ApiOperation({ summary: 'Get report details with hash' })
  async getReport(@Req() req: RequestWithAuth, @Param('id') id: string) {
    return this.svc.getReport(req.tenantId!, id);
  }

  @RequirePermission('lab.report.read')
  @Get('reports/:id/pdf')
  @ApiOperation({ summary: 'Download the stored, SHA-256 sealed laboratory report PDF' })
  async getReportPdf(
    @Req() req: RequestWithAuth,
    @Param('id') id: string,
    @Res() reply: FastifyReply,
  ) {
    const artifact = await this.svc.getReportArtifact(req.tenantId!, id);
    // A stored report is a sealed clinical document. Serve it only if the bytes
    // still hash to the digest recorded when it was issued, and always publish
    // that digest so the client can verify the copy it filed.
    const seal = artifact.sha256
      ? verifyDocument(artifact.bytes, artifact.sha256)
      : { valid: false, actualSha256: '' };
    if (!seal.valid) {
      throw new ProblemException('CONFLICT', {
        detail: artifact.sha256
          ? `The stored report PDF no longer matches its recorded SHA-256 seal. It has not been served. Expected ${artifact.sha256}, got ${seal.actualSha256}.`
          : 'The stored report PDF has no SHA-256 seal recorded, so it cannot be served as an official document.',
      });
    }
    void sendPdf(reply, { ...artifact, sha256: seal.actualSha256 }, artifact.fileName);
  }

  // ── Quality Control (QC) (LAB-T5) ──────────────────────────────────────────

  @RequirePermission('lab.qc.read')
  @Get('qc-runs')
  @ApiOperation({ summary: 'List QC runs' })
  async listQcRuns(@Req() req: RequestWithAuth, @Query('instrumentId') instrumentId?: string) {
    return this.svc.listQcRuns(req.tenantId!, instrumentId);
  }

  @RequirePermission('lab.qc.create')
  @Post('qc-runs')
  @ApiOperation({ summary: 'Record QC run with Westgard evaluation' })
  async createQcRun(@Req() req: RequestWithAuth, @Body() body: CreateLabQcRunRequest) {
    const parsed = CreateLabQcRunSchema.parse(body);
    return this.svc.createQcRun(req.tenantId!, req.authContext?.userId!, parsed);
  }

  // ── Send-outs (LAB-T11) ────────────────────────────────────────────────────

  @RequirePermission('lab.sendout.read')
  @Get('send-outs')
  @ApiOperation({ summary: 'List send-outs' })
  async listSendOuts(@Req() req: RequestWithAuth) {
    return this.svc.listSendOuts(req.tenantId!);
  }

  @RequirePermission('lab.sendout.create')
  @Post('send-outs')
  @ApiOperation({ summary: 'Create send-out referral' })
  async createSendOut(@Req() req: RequestWithAuth, @Body() body: CreateLabSendOutRequest) {
    const parsed = CreateLabSendOutSchema.parse(body);
    return this.svc.createSendOut(req.tenantId!, req.authContext?.userId!, parsed);
  }

  @RequirePermission('lab.sendout.update')
  @Post('send-outs/:id/result-received')
  @ApiOperation({ summary: 'Record result received for send-out' })
  async receiveSendOutResult(
    @Req() req: RequestWithAuth,
    @Param('id') id: string,
    @Body() body: ReceiveLabSendOutResultRequest,
  ) {
    const parsed = ReceiveLabSendOutResultSchema.parse(body);
    return this.svc.receiveSendOutResult(req.tenantId!, id, req.authContext?.userId!, parsed);
  }

  // ── Specimens Chain of Custody & TAT ───────────────────────────────────────

  @RequirePermission('lab.specimen.read')
  @Get('specimens')
  @ApiOperation({ summary: 'List specimens by accession' })
  async listSpecimens(@Req() req: RequestWithAuth, @Query('accession') accession?: string) {
    return this.svc.listSpecimens(req.tenantId!, accession);
  }

  @RequirePermission('lab.specimen.read')
  @Get('specimens/:id/events')
  @ApiOperation({ summary: 'Specimen chain of custody audit events' })
  async getSpecimenEvents(@Req() req: RequestWithAuth, @Param('id') id: string) {
    return this.svc.getSpecimenEvents(req.tenantId!, id);
  }

  @RequirePermission('lab.specimen.read')
  @Get('specimens/:id/label')
  @ApiOperation({ summary: 'Get formatted ZPL barcode label for a specimen' })
  async getSpecimenLabel(@Req() req: RequestWithAuth, @Param('id') id: string) {
    return this.svc.getSpecimenLabel(req.tenantId!, id);
  }

  @RequirePermission('lab.report.read')
  @Get('tat')
  @ApiOperation({ summary: 'Turnaround time metrics' })
  async getTatMetrics(@Req() req: RequestWithAuth) {
    return this.svc.getTatMetrics(req.tenantId!);
  }
}
