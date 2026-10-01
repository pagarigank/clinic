import { Injectable } from '@nestjs/common';
import { ProblemException } from '../http/problem.exception.js';
import { getAppPool } from '@clinic/db';
import { TokenService } from '../auth/crypto/tokens.js';
import { MfaService } from '../auth/mfa.service.js';

/** Maximum break-glass session duration in seconds (8 h). */
const BREAKGLASS_MAX_TTL = 8 * 3600;
const BREAKGLASS_REASON_MIN_LEN = 15;

export interface BreakglassSession {
  id: string;
  tenantId: string;
  platformUserId: string;
  reason: string;
  expiresAt: Date;
  endedAt: Date | null;
  createdAt: Date;
}

@Injectable()
export class BreakglassService {
  constructor(
    private readonly tokens: TokenService,
    private readonly mfa: MfaService,
  ) {}

  /**
   * Start a break-glass session.
   * - Requires step-up token (MFA re-auth already done by the caller)
   * - Writes breakglass_sessions row
   * - Issues a token with typ:"breakglass", bgl:<session-id>, tid:<target-tenant>
   * - Queues a tenant-notification outbox event
   */
  async enter(opts: {
    platformUserId: string;
    targetTenantId: string;
    reason: string;
    stepUpToken: string | undefined;
    ttlSeconds?: number;
  }): Promise<{ accessToken: string; sessionId: string; expiresAt: Date }> {
    if (opts.reason.length < BREAKGLASS_REASON_MIN_LEN) {
      throw new ProblemException('VALIDATION_FAILED', {
        errors: [{ path: 'reason', message: `reason must be at least ${BREAKGLASS_REASON_MIN_LEN} characters` }],
      });
    }

    const ttl = Math.min(opts.ttlSeconds ?? BREAKGLASS_MAX_TTL, BREAKGLASS_MAX_TTL);
    const pool = getAppPool();

    // Verify tenant exists and is not offboarded
    const tenantRows = await pool.query(
      `SELECT id, status FROM tenants WHERE id = $1`,
      [opts.targetTenantId],
    );
    if (tenantRows.rowCount === 0) {
      throw new ProblemException('NOT_FOUND', { detail: 'tenant not found' });
    }
    const tenant = tenantRows.rows[0];
    if (tenant.status === 'OFFBOARDED') {
      throw new ProblemException('CONFLICT', { detail: 'cannot enter an offboarded tenant' });
    }

    const expiresAt = new Date(Date.now() + ttl * 1000);

    // Insert breakglass session (no RLS — platform scope, use pool directly via set_config)
    const inserted = await pool.query<{ id: string }>(
      `INSERT INTO breakglass_sessions (tenant_id, platform_user_id, reason, expires_at)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [opts.targetTenantId, opts.platformUserId, opts.reason, expiresAt],
    );
    const sessionId = inserted.rows[0]!.id;

    // Queue tenant notification (outbox pattern — will be picked up by JOB-01)
    await pool.query(
      `INSERT INTO outbox (tenant_id, event_type, payload)
       VALUES ($1, 'breakglass.entered', $2)`,
      [
        opts.targetTenantId,
        JSON.stringify({
          sessionId,
          platformUserId: opts.platformUserId,
          reason: opts.reason,
          expiresAt: expiresAt.toISOString(),
        }),
      ],
    );

    const accessToken = await this.tokens.issueBreakglassToken(
      {
        sub: opts.platformUserId,
        tid: opts.targetTenantId,
        bgl: sessionId,
        amr: ['pwd', 'totp'],
      },
      ttl,
    );

    return { accessToken, sessionId, expiresAt };
  }

  /**
   * End a break-glass session by setting ended_at.
   * The token remains valid until it expires — the ended_at is informational
   * (the 8h ceiling is the hard enforcement).
   */
  async end(opts: { sessionId: string; platformUserId: string }): Promise<void> {
    const pool = getAppPool();
    const result = await pool.query(
      `UPDATE breakglass_sessions
       SET ended_at = now(), row_version = row_version + 1
       WHERE id = $1 AND platform_user_id = $2 AND ended_at IS NULL`,
      [opts.sessionId, opts.platformUserId],
    );
    if ((result.rowCount ?? 0) === 0) {
      throw new ProblemException('NOT_FOUND', { detail: 'session not found or already ended' });
    }
  }

  /** List open (and recently ended) break-glass sessions for a tenant. */
  async listForTenant(tenantId: string): Promise<BreakglassSession[]> {
    const pool = getAppPool();
    const rows = await pool.query<BreakglassSession>(
      `SELECT id, tenant_id AS "tenantId", platform_user_id AS "platformUserId",
              reason, expires_at AS "expiresAt", ended_at AS "endedAt", created_at AS "createdAt"
       FROM breakglass_sessions
       WHERE tenant_id = $1
       ORDER BY created_at DESC
       LIMIT 50`,
      [tenantId],
    );
    return rows.rows;
  }

  /**
   * Validate a breakglass session id is still open (not expired, not ended).
   * Used by AuthGuard to populate the breakglassId on the auth context.
   */
  async validateSession(sessionId: string): Promise<{ tenantId: string; platformUserId: string } | null> {
    const pool = getAppPool();
    const rows = await pool.query<{ tenant_id: string; platform_user_id: string }>(
      `SELECT tenant_id, platform_user_id
       FROM breakglass_sessions
       WHERE id = $1 AND ended_at IS NULL AND expires_at > now()`,
      [sessionId],
    );
    if (rows.rowCount === 0) return null;
    return {
      tenantId: rows.rows[0]!.tenant_id,
      platformUserId: rows.rows[0]!.platform_user_id,
    };
  }

  /**
   * Auto-expire: called by JOB-11 session.cleanup to sweep break-glass sessions
   * that passed their hard 8h ceiling. Returns the count of sessions swept.
   */
  async sweepExpired(): Promise<number> {
    const pool = getAppPool();
    const result = await pool.query(
      `UPDATE breakglass_sessions
       SET ended_at = now(), row_version = row_version + 1
       WHERE ended_at IS NULL AND expires_at <= now()`,
    );
    return result.rowCount ?? 0;
  }
}
