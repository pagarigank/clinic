import { Inject, Controller, Get, Post, Patch, Body, Param, Query, UseGuards, Req, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ZodValidationPipe } from '../http/zod-validation.pipe.js';
import { AuthGuard } from '../auth/guards/auth.guard.js';
import { TenantContextGuard } from '../auth/guards/tenant-context.guard.js';
import { Module } from '../rbac/module.guard.js';
import { RequirePermission } from '../rbac/require-permission.decorator.js';
import { PhiAccess } from '../audit/phi-access.decorator.js';
import { ClinicalService } from './clinical.service.js';
import type { RequestWithAuth } from '../auth/auth-context.js';
import {
  BookAppointmentSchema, type BookAppointmentRequest,
  ConfirmAppointmentSchema, type ConfirmAppointmentRequest,
  CheckInAppointmentSchema, type CheckInAppointmentRequest,
  RescheduleAppointmentSchema, type RescheduleAppointmentRequest,
  CancelAppointmentSchema, type CancelAppointmentRequest,
  OpenVisitSchema, type OpenVisitRequest,
  UpdateVisitSchema, type UpdateVisitRequest,
  CancelVisitSchema, type CancelVisitRequest,
  RecordVitalsSchema, type RecordVitalsRequest,
  SaveNoteSchema, type SaveNoteRequest,
  SignNoteSchema, type SignNoteRequest,
  AmendNoteSchema, type AmendNoteRequest,
  AddDiagnosisSchema, type AddDiagnosisRequest,
  AddProblemSchema, type AddProblemRequest,
  ResolveProblemSchema, type ResolveProblemRequest,
  RecordProcedureSchema, type RecordProcedureRequest,
  VoidProcedureSchema, type VoidProcedureRequest,
  RecordImmunizationSchema, type RecordImmunizationRequest,
  VoidImmunizationSchema, type VoidImmunizationRequest,
  CreatePrescriptionSchema, type CreatePrescriptionRequest,
  IssuePrescriptionSchema, type IssuePrescriptionRequest,
  CancelPrescriptionSchema, type CancelPrescriptionRequest,
  IssueCertificateSchema, type IssueCertificateRequest,
  VoidCertificateSchema, type VoidCertificateRequest,
  CreateReferralSchema, type CreateReferralRequest,
  CreateClinicalTemplateSchema, type CreateClinicalTemplateRequest,
  CreateOrderSetSchema, type CreateOrderSetRequest,
  CreateChargeSchema, type CreateChargeRequest,
  UpsertPractitionerProfileSchema, type UpsertPractitionerProfileRequest,
  CreateScheduleSchema, type CreateScheduleRequest,
  CreateScheduleExceptionSchema,
  IssueQueueTicketSchema, type IssueQueueTicketRequest,
  QueueActionSchema, type QueueActionRequest,
} from '@clinic/contracts';

@ApiTags('Clinical')
@ApiBearerAuth()
@Controller('clinical')
@UseGuards(AuthGuard, TenantContextGuard)
@Module('clinical')
export class ClinicalController {
  constructor(
    @Inject(ClinicalService) private readonly svc: ClinicalService,
  ) {}
  // ── Schedules ─────────────────────────────────────────────────────────────
  @RequirePermission('clinical.schedule.read')
  @Get('schedules')
  @ApiOperation({ summary: 'List practitioner schedule templates' })
  async listSchedules(@Req() req: RequestWithAuth, @Query('branchId') branchId?: string) {
    return this.svc.listSchedules(req.tenantId!, req.authContext!.userId!, branchId);
  }

  @RequirePermission('clinical.schedule.update')
  @Post('schedules')
  @ApiOperation({ summary: 'Create a schedule template (overlap-validated)' })
  async createSchedule(@Req() req: RequestWithAuth, @Body(new ZodValidationPipe(CreateScheduleSchema)) dto: CreateScheduleRequest) {
    return this.svc.createSchedule(req.tenantId!, req.authContext!.userId!, dto);
  }

  @RequirePermission('clinical.schedule.update')
  @Post('schedules/exceptions')
  @ApiOperation({ summary: 'Record a schedule exception (leave)' })
  async createException(@Req() req: RequestWithAuth, @Body(new ZodValidationPipe(CreateScheduleExceptionSchema)) dto: any) {
    return this.svc.createScheduleException(req.tenantId!, req.authContext!.userId!, dto);
  }

