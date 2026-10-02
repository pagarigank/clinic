import { Controller, Get, Post, Patch, Put, Body, Param, Query, UseGuards, Req } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '../auth/guards/auth.guard.js';
import { TenantContextGuard } from '../auth/guards/tenant-context.guard.js';
import { Module } from '../rbac/module.guard.js';
import { RequirePermission } from '../rbac/require-permission.decorator.js';
import { SupplyService } from './supply.service.js';
import type { RequestWithAuth } from '../auth/auth-context.js';
import {
  CreateItemCategorySchema, type CreateItemCategoryRequest,
  CreateUomSchema, type CreateUomRequest,
  CreateUomConversionSchema, type CreateUomConversionRequest,
  CreateItemSchema, type CreateItemRequest,
  UpdateItemSchema, type UpdateItemRequest,
  CreateItemBarcodeSchema, type CreateItemBarcodeRequest,
  CreateSupplierSchema, type CreateSupplierRequest,
  UpdateSupplierSchema, type UpdateSupplierRequest,
  CreateSupplierItemSchema, type CreateSupplierItemRequest,
  CreateStockLocationSchema, type CreateStockLocationRequest,
  UpdateLocationItemParamsSchema, type UpdateLocationItemParamsRequest,
  PostMovementSchema, type PostMovementRequest,
  PostConsumptionSchema, type PostConsumptionRequest,
  PeriodActionSchema, type PeriodActionRequest,
  QuarantineBatchSchema, type QuarantineBatchRequest,
  ReleaseBatchSchema, type ReleaseBatchRequest,
  CreatePrSchema, type CreatePrRequest,
  ConvertPrToPoSchema, type ConvertPrToPoRequest,
  CreatePoSchema, type CreatePoRequest,
  CreateGrnSchema, type CreateGrnRequest,
  VoidGrnSchema, type VoidGrnRequest,
  CreateRequisitionSchema, type CreateRequisitionRequest,
  CreateIssueSchema, type CreateIssueRequest,
  AcknowledgeRequisitionSchema, type AcknowledgeRequisitionRequest,
  CreateAdjustmentSchema, type CreateAdjustmentRequest,
  CreateCountSchema, type CreateCountRequest,
  EnterCountLinesSchema, type EnterCountLinesRequest,
  CreateDisposalSchema, type CreateDisposalRequest,
  CreateRecallSchema, type CreateRecallRequest,
  CloseRecallSchema, type CloseRecallRequest,
  BulkImportLocationParamsSchema, type BulkImportLocationParamsRequest,
  CreateSupplierInvoiceSchema, type CreateSupplierInvoiceRequest,
  CreateSupplierReturnSchema, type CreateSupplierReturnRequest,
} from '@clinic/contracts';

function getRequestId(req: RequestWithAuth): string {
  return ((req as any).headers?.['x-request-id'] as string) ?? req.correlationId ?? `req-${Date.now()}`;
}

@ApiTags('Supply')
@ApiBearerAuth()
@Controller('supply')
@UseGuards(AuthGuard, TenantContextGuard)
@Module('supply')
export class SupplyController {
  constructor(private readonly svc: SupplyService) {}

  // ── Masters: Categories, UOMs, Items ──────────────────────────────────────

  @RequirePermission('supply.item.read')
  @Get('categories')
  @ApiOperation({ summary: 'List item categories' })
  async listCategories(@Req() req: RequestWithAuth) {
    return this.svc.listCategories(req.tenantId!);
  }

  @RequirePermission('supply.item.create')
  @Post('categories')
  @ApiOperation({ summary: 'Create item category' })
  async createCategory(@Req() req: RequestWithAuth, @Body() body: CreateItemCategoryRequest) {
    const parsed = CreateItemCategorySchema.parse(body);
    return this.svc.createCategory(req.tenantId!, parsed);
  }

  @RequirePermission('supply.item.read')
  @Get('uoms')
  @ApiOperation({ summary: 'List units of measure' })
  async listUoms(@Req() req: RequestWithAuth) {
    return this.svc.listUoms(req.tenantId!);
  }

  @RequirePermission('supply.item.create')
  @Post('uoms')
  @ApiOperation({ summary: 'Create unit of measure' })
  async createUom(@Req() req: RequestWithAuth, @Body() body: CreateUomRequest) {
    const parsed = CreateUomSchema.parse(body);
    return this.svc.createUom(req.tenantId!, parsed);
  }

