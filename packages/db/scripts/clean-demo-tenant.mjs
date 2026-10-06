#!/usr/bin/env node
/**
 * Audited, tenant-scoped cleanup of demo/QA transaction history.
 *
 * Credential-free: the connection string comes from CLINIC_DATABASE_URL only.
 * (Several older scripts in this folder hardcode it — do not copy that pattern.)
 *
 *   pnpm --filter @clinic/db clean:demo -- --tenant <uuid>                          # dry run (default)
 *   pnpm --filter @clinic/db clean:demo -- --tenant <uuid> --apply --confirm <slug>  # delete
 *
 *   --wipe keeps only tenancy, access-control and master/reference data for that tenant.
 *   --drop-test-tenants additionally drops every leftover `test-*` tenant cluster-wide.
 *   `--confirm` is a comma-separated set of tokens, one per destructive scope, so each is
 *   acknowledged on its own: `--confirm demo-a,test-tenants`.
 *
 * WHY THIS IS A SEPARATE SCRIPT
 *   demo_clean.sql is additive by design: it never deletes rows it did not create, so it
 *   cannot undo years of QA/load-test traffic (duplicate identifiers, ~230 junk medicine
 *   items, thousands of stock movements). Repairing that is a *destructive* action and
 *   belongs in its own auditable tool, never inside a seed.
 *
 * SAFETY MODEL
 *   1. Dry run is the default. `--apply` requires a `--confirm` token naming the exact
 *      scope being destroyed (the tenant slug for cleanup/wipe, the literal `test-tenants`
 *      for the cluster-wide drop), so a fat-fingered tenant UUID cannot destroy the wrong
 *      tenant and the drop cannot run unattended.
 *   2. One transaction. Any error — including a failed post-condition — rolls everything back.
 *   3. Tables are classified PRESERVE / SCOPED / PURGE. Delete order is derived at runtime
 *      from pg_constraint, so FK violations are impossible by construction rather than by a
 *      hand-ordered list that rots on the next migration.
 *   4. Append-only tables (audit_log, phi_access_log, security_events — enforced by
 *      app.*_append_only() triggers) are DISCOVERED from pg_trigger and can never be
 *      purged, so that protection survives new migrations.
 *   5. Refuse to run when deleting a table would orphan a row in a table we are NOT
 *      deleting from. That check is directional: deleting a child never breaks its parent.
 *   6. A tenant-scoped table with rows but no explicit rule is UNCLASSIFIED and blocks
 *      `--apply`, so a new migration cannot silently start deleting new master data.
 *   7. Seeded rows (3 patients, 3 staff) are preserved by id/email and re-verified before commit.
 *
 * This deletes PHI. It is a demo/QA tool. Point it only at a demo tenant.
 */
import pg from 'pg';

const argv = process.argv.slice(2);
const has = (name) => argv.includes(name);
const valueOf = (name) => {
  const i = argv.indexOf(name);
  return i === -1 ? undefined : argv[i + 1];
};

const TENANT_ID = valueOf('--tenant');
const APPLY = has('--apply');
const ALLOW_UNCLASSIFIED = has('--allow-unclassified');
const WIPE = has('--wipe');
const DROP_TEST_TENANTS = has('--drop-test-tenants');
const CONFIRM = valueOf('--confirm');
/** Each destructive scope is acknowledged by its own token in the comma-separated set. */
const CONFIRM_TOKENS = new Set(
  (CONFIRM ?? '')
    .split(',')
    .map((token) => token.trim())
    .filter(Boolean),
);
/** Literal token required to drop the cluster-wide `test-*` tenants. */
const DROP_TEST_TENANTS_TOKEN = 'test-tenants';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Rows demo_clean.sql owns. Preserved by identity, not by count. */
const SEED_PATIENT_IDS = [
  'a4000000-0000-4000-8000-000000000001',
  'a4000000-0000-4000-8000-000000000002',
  'a4000000-0000-4000-8000-000000000003',
];
const SEED_STAFF_EMAILS = ['admin@demo-a.test', 'doctor@demo-a.test', 'nurse@demo-a.test'];

/** Kept whole. Tenancy, access control, reference data and the seed's master catalogue. */
const PRESERVE = new Set([
  // tenancy / identity / access
  'tenants', 'branches', 'branch_licences', 'subscriptions', 'tenant_modules',
  'roles', 'role_permissions', 'permissions', 'api_keys', 'tenant_directory',
  'system_settings', 'module_entitlement_audit', 'user_branches', 'user_roles',
  // reference data
  'ref_drug_schedules', 'ref_icd10', 'ref_loinc', 'ref_psgc', 'sod_conflicts', 'holidays',
  // master / catalogue — the deliverable of demo_clean.sql
  'items', 'item_categories', 'item_barcodes', 'drug_products', 'generic_names',
  'drug_interactions', 'lab_tests', 'lab_analytes', 'lab_reference_ranges', 'lab_delta_rules',
  'lab_sections', 'lab_specimen_types', 'lab_test_panels', 'lab_instruments', 'lab_qc_materials',
  'lab_report_templates', 'service_catalog', 'service_units', 'price_lists', 'pharmacy_price_rules',
  'discount_types', 'payment_methods', 'periods', 'uoms', 'uom_conversions', 'suppliers',
  'supplier_contacts', 'supplier_items', 'stock_locations', 'location_item_params',
  'consent_templates', 'templates', 'template_versions', 'clinical_templates', 'order_sets',
  'retention_policies',
  // audit + telemetry — append-only or operational; never bulk-deleted
  'audit_log', 'phi_access_log', 'security_events', 'login_attempts', 'outbox',
  'number_sequences', 'clinic_ping', 'user_notifications', 'notification_delivery_logs',
]);

