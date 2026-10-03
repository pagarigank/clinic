import { Inject, Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards, Req } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '../auth/guards/auth.guard.js';
import { TenantContextGuard } from '../auth/guards/tenant-context.guard.js';
import { Module } from '../rbac/module.guard.js';
import { RequirePermission } from '../rbac/require-permission.decorator.js';
import { PharmacyService } from './pharmacy.service.js';
import type { RequestWithAuth } from '../auth/auth-context.js';
import {
  CreateGenericNameSchema, type CreateGenericNameRequest,
  UpdateGenericNameSchema, type UpdateGenericNameRequest,
  CreateDrugProductSchema, type CreateDrugProductRequest,
  UpdateDrugProductSchema, type UpdateDrugProductRequest,
  CreateDrugInteractionSchema, type CreateDrugInteractionRequest,
  CreatePriceRuleSchema, type CreatePriceRuleRequest,
  VerifyPrescriptionSchema, type VerifyPrescriptionRequest,
  CreateInterventionSchema, type CreateInterventionRequest,
  RecordInteractionDecisionSchema, type RecordInteractionDecisionRequest,
  CreateDispenseSchema, type CreateDispenseRequest,
  PostDispenseSchema, type PostDispenseRequest,
  VoidDispenseSchema, type VoidDispenseRequest,
  CreateSpecialRxRecordSchema, type CreateSpecialRxRecordRequest,
  CreateOtcSaleSchema, type CreateOtcSaleRequest,
  CreateMedicationAdminSchema, type CreateMedicationAdminRequest,
  CreatePatientReturnSchema, type CreatePatientReturnRequest,
} from '@clinic/contracts';

function getRequestId(req: RequestWithAuth): string {
  return ((req as any).headers?.['x-request-id'] as string) ?? req.correlationId ?? `req-${Date.now()}`;
}

@ApiTags('Pharmacy')
@ApiBearerAuth()
@Controller('pharmacy')
@UseGuards(AuthGuard, TenantContextGuard)
@Module('pharmacy')
export class PharmacyController {
  constructor(
    @Inject(PharmacyService) private readonly svc: PharmacyService,
  ) {}

  // ── Generics (PHM-T1) ──────────────────────────────────────────────────────

  @RequirePermission('pharmacy.product.read')
  @Get('generics')
  @ApiOperation({ summary: 'List generic drug names' })
  async listGenerics(@Req() req: RequestWithAuth) {
    return this.svc.listGenerics(req.tenantId!);
  }

  @RequirePermission('pharmacy.product.read')
  @Get('generics/:id')
  @ApiOperation({ summary: 'Get generic drug name' })
  async getGeneric(@Req() req: RequestWithAuth, @Param('id') id: string) {
    return this.svc.getGeneric(req.tenantId!, id);
  }

  @RequirePermission('pharmacy.product.create')
  @Post('generics')
  @ApiOperation({ summary: 'Create generic drug name' })
  async createGeneric(@Req() req: RequestWithAuth, @Body() body: CreateGenericNameRequest) {
    const parsed = CreateGenericNameSchema.parse(body);
    return this.svc.createGeneric(req.tenantId!, parsed);
  }

  @RequirePermission('pharmacy.product.update')
  @Patch('generics/:id')
  @ApiOperation({ summary: 'Update generic drug name' })
  async updateGeneric(@Req() req: RequestWithAuth, @Param('id') id: string, @Body() body: UpdateGenericNameRequest) {
    const parsed = UpdateGenericNameSchema.parse(body);
    return this.svc.updateGeneric(req.tenantId!, id, parsed);
  }

  @RequirePermission('pharmacy.product.delete')
  @Delete('generics/:id')
  @ApiOperation({ summary: 'Delete generic drug name' })
  async deleteGeneric(@Req() req: RequestWithAuth, @Param('id') id: string) {
    return this.svc.deleteGeneric(req.tenantId!, id);
  }

  // ── Drug Products (PHM-T1) ─────────────────────────────────────────────────

  @RequirePermission('pharmacy.product.read')
  @Get('products')
  @ApiOperation({ summary: 'List drug products' })
  async listProducts(@Req() req: RequestWithAuth) {
    return this.svc.listProducts(req.tenantId!);
  }

  @RequirePermission('pharmacy.product.read')
  @Get('products/:id')
  @ApiOperation({ summary: 'Get drug product details' })
  async getProduct(@Req() req: RequestWithAuth, @Param('id') id: string) {
    return this.svc.getProduct(req.tenantId!, id);
  }