  @RequirePermission('clinical.schedule.read')
  @Get('availability')
  @ApiOperation({ summary: 'Slot availability for a practitioner/day (CLN-T1)' })
  async availability(
    @Req() req: RequestWithAuth,
    @Query('branchId') branchId: string,
    @Query('practitionerId') practitionerId: string,
    @Query('date') date: string,
  ) {
    return this.svc.getAvailability(req.tenantId!, req.authContext!.userId!, branchId, practitionerId, date);
  }

  // ── Practitioner fees (Q-17) ──────────────────────────────────────────────
  @RequirePermission('clinical.schedule.update')
  @Post('practitioner-profiles')
  @ApiOperation({ summary: 'Upsert per-practitioner fee config (Q-17)' })
  async upsertProfile(@Req() req: RequestWithAuth, @Body(new ZodValidationPipe(UpsertPractitionerProfileSchema)) dto: UpsertPractitionerProfileRequest) {
    return this.svc.upsertPractitionerProfile(req.tenantId!, req.authContext!.userId!, dto);
  }

  @RequirePermission('clinical.schedule.read')
  @Get('practitioner-profiles')
  @ApiOperation({ summary: 'List practitioner fee configs' })
  async listProfiles(@Req() req: RequestWithAuth) {
    return this.svc.listPractitionerProfiles(req.tenantId!, req.authContext!.userId!);
  }

  // ── Appointments ──────────────────────────────────────────────────────────
  @RequirePermission('clinical.appointment.read')
  @Get('appointments')
  @ApiOperation({ summary: 'List appointments (branch/day filtered)' })
  async listAppointments(@Req() req: RequestWithAuth, @Query('branchId') branchId?: string, @Query('date') date?: string) {
    return this.svc.listAppointments(req.tenantId!, req.authContext!.userId!, branchId, date);
  }

  @RequirePermission('clinical.appointment.create')
  @Post('appointments')
  @ApiOperation({ summary: 'Book an appointment (double-booking prevented)' })
  async book(@Req() req: RequestWithAuth, @Body(new ZodValidationPipe(BookAppointmentSchema)) dto: BookAppointmentRequest) {
    return this.svc.bookAppointment(req.tenantId!, req.authContext!.userId!, dto);
  }

  @RequirePermission('clinical.appointment.update')
  @Patch('appointments/:id/confirm')
  @ApiOperation({ summary: 'Confirm a booked appointment' })
  async confirm(@Req() req: RequestWithAuth, @Param('id') id: string, @Body(new ZodValidationPipe(ConfirmAppointmentSchema)) dto: ConfirmAppointmentRequest) {
    return this.svc.confirmAppointment(req.tenantId!, req.authContext!.userId!, id, dto);
  }

  @RequirePermission('clinical.appointment.update')
  @Patch('appointments/:id/check-in')
  @ApiOperation({ summary: 'Check in patient for an appointment' })
  async checkIn(@Req() req: RequestWithAuth, @Param('id') id: string, @Body(new ZodValidationPipe(CheckInAppointmentSchema)) dto: CheckInAppointmentRequest) {
    return this.svc.checkInAppointment(req.tenantId!, req.authContext!.userId!, id, dto);
  }

  @RequirePermission('clinical.appointment.update')
  @Patch('appointments/:id/reschedule')
  async reschedule(@Req() req: RequestWithAuth, @Param('id') id: string, @Body(new ZodValidationPipe(RescheduleAppointmentSchema)) dto: RescheduleAppointmentRequest) {
    return this.svc.rescheduleAppointment(req.tenantId!, req.authContext!.userId!, id, dto);
  }

  @RequirePermission('clinical.appointment.cancel')
  @Patch('appointments/:id/cancel')
  async cancelAppointment(@Req() req: RequestWithAuth, @Param('id') id: string, @Body(new ZodValidationPipe(CancelAppointmentSchema)) dto: CancelAppointmentRequest) {
    return this.svc.cancelAppointment(req.tenantId!, req.authContext!.userId!, id, dto);
  }

