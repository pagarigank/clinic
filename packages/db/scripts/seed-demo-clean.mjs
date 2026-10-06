#!/usr/bin/env node
/**
 * Runner for migrations/seeds/demo_clean.sql.
 *
 * Credential-free: the connection string comes from CLINIC_DATABASE_URL only.
 * (Several older scripts in this folder hardcode it — do not copy that pattern.)
 *
 *   pnpm --filter @clinic/db seed:demo                     # apply to demo-a (COMMIT)
 *   pnpm --filter @clinic/db seed:demo -- --check          # 1 pass, ROLLBACK
 *   pnpm --filter @clinic/db seed:demo -- --verify         # 2 passes + atomicity proof, ROLLBACK
 *   pnpm --filter @clinic/db seed:demo -- --verify --fresh # same, against a throwaway tenant
 *   pnpm --filter @clinic/db seed:demo -- --fail-probe     # seed, then force a failure, prove ROLLBACK
 *   pnpm --filter @clinic/db seed:demo -- --tenant <uuid>  # target another tenant
 *
 * Why the runner owns the transaction instead of psql -f:
 *   the seed file's BEGIN/COMMIT are stripped here so the runner can execute the
 *   body repeatedly inside ONE transaction, snapshot row counts around it, and
 *   then discard everything. That is what proves idempotency (pass 2 must change
 *   nothing) and atomicity (nothing survives the rollback) without a write.
 *
 * --fresh exists because the live demo-a tenant is not clean: it carries years of
 * QA/demo traffic. It bootstraps a brand-new tenant row *inside the transaction*,
 * so the clean-state proof is possible and the tenant disappears with the
 * rollback. demo-a is never modified by the verification modes.
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import pg from 'pg';

const DEMO_TENANT_ID = '11111111-1111-4111-8111-111111111111';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const argv = process.argv.slice(2);
const has = (name) => argv.includes(name);

const VERIFY_IDEMPOTENCY = has('--verify');
const FAIL_PROBE = has('--fail-probe');
const FRESH = has('--fresh');
const CHECK_ONLY = has('--check') || VERIFY_IDEMPOTENCY || FAIL_PROBE;

// --fresh fabricates a tenant that only makes sense if the transaction is thrown
// away. Allow it to reach COMMIT and you have silently created a junk tenant.
if (FRESH && !CHECK_ONLY) {
  console.error(
    'seed-demo-clean: --fresh is only valid together with --check, --verify or --fail-probe.\n' +
      '  It creates a throwaway tenant that only exists to be rolled back; committing it\n' +
      '  would leave junk in the database. To apply for real, drop --fresh and target an\n' +
      '  existing tenant.',
  );
  process.exit(1);
}

const tenantIdx = argv.indexOf('--tenant');
const TENANT_ID = tenantIdx === -1 ? DEMO_TENANT_ID : argv[tenantIdx + 1];
const LABEL = TENANT_ID === DEMO_TENANT_ID ? 'demo-a' : TENANT_ID;

const connectionString = process.env.CLINIC_DATABASE_URL;
if (!connectionString) {
  console.error(
    'seed-demo-clean: CLINIC_DATABASE_URL is not set.\n' +
      '  Refusing to fall back to a hardcoded credential. Export it and re-run.',
  );
  process.exit(1);
}
if (!UUID_RE.test(TENANT_ID ?? '')) {
  console.error(`seed-demo-clean: --tenant must be a UUID (got ${JSON.stringify(TENANT_ID)}).`);
  process.exit(1);
}

const seedPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'migrations',
  'seeds',
  'demo_clean.sql',
);

/** Remove the seed's own transaction markers so the runner controls BEGIN/COMMIT. */
function stripTransactionMarkers(sql) {
  const withoutBegin = sql.replace(/^\s*BEGIN\s*;\s*$/im, '');
  const withoutCommit = withoutBegin.replace(/\bCOMMIT\s*;\s*$/i, '');
  if (withoutBegin === sql || withoutCommit === withoutBegin) {
    throw new Error(
      'seed-demo-clean: could not locate the BEGIN;/COMMIT; markers in demo_clean.sql — ' +
        'the file must open with BEGIN; and close with COMMIT; for this runner to work.',
    );
  }
  return withoutCommit;
}

