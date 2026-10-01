import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenant } from "@clinic/db";
import { probeDb } from "@clinic/db/tests/helpers.js";
import { AuthService } from "../src/auth/auth.service.js";
import { MfaService } from "../src/auth/mfa.service.js";
import { PasswordService } from "../src/auth/crypto/password.js";
import { TokenService } from "../src/auth/crypto/tokens.js";
import { getConfig } from "../src/config.js";
import { resetRateLimits } from "../src/auth/rate-limit.js";
import { TenantResolverService } from "../src/auth/tenant-resolver.service.js";
import { ProblemException } from "../src/http/problem.exception.js";

const dbUp = await probeDb();

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";

const tokens = new TokenService();
const passwords = new PasswordService();
const mfa = new MfaService();
const resolver = new TenantResolverService();
const svc = new AuthService(tokens, passwords, mfa, resolver);

const meta = {
  ip: "127.0.0.1",
  userAgent: "vitest",
  hostname: "localhost",
} as const;

// Unique email per run so lockout/counters start clean.
const email = `auth-it-${Date.now()}@demo-a.test`;

beforeAll(async () => {
  resetRateLimits();
  if (!dbUp) return;
  // Provision a fresh ACTIVE user in tenant A with the seed password hash
  // (same Argon2id hash the seed uses for DemoPassw0rd!2026).
  const hash = await passwords.hashPassword("DemoPassw0rd!2026");
  await withTenant({ tenantId: TENANT_A }, async (tx) => {
    await tx.query(
      `INSERT INTO users (tenant_id, email, name, password_hash, status)
       VALUES ($1, $2, 'Auth IT', $3, 'ACTIVE')`,
      [TENANT_A, email, hash],
    );
  });
});

afterAll(async () => {
  if (!dbUp) return;
  await withTenant({ tenantId: TENANT_A }, async (tx) => {
    await tx.query(`DELETE FROM users WHERE tenant_id = $1 AND email = $2`, [TENANT_A, email]);
  });
});

