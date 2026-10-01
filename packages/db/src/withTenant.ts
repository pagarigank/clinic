import type { Pool, PoolClient } from "pg";

/**
 * Request/job transaction wrapper (architecture §6.5).
 * Settings are transaction-local (`set_config(..., true)`), so PgBouncer
 * transaction pooling is safe and a pooled connection can never leak a
 * previous tenant's context. No session-level `SET` anywhere.
 *
 * With no tenant set, RLS policies evaluate `tenant_id = NULL` → zero rows
 * (fail-closed, specification AC-2).
 */
export interface TenantContext {
  tenantId?: string;
  userId?: string;
  scope?: "tenant" | "platform";
  branchId?: string;
  requestId?: string;
}

export async function withTenant<T>(
  ctx: TenantContext,
  fn: (tx: PoolClient) => Promise<T>,
): Promise<T> {
  const { getAppPool } = await import("./pool.js");
  return withTenantOnPool(getAppPool(), ctx, fn);
}

export async function withTenantOnPool<T>(
  pool: Pool,
  ctx: TenantContext,
  fn: (tx: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `SELECT set_config('app.tenant_id',  $1, true),
              set_config('app.user_id',    $2, true),
              set_config('app.scope',      $3, true),
              set_config('app.branch_id',  $4, true),
              set_config('app.request_id', $5, true)`,
      [
        ctx.tenantId ?? "",
        ctx.userId ?? "",
        ctx.scope ?? "tenant",
        ctx.branchId ?? "",
        ctx.requestId ?? "",
      ],
    );
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
