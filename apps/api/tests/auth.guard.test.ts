import { beforeEach, describe, expect, it, vi } from "vitest";

// Declared before the guard under test is imported so the API-key lookup is
// intercepted. `vi.mock` is hoisted above the imports by vitest.
vi.mock("@clinic/db", () => ({ withTenant: vi.fn() }));

import type { ExecutionContext } from "@nestjs/common";
import { HttpException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { createHash } from "node:crypto";
import { withTenant } from "@clinic/db";
import { AuthGuard } from "../src/auth/guards/auth.guard.js";
import { type AccessClaims, TokenService } from "../src/auth/crypto/tokens.js";
import type { RequestWithAuth } from "../src/auth/auth-context.js";

/**
 * AuthGuard is the first guard in the chain (architecture §11.3): everything
 * downstream — tenant context, permissions, audit — trusts that
 * `request.authContext` was set here and set honestly. So these tests assert
 * the *invariants*, not just the branches:
 *
 *  - a token is only accepted for the `access` typ (a refresh / mfa-ticket /
 *    step-up token must not authenticate a business request),
 *  - the API-key secret is hashed and the tenant id is taken from the key, so
 *    the lookup is RLS-scoped and the raw secret never reaches the database.
 */

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const API_KEY_SECRET = "s3cr3t-value-never-persist-me";
const API_KEY = `cka_${TENANT_A}_${API_KEY_SECRET}`;

const withTenantMock = vi.mocked(withTenant);
const query = vi.fn();

function ctxFor(req: Record<string, unknown>): ExecutionContext {
  return {
    getHandler: () => function handler() {},
    getClass: () => class Controller {},
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

function reflectorReturning(isPublic: boolean): Reflector {
  return { getAllAndOverride: () => isPublic } as unknown as Reflector;
}

function tokensReturning(claims: Partial<AccessClaims> | null) {
  return { verify: vi.fn().mockResolvedValue(claims) } as unknown as TokenService;
}

function reqWith(header?: string) {
  return { headers: header === undefined ? {} : { authorization: header } };
}

async function expectProblem(promise: Promise<unknown>, code: string, status: number) {
  const err = (await promise.then(
    () => null,
    (e) => e,
  )) as HttpException | null;
  expect(err, `expected ${code} to be thrown`).toBeInstanceOf(HttpException);
  const body = err?.getResponse() as { code?: string };
  expect(body?.code).toBe(code);
  expect(err?.getStatus()).toBe(status);
}

/** Run the guard over an `ApiKey` header, with the key lookup returning `row`. */
function apiKeyGuard(row: Record<string, unknown> | null) {
  query.mockResolvedValue({ rows: row ? [row] : [] });
  withTenantMock.mockImplementation((async (_ctx: unknown, fn: (tx: unknown) => unknown) =>
    fn({ query })) as unknown as typeof withTenant);
  return new AuthGuard(tokensReturning(null), reflectorReturning(false));
}

beforeEach(() => {
  query.mockReset();
  withTenantMock.mockReset();
});

describe("AuthGuard — @Public exemption (todo 1.2)", () => {
  it("admits a @Public route with no credentials and never touches the token service", async () => {
    const tokens = tokensReturning(null);
    const guard = new AuthGuard(tokens, reflectorReturning(true));

    await expect(guard.canActivate(ctxFor(reqWith()))).resolves.toBe(true);
    expect(tokens.verify).not.toHaveBeenCalled();
  });
});

describe("AuthGuard — missing / malformed credentials", () => {
  it("rejects a request with no Authorization header", async () => {
    const guard = new AuthGuard(tokensReturning(null), reflectorReturning(false));
    await expectProblem(guard.canActivate(ctxFor(reqWith())), "INVALID_CREDENTIALS", 401);
  });

  it("rejects an unsupported scheme rather than guessing", async () => {
    const guard = new AuthGuard(tokensReturning(null), reflectorReturning(false));
    await expectProblem(
      guard.canActivate(ctxFor(reqWith("Basic dXNlcjpwYXNz"))),
      "INVALID_CREDENTIALS",
      401,
    );
  });
});

describe("AuthGuard — bearer access token", () => {
  const claims: AccessClaims = {
    sub: "user-1",
    tid: TENANT_A,
    sid: "session-1",
    brn: "branch-1",
    amr: ["pwd", "otp"],
  } as unknown as AccessClaims;

  it("accepts a valid token and projects the claims onto request.authContext", async () => {
    const guard = new AuthGuard(tokensReturning(claims), reflectorReturning(false));
    const req: Record<string, unknown> = reqWith("Bearer good.jwt.token");

    await expect(guard.canActivate(ctxFor(req))).resolves.toBe(true);
    const auth = (req as unknown as RequestWithAuth).authContext;
    expect(auth).toEqual({
      kind: "user",
      userId: "user-1",
      tenantId: TENANT_A,
      sessionId: "session-1",
      branchId: "branch-1",
      amr: ["pwd", "otp"],
      scopes: [],
    });
  });

  it("demands the `access` typ, so a refresh/mfa-ticket/step-up token cannot open a business route", async () => {
    const tokens = tokensReturning(claims);
    const guard = new AuthGuard(tokens, reflectorReturning(false));

    await guard.canActivate(ctxFor(reqWith("Bearer a.refresh.token")));

    expect(tokens.verify).toHaveBeenCalledWith("a.refresh.token", "access");
  });

  it("rejects an expired or tampered token (verify -> null)", async () => {
    const guard = new AuthGuard(tokensReturning(null), reflectorReturning(false));
    const req = reqWith("Bearer expired.jwt.token");

    await expectProblem(guard.canActivate(ctxFor(req)), "INVALID_CREDENTIALS", 401);
    expect((req as unknown as RequestWithAuth).authContext).toBeUndefined();
  });

  it("tolerates a token with no branch claim (branchId undefined, not null)", async () => {
    const guard = new AuthGuard(
      tokensReturning({ sub: "u", tid: TENANT_A, sid: "s" } as unknown as AccessClaims),
      reflectorReturning(false),
    );
    const req: Record<string, unknown> = reqWith("Bearer no.branch");

    await expect(guard.canActivate(ctxFor(req))).resolves.toBe(true);
    expect((req as unknown as RequestWithAuth).authContext?.branchId).toBeUndefined();
  });
});

describe("AuthGuard — service-account API key (todo 1.2)", () => {
  const row = {
    id: "key-1",
    scopes: ["patients:read", "encounters:write"],
    expires_at: new Date("2099-01-01"),
    revoked_at: null,
  };

  it("authenticates a well-formed key and carries its scopes", async () => {
    const guard = apiKeyGuard(row);
    const req: Record<string, unknown> = reqWith(`ApiKey ${API_KEY}`);

    await expect(guard.canActivate(ctxFor(req))).resolves.toBe(true);
    expect((req as unknown as RequestWithAuth).authContext).toEqual({
      kind: "apikey",
      userId: null,
      tenantId: TENANT_A,
      sessionId: "key-1",
      branchId: null,
      amr: ["apikey"],
      scopes: ["patients:read", "encounters:write"],
    });
  });

  it("defaults scopes to an empty list when the column is null", async () => {
    const guard = apiKeyGuard({ ...row, scopes: null });
    const req: Record<string, unknown> = reqWith(`ApiKey ${API_KEY}`);

    await expect(guard.canActivate(ctxFor(req))).resolves.toBe(true);
    expect((req as unknown as RequestWithAuth).authContext?.scopes).toEqual([]);
  });

  it("hashes the secret and scopes the lookup to the tenant in the key", async () => {
    const guard = apiKeyGuard(row);
    await guard.canActivate(ctxFor(reqWith(`ApiKey ${API_KEY}`)));

    expect(withTenantMock).toHaveBeenCalledWith(
      { tenantId: TENANT_A },
      expect.any(Function),
    );
    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    // The raw secret must never be a query parameter.
    expect(params).toEqual([TENANT_A, createHash("sha256").update(API_KEY).digest("hex")]);
    expect(JSON.stringify(params)).not.toContain(API_KEY_SECRET);
    // Revoked and expired keys must be excluded by the statement itself.
    expect(sql).toMatch(/revoked_at IS NULL/);
    expect(sql).toMatch(/expires_at IS NULL OR expires_at > now\(\)/);
    // last_used_at is the audit trail for key usage.
    expect(sql).toMatch(/last_used_at = now\(\)/);
  });

  it("rejects a key whose tenant id is not a uuid, before touching the database", async () => {
    const guard = apiKeyGuard(row);
    await expectProblem(
      guard.canActivate(ctxFor(reqWith("ApiKey cka_not-a-uuid_secret"))),
      "INVALID_CREDENTIALS",
      401,
    );
    expect(query).not.toHaveBeenCalled();
  });

  it("rejects a malformed key shape (wrong prefix or part count)", async () => {
    for (const bad of ["ApiKey ckb_11111111-1111-4111-8111-111111111111_x", "ApiKey cka_two-parts"]) {
      const guard = apiKeyGuard(row);
      await expectProblem(
        guard.canActivate(ctxFor(reqWith(bad))),
        "INVALID_CREDENTIALS",
        401,
      );
    }
    expect(query).not.toHaveBeenCalled();
  });

  it("rejects an unknown, revoked or expired key (no row returned)", async () => {
    const guard = apiKeyGuard(null);
    const req = reqWith(`ApiKey ${API_KEY}`);

    await expectProblem(guard.canActivate(ctxFor(req)), "INVALID_CREDENTIALS", 401);
    expect((req as unknown as RequestWithAuth).authContext).toBeUndefined();
  });
});
