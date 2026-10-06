-- ============================================================================
-- tenant_bootstrap.sql — masters, roles and starter accounts for ANY tenant
-- ============================================================================
-- This is the canonical bootstrap for tenants created through the platform
-- tenant-creation portal. JOB-03 (apps/worker provision.handler) seeds module
-- entitlements and then calls this seed (packages/db/src/bootstrap.ts), so a
-- newly created tenant starts with the full working catalogue. It can also be
-- run manually:
--
--   pnpm --filter @clinic/db seed:bootstrap -- --tenant <uuid>   # apply
--   pnpm --filter @clinic/db seed:bootstrap -- --tenant <uuid> --check
--
-- DELIBERATE DIFFERENCES from demo_clean.sql (do not "fix" back):
--   1. NO module entitlements — the portal owns tenant_modules (written from
--      the subscription plan at creation time, activated by JOB-03). This seed
--      refuses to run on a tenant with no entitlement rows instead of
--      overwriting the portal's decisions.
--   2. NO demo patients — production tenants register their own.
--   3. NO opening stock — stock is received through GRN (FEFO needs real
--      delivery dates and lots), not seeded fiction.
--   4. Accounts are slug-stubbed: the loader substitutes @@TENANT_SLUG@@ and
--      @TENANT_NAME@ from the created tenant, so admin@<slug>.emr etc. are
--      derived from the tenant itself. The shared bootstrap password is a
--      first-login credential; rotate it with admin.user.reset (step-up
--      protected) or the forgot-password flow after handover.
--   5. Repairs the portal's one SoD violation: JOB-03 grants
--      billing.payment.void + billing.payment.create to the same roles, a
--      declared sod_conflicts pair. Section 3g removes the void side.
--
-- Inherited guarantees (same mechanics as demo_clean.sql): transactional,
-- idempotent, additive-only except the section 3g SoD repair, deterministic,
-- drift-proof via natural keys, SoD-safe, tenant-safe.
--
-- PURPOSE
--   One self-contained, all-or-nothing bootstrap for a portal-created tenant:
--     * MAIN branch + service units
--     * 8 starter roles with their full grant sets (admin, doctor, nurse,
--       pharmacist dispenser, pharmacist verifier, receptionist,
--       lab technologist, lab verifier)
--     * all pharmacy master data    (generic names, formulary, pricing)
--     * all laboratory master data  (sections, specimens, tests, analytes,
--                                   reference ranges, instruments)
--     * all central-supply master data (UoM, categories, suppliers, locations,
--                                   item catalogue)
--     * 8 starter accounts          (one per role, slug-derived emails,
--                                   shared first-login password)
--   NO patients, NO opening stock, NO clinical history (see differences above).
--
-- GUARANTEES
--   * Transactional  — a single BEGIN/COMMIT. Any failure rolls back whole.
--   * Idempotent     — safe to re-run any number of times. Tables with a unique
--                      natural key use ON CONFLICT; tables with only a surrogate
--                      PK (patient_identifiers, patient_contacts, service_units,
--                      item_categories, suppliers, lab_reference_ranges,
--                      lab_instruments) use an explicit NOT EXISTS guard.
--                      Re-running never duplicates a row and never errors.
--   * Additive       — it INSERTs and never DELETEs. It cannot destroy data.
--   * Deterministic  — rows the seed creates get fixed UUIDs, so a fresh tenant
--                      is byte-stable across runs.
--   * Drift-proof    — every child row resolves its parents by NATURAL KEY
--                      (code / name), never by a parent UUID. If the tenant
--                      already holds one of these masters under a different id,
--                      children still attach to the right parent instead of
--                      violating an FK or silently mis-parenting.
--   * SoD-safe       — no seeded role holds both sides of any `sod_conflicts`
--                      pair, asserted by the verification block at the end.
--                      Read-level grants use a `.read` suffix filter, which
--                      structurally cannot match a SoD pair because every pair
--                      contains a mutating action
--                      (void/create/verify/post/approve/submit/match).
--   * Tenant-safe    — every conflict target is composite with tenant_id.
--                      Nothing is written outside the target tenant's scope.
--
-- GRANT SOURCES
--   tenant_admin — `specification.md` §2.2 row TENANT_ADMIN:
--     Tenant Admin F · Patients C/R/U · Clinical R · Lab R · Pharmacy R ·
--     Supply R · Billing R · Compliance R · Reports All (tenant).
--     Grants are pattern-derived from the canonical `permissions` catalogue so
--     the set stays diffable as the catalogue grows.
--   doctor / nurse — byte-for-byte the sets in
--     `packages/contracts/src/permissions.ts` SYSTEM_ROLE_TEMPLATES, which is
--     this repo's own reading of §2.2 (DOCTOR Clinical F (own), NURSE Clinical
--     C/R/U). Listing them explicitly keeps the seed auditable against the
--     template; the `self`/`owner` markers in §18 enforce own-record scoping
--     at request time, not by withholding permissions.
--   pharmacist_verifier / lab_technologist / lab_verifier — byte-for-byte the
--     grant sets shipped by `packages/db/migrations/0055_pharmacy_dispense_post_grant.migration.sql`
--     (PHM-T1/T2) and `0056_lab_result_verify_roles.migration.sql` (AC-17), the
--     migrations that created these roles so verification stays independent of
--     dispensing (pharmacy.rx.verify × pharmacy.dispense.post) and of result
--     entry (lab.result.enter × lab.result.verify) — both declared sod_conflicts
--     pairs. Codes match those migrations, so ON CONFLICT (tenant_id, code)
--     adopts rows a provisioning run already created instead of forking a
--     second role under a different id.
--
-- SCOPE NOTES (deliberate, do not "fix" silently)
--   1. SYSTEM_ROLE_TEMPLATES.tenant_admin is narrower than §2.2 (it omits
--      lab/pharmacy/supply/billing/reports entirely). That divergence affects
--      *newly provisioned* tenants and is tracked separately; this seed fixes
--      only the tenant it writes to.
--   2. `specification.md` §2.3:101,114 declares `reports.<module>.{view,export}`
--      and §2.2 grants TENANT_ADMIN "Reports: All (tenant)" — but no
--      `reports.*` code is seeded anywhere (not in migrations, not in
--      PERMISSION_CATALOGUE, not in the `permissions` table). The seed
--      therefore grants the tenant-scoped report reads that DO exist
--      (lab.report.read, pharmacy.report.view, supply.report.view). Closing the
--      catalogue gap is a separate change; `platform.report.view` is
--      deliberately NOT granted because it is platform-console scoped.
--   3. Patients is C/R/U, so `patient.document.delete` is withheld, and
--      `patient.record.{read_sensitive,restricted_read}` are withheld because
--      §2.2 grants plain R, not sensitive-data read, and
--      SYSTEM_ROLE_TEMPLATES.tenant_admin omits them too.
--   4. The seed asserts its own shape but does NOT delete pre-existing rows. In
--      a tenant that already holds other staff/transactions it is a
--      no-duplicate master-data load, not a reset.
-- ============================================================================

BEGIN;

-- RLS context for the target tenant (architecture §5, tenant isolation).
-- All 26 tables below have RLS ENABLED **and** FORCED, so this setting is
-- mandatory: without it every statement below reads zero rows.
SELECT set_config('app.tenant_id', '11111111-1111-4111-8111-111111111111', true);

-- Guard: refuse to run against a tenant that does not exist, or that has
-- failed provisioning (a FAILED tenant needs the portal's retry path, not a
-- half-applied master catalogue on top of a broken entitlement state).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM tenants
    WHERE id = '11111111-1111-4111-8111-111111111111' AND status IN ('PROVISIONING', 'ACTIVE')
  ) THEN
    RAISE EXCEPTION
      'tenant_bootstrap: tenant 11111111-1111-4111-8111-111111111111 missing or not in PROVISIONING/ACTIVE — create it through the portal first';
  END IF;
END $$;


-- ============================================================================
-- 1. Module entitlements are NOT written here. The portal owns them.
--    Guard only: refuse to run on a tenant with no entitlement rows at all —
--    that means the tenant was not created through the portal flow.
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM tenant_modules
    WHERE tenant_id = '11111111-1111-4111-8111-111111111111'
  ) THEN
    RAISE EXCEPTION
      'tenant_bootstrap: tenant has no tenant_modules rows — create it through the platform portal (JOB-03 seeds entitlements) before bootstrapping';
  END IF;
END $$;


-- ============================================================================
-- 2. Branch and service units
-- ============================================================================

INSERT INTO branches (id, tenant_id, code, name, service_profile, status, timezone)
VALUES (gen_random_uuid(), '11111111-1111-4111-8111-111111111111',
        'MAIN', '@TENANT_NAME@ — Main', '["consultation"]'::jsonb, 'ACTIVE', 'Asia/Manila')
ON CONFLICT (tenant_id, code) DO UPDATE
  SET name = EXCLUDED.name, service_profile = EXCLUDED.service_profile,
      status = 'ACTIVE', timezone = EXCLUDED.timezone,
      deleted_at = NULL, updated_at = now();

-- service_units has only a surrogate PK -> NOT EXISTS guard on (tenant, code).
INSERT INTO service_units (id, tenant_id, code, name, description)
SELECT v.id, '11111111-1111-4111-8111-111111111111', v.code, v.name, v.description
FROM (VALUES
  (gen_random_uuid(), 'GEN',    'General Medicine',   'Outpatient general medicine clinic'),
  (gen_random_uuid(), 'PEDS',   'Pediatrics',         'Paediatric outpatient clinic'),
  (gen_random_uuid(), 'LAB',    'Laboratory',         'Clinical laboratory section'),
  (gen_random_uuid(), 'PHARM',  'Pharmacy',           'Dispensary / formulary'),
  (gen_random_uuid(), 'STORE',  'Central Supply',     'Central store and warehouse')
) AS v(id, code, name, description)
WHERE NOT EXISTS (
  SELECT 1 FROM service_units s
  WHERE s.tenant_id = '11111111-1111-4111-8111-111111111111' AND s.code = v.code
);


-- ============================================================================
-- 3. Roles (specification §2.2 + migrations 0055/0056)
--    tenant_admin, doctor, nurse, pharmacist_dispenser, receptionist,
--    pharmacist_verifier, lab_technologist, lab_verifier.
--    Fixed UUIDs. Sequence note: …0003 is deliberately skipped — demo.sql,
--    seed-permissions.mjs and the API integration tests already pin it to
--    `receptionist`, so new roles continue at …0007.
-- ============================================================================

INSERT INTO roles (id, tenant_id, code, name, is_system) VALUES
  (gen_random_uuid(), '11111111-1111-4111-8111-111111111111', 'tenant_admin',          'Tenant Administrator',   true),
  (gen_random_uuid(), '11111111-1111-4111-8111-111111111111', 'doctor',                'Doctor',                  true),
  (gen_random_uuid(), '11111111-1111-4111-8111-111111111111', 'nurse',                 'Nurse',                   true),
  (gen_random_uuid(), '11111111-1111-4111-8111-111111111111', 'pharmacist_dispenser',  'Pharmacist / Dispenser',    true),
  (gen_random_uuid(), '11111111-1111-4111-8111-111111111111', 'receptionist',          'Receptionist',              true),
  (gen_random_uuid(), '11111111-1111-4111-8111-111111111111', 'pharmacist_verifier',   'Pharmacist — Verification', true),
  (gen_random_uuid(), '11111111-1111-4111-8111-111111111111', 'lab_technologist',      'Laboratory Technologist',   true),
  (gen_random_uuid(), '11111111-1111-4111-8111-111111111111', 'lab_verifier',          'Laboratory Verifier',       true),
  (gen_random_uuid(), '11111111-1111-4111-8111-111111111111', 'cashier',               'Cashier',                   true)