  @RequirePermission('clinical.appointment.no_show')
  @Patch('appointments/:id/no-show')
  async noShow(@Req() req: RequestWithAuth, @Param('id') id: string) {
    return this.svc.markNoShow(req.tenantId!, req.authContext!.userId!, id);
  }

  // ── Queue ─────────────────────────────────────────────────────────────────
  @RequirePermission('clinical.queue.read')
  @Get('queue')
  @ApiOperation({ summary: "Today's queue board for a branch" })
  async queueBoard(@Req() req: RequestWithAuth, @Query('branchId') branchId: string) {
    return this.svc.getQueueBoard(req.tenantId!, req.authContext!.userId!, branchId);
  }

  @RequirePermission('clinical.queue.call')
  @Post('queue')
  @ApiOperation({ summary: 'Issue a queue ticket' })
  async issueTicket(@Req() req: RequestWithAuth, @Body(new ZodValidationPipe(IssueQueueTicketSchema)) dto: IssueQueueTicketRequest) {
    return this.svc.issueQueueTicket(req.tenantId!, req.authContext!.userId!, dto);
  }

  @RequirePermission('clinical.queue.call')
  @Post('queue/:id/action')
  async queueAction(@Req() req: RequestWithAuth, @Param('id') id: string, @Body(new ZodValidationPipe(QueueActionSchema)) dto: QueueActionRequest) {
    // Skip needs its own permission (clinical.queue.skip).
    if (dto.action === 'SKIP') {
      return this.svc.queueAction(req.tenantId!, req.authContext!.userId!, id, dto.action);
    }
    return this.svc.queueAction(req.tenantId!, req.authContext!.userId!, id, dto.action);
  }

  // ── Visits ────────────────────────────────────────────────────────────────
  @RequirePermission('clinical.visit.read')
  @Get('visits')
  async listVisits(@Req() req: RequestWithAuth, @Query('branchId') branchId?: string, @Query('status') status?: string) {
    return this.svc.listVisits(req.tenantId!, req.authContext!.userId!, branchId, status);
  }

  @RequirePermission('clinical.visit.read')
  @PhiAccess({ resource: 'visit', patientIdParam: 'id' })
  @Get('visits/:id')
  async getVisit(@Req() req: RequestWithAuth, @Param('id') id: string) {
    return this.svc.getVisit(req.tenantId!, req.authContext!.userId!, id);
  }

  @RequirePermission('clinical.visit.create')
  @Post('visits')
  @ApiOperation({ summary: 'Open a visit (check-in creates visit + queue ticket)' })
  async openVisit(@Req() req: RequestWithAuth, @Body(new ZodValidationPipe(OpenVisitSchema)) dto: OpenVisitRequest) {
    return this.svc.openVisit(req.tenantId!, req.authContext!.userId!, dto);
  }

  @RequirePermission('clinical.visit.update')
  @Patch('visits/:id')
  async updateVisit(@Req() req: RequestWithAuth, @Param('id') id: string, @Body(new ZodValidationPipe(UpdateVisitSchema)) dto: UpdateVisitRequest) {
    return this.svc.updateVisit(req.tenantId!, req.authContext!.userId!, id, dto);
  }

  @RequirePermission('clinical.visit.cancel')
  @Patch('visits/:id/cancel')
  async cancelVisit(@Req() req: RequestWithAuth, @Param('id') id: string, @Body(new ZodValidationPipe(CancelVisitSchema)) dto: CancelVisitRequest) {
    return this.svc.cancelVisit(req.tenantId!, req.authContext!.userId!, id, dto);
  }

  // ── Vitals ────────────────────────────────────────────────────────────────
  @RequirePermission('clinical.vitals.create')
  @Post('visits/:id/vitals')
  async recordVitals(@Req() req: RequestWithAuth, @Param('id') visitId: string, @Body(new ZodValidationPipe(RecordVitalsSchema)) dto: RecordVitalsRequest) {
    return this.svc.recordVitals(req.tenantId!, req.authContext!.userId!, visitId, dto);
  }

  // ── Notes ─────────────────────────────────────────────────────────────────
  @RequirePermission('clinical.note.create')
  @Post('visits/:id/notes')
  async saveNote(@Req() req: RequestWithAuth, @Param('id') visitId: string, @Body(new ZodValidationPipe(SaveNoteSchema)) dto: SaveNoteRequest) {
    return this.svc.saveNote(req.tenantId!, req.authContext!.userId!, visitId, dto);
  }