  @RequirePermission('supply.item.create')
  @Post('uoms/conversions')
  @ApiOperation({ summary: 'Create UOM conversion' })
  async createUomConversion(@Req() req: RequestWithAuth, @Body() body: CreateUomConversionRequest) {
    const parsed = CreateUomConversionSchema.parse(body);
    return this.svc.createUomConversion(req.tenantId!, parsed);
  }

  @RequirePermission('supply.item.read')
  @Get('items')
  @ApiOperation({ summary: 'List items' })
  async listItems(
    @Req() req: RequestWithAuth,
    @Query('itemType') itemType?: string,
    @Query('search') search?: string,
  ) {
    return this.svc.listItems(req.tenantId!, { itemType, search });
  }

  @RequirePermission('supply.item.read')
  @Get('items/:id')
  @ApiOperation({ summary: 'Get item detail' })
  async getItem(@Req() req: RequestWithAuth, @Param('id') id: string) {
    return this.svc.getItem(req.tenantId!, id);
  }

  @RequirePermission('supply.item.create')
  @Post('items')
  @ApiOperation({ summary: 'Create item' })
  async createItem(@Req() req: RequestWithAuth, @Body() body: CreateItemRequest) {
    const parsed = CreateItemSchema.parse(body);
    return this.svc.createItem(req.tenantId!, parsed);
  }

  @RequirePermission('supply.item.update')
  @Patch('items/:id')
  @ApiOperation({ summary: 'Update item' })
  async updateItem(@Req() req: RequestWithAuth, @Param('id') id: string, @Body() body: UpdateItemRequest) {
    const parsed = UpdateItemSchema.parse(body);
    return this.svc.updateItem(req.tenantId!, id, parsed);
  }

  @RequirePermission('supply.item.create')
  @Post('barcodes')
  @ApiOperation({ summary: 'Create item barcode' })
  async createBarcode(@Req() req: RequestWithAuth, @Body() body: CreateItemBarcodeRequest) {
    const parsed = CreateItemBarcodeSchema.parse(body);
    return this.svc.createItemBarcode(req.tenantId!, parsed);
  }

  // ── Masters: Suppliers ─────────────────────────────────────────────────────

  @RequirePermission('supply.supplier.read')
  @Get('suppliers')
  @ApiOperation({ summary: 'List suppliers' })
  async listSuppliers(@Req() req: RequestWithAuth) {
    return this.svc.listSuppliers(req.tenantId!);
  }

  @RequirePermission('supply.supplier.create')
  @Post('suppliers')
  @ApiOperation({ summary: 'Create supplier' })
  async createSupplier(@Req() req: RequestWithAuth, @Body() body: CreateSupplierRequest) {
    const parsed = CreateSupplierSchema.parse(body);
    return this.svc.createSupplier(req.tenantId!, parsed);
  }

  @RequirePermission('supply.supplier.update')
  @Patch('suppliers/:id')
  @ApiOperation({ summary: 'Update supplier' })
  async updateSupplier(@Req() req: RequestWithAuth, @Param('id') id: string, @Body() body: UpdateSupplierRequest) {
    const parsed = UpdateSupplierSchema.parse(body);
    return this.svc.updateSupplier(req.tenantId!, id, parsed);
  }

  @RequirePermission('supply.supplier.create')
  @Post('suppliers/items')
  @ApiOperation({ summary: 'Map supplier item & price' })
  async createSupplierItem(@Req() req: RequestWithAuth, @Body() body: CreateSupplierItemRequest) {
    const parsed = CreateSupplierItemSchema.parse(body);
    return this.svc.createSupplierItem(req.tenantId!, parsed);
  }

  @RequirePermission('supply.supplier.read')
  @Get('suppliers/:id/items')
  @ApiOperation({ summary: 'List catalog for supplier' })
  async listSupplierItems(@Req() req: RequestWithAuth, @Param('id') supplierId: string) {
    return this.svc.listSupplierItems(req.tenantId!, supplierId);
  }

  // ── Masters: Locations & Params ────────────────────────────────────────────

  @RequirePermission('supply.location.read')
  @Get('locations')
  @ApiOperation({ summary: 'List stock locations' })
  async listLocations(@Req() req: RequestWithAuth, @Query('branchId') branchId?: string) {
    return this.svc.listLocations(req.tenantId!, branchId);
  }

