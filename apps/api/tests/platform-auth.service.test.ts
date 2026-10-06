/**
 * PlatformAuthService (platform console auth). Integration suite: skipped when
 * no database is reachable. Exercises the rotation/reuse contract that mirrors
 * tenant session handling, against real `platform_sessions` rows.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPool, withTenantOnPool } from '@clinic/db';
import { probeDb } from '@clinic/db/tests/helpers.js';
import { PlatformAuthService } from '../src/platform/platform-auth.service.js';
import { PasswordService } from '../src/auth/crypto/password.js';
import { TokenService, type PlatformClaims } from '../src/auth/crypto/tokens.js';
import { resetRateLimits } from '../src/auth/rate-limit.js';
import { ProblemException } from '../src/http/problem.exception.js';

const hasDb = await probeDb();

describe.skipIf(!hasDb)('PlatformAuthService (platform auth)', () => {
  const passwords = new PasswordService();
  const tokens = new TokenService();
  const service = new PlatformAuthService(tokens, passwords);
  const owner = createPool({ role: 'owner' });

  const email = `platform-test-${Date.now()}@clinic.local`;
  const PASSWORD = 'DemoPassw0rd!2026';
  let userId = '';

  beforeAll(async () => {
    resetRateLimits();
    const hash = await passwords.hashPassword(PASSWORD);
    const { rows } = await owner.query<{ id: string }>(
      `INSERT INTO platform_users (email, name, password_hash)
       VALUES ($1, 'Platform Auth Test', $2) RETURNING id`,
      [email, hash],
    );
    userId = rows[0]!.id;
  });

  afterAll(async () => {
    if (userId) {
      await withTenantOnPool(owner, { scope: 'platform', userId }, async (tx) => {
        await tx.query(`DELETE FROM platform_sessions WHERE platform_user_id = $1`, [userId]);
      });
      await owner.query(`DELETE FROM platform_users WHERE id = $1`, [userId]);
    }
    await owner.end();
  });

  it('logs in password-only and issues a platform-typed access token', async () => {
    const result = await service.login({ email, password: PASSWORD }, { ip: '127.0.0.1' });
    expect(result.amr).toEqual(['pwd']);
    const claims = await tokens.verify<PlatformClaims>(result.accessToken, 'platform');
    expect(claims?.sub).toBe(userId);
    expect(claims?.sid).toBe(result.sessionId);
  });

  it('refuses a wrong password without revealing the account', async () => {
    await expect(
      service.login({ email, password: 'wrong-password-123' }, {}),
    ).rejects.toThrow(ProblemException);
  });

  it('rotates on refresh and revokes the whole family on cookie reuse', async () => {
    const first = await service.login({ email, password: PASSWORD }, {});
    const rotated = await service.refresh(first.refreshToken, {});
    expect(rotated.sessionId).not.toBe(first.sessionId);

    // Re-presenting the rotated cookie is reuse → every live session dies.
    await expect(service.refresh(first.refreshToken, {})).rejects.toThrow(ProblemException);
    await expect(service.refresh(rotated.refreshToken, {})).rejects.toThrow(ProblemException);
  });

  it('logout revokes the session so its refresh token is dead', async () => {
    const session = await service.login({ email, password: PASSWORD }, {});
    await service.logout(userId, session.sessionId);
    await expect(service.refresh(session.refreshToken, {})).rejects.toThrow(ProblemException);
  });

  it('profiles the signed-in platform user', async () => {
    const session = await service.login({ email, password: PASSWORD }, {});
    const info = await service.sessionInfo(userId, session.sessionId);
    expect(info.user.email).toBe(email);
    expect(info.sessionId).toBe(session.sessionId);
  });
});
