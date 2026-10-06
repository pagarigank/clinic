import { Inject, Controller, Get, Post, Patch, Body, Param, Query, UseGuards, Req } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '../auth/guards/auth.guard.js';
import { TenantContextGuard } from '../auth/guards/tenant-context.guard.js';
import { Module } from '../rbac/module.guard.js';
import { RequirePermission } from '../rbac/require-permission.decorator.js';
import { ComplianceService } from './compliance.service.js';
import type { RequestWithAuth } from '../auth/auth-context.js';
import {
  CreateConsentTemplateSchema, type CreateConsentTemplateRequest,
  CreatePatientConsentSchema, type CreatePatientConsentRequest,
  RevokePatientConsentSchema, type RevokePatientConsentRequest,
  CreateDsrSchema, type CreateDsrRequest,
  VerifyDsrIdentitySchema, type VerifyDsrIdentityRequest,
  CompleteDsrSchema, type CompleteDsrRequest,
  RejectDsrSchema, type RejectDsrRequest,
  ExtendDsrSchema, type ExtendDsrRequest,
  CreateBreachSchema, type CreateBreachRequest,
  AssessBreachSchema, type AssessBreachRequest,
  NotifyBreachSchema, type NotifyBreachRequest,
  CloseBreachSchema, type CloseBreachRequest,
  CreateRetentionPolicySchema, type CreateRetentionPolicyRequest,
  UpdateRetentionPolicySchema, type UpdateRetentionPolicyRequest,
  CreateLegalHoldSchema, type CreateLegalHoldRequest,
  ReleaseLegalHoldSchema, type ReleaseLegalHoldRequest,
  ApproveRetentionCandidatesSchema, type ApproveRetentionCandidatesRequest,
  HoldRetentionCandidatesSchema, type HoldRetentionCandidatesRequest,
  CreateAccessReviewSchema, type CreateAccessReviewRequest,
  RecordAccessReviewDecisionSchema, type RecordAccessReviewDecisionRequest,
  CreatePidsrCaseSchema, type CreatePidsrCaseRequest,
  UpdatePidsrCaseSchema, type UpdatePidsrCaseRequest,
} from '@clinic/contracts';

function getActorId(req: RequestWithAuth): string {
  return req.authContext?.userId || '00000000-0000-0000-0000-000000000000';
}

@ApiTags('Compliance')
@ApiBearerAuth()
@Controller('compliance')
@UseGuards(AuthGuard, TenantContextGuard)
@Module('compliance')
export class ComplianceController {
  constructor(
    @Inject(ComplianceService) private readonly svc: ComplianceService,
  ) {}

  // ── 1. Audit Explorer (§12.1, §18.10) ─────────────────────────────────────

