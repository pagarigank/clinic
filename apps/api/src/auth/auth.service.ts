import { Inject, Injectable } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { withTenant, type PoolClient } from "@clinic/db";
import { getConfig } from "../config.js";
import { ProblemException } from "../http/problem.exception.js";
import { hitRateLimit } from "./rate-limit.js";
import { MfaService, sha256 } from "./mfa.service.js";
import { PasswordService } from "./crypto/password.js";
import {
  type MfaTicketClaims,
  type RefreshClaims,
  TokenService,
} from "./crypto/tokens.js";
import { slugFromHost, TenantResolverService, type DirectoryTenant } from "./tenant-resolver.service.js";
import type {
  ForgotPasswordRequest,
  LoginRequest,
  ResetPasswordRequest,
  SessionInfo,
} from "@clinic/contracts";

export const REFRESH_COOKIE = "clinic_rt";
export const DEVICE_COOKIE = "clinic_mfa_dev";

export interface RequestMeta {
  ip: string | undefined;
  userAgent: string | undefined;
  hostname: string | undefined;
  /** X-Tenant header (slug or tenant id) when the client sent one. */
  headerTenant?: string | undefined;
  /** Remember-device cookie value, when the client presented one. */
  deviceToken?: string | undefined;
}

export type LoginResult =
  | { status: "MFA_REQUIRED"; ticket: string; deviceCookie?: string }
  | {
      status: "AUTHENTICATED";
      accessToken: string;
      refreshToken: string;
      sessionId: string;
      amr: string[];
      deviceCookie?: string;
    };

export interface AuthenticatedResult {
  accessToken: string;
  refreshToken: string;
  sessionId: string;
  amr: string[];
}

interface LoginUserRow {
  id: string;
  email: string;
  name: string;
  password_hash: string;
  status: "INVITED" | "ACTIVE" | "LOCKED" | "DEACTIVATED";
  mfa_enabled: boolean;
  failed_login_count: number;
  locked_until: Date | null;
}

@Injectable()
export class AuthService {
  // Explicit @Inject: esbuild (tsx) does not emit design:paramtypes metadata.
  constructor(
    @Inject(TokenService) private readonly tokens: TokenService,
    @Inject(PasswordService) private readonly passwords: PasswordService,
    @Inject(MfaService) private readonly mfa: MfaService,
    @Inject(TenantResolverService) private readonly resolver: TenantResolverService,
  ) {}

  // ---- login -----------------------------------------------------------