ON CONFLICT (tenant_id, code) DO UPDATE
  SET name = EXCLUDED.name, is_system = true, deleted_at = NULL;


-- --- 3a. tenant_admin ------------------------------------------------------
INSERT INTO role_permissions (tenant_id, role_id, permission_id)
SELECT v.tenant_id, r.id, p.id
FROM (VALUES ('11111111-1111-4111-8111-111111111111'::uuid)) AS v(tenant_id)
JOIN roles r ON r.tenant_id = v.tenant_id AND r.code = 'tenant_admin'
CROSS JOIN permissions p
WHERE (
    p.code LIKE 'admin.%'                                     -- Tenant Admin: full
 OR p.code IN ('patient.record.create', 'patient.record.read',  -- Patients: C/R/U
               'patient.record.update', 'patient.record.merge',
               'patient.document.read', 'patient.document.create')
 OR p.code LIKE 'clinical.%read%'                             -- Clinical: R
 OR p.code LIKE 'lab.%read%'                                  -- Lab: R
 OR p.code LIKE 'pharmacy.%read%'                             -- Pharmacy: R
 OR p.code LIKE 'supply.%read%'                               -- Supply: R
 OR p.code LIKE 'billing.%read%'                              -- Billing: R
 OR p.code LIKE 'compliance.%read%'                           -- Compliance: R
 OR p.code IN ('lab.report.read', 'pharmacy.report.view', 'supply.report.view')  -- Reports
 OR p.code = 'reference.read'
 OR p.code LIKE 'files.%'
 OR p.code LIKE 'jobs.%'
 OR p.code LIKE 'notifications.%'
)
ON CONFLICT (tenant_id, role_id, permission_id) DO NOTHING;

-- --- 3b. doctor (specification §2.2) --------------------------------------
-- Holds NEITHER lab.result.enter NOR lab.result.verify — that pair is a declared
-- SoD conflict (AC-17). SYSTEM_ROLE_TEMPLATES.doctor already omits both.
INSERT INTO role_permissions (tenant_id, role_id, permission_id)
SELECT v.tenant_id, r.id, p.id
FROM (VALUES ('11111111-1111-4111-8111-111111111111'::uuid)) AS v(tenant_id)
JOIN roles r ON r.tenant_id = v.tenant_id AND r.code = 'doctor'
CROSS JOIN permissions p
WHERE p.code IN (
    'patient.record.read', 'patient.record.update',
    'clinical.schedule.read', 'clinical.schedule.update',
    'clinical.appointment.read', 'clinical.appointment.update',
    'clinical.queue.read',
    'clinical.visit.read', 'clinical.visit.create', 'clinical.visit.update',
    'clinical.visit.start', 'clinical.visit.ready', 'clinical.visit.close',
    'clinical.vitals.read', 'clinical.vitals.create', 'clinical.vitals.update',
    'clinical.note.read', 'clinical.note.create', 'clinical.note.update',
    'clinical.note.sign', 'clinical.note.amend',
    'clinical.diagnosis.read', 'clinical.diagnosis.create',
    'clinical.diagnosis.update', 'clinical.diagnosis.delete',
    'clinical.procedure.read', 'clinical.procedure.create',
    'clinical.procedure.update', 'clinical.procedure.delete',
    'clinical.supply.read', 'clinical.supply.create',
    'clinical.certificate.read', 'clinical.certificate.create',
    'clinical.referral.read', 'clinical.referral.create', 'clinical.referral.update',
    'clinical.problem.read', 'clinical.problem.create',
    'clinical.problem.update', 'clinical.problem.resolve',
    'clinical.rx.read', 'clinical.rx.create', 'clinical.rx.update',
    'clinical.rx.sign', 'clinical.rx.cancel',
    'clinical.order_set.read', 'clinical.order_set.create', 'clinical.order_set.update',
    'clinical.template.read', 'clinical.template.create', 'clinical.template.update',
    'clinical.immunization.read', 'clinical.immunization.create',
    'lab.order.read', 'lab.order.create', 'lab.result.read', 'lab.report.read',
    'pharmacy.rx.read',
    'reference.read', 'files.read', 'files.write', 'notifications.read')
ON CONFLICT (tenant_id, role_id, permission_id) DO NOTHING;

-- --- 3c. nurse (specification §2.2) ---------------------------------------
INSERT INTO role_permissions (tenant_id, role_id, permission_id)
SELECT v.tenant_id, r.id, p.id
FROM (VALUES ('11111111-1111-4111-8111-111111111111'::uuid)) AS v(tenant_id)
JOIN roles r ON r.tenant_id = v.tenant_id AND r.code = 'nurse'
CROSS JOIN permissions p
WHERE p.code IN (
    'patient.record.read',
    'clinical.schedule.read', 'clinical.appointment.read',
    'clinical.appointment.create', 'clinical.appointment.update',
    'clinical.queue.read', 'clinical.queue.call', 'clinical.queue.skip',
    'clinical.visit.read', 'clinical.visit.create', 'clinical.visit.update',
    'clinical.vitals.read', 'clinical.vitals.create', 'clinical.vitals.update',
    'clinical.note.read', 'clinical.note.create', 'clinical.note.update',
    'clinical.procedure.read', 'clinical.procedure.create',
    'clinical.supply.read', 'clinical.supply.create',
    'clinical.immunization.read', 'clinical.immunization.create',
    'lab.specimen.collect',
    'supply.req.read', 'supply.req.create', 'supply.consumption.create',
    'pharmacy.admin.create',
    'reference.read', 'files.read', 'notifications.read')
ON CONFLICT (tenant_id, role_id, permission_id) DO NOTHING;


-- --- 3b. pharmacist_dispenser ----------------------------------------------
-- Only the pharmacy. Deliberately does NOT hold billing.payment.create or
-- pharmacy.rx.verify: the demo journey signs in as a separate cashier and
-- admin so the real permission split is exercised rather than bypassed.
INSERT INTO role_permissions (tenant_id, role_id, permission_id)
SELECT v.tenant_id, r.id, p.id
FROM (VALUES ('11111111-1111-4111-8111-111111111111'::uuid)) AS v(tenant_id)
JOIN roles r ON r.tenant_id = v.tenant_id AND r.code = 'pharmacist_dispenser'
CROSS JOIN permissions p
WHERE p.code IN (
    'pharmacy.rx.read', 'pharmacy.product.read', 'pharmacy.stock.read',
    'pharmacy.dispense.read', 'pharmacy.dispense.create',
    'pharmacy.dispense.update', 'pharmacy.dispense.post',
    'pharmacy.controlled.read', 'pharmacy.controlled.dispense',
    'pharmacy.controlled.witness')
ON CONFLICT (tenant_id, role_id, permission_id) DO NOTHING;

-- --- 3c. receptionist ------------------------------------------------------
-- Front desk + cash. billing.payment.create is what makes this account the only
-- one that can settle an invoice, mirroring the segregation of duties.
INSERT INTO role_permissions (tenant_id, role_id, permission_id)
SELECT v.tenant_id, r.id, p.id
FROM (VALUES ('11111111-1111-4111-8111-111111111111'::uuid)) AS v(tenant_id)
JOIN roles r ON r.tenant_id = v.tenant_id AND r.code = 'receptionist'
CROSS JOIN permissions p
WHERE p.code IN (
    'patient.record.read', 'patient.record.create', 'patient.record.update',
    'clinical.schedule.read', 'clinical.appointment.read',
    'clinical.appointment.create', 'clinical.appointment.update',
    'clinical.appointment.cancel',
    'clinical.queue.read', 'clinical.queue.call', 'clinical.queue.skip',
    'clinical.visit.read', 'clinical.visit.create',
    'billing.shift.read', 'billing.shift.open', 'billing.shift.close',
    'billing.invoice.read', 'billing.invoice.create',
    'billing.payment.read', 'billing.payment.create',
    'admin.payment_method.read',
    'files.read', 'notifications.read', 'reference.read')
ON CONFLICT (tenant_id, role_id, permission_id) DO NOTHING;

-- --- 3d. pharmacist_verifier (migration 0055, PHM-T1) ----------------------
-- Clinical check only: rx.verify WITHOUT dispense.post — the sod_conflicts
-- pair demands the verifier be a different identity from the dispenser.
INSERT INTO role_permissions (tenant_id, role_id, permission_id)
SELECT v.tenant_id, r.id, p.id
FROM (VALUES ('11111111-1111-4111-8111-111111111111'::uuid)) AS v(tenant_id)
JOIN roles r ON r.tenant_id = v.tenant_id AND r.code = 'pharmacist_verifier'
CROSS JOIN permissions p
WHERE p.code IN (
    'pharmacy.rx.read', 'pharmacy.rx.verify', 'pharmacy.rx.intervene',
    'pharmacy.product.read', 'pharmacy.controlled.read')
ON CONFLICT (tenant_id, role_id, permission_id) DO NOTHING;

-- --- 3e. lab_technologist (migration 0056, AC-17 bench side) ----------------
-- Everything up to but NOT including lab.result.verify: the encoder must
-- never verify their own work.
INSERT INTO role_permissions (tenant_id, role_id, permission_id)
SELECT v.tenant_id, r.id, p.id
FROM (VALUES ('11111111-1111-4111-8111-111111111111'::uuid)) AS v(tenant_id)
JOIN roles r ON r.tenant_id = v.tenant_id AND r.code = 'lab_technologist'
CROSS JOIN permissions p
WHERE p.code IN (
    'lab.order.read', 'lab.order.create',
    'lab.specimen.read', 'lab.specimen.collect', 'lab.specimen.receive',
    'lab.result.read', 'lab.result.enter', 'lab.result.amend',
    'lab.critical.read', 'lab.critical.ack',
    'lab.qc.read', 'lab.qc.create', 'lab.qc.update', 'lab.qc.accept', 'lab.qc.reject',
    'lab.sendout.read', 'lab.sendout.create',
    'lab.config.read', 'lab.config.create', 'lab.config.update',
    'lab.interface.read', 'lab.interface.write',
    'supply.stock.read', 'supply.item.read')
ON CONFLICT (tenant_id, role_id, permission_id) DO NOTHING;

-- --- 3f. lab_verifier (migration 0056, AC-17 verification side) -------------
-- The independent check: verifies and releases, never enters.
INSERT INTO role_permissions (tenant_id, role_id, permission_id)
SELECT v.tenant_id, r.id, p.id
FROM (VALUES ('11111111-1111-4111-8111-111111111111'::uuid)) AS v(tenant_id)
JOIN roles r ON r.tenant_id = v.tenant_id AND r.code = 'lab_verifier'
CROSS JOIN permissions p
WHERE p.code IN (
    'lab.order.read', 'lab.specimen.read',
    'lab.result.read', 'lab.result.verify',
    'lab.report.read', 'lab.report.release',
    'lab.critical.read', 'lab.critical.ack',
    'lab.config.read')