  @RequirePermission('supply.location.create')
  @Post('locations')
  @ApiOperation({ summary: 'Create stock location' })
  async createLocation(@Req() req: RequestWithAuth, @Body() body: CreateStockLocationRequest) {
    const parsed = CreateStockLocationSchema.parse(body);
    return this.svc.createLocation(req.tenantId!, parsed);
  }

  @RequirePermission('supply.location.update')
  @Put('locations/params')
  @ApiOperation({ summary: 'Set min/max/par parameters per location/item' })
  async updateLocationParams(@Req() req: RequestWithAuth, @Body() body: UpdateLocationItemParamsRequest) {
    const parsed = UpdateLocationItemParamsSchema.parse(body);
    return this.svc.updateLocationParams(req.tenantId!, parsed);
  }

  @RequirePermission('supply.location.update')
  @Post('locations/params/bulk-csv')
  @ApiOperation({ summary: 'Bulk CSV import of location item params with error report' })
  async bulkImportLocationParams(@Req() req: RequestWithAuth, @Body() body: BulkImportLocationParamsRequest) {
    const parsed = BulkImportLocationParamsSchema.parse(body);
    return this.svc.importLocationParamsCsv(req.tenantId!, parsed.csvContent);
  }

  @RequirePermission('supply.location.delete')
  @Post('locations/:id/archive')
  @ApiOperation({ summary: 'Archive stock location (guarded: requires zero stock balances)' })
  async archiveLocation(@Req() req: RequestWithAuth, @Param('id') id: string) {
    return this.svc.archiveLocation(req.tenantId!, id);
  }


  // ── Periods & Period Lock (SUP-T13, AC-20) ──────────────────────────────────

  @RequirePermission('supply.period.lock')
  @Post('periods/lock')
  @ApiOperation({ summary: 'Lock accounting period' })
  async lockPeriod(@Req() req: RequestWithAuth, @Body() body: PeriodActionRequest) {
    const parsed = PeriodActionSchema.parse(body);
    return this.svc.lockPeriod(req.tenantId!, req.authContext!.userId!, parsed);
  }

  @RequirePermission('supply.period.unlock')
  @Post('periods/unlock')
  @ApiOperation({ summary: 'Unlock accounting period' })
  async unlockPeriod(@Req() req: RequestWithAuth, @Body() body: PeriodActionRequest) {
    const parsed = PeriodActionSchema.parse(body);
    return this.svc.unlockPeriod(req.tenantId!, req.authContext!.userId!, parsed);
  }

  // ── Batches ────────────────────────────────────────────────────────────────

  @RequirePermission('supply.stock.read')
  @Get('batches/:id')
  @ApiOperation({ summary: 'Get batch detail' })
  async getBatch(@Req() req: RequestWithAuth, @Param('id') id: string) {
    return this.svc.getBatch(req.tenantId!, id);
  }

  @RequirePermission('supply.batch.quarantine')
  @Post('batches/:id/quarantine')
  @ApiOperation({ summary: 'Quarantine stock batch' })
  async quarantineBatch(@Req() req: RequestWithAuth, @Param('id') id: string, @Body() body: QuarantineBatchRequest) {
    const parsed = QuarantineBatchSchema.parse(body);
    return this.svc.quarantineBatch(req.tenantId!, id, parsed);
  }

  @RequirePermission('supply.batch.release')
  @Post('batches/:id/release')
  @ApiOperation({ summary: 'Release quarantined stock batch' })
  async releaseBatch(@Req() req: RequestWithAuth, @Param('id') id: string, @Body() body: ReleaseBatchRequest) {
    const parsed = ReleaseBatchSchema.parse(body);
    return this.svc.releaseBatch(req.tenantId!, id, parsed);
  }

  // ── Movements & Consumption ────────────────────────────────────────────────

  @RequirePermission('supply.stock.read')
  @Post('movements')
  @ApiOperation({ summary: 'Post stock movement' })
  async postMovement(@Req() req: RequestWithAuth, @Body() body: PostMovementRequest) {
    const parsed = PostMovementSchema.parse(body);
    const requestId = getRequestId(req);
    return this.svc.postMovement(req.tenantId!, req.authContext!.userId!, requestId, parsed);
  }