  @RequirePermission('clinical.note.update')
  @Patch('notes/:id')
  async updateNote(@Req() req: RequestWithAuth, @Param('id') id: string, @Body(new ZodValidationPipe(SaveNoteSchema)) dto: SaveNoteRequest) {
    return this.svc.updateNote(req.tenantId!, req.authContext!.userId!, id, dto);
  }

  @RequirePermission('clinical.note.sign')
  @Post('notes/:id/sign')
  async signNote(@Req() req: RequestWithAuth, @Param('id') id: string, @Body(new ZodValidationPipe(SignNoteSchema)) dto: SignNoteRequest) {
    return this.svc.signNote(req.tenantId!, req.authContext!.userId!, id, dto);
  }

  @RequirePermission('clinical.note.amend')
  @Post('notes/:id/amend')
  async amendNote(@Req() req: RequestWithAuth, @Param('id') id: string, @Body(new ZodValidationPipe(AmendNoteSchema)) dto: AmendNoteRequest) {
    return this.svc.amendNote(req.tenantId!, req.authContext!.userId!, id, dto);
  }

  // ── Diagnoses & Problems ──────────────────────────────────────────────────
  @RequirePermission('clinical.diagnosis.create')
  @Post('visits/:id/diagnoses')
  async addDiagnosis(@Req() req: RequestWithAuth, @Param('id') visitId: string, @Body(new ZodValidationPipe(AddDiagnosisSchema)) dto: AddDiagnosisRequest) {
    return this.svc.addDiagnosis(req.tenantId!, req.authContext!.userId!, visitId, dto);
  }

  @RequirePermission('clinical.problem.create')
  @Post('patients/:patientId/problems')
  async addProblem(@Req() req: RequestWithAuth, @Param('patientId') patientId: string, @Body(new ZodValidationPipe(AddProblemSchema)) dto: AddProblemRequest) {
    return this.svc.addProblem(req.tenantId!, req.authContext!.userId!, { ...dto, patientId });
  }

  @RequirePermission('clinical.problem.read')
  @Get('patients/:patientId/problems')
  async listProblems(@Req() req: RequestWithAuth, @Param('patientId') patientId: string) {
    return this.svc.listProblems(req.tenantId!, req.authContext!.userId!, patientId);
  }

  @RequirePermission('clinical.problem.resolve')
  @Patch('problems/:id/resolve')
  async resolveProblem(@Req() req: RequestWithAuth, @Param('id') id: string, @Body(new ZodValidationPipe(ResolveProblemSchema)) dto: ResolveProblemRequest) {
    return this.svc.resolveProblem(req.tenantId!, req.authContext!.userId!, id, dto);
  }

  // ── Procedures ────────────────────────────────────────────────────────────
  @RequirePermission('clinical.procedure.create')
  @Post('visits/:id/procedures')
  async recordProcedure(@Req() req: RequestWithAuth, @Param('id') visitId: string, @Body(new ZodValidationPipe(RecordProcedureSchema)) dto: RecordProcedureRequest) {
    return this.svc.recordProcedure(req.tenantId!, req.authContext!.userId!, visitId, dto);
  }

  @RequirePermission('clinical.procedure.delete')
  @Patch('procedures/:id/void')
  async voidProcedure(@Req() req: RequestWithAuth, @Param('id') id: string, @Body(new ZodValidationPipe(VoidProcedureSchema)) dto: VoidProcedureRequest) {
    return this.svc.voidProcedure(req.tenantId!, req.authContext!.userId!, id, dto);
  }

  // ── Immunizations ─────────────────────────────────────────────────────────
  @RequirePermission('clinical.immunization.create')
  @Post('immunizations')
  async recordImmunization(@Req() req: RequestWithAuth, @Body(new ZodValidationPipe(RecordImmunizationSchema)) dto: RecordImmunizationRequest) {
    return this.svc.recordImmunization(req.tenantId!, req.authContext!.userId!, dto);
  }