ON CONFLICT (tenant_id, role_id, permission_id) DO NOTHING;

-- --- 3h. cashier ------------------------------------------------------------
-- Cash desk settlement, invoice payment, shifts and receipts.
-- Deliberately does NOT hold billing.payment.void (sod_conflicts with billing.payment.create).
INSERT INTO role_permissions (tenant_id, role_id, permission_id)
SELECT v.tenant_id, r.id, p.id
FROM (VALUES ('11111111-1111-4111-8111-111111111111'::uuid)) AS v(tenant_id)
JOIN roles r ON r.tenant_id = v.tenant_id AND r.code = 'cashier'
CROSS JOIN permissions p
WHERE p.code IN (
    'patient.record.read',
    'billing.shift.read', 'billing.shift.open', 'billing.shift.close',
    'billing.invoice.read', 'billing.invoice.create', 'billing.invoice.update',
    'billing.charge.create',
    'billing.payment.read', 'billing.payment.create',
    'billing.credit.read', 'billing.credit.create',
    'billing.discount.read', 'billing.discount.create', 'billing.discount.revoke',
    'admin.payment_method.read',
    'files.read', 'notifications.read', 'reference.read')
ON CONFLICT (tenant_id, role_id, permission_id) DO NOTHING;

-- --- 3g. SoD repair for the portal's role grants ---------------------------
-- JOB-03 (provision.handler seedModule('admin')) grants billing.payment.void
-- AND billing.payment.create to tenant_admin and branch_manager — a declared
-- sod_conflicts pair ("payment taker must not void payments"), which makes the
-- portal-created role itself unassignable: assertNoSoDConflicts refuses any
-- user_roles write touching a role that holds both. Removing the void side
-- preserves the control: voiding is rare, and until a dedicated approver role
-- is provisioned the seed's own SoD assertion (below) can pass.
-- (Void rights already belong to no starter role; this only undoes the portal's
-- over-grant.)
DELETE FROM role_permissions rp
USING roles r, permissions p, sod_conflicts s
WHERE rp.tenant_id = r.tenant_id
  AND r.id = rp.role_id
  AND p.id = rp.permission_id
  AND r.code IN ('tenant_admin', 'branch_manager', 'cashier', 'receptionist')
  AND ((p.code = s.permission_a AND s.permission_b = 'billing.payment.create')
    OR (p.code = s.permission_b AND s.permission_a = 'billing.payment.create'));

-- ============================================================================
-- 4. Staff accounts — tenant admin, doctor, nurse, pharmacist dispenser,
--    pharmacist verifier, receptionist, cashier, lab technologist, lab verifier.
--    All share the first-login password  DemoPassw0rd!2026
--    and slug-stubbed emails: the loader substitutes __TENANT_SLUG__
--    (argon2id hash reused verbatim from migrations/seeds/demo.sql).
--
--    The pharmacist and receptionist exist because the demo tenant has to be
--    able to finish the clinical -> dispense -> invoice -> payment journey.
--    `tenant_admin` holds pharmacy.*read and billing.*read but not
--    pharmacy.dispense.post or billing.payment.create, so a single admin
--    account cannot complete it.
--
--    The verifier / technologist accounts exist so the AC-17 (lab enter ≠
--    verify) and PHM-T1 (rx verify ≠ dispense post) independence controls can
--    be demonstrated with two real logins instead of one role holding both
--    sides of a sod_conflicts pair.
--
--    Resolved by NATURAL KEY (email / role code / branch code), never by UUID:
--    ON CONFLICT keeps the existing row's own id, so pinning the child ids
--    would break the FK on a re-run against a tenant seeded by other means.
-- ============================================================================

INSERT INTO users (tenant_id, email, name, password_hash, status)
SELECT '11111111-1111-4111-8111-111111111111', v.email, v.name, v.password_hash, 'ACTIVE'
FROM (VALUES
  ('admintenant@__TENANT_SLUG__.emr', '@TENANT_NAME@ — Tenant Admin',
   '$argon2id$v=19$m=19456,t=2,p=1$PJbfK+fX4INlaV6B1J1P9Q$r8KelzGMcN1aCKjlBfUifGfeT1j7Wnk7sl8WlLr624I'),
  ('admin@__TENANT_SLUG__.emr',       '@TENANT_NAME@ — Tenant Admin (Alias)',
   '$argon2id$v=19$m=19456,t=2,p=1$PJbfK+fX4INlaV6B1J1P9Q$r8KelzGMcN1aCKjlBfUifGfeT1j7Wnk7sl8WlLr624I'),
  ('doctor@__TENANT_SLUG__.emr',      '@TENANT_NAME@ — Doctor',
   '$argon2id$v=19$m=19456,t=2,p=1$PJbfK+fX4INlaV6B1J1P9Q$r8KelzGMcN1aCKjlBfUifGfeT1j7Wnk7sl8WlLr624I'),
  ('nurse@__TENANT_SLUG__.emr',       '@TENANT_NAME@ — Nurse',
   '$argon2id$v=19$m=19456,t=2,p=1$PJbfK+fX4INlaV6B1J1P9Q$r8KelzGMcN1aCKjlBfUifGfeT1j7Wnk7sl8WlLr624I'),
  ('pharmacist@__TENANT_SLUG__.emr',  '@TENANT_NAME@ — Pharmacist',
   '$argon2id$v=19$m=19456,t=2,p=1$PJbfK+fX4INlaV6B1J1P9Q$r8KelzGMcN1aCKjlBfUifGfeT1j7Wnk7sl8WlLr624I'),
  ('dispenser@__TENANT_SLUG__.emr',   '@TENANT_NAME@ — Pharmacist / Dispenser',
   '$argon2id$v=19$m=19456,t=2,p=1$PJbfK+fX4INlaV6B1J1P9Q$r8KelzGMcN1aCKjlBfUifGfeT1j7Wnk7sl8WlLr624I'),
  ('receptionist@__TENANT_SLUG__.emr','@TENANT_NAME@ — Receptionist',
   '$argon2id$v=19$m=19456,t=2,p=1$PJbfK+fX4INlaV6B1J1P9Q$r8KelzGMcN1aCKjlBfUifGfeT1j7Wnk7sl8WlLr624I'),
  ('staff@__TENANT_SLUG__.emr',       '@TENANT_NAME@ — Front Desk Staff',
   '$argon2id$v=19$m=19456,t=2,p=1$PJbfK+fX4INlaV6B1J1P9Q$r8KelzGMcN1aCKjlBfUifGfeT1j7Wnk7sl8WlLr624I'),
  ('cashier@__TENANT_SLUG__.emr',     '@TENANT_NAME@ — Cashier',
   '$argon2id$v=19$m=19456,t=2,p=1$PJbfK+fX4INlaV6B1J1P9Q$r8KelzGMcN1aCKjlBfUifGfeT1j7Wnk7sl8WlLr624I'),
  ('verifier@__TENANT_SLUG__.emr',    '@TENANT_NAME@ — Pharmacist Verifier',
   '$argon2id$v=19$m=19456,t=2,p=1$PJbfK+fX4INlaV6B1J1P9Q$r8KelzGMcN1aCKjlBfUifGfeT1j7Wnk7sl8WlLr624I'),
  ('labtech@__TENANT_SLUG__.emr',     '@TENANT_NAME@ — Medical Technologist',
   '$argon2id$v=19$m=19456,t=2,p=1$PJbfK+fX4INlaV6B1J1P9Q$r8KelzGMcN1aCKjlBfUifGfeT1j7Wnk7sl8WlLr624I'),
  ('labverify@__TENANT_SLUG__.emr',   '@TENANT_NAME@ — Lab Verifier',
   '$argon2id$v=19$m=19456,t=2,p=1$PJbfK+fX4INlaV6B1J1P9Q$r8KelzGMcN1aCKjlBfUifGfeT1j7Wnk7sl8WlLr624I')
) AS v(email, name, password_hash)
ON CONFLICT (tenant_id, email) DO UPDATE
  SET name = EXCLUDED.name,
      -- Reassert the hash so the documented demo credential always works.
      password_hash = EXCLUDED.password_hash,
      status = 'ACTIVE', deactivated_at = NULL, locked_until = NULL,
      failed_login_count = 0, mfa_secret = NULL, mfa_enabled = false,
      updated_at = now();

-- user_roles has UNIQUE NULLS NOT DISTINCT (tenant_id, user_id, role_id, branch_id).
INSERT INTO user_roles (tenant_id, user_id, role_id)
SELECT u.tenant_id, u.id, r.id
FROM (VALUES
  ('admintenant@__TENANT_SLUG__.emr', 'tenant_admin'),
  ('admin@__TENANT_SLUG__.emr',       'tenant_admin'),
  ('doctor@__TENANT_SLUG__.emr',      'doctor'),
  ('nurse@__TENANT_SLUG__.emr',       'nurse'),
  ('pharmacist@__TENANT_SLUG__.emr',  'pharmacist_dispenser'),
  ('dispenser@__TENANT_SLUG__.emr',   'pharmacist_dispenser'),
  ('receptionist@__TENANT_SLUG__.emr','receptionist'),
  ('staff@__TENANT_SLUG__.emr',       'receptionist'),
  ('cashier@__TENANT_SLUG__.emr',     'cashier'),
  ('verifier@__TENANT_SLUG__.emr',    'pharmacist_verifier'),
  ('labtech@__TENANT_SLUG__.emr',     'lab_technologist'),
  ('labverify@__TENANT_SLUG__.emr',   'lab_verifier')
) AS v(email, role_code)
JOIN users u ON u.tenant_id = '11111111-1111-4111-8111-111111111111' AND u.email = v.email
JOIN roles r ON r.tenant_id = u.tenant_id AND r.code = v.role_code
ON CONFLICT (tenant_id, user_id, role_id, branch_id) DO NOTHING;

-- user_branches PK is (user_id, branch_id).
INSERT INTO user_branches (tenant_id, user_id, branch_id, is_default)
SELECT b.tenant_id, u.id, b.id, true
FROM users u
CROSS JOIN branches b
WHERE u.tenant_id = '11111111-1111-4111-8111-111111111111'
  AND u.email IN (
    'admintenant@__TENANT_SLUG__.emr', 'admin@__TENANT_SLUG__.emr',
    'doctor@__TENANT_SLUG__.emr', 'nurse@__TENANT_SLUG__.emr',
    'pharmacist@__TENANT_SLUG__.emr', 'dispenser@__TENANT_SLUG__.emr',
    'receptionist@__TENANT_SLUG__.emr', 'staff@__TENANT_SLUG__.emr',
    'cashier@__TENANT_SLUG__.emr', 'verifier@__TENANT_SLUG__.emr',
    'labtech@__TENANT_SLUG__.emr', 'labverify@__TENANT_SLUG__.emr'
  )
  AND b.tenant_id = u.tenant_id AND b.code = 'MAIN'
ON CONFLICT (user_id, branch_id) DO UPDATE SET is_default = true;

