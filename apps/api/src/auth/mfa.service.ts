import { Injectable } from "@nestjs/common";
import { randomBytes, createHash } from "node:crypto";
import { withTenant } from "@clinic/db";
import { ProblemException } from "../http/problem.exception.js";
import { getConfig } from "../config.js";
import { base32Encode } from "./crypto/base32.js";
import { decryptSecret, encryptSecret } from "./crypto/secretbox.js";
import { verifyTotp } from "./crypto/totp.js";

/**
 * TOTP MFA (todo 1.2, architecture §10): enroll → confirm → verify, with
 * single-use recovery codes and remember-device cookies. Secrets are stored
 * AES-256-GCM sealed (mfa_secrets.secret "encrypted at rest").
 *
 * TOTP is mandatory for platform users and enforced by role policy for
 * tenant admins/pharmacists/lab verifiers — the *policy* wiring lands with
 * RBAC in 1.3 (`mfa_required_for` check at login/step-up time); the
 * mechanics live here.
 */
export const RECOVERY_CODE_COUNT = 10;

@Injectable()
export class MfaService {

  /** Begin enrollment: generate a secret, store it sealed + unconfirmed. */
  async startEnroll(tenantId: string, userId: string, email: string) {
    const secret = base32Encode(randomBytes(20));
    const sealed = encryptSecret(secret, getConfig().JWT_SECRET!);
    await withTenant({ tenantId, userId }, async (tx) => {
      await tx.query(
        `INSERT INTO mfa_secrets (tenant_id, user_id, secret, confirmed_at)
         VALUES ($1, $2, $3, NULL)
         ON CONFLICT (tenant_id, user_id)
         DO UPDATE SET secret = EXCLUDED.secret, confirmed_at = NULL, last_used_step = NULL`,
        [tenantId, userId, sealed],
      );
    });
    const label = encodeURIComponent(email);
    return {
      otpauthUrl: `otpauth://totp/Clinic:${label}?secret=${secret}&issuer=Clinic&algorithm=SHA1&digits=6&period=30`,
      secret,
    };
  }

  /** Confirm enrollment with a valid code; issues the recovery codes. */
  async confirm(tenantId: string, userId: string, code: string): Promise<string[]> {
    const result = await withTenant({ tenantId, userId }, async (tx) => {
      const row = await tx.query<{ secret: string }>(
        `SELECT secret FROM mfa_secrets WHERE tenant_id = $1 AND user_id = $2 AND confirmed_at IS NULL`,
        [tenantId, userId],
      );
      const secretRow = row.rows[0];
      if (!secretRow) {
        throw new ProblemException("MFA_INVALID", { detail: "no pending enrollment" });
      }
      const secret = decryptSecret(secretRow.secret, getConfig().JWT_SECRET!);
      const check = verifyTotp(secret, code);
      if (!check.ok) throw new ProblemException("MFA_INVALID");

      await tx.query(
        `UPDATE mfa_secrets SET confirmed_at = now(), last_used_step = $3
         WHERE tenant_id = $1 AND user_id = $2`,
        [tenantId, userId, check.step!],
      );
      await tx.query(
        `UPDATE users SET mfa_enabled = true, updated_at = now(), row_version = row_version + 1
         WHERE tenant_id = $1 AND id = $2`,
        [tenantId, userId],
      );
      // fresh recovery codes
      await tx.query(
        `DELETE FROM mfa_recovery_codes WHERE tenant_id = $1 AND user_id = $2 AND used_at IS NULL`,
        [tenantId, userId],
      );
      const codes = Array.from({ length: RECOVERY_CODE_COUNT }, () =>
        randomBytes(5).toString("hex"),
      );
      for (const c of codes) {
        await tx.query(
          `INSERT INTO mfa_recovery_codes (tenant_id, user_id, code_hash) VALUES ($1, $2, $3)`,
          [tenantId, userId, sha256(c)],
        );
      }
      return codes;
    });
    return result;
  }