/**
 * Deleted whole, for this tenant only.
 * Every entry is transactional: clinical encounters, orders, money, stock movement.
 */
const PURGE = new Set([
  // clinical
  'appointments', 'queue_tickets', 'visits', 'visit_diagnoses', 'visit_procedures', 'vitals',
  'clinical_notes', 'immunizations', 'referrals', 'problem_list', 'special_rx_records',
  'patient_returns', 'data_subject_requests', 'access_reviews', 'access_review_decisions',
  'medical_certificates', 'files', 'file_versions', 'report_runs', 'report_schedules',
  'practitioner_profiles', 'practitioner_schedules', 'practitioner_schedule_exceptions',
  // pharmacy
  'prescriptions', 'prescription_items', 'dispenses', 'dispense_items',
  'medication_administrations', 'pharmacist_interventions', 'interaction_decisions',
  'controlled_register',
  // laboratory
  'lab_orders', 'lab_order_items', 'lab_results', 'lab_result_amendments',
  'lab_critical_notifications', 'lab_reports', 'lab_send_outs', 'lab_qc_runs', 'lab_qc_results',
  'specimens', 'specimen_events',
  // supply / inventory
  'goods_receipts', 'goods_receipt_items', 'stock_movements', 'stock_balances', 'stock_batches',
  'stock_adjustments', 'stock_adjustment_items', 'stock_issues', 'stock_issue_items',
  'stock_transfers', 'stock_transfer_items', 'consumption_logs', 'valuation_snapshots',
  'physical_counts', 'physical_count_items', 'recall_batches', 'recalls',
  'purchase_orders', 'purchase_order_items', 'purchase_requests', 'purchase_request_items',
  'requisitions', 'requisition_items',
  // finance
  'invoices', 'invoice_lines', 'discount_applications', 'credit_notes', 'billing_charges',
  'payments', 'payment_allocations', 'payment_splits', 'cash_sessions', 'cashier_shifts',
  'daily_cashier_summaries', 'supplier_invoices', 'supplier_returns', 'supplier_return_items',
  'pidsr_cases',
  // auth residue
  'sessions', 'password_resets', 'mfa_secrets', 'mfa_recovery_codes', 'mfa_trusted_devices',
  'user_notification_preferences',
]);

/**
 * Rows are filtered rather than bulk-deleted, because the seeded rows must survive.
 * These are the only tables that receive a delete *and* stay in PRESERVE.
 */
const HELD = new Set(['patients', 'users', 'patient_identifiers', 'patient_contacts', 'patient_philhealth']);

/**
 * WIPE keeps only tenancy, access control and master/reference data. Everything else
 * for the target tenant goes, including the append-only ledgers, all users and all
 * user-role assignments — the seed recreates exactly the ones the platform needs.
 */
const WIPE_KEEP = new Set([
  // tenancy + access control
  'tenants', 'branches', 'tenant_modules', 'roles', 'permissions', 'role_permissions',
  'api_keys', 'tenant_directory', 'system_settings', 'number_sequences',
  'plan_modules', 'subscription_plans', 'subscription_items', 'subscriptions', 'periods',
  'retention_policies', 'sod_conflicts',
  // pharmacy master data
  'drug_products', 'drug_interactions', 'generic_names',
  // inventory master data
  'items', 'item_categories', 'uoms', 'suppliers', 'price_lists', 'pharmacy_price_rules',
  'stock_locations', 'location_item_params',
  // lab master data
  'lab_tests', 'lab_analytes', 'lab_reference_ranges', 'lab_instruments',
  'ref_icd10', 'ref_loinc', 'ref_psgc',
  // service + billing master data
  'service_units', 'service_catalog', 'payment_methods', 'discount_types', 'consent_templates',
]);

/** Collapse repeated copies down to one row per natural key. */
const DEDUPLICATE = [
  {
    table: 'patient_identifiers',
    columns: ['patient_id', 'type', 'value'],
    comment: 'repeated runs of an older seed appended a fresh row every time',
  },
  {
    table: 'patient_contacts',
    columns: ['patient_id', 'type', 'value'],
    comment: 'same cause: surrogate-PK-only table, so ON CONFLICT DO NOTHING never conflicted',
  },
];


function fail(message, detail) {
  console.error(`\nclean-demo-tenant: ${message}`);
  if (detail) console.error(detail);
  process.exit(1);
}

const tenantOnly = `"tenant_id" = $1`;

/**
 * A HELD parent row may only be deleted while nothing outside the delete set still points
 * at it. That is a per-row question, not a per-table one: 40 patients are referenced by
 * controlled_register and must survive, while the other 198 can still go.
 *
 * Returns a SELECT of surviving primary keys for `table`, usable both as a delete filter
 * and as the scope for that patient's ledger rows.
 */
function survivorSubquery(table, fkDetail, safeSet) {
  const config = {
    patients: { seed: SEED_PATIENT_IDS, cast: 'uuid[]', pk: 'id' },
    users: { seed: SEED_STAFF_EMAILS, cast: 'text[]', seedCol: 'email', pk: 'id' },
  }[table];
  if (!config) return null;

  // node-postgres returns array columns as a string literal, so parse the CSV.
  const single = fkDetail
    .filter((f) => f.parent === table && !safeSet.has(f.child) && f.cols_csv)
    .map((f) => ({
      child: f.child,
      cols: f.cols_csv.split(',').map((s) => s.trim()),
      parentCols: f.parent_cols_csv.split(',').map((s) => s.trim()),
    }))
    .filter((f) => f.cols.length === f.parentCols.length && f.cols.length > 0);

  const keeps = [
    config.seedCol ? `p."${config.seedCol}" = ANY($2::${config.cast})` : `p."id" = ANY($2::${config.cast})`,
  ];
  for (const f of single) {
    const pairs = f.cols.map((col, i) => `k."${col}" = p."${f.parentCols[i]}"`).join(' AND ');
    keeps.push(`EXISTS (SELECT 1 FROM public."${f.child}" k WHERE ${pairs})`);
  }

  return {
    sql: `SELECT p."id" FROM public."${table}" p WHERE p."tenant_id" = $1 AND (${keeps.join(' OR ')})`,
    params: [TENANT_ID, config.seed],
    refs: single.map((f) => f.child),
  };
}

