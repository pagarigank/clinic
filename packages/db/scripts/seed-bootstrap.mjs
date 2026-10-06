#!/usr/bin/env node
/**
 * Runner for migrations/seeds/tenant_bootstrap.sql.
 *
 * Credential-free: the connection string comes from CLINIC_DATABASE_URL only.
 *
 *   pnpm --filter @clinic/db seed:bootstrap -- --tenant <uuid>            # apply (COMMIT)
 *   pnpm --filter @clinic/db seed:bootstrap -- --tenant <uuid> --check    # 1 pass, ROLLBACK
 *   pnpm --filter @clinic/db seed:bootstrap -- --tenant <uuid> --verify   # 2 passes + atomicity proof, ROLLBACK
 *   pnpm --filter @clinic/db seed:bootstrap -- --tenant <uuid> --check --fresh
 *       # validates the seed against a throwaway PROVISIONING tenant created
 *       # inside the transaction (rolled back with everything else)
 *
 * The tenant bootstrap is what JOB-03 (apps/worker provision.handler) calls
 * automatically when a tenant is created through the platform portal. This CLI
 * exists for manual/recovery runs and for validating seed changes.
 *
 * Substitutions (same mechanism as seed-demo-clean.mjs retarget):
 *   11111111-1111-4111-8111-111111111111 -> the target tenant id
 *   @@TENANT_SLUG@@                      -> the tenant's slug (emails)
 *   @TENANT_NAME@                        -> the tenant's name (single-quote escaped)
 *
 * There is deliberately NO default tenant: bootstrapping demo-a by accident
 * would be a no-op at best and a confusion at worst, so --tenant is required.
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import pg from 'pg';

const DEMO_TENANT_ID = '11111111-1111-4111-8111-111111111111';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const argv = process.argv.slice(2);
const has = (name) => argv.includes(name);
const valueOf = (name) => {
  const i = argv.indexOf(name);
  return i === -1 ? undefined : argv[i + 1];
};

const VERIFY_IDEMPOTENCY = has('--verify');
const FRESH = has('--fresh');
const CHECK_ONLY = has('--check') || VERIFY_IDEMPOTENCY;
const TENANT_ID = valueOf('--tenant');

if (!TENANT_ID) {
  console.error('seed-bootstrap: --tenant <uuid> is required (no default target).');
  process.exit(1);
}
if (!UUID_RE.test(TENANT_ID)) {
  console.error(`seed-bootstrap: --tenant must be a UUID (got ${JSON.stringify(TENANT_ID)}).`);
  process.exit(1);
}
if (FRESH && !CHECK_ONLY) {
  console.error(
    'seed-bootstrap: --fresh is only valid together with --check or --verify.\n' +
      '  It fabricates a throwaway tenant that only exists to be rolled back.',
  );
  process.exit(1);
}

const connectionString = process.env.CLINIC_DATABASE_URL;
if (!connectionString) {
  console.error(
    'seed-bootstrap: CLINIC_DATABASE_URL is not set.\n' +
      '  Refusing to fall back to a hardcoded credential. Export it and re-run.',
  );
  process.exit(1);
}

const seedPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'migrations',
  'seeds',
  'tenant_bootstrap.sql',
);

/** Remove the seed's own transaction markers so the runner controls BEGIN/COMMIT. */
function stripTransactionMarkers(sql) {
  const withoutBegin = sql.replace(/^\s*BEGIN\s*;\s*$/im, '');
  const withoutCommit = withoutBegin.replace(/\bCOMMIT\s*;\s*$/i, '');
  if (withoutBegin === sql || withoutCommit === withoutBegin) {
    throw new Error(
      'seed-bootstrap: could not locate the BEGIN;/COMMIT; markers in tenant_bootstrap.sql.',
    );
  }
  return withoutCommit;
}

/** Row counts that must not move when the bootstrap is applied a second time. */
const PROBES = [
  ['starter_roles', `SELECT count(*)::int AS n FROM roles WHERE tenant_id = $1 AND code IN ('tenant_admin','doctor','nurse','pharmacist_dispenser','receptionist','pharmacist_verifier','lab_technologist','lab_verifier','cashier')`],
  ['starter_accounts', `SELECT count(*)::int AS n FROM users WHERE tenant_id = $1 AND email LIKE '%@' || (SELECT slug FROM tenants WHERE id = $1) || '.emr'`],
  ['user_branches', `SELECT count(*)::int AS n FROM user_branches WHERE tenant_id = $1`],
  ['employees', `SELECT count(*)::int AS n FROM employees WHERE tenant_id = $1`],
  ['drug_products', `SELECT count(*)::int AS n FROM drug_products WHERE tenant_id = $1`],
  ['items', `SELECT count(*)::int AS n FROM items WHERE tenant_id = $1`],
  ['service_catalog', `SELECT count(*)::int AS n FROM service_catalog WHERE tenant_id = $1`],
  ['lab_tests', `SELECT count(*)::int AS n FROM lab_tests WHERE tenant_id = $1`],
  ['lab_analytes', `SELECT count(*)::int AS n FROM lab_analytes WHERE tenant_id = $1`],
  ['lab_reference_ranges', `SELECT count(*)::int AS n FROM lab_reference_ranges WHERE tenant_id = $1`],
  ['lab_instruments', `SELECT count(*)::int AS n FROM lab_instruments WHERE tenant_id = $1`],
  ['stock_locations', `SELECT count(*)::int AS n FROM stock_locations WHERE tenant_id = $1`],
  ['service_units', `SELECT count(*)::int AS n FROM service_units WHERE tenant_id = $1`],
  ['item_categories', `SELECT count(*)::int AS n FROM item_categories WHERE tenant_id = $1`],
  ['role_permissions', `SELECT count(*)::int AS n FROM role_permissions WHERE tenant_id = $1`],
  ['tenant_modules', `SELECT count(*)::int AS n FROM tenant_modules WHERE tenant_id = $1`],
];

