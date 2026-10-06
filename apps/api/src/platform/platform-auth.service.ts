import { Inject, Injectable } from '@nestjs/common';
import { getAppPool, withTenantOnPool, type PoolClient } from '@clinic/db';
import { getConfig } from '../config.js';
import { ProblemException } from '../http/problem.exception.js';
import { hitRateLimit } from '../auth/rate-limit.js';
import { sha256 } from '../auth/mfa.service.js';
import { PasswordService } from '../auth/crypto/password.js';
import { TokenService, type PlatformRefreshClaims } from '../auth/crypto/tokens.js';
import { decryptSecret } from '../auth/crypto/secretbox.js';
import { verifyTotp } from '../auth/crypto/totp.js';

/** Refresh cookie for the platform console — distinct from tenant `clinic_rt`. */
export const PLATFORM_REFRESH_COOKIE = 'clinic_prt';

/**
 * Burned when the account does not exist so a timing observer cannot tell an
 * unknown email from a wrong password (same anti-enumeration trick as the
 * tenant login).
 */
const DECOY_HASH = '$argon2id$v=19$m=19456,t=2,p=1$decoy$decoy';

export interface PlatformMeta {
  ip?: string | undefined;
  userAgent?: string | undefined;
}

export interface PlatformAuthResult {
  accessToken: string;
  refreshToken: string;
  sessionId: string;
  amr: string[];
}

interface PlatformUserRow {
  id: string;
  email: string;
  name: string;
  password_hash: string;
  is_active: boolean;
  totp_secret: string | null;
}

interface PlatformSessionRow {
  id: string;
  platform_user_id: string;
  refresh_hash: string;
  expires_at: Date;
  revoked_at: Date | null;
}

/**
 * Platform console authentication (Phase 9, architecture §10). Platform staff
 * are global (`platform_users`, no tenant) and issue tokens that carry no
 * `tid`, so the whole tenant RLS/module/permission stack treats them as
 * platform scope. Sessions rotate in `platform_sessions` with the same
 * reuse-detection contract as tenant sessions.
 *
 * TOTP is mandatory once a secret is enrolled; a freshly-provisioned
 * superadmin with no `totp_secret` may bootstrap with password only.
 */
@Injectable()
export class PlatformAuthService {
  constructor(
    @Inject(TokenService) private readonly tokens: TokenService,
    @Inject(PasswordService) private readonly passwords: PasswordService,
  ) {}

  async login(
    dto: { email: string; password: string; totp?: string },
    meta: PlatformMeta,
  ): Promise<PlatformAuthResult> {
    const email = dto.email.toLowerCase();
    if (
      !hitRateLimit(`platform-login:ip:${meta.ip ?? 'unknown'}`, 20, 300).allowed ||
      !hitRateLimit(`platform-login:acct:${email}`, 10, 300).allowed
    ) {
      throw new ProblemException('RATE_LIMITED', { detail: 'too many attempts — retry shortly' });
    }

    const user = await this.findByEmail(email);
    if (!user || !user.is_active) {
      await this.passwords.verifyPassword(dto.password, DECOY_HASH);
      throw new ProblemException('INVALID_CREDENTIALS');
    }
    if (!(await this.passwords.verifyPassword(dto.password, user.password_hash))) {
      throw new ProblemException('INVALID_CREDENTIALS');
    }

    const amr = ['pwd'];
    if (user.totp_secret) {
      if (!dto.totp) {
        throw new ProblemException('MFA_INVALID', { detail: 'TOTP code required' });
      }
      const secret = decryptSecret(user.totp_secret, getConfig().JWT_SECRET!);
      if (!verifyTotp(secret, dto.totp).ok) {
        throw new ProblemException('MFA_INVALID');
      }
      amr.push('totp');
    }

    return this.createSessionAndTokens(user.id, amr, meta);
  }