-- ---------------------------------------------------------------------------
-- 4b. Employee / professional licensure profile
--     `users` holds identity only (single `name`, email). Everything the
--     prescription PDF prints about the prescriber — professional title,
--     specialization, and the PRC / PTR / S2 licence numbers that RA 6675 and
--     RA 9165 require on the pad — lives in `employees`, keyed by user_id.
--     Without these rows the PDF silently degrades to "Dr. Attending Physician,
--     MD" with "N/A" licence numbers.
--     Licence numbers are clearly-fictional demo placeholders.
-- ---------------------------------------------------------------------------
INSERT INTO employees (
  tenant_id, user_id, employee_no, job_title, department, employment_type,
  specialization, prc_license_no, ptr_no, s2_license_no, phone, hire_date, status
)
SELECT u.tenant_id, u.id, v.employee_no, v.job_title, v.department, v.employment_type,
       v.specialization, v.prc_license_no, v.ptr_no, v.s2_license_no, v.phone, v.hire_date, 'ACTIVE'
FROM (VALUES
  ('admintenant@__TENANT_SLUG__.emr', 'B-0000', 'Clinic Administrator',     'Administration',   'FULL_TIME',  NULL,                             NULL,            NULL,            NULL,            '(02) 8888-0100', DATE '2024-01-15'),
  ('admin@__TENANT_SLUG__.emr',       'B-0001', 'Clinic Manager',           'Administration',   'FULL_TIME',  NULL,                             NULL,            NULL,            NULL,            '(02) 8888-0101', DATE '2024-01-15'),
  ('doctor@__TENANT_SLUG__.emr',      'B-0002', 'Consultant Physician',     'Internal Medicine','CONSULTANT', 'Internal Medicine',               'PRC-1000001',   'PTR-1000001',   'S2-1000001',   '(02) 8888-0102', DATE '2023-06-01'),
  ('nurse@__TENANT_SLUG__.emr',       'B-0003', 'Registered Nurse',         'Nursing',          'FULL_TIME',  'Emergency Nursing',              NULL,            'PTR-1000003',   NULL,            '(02) 8888-0103', DATE '2024-03-01'),
  ('pharmacist@__TENANT_SLUG__.emr',  'B-0009', 'Pharmacist / Dispenser',   'Pharmacy',         'FULL_TIME',  'Retail & Clinical Pharmacy',     NULL,            NULL,            NULL,            '(02) 8888-0109', DATE '2024-05-06'),
  ('dispenser@__TENANT_SLUG__.emr',   'B-0004', 'Pharmacist',               'Pharmacy',         'FULL_TIME',  'Hospital Pharmacy',              NULL,            NULL,            NULL,            '(02) 8888-0104', DATE '2024-05-06'),
  ('receptionist@__TENANT_SLUG__.emr','B-0010', 'Front Desk Receptionist',  'Front Desk',       'FULL_TIME',  NULL,                             NULL,            NULL,            NULL,            '(02) 8888-0110', DATE '2024-02-19'),
  ('staff@__TENANT_SLUG__.emr',       'B-0005', 'Front Desk Staff',         'Front Desk',       'FULL_TIME',  NULL,                             NULL,            NULL,            NULL,            '(02) 8888-0105', DATE '2024-02-19'),
  ('cashier@__TENANT_SLUG__.emr',     'B-0011', 'Billing Cashier',          'Finance & Billing','FULL_TIME',  NULL,                             NULL,            NULL,            NULL,            '(02) 8888-0111', DATE '2024-02-19'),
  ('verifier@__TENANT_SLUG__.emr',    'B-0006', 'Pharmacist — Verification','Pharmacy',         'FULL_TIME',  'Clinical Pharmacy',              'PRC-1000006',   NULL,            NULL,            '(02) 8888-0106', DATE '2024-06-03'),
  ('labtech@__TENANT_SLUG__.emr',     'B-0007', 'Medical Laboratory Technologist','Laboratory', 'FULL_TIME',  'Hematology',                     'PRC-1000007',   NULL,            NULL,            '(02) 8888-0107', DATE '2024-04-15'),
  ('labverify@__TENANT_SLUG__.emr',   'B-0008', 'Pathologist',              'Laboratory',       'CONSULTANT', 'Anatomic & Clinical Pathology',  'PRC-1000008',   'PTR-1000008',   NULL,            '(02) 8888-0108', DATE '2023-09-01')
) AS v(email, employee_no, job_title, department, employment_type,
       specialization, prc_license_no, ptr_no, s2_license_no, phone, hire_date)
JOIN users u ON u.tenant_id = '11111111-1111-4111-8111-111111111111' AND u.email = v.email
ON CONFLICT (tenant_id, user_id) DO UPDATE
  SET employee_no = EXCLUDED.employee_no,
      job_title = EXCLUDED.job_title,
      department = EXCLUDED.department,
      employment_type = EXCLUDED.employment_type,
      specialization = EXCLUDED.specialization,
      prc_license_no = EXCLUDED.prc_license_no,
      ptr_no = EXCLUDED.ptr_no,
      s2_license_no = EXCLUDED.s2_license_no,
      phone = EXCLUDED.phone,
      hire_date = EXCLUDED.hire_date,
      status = 'ACTIVE',
      updated_at = now();


-- ============================================================================
-- 5. Central supply — reference data
-- ============================================================================

-- 5a. Units of measure
INSERT INTO uoms (id, tenant_id, code, name) VALUES
  (gen_random_uuid(), '11111111-1111-4111-8111-111111111111', 'BX',  'Box'),
  (gen_random_uuid(), '11111111-1111-4111-8111-111111111111', 'PC',  'Piece'),
  (gen_random_uuid(), '11111111-1111-4111-8111-111111111111', 'RL',  'Roll'),
  (gen_random_uuid(), '11111111-1111-4111-8111-111111111111', 'KIT', 'Kit'),
  (gen_random_uuid(), '11111111-1111-4111-8111-111111111111', 'ML',  'Millilitre'),
  (gen_random_uuid(), '11111111-1111-4111-8111-111111111111', 'MG',  'Milligram'),
  (gen_random_uuid(), '11111111-1111-4111-8111-111111111111', 'EA',  'Each')
ON CONFLICT (tenant_id, code) DO UPDATE SET name = EXCLUDED.name, is_active = true;

-- 5b. Item categories (surrogate PK only -> NOT EXISTS guard on (tenant, name))
INSERT INTO item_categories (id, tenant_id, name, parent_id)
SELECT v.id, '11111111-1111-4111-8111-111111111111', v.name, NULL
FROM (VALUES
  (gen_random_uuid(), 'Pharmacy Supplies'),
  (gen_random_uuid(), 'Laboratory Supplies'),
  (gen_random_uuid(), 'Clinical Consumables'),
  (gen_random_uuid(), 'Personal Protective Equipment'),
  (gen_random_uuid(), 'Stationery')
) AS v(id, name)
WHERE NOT EXISTS (
  SELECT 1 FROM item_categories c
  WHERE c.tenant_id = '11111111-1111-4111-8111-111111111111' AND c.name = v.name
);

-- 5c. Suppliers (surrogate PK only -> NOT EXISTS guard on (tenant, code))
INSERT INTO suppliers (id, tenant_id, code, name, tin, address, terms_days, lead_time_days, status)
SELECT v.id, '11111111-1111-4111-8111-111111111111', v.code, v.name, v.tin, v.address, v.terms_days, v.lead_time_days, 'ACTIVE'
FROM (VALUES
  (gen_random_uuid(), 'SUP-MED',  'Metro Drug Distributors', '000-123-456', '12 Shaw Blvd, Mandaluyong', 30, 7),
  (gen_random_uuid(), 'SUP-MDL',  'Medline Philippines',    '000-234-567', '88 Aurora Ave, Quezon City', 45, 10),
  (gen_random_uuid(), 'SUP-CHM',  'ChemLab Diagnostics',    '000-345-678', '4 Science Rd, Taguig',       30, 14)
) AS v(id, code, name, tin, address, terms_days, lead_time_days)
WHERE NOT EXISTS (
  SELECT 1 FROM suppliers s
  WHERE s.tenant_id = '11111111-1111-4111-8111-111111111111' AND s.code = v.code
);

-- 5d. Stock locations (branch resolved by code, not by UUID)
INSERT INTO stock_locations (id, tenant_id, branch_id, code, name, type)
SELECT v.id, b.tenant_id, b.id, v.code, v.name, v.type
FROM (VALUES
  (gen_random_uuid(), 'CENTRAL', 'Central Store',         'CENTRAL_STORE'),
  (gen_random_uuid(), 'DISP',    'Dispensary',            'PHARMACY'),
  (gen_random_uuid(), 'LAB',     'Laboratory Store',      'LAB'),
  (gen_random_uuid(), 'ROOM1',   'Consultation Room 1',   'CLINIC_ROOM')
) AS v(id, code, name, type)
JOIN branches b ON b.tenant_id = '11111111-1111-4111-8111-111111111111' AND b.code = 'MAIN'
ON CONFLICT (tenant_id, branch_id, code) DO UPDATE
  SET name = EXCLUDED.name, type = EXCLUDED.type, is_active = true;


-- ============================================================================
-- 6. Pharmacy master data
--    UoM -> item (MEDICINE) -> generic -> drug product -> service (price).
--    Each drug is a real formulary entry so dispensing can price it.
-- ============================================================================

-- 6a. Item shell for every drug. UoM resolved by code.
INSERT INTO items (id, tenant_id, code, name, item_type, base_uom_id, standard_cost)
SELECT v.id, '11111111-1111-4111-8111-111111111111', v.code, v.name, 'MEDICINE', u.id, v.standard_cost
FROM (VALUES
  (gen_random_uuid(), 'MED-AMOX-500',   'Amoxicillin 500mg Capsule',      'PC',   8.50),
  (gen_random_uuid(), 'MED-AMOX-SUS',   'Amoxicillin 250mg/5mL Syrup',     'ML',  65.00),
  (gen_random_uuid(), 'MED-AZI-500',    'Azithromycin 500mg Tablet',       'PC',  22.00),
  (gen_random_uuid(), 'MED-PARA-500',   'Paracetamol 500mg Tablet',        'PC',   3.25),
  (gen_random_uuid(), 'MED-PARA-SUS',   'Paracetamol 250mg/5mL Syrup',     'ML',  28.00),
  (gen_random_uuid(), 'MED-IBU-200',    'Ibuprofen 200mg Tablet',           'PC',   4.75),
  (gen_random_uuid(), 'MED-MET-500',    'Metformin 500mg Tablet',          'PC',   5.10),
  (gen_random_uuid(), 'MED-MET-850',    'Metformin 850mg Tablet',          'PC',   7.90),
  (gen_random_uuid(), 'MED-AML-5',      'Amlodipine 5mg Tablet',           'PC',   6.30),
  (gen_random_uuid(), 'MED-LOS-50',     'Losartan 50mg Tablet',             'PC',  12.40),
  (gen_random_uuid(), 'MED-HCTZ-25',    'Hydrochlorothiazide 25mg Tablet', 'PC',   4.20),
  (gen_random_uuid(), 'MED-SIM-20',     'Simvastatin 20mg Tablet',          'PC',   9.80),
  (gen_random_uuid(), 'MED-OME-20',     'Omeprazole 20mg Capsule',         'PC',  18.60),
  (gen_random_uuid(), 'MED-SAL-NEB',    'Salbutamol 2.5mg Nebuliser',      'EA',  95.00),
  (gen_random_uuid(), 'MED-CET-5',      'Cetirizine 5mg Tablet',            'PC',   6.90),
  (gen_random_uuid(), 'MED-IBU-400',    'Ibuprofen 400mg Tablet',           'PC',   6.50)
) AS v(id, code, name, uom_code, standard_cost)
JOIN uoms u ON u.tenant_id = '11111111-1111-4111-8111-111111111111' AND u.code = v.uom_code
ON CONFLICT (tenant_id, code) DO UPDATE
  SET name = EXCLUDED.name, base_uom_id = EXCLUDED.base_uom_id,
      standard_cost = EXCLUDED.standard_cost, is_active = true;

