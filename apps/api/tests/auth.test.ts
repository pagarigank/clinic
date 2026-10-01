import { describe, expect, it } from "vitest";
import { base32Decode, base32Encode } from "../src/auth/crypto/base32.js";
import { totpNow, verifyTotp } from "../src/auth/crypto/totp.js";
import { decryptSecret, encryptSecret, timingSafeEqual } from "../src/auth/crypto/secretbox.js";
import { PasswordService } from "../src/auth/crypto/password.js";
import { TokenService } from "../src/auth/crypto/tokens.js";
import { getConfig, parseConfig } from "../src/config.js";
import { hitRateLimit, resetRateLimits } from "../src/auth/rate-limit.js";
import { slugFromHost } from "../src/auth/tenant-resolver.service.js";

const config = getConfig();
const tokens = new TokenService();

describe("base32 (RFC 4648)", () => {
  it("round-trips bytes", () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 251, 252]);
    expect(Array.from(base32Decode(base32Encode(bytes)))).toEqual(Array.from(bytes));
  });  it("matches the RFC 4648 test vectors (unpadded)", () => {
    // RFC 4648 §10 vectors, padding stripped — this codec emits no padding.
    const strip = (s: string) => s.replaceAll("=", "");
    expect(base32Encode(new TextEncoder().encode("foo"))).toBe(strip("MZXW6==="));
    expect(base32Encode(new TextEncoder().encode("foob"))).toBe(strip("MZXW6YQ="));
    expect(base32Encode(new TextEncoder().encode("fooba"))).toBe(strip("MZXW6YTB"));
    expect(base32Encode(new TextEncoder().encode("foobar"))).toBe(strip("MZXW6YTBOI"));
  });
});

describe("TOTP (RFC 6238)", () => {
  const secret = base32Encode(new Uint8Array(20).fill(7));

  it("verifies the current code", () => {
    const at = 1_800_000_000;
    const code = totpNow(secret, at);
    expect(verifyTotp(secret, code, { atSeconds: at }).ok).toBe(true);
  });
  it("accepts ±1 step drift", () => {
    const at = 1_800_000_000;
    const prev = totpNow(secret, at - 30);
    const next = totpNow(secret, at + 30);
    expect(verifyTotp(secret, prev, { atSeconds: at }).ok).toBe(true);
    expect(verifyTotp(secret, next, { atSeconds: at }).ok).toBe(true);
  });
  it("refuses codes outside the window", () => {
    const at = 1_800_000_000;
    const far = totpNow(secret, at + 5 * 30);
    expect(verifyTotp(secret, far, { atSeconds: at }).ok).toBe(false);
  });
  it("enforces the replay guard (steps at or below lastUsedStep are dead)", () => {
    const at = 1_800_000_000;
    const result = verifyTotp(secret, totpNow(secret, at), { atSeconds: at });
    expect(result.ok).toBe(true);
    const replay = verifyTotp(secret, totpNow(secret, at), {
      atSeconds: at + 30,
      lastUsedStep: result.step,
    });
    expect(replay.ok).toBe(false);
    // next fresh step still works
    expect(verifyTotp(secret, totpNow(secret, at + 60), { atSeconds: at + 60, lastUsedStep: result.step }).ok).toBe(true);
  });
});

describe("secretbox (AES-256-GCM)", () => {
  it("seals and opens", () => {
    const sealed = encryptSecret("JBSWY3DPEHPK3PXP", config.JWT_SECRET!);
    expect(sealed.startsWith("v1:")).toBe(true);
    expect(decryptSecret(sealed, config.JWT_SECRET!)).toBe("JBSWY3DPEHPK3PXP");
  });
  it("fails with the wrong key or tampered ciphertext", () => {
    const sealed = encryptSecret("secret", config.JWT_SECRET!);
    expect(() => decryptSecret(sealed, "another-secret-key-0123456789abcdef")).toThrow();
    const tampered = sealed.slice(0, -2) + (sealed.endsWith("AA") ? "BB" : "AA");
    expect(() => decryptSecret(tampered, config.JWT_SECRET!)).toThrow();
  });
  it("timingSafeEqual", () => {
    expect(timingSafeEqual("abc", "abc")).toBe(true);
    expect(timingSafeEqual("abc", "abd")).toBe(false);
    expect(timingSafeEqual("abc", "abcd")).toBe(false);
  });
});