  /**
   * Rotation contract mirrors tenant refresh (architecture §10): presenting a
   * revoked token is reuse → every live session for that platform user dies.
   */
  async refresh(refreshToken: string, meta: PlatformMeta): Promise<PlatformAuthResult> {
    const claims = await this.tokens.verify<PlatformRefreshClaims>(refreshToken, 'platform-refresh');
    if (!claims) throw new ProblemException('INVALID_CREDENTIALS', { detail: 'invalid session' });

    const session = await withTenantOnPool(
      getAppPool(),
      { scope: 'platform', userId: claims.sub },
      async (tx) => {
        const { rows } = await tx.query<PlatformSessionRow>(
          `SELECT id, platform_user_id, refresh_hash, expires_at, revoked_at
           FROM platform_sessions WHERE id = $1 FOR UPDATE`,
          [claims.sid],
        );
        return rows[0] ?? null;
      },
    );
    if (!session || session.refresh_hash !== sha256(refreshToken)) {
      throw new ProblemException('INVALID_CREDENTIALS', { detail: 'invalid session' });
    }

    if (session.revoked_at) {
      await this.revokeAll(session.platform_user_id, 'reuse_detected');
      throw new ProblemException('INVALID_CREDENTIALS', {
        detail: 'session reuse detected — all sessions revoked',
      });
    }
    if (session.expires_at.getTime() < Date.now()) {
      await this.revokeSession(session.id, 'expired');
      throw new ProblemException('INVALID_CREDENTIALS', { detail: 'session expired' });
    }

    return this.createSessionAndTokens(
      session.platform_user_id,
      claims.amr ?? ['pwd'],
      meta,
      session.id,
    );
  }

  async logout(platformUserId: string, sessionId: string): Promise<void> {
    await withTenantOnPool(
      getAppPool(),
      { scope: 'platform', userId: platformUserId },
      async (tx) => {
        await tx.query(
          `UPDATE platform_sessions SET revoked_at = now(), revoked_reason = 'logout'
           WHERE id = $1 AND platform_user_id = $2 AND revoked_at IS NULL`,
          [sessionId, platformUserId],
        );
      },
    );
  }

  async sessionInfo(platformUserId: string, sessionId: string) {
    return withTenantOnPool(
      getAppPool(),
      { scope: 'platform', userId: platformUserId },
      async (tx) => {
        const { rows } = await tx.query<{ id: string; email: string; name: string }>(
          `SELECT id, email, name FROM platform_users WHERE id = $1`,
          [platformUserId],
        );
        const user = rows[0];
        if (!user) throw new ProblemException('INVALID_CREDENTIALS');
        return {
          user,
          sessionId,
          amr: [] as string[],
          expiresAt: new Date(
            Date.now() + getConfig().ACCESS_TTL_SECONDS * 1000,
          ).toISOString(),
        };
      },
    );
  }

  /**
   * Re-auth for high-risk console actions (break-glass entry). A platform
   * step-up token is bound to the platform session, exactly like the tenant
   * step-up token is bound to the tenant session.
   */
  async stepUp(
    ctx: { platformUserId: string; sessionId: string },
    body: { password?: string; totp?: string },
  ): Promise<{ stepUpToken: string; expiresIn: number }> {
    if (!hitRateLimit(`platform-stepup:${ctx.platformUserId}`, 10, 300).allowed) {
      throw new ProblemException('RATE_LIMITED', { detail: 'too many attempts — retry shortly' });
    }
    const satisfied: string[] = [];

    if (body.password) {
      const user = await withTenantOnPool(
        getAppPool(),
        { scope: 'platform', userId: ctx.platformUserId },
        async (tx) => {
          const { rows } = await tx.query<{ password_hash: string }>(
            `SELECT password_hash FROM platform_users WHERE id = $1`,
            [ctx.platformUserId],
          );
          return rows[0] ?? null;
        },
      );
      if (!user || !(await this.passwords.verifyPassword(body.password, user.password_hash))) {
        throw new ProblemException('INVALID_CREDENTIALS');
      }
      satisfied.push('pwd');
    }

    if (body.totp) {
      const user = await withTenantOnPool(
        getAppPool(),
        { scope: 'platform', userId: ctx.platformUserId },
        async (tx) => {
          const { rows } = await tx.query<{ totp_secret: string | null }>(
            `SELECT totp_secret FROM platform_users WHERE id = $1`,
            [ctx.platformUserId],
          );
          return rows[0] ?? null;
        },
      );
      if (!user?.totp_secret) throw new ProblemException('MFA_INVALID');
      const secret = decryptSecret(user.totp_secret, getConfig().JWT_SECRET!);
      if (!verifyTotp(secret, body.totp).ok) throw new ProblemException('MFA_INVALID');
      satisfied.push('totp');
    }

    if (satisfied.length === 0) {
      throw new ProblemException('VALIDATION_FAILED', {
        errors: [{ path: 'password', message: 'provide a password and/or TOTP code' }],
      });
    }

    const stepUpToken = await this.tokens.issueStepUpToken({
      sub: ctx.platformUserId,
      tid: '',
      sid: ctx.sessionId,
      amr: satisfied,
    });
    return { stepUpToken, expiresIn: getConfig().STEP_UP_TTL_SECONDS };
  }