  @RequirePermission('compliance.audit.read')
  @Get(['audit', 'audit-logs'])
  @ApiOperation({ summary: 'List system audit log entries' })
  async listAuditLogs(
    @Req() req: RequestWithAuth,
    @Query('actorId') actorId?: string,
    @Query('entityType') entityType?: string,
    @Query('entityId') entityId?: string,
    @Query('action') action?: string,
    @Query('actingAsPlatform') actingAsPlatform?: string,
    @Query('since') since?: string,
    @Query('until') until?: string,
    @Query('limit') limit?: string,
  ) {
    return this.svc.listAuditLogs(req.tenantId!, {
      actorId,
      entityType,
      entityId,
      action,
      actingAsPlatform: actingAsPlatform !== undefined ? actingAsPlatform === 'true' : undefined,
      since,
      until,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @RequirePermission('compliance.audit.read')
  @Get(['audit/:id', 'audit-logs/:id'])
  @ApiOperation({ summary: 'Get audit entry with state diff' })
  async getAuditLogById(@Req() req: RequestWithAuth, @Param('id') id: string) {
    return this.svc.getAuditLogById(req.tenantId!, id);
  }

  // ── 2. PHI Access Log (§12.1, §18.10) ─────────────────────────────────────

  @RequirePermission('compliance.access.read')
  @Get(['phi-access', 'phi-access-logs'])
  @ApiOperation({ summary: 'List PHI access records' })
  async listPhiAccessLogs(
    @Req() req: RequestWithAuth,
    @Query('patientId') patientId?: string,
    @Query('actorId') actorId?: string,
    @Query('resource') resource?: string,
    @Query('anomaly') anomaly?: string,
    @Query('since') since?: string,
    @Query('until') until?: string,
    @Query('limit') limit?: string,
  ) {
    return this.svc.listPhiAccessLogs(req.tenantId!, {
      patientId,
      actorId,
      resource,
      anomalyOnly: anomaly === 'true',
      since,
      until,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  // ── 3. Consent Management (§12.1, §18.10) ──────────────────────────────────

  @RequirePermission('compliance.consent.read')
  @Get('consent-templates')
  @ApiOperation({ summary: 'List consent templates' })
  async listConsentTemplates(@Req() req: RequestWithAuth, @Query('locale') locale?: string) {
    return this.svc.listConsentTemplates(req.tenantId!, locale);
  }

  @RequirePermission('compliance.consent.write')
  @Post('consent-templates')
  @ApiOperation({ summary: 'Create new consent template version' })
  async createConsentTemplate(@Req() req: RequestWithAuth, @Body() body: CreateConsentTemplateRequest) {
    return this.svc.createConsentTemplate(req.tenantId!, body, getActorId(req));
  }

  @RequirePermission('compliance.consent.write')
  @Post('consent-templates/:id/publish')
  @ApiOperation({ summary: 'Publish consent template' })
  async publishConsentTemplate(@Req() req: RequestWithAuth, @Param('id') id: string) {
    return this.svc.publishConsentTemplate(req.tenantId!, id, getActorId(req));
  }

  @RequirePermission('compliance.consent.read')
  @Get('patients/:patientId/consents')
  @ApiOperation({ summary: 'List consents recorded for a patient' })
  async getPatientConsents(@Req() req: RequestWithAuth, @Param('patientId') patientId: string) {
    return this.svc.getPatientConsents(req.tenantId!, patientId);
  }

  @RequirePermission('compliance.consent.create')
  @Post('patients/:patientId/consents')
  @ApiOperation({ summary: 'Record signed patient consent' })
  async recordPatientConsent(
    @Req() req: RequestWithAuth,
    @Param('patientId') patientId: string,
    @Body() body: CreatePatientConsentRequest,
  ) {
    return this.svc.recordPatientConsent(req.tenantId!, { ...body, patientId }, getActorId(req));
  }

  @RequirePermission('compliance.consent.update')
  @Post('consents/:id/revoke')
  @ApiOperation({ summary: 'Revoke patient consent' })
  async revokePatientConsent(
    @Req() req: RequestWithAuth,
    @Param('id') id: string,
    @Body() body: RevokePatientConsentRequest,
  ) {
    return this.svc.revokePatientConsent(req.tenantId!, id, body.revokedReason, getActorId(req));
  }

  // ── 4. Data Subject Requests (DSR) (§12.1, CMP-T1, AC-15) ──────────────────

  @RequirePermission('compliance.dsr.read')
  @Get('dsr')
  @ApiOperation({ summary: 'List Data Subject Requests' })
  async listDsrRequests(
    @Req() req: RequestWithAuth,
    @Query('status') status?: string,
    @Query('type') type?: string,
  ) {
    return this.svc.listDsrRequests(req.tenantId!, { status, type });
  }

  @RequirePermission('compliance.dsr.read')
  @Get('dsr/:id')
  @ApiOperation({ summary: 'Get Data Subject Request details' })
  async getDsrRequest(@Req() req: RequestWithAuth, @Param('id') id: string) {
    return this.svc.getDsrRequest(req.tenantId!, id);
  }

  @RequirePermission('compliance.dsr.create')
  @Post('dsr')
  @ApiOperation({ summary: 'Intake new Data Subject Request' })
  async createDsrRequest(@Req() req: RequestWithAuth, @Body() body: CreateDsrRequest) {
    return this.svc.createDsrRequest(req.tenantId!, body, getActorId(req));
  }

  @RequirePermission('compliance.dsr.verify')
  @Post('dsr/:id/verify-identity')
  @ApiOperation({ summary: 'Verify data subject identity' })
  async verifyDsrIdentity(
    @Req() req: RequestWithAuth,
    @Param('id') id: string,
    @Body() body: VerifyDsrIdentityRequest,
  ) {
    return this.svc.verifyDsrIdentity(req.tenantId!, id, body, getActorId(req));
  }

  @RequirePermission('compliance.dsr.start')
  @Post('dsr/:id/start')
  @ApiOperation({ summary: 'Start processing verified DSR request' })
  async startDsrProcessing(@Req() req: RequestWithAuth, @Param('id') id: string) {
    return this.svc.startDsrProcessing(req.tenantId!, id, getActorId(req));
  }

  @RequirePermission('compliance.dsr.complete')
  @Post('dsr/:id/complete')
  @ApiOperation({ summary: 'Complete DSR request' })
  async completeDsr(@Req() req: RequestWithAuth, @Param('id') id: string, @Body() body: CompleteDsrRequest) {
    return this.svc.completeDsr(req.tenantId!, id, body, getActorId(req));
  }

  @RequirePermission('compliance.dsr.reject')
  @Post('dsr/:id/reject')
  @ApiOperation({ summary: 'Reject DSR request with reason' })
  async rejectDsr(@Req() req: RequestWithAuth, @Param('id') id: string, @Body() body: RejectDsrRequest) {
    return this.svc.rejectDsr(req.tenantId!, id, body, getActorId(req));
  }

  @RequirePermission('compliance.dsr.extend')
  @Post('dsr/:id/extend')
  @ApiOperation({ summary: 'Extend DSR SLA due date' })
  async extendDsr(@Req() req: RequestWithAuth, @Param('id') id: string, @Body() body: ExtendDsrRequest) {
    return this.svc.extendDsr(req.tenantId!, id, body, getActorId(req));
  }

  @RequirePermission('compliance.dsr.read')
  @Get('dsr/:id/export')
  @ApiOperation({ summary: 'Export patient records bundle (AC-15: audited PHI read)' })
  async exportPatientData(@Req() req: RequestWithAuth, @Param('id') id: string) {
    const rawReq = req as any;
    const ip = rawReq.ip || rawReq.headers?.['x-forwarded-for'];
    const ua = rawReq.headers?.['user-agent'];
    return this.svc.exportPatientData(req.tenantId!, id, getActorId(req), ip, ua);
  }

  // ── 5. Breach Incidents (§12.1, CMP-T2, Q-2) ───────────────────────────────

  @RequirePermission('compliance.breach.read')
  @Get('breaches')
  @ApiOperation({ summary: 'List security and data breach incidents' })
  async listBreaches(
    @Req() req: RequestWithAuth,
    @Query('status') status?: string,
    @Query('severity') severity?: string,
  ) {
    return this.svc.listBreaches(req.tenantId!, { status, severity });
  }

  @RequirePermission('compliance.breach.read')
  @Get('breaches/:id')
  @ApiOperation({ summary: 'Get breach incident details' })
  async getBreach(@Req() req: RequestWithAuth, @Param('id') id: string) {
    return this.svc.getBreach(req.tenantId!, id);
  }

  @RequirePermission('compliance.breach.create')
  @Post('breaches')
  @ApiOperation({ summary: 'Register security/data breach incident' })
  async createBreach(@Req() req: RequestWithAuth, @Body() body: CreateBreachRequest) {
    return this.svc.createBreach(req.tenantId!, body, getActorId(req));
  }

  @RequirePermission('compliance.breach.assess')
  @Post('breaches/:id/assess')
  @ApiOperation({ summary: 'Assess breach severity and affected data' })
  async assessBreach(
    @Req() req: RequestWithAuth,
    @Param('id') id: string,
    @Body() body: AssessBreachRequest,
  ) {
    return this.svc.assessBreach(req.tenantId!, id, body, getActorId(req));
  }

  @RequirePermission('compliance.breach.notify')
  @Post('breaches/:id/notify')
  @ApiOperation({ summary: 'Record notification to regulator/data subjects' })
  async recordBreachNotification(
    @Req() req: RequestWithAuth,
    @Param('id') id: string,
    @Body() body: NotifyBreachRequest,
  ) {
    return this.svc.recordBreachNotification(req.tenantId!, id, body, getActorId(req));
  }

  @RequirePermission('compliance.breach.close')
  @Post('breaches/:id/close')
  @ApiOperation({ summary: 'Close breach incident with corrective actions' })
  async closeBreach(
    @Req() req: RequestWithAuth,
    @Param('id') id: string,
    @Body() body: CloseBreachRequest,
  ) {
    return this.svc.closeBreach(req.tenantId!, id, body, getActorId(req));
  }

  // ── 6. Retention Policies & Legal Holds (CMP-T1/T5, JOB-15) ─────────────────

  @RequirePermission('compliance.retention.read')
  @Get(['retention-policies', 'retention/policies'])
  @ApiOperation({ summary: 'List data retention policies' })
  async listRetentionPolicies(@Req() req: RequestWithAuth) {
    return this.svc.listRetentionPolicies(req.tenantId!);
  }

  @RequirePermission('compliance.retention.create')
  @Post(['retention-policies', 'retention/policies'])
  @ApiOperation({ summary: 'Create or update retention policy' })
  async createRetentionPolicy(@Req() req: RequestWithAuth, @Body() body: CreateRetentionPolicyRequest) {
    return this.svc.createRetentionPolicy(req.tenantId!, body, getActorId(req));
  }

  @RequirePermission('compliance.retention.update')
  @Patch(['retention-policies/:id', 'retention/policies/:id'])
  @ApiOperation({ summary: 'Update retention policy' })
  async updateRetentionPolicy(
    @Req() req: RequestWithAuth,
    @Param('id') id: string,
    @Body() body: UpdateRetentionPolicyRequest,
  ) {
    return this.svc.updateRetentionPolicy(req.tenantId!, id, body, getActorId(req));
  }

  @RequirePermission('compliance.hold.read')
  @Get(['legal-holds', 'retention/legal-holds'])
  @ApiOperation({ summary: 'List legal holds' })
  async listLegalHolds(
    @Req() req: RequestWithAuth,
    @Query('scope') scope?: string,
    @Query('patientId') patientId?: string,
  ) {
    return this.svc.listLegalHolds(req.tenantId!, { scope, patientId });
  }

  @RequirePermission('compliance.hold.create')
  @Post(['legal-holds', 'retention/legal-holds'])
  @ApiOperation({ summary: 'Place new legal hold' })
  async createLegalHold(@Req() req: RequestWithAuth, @Body() body: CreateLegalHoldRequest) {
    return this.svc.createLegalHold(req.tenantId!, body, getActorId(req));
  }

  @RequirePermission('compliance.hold.release')
  @Post(['legal-holds/:id/release', 'retention/legal-holds/:id/release'])
  @ApiOperation({ summary: 'Release active legal hold' })
  async releaseLegalHold(
    @Req() req: RequestWithAuth,
    @Param('id') id: string,
    @Body() body: ReleaseLegalHoldRequest,
  ) {
    return this.svc.releaseLegalHold(req.tenantId!, id, body, getActorId(req));
  }

  @RequirePermission('compliance.retention.read')
  @Get('retention/candidates')
  @ApiOperation({ summary: 'List retention candidate records (JOB-15)' })
  async listRetentionCandidates(@Req() req: RequestWithAuth, @Query('status') status?: string) {
    return this.svc.listRetentionCandidates(req.tenantId!, status);
  }

  @RequirePermission('compliance.retention.enforce')
  @Post('retention/candidates/approve')
  @ApiOperation({ summary: 'Approve retention candidates for archival/anonymization' })
  async approveRetentionCandidates(
    @Req() req: RequestWithAuth,
    @Body() body: ApproveRetentionCandidatesRequest,
  ) {
    return this.svc.approveRetentionCandidates(req.tenantId!, body, getActorId(req));
  }

  @RequirePermission('compliance.retention.enforce')
  @Post('retention/candidates/hold')
  @ApiOperation({ summary: 'Place retention candidates on hold' })
  async holdRetentionCandidates(
    @Req() req: RequestWithAuth,
    @Body() body: HoldRetentionCandidatesRequest,
  ) {
    return this.svc.holdRetentionCandidates(req.tenantId!, body, getActorId(req));
  }

  // ── 7. Access Reviews (CMP-T3, ADM-T5) ──────────────────────────────────────

  @RequirePermission('compliance.access_review.read')
  @Get('access-reviews')
  @ApiOperation({ summary: 'List quarterly access reviews' })
  async listAccessReviews(@Req() req: RequestWithAuth) {
    return this.svc.listAccessReviews(req.tenantId!);
  }

  @RequirePermission('compliance.access_review.read')
  @Get('access-reviews/:id')
  @ApiOperation({ summary: 'Get access review campaign details and decisions' })
  async getAccessReview(@Req() req: RequestWithAuth, @Param('id') id: string) {
    return this.svc.getAccessReview(req.tenantId!, id);
  }

  @RequirePermission('compliance.access_review.create')
  @Post('access-reviews')
  @ApiOperation({ summary: 'Start new access review campaign' })
  async createAccessReview(@Req() req: RequestWithAuth, @Body() body: CreateAccessReviewRequest) {
    return this.svc.createAccessReview(req.tenantId!, body, getActorId(req));
  }

  @RequirePermission('compliance.access_review.decide')
  @Post('access-reviews/:id/decide')
  @ApiOperation({ summary: 'Record decision on user permission/role' })
  async recordAccessReviewDecision(
    @Req() req: RequestWithAuth,
    @Param('id') id: string,
    @Body() body: RecordAccessReviewDecisionRequest,
  ) {
    return this.svc.recordAccessReviewDecision(req.tenantId!, id, body, getActorId(req));
  }

  // ── 8. PIDSR Notifiable Disease Cases (todo §8.4, Q-16) ─────────────────────

  @RequirePermission('compliance.audit.read')
  @Get('pidsr')
  @ApiOperation({ summary: 'List PIDSR notifiable disease case reports' })
  async listPidsrCases(
    @Req() req: RequestWithAuth,
    @Query('status') status?: string,
    @Query('diseaseCode') diseaseCode?: string,
    @Query('branchId') branchId?: string,
  ) {
    return this.svc.listPidsrCases(req.tenantId!, { status, diseaseCode, branchId });
  }

  @RequirePermission('compliance.audit.read')
  @Get('pidsr/:id')
  @ApiOperation({ summary: 'Get PIDSR case record' })
  async getPidsrCase(@Req() req: RequestWithAuth, @Param('id') id: string) {
    return this.svc.getPidsrCase(req.tenantId!, id);
  }

  @RequirePermission('compliance.audit.read')
  @Post('pidsr')
  @ApiOperation({ summary: 'Create PIDSR notifiable disease case report' })
  async createPidsrCase(@Req() req: RequestWithAuth, @Body() body: CreatePidsrCaseRequest) {
    return this.svc.createPidsrCase(req.tenantId!, body, getActorId(req));
  }

  @RequirePermission('compliance.audit.read')
  @Patch('pidsr/:id')
  @ApiOperation({ summary: 'Update PIDSR case classification, CIF, or status' })
  async updatePidsrCase(
    @Req() req: RequestWithAuth,
    @Param('id') id: string,
    @Body() body: UpdatePidsrCaseRequest,
  ) {
    return this.svc.updatePidsrCase(req.tenantId!, id, body, getActorId(req));
  }

  // ── 9. Security Events (§12.1) ─────────────────────────────────────────────

  @RequirePermission('compliance.audit.read')
  @Get('security-events')
  @ApiOperation({ summary: 'List security events and anomalies' })
  async listSecurityEvents(
    @Req() req: RequestWithAuth,
    @Query('eventType') eventType?: string,
    @Query('severity') severity?: string,
  ) {
    return this.svc.listSecurityEvents(req.tenantId!, { eventType, severity });
  }
}
