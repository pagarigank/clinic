import { afterAll, describe, expect, it } from "vitest";
import { closeAllPools, createPool, withTenantOnPool } from "../src/index.js";
import { probeDb } from "./helpers.js";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";

const pool = createPool({ role: "app", max: 5 });
afterAll(async () => {
  await closeAllPools();
});

// Probe at collection time — `runIf` is evaluated when the suite is declared,
// which happens before beforeAll hooks ever run.
const dbUp = await probeDb();

describe.runIf(dbUp)("tenant isolation (AC-1, AC-2)", () => {
  it("tenant A sees only its own rows", async () => {
    await withTenantOnPool(pool, { tenantId: TENANT_A, requestId: crypto.randomUUID() }, (tx) =>
      tx.query(
        "INSERT INTO clinic_ping (tenant_id, note) VALUES ($1, 'iso-test-a')",
        [TENANT_A],
      ),
    );

    const seen = await withTenantOnPool(pool, { tenantId: TENANT_B, requestId: crypto.randomUUID() }, (tx) =>
      tx.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM clinic_ping WHERE note = 'iso-test-a'",
      ),
    );
    expect(seen.rows[0]?.count).toBe("0");
  });

  it("reading a foreign tenant row by id returns zero rows (404 semantics)", async () => {
    const inserted = await withTenantOnPool(pool, { tenantId: TENANT_A, requestId: crypto.randomUUID() }, (tx) =>
      tx.query<{ id: string }>(
        "INSERT INTO clinic_ping (tenant_id, note) VALUES ($1, 'iso-lookup') RETURNING id",
        [TENANT_A],
      ),
    );
    const id = inserted.rows[0]?.id;
    expect(id).toBeTruthy();

    const foreign = await withTenantOnPool(pool, { tenantId: TENANT_B, requestId: crypto.randomUUID() }, (tx) =>
      tx.query("SELECT * FROM clinic_ping WHERE id = $1", [id]),
    );
    expect(foreign.rowCount).toBe(0);
  });

  it("no tenant context fails closed: reads return zero rows, inserts are blocked", async () => {
    const read = await withTenantOnPool(pool, { requestId: crypto.randomUUID() }, (tx) =>
      tx.query("SELECT count(*)::text AS n FROM clinic_ping"),
    );
    expect(read.rows[0]?.n).toBe("0");

    await expect(
      withTenantOnPool(pool, { requestId: crypto.randomUUID() }, (tx) =>
        tx.query("INSERT INTO clinic_ping (tenant_id, note) VALUES ($1, 'nope')", [TENANT_A]),
      ),
    ).rejects.toThrow();
  });
});