  // ---- internals --------------------------------------------------------

  private async findByEmail(email: string): Promise<PlatformUserRow | null> {
    return withTenantOnPool(getAppPool(), { scope: 'platform' }, async (tx) => {
      const { rows } = await tx.query<PlatformUserRow>(
        `SELECT id, email, name, password_hash, is_active, totp_secret
         FROM platform_users WHERE lower(email) = $1`,
        [email],
      );
      return rows[0] ?? null;
    });
  }

  private async revokeSession(sessionId: string, reason: string): Promise<void> {
    await withTenantOnPool(getAppPool(), { scope: 'platform' }, async (tx) => {
      await tx.query(
        `UPDATE platform_sessions SET revoked_at = now(), revoked_reason = $2
         WHERE id = $1 AND revoked_at IS NULL`,
        [sessionId, reason],
      );
    });
  }

  private async revokeAll(platformUserId: string, reason: string): Promise<void> {
    await withTenantOnPool(
      getAppPool(),
      { scope: 'platform', userId: platformUserId },
      async (tx) => {
        await tx.query(
          `UPDATE platform_sessions SET revoked_at = now(), revoked_reason = $2
           WHERE platform_user_id = $1 AND revoked_at IS NULL`,
          [platformUserId, reason],
        );
      },
    );
  }

  private async createSessionAndTokens(
    platformUserId: string,
    amr: string[],
    meta: PlatformMeta,
    replacesSessionId?: string,
  ): Promise<PlatformAuthResult> {
    const cfg = getConfig();
    return withTenantOnPool(
      getAppPool(),
      { scope: 'platform', userId: platformUserId },
      async (tx: PoolClient) => {
        const inserted = await tx.query<{ id: string }>(
          `INSERT INTO platform_sessions (platform_user_id, refresh_hash, user_agent, ip_address, expires_at)
           VALUES ($1, '', $2, $3, now() + make_interval(secs => $4))
           RETURNING id`,
          [platformUserId, meta.userAgent ?? null, meta.ip ?? null, cfg.REFRESH_TTL_SECONDS],
        );
        const sessionId = inserted.rows[0]!.id;

        const refreshToken = await this.tokens.issuePlatformRefreshToken({
          sub: platformUserId,
          sid: sessionId,
          amr,
        });
        await tx.query(`UPDATE platform_sessions SET refresh_hash = $2 WHERE id = $1`, [
          sessionId,
          sha256(refreshToken),
        ]);

        if (replacesSessionId) {
          await tx.query(
            `UPDATE platform_sessions
             SET revoked_at = now(), revoked_reason = 'rotation', replaced_by = $2
             WHERE id = $1`,
            [replacesSessionId, sessionId],
          );
        }

        const accessToken = await this.tokens.issuePlatformToken({
          sub: platformUserId,
          sid: sessionId,
          amr,
        });
        return { accessToken, refreshToken, sessionId, amr };
      },
    );
  }
}