  async login(dto: LoginRequest, meta: RequestMeta): Promise<LoginResult> {
    const slug = dto.tenant ?? meta.headerTenant ?? slugFromHost(meta.hostname ?? "");
    if (!slug) {
      // Anti-enumeration: unknown tenant = same generic failure as unknown user.
      throw new ProblemException("INVALID_CREDENTIALS");
    }
    const tenant = await this.resolver.resolveBySlug(slug);
    if (!tenant || tenant.status === "OFFBOARDED") {
      throw new ProblemException("INVALID_CREDENTIALS");
    }
    if (tenant.status === "SUSPENDED" || tenant.status === "OFFBOARDING") {
      throw new ProblemException("TENANT_SUSPENDED");
    }
    if (tenant.status === "PROVISIONING") {
      throw new ProblemException("CONFLICT", { detail: "this organization is still being set up" });
    }

    const ipKey = `login:ip:${meta.ip ?? "unknown"}`;
    const acctKey = `login:acct:${tenant.id}:${dto.email.toLowerCase()}`;
    if (!hitRateLimit(ipKey, 20, 300).allowed || !hitRateLimit(acctKey, 10, 300).allowed) {
      throw new ProblemException("RATE_LIMITED", { detail: "too many attempts — retry shortly" });
    }

    // NOTE: failure paths deliberately run OUTSIDE the read transaction —
    // withTenant() rolls back on throw, which would otherwise undo the
    // failed_login_count increment / lockout write. Each failure path does
    // its own small write transaction, then throws.
    return withTenant({ tenantId: tenant.id }, async (tx) => {
      const found = await tx.query<LoginUserRow>(
        `SELECT id, email, name, password_hash, status, mfa_enabled,
                failed_login_count, locked_until
         FROM users WHERE tenant_id = $1 AND lower(email) = $2`,
        [tenant.id, dto.email.toLowerCase()],
      );
      const user = found.rows[0];

      if (!user) {
        await this.recordAttemptStandalone(tenant.id, dto.email, meta, false);
        // Burn a hash round anyway: equalize timing against user enumeration.
        await this.passwords.verifyPassword(dto.password, "$argon2id$v=19$m=19456,t=2,p=1$decoy$decoy");
        throw new ProblemException("INVALID_CREDENTIALS");
      }

      if (user.locked_until && user.locked_until.getTime() > Date.now()) {
        const secs = Math.ceil((user.locked_until.getTime() - Date.now()) / 1000);
        throw new ProblemException("ACCOUNT_LOCKED", {
          detail: `account temporarily locked — try again in ${secs}s`,
        });
      }
      if (user.status === "DEACTIVATED") {
        throw new ProblemException("ACCOUNT_DISABLED");
      }

      const passwordOk = await this.passwords.verifyPassword(dto.password, user.password_hash);
      if (!passwordOk) {
        await withTenant({ tenantId: tenant.id }, (wtx) =>
          this.registerFailedAttempt(wtx, tenant.id, user, dto.email, meta),
        );
        throw new ProblemException("INVALID_CREDENTIALS");
      }

      if (user.mfa_enabled) {
        const trusted = await this.mfa.hasTrustedDevice(tenant.id, user.id, meta.deviceToken);
        if (!trusted) {
          const ticket = await this.tokens.issueMfaTicket({
            sub: user.id,
            tid: tenant.id,
            amr: ["pwd"],
          } satisfies Omit<MfaTicketClaims, "typ">);
          return { status: "MFA_REQUIRED" as const, ticket };
        }
      }

      const deviceCookie =
        dto.rememberDevice && user.mfa_enabled && !meta.deviceToken
          ? await this.mfa.issueTrustedDevice(tenant.id, user.id, meta.userAgent?.slice(0, 120))
          : undefined;

      const amr = user.mfa_enabled ? ["pwd", "mfa-remembered"] : ["pwd"];
      const issued = await this.createSessionAndTokens(tx, {
        tenant,
        userId: user.id,
        amr,
        meta,
      });
      await tx.query(
        `UPDATE users SET failed_login_count = 0, locked_until = NULL, last_login_at = now()
         WHERE tenant_id = $1 AND id = $2`,
        [tenant.id, user.id],
      );
      await this.recordAttempt(tx, tenant.id, dto.email, meta, true);

      return {
        status: "AUTHENTICATED" as const,
        accessToken: issued.accessToken,
        refreshToken: issued.refreshToken,
        sessionId: issued.sessionId,
        amr,
        ...(deviceCookie ? { deviceCookie } : {}),
      };
    });
  }

  /** Second leg: verify the MFA challenge against the 2-minute ticket. */
  async verifyMfaLogin(
    ticket: string,
    code: string,
    rememberDevice: boolean | undefined,
    meta: RequestMeta,
  ): Promise<LoginResult> {
    const claims = await this.tokens.verify<MfaTicketClaims>(ticket, "mfa-ticket");
    if (!claims) throw new ProblemException("MFA_INVALID", { detail: "login ticket expired — start again" });

    const method = await this.mfa.verifyChallenge(claims.tid, claims.sub, code);
    if (!method) throw new ProblemException("MFA_INVALID");

    const amrBase = claims.amr.includes(method) ? claims.amr : [...claims.amr, method];
    const deviceCookie = rememberDevice
      ? await this.mfa.issueTrustedDevice(claims.tid, claims.sub, meta.userAgent?.slice(0, 120))
      : undefined;

    const tokens = await withTenant({ tenantId: claims.tid }, async (tx) => {
      const created = await this.createSessionAndTokens(tx, {
        tenant: { id: claims.tid } as DirectoryTenant,
        userId: claims.sub,
        amr: amrBase,
        meta,
      });
      await tx.query(
        `UPDATE users SET failed_login_count = 0, locked_until = NULL, last_login_at = now()
         WHERE tenant_id = $1 AND id = $2`,
        [claims.tid, claims.sub],
      );
      return created;
    });

    return {
      status: "AUTHENTICATED",
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      sessionId: tokens.sessionId,
      amr: amrBase,
      ...(deviceCookie ? { deviceCookie } : {}),
    };
  }