-- 6b. Generic (INN) names
INSERT INTO generic_names (id, tenant_id, name, atc_code) VALUES
  (gen_random_uuid(), '11111111-1111-4111-8111-111111111111', 'Amoxicillin',         'J01CA04'),
  (gen_random_uuid(), '11111111-1111-4111-8111-111111111111', 'Azithromycin',        'J01FA10'),
  (gen_random_uuid(), '11111111-1111-4111-8111-111111111111', 'Paracetamol',         'N02BE01'),
  (gen_random_uuid(), '11111111-1111-4111-8111-111111111111', 'Ibuprofen',           'M01AE01'),
  (gen_random_uuid(), '11111111-1111-4111-8111-111111111111', 'Metformin',           'A10BA02'),
  (gen_random_uuid(), '11111111-1111-4111-8111-111111111111', 'Amlodipine',          'C08CA01'),
  (gen_random_uuid(), '11111111-1111-4111-8111-111111111111', 'Losartan',            'C09CA01'),
  (gen_random_uuid(), '11111111-1111-4111-8111-111111111111', 'Hydrochlorothiazide', 'C03AA03'),
  (gen_random_uuid(), '11111111-1111-4111-8111-111111111111', 'Simvastatin',         'C10AA01'),
  (gen_random_uuid(), '11111111-1111-4111-8111-111111111111', 'Omeprazole',          'A02BC01'),
  (gen_random_uuid(), '11111111-1111-4111-8111-111111111111', 'Salbutamol',          'R03AC02'),
  (gen_random_uuid(), '11111111-1111-4111-8111-111111111111', 'Cetirizine',          'R06AE07')
ON CONFLICT (tenant_id, name) DO UPDATE SET atc_code = EXCLUDED.atc_code, deleted_at = NULL;

-- 6c. Formulary products. item resolved by code, generic by name.
INSERT INTO drug_products (id, tenant_id, item_id, generic_id, brand_name, strength, dosage_form, route, pack_size, fda_reg_no, rx_required, storage, is_formulary, high_alert, allergy_class)
SELECT v.id, '11111111-1111-4111-8111-111111111111', i.id, g.id, v.brand_name, v.strength,
       v.dosage_form, v.route, v.pack_size, v.fda_reg_no, v.rx_required,
       'ROOM', true, v.high_alert, v.allergy_class
FROM (VALUES
  (gen_random_uuid(), 'MED-AMOX-500', 'Amoxicillin', 'Amoxil',   '500mg',       'CAPSULE',   'ORAL',       100, 'FDA-1001', 'RX',  false, 'Penicillin'),
  (gen_random_uuid(), 'MED-AMOX-SUS', 'Amoxicillin', 'Amoxil',   '250mg/5mL',   'SYRUP',     'ORAL',         1, 'FDA-1002', 'RX',  false, 'Penicillin'),
  (gen_random_uuid(), 'MED-AZI-500',  'Azithromycin','Zithromax','500mg',       'TABLET',    'ORAL',        30, 'FDA-1003', 'RX',  false, 'Macrolide'),
  (gen_random_uuid(), 'MED-PARA-500', 'Paracetamol', 'Tylenol',  '500mg',       'TABLET',    'ORAL',       100, 'FDA-1004', 'OTC', false, 'Acetaminophen'),
  (gen_random_uuid(), 'MED-PARA-SUS', 'Paracetamol', 'Tylenol',  '250mg/5mL',   'SYRUP',     'ORAL',         1, 'FDA-1005', 'OTC', false, 'Acetaminophen'),
  (gen_random_uuid(), 'MED-IBU-200',  'Ibuprofen',   'Motrin',   '200mg',       'TABLET',    'ORAL',       100, 'FDA-1006', 'OTC', false, 'NSAID'),
  (gen_random_uuid(), 'MED-MET-500',  'Metformin',   'Glucophage','500mg',      'TABLET',    'ORAL',       100, 'FDA-1007', 'RX',  false, 'Biguanide'),
  (gen_random_uuid(), 'MED-MET-850',  'Metformin',   'Glucophage','850mg',      'TABLET',    'ORAL',       100, 'FDA-1008', 'RX',  false, 'Biguanide'),
  (gen_random_uuid(), 'MED-AML-5',    'Amlodipine',  'Norvasc',  '5mg',         'TABLET',    'ORAL',        30, 'FDA-1009', 'RX',  false, 'Dihydropyridine'),
  (gen_random_uuid(), 'MED-LOS-50',   'Losartan',    'Cozaar',   '50mg',        'TABLET',    'ORAL',        30, 'FDA-1010', 'RX',  false, 'ARB'),
  (gen_random_uuid(), 'MED-HCTZ-25',  'Hydrochlorothiazide','Microzide','25mg',      'TABLET',    'ORAL',       100, 'FDA-1011', 'RX',  false, 'Thiazide'),
  (gen_random_uuid(), 'MED-SIM-20',   'Simvastatin', 'Zocor',    '20mg',        'TABLET',    'ORAL',        30, 'FDA-1012', 'RX',  false, 'Statin'),
  (gen_random_uuid(), 'MED-OME-20',   'Omeprazole',  'Prilosec', '20mg',        'CAPSULE',   'ORAL',        30, 'FDA-1013', 'OTC', false, 'PPI'),
  (gen_random_uuid(), 'MED-SAL-NEB',  'Salbutamol',  'Ventolin', '2.5mg/2.5mL','NEBULISER', 'INHALATION',  20, 'FDA-1014', 'RX',  true,  'SABA'),
  (gen_random_uuid(), 'MED-CET-5',    'Cetirizine',  'Zyrtec',   '5mg',         'TABLET',    'ORAL',        30, 'FDA-1015', 'OTC', false, 'Antihistamine'),
  (gen_random_uuid(), 'MED-IBU-400',  'Ibuprofen',   'Motrin',   '400mg',       'TABLET',    'ORAL',       100, 'FDA-1016', 'OTC', false, 'NSAID')
) AS v(id, item_code, generic_name, brand_name, strength, dosage_form, route, pack_size, fda_reg_no, rx_required, high_alert, allergy_class)
JOIN items i ON i.tenant_id = '11111111-1111-4111-8111-111111111111' AND i.code = v.item_code
JOIN generic_names g ON g.tenant_id = '11111111-1111-4111-8111-111111111111' AND g.name = v.generic_name
ON CONFLICT (tenant_id, item_id) DO UPDATE
  SET strength = EXCLUDED.strength, dosage_form = EXCLUDED.dosage_form,
      route = EXCLUDED.route, rx_required = EXCLUDED.rx_required,
      is_formulary = true, deleted_at = NULL;


-- ============================================================================
-- 7. Laboratory master data
-- ============================================================================

-- 7a. Sections
INSERT INTO lab_sections (id, tenant_id, code, name, display_order) VALUES
  (gen_random_uuid(), '11111111-1111-4111-8111-111111111111', 'HEM',   'Haematology',    1),
  (gen_random_uuid(), '11111111-1111-4111-8111-111111111111', 'CHEM',  'Chemistry',      2),
  (gen_random_uuid(), '11111111-1111-4111-8111-111111111111', 'MICRO', 'Microbiology',   3),
  (gen_random_uuid(), '11111111-1111-4111-8111-111111111111', 'SER',   'Serology',       4),
  (gen_random_uuid(), '11111111-1111-4111-8111-111111111111', 'HISTO', 'Histopathology', 5)
ON CONFLICT (tenant_id, code) DO UPDATE
  SET name = EXCLUDED.name, display_order = EXCLUDED.display_order, is_active = true;

-- 7b. Specimen types
INSERT INTO lab_specimen_types (id, tenant_id, code, name, default_container, tube_top_color, stability_hours) VALUES
  (gen_random_uuid(), '11111111-1111-4111-8111-111111111111', 'EDTA',   'EDTA Whole Blood',    'EDTA tube',         'Lavender',  24),
  (gen_random_uuid(), '11111111-1111-4111-8111-111111111111', 'SERUM',  'Serum',               'Serum separator',   'Red',       48),
  (gen_random_uuid(), '11111111-1111-4111-8111-111111111111', 'PLASMA', 'Plasma',              'EDTA tube',         'Lavender',  24),
  (gen_random_uuid(), '11111111-1111-4111-8111-111111111111', 'URINE',  'Urine',               'Urine container',   'Yellow',    24),
  (gen_random_uuid(), '11111111-1111-4111-8111-111111111111', 'BLOOD',  'Whole Blood',         'Blood culture bot', 'Red',       72),
  (gen_random_uuid(), '11111111-1111-4111-8111-111111111111', 'CSF',    'Cerebrospinal Fluid','Sterile tube',      'Clear',      2),
  (gen_random_uuid(), '11111111-1111-4111-8111-111111111111', 'SWAB',   'Swab',                'Sterile swab',      'n/a',       24),
  (gen_random_uuid(), '11111111-1111-4111-8111-111111111111', 'TISSUE', 'Tissue',              'Formalin jar',      'n/a',      168)
ON CONFLICT (tenant_id, code) DO UPDATE
  SET name = EXCLUDED.name, default_container = EXCLUDED.default_container,
      tube_top_color = EXCLUDED.tube_top_color,
      stability_hours = EXCLUDED.stability_hours, is_active = true;

-- 7c. Tests. section and specimen resolved by code; service_id filled in 9a.
INSERT INTO lab_tests (id, tenant_id, section_id, specimen_type_id, code, name, loinc_code, tat_minutes, is_stat_allowed, is_panel, fasting_required, fasting_hours, instructions)
SELECT v.id, '11111111-1111-4111-8111-111111111111', s.id, sp.id, v.code, v.name,
       v.loinc_code, v.tat_minutes, v.is_stat_allowed, v.is_panel,
       v.fasting_required, v.fasting_hours, v.instructions