  @RequirePermission('pharmacy.product.create')
  @Post('products')
  @ApiOperation({ summary: 'Create drug product (auto-creates items master)' })
  async createProduct(@Req() req: RequestWithAuth, @Body() body: CreateDrugProductRequest) {
    const parsed = CreateDrugProductSchema.parse(body);
    return this.svc.createProduct(req.tenantId!, parsed);
  }

  @RequirePermission('pharmacy.product.update')
  @Patch('products/:id')
  @ApiOperation({ summary: 'Update drug product' })
  async updateProduct(@Req() req: RequestWithAuth, @Param('id') id: string, @Body() body: UpdateDrugProductRequest) {
    const parsed = UpdateDrugProductSchema.parse(body);
    return this.svc.updateProduct(req.tenantId!, id, parsed);
  }

  @RequirePermission('pharmacy.product.delete')
  @Delete('products/:id')
  @ApiOperation({ summary: 'Delete drug product' })
  async deleteProduct(@Req() req: RequestWithAuth, @Param('id') id: string) {
    return this.svc.deleteProduct(req.tenantId!, id);
  }

  // ── Drug Interactions (PHM-T1) ─────────────────────────────────────────────

  @RequirePermission('pharmacy.product.read')
  @Get('interactions')
  @ApiOperation({ summary: 'List drug interactions with tenant overrides' })
  async listInteractions(@Req() req: RequestWithAuth) {
    return this.svc.listInteractions(req.tenantId!);
  }

  @RequirePermission('pharmacy.product.create')
  @Post('interactions')
  @ApiOperation({ summary: 'Create or override drug interaction rule' })
  async createInteraction(@Req() req: RequestWithAuth, @Body() body: CreateDrugInteractionRequest) {
    const parsed = CreateDrugInteractionSchema.parse(body);
    return this.svc.createInteraction(req.tenantId!, parsed);
  }

  @RequirePermission('pharmacy.product.delete')
  @Delete('interactions/:id')
  @ApiOperation({ summary: 'Delete drug interaction rule' })
  async deleteInteraction(@Req() req: RequestWithAuth, @Param('id') id: string) {
    return this.svc.deleteInteraction(req.tenantId!, id);
  }

  // ── Price Rules (PHM-T2) ───────────────────────────────────────────────────

  @RequirePermission('pharmacy.price.read')
  @Get('price-rules')
  @ApiOperation({ summary: 'List pharmacy pricing rules' })
  async listPriceRules(@Req() req: RequestWithAuth, @Query('itemId') itemId?: string) {
    return this.svc.listPriceRules(req.tenantId!, itemId);
  }

  @RequirePermission('pharmacy.price.create')
  @Post('price-rules')
  @ApiOperation({ summary: 'Create pharmacy pricing rule' })
  async createPriceRule(@Req() req: RequestWithAuth, @Body() body: CreatePriceRuleRequest) {
    const parsed = CreatePriceRuleSchema.parse(body);
    return this.svc.createPriceRule(req.tenantId!, parsed);
  }

  // ── Verification Queue & Automated Checks (PHM-T1) ─────────────────────────

  @RequirePermission('pharmacy.rx.read')
  @Get('queue')
  @ApiOperation({ summary: 'List prescriptions in verification queue' })
  async getQueue(@Req() req: RequestWithAuth, @Query('status') status?: string) {
    return this.svc.getVerificationQueue(req.tenantId!, status || 'ISSUED');
  }

  @RequirePermission('pharmacy.rx.verify')
  @Get('prescriptions/:id/checks')
  @ApiOperation({ summary: 'Run automated safety and interaction checks for prescription' })
  async getChecks(@Req() req: RequestWithAuth, @Param('id') id: string) {
    return this.svc.runPrescriptionChecks(req.tenantId!, id);
  }

  @RequirePermission('pharmacy.rx.verify')
  @Post('prescriptions/:id/verify')
  @ApiOperation({ summary: 'Verify, intervene, or reject prescription' })
  async verifyPrescription(
    @Req() req: RequestWithAuth,
    @Param('id') id: string,
    @Body() body: VerifyPrescriptionRequest,
  ) {
    const parsed = VerifyPrescriptionSchema.parse(body);
    return this.svc.verifyPrescription(req.tenantId!, req.authContext!.userId!, id, parsed);
  }