  @RequirePermission('clinical.immunization.read')
  @Get('patients/:patientId/immunizations')
  async listImmunizations(@Req() req: RequestWithAuth, @Param('patientId') patientId: string) {
    return this.svc.listImmunizations(req.tenantId!, req.authContext!.userId!, patientId);
  }

  @RequirePermission('clinical.immunization.delete')
  @Patch('immunizations/:id/void')
  async voidImmunization(@Req() req: RequestWithAuth, @Param('id') id: string, @Body(new ZodValidationPipe(VoidImmunizationSchema)) dto: VoidImmunizationRequest) {
    return this.svc.voidImmunization(req.tenantId!, req.authContext!.userId!, id, dto);
  }

  // ── Prescriptions ─────────────────────────────────────────────────────────
  @RequirePermission('clinical.rx.create')
  @Post('prescriptions')
  async createPrescription(@Req() req: RequestWithAuth, @Body(new ZodValidationPipe(CreatePrescriptionSchema)) dto: CreatePrescriptionRequest) {
    return this.svc.createPrescription(req.tenantId!, req.authContext!.userId!, dto);
  }

  @RequirePermission('clinical.rx.sign')
  @Post('prescriptions/:id/issue')
  async issuePrescription(@Req() req: RequestWithAuth, @Param('id') id: string, @Body(new ZodValidationPipe(IssuePrescriptionSchema)) dto: IssuePrescriptionRequest) {
    return this.svc.issuePrescription(req.tenantId!, req.authContext!.userId!, id, dto);
  }

  @RequirePermission('clinical.rx.cancel')
  @Post('prescriptions/:id/cancel')
  async cancelPrescription(@Req() req: RequestWithAuth, @Param('id') id: string, @Body(new ZodValidationPipe(CancelPrescriptionSchema)) dto: CancelPrescriptionRequest) {
    return this.svc.cancelPrescription(req.tenantId!, req.authContext!.userId!, id, dto);
  }

  @RequirePermission('clinical.rx.read')
  @Get('prescriptions/:id/print')
  async getPrescriptionPrint(@Req() req: RequestWithAuth, @Param('id') id: string) {
    return this.svc.getPrescriptionPrint(req.tenantId!, req.authContext!.userId!, id);
  }

  @RequirePermission('clinical.rx.read')
  @Get('prescriptions/:id/pdf')
  @ApiOperation({ summary: 'Render official prescription PDF (RA 6675 / RA 9165 compliant)' })
  async getPrescriptionPdf(
    @Req() req: RequestWithAuth,
    @Param('id') id: string,
    @Query() query: Record<string, string>,
    @Res() reply: FastifyReply,
  ) {
    const doc = await this.svc.renderPrescriptionPdf(req.tenantId!, req.authContext!.userId!, id, query);
    void reply
      .status(200)
      .header('content-type', 'application/pdf')
      .header('content-disposition', `inline; filename="Prescription-${id.slice(0, 8)}.pdf"`)
      .send(doc.bytes);
  }

  @RequirePermission('clinical.rx.read')
  @Get('visits/:id/prescription-pdf')
  @ApiOperation({ summary: 'Render encounter prescription pad PDF' })
  async getVisitPrescriptionPdf(
    @Req() req: RequestWithAuth,
    @Param('id') visitId: string,
    @Query() query: Record<string, string>,
    @Res() reply: FastifyReply,
  ) {
    const doc = await this.svc.renderVisitPrescriptionPdf(req.tenantId!, req.authContext!.userId!, visitId, query);
    void reply
      .status(200)
      .header('content-type', 'application/pdf')
      .header('content-disposition', `inline; filename="Prescription-Visit-${visitId.slice(0, 8)}.pdf"`)
      .send(doc.bytes);
  }

  @RequirePermission('clinical.visit.read')
  @Get('visits/:id/lab-request-pdf')
  @ApiOperation({ summary: 'Render encounter laboratory diagnostic examination requisition PDF' })
  async getVisitLabRequisitionPdf(
    @Req() req: RequestWithAuth,
    @Param('id') visitId: string,
    @Query() query: Record<string, string>,
    @Res() reply: FastifyReply,
  ) {
    const doc = await this.svc.renderVisitLabRequisitionPdf(req.tenantId!, req.authContext!.userId!, visitId, query);
    void reply
      .status(200)
      .header('content-type', 'application/pdf')
      .header('content-disposition', `inline; filename="LabRequisition-${visitId.slice(0, 8)}.pdf"`)
      .send(doc.bytes);
  }