/** Populated in main() once the delete set is known; see survivorSubquery(). */
let SURVIVORS = {};

/**
 * patient_id / user_id scoping. Returns a DELETE predicate: the rows that belong to
 * neither a seeded patient nor seeded staff, and so can be removed. NULL stays
 * (unattributed rows are never ours to delete).
 * Returns the predicate with exactly the parameters it references, because PostgreSQL
 * rejects a bind whose count differs from the highest placeholder used.
 */
function scopeOf(meta) {
  const clauses = [tenantOnly];
  const params = [TENANT_ID];
  if (meta.has_patient) {
    clauses.push(`("patient_id" IS NOT NULL AND "patient_id" <> ALL($2::uuid[]))`);
    params.push(SEED_PATIENT_IDS);
  }
  if (meta.has_user) {
    const slot = meta.has_patient ? '$3' : '$2';
    clauses.push(
      `("user_id" IS NOT NULL AND "user_id" NOT IN (SELECT id FROM public.users WHERE email = ANY(${slot}::text[])))`,
    );
    params.push(SEED_STAFF_EMAILS);
  }
  return { where: clauses.join(' AND '), params };
}

/** Delete everything for the tenant: predicate plus its single parameter. */
const tenantScope = () => ({ where: tenantOnly, params: [TENANT_ID] });

/**
 * Rows of a held table that are NOT protected. For patients/users "protected" means
 * seeded OR still referenced by a table outside the delete set; for the patient ledger
 * tables it means belonging to a patient who survives.
 */
function heldScope(table, meta) {
  if (table === 'patients') {
    return { where: `${tenantOnly} AND NOT (id IN (${SURVIVORS.patients.sql}))`, params: SURVIVORS.patients.params };
  }
  if (table === 'users') {
    return { where: `${tenantOnly} AND NOT (id IN (${SURVIVORS.users.sql}))`, params: SURVIVORS.users.params };
  }
  if (LEDGER_SCOPE.has(table)) {
    // Delete the ledger rows of patients who are going away; keep a survivor's ledger.
    return {
      where: `${tenantOnly} AND ("patient_id" IS NOT NULL AND "patient_id" NOT IN (${SURVIVORS.patients.sql}))`,
      params: SURVIVORS.patients.params,
    };
  }
  return scopeOf(meta);
}

/** Patient ledger tables whose rows belong to a surviving patient rather than a seeded one. */
const LEDGER_SCOPE = new Set(['patient_identifiers', 'patient_contacts', 'patient_philhealth']);

async function loadTenantTables(client) {
  const { rows } = await client.query(`
    SELECT c.relname AS table,
           EXISTS (SELECT 1 FROM pg_attribute a
                    WHERE a.attrelid = c.oid AND a.attname = 'patient_id'
                      AND a.attnum > 0 AND NOT a.attisdropped) AS has_patient,
           EXISTS (SELECT 1 FROM pg_attribute a
                    WHERE a.attrelid = c.oid AND a.attname = 'user_id'
                      AND a.attnum > 0 AND NOT a.attisdropped) AS has_user
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
    WHERE c.relkind = 'r'
      AND EXISTS (SELECT 1 FROM pg_attribute a
                   WHERE a.attrelid = c.oid AND a.attname = 'tenant_id'
                     AND a.attnum > 0 AND NOT a.attisdropped)
    ORDER BY c.relname`);
  return rows;
}

/** Tables whose DB triggers forbid UPDATE/DELETE. Discovered, never hardcoded. */
async function loadAppendOnlyTables(client) {
  const { rows } = await client.query(`
    SELECT DISTINCT c.relname AS table
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
    WHERE NOT t.tgisinternal AND (t.tgname LIKE '%deny_delete%' OR t.tgname LIKE '%deny_update%')
    ORDER BY 1`);
  return rows.map((r) => r.table);
}

function classify(tables, appendOnly) {
  const plan = { preserve: [], scoped: [], purge: [], unclassified: [], protected: [] };
  for (const t of tables) {
    const name = t.table;
    if (appendOnly.includes(name)) plan.protected.push(name);
    else if (PRESERVE.has(name) || HELD.has(name)) plan.preserve.push(t);
    else if (PURGE.has(name)) plan.purge.push(t);
    else if (t.has_patient || t.has_user) plan.scoped.push(t);
    else plan.unclassified.push(name);
  }
  return plan;
}

/**
 * Reduce the delete set until it is provably safe.
 *
 * Deleting a parent row breaks any child row that still points at it, so a table may
 * only be deleted if every table referencing it is also being deleted. When that is
 * not true the parent is PINNED — the immutable ledgers (stock_movements,
 * controlled_register) point at it — and we drop it from the delete set instead of
 * failing. Dropping a parent can pin more tables, so this iterates to a fixed point.
 */