  @RequirePermission('pharmacy.rx.verify')
  @Post('prescriptions/:id/intervention')
  @ApiOperation({ summary: 'Record pharmacist intervention on prescription' })
  async createIntervention(
    @Req() req: RequestWithAuth,
    @Param('id') id: string,
    @Body() body: CreateInterventionRequest,
  ) {
    const parsed = CreateInterventionSchema.parse(body);
    return this.svc.verifyPrescription(req.tenantId!, req.authContext!.userId!, id, {
      action: 'INTERVENE',
      interventionType: parsed.type,
      description: parsed.description,
      outcome: parsed.outcome,
    });
  }

  @RequirePermission('pharmacy.rx.verify')
  @Post('interaction-decisions')
  @ApiOperation({ summary: 'Audit interaction alert decision' })
  async recordInteractionDecision(
    @Req() req: RequestWithAuth,
    @Body() body: RecordInteractionDecisionRequest,
  ) {
    const parsed = RecordInteractionDecisionSchema.parse(body);
    return this.svc.recordInteractionDecision(req.tenantId!, req.authContext!.userId!, parsed);
  }

  @RequirePermission('pharmacy.rx.read')
  @Get('interaction-decisions')
  @ApiOperation({ summary: 'List audited interaction alert decisions' })
  async listInteractionDecisions(@Req() req: RequestWithAuth, @Query('rxId') rxId?: string) {
    return this.svc.listInteractionDecisions(req.tenantId!, rxId);
  }

  // ── Dispensing (PHM-T2, PHM-T4, AC-7) ──────────────────────────────────────

  @RequirePermission('pharmacy.rx.read')
  @Get('dispenses')
  @ApiOperation({ summary: 'List dispenses' })
  async listDispenses(
    @Req() req: RequestWithAuth,
    @Query('rxId') rxId?: string,
    @Query('patientId') patientId?: string,
    @Query('status') status?: string,
  ) {
    return this.svc.listDispenses(req.tenantId!, { rxId, patientId, status });
  }

  @RequirePermission('pharmacy.dispense.read')
  @Get('dispenses/:id')
  @ApiOperation({ summary: 'Get dispense order with items' })
  async getDispense(@Req() req: RequestWithAuth, @Param('id') id: string) {
    return this.svc.getDispense(req.tenantId!, id);
  }

  @RequirePermission('pharmacy.dispense.create')
  @Post('dispenses')
  @ApiOperation({ summary: 'Create draft dispense order' })
  async createDispense(@Req() req: RequestWithAuth, @Body() body: CreateDispenseRequest) {
    const parsed = CreateDispenseSchema.parse(body);
    return this.svc.createDispense(req.tenantId!, req.authContext!.userId!, parsed);
  }

  @RequirePermission('pharmacy.dispense.create')
  @Post('dispenses/:id/allocate')
  @ApiOperation({ summary: 'Allocate FEFO batches for dispense lines' })
  async allocateFefo(
    @Req() req: RequestWithAuth,
    @Param('id') id: string,
    @Body('locationId') locationId: string,
  ) {
    return this.svc.allocateFefo(req.tenantId!, id, locationId);
  }

  @RequirePermission('pharmacy.dispense.post')
  @Post('dispenses/:id/post')
  @ApiOperation({ summary: 'Post dispense (movements + balances + charges + Rx status in one transaction)' })
  async postDispense(
    @Req() req: RequestWithAuth,
    @Param('id') id: string,
    @Body() body: PostDispenseRequest,
  ) {
    const parsed = PostDispenseSchema.parse(body);
    const requestId = getRequestId(req);
    return this.svc.postDispense(req.tenantId!, req.authContext!.userId!, requestId, id, parsed);
  }

  @RequirePermission('pharmacy.dispense.void')
  @Post('dispenses/:id/void')
  @ApiOperation({ summary: 'Void dispense with reversal movements and controlled register adjustments' })
  async voidDispense(
    @Req() req: RequestWithAuth,
    @Param('id') id: string,
    @Body() body: VoidDispenseRequest,
  ) {
    const parsed = VoidDispenseSchema.parse(body);
    const requestId = getRequestId(req);
    return this.svc.voidDispense(req.tenantId!, req.authContext!.userId!, requestId, id, parsed);
  }

  @RequirePermission('pharmacy.dispense.read')
  @Get('dispenses/:id/label')
  @ApiOperation({ summary: 'Get formatted Rx label data for printing' })
  async getDispenseLabel(@Req() req: RequestWithAuth, @Param('id') id: string) {
    return this.svc.getDispenseLabel(req.tenantId!, id);
  }