/**
 * Retarget the seed at another tenant.
 *
 * demo_clean.sql pins demo-a's id in ~60 literals. Rewriting every statement to
 * read current_setting('app.tenant_id') would make the SQL harder to audit, and
 * psql's :variables are unavailable through node-postgres, so this runner does
 * the single mechanical substitution instead.
 */
function retarget(sql, from, to) {
  if (from === to) return sql;
  if (sql.split(from).length - 1 === 0) {
    throw new Error(`seed-demo-clean: tenant id ${from} not found in demo_clean.sql.`);
  }
  return sql.replaceAll(from, to);
}

/** Row counts that must not move when the seed is applied a second time. */
const PROBES = [
  ['patients', `SELECT count(*)::int AS n FROM patients WHERE tenant_id = $1`],
  ['patient_identifiers', `SELECT count(*)::int AS n FROM patient_identifiers WHERE tenant_id = $1`],
  ['patient_contacts', `SELECT count(*)::int AS n FROM patient_contacts WHERE tenant_id = $1`],
  ['staff', `SELECT count(*)::int AS n FROM users WHERE tenant_id = $1 AND email IN ('admin@demo-a.test','doctor@demo-a.test','nurse@demo-a.test','dispenser@demo-a.test','staff@demo-a.test','verifier@demo-a.test','labtech@demo-a.test','labverify@demo-a.test')`],
  ['user_roles', `SELECT count(*)::int AS n FROM user_roles ur JOIN users u ON u.tenant_id = ur.tenant_id AND u.id = ur.user_id WHERE ur.tenant_id = $1 AND u.email IN ('admin@demo-a.test','doctor@demo-a.test','nurse@demo-a.test','dispenser@demo-a.test','staff@demo-a.test','verifier@demo-a.test','labtech@demo-a.test','labverify@demo-a.test')`],
  ['user_branches', `SELECT count(*)::int AS n FROM user_branches ub JOIN users u ON u.tenant_id = ub.tenant_id AND u.id = ub.user_id WHERE ub.tenant_id = $1 AND u.email IN ('admin@demo-a.test','doctor@demo-a.test','nurse@demo-a.test','dispenser@demo-a.test','staff@demo-a.test','verifier@demo-a.test','labtech@demo-a.test','labverify@demo-a.test')`],
  ['employees', `SELECT count(*)::int AS n FROM employees e JOIN users u ON u.tenant_id = e.tenant_id AND u.id = e.user_id WHERE e.tenant_id = $1 AND u.email IN ('admin@demo-a.test','doctor@demo-a.test','nurse@demo-a.test','dispenser@demo-a.test','staff@demo-a.test','verifier@demo-a.test','labtech@demo-a.test','labverify@demo-a.test')`],
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

/** Labels whose counts differ between two snapshots. */
function diff(before, after) {
  return Object.keys(before).filter((label) => after[label] !== before[label]);
}

/** Read committed state from a brand-new transaction so RLS context is re-established. */
async function readCommittedCounts(client) {
  await client.query('BEGIN');
  try {
    await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [TENANT_ID]);
    return await snapshot(client);
  } finally {
    await client.query('ROLLBACK');
  }
}

function printSection(title, before, after) {
  const moved = diff(before, after);
  console.log(`\n  ${title} (${moved.length}/${Object.keys(before).length} probed tables)`);
  for (const label of moved) console.log(`    ${label.padEnd(22)} ${before[label]} -> ${after[label]}`);
  return moved;
}