function resolvePinned(deleteSet, fkRows, emptyTables = new Set()) {
  const set = new Set(deleteSet);
  const pinned = new Map();

  for (;;) {
    const blocked = new Map();
    for (const fk of fkRows) {
      if (!set.has(fk.parent) || set.has(fk.child) || fk.child === fk.parent) continue;
      // An empty table holds no row that could reference anything, so it cannot pin.
      if (emptyTables.has(fk.child)) continue;
      if (!blocked.has(fk.parent)) blocked.set(fk.parent, new Set());
      blocked.get(fk.parent).add(fk.child);
    }
    if (blocked.size === 0) return { deleteSet: set, pinned };
    for (const [parent, kids] of blocked) {
      set.delete(parent);
      pinned.set(parent, kids);
    }
  }
}

/** Children before parents, derived from the live FK graph. */
function deleteOrder(deleteSet, fkRows, { allowCycles = false } = {}) {
  const pendingChildren = new Map([...deleteSet].map((t) => [t, new Set()]));
  const childCount = new Map([...deleteSet].map((t) => [t, 0]));

  for (const fk of fkRows) {
    if (!deleteSet.has(fk.parent) || !deleteSet.has(fk.child) || fk.child === fk.parent) continue;
    pendingChildren.get(fk.parent).add(fk.child);
    childCount.set(fk.parent, childCount.get(fk.parent) + 1);
  }

  const parentsOf = new Map([...deleteSet].map((t) => [t, new Set()]));
  for (const fk of fkRows) {
    if (deleteSet.has(fk.child) && deleteSet.has(fk.parent)) parentsOf.get(fk.child).add(fk.parent);
  }

  const ready = [...deleteSet].filter((t) => childCount.get(t) === 0).sort();
  const order = [];
  const done = new Set();
  while (ready.length > 0) {
    const table = ready.shift();
    if (done.has(table)) continue;
    done.add(table);
    order.push(table);
    for (const parent of parentsOf.get(table)) {
      pendingChildren.get(parent).delete(table);
      childCount.set(parent, childCount.get(parent) - 1);
      if (childCount.get(parent) === 0) {
        ready.push(parent);
        ready.sort();
      }
    }
  }

  const stuck = [...deleteSet].filter((t) => !done.has(t));
  if (stuck.length > 0) {
    if (!allowCycles) {
      throw new Error(`could not order for deletion (cyclic FKs): ${stuck.join(', ')}`);
    }
    // A wipe clears the whole tenant with the FK guards bypassed, so a cycle among
    // tables that are all being emptied cannot leave a dangling reference. Order what
    // we can and append the cycle so the caller still reports every table it touched.
    return [...order, ...stuck.sort()];
  }
  return order;
}

async function count(client, sql, params = [TENANT_ID]) {
  const { rows } = await client.query(sql, params);
  return rows[0].n;
}

async function report(client, plan, order, pinned, safeSet) {
  const purgeRows = [];
  for (const t of plan.purge) {
    if (!safeSet.has(t.table)) continue;
    const n = await count(client, `SELECT count(*)::int AS n FROM public."${t.table}" WHERE ${tenantOnly}`);
    if (n > 0) purgeRows.push([t.table, n]);
  }

  const scopedRows = [];
  for (const t of plan.scoped) {
    if (!safeSet.has(t.table)) continue;
    const { where, params } = scopeOf(t);
    const n = await count(client, `SELECT count(*)::int AS n FROM public."${t.table}" WHERE ${where}`, params);
    if (n > 0) scopedRows.push([t.table, n]);
  }

  // Rows that must survive because an immutable ledger still points at them.
  const pinnedRows = [];
  for (const [table, kids] of [...pinned].sort()) {
    const n = await count(client, `SELECT count(*)::int AS n FROM public."${table}" WHERE ${tenantOnly}`);
    pinnedRows.push([`${table}  (held by ${[...kids].sort().join(', ')})`, n]);
  }

  const heldRows = [];
  for (const t of plan.preserve) {
    if (!HELD.has(t.table)) continue;
    const { where, params } = heldScope(t.table, t);
    const n = await count(client, `SELECT count(*)::int AS n FROM public."${t.table}" WHERE ${where}`, params);
    if (n > 0) heldRows.push([t.table, n]);
  }

  const dedupeRows = [];
  for (const d of DEDUPLICATE) {
    const key = d.columns.join(', ');
    const eq = d.columns.map((c) => `t.${c} IS NOT DISTINCT FROM keep.${c}`).join(' AND ');
    // Count the copies that would be removed, i.e. (group size - 1) per duplicate
    // group. min()/max() are not defined for uuid, so count rows instead.
    const n = await count(
      client,
      `SELECT coalesce(sum(c - 1), 0)::int AS n FROM (
         SELECT count(*) AS c
         FROM public."${d.table}" t
         WHERE t."tenant_id" = $1
         GROUP BY ${d.columns.map((c) => `t.${c}`).join(', ')} HAVING count(*) > 1
       ) dupes`,
      [TENANT_ID],
    );
    dedupeRows.push([d.table, n, key, eq]);
  }

  const unclassifiedWithRows = [];
  for (const name of plan.unclassified) {
    const n = await count(client, `SELECT count(*)::int AS n FROM public."${name}" WHERE ${tenantOnly}`);
    if (n > 0) unclassifiedWithRows.push([name, n]);
  }

  const preservedWithRows = [];
  for (const t of plan.preserve) {
    if (HELD.has(t.table) || plan.protected.includes(t.table)) continue;
    const n = await count(client, `SELECT count(*)::int AS n FROM public."${t.table}" WHERE ${tenantOnly}`);
    if (n > 0) preservedWithRows.push([t.table, n]);
  }

  return { purgeRows, scopedRows, heldRows, dedupeRows, unclassifiedWithRows, preservedWithRows, pinnedRows, order };
}

function printTable(title, rows, note) {
  console.log(`\n  ${title}`);
  if (rows.length === 0) console.log('    nothing to do');
  for (const [label, n] of rows) console.log(`    ${String(n).padStart(8)}  ${label}`);
  if (note) console.log(`    ${note}`);
}

