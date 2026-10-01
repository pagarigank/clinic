import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards, Req } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ZodValidationPipe } from '../http/zod-validation.pipe.js';
import { AuthGuard } from '../auth/guards/auth.guard.js';
import { TenantContextGuard } from '../auth/guards/tenant-context.guard.js';
import { Module } from '../rbac/module.guard.js';
import { PatientsService } from './patients.service.js';
import type { RequestWithAuth } from '../auth/auth-context.js';
import {
  CreatePatientSchema, type CreatePatientRequest,
  UpdatePatientSchema, type UpdatePatientRequest,
  DeactivatePatientSchema, type DeactivatePatientRequest,
  MarkDeceasedSchema, type MarkDeceasedRequest,
  AddIdentifierSchema, type AddIdentifierRequest,
  RevealIdentifierSchema, type RevealIdentifierRequest,
  AddContactSchema, type AddContactRequest,
  AddAllergySchema, type AddAllergyRequest,
  AddFlagSchema, type AddFlagRequest,
  AcknowledgeDuplicatesSchema, type AcknowledgeDuplicatesRequest,
  MergePatientSchema, type MergePatientRequest,
  ConsentCaptureSchema, type ConsentCaptureRequest,
  ConsentWithdrawSchema, type ConsentWithdrawRequest,
  PhilHealthDataSchema, type PhilHealthDataRequest,
  PhilHealthDependentSchema, type PhilHealthDependentRequest,
} from '@clinic/contracts';

@ApiTags('Patients')
@ApiBearerAuth()
@Controller('patients')
@UseGuards(AuthGuard, TenantContextGuard)
@Module('patients')
export class PatientsController {
  constructor(private readonly patientsService: PatientsService) {}

  // ── Core patient CRUD ──────────────────────────────────────────────────────

  @Get()
  @ApiOperation({ summary: 'List / search patients (cursor-paginated)' })
  async listPatients(
    @Req() req: RequestWithAuth,
    @Query('q') q?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.patientsService.listPatients(req.tenantId!, req.authContext!.userId!, q, cursor);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a patient with sub-resources' })
  async getPatient(
    @Req() req: RequestWithAuth,
    @Param('id') id: string,
  ) {
    return this.patientsService.getPatient(req.tenantId!, req.authContext!.userId!, id);
  }

  @Post()
  @ApiOperation({ summary: 'Create a patient (standard or emergency registration)' })
  async createPatient(
    @Req() req: RequestWithAuth,
    @Body(new ZodValidationPipe(CreatePatientSchema)) dto: CreatePatientRequest,
  ) {
    return this.patientsService.createPatient(req.tenantId!, req.authContext!.userId!, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update patient demographics (optimistic concurrency)' })
  async updatePatient(
    @Req() req: RequestWithAuth,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdatePatientSchema)) dto: UpdatePatientRequest,
  ) {
    return this.patientsService.updatePatient(req.tenantId!, req.authContext!.userId!, id, dto);
  }

  @Patch(':id/deactivate')
  @ApiOperation({ summary: 'Deactivate a patient (append-only — no delete)' })
  async deactivatePatient(
    @Req() req: RequestWithAuth,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(DeactivatePatientSchema)) dto: DeactivatePatientRequest,
  ) {
    return this.patientsService.deactivatePatient(req.tenantId!, req.authContext!.userId!, id, dto);
  }