async function snapshot(client) {
  const out = {};
  for (const [label, sql] of PROBES) {
    const { rows } = await client.query(sql, [TENANT_ID]);
    out[label] = rows[0].n;
  }
  return out;
}

function diff(before, after) {
  return Object.keys(before).filter((label) => after[label] !== before[label]);
}

async function main() {
  const client = new pg.Client({ connectionString });

  try {
    await client.connect();
    client.on('notice', (n) => {
      if (n.message) console.log(`  [notice] ${n.message}`);
    });

    // In --fresh mode the target is a throwaway PROVISIONING tenant created
    // inside the transaction below, so it must NOT be looked up (or required
    // to exist) beforehand. Everything vanishes with the rollback.
    let tenant;
    if (FRESH) {
      tenant = {
        id: TENANT_ID,
        name: `Bootstrap Probe ${TENANT_ID.slice(0, 8)}`,
        slug: `bootstrap-probe-${TENANT_ID.slice(0, 8)}`,
        status: 'PROVISIONING',
      };
    } else {
      const tenantRows = await client.query(
        `SELECT id, name, slug, status FROM tenants WHERE id = $1`,
        [TENANT_ID],
      );
      if (tenantRows.rowCount === 0) {
        console.error(`seed-bootstrap: no tenant with id ${TENANT_ID}. Create it through the portal first.`);
        process.exit(1);
      }
      tenant = tenantRows.rows[0];
      if (!['PROVISIONING', 'ACTIVE'].includes(tenant.status)) {
        console.error(
          `seed-bootstrap: tenant '${tenant.slug}' is ${tenant.status}; bootstrap requires PROVISIONING or ACTIVE.`,
        );
        process.exit(1);
      }
    }

    // Substitutions. Slug first, then the free-text name with quotes escaped,
    // so a tenant name containing an apostrophe cannot break the literals.
    const raw = await readFile(seedPath, 'utf8');
    const sql = stripTransactionMarkers(raw)
      .replaceAll(DEMO_TENANT_ID, TENANT_ID)
      .replaceAll('__TENANT_SLUG__', tenant.slug)
      .replaceAll('@@TENANT_SLUG@@', tenant.slug)
      .replaceAll('@TENANT_NAME@', tenant.name.replace(/'/g, "''"));

    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [TENANT_ID]);
    console.log(`seed-bootstrap: target '${tenant.slug}' (${TENANT_ID}, status=${tenant.status})`);

    if (FRESH) {
      // Probe-mode only: a throwaway PROVISIONING tenant + portal entitlement
      // rows, exactly what the portal creates before JOB-03 runs. Everything
      // here vanishes with the rollback.
      await client.query(
        `INSERT INTO tenants (id, name, slug, status)
         VALUES ($1, $2, $3, 'PROVISIONING')
         ON CONFLICT (id) DO NOTHING`,
        [TENANT_ID, tenant.name, tenant.slug],
      );
      for (const mod of ['admin','patients','clinical','laboratory','pharmacy','supply','billing','compliance','notifications','reports']) {
        await client.query(
          `INSERT INTO tenant_modules (tenant_id, module, status, seed_status)
           VALUES ($1, $2, 'DISABLED', 'PENDING')
           ON CONFLICT (tenant_id, module) DO NOTHING`,
          [TENANT_ID, mod],
        );
      }
      console.log('  --fresh: bootstrapped a throwaway PROVISIONING tenant + entitlement rows inside this transaction');
    }

    const baseline = await snapshot(client);

    console.log('\ntenant_bootstrap: pass 1 …');
    await client.query(sql);
    const afterPass1 = await snapshot(client);

    if (VERIFY_IDEMPOTENCY) {
      console.log('\ntenant_bootstrap: pass 2 (idempotency probe) …');
      await client.query(sql);
      const afterPass2 = await snapshot(client);
      const moved = diff(afterPass1, afterPass2);
      console.log(`\n  pass 2 changed (${moved.length}/${PROBES.length} probed tables)`);
      for (const label of moved) console.log(`    ${label.padEnd(22)} ${afterPass1[label]} -> ${afterPass2[label]}`);
      if (moved.length > 0) {
        throw new Error('tenant_bootstrap is not idempotent: pass 2 changed rows.');
      }
      console.log('  idempotent: pass 2 changed nothing.');
    }

    console.log(`\n  pass 1 changed (${diff(baseline, afterPass1).length}/${PROBES.length} probed tables)`);
    for (const label of diff(baseline, afterPass1)) {
      console.log(`    ${label.padEnd(22)} ${baseline[label]} -> ${afterPass1[label]}`);
    }

    if (CHECK_ONLY) {
      await client.query('ROLLBACK');
      console.log(
        VERIFY_IDEMPOTENCY
          ? '\nseed-bootstrap: verification passed — transaction ROLLED BACK, nothing written.'
          : '\nseed-bootstrap: check passed — transaction ROLLED BACK, nothing written.',
      );
    } else {
      await client.query('COMMIT');
      console.log('\ntenant_bootstrap: applied and committed.');
    }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('\nseed-bootstrap: FAILED (transaction rolled back):', err.message);
    if (process.env.DEBUG) console.error(err);
    process.exitCode = 1;
  } finally {
    await client.end().catch(() => {});
  }
}

await main();
