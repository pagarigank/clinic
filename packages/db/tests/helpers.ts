import pg from "pg";
import { resolveUrl } from "../src/pool.js";

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