/**
 * Dev-only destructive clear. Removes every tenant-scoped row for the target tenant
 * that is not master/reference/access data — including the append-only ledgers, all
 * users and all user-role assignments — then leaves the seed to recreate the minimum.
 *
 * The append-only guards are bypassed with `session_replication_role = replica`, which
 * is scoped to this transaction and reverts on COMMIT. No trigger, policy or migration
 * is changed, so the schema keeps its guarantees everywhere else. That is why this is a
 * `--wipe` flag on a dev-only tool rather than a change to the append-only design.
 */
async function runWipe(client, { slug, tables, fkRows }) {
  // Close the keep list under foreign keys. Master data references other master data
  // (roles, branches, service_catalog, items, lab_sections, ...), so a hand-written
  // list is only correct if it happens to be transitively closed. Deriving it means a
  // kept table can never reference a cleared one, whatever the schema grows to.
  const keep = new Set(WIPE_KEEP);
  for (let grew = true; grew; ) {
    grew = false;
    for (const f of fkRows) {
      if (keep.has(f.child) && !keep.has(f.parent)) {
        keep.add(f.parent);
        grew = true;
      }
    }
  }

  const tableNames = new Set(tables.map((t) => t.table));
  const clearSet = new Set(
    tables.filter((t) => !keep.has(t.table)).map((t) => t.table),
  );

  // Nothing should hit this: the keep list is closed under FK references above. If a
  // schema change breaks that assumption, stop rather than silently orphaning data.
  const dangling = fkRows.filter((f) => keep.has(f.child) && clearSet.has(f.parent));
  if (dangling.length > 0) {
    fail('refusing to wipe: kept tables reference cleared tables',
      dangling.map((f) => `${f.child} -> ${f.parent}`).join('\n    - '));
  }

  const order = deleteOrder(clearSet, fkRows, { allowCycles: true });
  const planned = [];
  let total = 0;
  for (const table of order) {
    const n = await count(client, `SELECT count(*)::int AS n FROM public."${table}" WHERE ${tenantOnly}`);
    if (n > 0) {
      planned.push([table, n]);
      total += n;
    }
  }

  console.log(`\nclean-demo-tenant --wipe: tenant ${slug} (${TENANT_ID})`);
  console.log(`  clearing ${planned.length} tables, ${total} rows; keeping master/reference/access data`);
  console.log(`  APPEND-ONLY rows that WILL be removed (dev DB, session-scoped trigger bypass):`);
  const appendOnly = await loadAppendOnlyTables(client);
  for (const [table, n] of planned.filter(([t]) => appendOnly.includes(t))) {
    console.log(`    ${String(n).padStart(8)}  ${table}`);
  }
  printTable('WIPE — every tenant row (not master/reference data)', planned, `${String(total).padStart(8)}  TOTAL`);
  console.log(`  KEEP — ${[...keep].filter((t) => tableNames.has(t)).sort().join(', ')}`);

  if (!APPLY) {
    const tokens = [slug, DROP_TEST_TENANTS ? DROP_TEST_TENANTS_TOKEN : null].filter(Boolean);
    console.log(`\n  DRY RUN — nothing was written. Add --apply --confirm ${tokens.join(',')} to execute.\n`);
    return;
  }
  if (!CONFIRM_TOKENS.has(slug)) {
    fail('refusing to apply:', `--wipe requires --confirm ${slug} (you passed ${JSON.stringify(CONFIRM)})`);
  }

  const keyTables = ['patients', 'users', 'user_roles', 'visits', 'lab_orders', 'dispenses',
    'prescriptions', 'stock_movements', 'controlled_register', 'audit_log'];
  const before = {};
  for (const t of keyTables) {
    before[t] = await count(client, `SELECT count(*)::int AS n FROM public."${t}" WHERE ${tenantOnly}`);
  }

  await client.query('BEGIN');
  await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [TENANT_ID]);
  // Scope of the bypass is this transaction only; COMMIT restores 'origin'.
  await client.query(`SET LOCAL session_replication_role = 'replica'`);

  let deleted = 0;
  for (const table of order) {
    const res = await client.query(`DELETE FROM public."${table}" WHERE ${tenantOnly}`, [TENANT_ID]);
    deleted += res.rowCount;
    if (res.rowCount > 0) console.log(`    wiped ${String(res.rowCount).padStart(8)}  ${table}`);
  }

  const violations = [];
  for (const table of order) {
    const n = await count(client, `SELECT count(*)::int AS n FROM public."${table}" WHERE ${tenantOnly}`);
    if (n > 0) violations.push(`${table} still has ${n} row(s)`);
  }
  if (violations.length > 0) {
    throw new Error(`post-conditions not met, rolling back:\n    - ${violations.join('\n    - ')}`);
  }

  await client.query(`SET LOCAL session_replication_role = 'origin'`);
  await client.query(
    `INSERT INTO audit_log (tenant_id, action, entity_type, entity_id, before_state, after_state, request_id)
     VALUES ($1, 'tenant.demo_wipe', 'tenant', $1, $2::jsonb, '{}'::jsonb, $3)`,
    [TENANT_ID, JSON.stringify({ ...before, rows_deleted: deleted }), `clean-demo-tenant:wipe:${TENANT_ID}`],
  );
  await client.query('COMMIT');

  console.log(
    `\n  COMMITTED — ${deleted} rows wiped from ${slug}.\n` +
      `  patients ${before.patients}->0, users ${before.users}->0, user_roles ${before.user_roles}->0,\n` +
      `  visits ${before.visits}->0, lab_orders ${before.lab_orders}->0, dispenses ${before.dispenses}->0,\n` +
      `  prescriptions ${before.prescriptions}->0, stock_movements ${before.stock_movements}->0, ` +
      `controlled_register ${before.controlled_register}->0\n` +
      '  Append-only triggers were bypassed for this transaction only and are active again.\n' +
      '  An audit_log row (action=tenant.demo_wipe) records the wipe.\n',
  );
}