  @RequirePermission('supply.consumption.create')
  @Post('consumption')
  @ApiOperation({ summary: 'Post stock consumption (FEFO / procedure / house use)' })
  async postConsumption(@Req() req: RequestWithAuth, @Body() body: PostConsumptionRequest) {
    const parsed = PostConsumptionSchema.parse(body);
    const requestId = getRequestId(req);
    return this.svc.postConsumption(req.tenantId!, req.authContext!.userId!, requestId, parsed);
  }

  // ── Goods Receipts (GRN) & Receiving (SUP-T2, AC-8) ─────────────────────────

  @RequirePermission('supply.grn.read')
  @Get('goods-receipts')
  @ApiOperation({ summary: 'List goods receipts' })
  async listGoodsReceipts(@Req() req: RequestWithAuth, @Query('status') status?: string) {
    return this.svc.listGoodsReceipts(req.tenantId!, { status });
  }

  @RequirePermission('supply.grn.read')
  @Get('goods-receipts/:id')
  @ApiOperation({ summary: 'Get goods receipt detail' })
  async getGoodsReceipt(@Req() req: RequestWithAuth, @Param('id') id: string) {
    return this.svc.getGoodsReceipt(req.tenantId!, id);
  }

  @RequirePermission('supply.grn.create')
  @Post('goods-receipts')
  @ApiOperation({ summary: 'Create goods receipt draft' })
  async createGrn(@Req() req: RequestWithAuth, @Body() body: CreateGrnRequest) {
    const parsed = CreateGrnSchema.parse(body);
    return this.svc.createGrn(req.tenantId!, req.authContext!.userId!, parsed);
  }

  @RequirePermission('supply.grn.post')
  @Post('goods-receipts/:id/post')
  @ApiOperation({ summary: 'Post goods receipt (GRN) into ledger & balances' })
  async postGrn(@Req() req: RequestWithAuth, @Param('id') id: string) {
    const requestId = getRequestId(req);
    return this.svc.postGrn(req.tenantId!, req.authContext!.userId!, requestId, id);
  }

  @RequirePermission('supply.grn.void')
  @Post('goods-receipts/:id/void')
  @ApiOperation({ summary: 'Void goods receipt (reversal movement)' })
  async voidGrn(@Req() req: RequestWithAuth, @Param('id') id: string, @Body() body: VoidGrnRequest) {
    const parsed = VoidGrnSchema.parse(body);
    const requestId = getRequestId(req);
    return this.svc.voidGrn(req.tenantId!, req.authContext!.userId!, requestId, id, parsed);
  }

  // ── Purchase Requests (PR) & Purchase Orders (PO) ──────────────────────────

  @RequirePermission('supply.pr.read')
  @Get('purchase-requests')
  @ApiOperation({ summary: 'List purchase requests' })
  async listPurchaseRequests(@Req() req: RequestWithAuth) {
    return this.svc.listPurchaseRequests(req.tenantId!);
  }

  @RequirePermission('supply.pr.create')
  @Post('purchase-requests')
  @ApiOperation({ summary: 'Create purchase request' })
  async createPurchaseRequest(@Req() req: RequestWithAuth, @Body() body: CreatePrRequest) {
    const parsed = CreatePrSchema.parse(body);
    return this.svc.createPurchaseRequest(req.tenantId!, req.authContext!.userId!, parsed);
  }

  @RequirePermission('supply.pr.submit')
  @Post('purchase-requests/:id/submit')
  @ApiOperation({ summary: 'Submit purchase request' })
  async submitPurchaseRequest(@Req() req: RequestWithAuth, @Param('id') id: string) {
    return this.svc.submitPurchaseRequest(req.tenantId!, id);
  }

  @RequirePermission('supply.pr.approve')
  @Post('purchase-requests/:id/approve')
  @ApiOperation({ summary: 'Approve purchase request' })
  async approvePurchaseRequest(@Req() req: RequestWithAuth, @Param('id') id: string) {
    return this.svc.approvePurchaseRequest(req.tenantId!, req.authContext!.userId!, id);
  }

  @RequirePermission('supply.pr.convert')
  @Post('purchase-requests/:id/convert-to-po')
  @ApiOperation({ summary: 'Convert PR to PO' })
  async convertPrToPo(@Req() req: RequestWithAuth, @Param('id') id: string, @Body() body: ConvertPrToPoRequest) {
    const parsed = ConvertPrToPoSchema.parse(body);
    return this.svc.convertPrToPo(req.tenantId!, req.authContext!.userId!, id, parsed);
  }

