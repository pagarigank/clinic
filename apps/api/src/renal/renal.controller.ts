import {
  Inject,
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Req,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '../auth/guards/auth.guard.js';
import { TenantContextGuard } from '../auth/guards/tenant-context.guard.js';
import { Module } from '../rbac/module.guard.js';
import { RequirePermission } from '../rbac/require-permission.decorator.js';
import { RequireStepUp, type RequestWithAuth } from '../auth/auth-context.js';
import { RenalService } from './renal.service.js';
import {
  CreateRenalStationSchema, type CreateRenalStationRequest,
  UpdateRenalStationSchema, type UpdateRenalStationRequest,
  CreateDialysisMachineSchema, type CreateDialysisMachineRequest,
  UpdateDialysisMachineSchema, type UpdateDialysisMachineRequest,
  ServiceDialysisMachineSchema, type ServiceDialysisMachineRequest,
  CreateVascularAccessSchema, type CreateVascularAccessRequest,
  UpdateVascularAccessSchema, type UpdateVascularAccessRequest,
  CreateAccessAssessmentSchema, type CreateAccessAssessmentRequest,
  CreateDialysisPrescriptionSchema, type CreateDialysisPrescriptionRequest,
  UpdateDialysisPrescriptionSchema, type UpdateDialysisPrescriptionRequest,
  SignDialysisPrescriptionSchema, type SignDialysisPrescriptionRequest,
  AmendDialysisPrescriptionSchema, type AmendDialysisPrescriptionRequest,
  CreateDialysisShiftSchema, type CreateDialysisShiftRequest,
  CreateDialysisScheduleSchema, type CreateDialysisScheduleRequest,
  CreateDialyzerSchema, type CreateDialyzerRequest,
  ReprocessDialyzerSchema, type ReprocessDialyzerRequest,
  DiscardDialyzerSchema, type DiscardDialyzerRequest,
  CreateWaterTreatmentLogSchema, type CreateWaterTreatmentLogRequest,
  CreateWaterLabTestSchema, type CreateWaterLabTestRequest,
  CreateDialysisSessionSchema, type CreateDialysisSessionRequest,
  PreDialysisIntakeSchema, type PreDialysisIntakeRequest,
  RecordFlowsheetSchema, type RecordFlowsheetRequest,
  PostDialysisCloseSchema, type PostDialysisCloseRequest,
  CancelDialysisSessionSchema, type CancelDialysisSessionRequest,
  PhilHealthDialysisClaimSchema, type PhilHealthDialysisClaimRequest,
} from '@clinic/contracts';
import { ZodValidationPipe } from '../http/zod-validation.pipe.js';

@ApiTags('Renal Care')
@ApiBearerAuth()
@Controller('renal')
@UseGuards(AuthGuard, TenantContextGuard)
@Module('renal')
export class RenalController {
  constructor(
    @Inject(RenalService) private readonly svc: RenalService,
  ) {}

  // ── Stations ───────────────────────────────────────────────────────────────

  @RequirePermission('renal.station.read')
  @Get('stations')
  @ApiOperation({ summary: 'List renal stations' })
  async listStations(
    @Req() req: RequestWithAuth,
    @Query('branchId') branchId?: string,
  ) {
    return this.svc.listStations(req.tenantId!, branchId);
  }

  @RequirePermission('renal.station.create')
  @Post('stations')
  @ApiOperation({ summary: 'Create renal station' })
  async createStation(
    @Req() req: RequestWithAuth,
    @Body(new ZodValidationPipe(CreateRenalStationSchema)) dto: CreateRenalStationRequest,
  ) {
    return this.svc.createStation(req.tenantId!, dto);
  }

  @RequirePermission('renal.station.update')
  @Patch('stations/:id')
  @ApiOperation({ summary: 'Update renal station' })
  async updateStation(
    @Req() req: RequestWithAuth,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateRenalStationSchema)) dto: UpdateRenalStationRequest,
  ) {
    return this.svc.updateStation(req.tenantId!, id, dto);
  }

  @RequirePermission('renal.station.archive')
  @Delete('stations/:id')
  @ApiOperation({ summary: 'Archive renal station' })
  async archiveStation(
    @Req() req: RequestWithAuth,
    @Param('id') id: string,
  ) {
    return this.svc.archiveStation(req.tenantId!, id);
  }

  // ── Dialysis Machines ──────────────────────────────────────────────────────

  @RequirePermission('renal.machine.read')
  @Get('machines')
  @ApiOperation({ summary: 'List dialysis machines' })
  async listMachines(
    @Req() req: RequestWithAuth,
    @Query('branchId') branchId?: string,
  ) {
    return this.svc.listMachines(req.tenantId!, branchId);
  }

  @RequirePermission('renal.machine.create')
  @Post('machines')
  @ApiOperation({ summary: 'Register dialysis machine' })
  async createMachine(
    @Req() req: RequestWithAuth,
    @Body(new ZodValidationPipe(CreateDialysisMachineSchema)) dto: CreateDialysisMachineRequest,
  ) {
    return this.svc.createMachine(req.tenantId!, dto);
  }

  @RequirePermission('renal.machine.update')
  @Patch('machines/:id')
  @ApiOperation({ summary: 'Update dialysis machine' })
  async updateMachine(
    @Req() req: RequestWithAuth,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateDialysisMachineSchema)) dto: UpdateDialysisMachineRequest,
  ) {
    return this.svc.updateMachine(req.tenantId!, id, dto);
  }

  @RequirePermission('renal.machine.service')
  @Post('machines/:id/service')
  @ApiOperation({ summary: 'Record machine service or disinfection' })
  async serviceMachine(
    @Req() req: RequestWithAuth,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ServiceDialysisMachineSchema)) dto: ServiceDialysisMachineRequest,
  ) {
    return this.svc.serviceMachine(req.tenantId!, id, dto);
  }

  // ── Shifts & Schedules ─────────────────────────────────────────────────────

  @RequirePermission('renal.schedule.read')
  @Get('shifts')
  @ApiOperation({ summary: 'List dialysis shifts' })
  async listShifts(
    @Req() req: RequestWithAuth,
    @Query('branchId') branchId?: string,
  ) {
    return this.svc.listShifts(req.tenantId!, branchId);
  }

  @RequirePermission('renal.schedule.create')
  @Post('shifts')
  @ApiOperation({ summary: 'Create dialysis shift template' })
  async createShift(
    @Req() req: RequestWithAuth,
    @Body(new ZodValidationPipe(CreateDialysisShiftSchema)) dto: CreateDialysisShiftRequest,
  ) {
    return this.svc.createShift(req.tenantId!, dto);
  }

  @RequirePermission('renal.schedule.read')
  @Get('schedules')
  @ApiOperation({ summary: 'List dialysis chair schedules' })
  async listSchedules(
    @Req() req: RequestWithAuth,
    @Query('branchId') branchId?: string,
    @Query('stationId') stationId?: string,
  ) {
    return this.svc.listSchedules(req.tenantId!, branchId, stationId);
  }

  @RequirePermission('renal.schedule.create')
  @Post('schedules')
  @ApiOperation({ summary: 'Create recurring chair schedule' })
  async createSchedule(
    @Req() req: RequestWithAuth,
    @Body(new ZodValidationPipe(CreateDialysisScheduleSchema)) dto: CreateDialysisScheduleRequest,
  ) {
    return this.svc.createSchedule(req.tenantId!, dto);
  }

  // ── Vascular Accesses ──────────────────────────────────────────────────────

  @RequirePermission('renal.access.read')
  @Get('accesses')
  @ApiOperation({ summary: 'List vascular access records for patient' })
  async listAccesses(
    @Req() req: RequestWithAuth,
    @Query('patientId') patientId: string,
  ) {
    return this.svc.listAccesses(req.tenantId!, patientId);
  }

  @RequirePermission('renal.access.create')
  @Post('accesses')
  @ApiOperation({ summary: 'Register vascular access' })
  async createAccess(
    @Req() req: RequestWithAuth,
    @Body(new ZodValidationPipe(CreateVascularAccessSchema)) dto: CreateVascularAccessRequest,
  ) {
    return this.svc.createAccess(req.tenantId!, dto);
  }

  @RequirePermission('renal.access.update')
  @Patch('accesses/:id')
  @ApiOperation({ summary: 'Update vascular access status or notes' })
  async updateAccess(
    @Req() req: RequestWithAuth,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateVascularAccessSchema)) dto: UpdateVascularAccessRequest,
  ) {
    return this.svc.updateAccess(req.tenantId!, id, dto);
  }

  @RequirePermission('renal.access.create')
  @Post('accesses/:id/assessments')
  @ApiOperation({ summary: 'Record pre-cannulation access physical exam' })
  async createAssessment(
    @Req() req: RequestWithAuth,
    @Param('id') accessId: string,
    @Body(new ZodValidationPipe(CreateAccessAssessmentSchema)) dto: CreateAccessAssessmentRequest,
  ) {
    return this.svc.createAssessment(req.tenantId!, accessId, dto);
  }

  // ── Prescriptions ──────────────────────────────────────────────────────────

  @RequirePermission('renal.prescription.read')
  @Get('prescriptions')
  @ApiOperation({ summary: 'List prescriptions for patient' })
  async listPrescriptions(
    @Req() req: RequestWithAuth,
    @Query('patientId') patientId: string,
  ) {
    return this.svc.listPrescriptions(req.tenantId!, patientId);
  }

  @RequirePermission('renal.prescription.read')
  @Get('prescriptions/:id')
  @ApiOperation({ summary: 'Get prescription details' })
  async getPrescription(
    @Req() req: RequestWithAuth,
    @Param('id') id: string,
  ) {
    return this.svc.getPrescription(req.tenantId!, id);
  }

  @RequirePermission('renal.prescription.create')
  @Post('prescriptions')
  @ApiOperation({ summary: 'Draft dialysis prescription' })
  async createPrescription(
    @Req() req: RequestWithAuth,
    @Body(new ZodValidationPipe(CreateDialysisPrescriptionSchema)) dto: CreateDialysisPrescriptionRequest,
  ) {
    return this.svc.createPrescription(req.tenantId!, dto);
  }

  @RequirePermission('renal.prescription.update')
  @Patch('prescriptions/:id')
  @ApiOperation({ summary: 'Update draft dialysis prescription' })
  async updatePrescription(
    @Req() req: RequestWithAuth,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateDialysisPrescriptionSchema)) dto: UpdateDialysisPrescriptionRequest,
  ) {
    return this.svc.updatePrescription(req.tenantId!, id, dto);
  }

  @RequirePermission('renal.prescription.sign')
  @RequireStepUp()
  @Post('prescriptions/:id/sign')
  @ApiOperation({ summary: 'Sign and activate dialysis prescription (requires step-up)' })
  async signPrescription(
    @Req() req: RequestWithAuth,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(SignDialysisPrescriptionSchema)) dto: SignDialysisPrescriptionRequest,
  ) {
    return this.svc.signPrescription(req.tenantId!, id, dto);
  }

  @RequirePermission('renal.prescription.amend')
  @RequireStepUp()
  @Post('prescriptions/:id/amend')
  @ApiOperation({ summary: 'Amend active dialysis prescription (requires step-up)' })
  async amendPrescription(
    @Req() req: RequestWithAuth,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(AmendDialysisPrescriptionSchema)) dto: AmendDialysisPrescriptionRequest,
  ) {
    return this.svc.amendPrescription(req.tenantId!, id, dto);
  }

  // ── Dialyzers & Reprocessing (ADR-12 / R-REN-01, R-REN-03) ──────────────────

  @RequirePermission('renal.dialyzer.read')
  @Get('dialyzers')
  @ApiOperation({ summary: 'List dialyzers' })
  async listDialyzers(
    @Req() req: RequestWithAuth,
    @Query('patientId') patientId?: string,
  ) {
    return this.svc.listDialyzers(req.tenantId!, patientId);
  }

  @RequirePermission('renal.dialyzer.create')
  @Post('dialyzers')
  @ApiOperation({ summary: 'Register new dialyzer with baseline volume' })
  async createDialyzer(
    @Req() req: RequestWithAuth,
    @Body(new ZodValidationPipe(CreateDialyzerSchema)) dto: CreateDialyzerRequest,
  ) {
    return this.svc.createDialyzer(req.tenantId!, dto);
  }

  @RequirePermission('renal.dialyzer.reprocess')
  @Post('dialyzers/:id/reprocess')
  @ApiOperation({ summary: 'Record reprocessing with bundle volume and leak test' })
  async reprocessDialyzer(
    @Req() req: RequestWithAuth,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ReprocessDialyzerSchema)) dto: ReprocessDialyzerRequest,
  ) {
    return this.svc.reprocessDialyzer(req.tenantId!, id, dto);
  }

  @RequirePermission('renal.dialyzer.discard')
  @Post('dialyzers/:id/discard')
  @ApiOperation({ summary: 'Discard dialyzer' })
  async discardDialyzer(
    @Req() req: RequestWithAuth,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(DiscardDialyzerSchema)) dto: DiscardDialyzerRequest,
  ) {
    return this.svc.discardDialyzer(req.tenantId!, id, dto);
  }

  // ── Water Treatment Safety & Quality (R-REN-02 / AC-31) ─────────────────────

  @RequirePermission('renal.water.read')
  @Get('water-logs')
  @ApiOperation({ summary: 'List pre-shift water treatment logs' })
  async listWaterLogs(
    @Req() req: RequestWithAuth,
    @Query('branchId') branchId?: string,
  ) {
    return this.svc.listWaterTreatmentLogs(req.tenantId!, branchId);
  }

  @RequirePermission('renal.water.create')
  @Post('water-logs')
  @ApiOperation({ summary: 'Record pre-shift water treatment test (chlorine breakthrough gate)' })
  async createWaterLog(
    @Req() req: RequestWithAuth,
    @Body(new ZodValidationPipe(CreateWaterTreatmentLogSchema)) dto: CreateWaterTreatmentLogRequest,
  ) {
    return this.svc.createWaterTreatmentLog(req.tenantId!, dto);
  }

  @RequirePermission('renal.water.read')
  @Get('water-tests')
  @ApiOperation({ summary: 'List water and dialysate microbiological surveillance tests' })
  async listWaterTests(
    @Req() req: RequestWithAuth,
    @Query('branchId') branchId?: string,
  ) {
    return this.svc.listWaterLabTests(req.tenantId!, branchId);
  }

  @RequirePermission('renal.water.create')
  @Post('water-tests')
  @ApiOperation({ summary: 'Record water endotoxin or bacteriological lab test' })
  async createWaterTest(
    @Req() req: RequestWithAuth,
    @Body(new ZodValidationPipe(CreateWaterLabTestSchema)) dto: CreateWaterLabTestRequest,
  ) {
    return this.svc.createWaterLabTest(req.tenantId!, dto);
  }

  // ── Dialysis Sessions Worklist & Flowsheet (AC-29, AC-30, AC-31, AC-32) ──────

  @RequirePermission('renal.session.read')
  @Get('sessions')
  @ApiOperation({ summary: 'List dialysis treatment sessions' })
  async listSessions(
    @Req() req: RequestWithAuth,
    @Query('branchId') branchId?: string,
    @Query('scheduledDate') scheduledDate?: string,
    @Query('status') status?: string,
    @Query('patientId') patientId?: string,
  ) {
    return this.svc.listSessions(req.tenantId!, { branchId, scheduledDate, status, patientId });
  }

  @RequirePermission('renal.session.read')
  @Get('sessions/:id')
  @ApiOperation({ summary: 'Get session details including pre-assessment, flowsheet, and post-assessment' })
  async getSession(
    @Req() req: RequestWithAuth,
    @Param('id') id: string,
  ) {
    return this.svc.getSession(req.tenantId!, id);
  }

  @RequirePermission('renal.session.create')
  @Post('sessions')
  @ApiOperation({ summary: 'Schedule dialysis treatment session' })
  async createSession(
    @Req() req: RequestWithAuth,
    @Body(new ZodValidationPipe(CreateDialysisSessionSchema)) dto: CreateDialysisSessionRequest,
  ) {
    return this.svc.createSession(req.tenantId!, dto);
  }

  @RequirePermission('renal.session.start')
  @Post('sessions/:id/pre-dialysis')
  @ApiOperation({ summary: 'Pre-dialysis intake & clinical safety gate (asserts chlorine < 0.1 ppm and dialyzer >= 80%)' })
  async startPreDialysis(
    @Req() req: RequestWithAuth,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(PreDialysisIntakeSchema)) dto: PreDialysisIntakeRequest,
  ) {
    return this.svc.startPreDialysis(req.tenantId!, id, dto);
  }

  @RequirePermission('renal.session.record')
  @Post('sessions/:id/flowsheet')
  @ApiOperation({ summary: 'Log intra-dialytic flowsheet entry (BP, pressures, TMP, blood flow, UF removed)' })
  async recordFlowsheet(
    @Req() req: RequestWithAuth,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(RecordFlowsheetSchema)) dto: RecordFlowsheetRequest,
  ) {
    return this.svc.recordFlowsheet(req.tenantId!, id, dto);
  }

  @RequirePermission('renal.session.complete')
  @Post('sessions/:id/post-dialysis')
  @ApiOperation({ summary: 'Post-dialysis close: discharge vitals, charge capture, and PhilHealth 156-session counter update' })
  async completePostDialysis(
    @Req() req: RequestWithAuth,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(PostDialysisCloseSchema)) dto: PostDialysisCloseRequest,
  ) {
    return this.svc.completePostDialysis(req.tenantId!, id, dto);
  }

  @RequirePermission('renal.session.cancel')
  @Post('sessions/:id/cancel')
  @ApiOperation({ summary: 'Cancel dialysis treatment session' })
  async cancelSession(
    @Req() req: RequestWithAuth,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(CancelDialysisSessionSchema)) dto: CancelDialysisSessionRequest,
  ) {
    return this.svc.cancelSession(req.tenantId!, id, dto);
  }

  // ── PhilHealth 156-session benefit ceiling & claims (AC-32) ──────────────────

  @RequirePermission('renal.claim.read')
  @Get('patients/:id/philhealth-usage')
  @ApiOperation({ summary: 'Get patient current calendar year PhilHealth hemodialysis session count (1…156)' })
  async getPhilHealthUsage(
    @Req() req: RequestWithAuth,
    @Param('id') patientId: string,
    @Query('year') year?: string,
  ) {
    const y = year ? parseInt(year, 10) : undefined;
    return this.svc.getPhilHealthUsage(req.tenantId!, patientId, y);
  }

  @RequirePermission('renal.claim.create')
  @Post('sessions/:id/claim')
  @ApiOperation({ summary: 'Generate or update PhilHealth dialysis claim document' })
  async generateClaim(
    @Req() req: RequestWithAuth,
    @Param('id') sessionId: string,
    @Body(new ZodValidationPipe(PhilHealthDialysisClaimSchema)) dto: PhilHealthDialysisClaimRequest,
  ) {
    return this.svc.generateClaim(req.tenantId!, sessionId, dto);
  }
}