  // ---- refresh / logout ------------------------------------------------

  /**
   * Refresh rotation (architecture §10): the presented token must map to the
   * CURRENT session row. Rotation replaces the row (revoked 'rotation',
   * replaced_by new session). Presenting a revoked/expired token is reuse →
   * the whole user's sessions in the tenant are revoked 'reuse_detected'.
   */
  async refresh(refreshToken: string, meta: RequestMeta): Promise<AuthenticatedResult> {
    const claims = await this.tokens.verify<RefreshClaims>(refreshToken, "refresh");
    if (!claims) throw new ProblemException("INVALID_CREDENTIALS", { detail: "invalid session" });

    const { rows } = await withTenant({ tenantId: claims.tid }, async (tx) => {
      const found = await tx.query<{
        id: string;
        user_id: string;
        refresh_hash: string;
        expires_at: Date;
        revoked_at: Date | null;
      }>(
        `SELECT id, user_id, refresh_hash, expires_at, revoked_at FROM sessions
         WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
        [claims.tid, claims.sid],
      );
      return found;
    });
    const session = rows[0];
    if (!session || session.refresh_hash !== sha256(refreshToken)) {
      throw new ProblemException("INVALID_CREDENTIALS", { detail: "invalid session" });
    }

    // Reuse / expiry handling runs OUTSIDE any transaction that would roll
    // the revocation back on throw — the kill must persist.
    if (session.revoked_at) {
      await withTenant({ tenantId: claims.tid }, (tx) =>
        tx.query(
          `UPDATE sessions SET revoked_at = now(), revoked_reason = 'reuse_detected'
           WHERE tenant_id = $1 AND user_id = $2 AND revoked_at IS NULL`,
          [claims.tid, session.user_id],
        ),
      );
      throw new ProblemException("INVALID_CREDENTIALS", { detail: "session reuse detected — all sessions revoked" });
    }
    if (session.expires_at.getTime() < Date.now()) {
      await withTenant({ tenantId: claims.tid }, (tx) =>
        tx.query(
          `UPDATE sessions SET revoked_at = now(), revoked_reason = 'expired' WHERE tenant_id = $1 AND id = $2`,
          [claims.tid, session.id],
        ),
      );
      throw new ProblemException("INVALID_CREDENTIALS", { detail: "session expired" });
    }

    const amr = claims.amr ?? ["pwd"];
    const created = await withTenant({ tenantId: claims.tid }, (tx) =>
      this.createSessionAndTokens(tx, {
        tenant: { id: claims.tid } as DirectoryTenant,
        userId: session.user_id,
        amr,
        meta,
        replacesSessionId: session.id,
      }),
    );
    return created;
  }

  async logout(tenantId: string, sessionId: string): Promise<void> {
    await withTenant({ tenantId }, async (tx) => {
      await tx.query(
        `UPDATE sessions SET revoked_at = now(), revoked_reason = 'logout'
         WHERE tenant_id = $1 AND id = $2 AND revoked_at IS NULL`,
        [tenantId, sessionId],
      );
    });
  }

  // ---- session info ----------------------------------------------------

  async sessionInfo(tenantId: string, userId: string, sessionId: string, amr: string[]): Promise<SessionInfo> {
    return withTenant({ tenantId, userId }, async (tx) => {
      const userRows = await tx.query<{ id: string; email: string; name: string; branch_id: string | null; branch_tz: string | null }>(
        `SELECT u.id, u.email, u.name, b.branch_id, br.timezone as branch_tz
         FROM users u
         LEFT JOIN user_branches b ON b.tenant_id = u.tenant_id AND b.user_id = u.id AND b.is_default
         LEFT JOIN branches br ON br.tenant_id = b.tenant_id AND br.id = b.branch_id
         WHERE u.tenant_id = $1 AND u.id = $2`,
        [tenantId, userId],
      );
      const user = userRows.rows[0];
      if (!user) throw new ProblemException("INVALID_CREDENTIALS");
      
      const tenantRow = await tx.query<{ slug: string, timezone: string }>(
        `SELECT slug, timezone FROM tenants WHERE id = $1`,
        [tenantId]
      );
      const tenant = tenantRow.rows[0];

      const assignedBranches = await tx.query<{ id: string; name: string }>(
        `SELECT b.id, b.name
         FROM user_branches ub
         JOIN branches b ON b.tenant_id = ub.tenant_id AND b.id = ub.branch_id
         WHERE ub.tenant_id = $1 AND ub.user_id = $2 AND b.deleted_at IS NULL`,
        [tenantId, userId],
      );

      return {
        user: { id: user.id, email: user.email, name: user.name },
        tenant: { id: tenantId, slug: tenant?.slug ?? "" },
        sessionId,
        amr,
        branchId: user.branch_id,
        assignedBranches: assignedBranches.rows,
        effectiveTimezone: user.branch_tz || tenant?.timezone || 'UTC',
        expiresAt: new Date(Date.now() + getConfig().ACCESS_TTL_SECONDS * 1000).toISOString(),
        modules: [], // populated by the ModuleGuard/entitlement cache (Phase 1.6)
        modulesVersion: null,
      };
    });
  }

  async switchBranch(tenantId: string, userId: string, sessionId: string, amr: string[], branchId: string): Promise<{ accessToken: string }> {
    return withTenant({ tenantId, userId }, async (tx) => {
      const branchRow = await tx.query(
        `SELECT branch_id FROM user_branches WHERE tenant_id = $1 AND user_id = $2 AND branch_id = $3`,
        [tenantId, userId, branchId],
      );
      if (branchRow.rowCount === 0) {
        throw new ProblemException("NOT_FOUND", { detail: "not assigned to this branch" });
      }

      const accessToken = await this.tokens.issueAccessToken({
        sub: userId,
        tid: tenantId,
        sid: sessionId,
        brn: branchId,
        amr,
      });
      return { accessToken };
    });
  }

  // ---- password reset --------------------------------------------------

  async forgotPassword(dto: ForgotPasswordRequest, meta: RequestMeta): Promise<{ accepted: true; devResetToken?: string }> {
    const cfg = getConfig();
    const slug = dto.tenant ?? meta.headerTenant ?? slugFromHost(meta.hostname ?? "");
    if (!hitRateLimit(`forgot:${meta.ip ?? "unknown"}:${dto.email.toLowerCase()}`, 5, 900).allowed) {
      throw new ProblemException("RATE_LIMITED", { detail: "too many requests — retry later" });
    }

    if (!slug) return { accepted: true };
    const tenant = await this.resolver.resolveBySlug(slug);
    if (!tenant) return { accepted: true }; // generic; no enumeration

    return withTenant({ tenantId: tenant.id }, async (tx) => {
      const users = await tx.query<{ id: string }>(
        `SELECT id FROM users WHERE tenant_id = $1 AND lower(email) = $2 AND status <> 'DEACTIVATED'`,
        [tenant.id, dto.email.toLowerCase()],
      );
      const user = users.rows[0];
      if (!user) return { accepted: true as const };

      const secret = randomHex(32);
      const token = `${tenant.id}~${secret}`;
      await tx.query(
        `INSERT INTO password_resets (tenant_id, user_id, token_hash, expires_at)
         VALUES ($1, $2, $3, now() + make_interval(secs => $4))`,
        [tenant.id, user.id, sha256(token), cfg.RESET_TOKEN_TTL_SECONDS],
      );
      // Delivery is JOB-02 notification.send (Phase 9); until mail exists the
      // dev config may echo the token — production refuses (config guard).
      return {
        accepted: true as const,
        ...(cfg.DEV_EXPOSE_RESET_TOKEN ? { devResetToken: token } : {}),
      };
    });
  }

  async resetPassword(dto: ResetPasswordRequest): Promise<{ reset: true }> {
    const policy = this.passwords.validatePolicy(dto.password);
    if (!policy.ok) throw new ProblemException("VALIDATION_FAILED", { errors: policy.errors });

    const sep = dto.token.indexOf("~");
    const tenantId = sep > 0 ? dto.token.slice(0, sep) : "";
    if (!/^[0-9a-f-]{36}$/.test(tenantId)) {
      throw new ProblemException("INVALID_CREDENTIALS", { detail: "invalid or expired reset token" });
    }

    return withTenant({ tenantId }, async (tx) => {
      const rows = await tx.query<{ id: string; user_id: string }>(
        `UPDATE password_resets SET used_at = now()
         WHERE tenant_id = $1 AND token_hash = $2 AND used_at IS NULL AND expires_at > now()
         RETURNING id, user_id`,
        [tenantId, sha256(dto.token)],
      );
      const reset = rows.rows[0];
      if (!reset) {
        throw new ProblemException("INVALID_CREDENTIALS", { detail: "invalid or expired reset token" });
      }
      const passwordHash = await this.passwords.hashPassword(dto.password);
      await tx.query(
        `UPDATE users SET password_hash = $3, failed_login_count = 0, locked_until = NULL,
                updated_at = now(), row_version = row_version + 1
         WHERE tenant_id = $1 AND id = $2`,
        [tenantId, reset.user_id, passwordHash],
      );
      // Any session created with the old credential dies with it.
      await tx.query(
        `UPDATE sessions SET revoked_at = now(), revoked_reason = 'password_reset'
         WHERE tenant_id = $1 AND user_id = $2 AND revoked_at IS NULL`,
        [tenantId, reset.user_id],
      );
      return { reset: true as const };
    });
  }

  // ---- step-up ----------------------------------------------------------

  /** Re-auth for high-risk actions (arch §10). Same challenge as login. */
  async stepUp(
    ctx: { tenantId: string; userId: string; sessionId: string; amr: string[] },
    body: { password?: string; totp?: string },
  ): Promise<{ stepUpToken: string; expiresIn: number }> {
    if (!hitRateLimit(`stepup:${ctx.userId}`, 10, 300).allowed) {
      throw new ProblemException("RATE_LIMITED", { detail: "too many attempts — retry shortly" });
    }
    const satisfied: string[] = [];

    if (body.password) {
      const ok = await withTenant({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
        const rows = await tx.query<Pick<LoginUserRow, "password_hash" | "status">>(
          `SELECT password_hash, status FROM users WHERE tenant_id = $1 AND id = $2`,
          [ctx.tenantId, ctx.userId],
        );
        const user = rows.rows[0];
        if (!user) return false;
        return this.passwords.verifyPassword(body.password!, user.password_hash);
      });
      if (!ok) throw new ProblemException("INVALID_CREDENTIALS");
      satisfied.push("pwd");
    }
    if (body.totp) {
      const method = await this.mfa.verifyChallenge(ctx.tenantId, ctx.userId, body.totp);
      if (!method) throw new ProblemException("MFA_INVALID");
      satisfied.push(method);
    }
    if (satisfied.length === 0) {
      throw new ProblemException("VALIDATION_FAILED", {
        errors: [{ path: "password", message: "provide a password and/or TOTP code" }],
      });
    }

    const stepUpToken = await this.tokens.issueStepUpToken({
      sub: ctx.userId,
      tid: ctx.tenantId,
      sid: ctx.sessionId,
      amr: satisfied,
    });
    return { stepUpToken, expiresIn: getConfig().STEP_UP_TTL_SECONDS };
  }

  // ---- helpers ------------------------------------------------------------

  /** The caller's own email (RLS-scoped), used as the MFA otpauth label. */
  async ownEmail(tenantId: string, userId: string): Promise<string> {
    return withTenant({ tenantId, userId }, async (tx) => {
      const rows = await tx.query<{ email: string }>(
        `SELECT email FROM users WHERE tenant_id = $1 AND id = $2`,
        [tenantId, userId],
      );
      return rows.rows[0]?.email ?? "user";
    });
  }

  // ---- internals --------------------------------------------------------

  private async registerFailedAttempt(
    tx: PoolClient,
    tenantId: string,
    user: LoginUserRow,
    email: string,
    meta: RequestMeta,
  ): Promise<void> {
    const cfg = getConfig();
    const newCount = user.failed_login_count + 1;
    const backoff =
      newCount >= cfg.LOCKOUT_MAX_FAILED
        ? Math.min(
            cfg.LOCKOUT_BASE_SECONDS * 2 ** (newCount - cfg.LOCKOUT_MAX_FAILED),
            cfg.LOCKOUT_MAX_SECONDS,
          )
        : null;
    await tx.query(
      `UPDATE users
       SET failed_login_count = $3,
           locked_until = CASE WHEN $4::int IS NOT NULL
                               THEN now() + make_interval(secs => $4) END
       WHERE tenant_id = $1 AND id = $2`,
      [tenantId, user.id, newCount, backoff],
    );
    await this.recordAttempt(tx, tenantId, email, meta, false);
  }

  private async recordAttempt(
    tx: PoolClient,
    tenantId: string,
    email: string,
    meta: RequestMeta,
    succeeded: boolean,
  ): Promise<void> {
    await tx.query(
      `INSERT INTO login_attempts (tenant_id, email, ip_address, succeeded)
       VALUES ($1, $2, $3, $4)`,
      [tenantId, email.toLowerCase(), meta.ip ?? null, succeeded],
    );
  }

  /** Failure-path variant: own transaction so the row survives the throw. */
  private async recordAttemptStandalone(
    tenantId: string,
    email: string,
    meta: RequestMeta,
    succeeded: boolean,
  ): Promise<void> {
    await withTenant({ tenantId }, (tx) =>
      this.recordAttempt(tx, tenantId, email, meta, succeeded),
    );
  }

  /**
   * Session creation + token issuance inside the caller's transaction: the
   * refresh JWT embeds the new session id, and the row stores sha256(token)
   * — the rotation chain (sessions.replaced_by) starts here.
   */
  private async createSessionAndTokens(
    tx: PoolClient,
    opts: {
      tenant: DirectoryTenant;
      userId: string;
      amr: string[];
      meta: RequestMeta;
      replacesSessionId?: string;
    },
  ): Promise<AuthenticatedResult> {
    const cfg = getConfig();
    const inserted = await tx.query<{ id: string }>(
      `INSERT INTO sessions (tenant_id, user_id, refresh_hash, user_agent, ip_address, expires_at)
       VALUES ($1, $2, '', $3, $4, now() + make_interval(secs => $5))
       RETURNING id`,
      [opts.tenant.id, opts.userId, opts.meta.userAgent ?? null, opts.meta.ip ?? null, cfg.REFRESH_TTL_SECONDS],
    );
    const sessionId = inserted.rows[0]!.id;

    const branchRows = await tx.query<{ branch_id: string | null }>(
      `SELECT branch_id FROM user_branches WHERE tenant_id = $1 AND user_id = $2 AND is_default`,
      [opts.tenant.id, opts.userId],
    );
    const branchId = branchRows.rows[0]?.branch_id ?? null;

    const refreshToken = await this.tokens.issueRefreshToken({
      sub: opts.userId,
      tid: opts.tenant.id,
      sid: sessionId,
      amr: opts.amr,
    });
    await tx.query(`UPDATE sessions SET refresh_hash = $3 WHERE tenant_id = $1 AND id = $2`, [
      opts.tenant.id,
      sessionId,
      sha256(refreshToken),
    ]);

    if (opts.replacesSessionId) {
      await tx.query(
        `UPDATE sessions SET revoked_at = now(), revoked_reason = 'rotation', replaced_by = $3
         WHERE tenant_id = $1 AND id = $2`,
        [opts.tenant.id, opts.replacesSessionId, sessionId],
      );
    }

    const accessToken = await this.tokens.issueAccessToken({
      sub: opts.userId,
      tid: opts.tenant.id,
      sid: sessionId,
      brn: branchId,
      amr: opts.amr,
    });
    return { accessToken, refreshToken, sessionId, amr: opts.amr };
  }
}

function randomHex(bytes: number): string {
  return randomBytes(bytes).toString("hex");
}
