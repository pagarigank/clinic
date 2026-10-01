import { afterAll, describe, expect, it } from "vitest";
import { closeAllPools, createPool, withTenantOnPool } from "../src/index.js";
import { probeDb } from "./helpers.js";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";
const USER_A = "a3000000-0000-4000-8000-000000000001";
const BRANCH_A = "a1000000-0000-4000-8000-000000000001";
const BRANCH_B = "b1000000-0000-4000-8000-000000000001";

const pool = createPool({ role: "app", max: 5 });
afterAll(async () => {
  await closeAllPools();
});

// Probe at collection time — `runIf` is evaluated when the suite is declared,
// which happens before beforeAll hooks ever run.
const dbUp = await probeDb();

describe.runIf(dbUp)("tenancy tables (Phase 1.1)", () => {
  it("user rows are invisible to the other tenant (AC-1) but visible in platform scope", async () => {
    const email = `iso-${crypto.randomUUID()}@tenant-a.test`;
    await withTenantOnPool(pool, { tenantId: TENANT_A, requestId: crypto.randomUUID() }, (tx) =>
      tx.query(
        "INSERT INTO users (tenant_id, email, name, password_hash) VALUES ($1, $2, 'iso', 'x')",
        [TENANT_A, email],
      ),
    );

    const asB = await withTenantOnPool(pool, { tenantId: TENANT_B, requestId: crypto.randomUUID() }, (tx) =>
      tx.query<{ count: string }>("SELECT count(*)::text AS count FROM users WHERE email = $1", [email]),
    );
    expect(asB.rows[0]?.count).toBe("0");

    const asPlatform = await withTenantOnPool(pool, { scope: "platform", requestId: crypto.randomUUID() }, (tx) =>
      tx.query<{ count: string }>("SELECT count(*)::text AS count FROM users WHERE email = $1", [email]),
    );
    expect(asPlatform.rows[0]?.count).toBe("1");
  });

  it("WITH CHECK blocks inserting a row stamped with another tenant's id (AC-2)", async () => {
    await expect(
      withTenantOnPool(pool, { tenantId: TENANT_A, requestId: crypto.randomUUID() }, (tx) =>
        tx.query(
          "INSERT INTO branches (tenant_id, code, name) VALUES ($1, 'X', 'cross-tenant')",
          [TENANT_B],
        ),
      ),
    ).rejects.toThrow();
  });

  it("composite FKs make cross-tenant references structurally impossible", async () => {
    // branch B exists, but (TENANT_A, BRANCH_B) does not — the pair FK fails.
    await expect(
      withTenantOnPool(pool, { tenantId: TENANT_A, requestId: crypto.randomUUID() }, (tx) =>
        tx.query(
          "INSERT INTO user_branches (tenant_id, user_id, branch_id) VALUES ($1, $2, $3)",
          [TENANT_A, USER_A, BRANCH_B],
        ),
      ),
    ).rejects.toThrow();
  });

  it("no tenant context fails closed: zero rows on policy-B tables too", async () => {
    const read = await withTenantOnPool(pool, { requestId: crypto.randomUUID() }, (tx) =>
      tx.query<{ count: string }>("SELECT count(*)::text AS count FROM users"),
    );
    expect(read.rows[0]?.count).toBe("0");
  });

  it("branch assignment inside the same tenant succeeds (no conflict with the seed row)", async () => {
    await withTenantOnPool(pool, { tenantId: TENANT_A, requestId: crypto.randomUUID() }, (tx) =>
      tx.query(
        "INSERT INTO user_branches (tenant_id, user_id, branch_id, is_default) VALUES ($1, $2, $3, false) ON CONFLICT DO NOTHING",
        [TENANT_A, USER_A, BRANCH_A],
      ),
    );
    const n = await withTenantOnPool(pool, { tenantId: TENANT_A, requestId: crypto.randomUUID() }, (tx) =>
      tx.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM user_branches WHERE tenant_id = $1 AND user_id = $2",
        [TENANT_A, USER_A],
      ),
    );
    expect(Number(n.rows[0]?.count)).toBeGreaterThan(0);
  });

  it("tenant_directory mirrors tenants via the sync trigger (§5.6)", async () => {
    const id = crypto.randomUUID();
    const slug = `sync-${crypto.randomUUID().slice(0, 8)}`;
    await withTenantOnPool(pool, { scope: "platform", requestId: crypto.randomUUID() }, (tx) => {
      return tx.query("INSERT INTO tenants (id, name, slug, status) VALUES ($1, 'Sync Test', $2, 'PROVISIONING')", [
        id,
        slug,
      ]);
    });

    const dir = await withTenantOnPool(pool, { scope: "platform", requestId: crypto.randomUUID() }, (tx) =>
      tx.query<{ status: string }>("SELECT status FROM tenant_directory WHERE id = $1", [id]),
    );
    expect(dir.rows[0]?.status).toBe("PROVISIONING");

    // Status change flows through (suspend path).
    await withTenantOnPool(pool, { scope: "platform", requestId: crypto.randomUUID() }, (tx) =>
      tx.query("UPDATE tenants SET status = 'SUSPENDED' WHERE id = $1", [id]),
    );
    const after = await withTenantOnPool(pool, { scope: "platform", requestId: crypto.randomUUID() }, (tx) =>
      tx.query<{ status: string }>("SELECT status FROM tenant_directory WHERE id = $1", [id]),
    );
    expect(after.rows[0]?.status).toBe("SUSPENDED");

    // Cleanup (directory row is left as the OFFBOARDED-style record; no
    // delete trigger exists by design, so remove it explicitly here).
    await withTenantOnPool(pool, { scope: "platform", requestId: crypto.randomUUID() }, async (tx) => {
      await tx.query("DELETE FROM tenant_directory WHERE id = $1", [id]);
      await tx.query("DELETE FROM tenants WHERE id = $1", [id]);
    });
  });
});
