import { z } from "zod";

// ── 1. Renal Stations ────────────────────────────────────────────────────────

export const CreateRenalStationSchema = z.object({
  branchId: z.string().uuid(),
  stationNo: z.string().min(1).max(50),
  name: z.string().min(1).max(100),
  room: z.string().max(100).optional().nullable(),
  isIsolation: z.boolean().default(false),
  isActive: z.boolean().default(true),
});
export type CreateRenalStationRequest = z.input<typeof CreateRenalStationSchema>;

export const UpdateRenalStationSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  room: z.string().max(100).optional().nullable(),
  isIsolation: z.boolean().optional(),
  isActive: z.boolean().optional(),
});
export type UpdateRenalStationRequest = z.input<typeof UpdateRenalStationSchema>;

// ── 2. Dialysis Machines ──────────────────────────────────────────────────────

export const DialysisMachineStatusEnum = z.enum(["ACTIVE", "MAINTENANCE", "QUARANTINE", "DECOMMISSIONED"]);
export type DialysisMachineStatus = z.infer<typeof DialysisMachineStatusEnum>;

export const CreateDialysisMachineSchema = z.object({
  branchId: z.string().uuid(),
  stationId: z.string().uuid().optional().nullable(),
  serialNo: z.string().min(1).max(100),
  brand: z.string().min(1).max(100),
  model: z.string().min(1).max(100),
  totalOperatingHours: z.number().nonnegative().default(0),
  isIsolation: z.boolean().default(false),
});
export type CreateDialysisMachineRequest = z.input<typeof CreateDialysisMachineSchema>;

export const UpdateDialysisMachineSchema = z.object({
  stationId: z.string().uuid().optional().nullable(),
  brand: z.string().min(1).max(100).optional(),
  model: z.string().min(1).max(100).optional(),
  totalOperatingHours: z.number().nonnegative().optional(),
  status: DialysisMachineStatusEnum.optional(),
  isIsolation: z.boolean().optional(),
});
export type UpdateDialysisMachineRequest = z.input<typeof UpdateDialysisMachineSchema>;

export const ServiceDialysisMachineSchema = z.object({
  serviceType: z.enum(["DISINFECTION", "PREVENTIVE_MAINTENANCE", "REPAIR", "CALIBRATION"]),
  notes: z.string().optional().nullable(),
  operatingHoursDelta: z.number().nonnegative().optional().default(0),
  statusAfterService: DialysisMachineStatusEnum.default("ACTIVE"),
});
export type ServiceDialysisMachineRequest = z.input<typeof ServiceDialysisMachineSchema>;

// ── 3. Vascular Accesses ──────────────────────────────────────────────────────

export const VascularAccessTypeEnum = z.enum(["AV_FISTULA", "AV_GRAFT", "TUNNELED_CATHETER", "TEMPORARY_CATHETER"]);
export type VascularAccessType = z.infer<typeof VascularAccessTypeEnum>;

export const VascularAccessSideEnum = z.enum(["LEFT", "RIGHT"]);
export type VascularAccessSide = z.infer<typeof VascularAccessSideEnum>;

export const VascularAccessStatusEnum = z.enum(["MATURING", "ACTIVE", "FAILED", "ABANDONED"]);
export type VascularAccessStatus = z.infer<typeof VascularAccessStatusEnum>;

export const CreateVascularAccessSchema = z.object({
  patientId: z.string().uuid(),
  accessType: VascularAccessTypeEnum,
  anatomicalSite: z.string().min(1).max(100),
  side: VascularAccessSideEnum,
  createdDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  surgeonName: z.string().max(150).optional().nullable(),
  status: VascularAccessStatusEnum.default("MATURING"),
  notes: z.string().optional().nullable(),
});
export type CreateVascularAccessRequest = z.input<typeof CreateVascularAccessSchema>;

export const UpdateVascularAccessSchema = z.object({
  status: VascularAccessStatusEnum.optional(),
  notes: z.string().optional().nullable(),
});
export type UpdateVascularAccessRequest = z.input<typeof UpdateVascularAccessSchema>;

export const CreateAccessAssessmentSchema = z.object({
  assessedBy: z.string().uuid(),
  thrillPresent: z.boolean(),
  bruitPresent: z.boolean(),
  signsOfInfection: z.boolean().default(false),
  cannulationComplication: z.string().optional().nullable(),
  interventionNotes: z.string().optional().nullable(),
});
export type CreateAccessAssessmentRequest = z.input<typeof CreateAccessAssessmentSchema>;

