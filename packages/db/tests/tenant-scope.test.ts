import { describe, expect, it } from "vitest";
import {
  noteTenantTransaction,
  runInTenantScope,
  tenantTransactionsInScope,
} from "../src/index.js";

/**
 * Pure unit tests for the request-scope counter behind todo 1.1 — no database,
 * because the whole point is that it is in-process bookkeeping. The RLS
 * behaviour it complements is covered in tenancy.test.ts / isolation.test.ts.
 */

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";

describe("runInTenantScope / tenantTransactionsInScope", () => {
  it("starts a fresh scope at zero", () => {
    runInTenantScope(TENANT_A, () => {
      expect(tenantTransactionsInScope()).toBe(0);
    });
  });

  it("counts a transaction opened inside the scope", () => {
    runInTenantScope(TENANT_A, () => {
      noteTenantTransaction(TENANT_A);
      expect(tenantTransactionsInScope()).toBe(1);
      noteTenantTransaction(TENANT_A);
      expect(tenantTransactionsInScope()).toBe(2);
    });
  });

  it("reports zero outside any scope, so jobs and scripts are not policed", () => {
    expect(tenantTransactionsInScope()).toBe(0);
    expect(() => noteTenantTransaction(TENANT_A)).not.toThrow();
    expect(tenantTransactionsInScope()).toBe(0);
  });

  it("isolates concurrent requests, so one tenant cannot mark another's request", async () => {
    const results = await Promise.all(
      [TENANT_A, TENANT_B, TENANT_A].map((tenant) =>
        runInTenantScope(tenant, async () => {
          await new Promise((r) => setTimeout(r, 1));
          noteTenantTransaction(tenant);
          return tenantTransactionsInScope();
        }),
      ),
    );
    expect(results).toEqual([1, 1, 1]);
  });

  it("rejects a transaction opened for a different tenant than the request", () => {
    runInTenantScope(TENANT_A, () => {
      expect(() => noteTenantTransaction(TENANT_B)).toThrow(/cross-tenant/);
    });
  });

  it("tolerates a transaction with no tenant id (platform / unscoped work)", () => {
    runInTenantScope(TENANT_A, () => {
      expect(() => noteTenantTransaction(undefined)).not.toThrow();
      expect(tenantTransactionsInScope()).toBe(1);
    });
  });

  it("tolerates a request scope with no tenant (nothing to compare against)", () => {
    runInTenantScope(undefined, () => {
      expect(() => noteTenantTransaction(TENANT_A)).not.toThrow();
      expect(tenantTransactionsInScope()).toBe(1);
    });
  });
});