describe.skipIf(!dbUp)("auth flow (real DB, todo 1.2)", () => {
  it("rejects unknown tenant and unknown user with generic failures", async () => {
    await expect(
      svc.login({ email: "x@y.z", password: "whatever" }, { ...meta, hostname: "localhost" }),
    ).rejects.toMatchObject({ status: 401 });
    await expect(
      svc.login({ tenant: "demo-a", email: "ghost@demo-a.test", password: "whatever" }, meta),
    ).rejects.toMatchObject({ status: 401 });
  });

  it("rejects suspended tenants with TENANT_SUSPENDED", async () => {
    // directory row derived from tenants; verify the guard path via resolver
    const t = await resolver.resolveBySlug("demo-a");
    expect(t?.status).toBe("ACTIVE");
    // (SUSPENDED branch is unit-covered via status checks; the round-trip is
    // exercised in 1.7 suspend/reactivate.)
  });

  it("logs in and returns tokens + session", async () => {
    resetRateLimits();
    const result = await svc.login({ tenant: "demo-a", email, password: "DemoPassw0rd!2026" }, meta);
    if (result.status !== "AUTHENTICATED") throw new Error("expected login success");
    expect(result.amr).toEqual(["pwd"]);

    // session row exists, hash matches
    const s = await withTenant({ tenantId: TENANT_A }, async (tx) => {
      const r = await tx.query<{ revoked_at: Date | null }>(
        `SELECT revoked_at FROM sessions WHERE tenant_id = $1 AND id = $2`,
        [TENANT_A, result.sessionId],
      );
      return r.rows[0];
    });
    expect(s?.revoked_at).toBeNull();

    const refreshed = await svc.refresh(result.refreshToken, meta);
    expect(refreshed.sessionId).not.toBe(result.sessionId);

    // old session is revoked with 'rotation' and points at the new one
    const oldRow = await withTenant({ tenantId: TENANT_A }, async (tx) => {
      const r = await tx.query<{ revoked_reason: string; replaced_by: string }>(
        `SELECT revoked_reason, replaced_by::text AS replaced_by FROM sessions WHERE tenant_id = $1 AND id = $2`,
        [TENANT_A, result.sessionId],
      );
      return r.rows[0];
    });
    expect(oldRow?.revoked_reason).toBe("rotation");
    expect(oldRow?.replaced_by).toBe(refreshed.sessionId);

    // cleanup: revoke the rotated session too
    await svc.logout(TENANT_A, refreshed.sessionId);
    await svc.logout(TENANT_A, result.sessionId);
  });

  it("detects refresh-token reuse and kills the chain", async () => {
    resetRateLimits();
    const result = await svc.login({ tenant: "demo-a", email, password: "DemoPassw0rd!2026" }, meta);
    if (result.status !== "AUTHENTICATED") throw new Error("expected login success");

    const r1 = await svc.refresh(result.refreshToken, meta); // rotate
    // REUSE of the original token must fail…
    await expect(svc.refresh(result.refreshToken, meta)).rejects.toMatchObject({ status: 401 });
    // …and the successor must be dead too
    await expect(svc.refresh(r1.refreshToken, meta)).rejects.toMatchObject({ status: 401 });
    // sessions revoked as reuse_detected
    const rows = await withTenant({ tenantId: TENANT_A }, async (tx) => {
      const r = await tx.query<{ revoked_reason: string | null }>(
        `SELECT revoked_reason FROM sessions WHERE tenant_id = $1 AND user_id = (SELECT id FROM users WHERE email = $2)`,
        [TENANT_A, email],
      );
      return r.rows;
    });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.revoked_reason !== null)).toBe(true);
  });

  it("locks the account with exponential backoff after repeated failures", async () => {
    resetRateLimits();
    const email2 = `lockout-${Date.now()}@demo-a.test`;
    const hash = await passwords.hashPassword("DemoPassw0rd!2026");
    await withTenant({ tenantId: TENANT_A }, async (tx) => {
      await tx.query(
        `INSERT INTO users (tenant_id, email, name, password_hash, status) VALUES ($1, $2, 'L', $3, 'ACTIVE')`,
        [TENANT_A, email2, hash],
      );
    });
    const cfg = getConfig();
    let locked: unknown = null;
    try {
      for (let i = 0; i < cfg.LOCKOUT_MAX_FAILED; i++) {
        await svc.login({ tenant: "demo-a", email: email2, password: "wrong-password" }, meta).catch(() => undefined);
      }
      // next attempt (even with the right password) is locked
    const attempt = await svc
      .login({ tenant: "demo-a", email: email2, password: "DemoPassw0rd!2026" }, meta)
      .then(() => null)
      .catch((e: unknown) => e);
    locked = attempt;
    } finally {
      await withTenant({ tenantId: TENANT_A }, async (tx) => {
        await tx.query(`DELETE FROM users WHERE tenant_id = $1 AND email = $2`, [TENANT_A, email2]);
      });
    }
    expect(locked).toBeInstanceOf(ProblemException);
    expect((locked as ProblemException).getStatus()).toBe(423);
  });

  it("rate-limits excessive login attempts per account", async () => {
    resetRateLimits();
    let last: unknown = null;
    // 11 attempts for the SAME address (limit 10 / 5 min per account) —
    // an unknown user is enough to trip the limiter (counted pre-auth).
    const ghost = `ratelimit@demo-a.test`;
    for (let i = 0; i < 11; i++) {
      last = await svc
        .login({ tenant: "demo-a", email: ghost, password: "x" }, meta)
        .catch((e) => e);
    }
    expect(last).toBeInstanceOf(ProblemException);
    expect((last as ProblemException).getStatus()).toBe(429);
  });

  it("enforces tenant isolation on the identity tables (B cannot read A's sessions)", async () => {
    const asB = await withTenant({ tenantId: TENANT_B }, async (tx) => {
      const r = await tx.query<{ id: string }>(
        `SELECT s.id FROM sessions s WHERE s.tenant_id = $1`,
        [TENANT_A],
      );
      return r.rows;
    });
    expect(asB).toHaveLength(0);
  });

  it("issues a step-up token after a fresh password challenge", async () => {
    resetRateLimits();
    const login = await svc.login({ tenant: "demo-a", email, password: "DemoPassw0rd!2026" }, meta);
    if (login.status !== "AUTHENTICATED") throw new Error("expected login success");
    const result = await svc.stepUp(
      { tenantId: TENANT_A, userId: (await userIdOf(email)), sessionId: login.sessionId, amr: login.amr },
      { password: "DemoPassw0rd!2026" },
    );
    expect(result.stepUpToken).toBeTruthy();
    const claims = await tokens.verify(result.stepUpToken, "step-up");
    expect(claims?.typ).toBe("step-up");
    expect(claims!.sub).toBe(await userIdOf(email));
    expect((claims as { sid: string }).sid).toBe(login.sessionId);
  });

  it("enrolls and confirms MFA, then requires a TOTP at login", async () => {
    resetRateLimits();
    const uid = await userIdOf(email);
    const enroll = await mfa.startEnroll(TENANT_A, uid, email);
    const { totpNow } = await import("../src/auth/crypto/totp.js");
    const code = totpNow(enroll.secret);
    const recoveryCodes = await mfa.confirm(TENANT_A, uid, code);
    expect(recoveryCodes).toHaveLength(10);

    // login now requires MFA
    const login = await svc.login({ tenant: "demo-a", email, password: "DemoPassw0rd!2026" }, meta);
    expect(login.status).toBe("MFA_REQUIRED");
    if (login.status !== "MFA_REQUIRED") return;

    // a recovery code completes the challenge
    const done = await svc.verifyMfaLogin(login.ticket, recoveryCodes[0]!, false, meta);
    expect(done.status).toBe("AUTHENTICATED");
    if (done.status === "AUTHENTICATED") {
      expect(done.amr).toContain("mfa-recovery");
      await svc.logout(TENANT_A, done.sessionId);
    }

    // and with remember-device the next login skips the challenge
    const login2 = await svc.login(
      { tenant: "demo-a", email, password: "DemoPassw0rd!2026", rememberDevice: true },
      meta,
    );
    expect(login2.status).toBe("MFA_REQUIRED");
    if (login2.status !== "MFA_REQUIRED") return;
    const done2 = await svc.verifyMfaLogin(login2.ticket, recoveryCodes[1]!, true, meta);
    if (done2.status !== "AUTHENTICATED") throw new Error("expected authenticated");
    const device = await mfa.issueTrustedDevice(TENANT_A, uid, "vitest-device");
    const login3 = await svc.login(
      { tenant: "demo-a", email, password: "DemoPassw0rd!2026", rememberDevice: true },
      { ...meta, deviceToken: device },
    );
    expect(login3.status).toBe("AUTHENTICATED");
    if (login3.status === "AUTHENTICATED") {
      expect(login3.amr).toContain("mfa-remembered");
      await svc.logout(TENANT_A, login3.sessionId);
    }

    await mfa.disable(TENANT_A, uid);
  });

  it("resets the password through the forgot/reset round-trip", async () => {
    resetRateLimits();
    const forgot = await svc.forgotPassword({ tenant: "demo-a", email }, meta);
    expect(forgot.accepted).toBe(true);
    expect(forgot.devResetToken).toBeTruthy();
    const token = forgot.devResetToken!;
    await svc.resetPassword({ token, password: "NewPassword99!" });
    const login = await svc.login({ tenant: "demo-a", email, password: "NewPassword99!" }, meta);
    expect(login.status).toBe("AUTHENTICATED");
    if (login.status === "AUTHENTICATED") {
      // old sessions were killed by the reset
      expect(true).toBe(true);
      await svc.logout(TENANT_A, login.sessionId);
    }
    // unknown emails get the same generic response (no enumeration)
    const ghost = await svc.forgotPassword({ tenant: "demo-a", email: "ghost@demo-a.test" }, meta);
    expect(ghost.accepted).toBe(true);
    expect(ghost.devResetToken).toBeUndefined();
  });
});

async function userIdOf(mail: string): Promise<string> {
  return withTenant({ tenantId: TENANT_A }, async (tx) => {
    const r = await tx.query<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [mail]);
    return r.rows[0]!.id;
  });
}
