import { createHmac } from "node:crypto";
import { base32Decode } from "./base32.js";

/**
 * RFC 6238 TOTP (SHA-1, 30 s step, 6 digits — the authenticator-app default).
 * Implemented on node:crypto so no extra dependency and the behaviour is
 * provable against the RFC test vectors (tests/totp.test.ts).
 */

export interface TotpVerifyResult {
  ok: boolean;
  /** The consumed step (for the replay guard) when ok. */
  step?: number;
}

function hotp(secret: Uint8Array, counter: number, digits: number): string {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", Buffer.from(secret)).update(buf).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const bin =
    ((digest[offset]! & 0x7f) << 24) |
    (digest[offset + 1]! << 16) |
    (digest[offset + 2]! << 8) |
    digest[offset + 3]!;
  return (bin % 10 ** digits).toString().padStart(digits, "0");
}

export const TOTP_STEP_SECONDS = 30;

/** Current TOTP for a base32 secret (used by tests and the CLI helper). */
export function totpNow(base32Secret: string, atSeconds = Math.floor(Date.now() / 1000)): string {
  return hotp(base32Decode(base32Secret), Math.floor(atSeconds / TOTP_STEP_SECONDS), 6);
}

/**
 * Verify a TOTP within ±window steps of `atSeconds`. `lastUsedStep` is the
 * replay guard persisted per user (mfa_secrets.last_used_step): a step at or
 * below it was already consumed and is refused even inside the window.
 */
export function verifyTotp(
  base32Secret: string,
  code: string,
  opts: {
    atSeconds?: number;
    window?: number;
    digits?: number;
    lastUsedStep?: number | null;
  } = {},
): TotpVerifyResult {
  const { atSeconds = Math.floor(Date.now() / 1000), window = 1, digits = 6 } = opts;
  if (!/^\d{6,8}$/.test(code)) return { ok: false };
  const expected = Math.floor(atSeconds / TOTP_STEP_SECONDS);
  const secret = base32Decode(base32Secret);
  const lastUsed = opts.lastUsedStep ?? null;
  for (let step = expected + window; step >= expected - window; step--) {
    if (lastUsed !== null && step <= lastUsed) break; // older steps already consumed
    if (hotp(secret, step, digits) === code) {
      return { ok: true, step };
    }
  }
  return { ok: false };
}
