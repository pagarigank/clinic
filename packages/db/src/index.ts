export {
  createPool,
  getAppPool,
  closeAllPools,
  resolveUrl,
  type DbRole,
  // Type-only re-exports (boundary rule: app code never imports `pg` itself).
  type Pool,
  type PoolClient,
  type QueryResult,
  type QueryResultRow,
} from "./pool.js";
export { withTenant, withTenantOnPool, type TenantContext } from "./withTenant.js";
export {
  runInTenantScope,
  noteTenantTransaction,
  tenantTransactionsInScope,
  type TenantScopeHandle,
} from "./tenant-scope.js";
