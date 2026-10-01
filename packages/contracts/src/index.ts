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
  billing: ["clinical"],
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
  QUOTA_EXCEEDED: 429,
  IDEMPOTENCY_CONFLICT: 409,
  UPSTREAM_UNAVAILABLE: 503,
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
  expiresAt: z.string(), // ISO
  // modules[]/modules_version carried from Phase 1.6 (entitlement cache)
  modules: z.array(z.string()),
  modulesVersion: z.number().int().nullable(),
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
