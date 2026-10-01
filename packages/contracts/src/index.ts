import { z } from "zod";

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

/** ---- Phase 0 vertical-slice contract: /ping ---- */

export const PingResponseSchema = z.object({
  message: z.string().min(1),
  dbTime: z.string().min(1),
  request_id: z.string().uuid(),
});
export type PingResponse = z.infer<typeof PingResponseSchema>;

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