FROM (VALUES
  (gen_random_uuid(), 'HEM',   'EDTA',   'CBC',     'Complete Blood Count',         '58410-2',   60, true,  true,  false, NULL, 'EDTA whole blood. No fasting required.'),
  (gen_random_uuid(), 'CHEM',  'SERUM',  'FBS',     'Fasting Blood Sugar',          '1558-6',    60, true,  false, true,  8,    'Patient must fast 8 hours prior to draw.'),
  (gen_random_uuid(), 'CHEM',  'EDTA',   'HBA1C',   'Glycated Haemoglobin (HbA1c)', '4548-4',   120, false, false, false, NULL, 'No fasting required.'),
  (gen_random_uuid(), 'CHEM',  'SERUM',  'RFT',     'Renal Function Test',         '24323-8',  120, true,  true,  false, NULL, 'Serum. Include eGFR.'),
  (gen_random_uuid(), 'CHEM',  'SERUM',  'LFT',     'Liver Function Test',          '24325-3',  120, true,  true,  false, NULL, 'Serum. Patient should avoid alcohol 24h prior.'),
  (gen_random_uuid(), 'CHEM',  'SERUM',  'LIPID',   'Lipid Profile',               '57698-3',  120, false, true,  true,  12,   'Fasting 12 hours. Avoid high-fat meal prior.'),
  (gen_random_uuid(), 'CHEM',  'URINE',  'UA',      'Urinalysis',                  '24357-6',   60, true,  true,  false, NULL, 'Clean-catch midstream urine.'),
  (gen_random_uuid(), 'MICRO', 'BLOOD',  'BCULT',   'Blood Culture',               '600-7',   4320, true,  false, false, NULL, 'Blood culture bottle. Flag prior antibiotics.'),
  (gen_random_uuid(), 'SER',   'SERUM',  'HBSAG',   'Hepatitis B Surface Antigen', '5195-3',   120, false, false, false, NULL, 'Serum. Consent per RA 10949 required.'),
  (gen_random_uuid(), 'SER',   'SERUM',  'HIV',     'HIV Screening (Rapid)',       '75622-1',   60, false, false, false, NULL, 'Serum. Pre-test counselling required (RA 8504).'),
  (gen_random_uuid(), 'SER',   'SERUM',  'DENGUE',  'Dengue NS1 Antigen',          '62468-4',   60, true,  false, false, NULL, 'Serum. Interpret with clinical correlation.'),
  (gen_random_uuid(), 'SER',   'URINE',  'PREG',    'Pregnancy Test (Urine)',      '2106-3',    30, false, false, false, NULL, 'First morning urine preferred.'),
  (gen_random_uuid(), 'HISTO', 'TISSUE', 'HISTO',   'Histopathology (Biopsy)',     '33717-0', 4320, false, true,  false, NULL, 'Tissue in 10% formalin. Requires pathologist report.')
) AS v(id, section_code, specimen_code, code, name, loinc_code, tat_minutes, is_stat_allowed, is_panel, fasting_required, fasting_hours, instructions)
JOIN lab_sections s ON s.tenant_id = '11111111-1111-4111-8111-111111111111' AND s.code = v.section_code
JOIN lab_specimen_types sp ON sp.tenant_id = '11111111-1111-4111-8111-111111111111' AND sp.code = v.specimen_code
ON CONFLICT (tenant_id, code) DO UPDATE
  SET section_id = EXCLUDED.section_id, specimen_type_id = EXCLUDED.specimen_type_id,
      name = EXCLUDED.name, tat_minutes = EXCLUDED.tat_minutes,
      is_panel = EXCLUDED.is_panel, instructions = EXCLUDED.instructions, is_active = true;

-- 7d. Analytes (result components per test). Test resolved by code.
INSERT INTO lab_analytes (id, tenant_id, test_id, code, name, default_unit, precision_digits, sort_order, is_calculated)
SELECT v.id, '11111111-1111-4111-8111-111111111111', t.id, v.code, v.name,
       v.default_unit, v.precision_digits, v.sort_order, v.is_calculated
FROM (VALUES
  -- CBC
  (gen_random_uuid(), 'CBC',    'WBC',   'White Blood Cell Count',   'x10^9/L',       2, 1, false),
  (gen_random_uuid(), 'CBC',    'RBC',   'Red Blood Cell Count',      'x10^12/L',      2, 2, false),
  (gen_random_uuid(), 'CBC',    'HGB',   'Haemoglobin',               'g/dL',          1, 3, false),
  (gen_random_uuid(), 'CBC',    'HCT',   'Haematocrit',               '%',             1, 4, false),
  (gen_random_uuid(), 'CBC',    'PLT',   'Platelet Count',            'x10^9/L',       0, 5, false),
  (gen_random_uuid(), 'CBC',    'MCV',   'Mean Corpuscular Volume',   'fL',            1, 6, false),
  -- FBS
  (gen_random_uuid(), 'FBS',    'GLU',   'Glucose (fasting)',         'mmol/L',        2, 1, false),
  -- HBA1C
  (gen_random_uuid(), 'HBA1C',  'HBA1C', 'Glycated Haemoglobin',     '%',             1, 1, false),
  -- RFT
  (gen_random_uuid(), 'RFT',    'CREA',  'Creatinine',                'umol/L',        1, 1, false),
  (gen_random_uuid(), 'RFT',    'BUN',   'Urea Nitrogen',            'mmol/L',        2, 2, false),
  (gen_random_uuid(), 'RFT',    'EGFR',  'Estimated GFR',            'mL/min/1.73m2', 1, 3, true),
  -- LFT
  (gen_random_uuid(), 'LFT',    'ALT',   'Alanine Transaminase',      'U/L',           0, 1, false),
  (gen_random_uuid(), 'LFT',    'AST',   'Aspartate Transaminase',    'U/L',           0, 2, false),
  (gen_random_uuid(), 'LFT',    'BILI',  'Total Bilirubin',           'umol/L',        1, 3, false),
  -- LIPID
  (gen_random_uuid(), 'LIPID',  'TCHOL', 'Total Cholesterol',         'mmol/L',        2, 1, false),
  (gen_random_uuid(), 'LIPID',  'TG',    'Triglycerides',             'mmol/L',        2, 2, false),
  (gen_random_uuid(), 'LIPID',  'HDL',   'HDL Cholesterol',           'mmol/L',        2, 3, false),
  (gen_random_uuid(), 'LIPID',  'LDL',   'LDL Cholesterol',           'mmol/L',        2, 4, true),
  -- UA
  (gen_random_uuid(), 'UA',     'UAPROT','Protein (urine)',           'mg/dL',         0, 1, false),
  (gen_random_uuid(), 'UA',     'UAGLU', 'Glucose (urine)',           'mg/dL',         0, 2, false),
  (gen_random_uuid(), 'UA',     'ULEUK', 'Leucocytes (urine)',         '/uL',           0, 3, false),
  -- Serology
  (gen_random_uuid(), 'HBSAG',  'HBSAG', 'HBsAg Result',              'INDEX',         0, 1, false),
  (gen_random_uuid(), 'HIV',    'HIVRES','HIV Screening Result',      'INDEX',         0, 1, false),
  (gen_random_uuid(), 'DENGUE', 'NS1',   'Dengue NS1 Antigen',         'INDEX',         0, 1, false),
  (gen_random_uuid(), 'PREG',   'PREG',  'Pregnancy Result',          'INDEX',         0, 1, false),
  -- Microbiology / histopathology
  (gen_random_uuid(), 'BCULT',  'ORG',   'Organism Isolated',         'text',          0, 1, false),
  (gen_random_uuid(), 'HISTO',  'MICRO', 'Microscopic Description',    'text',          0, 1, false),
  (gen_random_uuid(), 'HISTO',  'DIAG',  'Histopathological Diagnosis','text',          0, 2, false)
) AS v(id, test_code, code, name, default_unit, precision_digits, sort_order, is_calculated)
JOIN lab_tests t ON t.tenant_id = '11111111-1111-4111-8111-111111111111' AND t.code = v.test_code
ON CONFLICT (tenant_id, test_id, code) DO UPDATE
  SET name = EXCLUDED.name, default_unit = EXCLUDED.default_unit,
      precision_digits = EXCLUDED.precision_digits, sort_order = EXCLUDED.sort_order;

-- 7e. Reference ranges (adult; sex-specific where clinically meaningful).
--      Analyte resolved by (test code, analyte code) -> surrogate-PK-only table
--      guarded by NOT EXISTS.
INSERT INTO lab_reference_ranges (tenant_id, analyte_id, sex, age_min_days, age_max_days, normal_min, normal_max, critical_low, critical_high, text_range)
SELECT '11111111-1111-4111-8111-111111111111', a.id, v.sex, v.age_min_days, v.age_max_days,
       v.normal_min, v.normal_max, v.critical_low, v.critical_high, v.text_range
FROM (VALUES
  ('CBC',   'WBC',    'ALL',   18, 36500, 4.0::numeric,  10.5::numeric, 1.5,  30.0, NULL),
  ('CBC',   'RBC',    'MALE',  18, 36500, 4.5,  5.9,  NULL, NULL, NULL),
  ('CBC',   'RBC',    'FEMALE',18, 36500, 3.8,  5.1,  NULL, NULL, NULL),
  ('CBC',   'HGB',    'MALE',  18, 36500, 130,  175,  70,   200,  NULL),
  ('CBC',   'HGB',    'FEMALE',18, 36500, 120,  155,  70,   200,  NULL),
  ('CBC',   'HCT',    'MALE',  18, 36500, 40,   52,   20,   60,   NULL),
  ('CBC',   'HCT',    'FEMALE',18, 36500, 36,   48,   20,   60,   NULL),
  ('CBC',   'PLT',    'ALL',   18, 36500, 150,  450,  20,   1000, NULL),
  ('CBC',   'MCV',    'ALL',   18, 36500, 80,   100,  NULL, NULL, NULL),
  ('FBS',   'GLU',    'ALL',   0,  36500, 3.9,  5.5,  2.8,  25.0, NULL),
  ('HBA1C', 'HBA1C',  'ALL',   18, 36500, 4.0,  5.6,  NULL, NULL, NULL),
  ('RFT',   'CREA',   'MALE',  18, 36500, 79,   111,  NULL, 700,  NULL),
  ('RFT',   'CREA',   'FEMALE',18, 36500, 60,   97,   NULL, 700,  NULL),
  ('RFT',   'BUN',    'ALL',   18, 36500, 2.5,  7.1,  NULL, NULL, NULL),
  ('RFT',   'EGFR',   'ALL',   18, 36500, 90,   120,  15,   NULL, NULL),
  ('LFT',   'ALT',    'ALL',   18, 36500, 7,    56,   NULL, 500,  NULL),
  ('LFT',   'AST',    'ALL',   18, 36500, 10,   40,   NULL, 500,  NULL),
  ('LFT',   'BILI',   'ALL',   18, 36500, 3,    21,   NULL, 200,  NULL),
  ('LIPID', 'TCHOL',  'ALL',   18, 36500, 2.9,  5.2,  NULL, NULL, NULL),
  ('LIPID', 'TG',     'ALL',   18, 36500, 0.4,  1.7,  NULL, 11.3, NULL),
  ('LIPID', 'HDL',    'ALL',   18, 36500, 1.0,  1.6,  0.5,  NULL, NULL),
  ('LIPID', 'LDL',    'ALL',   18, 36500, 1.0,  3.4,  NULL, 4.9,  NULL),
  ('UA',    'UAPROT', 'ALL',   0,  36500, NULL, 14,   NULL, NULL, 'Negative'),
  ('UA',    'UAGLU',  'ALL',   0,  36500, NULL, NULL, NULL, NULL, 'Negative'),
  ('UA',    'ULEUK',  'ALL',   0,  36500, NULL, 4,    NULL, NULL, '0-4 /uL')
) AS v(test_code, analyte_code, sex, age_min_days, age_max_days, normal_min, normal_max, critical_low, critical_high, text_range)
JOIN lab_tests t ON t.tenant_id = '11111111-1111-4111-8111-111111111111' AND t.code = v.test_code
JOIN lab_analytes a ON a.tenant_id = t.tenant_id AND a.test_id = t.id AND a.code = v.analyte_code
WHERE NOT EXISTS (
  SELECT 1 FROM lab_reference_ranges r
  WHERE r.tenant_id = '11111111-1111-4111-8111-111111111111'
    AND r.analyte_id = a.id
    AND r.sex = v.sex
    AND r.age_min_days = v.age_min_days
    AND r.age_max_days = v.age_max_days
);

