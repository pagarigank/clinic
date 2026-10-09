import { z } from "zod";

export * from "./permissions.js";

/** Ten tenant-facing module keys (specification §4.3 PLT-T7). */
export const MODULE_KEYS = [
  "admin",
  "patients",
  "clinical",
  "supply",
  "laboratory",
  "pharmacy",
  "billing",
  "compliance",
  "notifications",
  "reports",
] as const;
export type ModuleKey = (typeof MODULE_KEYS)[number];

/** Module hard dependencies (PLT-T7): selecting a module requires these. */
export const MODULE_HARD_DEPENDENCIES: Partial<Record<ModuleKey, readonly ModuleKey[]>> = {
  clinical: ["patients"],
  laboratory: ["patients"],
  pharmacy: ["patients"],
  billing: ["patients", "clinical"],
  reports: ["clinical"], // "at least one of …" simplified to the common case in v1
};

/**
 * Stable machine codes for application/problem+json (architecture §11.2).
 * The frontend maps code → copy; it never parses `detail` text.
 */
export const ERROR_CODES = {
  TENANT_CONTEXT_MISSING: 400,
  VALIDATION_FAILED: 422,
  TENANT_MISMATCH: 403,
  TENANT_SUSPENDED: 403,
  INVALID_CREDENTIALS: 401,
  ACCOUNT_LOCKED: 423,
  ACCOUNT_DISABLED: 403,
  RATE_LIMITED: 429,
  FORBIDDEN: 403,
  STEP_UP_REQUIRED: 401,
  BREAKGLASS_REQUIRED: 403,
  MODULE_NOT_ENTITLED: 403,
  APPOINTMENT_CONFLICT: 409,
  VISIT_CLOSED: 409,
  NOTE_LOCKED: 409,
  RX_LOCKED: 409,
  MODULE_READ_ONLY: 403,
  MODULE_DEPENDENCY_MISSING: 422,
  PLAN_MODULE_NOT_ALLOWED: 422,
  MODULE_HAS_OPEN_WORK: 409,
  NOT_FOUND: 404,
  CONFLICT: 409,
  STALE_ROW_VERSION: 412,
  STOCK_INSUFFICIENT: 409,
  BATCH_EXPIRED: 409,
  BATCH_QUARANTINED: 409,
  BATCH_RECALLED: 409,
  SHELF_LIFE_VIOLATION: 422,
  SEGREGATION_OF_DUTIES: 403,
  MFA_REQUIRED: 401,
  MFA_INVALID: 401,
  PERIOD_LOCKED: 409,
  ACTIVE_SHIFT_REQUIRED: 409,
  SHIFT_CLOSED: 409,
  DISCOUNT_ID_REQUIRED: 422,
  INSUFFICIENT_PAYMENT: 422,
  PAYMENT_EXCEEDS_BALANCE: 422,
  // The payment and its official receipt are written in one transaction, so a
  // receipt that cannot be rendered must fail the whole payment rather than
  // leave a POSTED payment with no stored artifact.
  RECEIPT_RENDER_FAILED: 500,
  INVOICE_NOT_DRAFT: 409,
  QUOTA_EXCEEDED: 429,
  IDEMPOTENCY_CONFLICT: 409,
  UPSTREAM_UNAVAILABLE: 503,
  SCHEDULE_OVERLAP: 409,
  PATIENT_MISMATCH: 422,
} as const;
export type ErrorCode = keyof typeof ERROR_CODES;

/** RFC 9457 problem+json shape carried by every error response. */
export const ProblemSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int(),
  code: z.string(),
  detail: z.string().optional(),
  instance: z.string().optional(),
  correlationId: z.string().optional(),
  errors: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
});
export type Problem = z.infer<typeof ProblemSchema>;

/** ---- RBAC (Phase 1.3, specification §2.3) ---- */

const RoleCodeSchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]{1,63}$/, "lower_snake_case, 2–64 chars")
  .refine((c) => !SYSTEM_ROLE_CODES.includes(c as (typeof SYSTEM_ROLE_CODES)[number]), {
    message: "system role codes are reserved",
  });
const PermissionListSchema = z.array(z.string().regex(/^[a-z][a-z0-9_.]{2,99}$/)).max(500);

export const RoleCreateSchema = z.object({
  code: RoleCodeSchema,
  name: z.string().min(1).max(120),
  permissions: PermissionListSchema.default([]),
});
export type RoleCreate = z.infer<typeof RoleCreateSchema>;

export const RoleCloneSchema = z.object({
  code: RoleCodeSchema,
  name: z.string().min(1).max(120),
});
export type RoleClone = z.infer<typeof RoleCloneSchema>;

export const RoleUpdateSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  permissions: PermissionListSchema.optional(),
  /** Optimistic concurrency: current row_version of the role (when known). */
  rowVersion: z.number().int().positive().optional(),
});
export type RoleUpdate = z.infer<typeof RoleUpdateSchema>;

export const RoleDtoSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  isSystem: z.boolean(),
  permissions: z.array(z.string()),
  rowVersion: z.number().int(),
});
export type RoleDto = z.infer<typeof RoleDtoSchema>;

export const PermissionDtoSchema = z.object({
  code: z.string(),
  description: z.string(),
});
export type PermissionDto = z.infer<typeof PermissionDtoSchema>;

export const EffectivePermissionsSchema = z.object({
  permissions: z.array(z.string()),
  roles: z.array(z.object({ id: z.string().uuid(), code: z.string(), name: z.string() })),
  branchId: z.string().uuid().nullable(),
});
export type EffectivePermissions = z.infer<typeof EffectivePermissionsSchema>;

export const UserRoleAssignSchema = z.object({
  userId: z.string().uuid(),
  roleIds: z.array(z.string().uuid()).max(50),
  branchId: z.string().uuid().nullable().optional(),
});
export type UserRoleAssign = z.infer<typeof UserRoleAssignSchema>;

export const UserBranchAssignSchema = z.object({
  branchIds: z.array(z.string().uuid()),
  defaultBranchId: z.string().uuid().nullable().optional(),
});
export type UserBranchAssign = z.infer<typeof UserBranchAssignSchema>;

export const EmployeeStatusSchema = z.enum(["ACTIVE", "ON_LEAVE", "PROBATION", "RESIGNED", "TERMINATED"]);
export type EmployeeStatus = z.infer<typeof EmployeeStatusSchema>;

export const EmploymentTypeSchema = z.enum(["FULL_TIME", "PART_TIME", "CONTRACT", "CONSULTANT", "INTERN"]);
export type EmploymentType = z.infer<typeof EmploymentTypeSchema>;

export const EmployeeSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  employeeNo: z.string().min(1).max(64),
  jobTitle: z.string().min(1).max(120),
  department: z.string().min(1).max(120),
  employmentType: EmploymentTypeSchema.default("FULL_TIME"),
  specialization: z.string().max(160).nullable().optional(),
  prcLicenseNo: z.string().max(64).nullable().optional(),
  ptrNo: z.string().max(64).nullable().optional(),
  s2LicenseNo: z.string().max(64).nullable().optional(),
  phone: z.string().max(32).nullable().optional(),
  hireDate: z.string().nullable().optional(),
  emergencyContactName: z.string().max(120).nullable().optional(),
  emergencyContactPhone: z.string().max(32).nullable().optional(),
  emergencyContactRelationship: z.string().max(64).nullable().optional(),
  tin: z.string().max(32).nullable().optional(),
  sssNo: z.string().max(32).nullable().optional(),
  philhealthNo: z.string().max(32).nullable().optional(),
  notes: z.string().max(1000).nullable().optional(),
  status: EmployeeStatusSchema.default("ACTIVE"),
  rowVersion: z.number().int(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});
export type Employee = z.infer<typeof EmployeeSchema>;

export const EmployeeUpsertSchema = z.object({
  employeeNo: z.string().min(1).max(64),
  jobTitle: z.string().min(1).max(120),
  department: z.string().min(1).max(120),
  employmentType: EmploymentTypeSchema.default("FULL_TIME"),
  specialization: z.string().max(160).nullable().optional(),
  prcLicenseNo: z.string().max(64).nullable().optional(),
  ptrNo: z.string().max(64).nullable().optional(),
  s2LicenseNo: z.string().max(64).nullable().optional(),
  phone: z.string().max(32).nullable().optional(),
  hireDate: z.string().nullable().optional(),
  emergencyContactName: z.string().max(120).nullable().optional(),
  emergencyContactPhone: z.string().max(32).nullable().optional(),
  emergencyContactRelationship: z.string().max(64).nullable().optional(),
  tin: z.string().max(32).nullable().optional(),
  sssNo: z.string().max(32).nullable().optional(),
  philhealthNo: z.string().max(32).nullable().optional(),
  notes: z.string().max(1000).nullable().optional(),
  status: EmployeeStatusSchema.default("ACTIVE"),
  rowVersion: z.number().int().optional(),
});
export type EmployeeUpsert = z.infer<typeof EmployeeUpsertSchema>;

export const EmployeeWithUserSchema = EmployeeSchema.extend({
  userName: z.string(),
  userEmail: z.string(),
  userStatus: z.string(),
  userRoles: z.array(z.string()).default([]),
});
export type EmployeeWithUser = z.infer<typeof EmployeeWithUserSchema>;

/**
 * Admin user directory + lifecycle (specification §18.2, lines 1029–1035).
 * Users live behind the `admin` module with `admin.user.*` permissions and are
 * created INVITED: the platform never invents a password on someone's behalf,
 * first access goes through the audited forgot/reset flow (architecture §10).
 */
export const UserListSchema = z.object({
  id: z.string().uuid(),
  email: z.string(),
  name: z.string(),
  status: z.enum(["INVITED", "ACTIVE", "LOCKED", "DEACTIVATED"]),
  mfaEnabled: z.boolean(),
  roles: z.array(z.object({ id: z.string().uuid(), code: z.string(), name: z.string() })),
  branches: z.array(z.object({ id: z.string().uuid(), name: z.string(), isDefault: z.boolean() })),
  employee: EmployeeSchema.nullable().optional(),
  lastLoginAt: z.string().nullable(),
  rowVersion: z.number().int(),
});
export type UserList = z.infer<typeof UserListSchema>;

export const UserCreateSchema = z.object({
  email: z.string().email().max(320),
  name: z.string().min(1).max(160),
  roleIds: z.array(z.string().uuid()).max(50).default([]),
  employee: EmployeeUpsertSchema.optional(),
});
export type UserCreate = z.infer<typeof UserCreateSchema>;

export const UserUpdateSchema = z.object({
  name: z.string().min(1).max(160).optional(),
  rowVersion: z.number().int().optional(),
});
export type UserUpdate = z.infer<typeof UserUpdateSchema>;

export const UserPasswordResetSchema = z.object({
  newPassword: z.string().min(1).max(200),
});
export type UserPasswordReset = z.infer<typeof UserPasswordResetSchema>;

/** Reusable `:id` param parser for NestJS param pipes. */
export const zodUuid = z.string().uuid();

/** ---- Phase 0 vertical-slice contract: /ping ---- */

export const PingResponseSchema = z.object({
  message: z.string().min(1),
  dbTime: z.string().min(1),
  request_id: z.string().uuid(),
});
export type PingResponse = z.infer<typeof PingResponseSchema>;

