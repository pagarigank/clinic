import { SignJWT, jwtVerify } from "jose";
import { getConfig } from "../../config.js";

/**
 * Token service (architecture §10). All tokens are HS256 JWTs signed with
 * JWT_SECRET; the refresh token is additionally persisted as sha-256 in
 * sessions.refresh_hash so presentation can be revoked/replayed-detected.
 *
 * Token kinds (claim `typ`):
 *  - access      10 min; carries sub, tid, sid, brn, amr
 *  - refresh     30 d;   carries sub, tid, sid — rotated on use, chain tracked
 *                in sessions.replaced_by; reuse of a revoked token kills the
 *                user's sessions in that tenant (reuse detection)
 *  - mfa-ticket  2 min;  password verified, TOTP pending — only /auth/mfa/verify accepts it
 *  - step-up     5 min;  recent re-auth proof for high-risk actions (arch §10)
 */

export type TokenKind = "access" | "refresh" | "mfa-ticket" | "step-up";

export interface AccessClaims {
  typ: "access";
  sub: string; // user id
  tid: string; // tenant id
  sid: string; // session id
  brn: string | null; // default branch at issuance
  amr: string[]; // authentication methods: pwd, totp, mfa-recovery, mfa-remembered, apikey
  mod?: { module: string; status: string }[]; // Phase 1.6 module entitlements
  mdv?: number; // Phase 1.6 modules_version cache key
}

export interface RefreshClaims {
  typ: "refresh";
  sub: string;
  tid: string;
  sid: string;
  /** Carried through rotation so the new access token keeps the methods. */
  amr: string[];
}

export interface MfaTicketClaims {
  typ: "mfa-ticket";
  sub: string;
  tid: string;
  amr: string[]; // methods already satisfied (pwd)
}

export interface StepUpClaims {
  typ: "step-up";
  sub: string;
  tid: string;
  sid: string;
  amr: string[]; // methods used for the re-auth
}

export type Claims = AccessClaims | RefreshClaims | MfaTicketClaims | StepUpClaims;

export class TokenService {
  // getConfig() is a cached singleton — no constructor DI (esbuild/tsx does
  // not emit design:paramtypes metadata, so implicit param injection is
  // undefined at runtime; the same trap documented in ping.controller).
  private key(): Uint8Array {
    return new TextEncoder().encode(getConfig().JWT_SECRET!);
  }

  async sign<T extends Claims>(claims: T, ttlSeconds: number): Promise<string> {
    return new SignJWT({ ...claims })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setIssuedAt()
      .setExpirationTime(Math.floor(Date.now() / 1000) + ttlSeconds)
      .sign(this.key());
  }

  async verify<T extends Claims>(token: string, kind: T["typ"]): Promise<T | null> {
    try {
      const { payload } = await jwtVerify(token, this.key(), { algorithms: ["HS256"] });
      if (payload.typ !== kind) return null;
      return payload as unknown as T;
    } catch {
      return null; // expired, malformed, wrong signature → generic rejection
    }
  }

  accessTtl(): number {
    return getConfig().ACCESS_TTL_SECONDS;
  }

  async issueAccessToken(claims: Omit<AccessClaims, "typ">): Promise<string> {
    return this.sign<AccessClaims>({ ...claims, typ: "access" }, getConfig().ACCESS_TTL_SECONDS);
  }

  async issueRefreshToken(claims: Omit<RefreshClaims, "typ">): Promise<string> {
    return this.sign<RefreshClaims>({ ...claims, typ: "refresh" }, getConfig().REFRESH_TTL_SECONDS);
  }

  async issueMfaTicket(claims: Omit<MfaTicketClaims, "typ">): Promise<string> {
    return this.sign<MfaTicketClaims>(
      { ...claims, typ: "mfa-ticket" },
      getConfig().MFA_TICKET_TTL_SECONDS,
    );
  }

  async issueStepUpToken(claims: Omit<StepUpClaims, "typ">): Promise<string> {
    return this.sign<StepUpClaims>({ ...claims, typ: "step-up" }, getConfig().STEP_UP_TTL_SECONDS);
  }
}