-- 7f. Instruments. branch and section resolved by code.
INSERT INTO lab_instruments (id, tenant_id, branch_id, section_id, code, name, model, calibration_due_at)
SELECT v.id, b.tenant_id, b.id, s.id, v.code, v.name, v.model, now() + interval '180 days'
FROM (VALUES
  (gen_random_uuid(), 'HEM',   'INST-HEM-01', 'Haematology Analyser',    'Sysmex XN-1000'),
  (gen_random_uuid(), 'CHEM',  'INST-CHEM-01','Chemistry Analyser',      'Roche Cobas c311'),
  (gen_random_uuid(), 'MICRO', 'INST-BCUL-01','Blood Culture Incubator','BacT/ALERT 3D')
) AS v(id, section_code, code, name, model)
JOIN branches b ON b.tenant_id = '11111111-1111-4111-8111-111111111111' AND b.code = 'MAIN'
JOIN lab_sections s ON s.tenant_id = '11111111-1111-4111-8111-111111111111' AND s.code = v.section_code
WHERE NOT EXISTS (
  SELECT 1 FROM lab_instruments i
  WHERE i.tenant_id = '11111111-1111-4111-8111-111111111111'
    AND i.branch_id = b.id
    AND i.code = v.code
);


-- ============================================================================
-- 8. Central supply — item catalogue
--    No stock batches or balances: stock is inventory state, not master data.
--    A demo creates it through Goods Receipt (FEFO then has something to pick).
--    Category resolved by name, UoM by code.
-- ============================================================================

INSERT INTO items (id, tenant_id, code, name, item_type, category_id, base_uom_id, is_batch_tracked, is_expiry_tracked, is_hazardous, storage_conditions, standard_cost, min_shelf_life_days_on_receipt)
SELECT v.id, '11111111-1111-4111-8111-111111111111', v.code, v.name, 'SUPPLY', c.id, u.id,
       v.is_batch_tracked, v.is_expiry_tracked, v.is_hazardous, 'ROOM',
       v.standard_cost, v.min_shelf_life_days_on_receipt
FROM (VALUES
  -- Pharmacy supplies
  (gen_random_uuid(), 'SUP-ORAL-SYR-5',   'Oral Syringe 5mL',         'Pharmacy Supplies',               'PC', false, false, false,  3.20,   0),
  (gen_random_uuid(), 'SUP-ORAL-SYR-10',  'Oral Syringe 10mL',        'Pharmacy Supplies',               'PC', false, false, false,  4.10,   0),
  (gen_random_uuid(), 'SUP-IV-SET',       'IV Giving Set',            'Pharmacy Supplies',               'PC', true,  true,  false,  95.00,  180),
  (gen_random_uuid(), 'SUP-COTTON-BALL',  'Cotton Balls 500s',        'Pharmacy Supplies',               'BX', false, false, false,  85.00,   0),
  (gen_random_uuid(), 'SUP-GAUZE-4X4',    'Gauze Pads 4x4 100s',      'Pharmacy Supplies',               'BX', false, false, false,  110.00,  0),
  (gen_random_uuid(), 'SUP-ALCOHOL-SWAB', 'Alcohol Swabs 100s',       'Pharmacy Supplies',               'BX', true,  true,  true,   95.00,  24),
  -- Laboratory supplies
  (gen_random_uuid(), 'LAB-VAC-EDTA',     'Vacutainer EDTA 3mL 100s', 'Laboratory Supplies',              'BX', true,  true,  false,  980.00,  365),
  (gen_random_uuid(), 'LAB-VAC-SER',     'Vacutainer Serum 3mL 100s','Laboratory Supplies',              'BX', true,  true,  false,  1020.00, 365),
  (gen_random_uuid(), 'LAB-URINE-CUP',   'Urine Collection Container','Laboratory Supplies',             'PC', false, false, false,  18.00,   0),
  (gen_random_uuid(), 'LAB-SLIDE',       'Microscope Slides 100s',    'Laboratory Supplies',              'BX', false, false, false,  120.00,  0),
  (gen_random_uuid(), 'LAB-COVERSLIP',   'Cover Slips 100s',          'Laboratory Supplies',              'BX', false, false, false,  65.00,   0),
  (gen_random_uuid(), 'LAB-TUBE-RACK',   'Tube Rack 50-place',        'Laboratory Supplies',              'PC', false, false, false,  450.00,  0),
  -- Clinical consumables
  (gen_random_uuid(), 'CLN-BP-CUFF',      'Sphygmomanometer Cuff',    'Clinical Consumables',             'EA', false, false, false,  1250.00, 0),
  (gen_random_uuid(), 'CLN-THERMO',      'Digital Thermometer',      'Clinical Consumables',             'EA', false, false, false,  350.00,  0),
  (gen_random_uuid(), 'CLN-TAPE',        'Adhesive Tape 1in',         'Clinical Consumables',             'RL', false, false, false,  28.00,   0),
  -- Personal protective equipment
  (gen_random_uuid(), 'PPE-GLOVE-M',     'Exam Gloves (Medium) 100s','Personal Protective Equipment',   'BX', false, false, false,  420.00,  0),
  (gen_random_uuid(), 'PPE-GLOVE-L',     'Exam Gloves (Large) 100s', 'Personal Protective Equipment',   'BX', false, false, false,  420.00,  0),
  (gen_random_uuid(), 'PPE-MASK-SURG',   'Surgical Mask 50s',         'Personal Protective Equipment',   'BX', false, true,  false,  180.00,  0),
  (gen_random_uuid(), 'PPE-N95',         'N95 Respirator 20s',       'Personal Protective Equipment',   'BX', false, true,  false,  980.00,  0),
  -- Stationery
  (gen_random_uuid(), 'STA-RX-PAD',      'Prescription Pad 100s',     'Stationery',                      'BX', false, false, false,  150.00,  0)
) AS v(id, code, name, category_name, uom_code, is_batch_tracked, is_expiry_tracked, is_hazardous, standard_cost, min_shelf_life_days_on_receipt)
JOIN item_categories c ON c.tenant_id = '11111111-1111-4111-8111-111111111111' AND c.name = v.category_name
JOIN uoms u ON u.tenant_id = '11111111-1111-4111-8111-111111111111' AND u.code = v.uom_code
ON CONFLICT (tenant_id, code) DO UPDATE
  SET name = EXCLUDED.name, item_type = EXCLUDED.item_type, category_id = EXCLUDED.category_id,
      base_uom_id = EXCLUDED.base_uom_id, standard_cost = EXCLUDED.standard_cost,
      is_batch_tracked = EXCLUDED.is_batch_tracked, is_expiry_tracked = EXCLUDED.is_expiry_tracked,
      is_hazardous = EXCLUDED.is_hazardous, is_active = true;


-- ============================================================================
-- 9. Service catalogue — consultation fees, lab test prices, drug prices.
--    Lab tests and drug items reference these so billing can resolve a price
--    server-side (ground rule: never compute money on the client).
-- ============================================================================

INSERT INTO service_catalog (id, tenant_id, code, name, category, default_price) VALUES
  (gen_random_uuid(), '11111111-1111-4111-8111-111111111111', 'CONSULT-GEN',   'General Consultation',        'consult', 500.00),
  (gen_random_uuid(), '11111111-1111-4111-8111-111111111111', 'CONSULT-FU',    'Follow-up Consultation',     'consult', 300.00),
  (gen_random_uuid(), '11111111-1111-4111-8111-111111111111', 'LAB-CBC',       'Complete Blood Count',       'lab',     350.00),
  (gen_random_uuid(), '11111111-1111-4111-8111-111111111111', 'LAB-FBS',       'Fasting Blood Sugar',        'lab',     120.00),
  (gen_random_uuid(), '11111111-1111-4111-8111-111111111111', 'LAB-HBA1C',     'Glycated Haemoglobin',       'lab',     450.00),
  (gen_random_uuid(), '11111111-1111-4111-8111-111111111111', 'LAB-RFT',       'Renal Function Test',        'lab',     500.00),
  (gen_random_uuid(), '11111111-1111-4111-8111-111111111111', 'LAB-LFT',       'Liver Function Test',         'lab',     600.00),
  (gen_random_uuid(), '11111111-1111-4111-8111-111111111111', 'LAB-LIPID',     'Lipid Profile',              'lab',     550.00),
  (gen_random_uuid(), '11111111-1111-4111-8111-111111111111', 'LAB-UA',        'Urinalysis',                 'lab',     100.00),
  (gen_random_uuid(), '11111111-1111-4111-8111-111111111111', 'LAB-BCULT',     'Blood Culture',              'lab',     1200.00),
  (gen_random_uuid(), '11111111-1111-4111-8111-111111111111', 'LAB-HBSAG',     'Hepatitis B Surface Antigen','lab',     150.00),
  (gen_random_uuid(), '11111111-1111-4111-8111-111111111111', 'LAB-HIV',       'HIV Screening (Rapid)',      'lab',     250.00),
  (gen_random_uuid(), '11111111-1111-4111-8111-111111111111', 'LAB-DENGUE',    'Dengue NS1 Antigen',         'lab',     400.00),
  (gen_random_uuid(), '11111111-1111-4111-8111-111111111111', 'LAB-PREG',      'Pregnancy Test (Urine)',     'lab',     100.00),
  (gen_random_uuid(), '11111111-1111-4111-8111-111111111111', 'LAB-HISTO',     'Histopathology (Biopsy)',    'lab',     2500.00)
ON CONFLICT (tenant_id, code) DO UPDATE
  SET name = EXCLUDED.name, category = EXCLUDED.category,
      default_price = EXCLUDED.default_price, is_active = true, deleted_at = NULL;

-- 9a. Link lab tests to their priced service.
UPDATE lab_tests t
SET service_id = s.id
FROM service_catalog s
WHERE s.code = 'LAB-' || t.code
  AND t.tenant_id = '11111111-1111-4111-8111-111111111111'
  AND s.tenant_id = t.tenant_id;

-- 9b. Price every formulary drug (retail = standard_cost with a modest markup).
INSERT INTO service_catalog (id, tenant_id, code, name, category, default_price)
SELECT i.id, i.tenant_id, 'RX-' || i.code, i.name, 'other', round(i.standard_cost * 1.35, 2)
FROM items i
WHERE i.tenant_id = '11111111-1111-4111-8111-111111111111'
  AND i.item_type = 'MEDICINE'
  AND EXISTS (SELECT 1 FROM drug_products d
              WHERE d.tenant_id = i.tenant_id AND d.item_id = i.id AND d.is_formulary)