// ── 4. Dialysis Prescriptions ────────────────────────────────────────────────

export const DialysisModalityEnum = z.enum(["HD", "HDF"]);
export type DialysisModality = z.infer<typeof DialysisModalityEnum>;

export const PrescriptionStatusEnum = z.enum(["DRAFT", "ACTIVE", "SUPERSEDED", "CANCELLED"]);
export type PrescriptionStatus = z.infer<typeof PrescriptionStatusEnum>;

export const CreateDialysisPrescriptionSchema = z.object({
  patientId: z.string().uuid(),
  nephrologistId: z.string().uuid(),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).default(() => new Date().toISOString().slice(0, 10)),
  effectiveTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  modality: DialysisModalityEnum.default("HD"),
  frequencyPerWeek: z.number().int().min(1).max(7).default(3),
  durationMinutes: z.number().int().min(60).max(480).default(240),
  targetDryWeightKg: z.number().positive().max(300),
  dialyzerModel: z.string().min(1).max(100),
  dialysateFormula: z.string().min(1).max(100).default("STANDARD"),
  potassiumMeq: z.number().optional().nullable(),
  calciumMeq: z.number().optional().nullable(),
  sodiumMeq: z.number().optional().nullable(),
  bicarbonateMeq: z.number().optional().nullable(),
  bloodFlowRateTarget: z.number().int().min(100).max(600).default(300),
  dialysateFlowRateTarget: z.number().int().min(300).max(1000).default(500),
  heparinBolusUnits: z.number().int().nonnegative().optional().nullable(),
  heparinHourlyUnits: z.number().int().nonnegative().optional().nullable(),
  isHeparinFree: z.boolean().default(false),
  hbvHbsagPositive: z.boolean().default(false),
  notes: z.string().optional().nullable(),
});
export type CreateDialysisPrescriptionRequest = z.input<typeof CreateDialysisPrescriptionSchema>;

export const UpdateDialysisPrescriptionSchema = CreateDialysisPrescriptionSchema.partial().omit({ patientId: true });
export type UpdateDialysisPrescriptionRequest = z.input<typeof UpdateDialysisPrescriptionSchema>;

export const SignDialysisPrescriptionSchema = z.object({
  signedBy: z.string().uuid(),
});
export type SignDialysisPrescriptionRequest = z.input<typeof SignDialysisPrescriptionSchema>;

export const AmendDialysisPrescriptionSchema = z.object({
  amendedBy: z.string().uuid(),
  amendmentReason: z.string().min(5),
  newPrescription: CreateDialysisPrescriptionSchema.omit({ patientId: true }),
});
export type AmendDialysisPrescriptionRequest = z.input<typeof AmendDialysisPrescriptionSchema>;

// ── 5. Dialysis Shifts & Schedules ───────────────────────────────────────────

export const CreateDialysisShiftSchema = z.object({
  branchId: z.string().uuid(),
  shiftName: z.string().min(1).max(100),
  startTime: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
  endTime: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).default([1, 2, 3, 4, 5, 6]),
  isActive: z.boolean().default(true),
});
export type CreateDialysisShiftRequest = z.input<typeof CreateDialysisShiftSchema>;

export const CreateDialysisScheduleSchema = z.object({
  patientId: z.string().uuid(),
  branchId: z.string().uuid(),
  stationId: z.string().uuid(),
  shiftId: z.string().uuid(),
  dayOfWeek: z.number().int().min(0).max(6), // 0 = Sun, 1 = Mon ...
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).default(() => new Date().toISOString().slice(0, 10)),
  effectiveTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
});
export type CreateDialysisScheduleRequest = z.input<typeof CreateDialysisScheduleSchema>;

// ── 6. Dialyzers & Reprocessing (ADR-12 / R-REN-01, R-REN-03) ────────────────

export const DialyzerStatusEnum = z.enum(["IN_USE", "PENDING_REPROCESS", "CLEANED_READY", "DISCARDED"]);
export type DialyzerStatus = z.infer<typeof DialyzerStatusEnum>;

