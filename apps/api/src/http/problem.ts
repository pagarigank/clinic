import { ERROR_CODES, type ErrorCode } from "@clinic/contracts";

export interface ProblemBody {
  type: string;
  title: string;
  status: number;
  code: string;
  detail?: string;
  instance?: string;
  correlationId?: string;
  errors?: { path: string; message: string }[];
}

const TITLES: Partial<Record<ErrorCode, string>> = {
  TENANT_CONTEXT_MISSING: "Bad Request",
  VALIDATION_FAILED: "Validation Failed",
  TENANT_MISMATCH: "Forbidden",
  TENANT_SUSPENDED: "Tenant Suspended",
  INVALID_CREDENTIALS: "Unauthorized",
  ACCOUNT_LOCKED: "Account Locked",
  ACCOUNT_DISABLED: "Account Disabled",
  RATE_LIMITED: "Too Many Requests",
  FORBIDDEN: "Forbidden",
  STEP_UP_REQUIRED: "Step-up Authentication Required",
  BREAKGLASS_REQUIRED: "Break-glass Session Required",
  MODULE_NOT_ENTITLED: "Module Not Entitled",
  MODULE_READ_ONLY: "Module Read-only (Draining)",
  MODULE_DEPENDENCY_MISSING: "Module Dependency Missing",
  PLAN_MODULE_NOT_ALLOWED: "Module Not Allowed by Plan",
  MODULE_HAS_OPEN_WORK: "Module Has Open Work",
  NOT_FOUND: "Not Found",
  CONFLICT: "Conflict",
  STALE_ROW_VERSION: "Stale Row Version",
  STOCK_INSUFFICIENT: "Stock Insufficient",
  PERIOD_LOCKED: "Period Locked",
  QUOTA_EXCEEDED: "Quota Exceeded",
  IDEMPOTENCY_CONFLICT: "Idempotency Conflict",
  UPSTREAM_UNAVAILABLE: "Upstream Unavailable",
};

export function statusForCode(code: string): number {
  const status = (ERROR_CODES as Record<string, number | undefined>)[code];
  return status ?? 500;
}

export function buildProblem(
  code: string,
  opts: { detail?: string; correlationId?: string; errors?: ProblemBody["errors"] } = {},
): ProblemBody {
  const status = statusForCode(code);
  return {
    type: `https://docs.clinic-platform.dev/errors/${code}`,
    title: TITLES[code as ErrorCode] ?? "Internal Server Error",
    status,
    code,
    ...(opts.detail !== undefined ? { detail: opts.detail } : {}),
    ...(opts.correlationId !== undefined ? { correlationId: opts.correlationId } : {}),
    ...(opts.errors !== undefined ? { errors: opts.errors } : {}),
  };
}
