/**
 * Tenant bootstrap loader — the programmatic entry point for
 * migrations/seeds/tenant_bootstrap.sql.
 *
 * JOB-03 (apps/worker/src/handlers/provision.handler.ts) calls
 * `runTenantBootstrap` after it has seeded the module entitlements, so every
 * tenant created through the platform portal starts with the full master
 * catalogue, the 8 starter roles (with their complete grant sets) and the 8
 * slug-stubbed starter accounts.
 *
 * The SQL owns the transaction (BEGIN … COMMIT inside the file). It is
 * idempotent, additive-only outside the one documented SoD repair, and
 * verifies its own shape before committing, so a re-run after a partial
 * failure is safe.
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/** demo-a's id — the placeholder the seed file is authored with. */
const SEED_PLACEHOLDER_TENANT = '11111111-1111-4111-8111-111111111111';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const seedPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'migrations',
  'seeds',
  'tenant_bootstrap.sql',
);

let cachedSql: string | undefined;

export interface TenantBootstrapOptions {
  /** Tenant id (uuid) created by the portal. */
  tenantId: string;
  /** Tenant slug — becomes the email stub: admin@<slug>.emr. */
  slug: string;
  /** Tenant display name — becomes account display names. */
  name: string;
}

export class BootstrapSeedError extends Error {
  constructor(
    message: string,
    readonly detail?: unknown,
  ) {
    super(message);
    this.name = 'BootstrapSeedError';
  }
}

/** Slug characters that cannot appear in an email local-part context safely. */
function sanitizeSlug(slug: string): string {
  const clean = slug.toLowerCase().replace(/[^a-z0-9-]/g, '');
  if (!clean) {
    throw new BootstrapSeedError(`tenant slug '${slug}' has no email-safe characters`);
  }
  return clean;
}

/**
 * Apply the tenant bootstrap seed inside the seed's own single transaction.
 *
 * Throws BootstrapSeedError on any failure — the caller (JOB-03) treats a
 * failure as a provisioning failure for the tenant (tenant stays PROVISIONING,
 * job is retried), never as a partial success.
 */
export async function runTenantBootstrap(
  client: { query: (sql: string, values?: unknown[]) => Promise<unknown> },
  { tenantId, slug, name }: TenantBootstrapOptions,
): Promise<void> {
  if (!UUID_RE.test(tenantId)) {
    throw new BootstrapSeedError(`tenantId must be a UUID (got '${tenantId}')`);
  }

  cachedSql ??= (await readFile(seedPath, 'utf8')).replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  const cleanSlug = sanitizeSlug(slug);
  const sql = cachedSql
    .replaceAll(SEED_PLACEHOLDER_TENANT, tenantId)
    .replaceAll('__TENANT_SLUG__', cleanSlug)
    .replaceAll('@@TENANT_SLUG@@', cleanSlug)
    .replaceAll('@TENANT_NAME@', name.replace(/'/g, "''"));

  try {
    await client.query(sql);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new BootstrapSeedError(`tenant bootstrap failed: ${message}`, err);
  }
}
