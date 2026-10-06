import pg from "pg";
import { resolveUrl } from "../src/pool.js";
import { createPool, withTenantOnPool } from "../src/index.js";

/**
 * Probe the app role once; integration tests skip when no DB is reachable.
 * Must be awaited at module top level: `describe.runIf(...)` is evaluated
 * during collection, *before* any beforeAll hook runs.
 */
export async function probeDb(): Promise<boolean> {
  const client = new pg.Client({
    connectionString: resolveUrl("app"),
    connectionTimeoutMillis: 5_000,
  });
  try {
    await client.connect();
    await client.query("SELECT 1");
    return true;
  } catch (error) {
    console.warn(
      `[db-tests] database probe failed, integration suites will skip: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return false;
  } finally {
    await client.end().catch(() => undefined);
  }
}

export const TENANT_A = "11111111-1111-4111-8111-111111111111";
export const TENANT_B = "22222222-2222-4222-8222-222222222222";

/** Stable natural keys for the staff the demo seed creates. */
export const STAFF_EMAIL = {
  adminA: "admin@demo-a.test",
  doctorA: "doctor@demo-a.test",
  nurseA: "nurse@demo-a.test",
  adminB: "admin@demo-b.test",
  doctorB: "doctor@demo-b.test",
} as const;

export interface SeedUsers {
  USER_A: string;
  DOCTOR_A: string;
  NURSE_A: string;
  USER_B: string;
  DOCTOR_B: string;
}

/**
 * Placeholder for when the database is unreachable, so a suite can still be collected
 * and skipped rather than throwing at import time. Tests that need real IDs are gated on
 * `probeDb()` and never run against these empty strings.
 */
export const NO_SEED_USERS: SeedUsers = {
  USER_A: "",
  DOCTOR_A: "",
  NURSE_A: "",
  USER_B: "",
  DOCTOR_B: "",
};

let cachedUsers: SeedUsers | null = null;

/**
 * Resolve seeded staff IDs by email at run time.
 *
 * The demo seed pins patient, branch, role and supplier IDs so fixtures can refer to them,
 * but user IDs are generated per seed run — a hardcoded user UUID only ever described one
 * database. Anything that needs "the demo-a admin" looks it up by email instead, which
 * survives a re-seed.
 *
 * Throws when the DB is reachable but the user is missing, so a missing seed fails loudly
 * rather than silently producing dangling references.
 */
export async function seedUsers(): Promise<SeedUsers> {
  if (cachedUsers) return cachedUsers;

  const pool = createPool({ role: "app" });
  const lookup = async (tenantId: string, emails: readonly string[]) => {
    const { rows } = await withTenantOnPool(
      pool,
      { tenantId, requestId: crypto.randomUUID() },
      (tx) =>
        tx.query<{ email: string; id: string }>(
          "SELECT email, id::text AS id FROM users WHERE tenant_id = $1 AND email = ANY($2::text[])",
          [tenantId, [...emails]],
        ),
    );
    return new Map(rows.map((r) => [r.email, r.id]));
  };

  const a = await lookup(TENANT_A, [STAFF_EMAIL.adminA, STAFF_EMAIL.doctorA, STAFF_EMAIL.nurseA]);
  const b = await lookup(TENANT_B, [STAFF_EMAIL.adminB, STAFF_EMAIL.doctorB]);

  const need = (found: Map<string, string>, email: string): string => {
    const id = found.get(email);
    if (!id) {
      throw new Error(
        `seeded user ${email} not found — run: pnpm --filter @clinic/db seed:demo`,
      );
    }
    return id;
  };

  cachedUsers = {
    USER_A: need(a, STAFF_EMAIL.adminA),
    DOCTOR_A: need(a, STAFF_EMAIL.doctorA),
    NURSE_A: need(a, STAFF_EMAIL.nurseA),
    USER_B: need(b, STAFF_EMAIL.adminB),
    DOCTOR_B: need(b, STAFF_EMAIL.doctorB),
  };
  return cachedUsers;
}
