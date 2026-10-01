import pg from "pg";

/**
 * Connection plumbing (architecture §6.1, §21.1). Three roles:
 *  - clinic_owner   DDL only (migrator)
 *  - clinic_app     NOSUPERUSER NOBYPASSRLS (api + worker)
 *  - clinic_report  read replica for reports (later phases)
 * Only this module may import `pg` (architecture §21.2 import rules).
 */
export type DbRole = "owner" | "app" | "report";

// Type-only re-exports: app code needs pg's client types for its own function
// signatures but must never import `pg` itself (boundary rule, arch §21.2).
export type { Pool, PoolClient, QueryResult, QueryResultRow } from "pg";

const urlEnvKeys: Record<DbRole, string> = {
  owner: "DATABASE_URL_MIGRATOR",
  app: "DATABASE_URL_APP",
  report: "DATABASE_URL_REPORT",
};

export function resolveUrl(role: DbRole): string {
  const fromEnv = process.env[urlEnvKeys[role]];
  if (fromEnv) return fromEnv;
  // Local dev fallback — native Postgres, no Docker (credentials: todo.md
  // line 10; the migrator is the machine superuser, runtime roles are created
  // by migration 0001).
  const fallbacks: Record<DbRole, string> = {
    owner: "postgres://kpagarigan2:P%40ssw0rd@localhost:5432/clinic",
    app: "postgres://clinic_app:clinic_app_dev@localhost:5432/clinic",
    report: "postgres://clinic_report:clinic_report_dev@localhost:5432/clinic",
  };
  return fallbacks[role];
}

export interface PoolOptions {
  role: DbRole;
  max?: number;
}

export function createPool({ role, max = 10 }: PoolOptions): pg.Pool {
  const pool = new pg.Pool({
    connectionString: resolveUrl(role),
    max,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
  // Reset-on-checkout guard (architecture §6.5): no session-level state may
  // survive between pooled clients. Transaction-local set_config is the only
  // permitted context mechanism.
  pool.on("connect", (client) => {
    void client.query("SET client_min_messages TO warning");
  });
  return pool;
}

let appPool: pg.Pool | undefined;

/** Shared app-role pool for the API/worker process. */
export function getAppPool(): pg.Pool {
  appPool ??= createPool({ role: "app" });
  return appPool;
}

export async function closeAllPools(): Promise<void> {
  if (appPool) {
    await appPool.end();
    appPool = undefined;
  }
}