  @Patch(':id/mark-deceased')
  @ApiOperation({ summary: 'Mark patient as deceased (no delete)' })
  async markDeceased(
    @Req() req: RequestWithAuth,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(MarkDeceasedSchema)) dto: MarkDeceasedRequest,
  ) {
    return this.patientsService.markDeceased(req.tenantId!, req.authContext!.userId!, id, dto);
  }

  // ── Identifiers ────────────────────────────────────────────────────────────

  @Post(':id/identifiers')
  @ApiOperation({ summary: 'Add a patient identifier' })
  async addIdentifier(
    @Req() req: RequestWithAuth,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(AddIdentifierSchema)) dto: AddIdentifierRequest,
  ) {
    return this.patientsService.addIdentifier(req.tenantId!, req.authContext!.userId!, id, dto);
  }

  @Post(':id/identifiers/:iid/reveal')
  @ApiOperation({ summary: 'Reveal a masked identifier with audited reason' })
  async revealIdentifier(
    @Req() req: RequestWithAuth,
    @Param('id') id: string,
    @Param('iid') iid: string,
    @Body(new ZodValidationPipe(RevealIdentifierSchema)) dto: RevealIdentifierRequest,
  ) {
    return this.patientsService.revealIdentifier(req.tenantId!, req.authContext!.userId!, id, iid, dto);
  }

  // ── Contacts ───────────────────────────────────────────────────────────────

  @Post(':id/contacts')
  @ApiOperation({ summary: 'Add a patient contact' })
  async addContact(
    @Req() req: RequestWithAuth,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(AddContactSchema)) dto: AddContactRequest,
  ) {
    return this.patientsService.addContact(req.tenantId!, req.authContext!.userId!, id, dto);
  }

  // ── Allergies ──────────────────────────────────────────────────────────────

  @Post(':id/allergies')
  @ApiOperation({ summary: 'Add a patient allergy' })
  async addAllergy(
    @Req() req: RequestWithAuth,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(AddAllergySchema)) dto: AddAllergyRequest,
  ) {
    return this.patientsService.addAllergy(req.tenantId!, req.authContext!.userId!, id, dto);
  }

  // ── Flags ──────────────────────────────────────────────────────────────────

  @Post(':id/flags')
  @ApiOperation({ summary: 'Add a patient flag' })
  async addFlag(
    @Req() req: RequestWithAuth,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(AddFlagSchema)) dto: AddFlagRequest,
  ) {
    return this.patientsService.addFlag(req.tenantId!, req.authContext!.userId!, id, dto);
  }

  // ── Duplicate detection ────────────────────────────────────────────────────

  @Get(':id/duplicates')
  @ApiOperation({ summary: 'Find duplicate candidates for a patient using trigram similarity' })
  async findDuplicates(
    @Req() req: RequestWithAuth,
    @Param('id') id: string,
  ) {
    return this.patientsService.findDuplicates(req.tenantId!, req.authContext!.userId!, id);
  }

  @Post(':id/duplicates/acknowledge')
  @ApiOperation({ summary: 'Acknowledge duplicate candidates (records reason, no merge)' })
  async acknowledgeDuplicates(
    @Req() req: RequestWithAuth,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(AcknowledgeDuplicatesSchema)) dto: AcknowledgeDuplicatesRequest,
  ) {
    return this.patientsService.acknowledgeDuplicates(req.tenantId!, req.authContext!.userId!, id, dto);
  }

  // ── Merge / unmerge ────────────────────────────────────────────────────────

  @Post('merges')
  @ApiOperation({ summary: 'Merge two patients (snapshot enables unmerge)' })
  async mergePatients(
    @Req() req: RequestWithAuth,
    @Body(new ZodValidationPipe(MergePatientSchema)) dto: MergePatientRequest,
  ) {
    return this.patientsService.mergePatients(req.tenantId!, req.authContext!.userId!, dto);
  }

  @Post('merges/:mergeId/unmerge')
  @ApiOperation({ summary: 'Reverse a merge within the allowed window' })
  async unmergePatients(
    @Req() req: RequestWithAuth,
    @Param('mergeId') mergeId: string,
  ) {
    return this.patientsService.unmergePatients(req.tenantId!, req.authContext!.userId!, mergeId);
  }

  // ── Consents ───────────────────────────────────────────────────────────────

  @Post(':id/consents')
  @ApiOperation({ summary: 'Capture patient consent' })
  async captureConsent(
    @Req() req: RequestWithAuth,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ConsentCaptureSchema)) dto: ConsentCaptureRequest,
  ) {
    return this.patientsService.captureConsent(req.tenantId!, req.authContext!.userId!, id, dto);
  }

  @Patch(':id/consents/:cid/withdraw')
  @ApiOperation({ summary: 'Withdraw an active consent' })
  async withdrawConsent(
    @Req() req: RequestWithAuth,
    @Param('id') id: string,
    @Param('cid') cid: string,
    @Body(new ZodValidationPipe(ConsentWithdrawSchema)) dto: ConsentWithdrawRequest,
  ) {
    return this.patientsService.withdrawConsent(req.tenantId!, req.authContext!.userId!, id, cid, dto);
  }

  // ── PhilHealth ─────────────────────────────────────────────────────────────

  @Post(':id/philhealth')
  @ApiOperation({ summary: 'Upsert PhilHealth member data' })
  async upsertPhilHealth(
    @Req() req: RequestWithAuth,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(PhilHealthDataSchema)) dto: PhilHealthDataRequest,
  ) {
    return this.patientsService.upsertPhilHealth(req.tenantId!, req.authContext!.userId!, id, dto);
  }

  @Post(':id/philhealth/dependents')
  @ApiOperation({ summary: 'Add a PhilHealth dependent' })
  async addPhilHealthDependent(
    @Req() req: RequestWithAuth,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(PhilHealthDependentSchema)) dto: PhilHealthDependentRequest,
  ) {
    return this.patientsService.addPhilHealthDependent(req.tenantId!, req.authContext!.userId!, id, dto);
  }
}