  // ── OTC Sales (PHM-T3) ─────────────────────────────────────────────────────

  @RequirePermission('pharmacy.sale.create')
  @Post('sales')
  @ApiOperation({ summary: 'Process OTC walk-in sale (hard rejection of controlled items)' })
  async createOtcSale(@Req() req: RequestWithAuth, @Body() body: CreateOtcSaleRequest) {
    const parsed = CreateOtcSaleSchema.parse(body);
    const requestId = getRequestId(req);
    return this.svc.createAndPostOtcSale(req.tenantId!, req.authContext!.userId!, requestId, parsed);
  }

  // ── In-Clinic Medication Administration (PHM-T6) ───────────────────────────

  @RequirePermission('pharmacy.admin.create')
  @Get('administrations')
  @ApiOperation({ summary: 'List in-clinic medication administrations' })
  async listAdministrations(@Req() req: RequestWithAuth, @Query('visitId') visitId?: string) {
    return this.svc.listMedicationAdministrations(req.tenantId!, visitId);
  }

  @RequirePermission('pharmacy.admin.create')
  @Post('administrations')
  @ApiOperation({ summary: 'Record in-clinic medication administration with CONSUMPTION movement' })
  async recordAdministration(@Req() req: RequestWithAuth, @Body() body: CreateMedicationAdminRequest) {
    const parsed = CreateMedicationAdminSchema.parse(body);
    const requestId = getRequestId(req);
    return this.svc.recordMedicationAdministration(req.tenantId!, req.authContext!.userId!, requestId, parsed);
  }

  // ── Patient Returns (PHM-T5) ───────────────────────────────────────────────

  @RequirePermission('pharmacy.return.create')
  @Post('returns')
  @ApiOperation({ summary: 'Process patient drug return with disposition' })
  async recordReturn(@Req() req: RequestWithAuth, @Body() body: CreatePatientReturnRequest) {
    const parsed = CreatePatientReturnSchema.parse(body);
    const requestId = getRequestId(req);
    return this.svc.recordPatientReturn(req.tenantId!, req.authContext!.userId!, requestId, parsed);
  }

  // ── Special Rx Records (AC-7) ──────────────────────────────────────────────

  @RequirePermission('pharmacy.controlled.read')
  @Get('special-rx')
  @ApiOperation({ summary: 'List special Rx records' })
  async listSpecialRx(@Req() req: RequestWithAuth) {
    return this.svc.listSpecialRxRecords(req.tenantId!);
  }

  @RequirePermission('pharmacy.controlled.write')
  @Post('special-rx')
  @ApiOperation({ summary: 'Record new special Rx yellow slip' })
  async createSpecialRx(@Req() req: RequestWithAuth, @Body() body: CreateSpecialRxRecordRequest) {
    const parsed = CreateSpecialRxRecordSchema.parse(body);
    return this.svc.createSpecialRxRecord(req.tenantId!, parsed);
  }

  // ── Controlled Register & Stock (PHM-T4, PHM-T9, RPT-PHM-03) ───────────────

  @RequirePermission('pharmacy.controlled.read')
  @Get('controlled-register')
  @ApiOperation({ summary: 'Append-only Dangerous Drugs Book register entries' })
  async getControlledRegister(
    @Req() req: RequestWithAuth,
    @Query('drugItemId') drugItemId?: string,
    @Query('branchId') branchId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.svc.getControlledRegister(req.tenantId!, { drugItemId, branchId, from, to });
  }

  @RequirePermission('pharmacy.controlled.read')
  @Get('controlled-register/balance/:drugItemId')
  @ApiOperation({ summary: 'Get current running balance and reconciliation status for controlled drug' })
  async getControlledBalance(
    @Req() req: RequestWithAuth,
    @Param('drugItemId') drugItemId: string,
    @Query('branchId') branchId?: string,
  ) {
    return this.svc.getControlledBalance(req.tenantId!, drugItemId, branchId);
  }

  @RequirePermission('pharmacy.stock.read')
  @Get('stock')
  @ApiOperation({ summary: 'Pharmacy stock view by batch with valuation and near-expiry' })
  async getPharmacyStock(
    @Req() req: RequestWithAuth,
    @Query('itemId') itemId?: string,
    @Query('locationId') locationId?: string,
    @Query('nearExpiry') nearExpiry?: string,
  ) {
    return this.svc.getPharmacyStock(req.tenantId!, {
      itemId,
      locationId,
      nearExpiry: nearExpiry === 'true',
    });
  }
}