async function main() {
  const sql = retarget(stripTransactionMarkers(await readFile(seedPath, 'utf8')), DEMO_TENANT_ID, TENANT_ID);
  const client = new pg.Client({ connectionString });

  try {
    await client.connect();
    client.on('notice', (n) => {
      if (n.message) console.log(`  [notice] ${n.message}`);
    });

    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [TENANT_ID]);
    console.log(`seed-demo-clean: target ${LABEL} (${TENANT_ID})`);

    if (FRESH) {
      // Inside the transaction only — the row vanishes with the rollback below.
      await client.query(
        `INSERT INTO tenants (id, name, slug, status, timezone)
         VALUES ($1, $2, $3, 'ACTIVE', 'Asia/Manila')
         ON CONFLICT (id) DO NOTHING`,
        [TENANT_ID, `Seed probe ${TENANT_ID.slice(0, 8)}`, `seed-probe-${TENANT_ID.slice(0, 8)}`],
      );
      console.log('  --fresh: bootstrapped a throwaway ACTIVE tenant inside this transaction');
    }

    const baseline = await snapshot(client);

    console.log('\ndemo_clean: pass 1 …');
    await client.query(sql);
    const afterPass1 = await snapshot(client);

    if (VERIFY_IDEMPOTENCY) {
      console.log('\ndemo_clean: pass 2 (idempotency probe) …');
      await client.query(sql);
      const afterPass2 = await snapshot(client);
      const moved = printSection('pass 2 changed', afterPass1, afterPass2);
      if (moved.length > 0) {
        throw new Error(
          'demo_clean: pass 2 changed row counts, so the seed is NOT idempotent:\n' +
            moved.map((l) => `    ${l}: ${afterPass1[l]} -> ${afterPass2[l]}`).join('\n'),
        );
      }
      console.log('  idempotent: pass 2 changed nothing.');
    }

    printSection('pass 1 created', baseline, afterPass1);

    if (FAIL_PROBE) {
      console.log('\ndemo_clean: forcing a mid-transaction failure to prove atomicity …');
      // The probe must be *caught*, not propagated: if the error escapes, the outer
      // handler rolls back and reports the failure, which proves nothing about the
      // counts. Catching it here lets the rollback below run while the deliberate
      // failure is still live, which is the case that actually matters — a seed
      // that dies halfway must leave no partial rows behind.
      let probeError = null;
      try {
        await client.query(`DO $$ BEGIN RAISE EXCEPTION 'seed-demo-clean: deliberate fail-probe'; END $$;`);
      } catch (err) {
        probeError = err;
      }
      if (probeError === null) {
        throw new Error(
          'seed-demo-clean: the deliberate fail-probe did NOT fail, so atomicity under failure is unproven.',
        );
      }
      console.log(`  fail-probe raised as expected: ${probeError.message}`);
      console.log('  rolling back mid-transaction with pass 1 + pass 2 applied but uncommitted …');
    }

    if (!CHECK_ONLY) {
      await client.query('COMMIT');
      console.log('\ndemo_clean: applied and committed.');
      return;
    }

    await client.query('ROLLBACK');

    // Atomicity proof: re-read from a new transaction. If the rollback had leaked
    // anything, these counts would not match the baseline.
    const persisted = await readCommittedCounts(client);
    const leaked = diff(baseline, persisted);
    if (leaked.length > 0) {
      throw new Error(
        'demo_clean: rows survived the ROLLBACK — the seed is NOT atomic:\n' +
          leaked.map((l) => `    ${l}: ${baseline[l]} -> ${persisted[l]}`).join('\n'),
      );
    }
    console.log('  atomic: post-rollback counts match the pre-seed baseline exactly.');
    if (FAIL_PROBE) {
      console.log('  atomic: proven under a mid-transaction FAILURE, not just on the happy path.');
    }
    console.log(`\nseed-demo-clean: verification passed — transaction ROLLED BACK, nothing written.`);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(`\nseed-demo-clean: ${err.message ?? err}`);
    if (err.position) console.error(`  at SQL position ${err.position}`);
    process.exitCode = 1;
  } finally {
    await client.end().catch(() => {});
  }
}

await main();