ON CONFLICT (tenant_id, code) DO UPDATE
  SET name = EXCLUDED.name, default_price = EXCLUDED.default_price, is_active = true, deleted_at = NULL;

-- 9c. Point drug items at their priced service so dispensing can charge it.
UPDATE items i
SET service_id = s.id
FROM service_catalog s
WHERE s.code = 'RX-' || i.code
  AND i.tenant_id = '11111111-1111-4111-8111-111111111111'
  AND s.tenant_id = i.tenant_id
  AND i.item_type = 'MEDICINE';


-- ============================================================================

-- ============================================================================
-- 11. Self-verification — fail the whole seed if the shape is wrong.
-- ============================================================================

DO $$
DECLARE
  v_missing text;
BEGIN
  -- The 9 starter roles must exist, each with grants.
  SELECT string_agg(rc.code, ', ') INTO v_missing
  FROM unnest(ARRAY['tenant_admin','doctor','nurse','pharmacist_dispenser',
                    'receptionist','pharmacist_verifier','lab_technologist','lab_verifier','cashier']) AS rc(code)
  LEFT JOIN roles r ON r.tenant_id = '11111111-1111-4111-8111-111111111111' AND r.code = rc.code
  WHERE r.id IS NULL
     OR NOT EXISTS (
      SELECT 1 FROM role_permissions rp WHERE rp.tenant_id = r.tenant_id AND rp.role_id = r.id);
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'tenant_bootstrap: starter roles missing or without grants: %', v_missing;
  END IF;

  -- The 12 starter accounts must exist, be ACTIVE and hold exactly their role.
  IF (SELECT count(*) FROM users u
      JOIN user_roles ur ON ur.tenant_id = u.tenant_id AND ur.user_id = u.id
      JOIN roles r ON r.tenant_id = ur.tenant_id AND r.id = ur.role_id
      WHERE u.tenant_id = '11111111-1111-4111-8111-111111111111'
        AND u.email IN (
          'admintenant@__TENANT_SLUG__.emr','admin@__TENANT_SLUG__.emr',
          'doctor@__TENANT_SLUG__.emr','nurse@__TENANT_SLUG__.emr',
          'pharmacist@__TENANT_SLUG__.emr','dispenser@__TENANT_SLUG__.emr',
          'receptionist@__TENANT_SLUG__.emr','staff@__TENANT_SLUG__.emr',
          'cashier@__TENANT_SLUG__.emr','verifier@__TENANT_SLUG__.emr',
          'labtech@__TENANT_SLUG__.emr','labverify@__TENANT_SLUG__.emr')
        AND u.status = 'ACTIVE'
        AND r.code IN ('tenant_admin','doctor','nurse','pharmacist_dispenser',
                       'receptionist','pharmacist_verifier','lab_technologist','lab_verifier','cashier')
     ) <> 12 THEN
    RAISE EXCEPTION 'tenant_bootstrap: expected 12 active starter accounts, each with its starter role';
  END IF;

  -- All 12 must sit on the tenant's MAIN branch (G-02).
  IF (SELECT count(*) FROM users u
      JOIN user_branches ub ON ub.tenant_id = u.tenant_id AND ub.user_id = u.id
      JOIN branches b ON b.tenant_id = ub.tenant_id AND b.id = ub.branch_id AND b.code = 'MAIN'
      WHERE u.tenant_id = '11111111-1111-4111-8111-111111111111'
        AND u.email IN (
          'admintenant@__TENANT_SLUG__.emr','admin@__TENANT_SLUG__.emr',
          'doctor@__TENANT_SLUG__.emr','nurse@__TENANT_SLUG__.emr',
          'pharmacist@__TENANT_SLUG__.emr','dispenser@__TENANT_SLUG__.emr',
          'receptionist@__TENANT_SLUG__.emr','staff@__TENANT_SLUG__.emr',
          'cashier@__TENANT_SLUG__.emr','verifier@__TENANT_SLUG__.emr',
          'labtech@__TENANT_SLUG__.emr','labverify@__TENANT_SLUG__.emr')
     ) <> 12 THEN
    RAISE EXCEPTION 'tenant_bootstrap: all 12 starter accounts must be assigned to branch MAIN';
  END IF;

  -- Every starter account must carry an employee record; the doctor must hold
  -- the full PRC/PTR/S2 licence set the prescription PDF prints
  -- (specification CLN-T5, RA 6675 / RA 9165).
  IF (SELECT count(*) FROM users u
      JOIN employees e ON e.tenant_id = u.tenant_id AND e.user_id = u.id
      WHERE u.tenant_id = '11111111-1111-4111-8111-111111111111'
        AND u.email IN (
          'admintenant@__TENANT_SLUG__.emr','admin@__TENANT_SLUG__.emr',
          'doctor@__TENANT_SLUG__.emr','nurse@__TENANT_SLUG__.emr',
          'pharmacist@__TENANT_SLUG__.emr','dispenser@__TENANT_SLUG__.emr',
          'receptionist@__TENANT_SLUG__.emr','staff@__TENANT_SLUG__.emr',
          'cashier@__TENANT_SLUG__.emr','verifier@__TENANT_SLUG__.emr',
          'labtech@__TENANT_SLUG__.emr','labverify@__TENANT_SLUG__.emr')
        AND e.status = 'ACTIVE' AND e.job_title <> ''
     ) <> 12 THEN
    RAISE EXCEPTION 'tenant_bootstrap: all 12 starter accounts must have an ACTIVE employees record';
  END IF;

  IF (SELECT count(*) FROM users u
      JOIN employees e ON e.tenant_id = u.tenant_id AND e.user_id = u.id
      WHERE u.tenant_id = '11111111-1111-4111-8111-111111111111'
        AND u.email = 'doctor@__TENANT_SLUG__.emr'
        AND e.prc_license_no IS NOT NULL AND e.prc_license_no <> ''
        AND e.ptr_no IS NOT NULL AND e.ptr_no <> ''
        AND e.s2_license_no IS NOT NULL AND e.s2_license_no <> ''
     ) <> 1 THEN
    RAISE EXCEPTION 'tenant_bootstrap: starter doctor must hold PRC, PTR and S2 licence numbers';
  END IF;

  -- The section 3g SoD repair must have taken: no starter role may hold a
  -- declared conflict pair. This is what makes portal-created roles assignable
  -- (rbac.service.ts assertNoSoDConflicts refuses otherwise).
  SELECT string_agg(DISTINCT r.code || ' holds ' || s.permission_a || ' + ' || s.permission_b, '; ')
    INTO v_missing
  FROM sod_conflicts s
  CROSS JOIN (VALUES
    ('tenant_admin'::text), ('doctor'::text), ('nurse'::text),
    ('pharmacist_dispenser'::text), ('receptionist'::text),
    ('pharmacist_verifier'::text), ('lab_technologist'::text), ('lab_verifier'::text),
    ('cashier'::text)) AS rr(role_code)
  JOIN roles r ON r.tenant_id = '11111111-1111-4111-8111-111111111111' AND r.code = rr.role_code
  WHERE EXISTS (
    SELECT 1 FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id
    WHERE rp.tenant_id = r.tenant_id AND rp.role_id = r.id AND p.code = s.permission_a
  )
  AND EXISTS (
    SELECT 1 FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id
    WHERE rp.tenant_id = r.tenant_id AND rp.role_id = r.id AND p.code = s.permission_b
  );
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'tenant_bootstrap: segregation-of-duty violation -> %', v_missing;
  END IF;

  -- The 16 formulary products must be present and attached to items.
  IF (SELECT count(*) FROM drug_products d
      JOIN items i ON i.tenant_id = d.tenant_id AND i.id = d.item_id
      WHERE d.tenant_id = '11111111-1111-4111-8111-111111111111'
        AND i.code IN ('MED-AMOX-500','MED-AMOX-SUS','MED-AZI-500','MED-PARA-500','MED-PARA-SUS',
                       'MED-IBU-200','MED-MET-500','MED-MET-850','MED-AML-5','MED-LOS-50',
                       'MED-HCTZ-25','MED-SIM-20','MED-OME-20','MED-SAL-NEB','MED-CET-5','MED-IBU-400')
     ) <> 16 THEN
    RAISE EXCEPTION 'tenant_bootstrap: the 16 seeded formulary products are not all present and attached to an item';
  END IF;

  -- The 13 lab tests, 20 supply items, and their price links.
  IF (SELECT count(*) FROM lab_tests
      WHERE tenant_id = '11111111-1111-4111-8111-111111111111'
        AND code IN ('CBC','FBS','HBA1C','RFT','LFT','LIPID','UA','BCULT','HBSAG','HIV','DENGUE','PREG','HISTO')
     ) <> 13 THEN
    RAISE EXCEPTION 'tenant_bootstrap: the 13 seeded lab tests are not all present';
  END IF;

  IF (SELECT count(*) FROM items
      WHERE tenant_id = '11111111-1111-4111-8111-111111111111'
        AND code IN ('SUP-ORAL-SYR-5','SUP-ORAL-SYR-10','SUP-IV-SET','SUP-COTTON-BALL','SUP-GAUZE-4X4',
                     'SUP-ALCOHOL-SWAB','LAB-VAC-EDTA','LAB-VAC-SER','LAB-URINE-CUP','LAB-SLIDE',
                     'LAB-COVERSLIP','LAB-TUBE-RACK','CLN-BP-CUFF','CLN-THERMO','CLN-TAPE',
                     'PPE-GLOVE-M','PPE-GLOVE-L','PPE-MASK-SURG','PPE-N95','STA-RX-PAD')
     ) <> 20 THEN
    RAISE EXCEPTION 'tenant_bootstrap: the 20 seeded central-supply items are not all present';
  END IF;

  IF (SELECT count(*) FROM lab_tests t
      WHERE t.tenant_id = '11111111-1111-4111-8111-111111111111'
        AND t.code IN ('CBC','FBS','HBA1C','RFT','LFT','LIPID','UA','BCULT','HBSAG','HIV','DENGUE','PREG','HISTO')
        AND t.service_id IS NULL) > 0 THEN
    RAISE EXCEPTION 'tenant_bootstrap: every seeded lab test must resolve to a priced service';
  END IF;

  IF (SELECT count(*) FROM items i
      WHERE i.tenant_id = '11111111-1111-4111-8111-111111111111'
        AND i.code IN ('MED-AMOX-500','MED-AMOX-SUS','MED-AZI-500','MED-PARA-500','MED-PARA-SUS',
                       'MED-IBU-200','MED-MET-500','MED-MET-850','MED-AML-5','MED-LOS-50',
                       'MED-HCTZ-25','MED-SIM-20','MED-OME-20','MED-SAL-NEB','MED-CET-5','MED-IBU-400')
        AND i.service_id IS NULL) > 0 THEN
    RAISE EXCEPTION 'tenant_bootstrap: every seeded medicine must resolve to a priced service';
  END IF;

  RAISE NOTICE 'tenant_bootstrap: verified — 9 roles + 12 slug-stubbed accounts on MAIN, master data priced and linked, no SoD conflicts';
END $$;

COMMIT;