  /** Regenerate recovery codes (requires step-up at the guard layer). */
  async regenerateRecoveryCodes(tenantId: string, userId: string): Promise<string[]> {
    return withTenant({ tenantId, userId }, async (tx) => {
      await tx.query(
        `DELETE FROM mfa_recovery_codes WHERE tenant_id = $1 AND user_id = $2`,
        [tenantId, userId],
      );
      const codes = Array.from({ length: RECOVERY_CODE_COUNT }, () =>
        randomBytes(5).toString("hex"),
      );
      for (const c of codes) {
        await tx.query(
          `INSERT INTO mfa_recovery_codes (tenant_id, user_id, code_hash) VALUES ($1, $2, $3)`,
          [tenantId, userId, sha256(c)],
        );
      }
      return codes;
    });
  }

  /** Disable MFA entirely (requires step-up at the guard layer). */
  async disable(tenantId: string, userId: string): Promise<void> {
    await withTenant({ tenantId, userId }, async (tx) => {
      await tx.query(`DELETE FROM mfa_secrets WHERE tenant_id = $1 AND user_id = $2`, [tenantId, userId]);
      await tx.query(`DELETE FROM mfa_recovery_codes WHERE tenant_id = $1 AND user_id = $2`, [tenantId, userId]);
      await tx.query(`DELETE FROM mfa_trusted_devices WHERE tenant_id = $1 AND user_id = $2`, [tenantId, userId]);
      await tx.query(
        `UPDATE users SET mfa_enabled = false, updated_at = now(), row_version = row_version + 1
         WHERE tenant_id = $1 AND id = $2`,
        [tenantId, userId],
      );
    });
  }

  /**
   * Verify an MFA challenge during login/step-up: 6-digit numeric → TOTP
   * (with replay guard), anything else → single-use recovery code.
   * Returns the consumed method ("totp" | "mfa-recovery") or null on failure.
   */
  async verifyChallenge(
    tenantId: string,
    userId: string,
    code: string,
  ): Promise<"totp" | "mfa-recovery" | null> {
    return withTenant({ tenantId, userId }, async (tx) => {
      if (/^\d{6}$/.test(code)) {
        const row = await tx.query<{ secret: string; last_used_step: string | null; confirmed_at: Date | null }>(
          `SELECT s.secret, s.last_used_step, s.confirmed_at
           FROM mfa_secrets s WHERE s.tenant_id = $1 AND s.user_id = $2`,
          [tenantId, userId],
        );
        const secretRow = row.rows[0];
        if (!secretRow?.confirmed_at) return null;
        const secret = decryptSecret(secretRow.secret, getConfig().JWT_SECRET!);
        const check = verifyTotp(secret, code, {
          lastUsedStep: secretRow.last_used_step ? Number(secretRow.last_used_step) : null,
        });
        if (!check.ok) return null;
        await tx.query(
          `UPDATE mfa_secrets SET last_used_step = $3 WHERE tenant_id = $1 AND user_id = $2`,
          [tenantId, userId, check.step!],
        );
        return "totp" as const;
      }
      // recovery code (single use)
      const used = await tx.query<{ id: string }>(
        `UPDATE mfa_recovery_codes SET used_at = now()
         WHERE tenant_id = $1 AND user_id = $2 AND code_hash = $3 AND used_at IS NULL
         RETURNING id`,
        [tenantId, userId, sha256(code)],
      );
      return used.rows.length > 0 ? ("mfa-recovery" as const) : null;
    });
  }

  /** Remember-device cookie: issue token + persisted hash. */
  async issueTrustedDevice(tenantId: string, userId: string, label?: string): Promise<string> {
    const token = randomBytes(32).toString("hex");
    const ttl = getConfig().TRUSTED_DEVICE_TTL_SECONDS;
    await withTenant({ tenantId, userId }, async (tx) => {
      await tx.query(
        `INSERT INTO mfa_trusted_devices (tenant_id, user_id, token_hash, label, expires_at)
         VALUES ($1, $2, $3, $4, now() + make_interval(secs => $5))`,
        [tenantId, userId, sha256(token), label ?? null, ttl],
      );
    });
    return token;
  }

  async hasTrustedDevice(tenantId: string, userId: string, token: string | undefined): Promise<boolean> {
    if (!token) return false;
    return withTenant({ tenantId, userId }, async (tx) => {
      const row = await tx.query<{ id: string }>(
        `UPDATE mfa_trusted_devices SET last_used_at = now()
         WHERE tenant_id = $1 AND user_id = $2 AND token_hash = $3 AND expires_at > now()
         RETURNING id`,
        [tenantId, userId, sha256(token)],
      );
      return row.rows.length > 0;
    });
  }
}

export function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}
