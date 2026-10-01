import { afterAll, describe, expect, it } from "vitest";
import { closeAllPools, createPool, withTenantOnPool } from "../src/index.js";
import { probeDb } from "./helpers.js";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const pool = createPool({ role: "app", max: 5 });
afterAll(async () => {
  await closeAllPools();
});

// Probe at collection time — `runIf` is evaluated when the suite is declared,
// which happens before beforeAll hooks ever run.
const dbUp = await probeDb();

describe.runIf(dbUp)("withTenant", () => {
  it("commits and returns the handler result", async () => {
    const result = await withTenantOnPool(pool, { tenantId: TENANT_A, requestId: crypto.randomUUID() }, async (tx) => {
      await tx.query("SELECT set_config('app.tenant_id', $1, true)", [TENANT_A]);
      await tx.query("INSERT INTO clinic_ping (tenant_id, note) VALUES ($1, 'ctx-commit')", [TENANT_A]);
      return "ok";
    });
    expect(result).toBe("ok");
  });

  it("rolls back when the handler throws", async () => {
    await expect(
      withTenantOnPool(pool, { tenantId: TENANT_A, requestId: crypto.randomUUID() }, async (tx) => {
        await tx.query("INSERT INTO clinic_ping (tenant_id, note) VALUES ($1, 'ctx-rollback')", [TENANT_A]);
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    const n = await withTenantOnPool(pool, { tenantId: TENANT_A, requestId: crypto.randomUUID() }, (tx) =>
      tx.query<{ count: string }>("SELECT count(*)::text AS count FROM clinic_ping WHERE note = 'ctx-rollback'"),
    );
    expect(n.rows[0]?.count).toBe("0");
  });

  it("context is transaction-local: nothing leaks to the next client", async () => {
    await withTenantOnPool(pool, { tenantId: TENANT_A, requestId: crypto.randomUUID() }, async (tx) => {
      const inside = await tx.query<{ t: string | null }>(
        "SELECT current_setting('app.tenant_id', true) AS t",
      );
      expect(inside.rows[0]?.t).toBe(TENANT_A);
    });

    const after = await pool.query<{ t: string | null }>(
      "SELECT current_setting('app.tenant_id', true) AS t",
    );
    expect(after.rows[0]?.t === null || after.rows[0]?.t === "").toBe(true);
  });
});