  @RequirePermission('supply.po.read')
  @Get('purchase-orders')
  @ApiOperation({ summary: 'List purchase orders' })
  async listPurchaseOrders(@Req() req: RequestWithAuth) {
    return this.svc.listPurchaseOrders(req.tenantId!);
  }

  @RequirePermission('supply.po.create')
  @Post('purchase-orders')
  @ApiOperation({ summary: 'Create purchase order draft' })
  async createPo(@Req() req: RequestWithAuth, @Body() body: CreatePoRequest) {
    const parsed = CreatePoSchema.parse(body);
    return this.svc.createPo(req.tenantId!, req.authContext!.userId!, parsed);
  }

  @RequirePermission('supply.po.submit')
  @Post('purchase-orders/:id/submit')
  @ApiOperation({ summary: 'Submit purchase order for approval' })
  async submitPo(@Req() req: RequestWithAuth, @Param('id') id: string) {
    return this.svc.submitPo(req.tenantId!, id);
  }

  @RequirePermission('supply.po.approve')
  @Post('purchase-orders/:id/approve')
  @ApiOperation({ summary: 'Approve purchase order (SoD enforced)' })
  async approvePo(@Req() req: RequestWithAuth, @Param('id') id: string) {
    return this.svc.approvePo(req.tenantId!, req.authContext!.userId!, id);
  }

  @RequirePermission('supply.po.send')
  @Post('purchase-orders/:id/send')
  @ApiOperation({ summary: 'Send purchase order to supplier' })
  async sendPo(@Req() req: RequestWithAuth, @Param('id') id: string) {
    return this.svc.sendPo(req.tenantId!, id);
  }

  @RequirePermission('supply.po.approve')
  @Post('purchase-orders/:id/close')
  @ApiOperation({ summary: 'Close purchase order' })
  async closePo(@Req() req: RequestWithAuth, @Param('id') id: string) {
    return this.svc.closePo(req.tenantId!, id);
  }

  // ── Supplier Invoices & 3-Way Match (SUP-T2, todo §4.3) ──────────────────────

  @RequirePermission('supply.invoice.match')
  @Post('supplier-invoices')
  @ApiOperation({ summary: 'Record and match supplier invoice (3-way match, SoD enforced)' })
  async createSupplierInvoice(@Req() req: RequestWithAuth, @Body() body: CreateSupplierInvoiceRequest) {
    const parsed = CreateSupplierInvoiceSchema.parse(body);
    return this.svc.createSupplierInvoice(req.tenantId!, req.authContext!.userId!, parsed);
  }

  @RequirePermission('supply.invoice.read')
  @Get('supplier-invoices')
  @ApiOperation({ summary: 'List supplier invoices' })
  async listSupplierInvoices(@Req() req: RequestWithAuth) {
    return this.svc.listSupplierInvoices(req.tenantId!);
  }

  // ── Supplier Returns (SUP-T7, todo §4.3) ────────────────────────────────────

  @RequirePermission('supply.return.create')
  @Post('returns')
  @ApiOperation({ summary: 'Create return to supplier record (RTV)' })
  async createSupplierReturn(@Req() req: RequestWithAuth, @Body() body: CreateSupplierReturnRequest) {
    const parsed = CreateSupplierReturnSchema.parse(body);
    return this.svc.createSupplierReturn(req.tenantId!, req.authContext!.userId!, parsed);
  }

  @RequirePermission('supply.return.post')
  @Post('returns/:id/post')
  @ApiOperation({ summary: 'Post supplier return movement out of stock' })
  async postSupplierReturn(
    @Req() req: RequestWithAuth,
    @Param('id') id: string,
    @Query('locationId') locationId: string,
  ) {
    const requestId = getRequestId(req);
    return this.svc.postSupplierReturn(req.tenantId!, req.authContext!.userId!, requestId, id, locationId);
  }


  // ── Requisitions & Issues (SUP-T3, AC-9) ────────────────────────────────────

  @RequirePermission('supply.req.read')
  @Get('requisitions')
  @ApiOperation({ summary: 'List department requisitions' })
  async listRequisitions(@Req() req: RequestWithAuth) {
    return this.svc.listRequisitions(req.tenantId!);
  }

