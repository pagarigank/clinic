import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

/**
 * AES-256-GCM envelope for small secrets at rest (TOTP secrets — schema
 * comment on mfa_secrets/platform_users.totp_secret). Key is derived from
 * JWT_SECRET via HKDF-SHA256 with an info label, so no second key has to be
 * configured; rotating JWT_SECRET invalidates stored secrets (documented
 * operational note — re-enrollment required after a key rotation).
 *
 * Format: v1:<iv-b64>:<tag-b64>:<ct-b64>
 */

const KEY_INFO = "clinic:mfa-secretbox:v1";

function deriveKey(secret: string): Buffer {
  return Buffer.from(hkdfSync("sha256", secret, Buffer.alloc(0), KEY_INFO, 32));
}

export function encryptSecret(plaintext: string, jwtSecret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", deriveKey(jwtSecret), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64")}:${tag.toString("base64")}:${ct.toString("base64")}`;
}

export function decryptSecret(envelope: string, jwtSecret: string): string {
  const [version, ivB64, tagB64, ctB64] = envelope.split(":");
  if (version !== "v1" || !ivB64 || !tagB64 || !ctB64) {
    throw new Error("malformed secret envelope");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    deriveKey(jwtSecret),
    Buffer.from(ivB64, "base64"),
  );
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(ctB64, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

/** Constant-time string comparison (token/hash checks). */
export function timingSafeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafe(ab, bb);
}

function timingSafe(ab: Buffer, bb: Buffer): boolean {
  let diff = 0;
  for (let i = 0; i < ab.length; i++) {
    diff |= ab[i]! ^ bb[i]!;
  }
  return diff === 0;
}
