import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Request-scoped record of whether a tenant transaction was actually opened.
 *
 * architecture §11.3 deliberately puts the transaction in the **service** layer
 * (`withTenant()`), not in a global interceptor. The cost of that choice is
 * that nothing structurally stops a new endpoint from forgetting the call: RLS
 * then evaluates `tenant_id = NULL` and returns zero rows (fail-closed,
 * specification AC-2) — safe, but silent, and expensive to debug.
 *
 * This module closes that gap without moving the transaction. It is
 * **observability, not a security boundary**: RLS remains the only thing
 * standing between tenants, and this store is per-process, per-request and
 * never consulted by the database.
 *
 * It also catches the inverse bug for free: a service that opens a transaction
 * for a *different* tenant than the request was scoped to throws here rather
 * than quietly reading another clinic's rows.
 */

interface TenantScope {
  /** Tenant the request is scoped to, when known at scope entry. */
  tenantId?: string;
  /** How many `withTenant()` transactions ran inside this scope. */
  transactionsOpened: number;
}

/**
 * Stable reference to a request's tenant scope.
 *
 * The caller keeps this handle instead of re-reading the ambient store later,
 * because `AsyncLocalStorage.getStore()` returns `undefined` outside the async
 * continuation that entered the scope — and an interceptor's `map` runs in the
 * subscriber, not inside the handler. The handle is a plain object, so the
 * counter it carries is readable from anywhere.
 */
export interface TenantScopeHandle {
  readonly tenantId?: string;
  transactionsOpened: number;
}

const storage = new AsyncLocalStorage<TenantScope>();

/**
 * Run `fn` inside a fresh tenant scope bound to `tenantId`. Nest calls this
 * once per request from the tenant-context interceptor; the scope propagates
 * automatically to every async continuation the handler starts.
 *
 * Pass the tenant the request was resolved to, so `noteTenantTransaction` can
 * detect a service that opens a transaction for a different tenant.
 */
export function runInTenantScope<T>(
  tenantId: string | undefined,
  fn: (scope: TenantScopeHandle) => T,
): T {
  const scope: TenantScope = { tenantId, transactionsOpened: 0 };
  return storage.run(scope, () => fn(scope));
}

/**
 * Record a transaction opened by `withTenant()`. Called by the db layer itself,
 * so it cannot be forgotten by a service.
 *
 * Throws when the transaction's tenant disagrees with the request's tenant —
 * that combination is always a cross-tenant bug, never an intent.
 */
export function noteTenantTransaction(tenantId: string | undefined): void {
  const scope = storage.getStore();
  // No scope: background job, migration or script. Nothing will check, and the
  // tenant id is carried explicitly in the `set_config` call as before.
  if (!scope) return;

  if (scope.tenantId !== undefined && tenantId !== undefined && scope.tenantId !== tenantId) {
    throw new Error(
      `cross-tenant transaction: request is scoped to tenant ${scope.tenantId} ` +
        `but withTenant() was called for tenant ${tenantId}`,
    );
  }
  scope.transactionsOpened += 1;
}

/** Transactions opened so far in this scope (0 when there is no scope). */
export function tenantTransactionsInScope(): number {
  return storage.getStore()?.transactionsOpened ?? 0;
}