export const CreateDialyzerSchema = z.object({
  patientId: z.string().uuid(), // strict single-patient binding
  serialBarcode: z.string().min(1).max(100),
  dialyzerModel: z.string().min(1).max(100),
  baselineVolumeMl: z.number().positive().max(500),
  maxAllowedReuses: z.number().int().min(1).max(30).default(10),
  maxReuseDays: z.number().int().min(1).max(180).default(10).optional(),
});
export type CreateDialyzerRequest = z.input<typeof CreateDialyzerSchema>;

export const ReprocessDialyzerSchema = z.object({
  technicianId: z.string().uuid(),
  preCleanOk: z.boolean().default(true),
  measuredVolumeMl: z.number().positive(),
  pressureLeakTestPassed: z.boolean(),
  disinfectantAgent: z.string().min(1).max(100),
  disinfectantConcentrationOk: z.boolean().default(true),
  residualTestPriorUse: z.boolean().optional().nullable(),
  witnessId: z.string().uuid().optional().nullable(),
  notes: z.string().optional().nullable(),
});
export type ReprocessDialyzerRequest = z.input<typeof ReprocessDialyzerSchema>;

export const DiscardDialyzerSchema = z.object({
  discardReason: z.string().min(3),
});
export type DiscardDialyzerRequest = z.input<typeof DiscardDialyzerSchema>;

// ── 7. Water Treatment & Surveillance (R-REN-02) ─────────────────────────────

export const WaterLogStatusEnum = z.enum(["NORMAL", "ALERT", "ACTION_REQUIRED"]);
export type WaterLogStatus = z.infer<typeof WaterLogStatusEnum>;

export const CreateWaterTreatmentLogSchema = z.object({
  branchId: z.string().uuid(),
  logDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).default(() => new Date().toISOString().slice(0, 10)),
  shiftId: z.string().uuid().optional().nullable(),
  testedBy: z.string().uuid(),
  preFilterPressureIn: z.number().optional().nullable(),
  preFilterPressureOut: z.number().optional().nullable(),
  softenerHardnessPpm: z.number().optional().nullable(),
  carbonBreakthroughChlorinePpm: z.number().nonnegative(), // Critical threshold: < 0.1 ppm
  roConductivityUs: z.number().nonnegative(),
  roRejectionRatePct: z.number().min(0).max(100),
  productFlowLpm: z.number().nonnegative().optional().nullable(),
  rejectFlowLpm: z.number().nonnegative().optional().nullable(),
  chemicalDisinfectionDone: z.boolean().default(false),
  notes: z.string().optional().nullable(),
});
export type CreateWaterTreatmentLogRequest = z.input<typeof CreateWaterTreatmentLogSchema>;

export const CreateWaterLabTestSchema = z.object({
  branchId: z.string().uuid(),
  sampleDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).default(() => new Date().toISOString().slice(0, 10)),
  samplePoint: z.enum(["RO_WATER", "LOOP_RETURN", "DIALYSIS_STATION"]),
  testType: z.enum(["ENDOTOXIN", "BACTERIAL_CULTURE"]),
  resultValue: z.number().nonnegative(),
  uom: z.enum(["EU/mL", "CFU/mL"]),
  isCompliant: z.boolean(),
  labOrderId: z.string().uuid().optional().nullable(),
  verifiedBy: z.string().uuid(),
  notes: z.string().optional().nullable(),
});
export type CreateWaterLabTestRequest = z.input<typeof CreateWaterLabTestSchema>;

// ── 8. Dialysis Sessions Lifecycle (AC-29, AC-30, AC-31, AC-32) ──────────────

export const SessionStatusEnum = z.enum([
  "SCHEDULED",
  "PRE_DIALYSIS",
  "IN_PROGRESS",
  "POST_DIALYSIS",
  "COMPLETED",
  "CANCELLED",
  "INTERRUPTED",
]);
export type SessionStatus = z.infer<typeof SessionStatusEnum>;

export const CreateDialysisSessionSchema = z.object({
  patientId: z.string().uuid(),
  visitId: z.string().uuid().optional().nullable(),
  branchId: z.string().uuid(),
  stationId: z.string().uuid(),
  machineId: z.string().uuid(),
  prescriptionId: z.string().uuid(),
  accessId: z.string().uuid().optional().nullable(),
  dialyzerId: z.string().uuid(),
  scheduledDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).default(() => new Date().toISOString().slice(0, 10)),
  shiftId: z.string().uuid(),
  primaryNurseId: z.string().uuid(),
  attendingNephrologistId: z.string().uuid().optional().nullable(),
});
export type CreateDialysisSessionRequest = z.input<typeof CreateDialysisSessionSchema>;