  @RequirePermission('supply.req.create')
  @Post('requisitions')
  @ApiOperation({ summary: 'Create department requisition' })
  async createRequisition(@Req() req: RequestWithAuth, @Body() body: CreateRequisitionRequest) {
    const parsed = CreateRequisitionSchema.parse(body);
    return this.svc.createRequisition(req.tenantId!, req.authContext!.userId!, parsed);
  }

  @RequirePermission('supply.req.submit')
  @Post('requisitions/:id/submit')
  @ApiOperation({ summary: 'Submit department requisition' })
  async submitRequisition(@Req() req: RequestWithAuth, @Param('id') id: string) {
    return this.svc.submitRequisition(req.tenantId!, id);
  }

  @RequirePermission('supply.req.approve')
  @Post('requisitions/:id/approve')
  @ApiOperation({ summary: 'Approve department requisition' })
  async approveRequisition(@Req() req: RequestWithAuth, @Param('id') id: string) {
    return this.svc.approveRequisition(req.tenantId!, req.authContext!.userId!, id);
  }

  @RequirePermission('supply.issue.create')
  @Post('requisitions/issues')
  @ApiOperation({ summary: 'Issue stock for requisition (FEFO pick & in-transit post)' })
  async createIssue(@Req() req: RequestWithAuth, @Body() body: CreateIssueRequest) {
    const parsed = CreateIssueSchema.parse(body);
    const requestId = getRequestId(req);
    return this.svc.createIssue(req.tenantId!, req.authContext!.userId!, requestId, parsed);
  }

  @RequirePermission('supply.req.receive')
  @Post('requisitions/acknowledge')
  @ApiOperation({ summary: 'Acknowledge requisition receipt (with discrepancy tracking)' })
  async acknowledgeRequisition(@Req() req: RequestWithAuth, @Body() body: AcknowledgeRequisitionRequest) {
    const parsed = AcknowledgeRequisitionSchema.parse(body);
    const requestId = getRequestId(req);
    return this.svc.acknowledgeRequisition(req.tenantId!, req.authContext!.userId!, requestId, parsed);
  }

  // ── Stock Adjustments (SUP-T5) ──────────────────────────────────────────────

  @RequirePermission('supply.adjust.read')
  @Get('adjustments')
  @ApiOperation({ summary: 'List stock adjustments' })
  async listAdjustments(@Req() req: RequestWithAuth) {
    return this.svc.listAdjustments(req.tenantId!);
  }

  @RequirePermission('supply.adjust.create')
  @Post('adjustments')
  @ApiOperation({ summary: 'Create stock adjustment draft' })
  async createAdjustment(@Req() req: RequestWithAuth, @Body() body: CreateAdjustmentRequest) {
    const parsed = CreateAdjustmentSchema.parse(body);
    return this.svc.createAdjustment(req.tenantId!, req.authContext!.userId!, parsed);
  }

  @RequirePermission('supply.adjust.submit')
  @Post('adjustments/:id/submit')
  @ApiOperation({ summary: 'Submit stock adjustment for review' })
  async submitAdjustment(@Req() req: RequestWithAuth, @Param('id') id: string) {
    return this.svc.submitAdjustment(req.tenantId!, id);
  }

  @RequirePermission('supply.adjust.post')
  @Post('adjustments/:id/post')
  @ApiOperation({ summary: 'Approve & post stock adjustment (SoD enforced)' })
  async postAdjustment(@Req() req: RequestWithAuth, @Param('id') id: string) {
    const requestId = getRequestId(req);
    return this.svc.approveAndPostAdjustment(req.tenantId!, req.authContext!.userId!, requestId, id);
  }

  // ── Physical Counts (SUP-T6) ────────────────────────────────────────────────

  @RequirePermission('supply.count.read')
  @Get('counts')
  @ApiOperation({ summary: 'List physical counts' })
  async listCounts(@Req() req: RequestWithAuth) {
    return this.svc.listCounts(req.tenantId!);
  }

  @RequirePermission('supply.count.create')
  @Post('counts')
  @ApiOperation({ summary: 'Create physical count sheet' })
  async createCount(@Req() req: RequestWithAuth, @Body() body: CreateCountRequest) {
    const parsed = CreateCountSchema.parse(body);
    return this.svc.createCount(req.tenantId!, req.authContext!.userId!, parsed);
  }

  @RequirePermission('supply.count.update')
  @Post('counts/:id/lines')
  @ApiOperation({ summary: 'Enter count sheet lines' })
  async enterCountLines(@Req() req: RequestWithAuth, @Param('id') id: string, @Body() body: EnterCountLinesRequest) {
    const parsed = EnterCountLinesSchema.parse(body);
    return this.svc.enterCountLines(req.tenantId!, id, parsed);
  }