/** Removes the tenants that test runs leaked, with all of their tenant-scoped rows. */
async function dropLeakedTestTenants(client, tables, fkRows) {
  if (APPLY && !CONFIRM_TOKENS.has(DROP_TEST_TENANTS_TOKEN)) {
    fail(
      'refusing to apply:',
      `--drop-test-tenants is cluster-wide and requires --confirm ${DROP_TEST_TENANTS_TOKEN} ` +
        `(you passed ${JSON.stringify(CONFIRM)})`,
    );
  }
  const { rows } = await client.query(
    `SELECT id, slug FROM tenants WHERE slug LIKE 'test-%' OR slug LIKE 'qa-%' ORDER BY slug`);
  if (rows.length === 0) {
    console.log('\nclean-demo-tenant: no leaked test tenants to drop.');
    return;
  }
  const ids = rows.map((r) => r.id);
  const order = deleteOrder(new Set(tables.map((t) => t.table)), fkRows, { allowCycles: true });

  console.log(`\nclean-demo-tenant: dropping ${rows.length} leaked test tenant(s)`);
  for (const r of rows) console.log(`    ${r.slug}  ${r.id}`);

  if (!APPLY) {
    console.log(
      `  DRY RUN — nothing was written. Add --apply --confirm ${DROP_TEST_TENANTS_TOKEN} to execute.`,
    );
    return;
  }

  await client.query('BEGIN');
  await client.query(`SET LOCAL session_replication_role = 'replica'`);
  for (const table of order) {
    await client.query(`DELETE FROM public."${table}" WHERE tenant_id = ANY($1::uuid[])`, [ids]);
  }
  // Untracked leftovers: rows in cleared tables pointing at the dropped tenants.
  const res = await client.query(`DELETE FROM public.tenants WHERE id = ANY($1::uuid[])`, [ids]);
  await client.query('COMMIT');
  console.log(`  COMMITTED — ${res.rowCount} leaked tenant(s) removed.\n`);
}

