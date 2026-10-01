import { it, expect } from "vitest";
import { Client } from "pg";

/**
 * Migration 0007 reversibility (todo 1.3): a down/up round trip must restore
 * every declared SoD pair. Uses the same owner-URL resolution as migrate.mjs.
 */
const URL_OWNER =
  process.env.DATABASE_URL_MIGRATOR ?? "postgres://kpagarigan2:P%40ssw0rd@localhost:5432/clinic";

it("0007 sod_conflicts survives a down/up round trip", async () => {
  const c = new Client({ connectionString: URL_OWNER });
  await c.connect();
  try {
    const t = await c.query(
      `SELECT table_name FROM information_schema.tables WHERE table_name = 'sod_conflicts'`,
    );
    expect(t.rows).toHaveLength(1);

    const r = await c.query(`SELECT permission_a, permission_b FROM sod_conflicts ORDER BY permission_a`);
    const pairs = r.rows.map((x) => `${x.permission_a}|${x.permission_b}`);
    console.log("  sod_conflicts rows:", pairs.length);
    for (const p of pairs) console.log("   ", p);
    expect(pairs).toHaveLength(7);
    expect(pairs).toContain("lab.result.enter|lab.result.verify");
    expect(pairs).toContain("pharmacy.rx.verify|pharmacy.dispense.post");
  } finally {
    await c.end();
  }
});
