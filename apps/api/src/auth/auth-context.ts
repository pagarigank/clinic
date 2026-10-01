import { SetMetadata } from "@nestjs/common";

/**
 * Request-scoped authentication state (Phase 1.2). Attached by AuthGuard;
 * consumed by TenantContextGuard, step-up guard, permission guard (1.3),
 * module guard (1.6) and services building the withTenant() context.
 */
export interface AuthContext {
  kind: "user" | "apikey";
  userId: string | null;
  tenantId: string | null;
  sessionId: string | null;
  branchId: string | null;
  /** Authentication methods: pwd, totp, mfa-recovery, mfa-remembered, apikey. */
  amr: string[];
  /** API-key scopes only (empty for interactive users). */
  scopes: string[];
}

export interface RequestWithAuth {
  authContext?: AuthContext;
  /** Resolved + cross-checked tenant (TenantContextGuard). */
  tenantId?: string;
  correlationId?: string;
}

export const IS_PUBLIC_KEY = "isPublic";
/** Mark a route as unauthenticated (login, refresh, health, ping, metrics). */
export const Public = (): MethodDecorator & ClassDecorator =>
  SetMetadata(IS_PUBLIC_KEY, true);

export const REQUIRE_STEP_UP_KEY = "requireStepUp";
/**
 * Mark a route as high-risk: a valid step-up token (recent re-auth, 5 min)
 * must accompany it (header `X-Step-Up-Token`) or the call gets
 * 401 STEP_UP_REQUIRED (architecture §10, todo 1.2).
 */
export const RequireStepUp = (): MethodDecorator =>
  SetMetadata(REQUIRE_STEP_UP_KEY, true);