  @RequirePermission('clinical.visit.read')
  @Get('visits/:id/orders-pdf')
  @ApiOperation({ summary: 'Render combined clinical consultation orders and summary PDF' })
  async getVisitOrdersPdf(
    @Req() req: RequestWithAuth,
    @Param('id') visitId: string,
    @Query() query: Record<string, string>,
    @Res() reply: FastifyReply,
  ) {
    const doc = await this.svc.renderVisitOrdersPdf(req.tenantId!, req.authContext!.userId!, visitId, query);
    void reply
      .status(200)
      .header('content-type', 'application/pdf')
      .header('content-disposition', `inline; filename="ClinicalOrders-${visitId.slice(0, 8)}.pdf"`)
      .send(doc.bytes);
  }


  // ── Certificates / referrals ──────────────────────────────────────────────
  @RequirePermission('clinical.certificate.create')
  @Post('visits/:id/certificates')
  async issueCertificate(@Req() req: RequestWithAuth, @Param('id') visitId: string, @Body(new ZodValidationPipe(IssueCertificateSchema)) dto: IssueCertificateRequest) {
    return this.svc.issueCertificate(req.tenantId!, req.authContext!.userId!, visitId, dto);
  }

  @RequirePermission('clinical.certificate.void')
  @Patch('certificates/:id/void')
  async voidCertificate(@Req() req: RequestWithAuth, @Param('id') id: string, @Body(new ZodValidationPipe(VoidCertificateSchema)) dto: VoidCertificateRequest) {
    return this.svc.voidCertificate(req.tenantId!, req.authContext!.userId!, id, dto);
  }

  @RequirePermission('clinical.certificate.read')
  @Get('certificates/:id/print')
  async getCertificatePrint(@Req() req: RequestWithAuth, @Param('id') id: string) {
    return this.svc.getCertificatePrint(req.tenantId!, req.authContext!.userId!, id);
  }

  @RequirePermission('clinical.referral.create')
  @Post('visits/:id/referrals')
  async createReferral(@Req() req: RequestWithAuth, @Param('id') visitId: string, @Body(new ZodValidationPipe(CreateReferralSchema)) dto: CreateReferralRequest) {
    return this.svc.createReferral(req.tenantId!, req.authContext!.userId!, visitId, dto);
  }

  // ── Clinical Templates & Order Sets ───────────────────────────────────────
  @RequirePermission('clinical.template.create')
  @Post('templates')
  async createClinicalTemplate(@Req() req: RequestWithAuth, @Body(new ZodValidationPipe(CreateClinicalTemplateSchema)) dto: CreateClinicalTemplateRequest) {
    return this.svc.createClinicalTemplate(req.tenantId!, req.authContext!.userId!, dto);
  }

  @RequirePermission('clinical.template.read')
  @Get('templates')
  async listClinicalTemplates(@Req() req: RequestWithAuth, @Query('practitionerId') practitionerId?: string) {
    return this.svc.listClinicalTemplates(req.tenantId!, req.authContext!.userId!, practitionerId);
  }

  @RequirePermission('clinical.order_set.create')
  @Post('order-sets')
  async createOrderSet(@Req() req: RequestWithAuth, @Body(new ZodValidationPipe(CreateOrderSetSchema)) dto: CreateOrderSetRequest) {
    return this.svc.createOrderSet(req.tenantId!, req.authContext!.userId!, dto);
  }

  @RequirePermission('clinical.order_set.read')
  @Get('order-sets')
  async listOrderSets(@Req() req: RequestWithAuth) {
    return this.svc.listOrderSets(req.tenantId!, req.authContext!.userId!);
  }

  // ── Charge capture (Appendix A2) ──────────────────────────────────────────
  @RequirePermission('clinical.visit.update')
  @Post('charges')
  @ApiOperation({ summary: 'billing.charge.create — billed modules post here' })
  async createCharge(@Req() req: RequestWithAuth, @Body(new ZodValidationPipe(CreateChargeSchema)) dto: CreateChargeRequest) {
    return this.svc.createCharge(req.tenantId!, req.authContext!.userId!, dto);
  }
}