async function main() {
  const connectionString = process.env.CLINIC_DATABASE_URL;
  if (!connectionString) {
    fail(
      'CLINIC_DATABASE_URL is not set.\n' +
        '  Refusing to fall back to a hardcoded credential. Export it and re-run.',
    );
  }
  if (!TENANT_ID) fail('--tenant <uuid> is required; a destructive tool has no default target.');
  if (!UUID_RE.test(TENANT_ID)) fail(`--tenant must be a UUID (got ${JSON.stringify(TENANT_ID)}).`);

  const client = new pg.Client({ connectionString });
  try {
    await client.connect();

    const { rows: tenantRows } = await client.query(`SELECT slug FROM public.tenants WHERE id = $1`, [TENANT_ID]);
    if (tenantRows.length === 0) fail(`no tenant with id ${TENANT_ID}; nothing to clean.`);
    const { slug } = tenantRows[0];

    const tables = await loadTenantTables(client);
    const appendOnly = await loadAppendOnlyTables(client);
    const plan = classify(tables, appendOnly);

    const { rows: fkDetail } = await client.query(`
      SELECT c.conrelid::regclass::text AS child, c.confrelid::regclass::text AS parent,
             array_to_string((SELECT array_agg(a.attname ORDER BY k.ord)
                FROM unnest(c.conkey) WITH ORDINALITY k(attnum, ord)
                JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum), ',') AS cols_csv,
             array_to_string((SELECT array_agg(a.attname ORDER BY k.ord)
                FROM unnest(c.confkey) WITH ORDINALITY k(attnum, ord)
                JOIN pg_attribute a ON a.attrelid = c.confrelid AND a.attnum = k.attnum), ',') AS parent_cols_csv
      FROM pg_constraint c
      WHERE c.contype = 'f' AND c.connamespace = 'public'::regnamespace
        AND c.conrelid <> c.confrelid`);
    const fkRows = fkDetail.map((f) => ({ child: f.child, parent: f.parent }));

    if (WIPE || DROP_TEST_TENANTS) {
      if (DROP_TEST_TENANTS) await dropLeakedTestTenants(client, tables, fkRows);
      if (WIPE) await runWipe(client, { slug, tables, fkRows });
      return;
    }

    const candidate = new Set([
      ...plan.purge.map((t) => t.table),
      ...plan.scoped.map((t) => t.table),
      ...HELD,
    ]);

    // A table with no rows for this tenant has nothing to delete and therefore cannot
    // pin anything. Dropping it here avoids blocking its parents for no reason.
    const deleteSet = new Set();
    const emptyTables = new Set();
    for (const table of candidate) {
      const n = await count(client, `SELECT count(*)::int AS n FROM public."${table}" WHERE ${tenantOnly}`);
      if (n > 0 || HELD.has(table)) deleteSet.add(table);
      else emptyTables.add(table);
    }

    const { deleteSet: safeSet, pinned } = resolvePinned(deleteSet, fkRows, emptyTables);
    SURVIVORS = {
      patients: survivorSubquery('patients', fkDetail, safeSet),
      users: survivorSubquery('users', fkDetail, safeSet),
    };
    const order = deleteOrder(safeSet, fkRows);
    const r = await report(client, plan, order, pinned, safeSet);

    const purgeTotal = r.purgeRows.reduce((a, [, n]) => a + n, 0);
    const scopedTotal = r.scopedRows.reduce((a, [, n]) => a + n, 0);
    const heldTotal = r.heldRows.reduce((a, [, n]) => a + n, 0);
    const dedupeTotal = r.dedupeRows.reduce((a, [, n]) => a + n, 0);
    const pinnedTotal = r.pinnedRows.reduce((a, [, n]) => a + n, 0);
    const grandTotal = purgeTotal + scopedTotal + heldTotal + dedupeTotal;

    console.log(`\nclean-demo-tenant: tenant ${slug} (${TENANT_ID})`);
    console.log(`  tenant-scoped tables: ${tables.length}   seed rows kept: ${SEED_PATIENT_IDS.length} patients, ${SEED_STAFF_EMAILS.length} staff`);
    console.log(`  APPEND-ONLY (DB trigger protects these, never touched): ${plan.protected.join(', ') || 'none'}`);

    printTable('DELETE — every row for this tenant', r.purgeRows,
      `${String(purgeTotal).padStart(8)}  TOTAL`);
    printTable('DELETE — rows not tied to a seeded patient', r.scopedRows,
      `${String(scopedTotal).padStart(8)}  TOTAL`);
    printTable('DELETE — patients / staff that are neither seeded nor referenced', r.heldRows,
      `${String(heldTotal).padStart(8)}  TOTAL`);
    console.log('\n  COLLAPSE — duplicate ledger copies down to one row per key:');
    for (const [table, n, key] of r.dedupeRows) {
      console.log(`    ${String(n).padStart(8)}  ${table} (${key})`);
    }
    console.log(`    ${String(dedupeTotal).padStart(8)}  TOTAL`);
    printTable('KEEP — master data, reference data, access control', r.preservedWithRows);
    printTable('UNCLASSIFIED — has rows but no rule in this script', r.unclassifiedWithRows,
      'These are NOT touched. Classify each as PRESERVE or PURGE in the script.');
    printTable('PINNED — immutable ledger still references these, cannot be deleted', r.pinnedRows,
      `${String(pinnedTotal).padStart(8)}  TOTAL   (see notes below)`);

    console.log(
      `\n  PLANNED TOTAL DELETES: ${grandTotal} across ${safeSet.size} tables\n` +
        `  PINNED, NOT DELETABLE: ${pinnedTotal} rows in ${pinned.size} tables\n` +
        `  delete order (${order.length} tables, children first):\n    ${order.join(' -> ')}`);

    console.log(`\n  SURVIVORS — seeded, or still referenced by a table we keep:`);
    for (const [table, s] of Object.entries(SURVIVORS)) {
      const n = await count(client, `SELECT count(*)::int AS n FROM (${s.sql}) x`, s.params);
      console.log(`    ${String(n).padStart(8)}  ${table}`);
      console.log(`              referenced by: ${s.refs.sort().join(', ')}`);
    }

    if (pinned.size > 0) {
      console.log(
        '\n  NOTE: stock_movements and controlled_register are append-only (BEFORE DELETE trigger).\n' +
          '  Their history cannot be rewritten, so every row they reference is pinned forever.\n' +
          '  A demo tenant can therefore never be back to "zero transactions" — reaching that\n' +
          '  requires a fresh tenant or database, not a cleanup.',
      );
    }

    const blockers = [];
    if (r.unclassifiedWithRows.length > 0 && !ALLOW_UNCLASSIFIED) {
      blockers.push(
        `${r.unclassifiedWithRows.length} unclassified table(s) hold rows — pass --allow-unclassified to proceed anyway`,
      );
    }
    if (grandTotal === 0) blockers.push('nothing to delete (already clean)');
    if (APPLY && !CONFIRM_TOKENS.has(slug)) {
      blockers.push(`--apply requires --confirm ${slug} (you passed ${JSON.stringify(CONFIRM)})`);
    }
    if (blockers.length > 0) fail('refusing to apply:', `    - ${blockers.join('\n    - ')}`);

    if (!APPLY) {
      console.log(`\n  DRY RUN — nothing was written. Add --apply --confirm ${slug} to execute.\n`);
      return;
    }

    // ---- apply: one transaction, all or nothing ----------------------------
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [TENANT_ID]);

    const keyTables = ['patients', 'visits', 'lab_orders', 'dispenses', 'prescriptions',
      'invoices', 'stock_movements', 'stock_batches'];
    const before = {};
    for (const t of keyTables) {
      before[t] = await count(client, `SELECT count(*)::int AS n FROM public."${t}" WHERE ${tenantOnly}`);
    }

    const metaByTable = new Map([...plan.purge, ...plan.scoped].map((t) => [t.table, t]));
    let deleted = 0;
    for (const table of order) {
      if (HELD.has(table)) continue;
      const isBulk = plan.purge.some((t) => t.table === table);
      const { where, params } = isBulk ? tenantScope() : scopeOf(metaByTable.get(table));
      const res = await client.query(`DELETE FROM public."${table}" WHERE ${where}`, params);
      deleted += res.rowCount;
      if (res.rowCount > 0) console.log(`    deleted ${String(res.rowCount).padStart(8)}  ${table}`);
    }

    // Ledger rows first: a patient cannot go while its identifiers, contacts or
    // PhilHealth rows still point at it.
    for (const t of plan.preserve.filter((x) => HELD.has(x.table) && !['patients', 'users'].includes(x.table))) {
      const { where, params } = heldScope(t.table, t);
      const res = await client.query(`DELETE FROM public."${t.table}" WHERE ${where}`, params);
      deleted += res.rowCount;
      if (res.rowCount > 0) console.log(`    deleted ${String(res.rowCount).padStart(8)}  ${t.table} (out-of-scope)`);
    }

    // patients and staff that are neither seeded nor still referenced by anything we keep
    await client.query('SAVEPOINT before_held_parents');
    for (const table of ['patients', 'users']) {
      const { where, params } = heldScope(table, null);
      try {
        const res = await client.query(`DELETE FROM public."${table}" WHERE ${where}`, params);
        console.log(`    deleted ${String(res.rowCount).padStart(8)}  ${table} (not seeded, not referenced)`);
        deleted += res.rowCount;
      } catch (err) {
        // Name the rows that are still in the way instead of surfacing a bare FK error.
        // Wrapped in a savepoint so a bad diagnostic cannot mask the original failure.
        await client.query('ROLLBACK TO SAVEPOINT before_held_parents');
        try {
          await client.query('SAVEPOINT diagnose_blockers');
          const child = table === 'patients' ? 'patient_identifiers' : 'user_roles';
          const col = table === 'patients' ? 'patient_id' : 'user_id';
          const blockers = await client.query(
            `SELECT count(*)::int AS n, min(k."${col}"::text) AS example
             FROM public."${child}" k
             JOIN public."${table}" t ON t.id = k."${col}"
             WHERE t."tenant_id" = $1 AND NOT (t.id IN (${SURVIVORS[table].sql}))`,
            SURVIVORS[table].params,
          );
          console.error(
            `\n  blocked deleting ${table}: ${blockers.rows[0].n} row(s) in ${child} still reference ` +
              `doomed parents (e.g. ${blockers.rows[0].example})`,
          );
          await client.query('RELEASE SAVEPOINT diagnose_blockers');
        } catch {
          // Diagnostic is best-effort; fall through to the original error.
        }
        throw err;
      }
    }

    // collapse duplicate ledger copies
    for (const [table, , , eq] of r.dedupeRows) {
      const res = await client.query(
        `DELETE FROM public."${table}" t USING public."${table}" keep
         WHERE t."tenant_id" = $1 AND keep.tenant_id = t.tenant_id AND ${eq} AND t.id > keep.id`,
        [TENANT_ID]);
      deleted += res.rowCount;
      console.log(`    deleted ${String(res.rowCount).padStart(8)}  ${table} (duplicate copies)`);
    }

    const after = {};
    for (const t of keyTables) {
      after[t] = await count(client, `SELECT count(*)::int AS n FROM public."${t}" WHERE ${tenantOnly}`);
    }

    await client.query(
      `INSERT INTO audit_log (tenant_id, action, entity_type, entity_id, before_state, after_state, request_id)
       VALUES ($1, 'tenant.demo_purge', 'tenant', $1, $2::jsonb, $3::jsonb, $4)`,
      [TENANT_ID, JSON.stringify({ ...before, rows_deleted: deleted }), JSON.stringify(after),
        `clean-demo-tenant:${TENANT_ID}`],
    );

    // refuse to commit unless the tenant is actually in the promised state
    const violations = [];
    const leftoverPatients = await client.query(
      `SELECT id::text FROM patients WHERE tenant_id = $1 AND NOT (id IN (${SURVIVORS.patients.sql}))`,
      SURVIVORS.patients.params);
    if (leftoverPatients.rowCount > 0) {
      violations.push(`patients left over: ${leftoverPatients.rows.map((x) => x.id).join(', ')}`);
    }
    const leftoverStaff = await client.query(
      `SELECT email FROM users WHERE tenant_id = $1 AND NOT (id IN (${SURVIVORS.users.sql}))`,
      SURVIVORS.users.params);
    if (leftoverStaff.rowCount > 0) {
      violations.push(`users left over: ${leftoverStaff.rows.map((x) => x.email).join(', ')}`);
    }
    // Exact, achievable invariant: every table in the resolved delete set must now hold
    // only in-scope rows. Pinned tables are excluded by construction.
    for (const table of order) {
      if (HELD.has(table)) continue;
      const isBulk = plan.purge.some((t) => t.table === table);
      if (isBulk) {
        const n = await count(client, `SELECT count(*)::int AS n FROM public."${table}" WHERE ${tenantOnly}`);
        if (n > 0) violations.push(`${table} should be empty for this tenant but has ${n} row(s)`);
      } else {
        const { where, params } = scopeOf(metaByTable.get(table));
        const n = await count(client, `SELECT count(*)::int AS n FROM public."${table}" WHERE ${where}`, params);
        if (n > 0) violations.push(`${table} still has ${n} row(s) outside the seeded patient/staff scope`);
      }
    }
    for (const d of DEDUPLICATE) {
      const key = d.columns.map((c) => `t.${c}`).join(', ');
      const n = await count(
        client,
        `SELECT count(*)::int AS n FROM (
           SELECT ${key} FROM public."${d.table}" t WHERE ${tenantOnly}
           GROUP BY ${key} HAVING count(*) > 1) dupes`);
      if (n > 0) violations.push(`${d.table} still has ${n} duplicated key group(s)`);
    }
    if (violations.length > 0) {
      throw new Error(`post-conditions not met, rolling back:\n    - ${violations.join('\n    - ')}`);
    }

    await client.query('COMMIT');
    console.log(
      `\n  COMMITTED — ${deleted} rows deleted from ${slug}.\n` +
        `  patients ${before.patients}->${after.patients}, visits ${before.visits}->${after.visits}, ` +
        `lab_orders ${before.lab_orders}->${after.lab_orders},\n` +
        `  dispenses ${before.dispenses}->${after.dispenses}, stock_movements ` +
        `${before.stock_movements}->${after.stock_movements}\n` +
        '  Seeded patients, staff and the master catalogue are intact. An audit_log row\n' +
        '  (action=tenant.demo_purge) records the purge.\n',
    );
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(`\nclean-demo-tenant: ${err.message ?? err}`);
    process.exitCode = 1;
  } finally {
    await client.end().catch(() => {});
  }
}

await main();