describe("password policy (arch §10: min length 12)", () => {
  const svc = new PasswordService();
  it("rejects short and weak passwords", () => {
    expect(svc.validatePolicy("short").ok).toBe(false);
    expect(svc.validatePolicy("alllowercase123").ok).toBe(false);
    expect(svc.validatePolicy("NOLOWERCASE123").ok).toBe(false);
  });
  it("accepts a compliant password and hashes/verifies with Argon2id", async () => {
    expect(svc.validatePolicy("DemoPassw0rd!2026").ok).toBe(true);
    const h = await svc.hashPassword("DemoPassw0rd!2026");
    expect(h.startsWith("$argon2id$")).toBe(true);
    expect(await svc.verifyPassword("DemoPassw0rd!2026", h)).toBe(true);
    expect(await svc.verifyPassword("wrong", h)).toBe(false);
  });
  it("treats a malformed hash as a failed credential, not a crash", async () => {
    expect(await svc.verifyPassword("x", "not-a-hash")).toBe(false);
  });
});

describe("token service", () => {
  it("issues and verifies an access token", async () => {
    const jwt = await tokens.issueAccessToken({
      sub: "11111111-1111-4111-8111-111111111111",
      tid: "11111111-1111-4111-8111-111111111111",
      sid: "33333333-3333-4333-8333-333333333333",
      brn: null,
      amr: ["pwd"],
    });
    const claims = await tokens.verify(jwt, "access");
    expect(claims?.typ).toBe("access");
    expect(claims?.amr).toEqual(["pwd"]);
  });
  it("rejects a token presented as the wrong kind", async () => {
    const jwt = await tokens.issueRefreshToken({
      sub: "u", tid: "t", sid: "s", amr: ["pwd"],
    });
    expect(await tokens.verify(jwt, "access")).toBeNull();
    expect(await tokens.verify(jwt, "refresh")).not.toBeNull();
  });
  it("rejects garbage", async () => {
    expect(await tokens.verify("garbage.token.here", "access")).toBeNull();
  });
});

describe("config guard", () => {
  it("requires JWT_SECRET in production", () => {
    expect(() =>
      parseConfig({ NODE_ENV: "production", DEV_EXPOSE_RESET_TOKEN: "false", JWT_SECRET: "x".repeat(32) }),
    ).not.toThrow();
    expect(() => parseConfig({ NODE_ENV: "production", DEV_EXPOSE_RESET_TOKEN: "false" })).toThrow(/JWT_SECRET/);
    expect(() =>
      parseConfig({ NODE_ENV: "production", JWT_SECRET: "x".repeat(32) }),
    ).toThrow(/DEV_EXPOSE_RESET_TOKEN/);
  });
});

describe("rate limiter", () => {
  it("blocks after the limit and reports retry-after", () => {
    resetRateLimits();
    for (let i = 0; i < 3; i++) {
      expect(hitRateLimit("k", 3, 60).allowed).toBe(true);
    }
    const blocked = hitRateLimit("k", 3, 60);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
    expect(hitRateLimit("other", 3, 60).allowed).toBe(true);
  });
});

describe("slugFromHost (tenant resolution, arch §5.6)", () => {
  it("extracts the tenant subdomain", () => {
    expect(slugFromHost("demo-a.clinic.example.com")).toBe("demo-a");
    expect(slugFromHost("demo-b.localhost")).toBe("demo-b");
  });
  it("returns null for reserved/non-subdomain hosts", () => {
    expect(slugFromHost("localhost")).toBeNull();
    expect(slugFromHost("app.clinic.example.com")).toBeNull();
    expect(slugFromHost("api.example.com")).toBeNull();
  });
});