  @RequirePermission('supply.count.post')
  @Post('counts/:id/post')
  @ApiOperation({ summary: 'Post physical count variance movements' })
  async postCount(@Req() req: RequestWithAuth, @Param('id') id: string) {
    const requestId = getRequestId(req);
    return this.svc.postCount(req.tenantId!, req.authContext!.userId!, requestId, id);
  }

  // ── Disposals (SUP-T8) ─────────────────────────────────────────────────────

  @RequirePermission('supply.dispose.create')
  @Post('disposals')
  @ApiOperation({ summary: 'Create disposal record' })
  async createDisposal(@Req() req: RequestWithAuth, @Body() body: CreateDisposalRequest) {
    const parsed = CreateDisposalSchema.parse(body);
    return this.svc.createDisposal(req.tenantId!, req.authContext!.userId!, parsed);
  }

  @RequirePermission('supply.dispose.post')
  @Post('disposals/:id/post')
  @ApiOperation({ summary: 'Post disposal movement with witness signoff' })
  async postDisposal(@Req() req: RequestWithAuth, @Param('id') id: string) {
    const requestId = getRequestId(req);
    return this.svc.postDisposal(req.tenantId!, req.authContext!.userId!, requestId, id);
  }

  // ── Recalls (SUP-T9) ───────────────────────────────────────────────────────

  @RequirePermission('supply.recall.create')
  @Post('recalls')
  @ApiOperation({ summary: 'Create lot recall (auto-quarantines batches)' })
  async createRecall(@Req() req: RequestWithAuth, @Body() body: CreateRecallRequest) {
    const parsed = CreateRecallSchema.parse(body);
    return this.svc.createRecall(req.tenantId!, req.authContext!.userId!, parsed);
  }

  @RequirePermission('supply.recall.read')
  @Get('recalls/:id/trace')
  @ApiOperation({ summary: 'Trace recall to locations, batches, and patient encounters' })
  async traceRecall(@Req() req: RequestWithAuth, @Param('id') id: string) {
    return this.svc.traceRecall(req.tenantId!, id);
  }

  @RequirePermission('supply.recall.close')
  @Post('recalls/:id/close')
  @ApiOperation({ summary: 'Close recall with completed checklist' })
  async closeRecall(@Req() req: RequestWithAuth, @Param('id') id: string, @Body() body: CloseRecallRequest) {
    const parsed = CloseRecallSchema.parse(body);
    return this.svc.closeRecall(req.tenantId!, id, parsed);
  }

  // ── Stock Explorer & Ledger APIs ───────────────────────────────────────────

  @RequirePermission('supply.stock.read')
  @Get('stock')
  @ApiOperation({ summary: 'Stock explorer: balances, valuation, near-expiry' })
  async getStock(
    @Req() req: RequestWithAuth,
    @Query('itemId') itemId?: string,
    @Query('locationId') locationId?: string,
    @Query('nearExpiryDays') nearExpiryDays?: string,
  ) {
    return this.svc.getStock(req.tenantId!, {
      itemId,
      locationId,
      nearExpiryDays: nearExpiryDays ? parseInt(nearExpiryDays, 10) : undefined,
    });
  }

  @RequirePermission('supply.stock.read')
  @Get('stock/:itemId/ledger')
  @ApiOperation({ summary: 'Get item movement ledger' })
  async getItemLedger(@Req() req: RequestWithAuth, @Param('itemId') itemId: string) {
    return this.svc.getItemLedger(req.tenantId!, itemId);
  }

  @RequirePermission('supply.stock.read')
  @Get('stock-movements')
  @ApiOperation({ summary: 'List recent stock movements' })
  async listMovements(@Req() req: RequestWithAuth, @Query('limit') limit?: string) {
    return this.svc.listMovements(req.tenantId!, limit ? parseInt(limit, 10) : 50);
  }

  @RequirePermission('supply.stock.read')
  @Get('valuation')
  @ApiOperation({ summary: 'Valuation snapshot' })
  async getValuationSnapshot(@Req() req: RequestWithAuth, @Query('asOf') asOf?: string) {
    return this.svc.getValuationSnapshot(req.tenantId!, asOf);
  }
}