export const PreDialysisIntakeSchema = z.object({
  preWeightKg: z.number().positive().max(300),
  standingBpSystolic: z.number().int().min(40).max(300).optional().nullable(),
  standingBpDiastolic: z.number().int().min(20).max(200).optional().nullable(),
  sittingBpSystolic: z.number().int().min(40).max(300),
  sittingBpDiastolic: z.number().int().min(20).max(200),
  pulse: z.number().int().min(30).max(250),
  temp: z.number().min(30).max(45),
  respRate: z.number().int().min(5).max(60).optional().nullable(),
  dryWeightKg: z.number().positive().max(300),
  targetUfLiters: z.number().nonnegative().max(10),
  edemaGrade: z.enum(["NONE", "1+", "2+", "3+", "4+"]).optional().nullable(),
  accessChecked: z.boolean().default(true),
  nurseSignId: z.string().uuid(),
  notes: z.string().optional().nullable(),
});
export type PreDialysisIntakeRequest = z.input<typeof PreDialysisIntakeSchema>;

export const RecordFlowsheetSchema = z.object({
  elapsedMinutes: z.number().int().nonnegative(),
  bpSystolic: z.number().int().min(40).max(300),
  bpDiastolic: z.number().int().min(20).max(200),
  pulse: z.number().int().min(30).max(250),
  bloodFlowRate: z.number().int().min(50).max(600),
  dialysateFlowRate: z.number().int().min(200).max(1000),
  arterialPressure: z.number().int().optional().nullable(),
  venousPressure: z.number().int().optional().nullable(),
  tmp: z.number().int().optional().nullable(),
  ufRate: z.number().nonnegative().optional().nullable(),
  cumUfVolumeLiters: z.number().nonnegative().max(10),
  heparinAdministered: z.number().int().nonnegative().optional().nullable(),
  symptoms: z.string().optional().nullable(),
  interventions: z.string().optional().nullable(),
  recordedBy: z.string().uuid(),
});
export type RecordFlowsheetRequest = z.input<typeof RecordFlowsheetSchema>;

export const PostDialysisCloseSchema = z.object({
  postWeightKg: z.number().positive().max(300),
  standingBpSystolic: z.number().int().min(40).max(300).optional().nullable(),
  standingBpDiastolic: z.number().int().min(20).max(200).optional().nullable(),
  sittingBpSystolic: z.number().int().min(40).max(300),
  sittingBpDiastolic: z.number().int().min(20).max(200),
  pulse: z.number().int().min(30).max(250),
  temp: z.number().min(30).max(45),
  actualUfRemovedLiters: z.number().nonnegative().max(10),
  totalHeparinGiven: z.number().int().nonnegative().optional().nullable(),
  accessBruitThrill: z.boolean().default(true),
  hemostasisMinutes: z.number().int().min(1).max(120),
  conditionAtDischarge: z.string().default("STABLE"),
  postNurseNotes: z.string().optional().nullable(),
  signedBy: z.string().uuid(),
  consumables: z
    .array(
      z.object({
        itemId: z.string().uuid(),
        locationId: z.string().uuid(),
        batchId: z.string().uuid().optional(),
        qty: z.number().positive(),
        uomId: z.string().uuid(),
        notes: z.string().max(500).optional(),
      }),
    )
    .optional(),
});
export type PostDialysisCloseRequest = z.input<typeof PostDialysisCloseSchema>;

export const CancelDialysisSessionSchema = z.object({
  cancellationReason: z.string().min(3),
});
export type CancelDialysisSessionRequest = z.input<typeof CancelDialysisSessionSchema>;

// ── 9. PhilHealth Dialysis Claims (AC-32) ────────────────────────────────────

export const PhilHealthDialysisClaimSchema = z.object({
  benefitPackageCode: z.string().default("HD01"),
  claimAmount: z.number().positive().default(2600.00),
  copayAmount: z.number().nonnegative().default(0.00),
});
export type PhilHealthDialysisClaimRequest = z.input<typeof PhilHealthDialysisClaimSchema>;