/** ---- Auth (Phase 1.2, architecture §10) ---- */

export const LoginRequestSchema = z.object({
  tenant: z.string().min(1).max(63).optional(), // slug; subdomain / X-Tenant header override
  email: z.string().email().max(254),
  password: z.string().min(1).max(1024),
  rememberDevice: z.boolean().optional(),
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export const LoginMfaRequiredSchema = z.object({
  status: z.literal("MFA_REQUIRED"),
  ticket: z.string().min(1), // short-lived mfa-ticket JWT
});
export type LoginMfaRequired = z.infer<typeof LoginMfaRequiredSchema>;

export const TokenPairSchema = z.object({
  status: z.literal("AUTHENTICATED"),
  accessToken: z.string().min(1),
  tokenType: z.literal("Bearer"),
  expiresIn: z.number().int().positive(),
});
export type TokenPair = z.infer<typeof TokenPairSchema>;

export const MfaLoginVerifySchema = z.object({
  ticket: z.string().min(1),
  code: z.string().min(6).max(10), // TOTP digits or recovery code
  rememberDevice: z.boolean().optional(),
});
export type MfaLoginVerify = z.infer<typeof MfaLoginVerifySchema>;

export const MfaEnrollStartSchema = z.object({});
export const MfaEnrollStartResponseSchema = z.object({
  otpauthUrl: z.string(),
  secret: z.string(), // base32, shown once for manual entry
});
export type MfaEnrollStartResponse = z.infer<typeof MfaEnrollStartResponseSchema>;

export const MfaConfirmSchema = z.object({ code: z.string().min(6).max(8) });
export const MfaConfirmResponseSchema = z.object({
  confirmed: z.literal(true),
  recoveryCodes: z.array(z.string().min(1)), // shown once
});
export type MfaConfirmResponse = z.infer<typeof MfaConfirmResponseSchema>;

export const StepUpRequestSchema = z.object({
  password: z.string().min(1).max(1024).optional(),
  totp: z.string().min(6).max(8).optional(),
});
export type StepUpRequest = z.infer<typeof StepUpRequestSchema>;

export const StepUpResponseSchema = z.object({
  stepUpToken: z.string().min(1),
  expiresIn: z.number().int().positive(),
});
export type StepUpResponse = z.infer<typeof StepUpResponseSchema>;

export const ForgotPasswordSchema = z.object({
  tenant: z.string().min(1).max(63).optional(),
  email: z.string().email().max(254),
});
export type ForgotPasswordRequest = z.infer<typeof ForgotPasswordSchema>;

export const ForgotPasswordResponseSchema = z.object({
  accepted: z.literal(true),
  // dev/test affordance only — the API includes it solely outside production
  // (config-gated); production responses never carry the token.
  devResetToken: z.string().optional(),
});
export type ForgotPasswordResponse = z.infer<typeof ForgotPasswordResponseSchema>;

export const ResetPasswordSchema = z.object({
  token: z.string().min(16).max(256),
  password: z.string().min(12).max(128),
});
export type ResetPasswordRequest = z.infer<typeof ResetPasswordSchema>;

/** §2.1 system role templates — reserved codes, seeded per tenant. */
export const SYSTEM_ROLE_CODES = [
  "tenant_admin",
  "branch_manager",
  "doctor",
  "nurse",
  "encoder",
  "cashier",
  "pharmacist",
  "pharmacy_assistant",
  "phlebotomist",
  "medtech",
  "lab_manager",
  "pathologist",
  "supply_officer",
  "purchaser",
  "auditor",
  "dpo",
] as const;
export type SystemRoleCode = (typeof SYSTEM_ROLE_CODES)[number];

export const SessionInfoSchema = z.object({
  user: z.object({ id: z.string().uuid(), email: z.string(), name: z.string() }),
  tenant: z.object({ id: z.string().uuid(), slug: z.string() }),
  sessionId: z.string().uuid(),
  amr: z.array(z.string()),
  branchId: z.string().uuid().nullable(),
  assignedBranches: z.array(z.object({ id: z.string().uuid(), name: z.string() })),
  effectiveTimezone: z.string(),
  expiresAt: z.string(), // ISO
  // Entitled modules (architecture §5.3) + the caller's effective permission
  // codes (specification §2.3). The server-side guards remain the authority;
  // these drive shell/nav rendering and page-level feature visibility.
  modules: z.array(z.string()),
  modulesVersion: z.number().int().nullable(),
  permissions: z.array(z.string()),
});
export type SessionInfo = z.infer<typeof SessionInfoSchema>;

export const SwitchBranchSchema = z.object({
  branchId: z.string().uuid(),
});
export type SwitchBranchRequest = z.infer<typeof SwitchBranchSchema>;

/** ---- Shared list conventions (specification §18) ---- */

export const CursorPageSchema = z.object({
  "page[size]": z.coerce.number().int().min(1).max(200).optional(),
  "page[cursor]": z.string().optional(),
});
export type CursorPageQuery = z.infer<typeof CursorPageSchema>;

export const PageMetaSchema = z.object({
  total: z.number().int().optional(),
  nextCursor: z.string().nullable(),
  hasMore: z.boolean(),
});
export type PageMeta = z.infer<typeof PageMetaSchema>;

/** ---- Jobs (Phase 1.5, architecture §12) ---- */

export const JobPayloadBaseSchema = z.object({
  tenantId: z.string().uuid(),
  branchId: z.string().uuid().optional(),
  idempotencyKey: z.string().min(1).max(256).optional(),
});
export type JobPayloadBase = z.infer<typeof JobPayloadBaseSchema>;

/** ---- Files ---- */

export const FileRowSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  objectKey: z.string(),
  fileName: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int(),
  status: z.enum(["SCAN_PENDING", "READY", "REJECTED"]),
  scanReason: z.string().nullable(),
  uploadedBy: z.string().uuid(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type FileRow = z.infer<typeof FileRowSchema>;

export const CreateFileSchema = z.object({
  fileName: z.string().min(1),
  mimeType: z.string().min(1),
  sizeBytes: z.number().int().min(1),
});
export type CreateFileRequest = z.infer<typeof CreateFileSchema>;

export const FilePresignedResponseSchema = z.object({
  fileId: z.string().uuid(),
  uploadUrl: z.string(),
  objectKey: z.string(),
});
export type FilePresignedResponse = z.infer<typeof FilePresignedResponseSchema>;

/** ---- Patients (Phase 2.2) ---- */

export const PatientGenderSchema = z.enum(['M', 'F', 'OTHER', 'PREFER_NOT_TO_SAY']);
export type PatientGender = z.infer<typeof PatientGenderSchema>;

export const PatientStatusSchema = z.enum(['ACTIVE', 'INACTIVE', 'DECEASED', 'MERGED']);
export type PatientStatus = z.infer<typeof PatientStatusSchema>;

export const PatientIdentifierTypeSchema = z.enum(['PHILHEALTH', 'SSS', 'TIN', 'PASSPORT', 'DRIVERS_LICENSE', 'NATIONAL_ID', 'HMO', 'OTHER']);
export type PatientIdentifierType = z.infer<typeof PatientIdentifierTypeSchema>;

export const PatientContactTypeSchema = z.enum(['MOBILE', 'LANDLINE', 'EMAIL', 'OTHER']);
export type PatientContactType = z.infer<typeof PatientContactTypeSchema>;

export const AllergenSeveritySchema = z.enum(['MILD', 'MODERATE', 'SEVERE', 'LIFE_THREATENING']);
export type AllergenSeverity = z.infer<typeof AllergenSeveritySchema>;

export const PatientFlagLevelSchema = z.enum(['INFO', 'WARNING', 'DANGER']);
export type PatientFlagLevel = z.infer<typeof PatientFlagLevelSchema>;

export const CreatePatientSchema = z.object({
  firstName: z.string().min(1).max(120),
  lastName: z.string().min(1).max(120),
  middleName: z.string().max(120).optional(),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD'),
  gender: PatientGenderSchema,
  registrationType: z.enum(['STANDARD', 'EMERGENCY']).optional(),
  // Intake collects these on the same form, so accepting them here is what
  // stops the web layer from silently dropping them. The service writes them
  // inside the same transaction as the patient row.
  phone: z.string().max(200).optional(),
  email: z.string().max(200).optional(),
  philhealthNo: z.string().max(30).optional(),
  nationalId: z.string().max(100).optional(),
  allergies: z.array(z.string().min(1).max(200)).max(50).optional(),
});
export type CreatePatientRequest = z.infer<typeof CreatePatientSchema>;

export const UpdatePatientSchema = z.object({
  firstName: z.string().min(1).max(120).optional(),
  lastName: z.string().min(1).max(120).optional(),
  middleName: z.string().max(120).nullable().optional(),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  gender: PatientGenderSchema.optional(),
  rowVersion: z.number().int().positive(),
});
export type UpdatePatientRequest = z.infer<typeof UpdatePatientSchema>;

export const DeactivatePatientSchema = z.object({
  reason: z.string().min(1).max(500),
  rowVersion: z.number().int().positive(),
});
export type DeactivatePatientRequest = z.infer<typeof DeactivatePatientSchema>;

export const MarkDeceasedSchema = z.object({
  dateOfDeath: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  rowVersion: z.number().int().positive(),
});
export type MarkDeceasedRequest = z.infer<typeof MarkDeceasedSchema>;

export const RevealIdentifierSchema = z.object({
  reason: z.string().min(1).max(500),
});
export type RevealIdentifierRequest = z.infer<typeof RevealIdentifierSchema>;

export const AddIdentifierSchema = z.object({
  type: PatientIdentifierTypeSchema,
  value: z.string().min(1).max(100),
});
export type AddIdentifierRequest = z.infer<typeof AddIdentifierSchema>;

export const AddContactSchema = z.object({
  type: PatientContactTypeSchema,
  value: z.string().min(1).max(200),
  isPrimary: z.boolean().optional().default(false),
});
export type AddContactRequest = z.infer<typeof AddContactSchema>;

export const AddAllergySchema = z.object({
  substance: z.string().min(1).max(200),
  severity: AllergenSeveritySchema,
});
export type AddAllergyRequest = z.infer<typeof AddAllergySchema>;

export const AddFlagSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  level: PatientFlagLevelSchema,
});
export type AddFlagRequest = z.infer<typeof AddFlagSchema>;

export const CheckDuplicatesSchema = z.object({
  firstName: z.string().min(1).max(120),
  lastName: z.string().min(1).max(120),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD'),
});
export type CheckDuplicatesRequest = z.infer<typeof CheckDuplicatesSchema>;

export const AcknowledgeDuplicatesSchema = z.object({
  candidateIds: z.array(z.string().uuid()).min(1),
  reason: z.string().min(1).max(500),
});
export type AcknowledgeDuplicatesRequest = z.infer<typeof AcknowledgeDuplicatesSchema>;

export const MergePatientSchema = z.object({
  survivingPatientId: z.string().uuid(),
  mergedPatientId: z.string().uuid(),
  reason: z.string().min(1).max(500),
});
export type MergePatientRequest = z.infer<typeof MergePatientSchema>;

export const ConsentCaptureSchema = z.object({
  templateVersionId: z.string().uuid(),
  fileId: z.string().uuid().optional(),
});
export type ConsentCaptureRequest = z.infer<typeof ConsentCaptureSchema>;

export const ConsentWithdrawSchema = z.object({
  reason: z.string().min(1).max(500),
});
export type ConsentWithdrawRequest = z.infer<typeof ConsentWithdrawSchema>;

export const PhilHealthDataSchema = z.object({
  pin: z.string().min(1).max(30),
  membershipCategory: z.enum(['MEMBER', 'DEPENDENT', 'SENIOR_CITIZEN', 'KONSULTA']),
  konsultaPcp: z.string().max(200).optional(),
  konsultaStatus: z.enum(['NOT_REGISTERED', 'REGISTERED', 'LAPSED']).optional().default('NOT_REGISTERED'),
});
export type PhilHealthDataRequest = z.infer<typeof PhilHealthDataSchema>;

export const PhilHealthDependentSchema = z.object({
  dependentFirstName: z.string().min(1).max(120),
  dependentLastName: z.string().min(1).max(120),
  dependentDob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dependentRelationship: z.enum(['SPOUSE', 'CHILD', 'PARENT', 'OTHER']),
});
export type PhilHealthDependentRequest = z.infer<typeof PhilHealthDependentSchema>;

/** ---- Tenant config (Phase 2.1) ---- */

export const CreateServiceSchema = z.object({
  code: z.string().min(1).max(50).regex(/^[a-z0-9_]+$/),
  name: z.string().min(1).max(200),
  branchId: z.string().uuid().optional(),
  category: z.enum(['consult', 'procedure', 'lab', 'other']).default('other'),
  defaultPrice: z.number().min(0).default(0),
});
export type CreateServiceRequest = z.infer<typeof CreateServiceSchema>;

export const CreatePriceListSchema = z.object({
  serviceId: z.string().uuid(),
  amount: z.number().min(0),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  effectiveTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
export type CreatePriceListRequest = z.infer<typeof CreatePriceListSchema>;

export const BulkPriceAdjustSchema = z.object({
  target: z.enum(['LABORATORY', 'PHARMACY', 'CENTRAL_SUPPLY', 'ALL']),
  adjustmentType: z.enum(['PERCENTAGE', 'FIXED']),
  direction: z.enum(['INCREASE', 'DECREASE']),
  value: z.number().positive(),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  reason: z.string().max(200).optional(),
});
export type BulkPriceAdjustRequest = z.infer<typeof BulkPriceAdjustSchema>;

export const CreateDiscountTypeSchema = z.object({
  name: z.string().min(1).max(100),
  percentage: z.number().min(0).max(100),
});
export type CreateDiscountTypeRequest = z.infer<typeof CreateDiscountTypeSchema>;

export const CreatePaymentMethodSchema = z.object({
  code: z.string().min(1).max(50).regex(/^[a-z0-9_]+$/),
  name: z.string().min(1).max(100),
});
export type CreatePaymentMethodRequest = z.infer<typeof CreatePaymentMethodSchema>;

export const CreateHolidaySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  name: z.string().min(1).max(200),
});
export type CreateHolidayRequest = z.infer<typeof CreateHolidaySchema>;

export const CreateServiceUnitSchema = z.object({
  code: z.string().min(1).max(50).regex(/^[a-z0-9_-]+$/i),
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
});
export type CreateServiceUnitRequest = z.infer<typeof CreateServiceUnitSchema>;

export const CreateOperatingHoursSchema = z.object({
  branchId: z.string().uuid(),
  dayOfWeek: z.number().int().min(0).max(6),
  openTime: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
  closeTime: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
});
export type CreateOperatingHoursRequest = z.infer<typeof CreateOperatingHoursSchema>;

/** ---- Templates (Phase 2.1) ---- */

export const TemplateTypeSchema = z.enum(['DOCUMENT', 'NOTIFICATION', 'CONSENT']);
export type TemplateType = z.infer<typeof TemplateTypeSchema>;

export const CreateTemplateSchema = z.object({
  type: TemplateTypeSchema,
  code: z.string().min(1).max(80).regex(/^[a-z0-9_]+$/),
  name: z.string().min(1).max(200),
  content: z.string().min(1),
});
export type CreateTemplateRequest = z.infer<typeof CreateTemplateSchema>;

/** ---- Clinical (Phase 3, specification §7) ---- */

// ── Schedules ──────────────────────────────────────────────────────────────
export const WeekdaySchema = z.number().int().min(0).max(6);

export const CreateScheduleSchema = z
  .object({
    branchId: z.string().uuid(),
    practitionerId: z.string().uuid(),
    weekday: WeekdaySchema,
    startTime: z.string().regex(/^\d{2}:\d{2}$/),
    endTime: z.string().regex(/^\d{2}:\d{2}$/),
    slotMinutes: z.number().int().min(5).max(240).default(30),
    validFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    validTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  })
  .refine((v) => v.startTime < v.endTime, { message: 'startTime must be before endTime' });
export type CreateScheduleRequest = z.infer<typeof CreateScheduleSchema>;

export const CreateScheduleExceptionSchema = z.object({
  branchId: z.string().uuid(),
  practitionerId: z.string().uuid(),
  exceptionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  isFullDay: z.boolean().default(true),
  startTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  endTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  reason: z.string().min(1).max(500),
});
export type CreateScheduleExceptionRequest = z.infer<typeof CreateScheduleExceptionSchema>;

export const AvailabilityQuerySchema = z.object({
  branchId: z.string().uuid(),
  practitionerId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
export type AvailabilityQueryRequest = z.infer<typeof AvailabilityQuerySchema>;

export const PublicAvailabilityQuerySchema = z.object({
  slug: z.string().min(1),
  branchId: z.string().uuid(),
  practitionerId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
export type PublicAvailabilityQueryRequest = z.infer<typeof PublicAvailabilityQuerySchema>;

// ── Appointments (CLN-T1) ─────────────────────────────────────────────────
export const AppointmentStatusSchema = z.enum([
  'BOOKED', 'CONFIRMED', 'CHECKED_IN', 'IN_CONSULT', 'COMPLETED', 'CANCELLED', 'NO_SHOW',
]);
export type AppointmentStatus = z.infer<typeof AppointmentStatusSchema>;

export const BookAppointmentSchema = z
  .object({
    branchId: z.string().uuid(),
    patientId: z.string().uuid(),
    practitionerId: z.string().uuid(),
    serviceId: z.string().uuid().optional(),
    startsAt: z.string(), // ISO 8601
    endsAt: z.string(),
    channel: z.enum(['FRONT_DESK', 'PHONE', 'ONLINE', 'WALK_IN']).default('FRONT_DESK'),
    notes: z.string().max(1000).optional(),
  })
  .refine((v) => new Date(v.startsAt) < new Date(v.endsAt), {
    message: 'startsAt must be before endsAt',
  });
export type BookAppointmentRequest = z.infer<typeof BookAppointmentSchema>;

export const PublicBookAppointmentSchema = z
  .object({
    slug: z.string().min(1).max(100),
    branchId: z.string().uuid(),
    practitionerId: z.string().uuid(),
    startsAt: z.string(), // ISO 8601
    endsAt: z.string(),
    firstName: z.string().min(1).max(100),
    lastName: z.string().min(1).max(100),
    middleName: z.string().max(100).optional(),
    dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    gender: z.enum(['M', 'F', 'OTHER']),
    phone: z.string().min(5).max(30),
    email: z.string().email().optional().or(z.literal('')),
    notes: z.string().max(1000).optional(),
  })
  .refine((v) => new Date(v.startsAt) < new Date(v.endsAt), {
    message: 'startsAt must be before endsAt',
  });
export type PublicBookAppointmentRequest = z.infer<typeof PublicBookAppointmentSchema>;

export const RescheduleAppointmentSchema = z
  .object({
    startsAt: z.string(),
    endsAt: z.string(),
    rowVersion: z.number().int().positive(),
    practitionerId: z.string().uuid().optional(),
    notes: z.string().max(1000).optional(),
  })
  .refine((v) => new Date(v.startsAt) < new Date(v.endsAt), {
    message: 'startsAt must be before endsAt',
  });
export type RescheduleAppointmentRequest = z.infer<typeof RescheduleAppointmentSchema>;

export const CancelAppointmentSchema = z.object({
  reason: z.string().min(1).max(500),
  rowVersion: z.number().int().positive(),
});
export type CancelAppointmentRequest = z.infer<typeof CancelAppointmentSchema>;

// ── Queue (CLN-T2) ────────────────────────────────────────────────────────
export const QueueStatusSchema = z.enum(['WAITING', 'CALLED', 'SERVING', 'DONE', 'SKIPPED']);

export const IssueQueueTicketSchema = z.object({
  branchId: z.string().uuid(),
  patientId: z.string().uuid(),
  visitId: z.string().uuid().optional(),
  priority: z.number().int().min(0).max(9).default(0),
});
export type IssueQueueTicketRequest = z.infer<typeof IssueQueueTicketSchema>;

export const QueueActionSchema = z.object({
  action: z.enum(['CALL', 'RECALL', 'SKIP', 'COMPLETE']),
});
export type QueueActionRequest = z.infer<typeof QueueActionSchema>;

// ── Visits (CLN-T2/T4/T9) ─────────────────────────────────────────────────
export const VisitStatusSchema = z.enum(['OPEN', 'IN_PROGRESS', 'READY_FOR_BILLING', 'CLOSED', 'CANCELLED']);
export type VisitStatus = z.infer<typeof VisitStatusSchema>;

export const OpenVisitSchema = z.object({
  branchId: z.string().uuid(),
  patientId: z.string().uuid(),
  practitionerId: z.string().uuid(),
  appointmentId: z.string().uuid().optional(),
  queueTicketId: z.string().uuid().optional(),
  visitType: z.enum(['OPD', 'WALK_IN', 'FOLLOW_UP', 'PROCEDURE']).default('OPD'),
  chiefComplaint: z.string().max(2000).optional(),
});
export type OpenVisitRequest = z.infer<typeof OpenVisitSchema>;

export const UpdateVisitSchema = z.object({
  chiefComplaint: z.string().max(2000).optional(),
  status: VisitStatusSchema.optional(),
  rowVersion: z.number().int().positive(),
});
export type UpdateVisitRequest = z.infer<typeof UpdateVisitSchema>;

export const CancelVisitSchema = z.object({
  reason: z.string().min(1).max(500),
  rowVersion: z.number().int().positive(),
});
export type CancelVisitRequest = z.infer<typeof CancelVisitSchema>;

// ── Vitals (CLN-T3) ───────────────────────────────────────────────────────
export const RecordVitalsSchema = z.object({
  bpSys: z.number().int().min(40).max(300).optional(),
  bpDia: z.number().int().min(20).max(200).optional(),
  heartRate: z.number().int().min(20).max(260).optional(),
  respiratoryRate: z.number().int().min(4).max(80).optional(),
  temperatureC: z.number().min(30).max(45).optional(),
  spo2: z.number().int().min(50).max(100).optional(),
  weightKg: z.number().min(0).max(500).optional(),
  heightCm: z.number().min(0).max(260).optional(),
  painScore: z.number().int().min(0).max(10).optional(),
});
export type RecordVitalsRequest = z.infer<typeof RecordVitalsSchema>;

// ── Clinical notes (CLN-T4) ───────────────────────────────────────────────
export const NoteStatusSchema = z.enum(['DRAFT', 'SIGNED', 'AMENDED']);

export const SaveNoteSchema = z.object({
  noteType: z.enum(['SOAP', 'PROGRESS', 'PROCEDURE']).default('SOAP'),
  subjective: z.string().max(20000).optional(),
  objective: z.string().max(20000).optional(),
  assessment: z.string().max(20000).optional(),
  plan: z.string().max(20000).optional(),
  clinicalMemo: z.string().max(20000).optional(),
});
export type SaveNoteRequest = z.infer<typeof SaveNoteSchema>;

export const SaveClinicalMemoSchema = z.object({
  memo: z.string().max(20000).optional(),
  clinicalNotes: z.string().max(20000).optional(),
  clinicalMemo: z.string().max(20000).optional(),
});
export type SaveClinicalMemoRequest = z.infer<typeof SaveClinicalMemoSchema>;

export const SignNoteSchema = z.object({
  rowVersion: z.number().int().positive(),
});
export type SignNoteRequest = z.infer<typeof SignNoteSchema>;

export const AmendNoteSchema = z.object({
  subjective: z.string().max(20000).optional(),
  objective: z.string().max(20000).optional(),
  assessment: z.string().max(20000).optional(),
  plan: z.string().max(20000).optional(),
  clinicalMemo: z.string().max(20000).optional(),
});
export type AmendNoteRequest = z.infer<typeof AmendNoteSchema>;

// ── Diagnoses / problems ──────────────────────────────────────────────────
export const AddDiagnosisSchema = z.object({
  icd10Code: z.string().min(3).max(8).regex(/^[A-TV-Z][0-9][0-9AB](\.[0-9A-TV-Z]{1,4})?$/i, 'ICD-10 code format'),
  description: z.string().max(500).optional(),
  dxType: z.enum(['PRIMARY', 'SECONDARY']).default('PRIMARY'),
  certainty: z.enum(['CONFIRMED', 'PROVISIONAL']).default('CONFIRMED'),
});
export type AddDiagnosisRequest = z.infer<typeof AddDiagnosisSchema>;

export const AddProblemSchema = z.object({
  patientId: z.string().uuid(),
  icd10Code: z.string().min(3).max(8),
  onsetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
export type AddProblemRequest = z.infer<typeof AddProblemSchema>;

export const CreateIcd10Schema = z.object({
  code: z
    .string()
    .trim()
    .min(2, 'Code must be at least 2 characters')
    .max(10, 'Code must be at most 10 characters')
    .regex(/^[A-Za-z0-9.]+$/, 'Code must contain only alphanumeric characters and periods'),
  description: z
    .string()
    .trim()
    .min(2, 'Description must be at least 2 characters')
    .max(500, 'Description must be at most 500 characters'),
});
export type CreateIcd10Request = z.infer<typeof CreateIcd10Schema>;

export const UpdateIcd10Schema = z.object({
  description: z
    .string()
    .trim()
    .min(2, 'Description must be at least 2 characters')
    .max(500, 'Description must be at most 500 characters'),
});
export type UpdateIcd10Request = z.infer<typeof UpdateIcd10Schema>;

// ── Prescriptions (CLN-T5) ────────────────────────────────────────────────
export const PrescriptionStatusSchema = z.enum([
  'DRAFT', 'ISSUED', 'PARTIALLY_DISPENSED', 'DISPENSED', 'EXPIRED', 'CANCELLED',
]);

export const PrescriptionItemSchema = z.object({
  drugProductId: z.string().uuid().optional(),
  genericName: z.string().min(1).max(200),
  brandName: z.string().max(200).optional(),
  strength: z.string().max(50).optional(),
  form: z.string().max(50).optional(),
  route: z.string().max(50).optional(),
  sigDose: z.string().min(1).max(200),
  sigFrequency: z.string().min(1).max(200),
  sigDuration: z.string().max(100).optional(),
  qtyPrescribed: z.number().positive().max(10000),
  dispenseAsWritten: z.boolean().default(false),
});
export type PrescriptionItemInput = z.infer<typeof PrescriptionItemSchema>;

export const CreatePrescriptionSchema = z
  .object({
    visitId: z.string().uuid(),
    patientId: z.string().uuid(),
    items: z.array(PrescriptionItemSchema).min(1).max(20),
    isControlled: z.boolean().default(false),
    notes: z.string().max(2000).optional(),
  })
  .superRefine((v, ctx) => {
    // Controlled Rx requires the special-Rx fields at CREATE time (CLN-T5,
    // specification §7.3: quantity in words AND figures, no-refill enforced).
    if (v.isControlled) {
      for (const [i, item] of v.items.entries()) {
        if (!item.qtyPrescribed || item.qtyPrescribed <= 0) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['items', i, 'qtyPrescribed'], message: 'Controlled Rx requires a positive quantity in figures' });
        }
      }
    }
  });
export type CreatePrescriptionRequest = z.infer<typeof CreatePrescriptionSchema>;

export const IssuePrescriptionSchema = z.object({
  specialRxNo: z.string().max(60).optional(),
  qtyWords: z.string().max(200).optional(),
  validDays: z.number().int().min(1).max(180).default(30),
});
export type IssuePrescriptionRequest = z.infer<typeof IssuePrescriptionSchema>;

export const CancelPrescriptionSchema = z.object({
  reason: z.string().min(1).max(500),
});
export type CancelPrescriptionRequest = z.infer<typeof CancelPrescriptionSchema>;

// ── Certificates / referrals (CLN-T8) ─────────────────────────────────────
export const IssueCertificateSchema = z.object({
  certType: z.enum(['FIT_TO_WORK', 'SICK_LEAVE', 'CLEARANCE']),
  findings: z.string().max(5000).optional(),
  validFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  validTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
export type IssueCertificateRequest = z.infer<typeof IssueCertificateSchema>;

export const CreateReferralSchema = z.object({
  toFacility: z.string().max(200).optional(),
  toPractitioner: z.string().max(200).optional(),
  reason: z.string().min(1).max(2000),
  urgency: z.enum(['ROUTINE', 'URGENT', 'STAT']).default('ROUTINE'),
}).refine((v) => v.toFacility || v.toPractitioner, {
  message: 'A referral needs a facility or a practitioner',
});
export type CreateReferralRequest = z.infer<typeof CreateReferralSchema>;

// ── Practitioner fees (Q-17 shipped default) ──────────────────────────────
export const UpsertPractitionerProfileSchema = z.object({
  userId: z.string().uuid(),
  branchId: z.string().uuid().nullable(),
  philhealthAccreditationNo: z.string().max(60).optional(),
  consultFeeNew: z.number().min(0).optional(),
  consultFeeFollowUp: z.number().min(0).optional(),
  consultFeeProcedure: z.number().min(0).optional(),
  freeFollowUpDays: z.number().int().min(0).max(365).default(7),
  pfSharePercent: z.number().min(0).max(100).optional(),
});
export type UpsertPractitionerProfileRequest = z.infer<typeof UpsertPractitionerProfileSchema>;

// ── Charge capture (Appendix A2: billing.charge.create, owner Phase 3) ────
export const CreateChargeSchema = z.object({
  visitId: z.string().uuid(),
  chargeType: z.enum(['CONSULT', 'PROCEDURE', 'LAB', 'PHARMACY', 'SUPPLY', 'OTHER']),
  sourceType: z.string().min(1).max(60),
  sourceId: z.string().uuid(),
  serviceId: z.string().uuid(),
  description: z.string().min(1).max(300),
  quantity: z.number().positive().default(1),
  payerType: z.enum(['PRIVATE_CASH', 'HMO', 'PHILHEALTH', 'CORPORATE']).default('PRIVATE_CASH'),
});
export type CreateChargeRequest = z.infer<typeof CreateChargeSchema>;

// ── Additional appointment lifecycle (todo §3.1) ──────────────────────────
export const ConfirmAppointmentSchema = z.object({
  rowVersion: z.number().int().positive(),
});
export type ConfirmAppointmentRequest = z.infer<typeof ConfirmAppointmentSchema>;

export const CheckInAppointmentSchema = z.object({
  rowVersion: z.number().int().positive(),
  issueQueueTicket: z.boolean().default(true),
  priority: z.number().int().min(0).max(9).default(0),
});
export type CheckInAppointmentRequest = z.infer<typeof CheckInAppointmentSchema>;

// ── Procedures (todo §3.2, CLN-T4) ────────────────────────────────────────
export const RecordProcedureSchema = z.object({
  serviceId: z.string().uuid(),
  performedBy: z.string().uuid(),
  notes: z.string().max(2000).optional(),
});
export type RecordProcedureRequest = z.infer<typeof RecordProcedureSchema>;

// ── Immunizations (todo §3.2, RPT-CLN-11) ─────────────────────────────────
export const RecordImmunizationSchema = z.object({
  patientId: z.string().uuid(),
  visitId: z.string().uuid().optional(),
  vaccine: z.string().min(1).max(200),
  doseNo: z.number().int().min(1).max(20).default(1),
  lotNo: z.string().max(100).optional(),
  stockBatchId: z.string().uuid().optional(),
  site: z.string().max(100).optional(),
});
export type RecordImmunizationRequest = z.infer<typeof RecordImmunizationSchema>;

export const VoidImmunizationSchema = z.object({
  reason: z.string().min(1).max(500),
});
export type VoidImmunizationRequest = z.infer<typeof VoidImmunizationSchema>;

// ── Clinical Templates & Order Sets (todo §3.3) ───────────────────────────
export const CreateClinicalTemplateSchema = z.object({
  name: z.string().min(1).max(200),
  body: z.string().min(1).max(20000),
  practitionerId: z.string().uuid().optional(),
});
export type CreateClinicalTemplateRequest = z.infer<typeof CreateClinicalTemplateSchema>;

export const CreateOrderSetSchema = z.object({
  name: z.string().min(1).max(200),
  items: z.array(z.record(z.string(), z.unknown())).min(1).max(50),
});
export type CreateOrderSetRequest = z.infer<typeof CreateOrderSetSchema>;

// ── Void Certificate ──────────────────────────────────────────────────────
export const VoidCertificateSchema = z.object({
  reason: z.string().min(1).max(500),
});
export type VoidCertificateRequest = z.infer<typeof VoidCertificateSchema>;

// ── Void Procedure & Resolve Problem ──────────────────────────────────────
export const VoidProcedureSchema = z.object({
  reason: z.string().min(1).max(500),
});
export type VoidProcedureRequest = z.infer<typeof VoidProcedureSchema>;

export const ResolveProblemSchema = z.object({
  resolvedAt: z.string().optional(),
});
export type ResolveProblemRequest = z.infer<typeof ResolveProblemSchema>;

// ── Phase 4: Supply & Inventory Core (specification §10, architecture §8) ──

// Masters
export const CreateItemCategorySchema = z.object({
  name: z.string().min(1).max(200),
  parentId: z.string().uuid().optional(),
});
export type CreateItemCategoryRequest = z.infer<typeof CreateItemCategorySchema>;

export const CreateUomSchema = z.object({
  code: z.string().min(1).max(20),
  name: z.string().min(1).max(100),
});
export type CreateUomRequest = z.infer<typeof CreateUomSchema>;

export const CreateUomConversionSchema = z.object({
  itemId: z.string().uuid().optional(),
  fromUomId: z.string().uuid(),
  toUomId: z.string().uuid(),
  factor: z.number().positive(),
});
export type CreateUomConversionRequest = z.infer<typeof CreateUomConversionSchema>;

export const CreateItemSchema = z.object({
  code: z.string().min(1).max(50),
  name: z.string().min(1).max(250),
  itemType: z.enum(['MEDICINE', 'SUPPLY', 'REAGENT', 'EQUIPMENT']),
  categoryId: z.string().uuid().optional(),
  baseUomId: z.string().uuid(),
  isBatchTracked: z.boolean().default(false),
  isExpiryTracked: z.boolean().default(false),
  storageConditions: z.string().max(200).optional(),
  isHazardous: z.boolean().default(false),
  standardCost: z.number().min(0).default(0),
  price: z.number().min(0).optional(),
  minShelfLifeDaysOnReceipt: z.number().int().min(0).default(0),
});
export type CreateItemRequest = z.input<typeof CreateItemSchema>;

export const UpdateItemSchema = CreateItemSchema.partial();
export type UpdateItemRequest = z.infer<typeof UpdateItemSchema>;

export const CreateItemBarcodeSchema = z.object({
  itemId: z.string().uuid(),
  barcode: z.string().min(1).max(100),
  uomId: z.string().uuid(),
});
export type CreateItemBarcodeRequest = z.infer<typeof CreateItemBarcodeSchema>;

export const CreateSupplierSchema = z.object({
  code: z.string().min(1).max(50),
  name: z.string().min(1).max(250),
  tin: z.string().max(50).optional(),
  address: z.string().max(500).optional(),
  termsDays: z.number().int().min(0).default(30),
  leadTimeDays: z.number().int().min(0).default(7),
  rating: z.number().min(0).max(5).optional(),
});
export type CreateSupplierRequest = z.input<typeof CreateSupplierSchema>;

export const UpdateSupplierSchema = CreateSupplierSchema.partial();
export type UpdateSupplierRequest = z.infer<typeof UpdateSupplierSchema>;

export const CreateSupplierItemSchema = z.object({
  supplierId: z.string().uuid(),
  itemId: z.string().uuid(),
  supplierSku: z.string().max(100).optional(),
  lastPrice: z.number().min(0).default(0),
  packSize: z.number().positive().default(1),
  uomId: z.string().uuid(),
});
export type CreateSupplierItemRequest = z.input<typeof CreateSupplierItemSchema>;

export const CreateStockLocationSchema = z.object({
  branchId: z.string().uuid(),
  code: z.string().min(1).max(50),
  name: z.string().min(1).max(200),
  type: z.enum(['CENTRAL_STORE', 'PHARMACY', 'CLINIC_ROOM', 'LAB', 'QUARANTINE', 'WASTE', 'IN_TRANSIT']),
  parentId: z.string().uuid().optional(),
});
export type CreateStockLocationRequest = z.infer<typeof CreateStockLocationSchema>;

export const UpdateLocationItemParamsSchema = z.object({
  locationId: z.string().uuid(),
  itemId: z.string().uuid(),
  minQty: z.number().min(0).default(0),
  maxQty: z.number().min(0).optional(),
  parQty: z.number().min(0).optional(),
  reorderPoint: z.number().min(0).optional(),
});
export type UpdateLocationItemParamsRequest = z.input<typeof UpdateLocationItemParamsSchema>;

// Movement & Ledger
export const MovementTypeEnum = z.enum([
  'GRN', 'ISSUE_OUT', 'ISSUE_IN', 'DISPENSE', 'SALE',
  'PATIENT_RETURN', 'SUPPLIER_RETURN', 'ADJ_GAIN', 'ADJ_LOSS', 'COUNT_VARIANCE',
  'DISPOSAL', 'CONSUMPTION', 'TRANSFER_OUT', 'TRANSFER_IN', 'REVERSAL',
]);
export type MovementType = z.infer<typeof MovementTypeEnum>;

export const PostMovementSchema = z.object({
  locationId: z.string().uuid(),
  itemId: z.string().uuid(),
  batchId: z.string().uuid().optional(),
  qty: z.number(), // signed, non-zero
  uomId: z.string().uuid(),
  unitCost: z.number().min(0).optional(),
  movementType: MovementTypeEnum,
  occurredAt: z.string().optional(),
  refType: z.string().optional(),
  refId: z.string().uuid().optional(),
  reversalOf: z.string().uuid().optional(),
  reasonCode: z.string().optional(),
  reasonNote: z.string().optional(),
});
export type PostMovementRequest = z.infer<typeof PostMovementSchema>;

// Consumption (SUP-T10)
export const PostConsumptionSchema = z.object({
  locationId: z.string().uuid(),
  itemId: z.string().uuid(),
  batchId: z.string().uuid().optional(), // optional -> auto FEFO
  qty: z.number().positive(),
  uomId: z.string().uuid(),
  refType: z.enum(['VISIT', 'LAB', 'PROCEDURE', 'HOUSE_USE']),
  refId: z.string().uuid().optional(),
  notes: z.string().max(500).optional(),
});
export type PostConsumptionRequest = z.infer<typeof PostConsumptionSchema>;

// Patient supply requests (SUP-T10, specification §10). A patient/visit-linked
// request queue so the supply workbench can group pending supplies by patient and
// issue them against that encounter. Issuing consumes stock through the same
// single-transaction path as POST /supply/consumption.
export const PatientSupplyRequestStatusSchema = z.enum([
  'PENDING', 'PARTIALLY_ISSUED', 'ISSUED', 'CANCELLED',
]);
export type PatientSupplyRequestStatus = z.infer<typeof PatientSupplyRequestStatusSchema>;

export const CreatePatientSupplyRequestItemSchema = z.object({
  itemId: z.string().uuid(),
  uomId: z.string().uuid(),
  qtyRequested: z.number().positive(),
  notes: z.string().max(500).optional(),
});
export type CreatePatientSupplyRequestItem = z.infer<typeof CreatePatientSupplyRequestItemSchema>;

export const CreatePatientSupplyRequestSchema = z.object({
  branchId: z.string().uuid(),
  patientId: z.string().uuid(),
  visitId: z.string().uuid().optional(),
  notes: z.string().max(1000).optional(),
  items: z.array(CreatePatientSupplyRequestItemSchema).min(1).max(50),
});
export type CreatePatientSupplyRequestRequest = z.input<typeof CreatePatientSupplyRequestSchema>;

// Issue one requested line. `qty` may be less than requested (partial issue).
export const IssuePatientSupplyRequestSchema = z.object({
  locationId: z.string().uuid(),
  qty: z.number().positive(),
  batchId: z.string().uuid().optional(),
  notes: z.string().max(500).optional(),
});
export type IssuePatientSupplyRequestRequest = z.infer<typeof IssuePatientSupplyRequestSchema>;

// Periods & Period Lock (SUP-T13, AC-20)
export const PeriodActionSchema = z.object({
  period: z.string().regex(/^\d{4}-\d{2}$/, 'Period must be in YYYY-MM format'),
  stepUpPasscode: z.string().optional(),
});
export type PeriodActionRequest = z.infer<typeof PeriodActionSchema>;

// Batches
export const QuarantineBatchSchema = z.object({
  reason: z.string().min(1).max(500),
});
export type QuarantineBatchRequest = z.infer<typeof QuarantineBatchSchema>;

export const ReleaseBatchSchema = z.object({
  notes: z.string().max(500).optional(),
});
export type ReleaseBatchRequest = z.infer<typeof ReleaseBatchSchema>;

// Purchase Requests (PR)
export const CreatePrItemSchema = z.object({
  itemId: z.string().uuid(),
  qtyRequested: z.number().positive(),
  uomId: z.string().uuid(),
  notes: z.string().max(500).optional(),
});
export const CreatePrSchema = z.object({
  branchId: z.string().uuid(),
  locationId: z.string().uuid(),
  neededBy: z.string().optional(),
  reason: z.string().max(500).optional(),
  items: z.array(CreatePrItemSchema).min(1),
});
export type CreatePrRequest = z.infer<typeof CreatePrSchema>;

export const ConvertPrToPoSchema = z.object({
  supplierId: z.string().uuid(),
  expectedDate: z.string().optional(),
  termsDays: z.number().int().min(0).default(30),
});
export type ConvertPrToPoRequest = z.input<typeof ConvertPrToPoSchema>;

// Purchase Orders (PO)
export const CreatePoItemSchema = z.object({
  itemId: z.string().uuid(),
  qtyOrdered: z.number().positive(),
  unitPrice: z.number().min(0),
  uomId: z.string().uuid(),
});
export const CreatePoSchema = z.object({
  branchId: z.string().uuid(),
  supplierId: z.string().uuid(),
  expectedDate: z.string().optional(),
  termsDays: z.number().int().min(0).default(30),
  items: z.array(CreatePoItemSchema).min(1),
});
export type CreatePoRequest = z.input<typeof CreatePoSchema>;

// Goods Receipts (GRN) & Receiving (AC-8)
export const CreateGrnLineSchema = z.object({
  itemId: z.string().uuid(),
  lotNo: z.string().min(1).max(100),
  expiryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expiry date must be YYYY-MM-DD'),
  qtyReceived: z.number().positive(),
  uomId: z.string().uuid(),
  unitCost: z.number().min(0).default(0),
  inspectionResult: z.enum(['ACCEPT', 'QUARANTINE', 'REJECT']).default('ACCEPT'),
  overrideReason: z.string().max(500).optional(),
});
export const CreateGrnSchema = z.object({
  branchId: z.string().uuid(),
  locationId: z.string().uuid(),
  poId: z.string().uuid().optional(),
  supplierId: z.string().uuid(),
  deliveryNoteNo: z.string().max(100).optional(),
  temperatureCelsius: z.number().optional(),
  temperatureOk: z.boolean().default(true),
  inspectionNotes: z.string().max(1000).optional(),
  lines: z.array(CreateGrnLineSchema).min(1),
});
export type CreateGrnRequest = z.input<typeof CreateGrnSchema>;

export const VoidGrnSchema = z.object({
  reason: z.string().min(1).max(500),
});
export type VoidGrnRequest = z.infer<typeof VoidGrnSchema>;

// Requisitions & Issues (AC-9)
export const CreateRequisitionItemSchema = z.object({
  itemId: z.string().uuid(),
  qtyRequested: z.number().positive(),
  uomId: z.string().uuid(),
});
export const CreateRequisitionSchema = z.object({
  branchId: z.string().uuid(),
  fromLocationId: z.string().uuid(),
  toLocationId: z.string().uuid(),
  type: z.enum(['ADHOC', 'PAR', 'STAT']).default('ADHOC'),
  neededBy: z.string().optional(),
  items: z.array(CreateRequisitionItemSchema).min(1),
});
export type CreateRequisitionRequest = z.input<typeof CreateRequisitionSchema>;

export const CreateIssueLineSchema = z.object({
  itemId: z.string().uuid(),
  batchId: z.string().uuid(),
  qtyIssued: z.number().positive(),
});
export const CreateIssueSchema = z.object({
  requisitionId: z.string().uuid(),
  lines: z.array(CreateIssueLineSchema).min(1),
});
export type CreateIssueRequest = z.infer<typeof CreateIssueSchema>;

export const AcknowledgeRequisitionLineSchema = z.object({
  itemId: z.string().uuid(),
  batchId: z.string().uuid(),
  qtyReceived: z.number().min(0),
  discrepancyReason: z.string().max(500).optional(),
});
export const AcknowledgeRequisitionSchema = z.object({
  issueId: z.string().uuid(),
  lines: z.array(AcknowledgeRequisitionLineSchema).min(1),
});
export type AcknowledgeRequisitionRequest = z.infer<typeof AcknowledgeRequisitionSchema>;

// Stock Adjustments (SUP-T5)
export const CreateAdjustmentLineSchema = z.object({
  itemId: z.string().uuid(),
  batchId: z.string().uuid().optional(),
  qtyDelta: z.number(), // positive (gain) or negative (loss)
  unitCost: z.number().min(0).optional(),
  notes: z.string().max(500).optional(),
});
export const CreateAdjustmentSchema = z.object({
  branchId: z.string().uuid(),
  locationId: z.string().uuid(),
  reasonCode: z.string().min(1).max(50),
  lines: z.array(CreateAdjustmentLineSchema).min(1),
});
export type CreateAdjustmentRequest = z.infer<typeof CreateAdjustmentSchema>;

// Physical Counts (SUP-T6)
export const CreateCountSchema = z.object({
  branchId: z.string().uuid(),
  locationId: z.string().uuid(),
  type: z.enum(['FULL', 'CYCLE', 'SPOT']).default('FULL'),
  blind: z.boolean().default(false),
});
export type CreateCountRequest = z.input<typeof CreateCountSchema>;

export const EnterCountLineSchema = z.object({
  itemId: z.string().uuid(),
  batchId: z.string().uuid().optional(),
  countedQty: z.number().min(0),
  notes: z.string().max(500).optional(),
});
export const EnterCountLinesSchema = z.object({
  lines: z.array(EnterCountLineSchema).min(1),
});
export type EnterCountLinesRequest = z.infer<typeof EnterCountLinesSchema>;

// Disposals (SUP-T8)
export const CreateDisposalLineSchema = z.object({
  itemId: z.string().uuid(),
  batchId: z.string().uuid(),
  qty: z.number().positive(),
  unitCost: z.number().min(0).optional(),
});
export const CreateDisposalSchema = z.object({
  branchId: z.string().uuid(),
  locationId: z.string().uuid(),
  reason: z.enum(['EXPIRED', 'DAMAGED', 'RECALLED', 'CONTAMINATED']),
  method: z.string().min(1).max(200),
  witness1Id: z.string().uuid().optional(),
  witness2Id: z.string().uuid().optional(),
  certificateUrl: z.string().url().max(1000).optional(),
  photoUrl: z.string().url().max(1000).optional(),
  lines: z.array(CreateDisposalLineSchema).min(1),
});
export type CreateDisposalRequest = z.infer<typeof CreateDisposalSchema>;

// Recalls (SUP-T9)
export const CreateRecallSchema = z.object({
  source: z.enum(['SUPPLIER', 'FDA', 'INTERNAL']),
  reason: z.string().min(1).max(500),
  batches: z.array(z.object({
    itemId: z.string().uuid(),
    batchId: z.string().uuid(),
  })).min(1),
});
export type CreateRecallRequest = z.infer<typeof CreateRecallSchema>;

export const CloseRecallSchema = z.object({
  checklist: z.record(z.string(), z.unknown()).default({}),
});
export type CloseRecallRequest = z.infer<typeof CloseRecallSchema>;

// Bulk Import Location Params (SUP-T1, todo §4.1)
export const BulkImportLocationParamsSchema = z.object({
  csvContent: z.string().min(1),
});
export type BulkImportLocationParamsRequest = z.infer<typeof BulkImportLocationParamsSchema>;

export const BulkImportResultSchema = z.object({
  totalRows: z.number(),
  importedCount: z.number(),
  failedCount: z.number(),
  errors: z.array(
    z.object({
      rowNumber: z.number(),
      locationCode: z.string().optional(),
      itemCode: z.string().optional(),
      reason: z.string(),
    }),
  ),
});
export type BulkImportResult = z.infer<typeof BulkImportResultSchema>;

// Supplier Invoices & 3-Way Match (SUP-T2, todo §4.3)
export const CreateSupplierInvoiceSchema = z.object({
  invoiceNo: z.string().min(1).max(100),
  poId: z.string().uuid().optional(),
  grnId: z.string().uuid().optional(),
  amount: z.number().positive(),
});
export type CreateSupplierInvoiceRequest = z.infer<typeof CreateSupplierInvoiceSchema>;

// Supplier Returns (SUP-T7, todo §4.3)
export const CreateSupplierReturnLineSchema = z.object({
  itemId: z.string().uuid(),
  batchId: z.string().uuid(),
  qty: z.number().positive(),
  unitCost: z.number().min(0).default(0),
});
export const CreateSupplierReturnSchema = z.object({
  supplierId: z.string().uuid(),
  locationId: z.string().uuid(),
  reason: z.string().min(1).max(500),
  items: z.array(CreateSupplierReturnLineSchema).min(1),
});
export type CreateSupplierReturnRequest = z.input<typeof CreateSupplierReturnSchema>;

// ════════════════════════════════════════════════════════════════════════════
// Phase 5: Pharmacy (M6)
// ════════════════════════════════════════════════════════════════════════════

// Generics (PHM-T1)
export const CreateGenericNameSchema = z.object({
  name: z.string().min(1).max(200),
  atcCode: z.string().max(20).optional(),
});
export type CreateGenericNameRequest = z.infer<typeof CreateGenericNameSchema>;

export const UpdateGenericNameSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  atcCode: z.string().max(20).optional(),
});
export type UpdateGenericNameRequest = z.infer<typeof UpdateGenericNameSchema>;

// Drug Products (PHM-T1)
export const CreateDrugProductSchema = z.object({
  code: z.string().min(1).max(50),
  name: z.string().min(1).max(200).optional(),
  genericId: z.string().uuid(),
  brandName: z.string().min(1).max(200),
  strength: z.string().min(1).max(100),
  dosageForm: z.string().min(1).max(100),
  route: z.string().min(1).max(100),
  packSize: z.number().int().positive().default(1),
  baseUomId: z.string().uuid().optional(),
  fdaRegNo: z.string().max(100).optional(),
  rxRequired: z.enum(['OTC', 'RX', 'CONTROLLED']).default('RX'),
  controlledSchedule: z.enum([
    'DDB_SCHEDULE_1', 'DDB_SCHEDULE_2', 'DDB_SCHEDULE_3', 'DDB_SCHEDULE_4', 'DDB_SCHEDULE_5',
  ]).optional(),
  storage: z.enum(['ROOM', 'COLD']).default('ROOM'),
  isFormulary: z.boolean().default(true),
  highAlert: z.boolean().default(false),
  allergyClass: z.string().max(100).optional(),
  standardCost: z.number().min(0).default(0),
  price: z.number().min(0).optional(),
  minShelfLifeDays: z.number().int().min(0).default(30),
});
export type CreateDrugProductRequest = z.input<typeof CreateDrugProductSchema>;

export const UpdateDrugProductSchema = z.object({
  brandName: z.string().min(1).max(200).optional(),
  fdaRegNo: z.string().max(100).optional(),
  rxRequired: z.enum(['OTC', 'RX', 'CONTROLLED']).optional(),
  controlledSchedule: z.enum([
    'DDB_SCHEDULE_1', 'DDB_SCHEDULE_2', 'DDB_SCHEDULE_3', 'DDB_SCHEDULE_4', 'DDB_SCHEDULE_5',
  ]).optional(),
  storage: z.enum(['ROOM', 'COLD']).optional(),
  isFormulary: z.boolean().optional(),
  highAlert: z.boolean().optional(),
  allergyClass: z.string().max(100).optional(),
  standardCost: z.number().min(0).optional(),
  price: z.number().min(0).optional(),
});
export type UpdateDrugProductRequest = z.infer<typeof UpdateDrugProductSchema>;

// Drug Interactions (PHM-T1)
export const CreateDrugInteractionSchema = z.object({
  genericAId: z.string().uuid(),
  genericBId: z.string().uuid(),
  severity: z.enum(['CONTRAINDICATED', 'MAJOR', 'MODERATE', 'MINOR']),
  mechanism: z.string().max(1000).optional(),
  clinicalAdvice: z.string().min(1).max(2000),
  isTenantOverride: z.boolean().default(false),
  overrideReason: z.string().max(500).optional(),
});
export type CreateDrugInteractionRequest = z.input<typeof CreateDrugInteractionSchema>;

// Price Rules (PHM-T2)
export const CreatePriceRuleSchema = z.object({
  itemId: z.string().uuid(),
  pricingStrategy: z.enum(['MARKUP_PCT', 'FIXED_PRICE']),
  markupPct: z.number().min(0).max(1000).optional(),
  fixedPrice: z.number().min(0).optional(),
  effectiveFrom: z.string().optional(),
  effectiveTo: z.string().optional(),
});
export type CreatePriceRuleRequest = z.infer<typeof CreatePriceRuleSchema>;

// Prescription Verification (PHM-T1)
export const VerifyPrescriptionSchema = z.object({
  action: z.enum(['APPROVE', 'INTERVENE', 'REJECT']),
  interventionType: z.enum(['ALLERGY', 'INTERACTION', 'DUPLICATE', 'DOSE_HIGH', 'DOSE_LOW', 'FORMULARY', 'OTHER']).optional(),
  description: z.string().max(1000).optional(),
  outcome: z.enum(['APPROVED_WITH_OVERRIDE', 'MODIFIED_BY_PRESCRIBER', 'CANCELLED_BY_PRESCRIBER', 'REJECTED']).optional(),
  rejectReason: z.string().max(1000).optional(),
});
export type VerifyPrescriptionRequest = z.infer<typeof VerifyPrescriptionSchema>;

export const CreateInterventionSchema = z.object({
  type: z.enum(['ALLERGY', 'INTERACTION', 'DUPLICATE', 'DOSE_HIGH', 'DOSE_LOW', 'FORMULARY', 'OTHER']),
  description: z.string().min(1).max(1000),
  outcome: z.enum(['APPROVED_WITH_OVERRIDE', 'MODIFIED_BY_PRESCRIBER', 'CANCELLED_BY_PRESCRIBER', 'REJECTED']),
});
export type CreateInterventionRequest = z.infer<typeof CreateInterventionSchema>;

export const RecordInteractionDecisionSchema = z.object({
  rxId: z.string().uuid(),
  interactionId: z.string().uuid().optional(),
  drugAName: z.string().min(1),
  drugBName: z.string().min(1),
  severity: z.string().min(1),
  decision: z.enum(['OVERRIDDEN', 'INTERVENED', 'CANCELLED']),
  justificationReasonCode: z.string().max(50).optional(),
  justificationNotes: z.string().max(1000).optional(),
});
export type RecordInteractionDecisionRequest = z.infer<typeof RecordInteractionDecisionSchema>;

// Dispensing (PHM-T2, PHM-T4, AC-7)
export const DispenseItemInputSchema = z.object({
  prescriptionItemId: z.string().uuid().optional(),
  itemId: z.string().uuid(),
  batchId: z.string().uuid().optional(),
  qty: z.number().positive(),
  unitPrice: z.number().min(0).optional(),
  substitutedFromItemId: z.string().uuid().optional(),
  substitutionReason: z.string().max(500).optional(),
  overrideReason: z.string().max(500).optional(),
});
export type DispenseItemInput = z.infer<typeof DispenseItemInputSchema>;

export const CreateDispenseSchema = z.object({
  branchId: z.string().uuid(),
  patientId: z.string().uuid(),
  rxId: z.string().uuid().optional(),
  isControlled: z.boolean().default(false),
  notes: z.string().max(1000).optional(),
  lines: z.array(DispenseItemInputSchema).optional(),
});
export type CreateDispenseRequest = z.input<typeof CreateDispenseSchema>;

export const PostDispenseSchema = z.object({
  locationId: z.string().uuid(),
  counsellingDone: z.boolean().default(true),
  lines: z.array(DispenseItemInputSchema).min(1),
  specialRxSerial: z.string().max(100).optional(),
  prescriberS2No: z.string().max(100).optional(),
  qtyWords: z.string().max(200).optional(),
  witnessId: z.string().uuid().optional(),
  witnessSignature: z.string().optional(),
});
export type PostDispenseRequest = z.input<typeof PostDispenseSchema>;

export const VoidDispenseSchema = z.object({
  locationId: z.string().uuid(),
  reason: z.string().min(1).max(500),
});
export type VoidDispenseRequest = z.infer<typeof VoidDispenseSchema>;

// Special Rx Records (PHM-T4, AC-7)
export const CreateSpecialRxRecordSchema = z.object({
  specialRxSerial: z.string().min(1).max(100),
  prescriberId: z.string().uuid(),
  s2LicenseNo: z.string().min(1).max(100),
  patientId: z.string().uuid(),
  drugItemId: z.string().uuid(),
  qtyWords: z.string().min(1).max(200),
  qtyNumeric: z.number().positive(),
  dateIssued: z.string(),
  copyStatus: z.enum(['ORIGINAL', 'DUPLICATE', 'TRIPLICATE']).default('ORIGINAL'),
});
export type CreateSpecialRxRecordRequest = z.input<typeof CreateSpecialRxRecordSchema>;

// OTC Sales (PHM-T3)
export const CreateOtcSaleSchema = z.object({
  branchId: z.string().uuid(),
  locationId: z.string().uuid(),
  patientId: z.string().uuid().optional(),
  items: z.array(z.object({
    itemId: z.string().uuid(),
    batchId: z.string().uuid().optional(),
    qty: z.number().positive(),
    unitPrice: z.number().min(0).optional(),
  })).min(1),
  counsellingDone: z.boolean().default(false),
  notes: z.string().max(500).optional(),
});
export type CreateOtcSaleRequest = z.input<typeof CreateOtcSaleSchema>;

// Medication Administration (PHM-T6)
export const CreateMedicationAdminSchema = z.object({
  branchId: z.string().uuid(),
  visitId: z.string().uuid(),
  locationId: z.string().uuid(),
  drugItemId: z.string().uuid(),
  batchId: z.string().uuid(),
  dose: z.string().min(1).max(100),
  route: z.string().min(1).max(100),
  notes: z.string().max(1000).optional(),
});
export type CreateMedicationAdminRequest = z.infer<typeof CreateMedicationAdminSchema>;

// Patient Returns (PHM-T5)
export const CreatePatientReturnSchema = z.object({
  branchId: z.string().uuid(),
  dispenseId: z.string().uuid(),
  dispenseItemId: z.string().uuid(),
  locationId: z.string().uuid(),
  qty: z.number().positive(),
  reason: z.string().min(1).max(500),
  disposition: z.enum(['RESTOCK', 'QUARANTINE', 'DISPOSE']),
  creditNoteRef: z.string().max(100).optional(),
});
export type CreatePatientReturnRequest = z.infer<typeof CreatePatientReturnSchema>;

// =============================================================================
// Phase 6: Laboratory & Pathology Contracts
// =============================================================================

export const CreateLabSectionSchema = z.object({
  code: z.string().min(1).max(20),
  name: z.string().min(1).max(100),
  displayOrder: z.number().int().default(0),
  isActive: z.boolean().default(true),
});
export type CreateLabSectionRequest = z.input<typeof CreateLabSectionSchema>;

export const UpdateLabSectionSchema = CreateLabSectionSchema.partial();
export type UpdateLabSectionRequest = z.input<typeof UpdateLabSectionSchema>;

export const CreateLabSpecimenTypeSchema = z.object({
  code: z.string().min(1).max(30),
  name: z.string().min(1).max(100),
  defaultContainer: z.string().min(1).max(100),
  tubeTopColor: z.string().max(50).optional(),
  isActive: z.boolean().default(true),
});
export type CreateLabSpecimenTypeRequest = z.input<typeof CreateLabSpecimenTypeSchema>;

export const CreateLabTestSchema = z.object({
  sectionId: z.string().uuid(),
  specimenTypeId: z.string().uuid(),
  code: z.string().min(1).max(30),
  name: z.string().min(1).max(150),
  loincCode: z.string().max(30).optional(),
  tatMinutes: z.number().int().positive().default(60),
  isStatAllowed: z.boolean().default(true),
  isConfidential: z.boolean().default(false),
  fastingRequired: z.boolean().default(false),
  fastingHours: z.number().int().optional(),
  instructions: z.string().max(500).optional(),
  price: z.number().min(0).optional(),
  isPanel: z.boolean().default(false),
  panelTestIds: z.array(z.string().uuid()).optional(),
  requiresPathologistReview: z.boolean().default(false),
  isActive: z.boolean().default(true),
});
export type CreateLabTestRequest = z.input<typeof CreateLabTestSchema>;

export const UpdateLabTestSchema = CreateLabTestSchema.partial();
export type UpdateLabTestRequest = z.input<typeof UpdateLabTestSchema>;

export const CreateLabAnalyteSchema = z.object({
  testId: z.string().uuid(),
  code: z.string().min(1).max(30),
  name: z.string().min(1).max(150),
  defaultUnit: z.string().min(1).max(50),
  precisionDigits: z.number().int().min(0).max(6).default(2),
  isCalculated: z.boolean().default(false),
  calculationFormula: z.string().max(250).optional(),
  sortOrder: z.number().int().default(0),
  isActive: z.boolean().default(true),
});
export type CreateLabAnalyteRequest = z.input<typeof CreateLabAnalyteSchema>;

export const CreateLabReferenceRangeSchema = z.object({
  analyteId: z.string().uuid(),
  sex: z.enum(['ALL', 'MALE', 'FEMALE']).default('ALL'),
  ageMinDays: z.number().int().default(0),
  ageMaxDays: z.number().int().default(36500),
  normalMin: z.number().optional(),
  normalMax: z.number().optional(),
  criticalLow: z.number().optional(),
  criticalHigh: z.number().optional(),
  textRange: z.string().max(200).optional(),
  effectiveFrom: z.string().datetime().optional(),
  effectiveTo: z.string().datetime().optional(),
});
export type CreateLabReferenceRangeRequest = z.input<typeof CreateLabReferenceRangeSchema>;

export const CreateLabDeltaRuleSchema = z.object({
  analyteId: z.string().uuid(),
  deltaType: z.enum(['ABSOLUTE', 'PERCENT']).default('PERCENT'),
  maxChange: z.number().positive(),
  lookbackHours: z.number().int().positive().default(72),
});
export type CreateLabDeltaRuleRequest = z.input<typeof CreateLabDeltaRuleSchema>;

export const CreateLabInstrumentSchema = z.object({
  branchId: z.string().uuid(),
  sectionId: z.string().uuid(),
  code: z.string().min(1).max(50),
  name: z.string().min(1).max(150),
  model: z.string().max(100).optional(),
  serialNo: z.string().max(100).optional(),
  calibrationDueAt: z.string().datetime().optional(),
  lastCalibratedAt: z.string().datetime().optional(),
  isActive: z.boolean().default(true),
});
export type CreateLabInstrumentRequest = z.input<typeof CreateLabInstrumentSchema>;

export const CreateLabTestReagentSchema = z.object({
  testId: z.string().uuid(),
  itemId: z.string().uuid(),
  qtyPerTest: z.number().positive(),
  uomId: z.string().uuid(),
});
export type CreateLabTestReagentRequest = z.input<typeof CreateLabTestReagentSchema>;

export const CreateLabReportTemplateSchema = z.object({
  sectionId: z.string().uuid().optional(),
  name: z.string().min(1).max(150),
  templateHtml: z.string().min(1),
  isDefault: z.boolean().default(false),
});
export type CreateLabReportTemplateRequest = z.input<typeof CreateLabReportTemplateSchema>;

// Laboratory Transactional Workflows (LAB-T1 to LAB-T13)
export const CreateLabOrderSchema = z.object({
  branchId: z.string().uuid(),
  patientId: z.string().uuid(),
  visitId: z.string().uuid().optional(),
  testIds: z.array(z.string().uuid()).min(1),
  priority: z.enum(['ROUTINE', 'URGENT', 'STAT']).default('ROUTINE'),
  clinicalInfo: z.string().max(1000).optional(),
  source: z.enum(['VISIT', 'WALK_IN', 'SEND_IN']).default('VISIT'),
});
export type CreateLabOrderRequest = z.input<typeof CreateLabOrderSchema>;

export const CancelLabOrderSchema = z.object({
  reason: z.string().min(3).max(500),
});
export type CancelLabOrderRequest = z.infer<typeof CancelLabOrderSchema>;

export const CollectSpecimenSchema = z.object({
  specimenTypeId: z.string().uuid(),
  collectionSite: z.string().max(100).optional(),
  collectedAt: z.string().datetime().optional(),
  storageLocation: z.string().max(100).optional(),
  twoIdentifiersVerified: z.boolean().default(true),
});
export type CollectSpecimenRequest = z.input<typeof CollectSpecimenSchema>;

export const ReceiveSpecimenSchema = z.object({
  condition: z.enum(['OK', 'HEMOLYZED', 'INSUFFICIENT', 'CLOTTED', 'MISLABELED']).default('OK'),
  rejectionReason: z.string().max(500).optional(),
  storageLocation: z.string().max(100).optional(),
});
export type ReceiveSpecimenRequest = z.input<typeof ReceiveSpecimenSchema>;

export const EnterLabResultItemSchema = z.object({
  analyteId: z.string().uuid(),
  valueNum: z.number().optional(),
  valueText: z.string().max(500).optional(),
  unit: z.string().min(1).max(50),
  instrumentId: z.string().uuid().optional(),
});

export const EnterLabResultsSchema = z.object({
  results: z.array(EnterLabResultItemSchema).min(1),
  locationId: z.string().uuid().optional(), // For reagent inventory consumption
});
export type EnterLabResultsRequest = z.input<typeof EnterLabResultsSchema>;

export const VerifyLabResultSchema = z.object({
  notes: z.string().max(500).optional(),
});
export type VerifyLabResultRequest = z.infer<typeof VerifyLabResultSchema>;

export const AmendLabResultSchema = z.object({
  reason: z.string().min(5).max(1000),
  newValue: z.string().min(1).max(500),
  notifiedToUserId: z.string().uuid().optional(),
});
export type AmendLabResultRequest = z.infer<typeof AmendLabResultSchema>;

export const AckCriticalNotificationSchema = z.object({
  notifiedTo: z.string().min(2).max(200),
  method: z.enum(['IN_APP', 'PHONE', 'SMS']).default('IN_APP'),
  readBackConfirmed: z.boolean().default(true),
  readBackText: z.string().min(2).max(500),
});
export type AckCriticalNotificationRequest = z.input<typeof AckCriticalNotificationSchema>;

export const ReleaseLabReportSchema = z.object({
  status: z.enum(['PRELIMINARY', 'FINAL', 'CORRECTED']).default('FINAL'),
  notes: z.string().max(1000).optional(),
  confidentialReleaseReason: z.string().min(2).max(200).optional(),
});
export type ReleaseLabReportRequest = z.input<typeof ReleaseLabReportSchema>;

export const CreateLabQcMaterialSchema = z.object({
  sectionId: z.string().uuid(),
  code: z.string().min(1).max(50),
  name: z.string().min(1).max(150),
  manufacturer: z.string().max(100).optional(),
  lotNo: z.string().min(1).max(50),
  expiryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  isActive: z.boolean().default(true),
});
export type CreateLabQcMaterialRequest = z.input<typeof CreateLabQcMaterialSchema>;

export const CreateLabQcRunSchema = z.object({
  instrumentId: z.string().uuid(),
  materialId: z.string().uuid(),
  results: z.array(z.object({
    analyteId: z.string().uuid(),
    valueNum: z.number(),
    targetMean: z.number(),
    targetSd: z.number(),
  })).min(1),
  status: z.enum(['ACCEPTED', 'REJECTED']).default('ACCEPTED'),
  correctiveAction: z.string().max(1000).optional(),
});
export type CreateLabQcRunRequest = z.input<typeof CreateLabQcRunSchema>;

export const CreateLabSendOutSchema = z.object({
  orderItemId: z.string().uuid(),
  referenceLabName: z.string().min(2).max(200),
  trackingNo: z.string().max(100).optional(),
  notes: z.string().max(1000).optional(),
});
export type CreateLabSendOutRequest = z.input<typeof CreateLabSendOutSchema>;

export const ReceiveLabSendOutResultSchema = z.object({
  receivedResults: z.string().min(1).max(5000),
  reportNotes: z.string().max(1000).optional(),
});
export type ReceiveLabSendOutResultRequest = z.input<typeof ReceiveLabSendOutResultSchema>;

/** ---- Billing & Cashiering (Phase 7, specification §11, §18.9, todo.md §7) ---- */

export const PayerTypeSchema = z.enum(['PRIVATE_CASH', 'HMO', 'PHILHEALTH', 'CORPORATE']);
export type PayerType = z.infer<typeof PayerTypeSchema>;

export const InvoiceStatusSchema = z.enum(['DRAFT', 'OPEN', 'PARTIAL', 'PAID', 'VOID']);
export type InvoiceStatus = z.infer<typeof InvoiceStatusSchema>;

export const InvoiceLineSourceTypeSchema = z.enum([
  'SERVICE',
  'LAB',
  'PHARMACY',
  'SUPPLY',
  'PROCEDURE',
  'CONSULT',
  'MANUAL',
  'CHARGE',
]);
export type InvoiceLineSourceType = z.infer<typeof InvoiceLineSourceTypeSchema>;

export const CreateInvoiceLineSchema = z.object({
  sourceType: InvoiceLineSourceTypeSchema.default('MANUAL'),
  sourceId: z.string().uuid().optional(),
  description: z.string().min(1).max(250),
  qty: z.number().positive().default(1),
  unitPrice: z.number().min(0),
  discountTypeId: z.string().uuid().optional(),
  isProfessionalFee: z.boolean().default(false),
  payerType: PayerTypeSchema.default('PRIVATE_CASH'),
  taxCode: z.string().default('VAT_EXEMPT'),
});
export type CreateInvoiceLineRequest = z.input<typeof CreateInvoiceLineSchema>;

export const CreateInvoiceSchema = z.object({
  branchId: z.string().uuid(),
  patientId: z.string().uuid().optional(),
  visitId: z.string().uuid().optional(),
  payerType: PayerTypeSchema.default('PRIVATE_CASH'),
  notes: z.string().max(500).optional(),
  lines: z.array(CreateInvoiceLineSchema).optional(),
  consumeChargeIds: z.array(z.string().uuid()).optional(),
});
export type CreateInvoiceRequest = z.input<typeof CreateInvoiceSchema>;

export const UpdateInvoiceSchema = z.object({
  notes: z.string().max(500).optional(),
  payerType: PayerTypeSchema.optional(),
});
export type UpdateInvoiceRequest = z.input<typeof UpdateInvoiceSchema>;

export const AddInvoiceLineSchema = CreateInvoiceLineSchema;
export type AddInvoiceLineRequest = z.input<typeof AddInvoiceLineSchema>;

export const ConsumeChargesSchema = z.object({
  chargeIds: z.array(z.string().uuid()).min(1),
});
export type ConsumeChargesRequest = z.input<typeof ConsumeChargesSchema>;

export const ApplyDiscountSchema = z.object({
  discountTypeId: z.string().uuid(),
  invoiceLineId: z.string().uuid().optional(),
  idNumber: z.string().max(100).optional(),
  idType: z.string().max(50).optional(),
});
export type ApplyDiscountRequest = z.input<typeof ApplyDiscountSchema>;

export const VoidInvoiceSchema = z.object({
  reason: z.string().min(3).max(500),
  stepUpToken: z.string().optional(),
});
export type VoidInvoiceRequest = z.input<typeof VoidInvoiceSchema>;

export const SplitTenderItemSchema = z.object({
  methodId: z.string().uuid(),
  amount: z.number().positive(),
  tenderedAmount: z.number().positive().optional(),
  reference: z.string().max(100).optional(),
});
export type SplitTenderItem = z.infer<typeof SplitTenderItemSchema>;

export const CreatePaymentSchema = z.object({
  branchId: z.string().uuid(),
  invoiceId: z.string().uuid(),
  shiftId: z.string().uuid().optional(),
  methodId: z.string().uuid(),
  amount: z.number().positive(),
  tenderedAmount: z.number().positive(),
  reference: z.string().max(100).optional(),
  payerType: PayerTypeSchema.default('PRIVATE_CASH'),
  splits: z.array(SplitTenderItemSchema).optional(),
});
export type CreatePaymentRequest = z.input<typeof CreatePaymentSchema>;

export const VoidPaymentSchema = z.object({
  reason: z.string().min(3).max(500),
  stepUpToken: z.string().optional(),
});
export type VoidPaymentRequest = z.input<typeof VoidPaymentSchema>;

export const ReprintReceiptSchema = z.object({
  reason: z.string().min(3).max(500),
  format: z.enum(['PDF', 'THERMAL']).default('PDF'),
});
export type ReprintReceiptRequest = z.input<typeof ReprintReceiptSchema>;

export const OpenShiftSchema = z.object({
  branchId: z.string().uuid(),
  openingCash: z.number().min(0).default(0),
  notes: z.string().max(500).optional(),
});
export type OpenShiftRequest = z.input<typeof OpenShiftSchema>;

export const CloseShiftSchema = z.object({
  countedCash: z.number().min(0),
  notes: z.string().max(500).optional(),
});
export type CloseShiftRequest = z.input<typeof CloseShiftSchema>;

export const CreateCreditNoteSchema = z.object({
  branchId: z.string().uuid(),
  invoiceId: z.string().uuid(),
  amount: z.number().positive(),
  reason: z.string().min(3).max(500),
});
export type CreateCreditNoteRequest = z.input<typeof CreateCreditNoteSchema>;

export const ApproveCreditNoteSchema = z.object({
  notes: z.string().max(500).optional(),
});
export type ApproveCreditNoteRequest = z.input<typeof ApproveCreditNoteSchema>;

export const DailyCloseRunSchema = z.object({
  branchId: z.string().uuid().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
export type DailyCloseRunRequest = z.input<typeof DailyCloseRunSchema>;

export const ModulePreflightBlockerSchema = z.object({
  type: z.string(),
  count: z.number().int().nonnegative(),
  description: z.string(),
});
export type ModulePreflightBlocker = z.infer<typeof ModulePreflightBlockerSchema>;

export const ModulePreflightResponseSchema = z.object({
  module: z.string(),
  canDisable: z.boolean(),
  blockers: z.array(ModulePreflightBlockerSchema),
});
export type ModulePreflightResponse = z.infer<typeof ModulePreflightResponseSchema>;

export const SaveCashSessionSchema = z.object({
  branchId: z.string().uuid(),
  patientId: z.string().uuid().optional(),
  invoiceId: z.string().uuid().optional(),
  status: z.enum(['OPEN', 'HELD', 'COMPLETED', 'VOIDED']).default('OPEN'),
  sessionData: z.record(z.string(), z.any()).default({}),
  rowVersion: z.number().int().positive().optional(),
});
export type SaveCashSessionRequest = z.input<typeof SaveCashSessionSchema>;

export const ClinicProfileSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(200),
  slug: z.string().min(1).max(100),
  tagline: z.string().max(255).nullable().optional(),
  address: z.string().max(500).nullable().optional(),
  phone: z.string().max(100).nullable().optional(),
  email: z.string().max(255).nullable().optional(),
  website: z.string().max(255).nullable().optional(),
  dohLicenseNo: z.string().max(100).nullable().optional(),
  philhealthAccreditationNo: z.string().max(100).nullable().optional(),
  tin: z.string().max(50).nullable().optional(),
  letterheadFooter: z.string().max(500).nullable().optional(),
});
export type ClinicProfile = z.infer<typeof ClinicProfileSchema>;

export const UpdateClinicProfileSchema = z.object({
  name: z.string().min(1, 'Clinic name is required').max(200),
  tagline: z.string().max(255).nullable().optional(),
  address: z.string().max(500).nullable().optional(),
  phone: z.string().max(100).nullable().optional(),
  email: z.string().max(255).nullable().optional(),
  website: z.string().max(255).nullable().optional(),
  dohLicenseNo: z.string().max(100).nullable().optional(),
  philhealthAccreditationNo: z.string().max(100).nullable().optional(),
  tin: z.string().max(50).nullable().optional(),
  letterheadFooter: z.string().max(500).nullable().optional(),
});
export type UpdateClinicProfileRequest = z.infer<typeof UpdateClinicProfileSchema>;

export * from "./compliance.js";
export * from "./notifications.js";
export * from "./reports.js";
export * from "./platform.js";

