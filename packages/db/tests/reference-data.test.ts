import { it, expect } from "vitest";
import { Client } from "pg";

/**
 * Reference-data reproducibility (todo 0.2 / 1.3).
 *
 * The permission catalogue gates every PHI route, so `pnpm db:migrate` alone
 * must yield a populated `permissions` table. It used to be seeded only by a
 * script no npm/CI step invoked, so a fresh database had an empty catalogue.
 */
const URL_OWNER =
  process.env.DATABASE_URL_MIGRATOR ?? "postgres://kpagarigan2:P%40ssw0rd@localhost:5432/clinic";

it("migrations alone populate the permission catalogue", async () => {
  const c = new Client({ connectionString: URL_OWNER });
  await c.connect();
  try {
    const n = await c.query(`SELECT count(*)::int AS n FROM permissions`);
    console.log("  permissions rows from migrations alone:", n.rows[0].n);
    expect(n.rows[0].n).toBeGreaterThanOrEqual(300);

    const sod = await c.query(`SELECT count(*)::int AS n FROM sod_conflicts`);
    expect(sod.rows[0].n).toBe(7);

    // Spot-check that a SoD pair's permissions both exist, so the guard's
    // catalogue and the seeded reference data cannot drift apart.
    const probe = await c.query(
      `SELECT code FROM permissions WHERE code = ANY($1) ORDER BY code`,
      [["pharmacy.rx.verify", "pharmacy.dispense.post", "lab.result.enter"]],
    );
    expect(probe.rows.map((r) => r.code)).toEqual([
      "lab.result.enter",
      "pharmacy.dispense.post",
      "pharmacy.rx.verify",
    ]);
  } finally {
    await c.end();
  }
});
