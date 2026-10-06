-- ============================================================================
-- demo_clean.sql — minimal, clean, transactional demo seed (tenant demo-a)
-- ============================================================================
--
-- PURPOSE
--   One self-contained, all-or-nothing seed for a demo tenant containing ONLY:
--     * 3 patients
--     * all pharmacy master data    (generic names, formulary, pricing)
--     * all laboratory master data  (sections, specimens, tests, analytes,
--                                   reference ranges, instruments)
--     * all central-supply master data (UoM, categories, suppliers, locations,
--                                   item catalogue)
--     * 3 staff accounts            (tenant admin, doctor, nurse)
--
--   It deliberately contains NO transactional/clinical history: no visits, no
--   orders, no results, no dispenses, no stock movements, no invoices. Every
--   walkthrough starts from a genuinely empty ledger.
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
--   * Tenant-safe    — every conflict target is either composite with tenant_id,
--                      or (for the globally-keyed patients table) guarded by
--                      `WHERE patients.tenant_id = EXCLUDED.tenant_id` plus a
--                      pre-flight check that refuses to run when one of the
--                      seeded patient ids is owned by a different tenant.
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
--      a tenant that already holds other patients/staff/transactions it is a
--      no-duplicate master-data load, not a reset. See "clean-state semantics"
--      in the runner's output.
--   5. `patients.id` is a GLOBAL primary key, so the three seeded patient UUIDs
--      are claimed by whichever tenant inserts them first. In a database where
--      demo-a already holds them, `--tenant <other>` is refused by the pre-flight
--      guard in section 10 rather than allowed to rewrite demo-a's patients. The
--      clean-state proof therefore belongs in a fresh database (migrations +
--      migrations/seeds/demo.sql, which creates no patients), not a second tenant
--      in this one.
--
-- USAGE
--   pnpm --filter @clinic/db seed:demo               # apply (CLINIC_DATABASE_URL)
--   pnpm --filter @clinic/db seed:demo -- --check    # verify only, rolls back
--   pnpm --filter @clinic/db seed:demo -- --verify   # idempotency probe, rolls back
-- ============================================================================

BEGIN;

-- RLS context for the target tenant (architecture §5, tenant isolation).
-- All 26 tables below have RLS ENABLED **and** FORCED, so this setting is
-- mandatory: without it every statement below reads zero rows.
SELECT set_config('app.tenant_id', '11111111-1111-4111-8111-111111111111', true);

-- Guard: refuse to run against a tenant that does not exist / is not ACTIVE.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM tenants
    WHERE id = '11111111-1111-4111-8111-111111111111' AND status = 'ACTIVE'
  ) THEN
    RAISE EXCEPTION
      'demo_clean: tenant 11111111-1111-4111-8111-111111111111 (demo-a) missing or not ACTIVE — run migrations/demo.sql first';
  END IF;
END $$;


-- ============================================================================
-- 1. Module entitlements
--    All ten valid module codes (tenant_modules_module_check). Enabling
--    compliance/notifications/reports matters: MainLayout.tsx drops a whole nav
--    group when hasModule() is false, so a missing entitlement hides a group
--    whose permissions the role already holds.
-- ============================================================================

INSERT INTO tenant_modules (tenant_id, module, status, seed_status) VALUES
  ('11111111-1111-4111-8111-111111111111', 'admin',         'ENABLED', 'SEEDED'),
  ('11111111-1111-4111-8111-111111111111', 'patients',      'ENABLED', 'SEEDED'),
  ('11111111-1111-4111-8111-111111111111', 'clinical',      'ENABLED', 'SEEDED'),
  ('11111111-1111-4111-8111-111111111111', 'laboratory',    'ENABLED', 'SEEDED'),
  ('11111111-1111-4111-8111-111111111111', 'pharmacy',      'ENABLED', 'SEEDED'),
  ('11111111-1111-4111-8111-111111111111', 'supply',        'ENABLED', 'SEEDED'),
  ('11111111-1111-4111-8111-111111111111', 'billing',       'ENABLED', 'SEEDED'),
  ('11111111-1111-4111-8111-111111111111', 'compliance',    'ENABLED', 'SEEDED'),
  ('11111111-1111-4111-8111-111111111111', 'notifications', 'ENABLED', 'SEEDED'),
  ('11111111-1111-4111-8111-111111111111', 'reports',       'ENABLED', 'SEEDED')
ON CONFLICT (tenant_id, module) DO UPDATE
  SET status = 'ENABLED', seed_status = 'SEEDED', updated_at = now();


-- ============================================================================
-- 2. Branch and service units
-- ============================================================================

INSERT INTO branches (id, tenant_id, code, name, service_profile, status, timezone)
VALUES ('a1000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111',
        'MAIN', 'Demo A — Main', '["consultation"]'::jsonb, 'ACTIVE', 'Asia/Manila')
ON CONFLICT (tenant_id, code) DO UPDATE
  SET name = EXCLUDED.name, service_profile = EXCLUDED.service_profile,
      status = 'ACTIVE', timezone = EXCLUDED.timezone,
      deleted_at = NULL, updated_at = now();

-- service_units has only a surrogate PK -> NOT EXISTS guard on (tenant, code).
INSERT INTO service_units (id, tenant_id, code, name, description)
SELECT v.id, '11111111-1111-4111-8111-111111111111', v.code, v.name, v.description
FROM (VALUES
  ('c1000000-0000-4000-8000-000000000001'::uuid, 'GEN',    'General Medicine',   'Outpatient general medicine clinic'),
  ('c1000000-0000-4000-8000-000000000002'::uuid, 'PEDS',   'Pediatrics',         'Paediatric outpatient clinic'),
  ('c1000000-0000-4000-8000-000000000003'::uuid, 'LAB',    'Laboratory',         'Clinical laboratory section'),
  ('c1000000-0000-4000-8000-000000000004'::uuid, 'PHARM',  'Pharmacy',           'Dispensary / formulary'),
  ('c1000000-0000-4000-8000-000000000005'::uuid, 'STORE',  'Central Supply',     'Central store and warehouse')
) AS v(id, code, name, description)
WHERE NOT EXISTS (
  SELECT 1 FROM service_units s
  WHERE s.tenant_id = '11111111-1111-4111-8111-111111111111' AND s.code = v.code
);


-- ============================================================================
-- 3. Roles (specification §2.2)
--    tenant_admin, doctor, nurse, pharmacist_dispenser, receptionist.
--    Fixed UUIDs; receptionist is left untouched.
-- ============================================================================

INSERT INTO roles (id, tenant_id, code, name, is_system) VALUES
  ('a2000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'tenant_admin',          'Tenant Administrator',   true),
  ('a2000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'doctor',                'Doctor',                  true),
  ('a2000000-0000-4000-8000-000000000004', '11111111-1111-4111-8111-111111111111', 'nurse',                 'Nurse',                   true),
  ('a2000000-0000-4000-8000-000000000005', '11111111-1111-4111-8111-111111111111', 'pharmacist_dispenser',  'Pharmacist / Dispenser',  true),
  ('a2000000-0000-4000-8000-000000000006', '11111111-1111-4111-8111-111111111111', 'receptionist',          'Receptionist',            true)
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


-- ============================================================================
-- 4. Staff accounts — tenant admin, doctor, nurse, pharmacist, receptionist
--    All five share the demo password  DemoPassw0rd!2026
--    (argon2id hash reused verbatim from migrations/seeds/demo.sql).
--
--    The pharmacist and receptionist exist because the demo tenant has to be
--    able to finish the clinical -> dispense -> invoice -> payment journey.
--    `tenant_admin` holds pharmacy.*read and billing.*read but not
--    pharmacy.dispense.post or billing.payment.create, so a single admin
--    account cannot complete it.
--
--    Resolved by NATURAL KEY (email / role code / branch code), never by UUID:
--    ON CONFLICT keeps the existing row's own id, so pinning the child ids
--    would break the FK on a re-run against a tenant seeded by other means.
-- ============================================================================

INSERT INTO users (tenant_id, email, name, password_hash, status)
SELECT '11111111-1111-4111-8111-111111111111', v.email, v.name, v.password_hash, 'ACTIVE'
FROM (VALUES
  ('admin@demo-a.test',    'Demo A — Tenant Admin',
   '$argon2id$v=19$m=19456,t=2,p=1$PJbfK+fX4INlaV6B1J1P9Q$r8KelzGMcN1aCKjlBfUifGfeT1j7Wnk7sl8WlLr624I'),
  ('doctor@demo-a.test',   'Demo A — Doctor',
   '$argon2id$v=19$m=19456,t=2,p=1$PJbfK+fX4INlaV6B1J1P9Q$r8KelzGMcN1aCKjlBfUifGfeT1j7Wnk7sl8WlLr624I'),
  ('nurse@demo-a.test',    'Demo A — Nurse',
   '$argon2id$v=19$m=19456,t=2,p=1$PJbfK+fX4INlaV6B1J1P9Q$r8KelzGMcN1aCKjlBfUifGfeT1j7Wnk7sl8WlLr624I'),
  ('dispenser@demo-a.test','Demo A — Pharmacist',
   '$argon2id$v=19$m=19456,t=2,p=1$PJbfK+fX4INlaV6B1J1P9Q$r8KelzGMcN1aCKjlBfUifGfeT1j7Wnk7sl8WlLr624I'),
  ('staff@demo-a.test',    'Demo A — Receptionist',
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
  ('admin@demo-a.test',    'tenant_admin'),
  ('doctor@demo-a.test',   'doctor'),
  ('nurse@demo-a.test',    'nurse'),
  ('dispenser@demo-a.test','pharmacist_dispenser'),
  ('staff@demo-a.test',    'receptionist')
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
  AND u.email IN ('admin@demo-a.test', 'doctor@demo-a.test', 'nurse@demo-a.test',
                  'dispenser@demo-a.test', 'staff@demo-a.test')
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
  ('admin@demo-a.test',  'DA-0001', 'Clinic Manager',        'Administration',   'FULL_TIME', NULL,                  NULL,            NULL,            NULL,            '(02) 8888-0101', DATE '2024-01-15'),
  ('doctor@demo-a.test', 'DA-0002', 'Consultant Physician',  'Internal Medicine','CONSULTANT','Internal Medicine',    'PRC-1000001',   'PTR-1000001',   'S2-1000001',   '(02) 8888-0102', DATE '2023-06-01'),
  ('nurse@demo-a.test',  'DA-0003', 'Registered Nurse',      'Nursing',         'FULL_TIME',  'Emergency Nursing',  NULL,            'PTR-1000003',   NULL,            '(02) 8888-0103', DATE '2024-03-01'),
  ('dispenser@demo-a.test','DA-0004', 'Pharmacist',          'Pharmacy',        'FULL_TIME',  'Hospital Pharmacy',  NULL,            NULL,            NULL,            '(02) 8888-0104', DATE '2024-05-06'),
  ('staff@demo-a.test',  'DA-0005', 'Front Desk Receptionist','Front Desk',    'FULL_TIME',  NULL,                  NULL,            NULL,            NULL,            '(02) 8888-0105', DATE '2024-02-19')
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
  ('b0000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'BX',  'Box'),
  ('b0000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'PC',  'Piece'),
  ('b0000000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', 'RL',  'Roll'),
  ('b0000000-0000-4000-8000-000000000004', '11111111-1111-4111-8111-111111111111', 'KIT', 'Kit'),
  ('b0000000-0000-4000-8000-000000000005', '11111111-1111-4111-8111-111111111111', 'ML',  'Millilitre'),
  ('b0000000-0000-4000-8000-000000000006', '11111111-1111-4111-8111-111111111111', 'MG',  'Milligram'),
  ('b0000000-0000-4000-8000-000000000007', '11111111-1111-4111-8111-111111111111', 'EA',  'Each')
ON CONFLICT (tenant_id, code) DO UPDATE SET name = EXCLUDED.name, is_active = true;

-- 5b. Item categories (surrogate PK only -> NOT EXISTS guard on (tenant, name))
INSERT INTO item_categories (id, tenant_id, name, parent_id)
SELECT v.id, '11111111-1111-4111-8111-111111111111', v.name, NULL
FROM (VALUES
  ('b1000000-0000-4000-8000-000000000001'::uuid, 'Pharmacy Supplies'),
  ('b1000000-0000-4000-8000-000000000002'::uuid, 'Laboratory Supplies'),
  ('b1000000-0000-4000-8000-000000000003'::uuid, 'Clinical Consumables'),
  ('b1000000-0000-4000-8000-000000000004'::uuid, 'Personal Protective Equipment'),
  ('b1000000-0000-4000-8000-000000000005'::uuid, 'Stationery')
) AS v(id, name)
WHERE NOT EXISTS (
  SELECT 1 FROM item_categories c
  WHERE c.tenant_id = '11111111-1111-4111-8111-111111111111' AND c.name = v.name
);

-- 5c. Suppliers (surrogate PK only -> NOT EXISTS guard on (tenant, code))
INSERT INTO suppliers (id, tenant_id, code, name, tin, address, terms_days, lead_time_days, status)
SELECT v.id, '11111111-1111-4111-8111-111111111111', v.code, v.name, v.tin, v.address, v.terms_days, v.lead_time_days, 'ACTIVE'
FROM (VALUES
  ('b2000000-0000-4000-8000-000000000001'::uuid, 'SUP-MED',  'Metro Drug Distributors', '000-123-456', '12 Shaw Blvd, Mandaluyong', 30, 7),
  ('b2000000-0000-4000-8000-000000000002'::uuid, 'SUP-MDL',  'Medline Philippines',    '000-234-567', '88 Aurora Ave, Quezon City', 45, 10),
  ('b2000000-0000-4000-8000-000000000003'::uuid, 'SUP-CHM',  'ChemLab Diagnostics',    '000-345-678', '4 Science Rd, Taguig',       30, 14)
) AS v(id, code, name, tin, address, terms_days, lead_time_days)
WHERE NOT EXISTS (
  SELECT 1 FROM suppliers s
  WHERE s.tenant_id = '11111111-1111-4111-8111-111111111111' AND s.code = v.code
);

-- 5d. Stock locations (branch resolved by code, not by UUID)
INSERT INTO stock_locations (id, tenant_id, branch_id, code, name, type)
SELECT v.id, b.tenant_id, b.id, v.code, v.name, v.type
FROM (VALUES
  ('b3000000-0000-4000-8000-000000000001'::uuid, 'CENTRAL', 'Central Store',         'CENTRAL_STORE'),
  ('b3000000-0000-4000-8000-000000000002'::uuid, 'DISP',    'Dispensary',            'PHARMACY'),
  ('b3000000-0000-4000-8000-000000000003'::uuid, 'LAB',     'Laboratory Store',      'LAB'),
  ('b3000000-0000-4000-8000-000000000004'::uuid, 'ROOM1',   'Consultation Room 1',   'CLINIC_ROOM')
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
  ('b4000000-0000-4000-8000-000000000101'::uuid, 'MED-AMOX-500',   'Amoxicillin 500mg Capsule',      'PC',   8.50),
  ('b4000000-0000-4000-8000-000000000102'::uuid, 'MED-AMOX-SUS',   'Amoxicillin 250mg/5mL Syrup',     'ML',  65.00),
  ('b4000000-0000-4000-8000-000000000103'::uuid, 'MED-AZI-500',    'Azithromycin 500mg Tablet',       'PC',  22.00),
  ('b4000000-0000-4000-8000-000000000104'::uuid, 'MED-PARA-500',   'Paracetamol 500mg Tablet',        'PC',   3.25),
  ('b4000000-0000-4000-8000-000000000105'::uuid, 'MED-PARA-SUS',   'Paracetamol 250mg/5mL Syrup',     'ML',  28.00),
  ('b4000000-0000-4000-8000-000000000106'::uuid, 'MED-IBU-200',    'Ibuprofen 200mg Tablet',           'PC',   4.75),
  ('b4000000-0000-4000-8000-000000000107'::uuid, 'MED-MET-500',    'Metformin 500mg Tablet',          'PC',   5.10),
  ('b4000000-0000-4000-8000-000000000108'::uuid, 'MED-MET-850',    'Metformin 850mg Tablet',          'PC',   7.90),
  ('b4000000-0000-4000-8000-000000000109'::uuid, 'MED-AML-5',      'Amlodipine 5mg Tablet',           'PC',   6.30),
  ('b4000000-0000-4000-8000-000000000110'::uuid, 'MED-LOS-50',     'Losartan 50mg Tablet',             'PC',  12.40),
  ('b4000000-0000-4000-8000-000000000111'::uuid, 'MED-HCTZ-25',    'Hydrochlorothiazide 25mg Tablet', 'PC',   4.20),
  ('b4000000-0000-4000-8000-000000000112'::uuid, 'MED-SIM-20',     'Simvastatin 20mg Tablet',          'PC',   9.80),
  ('b4000000-0000-4000-8000-000000000113'::uuid, 'MED-OME-20',     'Omeprazole 20mg Capsule',         'PC',  18.60),
  ('b4000000-0000-4000-8000-000000000114'::uuid, 'MED-SAL-NEB',    'Salbutamol 2.5mg Nebuliser',      'EA',  95.00),
  ('b4000000-0000-4000-8000-000000000115'::uuid, 'MED-CET-5',      'Cetirizine 5mg Tablet',            'PC',   6.90),
  ('b4000000-0000-4000-8000-000000000116'::uuid, 'MED-IBU-400',    'Ibuprofen 400mg Tablet',           'PC',   6.50)
) AS v(id, code, name, uom_code, standard_cost)
JOIN uoms u ON u.tenant_id = '11111111-1111-4111-8111-111111111111' AND u.code = v.uom_code
ON CONFLICT (tenant_id, code) DO UPDATE
  SET name = EXCLUDED.name, base_uom_id = EXCLUDED.base_uom_id,
      standard_cost = EXCLUDED.standard_cost, is_active = true;

-- 6b. Generic (INN) names
INSERT INTO generic_names (id, tenant_id, name, atc_code) VALUES
  ('b5000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'Amoxicillin',         'J01CA04'),
  ('b5000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'Azithromycin',        'J01FA10'),
  ('b5000000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', 'Paracetamol',         'N02BE01'),
  ('b5000000-0000-4000-8000-000000000004', '11111111-1111-4111-8111-111111111111', 'Ibuprofen',           'M01AE01'),
  ('b5000000-0000-4000-8000-000000000005', '11111111-1111-4111-8111-111111111111', 'Metformin',           'A10BA02'),
  ('b5000000-0000-4000-8000-000000000006', '11111111-1111-4111-8111-111111111111', 'Amlodipine',          'C08CA01'),
  ('b5000000-0000-4000-8000-000000000007', '11111111-1111-4111-8111-111111111111', 'Losartan',            'C09CA01'),
  ('b5000000-0000-4000-8000-000000000008', '11111111-1111-4111-8111-111111111111', 'Hydrochlorothiazide', 'C03AA03'),
  ('b5000000-0000-4000-8000-000000000009', '11111111-1111-4111-8111-111111111111', 'Simvastatin',         'C10AA01'),
  ('b5000000-0000-4000-8000-000000000010', '11111111-1111-4111-8111-111111111111', 'Omeprazole',          'A02BC01'),
  ('b5000000-0000-4000-8000-000000000011', '11111111-1111-4111-8111-111111111111', 'Salbutamol',          'R03AC02'),
  ('b5000000-0000-4000-8000-000000000012', '11111111-1111-4111-8111-111111111111', 'Cetirizine',          'R06AE07')
ON CONFLICT (tenant_id, name) DO UPDATE SET atc_code = EXCLUDED.atc_code, deleted_at = NULL;

-- 6c. Formulary products. item resolved by code, generic by name.
INSERT INTO drug_products (id, tenant_id, item_id, generic_id, brand_name, strength, dosage_form, route, pack_size, fda_reg_no, rx_required, storage, is_formulary, high_alert, allergy_class)
SELECT v.id, '11111111-1111-4111-8111-111111111111', i.id, g.id, v.brand_name, v.strength,
       v.dosage_form, v.route, v.pack_size, v.fda_reg_no, v.rx_required,
       'ROOM', true, v.high_alert, v.allergy_class
FROM (VALUES
  ('b6000000-0000-4000-8000-000000000001'::uuid, 'MED-AMOX-500', 'Amoxicillin', 'Amoxil',   '500mg',       'CAPSULE',   'ORAL',       100, 'FDA-1001', 'RX',  false, 'Penicillin'),
  ('b6000000-0000-4000-8000-000000000002'::uuid, 'MED-AMOX-SUS', 'Amoxicillin', 'Amoxil',   '250mg/5mL',   'SYRUP',     'ORAL',         1, 'FDA-1002', 'RX',  false, 'Penicillin'),
  ('b6000000-0000-4000-8000-000000000003'::uuid, 'MED-AZI-500',  'Azithromycin','Zithromax','500mg',       'TABLET',    'ORAL',        30, 'FDA-1003', 'RX',  false, 'Macrolide'),
  ('b6000000-0000-4000-8000-000000000004'::uuid, 'MED-PARA-500', 'Paracetamol', 'Tylenol',  '500mg',       'TABLET',    'ORAL',       100, 'FDA-1004', 'OTC', false, 'Acetaminophen'),
  ('b6000000-0000-4000-8000-000000000005'::uuid, 'MED-PARA-SUS', 'Paracetamol', 'Tylenol',  '250mg/5mL',   'SYRUP',     'ORAL',         1, 'FDA-1005', 'OTC', false, 'Acetaminophen'),
  ('b6000000-0000-4000-8000-000000000006'::uuid, 'MED-IBU-200',  'Ibuprofen',   'Motrin',   '200mg',       'TABLET',    'ORAL',       100, 'FDA-1006', 'OTC', false, 'NSAID'),
  ('b6000000-0000-4000-8000-000000000007'::uuid, 'MED-MET-500',  'Metformin',   'Glucophage','500mg',      'TABLET',    'ORAL',       100, 'FDA-1007', 'RX',  false, 'Biguanide'),
  ('b6000000-0000-4000-8000-000000000008'::uuid, 'MED-MET-850',  'Metformin',   'Glucophage','850mg',      'TABLET',    'ORAL',       100, 'FDA-1008', 'RX',  false, 'Biguanide'),
  ('b6000000-0000-4000-8000-000000000009'::uuid, 'MED-AML-5',    'Amlodipine',  'Norvasc',  '5mg',         'TABLET',    'ORAL',        30, 'FDA-1009', 'RX',  false, 'Dihydropyridine'),
  ('b6000000-0000-4000-8000-000000000010'::uuid, 'MED-LOS-50',   'Losartan',    'Cozaar',   '50mg',        'TABLET',    'ORAL',        30, 'FDA-1010', 'RX',  false, 'ARB'),
  ('b6000000-0000-4000-8000-000000000011'::uuid, 'MED-HCTZ-25',  'Hydrochlorothiazide','Microzide','25mg',      'TABLET',    'ORAL',       100, 'FDA-1011', 'RX',  false, 'Thiazide'),
  ('b6000000-0000-4000-8000-000000000012'::uuid, 'MED-SIM-20',   'Simvastatin', 'Zocor',    '20mg',        'TABLET',    'ORAL',        30, 'FDA-1012', 'RX',  false, 'Statin'),
  ('b6000000-0000-4000-8000-000000000013'::uuid, 'MED-OME-20',   'Omeprazole',  'Prilosec', '20mg',        'CAPSULE',   'ORAL',        30, 'FDA-1013', 'OTC', false, 'PPI'),
  ('b6000000-0000-4000-8000-000000000014'::uuid, 'MED-SAL-NEB',  'Salbutamol',  'Ventolin', '2.5mg/2.5mL','NEBULISER', 'INHALATION',  20, 'FDA-1014', 'RX',  true,  'SABA'),
  ('b6000000-0000-4000-8000-000000000015'::uuid, 'MED-CET-5',    'Cetirizine',  'Zyrtec',   '5mg',         'TABLET',    'ORAL',        30, 'FDA-1015', 'OTC', false, 'Antihistamine'),
  ('b6000000-0000-4000-8000-000000000016'::uuid, 'MED-IBU-400',  'Ibuprofen',   'Motrin',   '400mg',       'TABLET',    'ORAL',       100, 'FDA-1016', 'OTC', false, 'NSAID')
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
  ('c2000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'HEM',   'Haematology',    1),
  ('c2000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'CHEM',  'Chemistry',      2),
  ('c2000000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', 'MICRO', 'Microbiology',   3),
  ('c2000000-0000-4000-8000-000000000004', '11111111-1111-4111-8111-111111111111', 'SER',   'Serology',       4),
  ('c2000000-0000-4000-8000-000000000005', '11111111-1111-4111-8111-111111111111', 'HISTO', 'Histopathology', 5)
ON CONFLICT (tenant_id, code) DO UPDATE
  SET name = EXCLUDED.name, display_order = EXCLUDED.display_order, is_active = true;

-- 7b. Specimen types
INSERT INTO lab_specimen_types (id, tenant_id, code, name, default_container, tube_top_color, stability_hours) VALUES
  ('c3000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'EDTA',   'EDTA Whole Blood',    'EDTA tube',         'Lavender',  24),
  ('c3000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'SERUM',  'Serum',               'Serum separator',   'Red',       48),
  ('c3000000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', 'PLASMA', 'Plasma',              'EDTA tube',         'Lavender',  24),
  ('c3000000-0000-4000-8000-000000000004', '11111111-1111-4111-8111-111111111111', 'URINE',  'Urine',               'Urine container',   'Yellow',    24),
  ('c3000000-0000-4000-8000-000000000005', '11111111-1111-4111-8111-111111111111', 'BLOOD',  'Whole Blood',         'Blood culture bot', 'Red',       72),
  ('c3000000-0000-4000-8000-000000000006', '11111111-1111-4111-8111-111111111111', 'CSF',    'Cerebrospinal Fluid','Sterile tube',      'Clear',      2),
  ('c3000000-0000-4000-8000-000000000007', '11111111-1111-4111-8111-111111111111', 'SWAB',   'Swab',                'Sterile swab',      'n/a',       24),
  ('c3000000-0000-4000-8000-000000000008', '11111111-1111-4111-8111-111111111111', 'TISSUE', 'Tissue',              'Formalin jar',      'n/a',      168)
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
  ('c4000000-0000-4000-8000-000000000001'::uuid, 'HEM',   'EDTA',   'CBC',     'Complete Blood Count',         '58410-2',   60, true,  true,  false, NULL, 'EDTA whole blood. No fasting required.'),
  ('c4000000-0000-4000-8000-000000000002'::uuid, 'CHEM',  'SERUM',  'FBS',     'Fasting Blood Sugar',          '1558-6',    60, true,  false, true,  8,    'Patient must fast 8 hours prior to draw.'),
  ('c4000000-0000-4000-8000-000000000003'::uuid, 'CHEM',  'EDTA',   'HBA1C',   'Glycated Haemoglobin (HbA1c)', '4548-4',   120, false, false, false, NULL, 'No fasting required.'),
  ('c4000000-0000-4000-8000-000000000004'::uuid, 'CHEM',  'SERUM',  'RFT',     'Renal Function Test',         '24323-8',  120, true,  true,  false, NULL, 'Serum. Include eGFR.'),
  ('c4000000-0000-4000-8000-000000000005'::uuid, 'CHEM',  'SERUM',  'LFT',     'Liver Function Test',          '24325-3',  120, true,  true,  false, NULL, 'Serum. Patient should avoid alcohol 24h prior.'),
  ('c4000000-0000-4000-8000-000000000006'::uuid, 'CHEM',  'SERUM',  'LIPID',   'Lipid Profile',               '57698-3',  120, false, true,  true,  12,   'Fasting 12 hours. Avoid high-fat meal prior.'),
  ('c4000000-0000-4000-8000-000000000007'::uuid, 'CHEM',  'URINE',  'UA',      'Urinalysis',                  '24357-6',   60, true,  true,  false, NULL, 'Clean-catch midstream urine.'),
  ('c4000000-0000-4000-8000-000000000008'::uuid, 'MICRO', 'BLOOD',  'BCULT',   'Blood Culture',               '600-7',   4320, true,  false, false, NULL, 'Blood culture bottle. Flag prior antibiotics.'),
  ('c4000000-0000-4000-8000-000000000009'::uuid, 'SER',   'SERUM',  'HBSAG',   'Hepatitis B Surface Antigen', '5195-3',   120, false, false, false, NULL, 'Serum. Consent per RA 10949 required.'),
  ('c4000000-0000-4000-8000-000000000010'::uuid, 'SER',   'SERUM',  'HIV',     'HIV Screening (Rapid)',       '75622-1',   60, false, false, false, NULL, 'Serum. Pre-test counselling required (RA 8504).'),
  ('c4000000-0000-4000-8000-000000000011'::uuid, 'SER',   'SERUM',  'DENGUE',  'Dengue NS1 Antigen',          '62468-4',   60, true,  false, false, NULL, 'Serum. Interpret with clinical correlation.'),
  ('c4000000-0000-4000-8000-000000000012'::uuid, 'SER',   'URINE',  'PREG',    'Pregnancy Test (Urine)',      '2106-3',    30, false, false, false, NULL, 'First morning urine preferred.'),
  ('c4000000-0000-4000-8000-000000000013'::uuid, 'HISTO', 'TISSUE', 'HISTO',   'Histopathology (Biopsy)',     '33717-0', 4320, false, true,  false, NULL, 'Tissue in 10% formalin. Requires pathologist report.')
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
  ('c5000000-0000-4000-8000-000000000001'::uuid, 'CBC',    'WBC',   'White Blood Cell Count',   'x10^9/L',       2, 1, false),
  ('c5000000-0000-4000-8000-000000000002'::uuid, 'CBC',    'RBC',   'Red Blood Cell Count',      'x10^12/L',      2, 2, false),
  ('c5000000-0000-4000-8000-000000000003'::uuid, 'CBC',    'HGB',   'Haemoglobin',               'g/dL',          1, 3, false),
  ('c5000000-0000-4000-8000-000000000004'::uuid, 'CBC',    'HCT',   'Haematocrit',               '%',             1, 4, false),
  ('c5000000-0000-4000-8000-000000000005'::uuid, 'CBC',    'PLT',   'Platelet Count',            'x10^9/L',       0, 5, false),
  ('c5000000-0000-4000-8000-000000000006'::uuid, 'CBC',    'MCV',   'Mean Corpuscular Volume',   'fL',            1, 6, false),
  -- FBS
  ('c5000000-0000-4000-8000-000000000007'::uuid, 'FBS',    'GLU',   'Glucose (fasting)',         'mmol/L',        2, 1, false),
  -- HBA1C
  ('c5000000-0000-4000-8000-000000000008'::uuid, 'HBA1C',  'HBA1C', 'Glycated Haemoglobin',     '%',             1, 1, false),
  -- RFT
  ('c5000000-0000-4000-8000-000000000009'::uuid, 'RFT',    'CREA',  'Creatinine',                'umol/L',        1, 1, false),
  ('c5000000-0000-4000-8000-000000000010'::uuid, 'RFT',    'BUN',   'Urea Nitrogen',            'mmol/L',        2, 2, false),
  ('c5000000-0000-4000-8000-000000000011'::uuid, 'RFT',    'EGFR',  'Estimated GFR',            'mL/min/1.73m2', 1, 3, true),
  -- LFT
  ('c5000000-0000-4000-8000-000000000012'::uuid, 'LFT',    'ALT',   'Alanine Transaminase',      'U/L',           0, 1, false),
  ('c5000000-0000-4000-8000-000000000013'::uuid, 'LFT',    'AST',   'Aspartate Transaminase',    'U/L',           0, 2, false),
  ('c5000000-0000-4000-8000-000000000014'::uuid, 'LFT',    'BILI',  'Total Bilirubin',           'umol/L',        1, 3, false),
  -- LIPID
  ('c5000000-0000-4000-8000-000000000015'::uuid, 'LIPID',  'TCHOL', 'Total Cholesterol',         'mmol/L',        2, 1, false),
  ('c5000000-0000-4000-8000-000000000016'::uuid, 'LIPID',  'TG',    'Triglycerides',             'mmol/L',        2, 2, false),
  ('c5000000-0000-4000-8000-000000000017'::uuid, 'LIPID',  'HDL',   'HDL Cholesterol',           'mmol/L',        2, 3, false),
  ('c5000000-0000-4000-8000-000000000018'::uuid, 'LIPID',  'LDL',   'LDL Cholesterol',           'mmol/L',        2, 4, true),
  -- UA
  ('c5000000-0000-4000-8000-000000000019'::uuid, 'UA',     'UAPROT','Protein (urine)',           'mg/dL',         0, 1, false),
  ('c5000000-0000-4000-8000-000000000020'::uuid, 'UA',     'UAGLU', 'Glucose (urine)',           'mg/dL',         0, 2, false),
  ('c5000000-0000-4000-8000-000000000021'::uuid, 'UA',     'ULEUK', 'Leucocytes (urine)',         '/uL',           0, 3, false),
  -- Serology
  ('c5000000-0000-4000-8000-000000000022'::uuid, 'HBSAG',  'HBSAG', 'HBsAg Result',              'INDEX',         0, 1, false),
  ('c5000000-0000-4000-8000-000000000023'::uuid, 'HIV',    'HIVRES','HIV Screening Result',      'INDEX',         0, 1, false),
  ('c5000000-0000-4000-8000-000000000024'::uuid, 'DENGUE', 'NS1',   'Dengue NS1 Antigen',         'INDEX',         0, 1, false),
  ('c5000000-0000-4000-8000-000000000025'::uuid, 'PREG',   'PREG',  'Pregnancy Result',          'INDEX',         0, 1, false),
  -- Microbiology / histopathology
  ('c5000000-0000-4000-8000-000000000026'::uuid, 'BCULT',  'ORG',   'Organism Isolated',         'text',          0, 1, false),
  ('c5000000-0000-4000-8000-000000000027'::uuid, 'HISTO',  'MICRO', 'Microscopic Description',    'text',          0, 1, false),
  ('c5000000-0000-4000-8000-000000000028'::uuid, 'HISTO',  'DIAG',  'Histopathological Diagnosis','text',          0, 2, false)
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
  ('c7000000-0000-4000-8000-000000000001'::uuid, 'HEM',   'INST-HEM-01', 'Haematology Analyser',    'Sysmex XN-1000'),
  ('c7000000-0000-4000-8000-000000000002'::uuid, 'CHEM',  'INST-CHEM-01','Chemistry Analyser',      'Roche Cobas c311'),
  ('c7000000-0000-4000-8000-000000000003'::uuid, 'MICRO', 'INST-BCUL-01','Blood Culture Incubator','BacT/ALERT 3D')
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
  ('b4000000-0000-4000-8000-000000000201'::uuid, 'SUP-ORAL-SYR-5',   'Oral Syringe 5mL',         'Pharmacy Supplies',               'PC', false, false, false,  3.20,   0),
  ('b4000000-0000-4000-8000-000000000202'::uuid, 'SUP-ORAL-SYR-10',  'Oral Syringe 10mL',        'Pharmacy Supplies',               'PC', false, false, false,  4.10,   0),
  ('b4000000-0000-4000-8000-000000000203'::uuid, 'SUP-IV-SET',       'IV Giving Set',            'Pharmacy Supplies',               'PC', true,  true,  false,  95.00,  180),
  ('b4000000-0000-4000-8000-000000000204'::uuid, 'SUP-COTTON-BALL',  'Cotton Balls 500s',        'Pharmacy Supplies',               'BX', false, false, false,  85.00,   0),
  ('b4000000-0000-4000-8000-000000000205'::uuid, 'SUP-GAUZE-4X4',    'Gauze Pads 4x4 100s',      'Pharmacy Supplies',               'BX', false, false, false,  110.00,  0),
  ('b4000000-0000-4000-8000-000000000206'::uuid, 'SUP-ALCOHOL-SWAB', 'Alcohol Swabs 100s',       'Pharmacy Supplies',               'BX', true,  true,  true,   95.00,  24),
  -- Laboratory supplies
  ('b4000000-0000-4000-8000-000000000207'::uuid, 'LAB-VAC-EDTA',     'Vacutainer EDTA 3mL 100s', 'Laboratory Supplies',              'BX', true,  true,  false,  980.00,  365),
  ('b4000000-0000-4000-8000-000000000208'::uuid, 'LAB-VAC-SER',     'Vacutainer Serum 3mL 100s','Laboratory Supplies',              'BX', true,  true,  false,  1020.00, 365),
  ('b4000000-0000-4000-8000-000000000209'::uuid, 'LAB-URINE-CUP',   'Urine Collection Container','Laboratory Supplies',             'PC', false, false, false,  18.00,   0),
  ('b4000000-0000-4000-8000-000000000210'::uuid, 'LAB-SLIDE',       'Microscope Slides 100s',    'Laboratory Supplies',              'BX', false, false, false,  120.00,  0),
  ('b4000000-0000-4000-8000-000000000211'::uuid, 'LAB-COVERSLIP',   'Cover Slips 100s',          'Laboratory Supplies',              'BX', false, false, false,  65.00,   0),
  ('b4000000-0000-4000-8000-000000000212'::uuid, 'LAB-TUBE-RACK',   'Tube Rack 50-place',        'Laboratory Supplies',              'PC', false, false, false,  450.00,  0),
  -- Clinical consumables
  ('b4000000-0000-4000-8000-000000000213'::uuid, 'CLN-BP-CUFF',      'Sphygmomanometer Cuff',    'Clinical Consumables',             'EA', false, false, false,  1250.00, 0),
  ('b4000000-0000-4000-8000-000000000214'::uuid, 'CLN-THERMO',      'Digital Thermometer',      'Clinical Consumables',             'EA', false, false, false,  350.00,  0),
  ('b4000000-0000-4000-8000-000000000215'::uuid, 'CLN-TAPE',        'Adhesive Tape 1in',         'Clinical Consumables',             'RL', false, false, false,  28.00,   0),
  -- Personal protective equipment
  ('b4000000-0000-4000-8000-000000000216'::uuid, 'PPE-GLOVE-M',     'Exam Gloves (Medium) 100s','Personal Protective Equipment',   'BX', false, false, false,  420.00,  0),
  ('b4000000-0000-4000-8000-000000000217'::uuid, 'PPE-GLOVE-L',     'Exam Gloves (Large) 100s', 'Personal Protective Equipment',   'BX', false, false, false,  420.00,  0),
  ('b4000000-0000-4000-8000-000000000218'::uuid, 'PPE-MASK-SURG',   'Surgical Mask 50s',         'Personal Protective Equipment',   'BX', false, true,  false,  180.00,  0),
  ('b4000000-0000-4000-8000-000000000219'::uuid, 'PPE-N95',         'N95 Respirator 20s',       'Personal Protective Equipment',   'BX', false, true,  false,  980.00,  0),
  -- Stationery
  ('b4000000-0000-4000-8000-000000000220'::uuid, 'STA-RX-PAD',      'Prescription Pad 100s',     'Stationery',                      'BX', false, false, false,  150.00,  0)
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
  ('d1000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'CONSULT-GEN',   'General Consultation',        'consult', 500.00),
  ('d1000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'CONSULT-FU',    'Follow-up Consultation',     'consult', 300.00),
  ('d1000000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', 'LAB-CBC',       'Complete Blood Count',       'lab',     350.00),
  ('d1000000-0000-4000-8000-000000000004', '11111111-1111-4111-8111-111111111111', 'LAB-FBS',       'Fasting Blood Sugar',        'lab',     120.00),
  ('d1000000-0000-4000-8000-000000000005', '11111111-1111-4111-8111-111111111111', 'LAB-HBA1C',     'Glycated Haemoglobin',       'lab',     450.00),
  ('d1000000-0000-4000-8000-000000000006', '11111111-1111-4111-8111-111111111111', 'LAB-RFT',       'Renal Function Test',        'lab',     500.00),
  ('d1000000-0000-4000-8000-000000000007', '11111111-1111-4111-8111-111111111111', 'LAB-LFT',       'Liver Function Test',         'lab',     600.00),
  ('d1000000-0000-4000-8000-000000000008', '11111111-1111-4111-8111-111111111111', 'LAB-LIPID',     'Lipid Profile',              'lab',     550.00),
  ('d1000000-0000-4000-8000-000000000009', '11111111-1111-4111-8111-111111111111', 'LAB-UA',        'Urinalysis',                 'lab',     100.00),
  ('d1000000-0000-4000-8000-000000000010', '11111111-1111-4111-8111-111111111111', 'LAB-BCULT',     'Blood Culture',              'lab',     1200.00),
  ('d1000000-0000-4000-8000-000000000011', '11111111-1111-4111-8111-111111111111', 'LAB-HBSAG',     'Hepatitis B Surface Antigen','lab',     150.00),
  ('d1000000-0000-4000-8000-000000000012', '11111111-1111-4111-8111-111111111111', 'LAB-HIV',       'HIV Screening (Rapid)',      'lab',     250.00),
  ('d1000000-0000-4000-8000-000000000013', '11111111-1111-4111-8111-111111111111', 'LAB-DENGUE',    'Dengue NS1 Antigen',         'lab',     400.00),
  ('d1000000-0000-4000-8000-000000000014', '11111111-1111-4111-8111-111111111111', 'LAB-PREG',      'Pregnancy Test (Urine)',     'lab',     100.00),
  ('d1000000-0000-4000-8000-000000000015', '11111111-1111-4111-8111-111111111111', 'LAB-HISTO',     'Histopathology (Biopsy)',    'lab',     2500.00)
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
-- 10. Patients — exactly three
--     These are the three this seed creates. It does not remove any other
--     patient the tenant already holds (see SCOPE NOTE 4).
--
--     patients.id is a GLOBAL primary key, not a composite one. A bare
--     `ON CONFLICT (id) DO UPDATE` would therefore follow the row wherever it
--     already lives: pointed at any tenant but demo-a it would rewrite demo-a's
--     patients (name, DOB, gender, status) without transferring ownership, and
--     the patient then silently fails to exist for the tenant being seeded.
--     The WHERE clause makes the update a no-op unless the colliding row is
--     already this tenant's, and the pre-flight guard below refuses the whole
--     seed rather than writing across a tenant boundary.
-- ============================================================================

DO $$
DECLARE
  v_foreign text;
BEGIN
  SELECT string_agg(p.id::text, ', ') INTO v_foreign
  FROM (VALUES
          ('a4000000-0000-4000-8000-000000000001'::uuid),
          ('a4000000-0000-4000-8000-000000000002'::uuid),
          ('a4000000-0000-4000-8000-000000000003'::uuid)) AS s(id)
  JOIN patients p ON p.id = s.id
  WHERE p.tenant_id <> '11111111-1111-4111-8111-111111111111';

  IF v_foreign IS NOT NULL THEN
    RAISE EXCEPTION
      'demo_clean: seeded patient ids [%] already belong to another tenant — refusing to write across the tenant boundary. Point --tenant at a tenant whose patient ids are free, or re-key these patients.',
      v_foreign;
  END IF;
END $$;

INSERT INTO patients (id, tenant_id, first_name, middle_name, last_name, date_of_birth, gender, status) VALUES
  ('a4000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'Maria Elena', 'Cruz',     'Santos',    '1988-04-12', 'FEMALE', 'ACTIVE'),
  ('a4000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'Juan Carlos', 'Bautista', 'Dela Cruz', '1975-11-23', 'MALE',   'ACTIVE'),
  ('a4000000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', 'Angelita',   'Manalo',   'Reyes',     '1994-08-30', 'FEMALE', 'ACTIVE')
ON CONFLICT (id) DO UPDATE
  SET first_name = EXCLUDED.first_name, middle_name = EXCLUDED.middle_name,
      last_name = EXCLUDED.last_name, date_of_birth = EXCLUDED.date_of_birth,
      gender = EXCLUDED.gender, status = 'ACTIVE', updated_at = now()
  WHERE patients.tenant_id = EXCLUDED.tenant_id;

-- Identifiers (PATIENT_NO + MRN share the demo number).
-- patient_identifiers has only a surrogate PK, so `ON CONFLICT DO NOTHING`
-- would silently append a duplicate on every re-run. Guard on the natural key.
-- The JOIN to patients re-asserts tenancy, so an identifier can never be
-- attached to a patient this tenant does not own.
INSERT INTO patient_identifiers (tenant_id, patient_id, type, value)
SELECT '11111111-1111-4111-8111-111111111111', p.id, v.type, v.value
FROM (VALUES
  ('a4000000-0000-4000-8000-000000000001'::uuid, 'PATIENT_NO', 'PAT-2026-0001'),
  ('a4000000-0000-4000-8000-000000000001'::uuid, 'MRN',        'PAT-2026-0001'),
  ('a4000000-0000-4000-8000-000000000002'::uuid, 'PATIENT_NO', 'PAT-2026-0002'),
  ('a4000000-0000-4000-8000-000000000002'::uuid, 'MRN',        'PAT-2026-0002'),
  ('a4000000-0000-4000-8000-000000000003'::uuid, 'PATIENT_NO', 'PAT-2026-0003'),
  ('a4000000-0000-4000-8000-000000000003'::uuid, 'MRN',        'PAT-2026-0003')
) AS v(patient_id, type, value)
JOIN patients p ON p.tenant_id = '11111111-1111-4111-8111-111111111111' AND p.id = v.patient_id
WHERE NOT EXISTS (
  SELECT 1 FROM patient_identifiers i
  WHERE i.tenant_id = '11111111-1111-4111-8111-111111111111'
    AND i.patient_id = v.patient_id AND i.type = v.type AND i.value = v.value
);

-- Park the PAT-2026 counter above the hardcoded numbers above.
-- `createPatient` mints `PAT-2026-<n>` via app.next_doc_no(); without this the
-- counter starts at 0 and the first registration issued in this tenant
-- collides with the seeded PAT-2026-0001. Seeded to GREATEST so a tenant that
-- has already issued numbers is never rewound onto a duplicate.
INSERT INTO number_sequences (tenant_id, sequence_key, current_value, updated_at)
VALUES ('11111111-1111-4111-8111-111111111111', 'PAT-2026', 3, now())
ON CONFLICT (tenant_id, sequence_key) DO UPDATE
  SET current_value = GREATEST(number_sequences.current_value, EXCLUDED.current_value),
      updated_at = now();

-- Contacts. Same surrogate-PK-only situation as identifiers, same tenancy join.
INSERT INTO patient_contacts (tenant_id, patient_id, type, value, is_primary)
SELECT '11111111-1111-4111-8111-111111111111', p.id, v.type, v.value, v.is_primary
FROM (VALUES
  ('a4000000-0000-4000-8000-000000000001'::uuid, 'PHONE', '0917-555-0192', true),
  ('a4000000-0000-4000-8000-000000000001'::uuid, 'EMAIL', 'maria.santos@example.test', false),
  ('a4000000-0000-4000-8000-000000000002'::uuid, 'PHONE', '0918-555-0344', true),
  ('a4000000-0000-4000-8000-000000000002'::uuid, 'EMAIL', 'jcdelacruz@example.test', false),
  ('a4000000-0000-4000-8000-000000000003'::uuid, 'PHONE', '0920-555-0811', true)
) AS v(patient_id, type, value, is_primary)
JOIN patients p ON p.tenant_id = '11111111-1111-4111-8111-111111111111' AND p.id = v.patient_id
WHERE NOT EXISTS (
  SELECT 1 FROM patient_contacts c
  WHERE c.tenant_id = '11111111-1111-4111-8111-111111111111'
    AND c.patient_id = v.patient_id AND c.type = v.type AND c.value = v.value
);


-- ============================================================================
-- 11. Self-verification — fail the whole seed if the shape is wrong.
-- ============================================================================

DO $$
DECLARE
  v_missing text;
BEGIN
  -- Exactly the ten entitled modules.
  SELECT string_agg(m, ', ') INTO v_missing
  FROM unnest(ARRAY['admin','patients','clinical','laboratory','pharmacy',
                    'supply','billing','compliance','notifications','reports']) AS m
  WHERE NOT EXISTS (
    SELECT 1 FROM tenant_modules tm
    WHERE tm.tenant_id = '11111111-1111-4111-8111-111111111111'
      AND tm.module = m AND tm.status = 'ENABLED'
  );
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'demo_clean: modules not ENABLED: %', v_missing;
  END IF;

  -- The three staff accounts must each hold exactly the intended role.
  IF (SELECT count(*) FROM users u
      JOIN user_roles ur ON ur.tenant_id = u.tenant_id AND ur.user_id = u.id
      JOIN roles r ON r.tenant_id = ur.tenant_id AND r.id = ur.role_id
      WHERE u.tenant_id = '11111111-1111-4111-8111-111111111111'
        AND u.email IN ('admin@demo-a.test','doctor@demo-a.test','nurse@demo-a.test')
        AND u.status = 'ACTIVE' AND r.code IN ('tenant_admin','doctor','nurse')
     ) <> 3 THEN
    RAISE EXCEPTION 'demo_clean: expected 3 active staff accounts with tenant_admin/doctor/nurse roles';
  END IF;

  -- Every seeded account must be reachable from the tenant's MAIN branch (G-02).
  IF (SELECT count(*) FROM users u
      JOIN user_branches ub ON ub.tenant_id = u.tenant_id AND ub.user_id = u.id
      JOIN branches b ON b.tenant_id = ub.tenant_id AND b.id = ub.branch_id AND b.code = 'MAIN'
      WHERE u.tenant_id = '11111111-1111-4111-8111-111111111111'
        AND u.email IN ('admin@demo-a.test','doctor@demo-a.test','nurse@demo-a.test')
     ) <> 3 THEN
    RAISE EXCEPTION 'demo_clean: all 3 seeded staff must be assigned to branch MAIN';
  END IF;

  -- All three seeded staff must carry an employee record, and the prescribing
  -- doctor must hold the full licence set. Without this the prescription pad
  -- degrades to "Dr. Attending Physician, MD" with "N/A" licence numbers
  -- (specification CLN-T5, RA 6675 / RA 9165).
  IF (SELECT count(*) FROM users u
      JOIN employees e ON e.tenant_id = u.tenant_id AND e.user_id = u.id
      WHERE u.tenant_id = '11111111-1111-4111-8111-111111111111'
        AND u.email IN ('admin@demo-a.test','doctor@demo-a.test','nurse@demo-a.test')
        AND e.status = 'ACTIVE' AND e.job_title <> ''
     ) <> 3 THEN
    RAISE EXCEPTION 'demo_clean: all 3 seeded staff must have an ACTIVE employees record';
  END IF;

  IF (SELECT count(*) FROM users u
      JOIN employees e ON e.tenant_id = u.tenant_id AND e.user_id = u.id
      WHERE u.tenant_id = '11111111-1111-4111-8111-111111111111'
        AND u.email = 'doctor@demo-a.test'
        AND e.prc_license_no IS NOT NULL AND e.prc_license_no <> ''
        AND e.ptr_no IS NOT NULL AND e.ptr_no <> ''
        AND e.s2_license_no IS NOT NULL AND e.s2_license_no <> ''
     ) <> 1 THEN
    RAISE EXCEPTION 'demo_clean: demo-a doctor must hold PRC, PTR and S2 licence numbers';
  END IF;

  -- The three seeded patients must exist and be ACTIVE.
  IF (SELECT count(*) FROM patients p
      WHERE p.tenant_id = '11111111-1111-4111-8111-111111111111'
        AND p.id IN ('a4000000-0000-4000-8000-000000000001',
                     'a4000000-0000-4000-8000-000000000002',
                     'a4000000-0000-4000-8000-000000000003')
        AND p.status = 'ACTIVE'
     ) <> 3 THEN
    RAISE EXCEPTION 'demo_clean: expected the 3 seeded patients to be present and ACTIVE';
  END IF;

  -- Every seeded patient must carry a PATIENT_NO.
  IF (SELECT count(DISTINCT i.patient_id) FROM patient_identifiers i
      WHERE i.tenant_id = '11111111-1111-4111-8111-111111111111'
        AND i.type = 'PATIENT_NO'
        AND i.patient_id IN ('a4000000-0000-4000-8000-000000000001',
                             'a4000000-0000-4000-8000-000000000002',
                             'a4000000-0000-4000-8000-000000000003')
     ) <> 3 THEN
    RAISE EXCEPTION 'demo_clean: every seeded patient must hold a PATIENT_NO';
  END IF;

  -- Ledger hygiene is REPORTED, never repaired.
  --
  -- patient_identifiers and patient_contacts have a surrogate PK only, so a
  -- re-run of an older seed that used `ON CONFLICT DO NOTHING` never conflicted
  -- and appended a fresh copy every time. This seed's NOT EXISTS guards make
  -- that impossible going forward, but they cannot undo copies that already
  -- exist — and deleting rows the seed did not create would violate the
  -- additive guarantee. So a duplicate is a data-quality finding about the
  -- tenant, surfaced as a WARNING; treating it as fatal would only block
  -- master-data loading on a tenant this seed has no way to repair.
  SELECT string_agg(label || ' x' || n, '; ' ORDER BY label) INTO v_missing
  FROM (
    SELECT i.patient_id::text || ' ' || i.type || '=' || i.value AS label, count(*) AS n
    FROM patient_identifiers i
    WHERE i.tenant_id = '11111111-1111-4111-8111-111111111111'
      AND i.patient_id IN ('a4000000-0000-4000-8000-000000000001',
                           'a4000000-0000-4000-8000-000000000002',
                           'a4000000-0000-4000-8000-000000000003')
    GROUP BY i.patient_id, i.type, i.value
    HAVING count(*) > 1
    UNION ALL
    SELECT c.patient_id::text || ' ' || c.type || '=' || c.value, count(*)
    FROM patient_contacts c
    WHERE c.tenant_id = '11111111-1111-4111-8111-111111111111'
      AND c.patient_id IN ('a4000000-0000-4000-8000-000000000001',
                           'a4000000-0000-4000-8000-000000000002',
                           'a4000000-0000-4000-8000-000000000003')
    GROUP BY c.patient_id, c.type, c.value
    HAVING count(*) > 1
  ) dupes;
  IF v_missing IS NOT NULL THEN
    RAISE WARNING
      'demo_clean: duplicate patient identifiers/contacts PRE-DATE this seed and were left untouched (%). Fix them with a reviewed, audited cleanup — do not expect this seed to repair them.',
      v_missing;
  END IF;

  -- Master data must be present.
  --
  -- Every check below is scoped to the rows THIS seed owns, by natural key, not
  -- to a tenant-wide total. A tenant-wide `count(*) >= N` would pass trivially on
  -- a tenant that already holds hundreds of unrelated rows while proving nothing
  -- about this seed; scoping it means the assertion actually fails when a seeded
  -- master row is missing or silently unattached.
  IF (SELECT count(*) FROM drug_products d
      JOIN items i ON i.tenant_id = d.tenant_id AND i.id = d.item_id
      WHERE d.tenant_id = '11111111-1111-4111-8111-111111111111'
        AND i.code IN ('MED-AMOX-500','MED-AMOX-SUS','MED-AZI-500','MED-PARA-500','MED-PARA-SUS',
                       'MED-IBU-200','MED-MET-500','MED-MET-850','MED-AML-5','MED-LOS-50',
                       'MED-HCTZ-25','MED-SIM-20','MED-OME-20','MED-SAL-NEB','MED-CET-5','MED-IBU-400')
     ) <> 16 THEN
    RAISE EXCEPTION 'demo_clean: the 16 seeded formulary products are not all present and attached to an item';
  END IF;

  IF (SELECT count(*) FROM lab_tests
      WHERE tenant_id = '11111111-1111-4111-8111-111111111111'
        AND code IN ('CBC','FBS','HBA1C','RFT','LFT','LIPID','UA','BCULT','HBSAG','HIV','DENGUE','PREG','HISTO')
     ) <> 13 THEN
    RAISE EXCEPTION 'demo_clean: the 13 seeded lab tests are not all present';
  END IF;

  IF (SELECT count(*) FROM lab_analytes a
      JOIN lab_tests t ON t.tenant_id = a.tenant_id AND t.id = a.test_id
      WHERE a.tenant_id = '11111111-1111-4111-8111-111111111111'
        AND t.code IN ('CBC','FBS','HBA1C','RFT','LFT','LIPID','UA','BCULT','HBSAG','HIV','DENGUE','PREG','HISTO')
     ) <> 28 THEN
    RAISE EXCEPTION 'demo_clean: the 28 seeded analytes are not all present';
  END IF;

  IF (SELECT count(*) FROM lab_reference_ranges r
      JOIN lab_analytes a ON a.tenant_id = r.tenant_id AND a.id = r.analyte_id
      JOIN lab_tests t    ON t.tenant_id = a.tenant_id AND t.id = a.test_id
      WHERE r.tenant_id = '11111111-1111-4111-8111-111111111111'
        AND t.code IN ('CBC','FBS','HBA1C','RFT','LFT','LIPID','UA','BCULT','HBSAG','HIV','DENGUE','PREG','HISTO')
     ) <> 25 THEN
    RAISE EXCEPTION 'demo_clean: the 25 seeded reference ranges are not all present';
  END IF;

  IF (SELECT count(*) FROM items
      WHERE tenant_id = '11111111-1111-4111-8111-111111111111'
        AND code IN ('SUP-ORAL-SYR-5','SUP-ORAL-SYR-10','SUP-IV-SET','SUP-COTTON-BALL','SUP-GAUZE-4X4',
                     'SUP-ALCOHOL-SWAB','LAB-VAC-EDTA','LAB-VAC-SER','LAB-URINE-CUP','LAB-SLIDE',
                     'LAB-COVERSLIP','LAB-TUBE-RACK','CLN-BP-CUFF','CLN-THERMO','CLN-TAPE',
                     'PPE-GLOVE-M','PPE-GLOVE-L','PPE-MASK-SURG','PPE-N95','STA-RX-PAD')
     ) <> 20 THEN
    RAISE EXCEPTION 'demo_clean: the 20 seeded central-supply items are not all present';
  END IF;

  -- Every SEEDED lab test must resolve to a priced service, so billing can price
  -- an order server-side (ground rule: never compute money on the client).
  IF (SELECT count(*) FROM lab_tests t
      WHERE t.tenant_id = '11111111-1111-4111-8111-111111111111'
        AND t.code IN ('CBC','FBS','HBA1C','RFT','LFT','LIPID','UA','BCULT','HBSAG','HIV','DENGUE','PREG','HISTO')
        AND t.service_id IS NULL) > 0 THEN
    RAISE EXCEPTION 'demo_clean: every seeded lab test must resolve to a priced service';
  END IF;

  -- Likewise every seeded medicine must resolve to its priced service.
  -- Scoped to the 16 seeded codes: a `LIKE 'MED-%'` scope would also cover the
  -- ~230 load-test rows other tooling left in this tenant and fail on rows this
  -- seed neither created nor is responsible for.
  IF (SELECT count(*) FROM items i
      WHERE i.tenant_id = '11111111-1111-4111-8111-111111111111'
        AND i.code IN ('MED-AMOX-500','MED-AMOX-SUS','MED-AZI-500','MED-PARA-500','MED-PARA-SUS',
                       'MED-IBU-200','MED-MET-500','MED-MET-850','MED-AML-5','MED-LOS-50',
                       'MED-HCTZ-25','MED-SIM-20','MED-OME-20','MED-SAL-NEB','MED-CET-5','MED-IBU-400')
        AND i.service_id IS NULL) > 0 THEN
    RAISE EXCEPTION 'demo_clean: every seeded medicine must resolve to a priced service';
  END IF;

  -- Every seeded role must actually have grants (guards against a filter typo
  -- silently matching zero permissions).
  IF (SELECT count(*) FROM roles r
      WHERE r.tenant_id = '11111111-1111-4111-8111-111111111111'
        AND r.code IN ('tenant_admin','doctor','nurse','pharmacist_dispenser','receptionist')
        AND NOT EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.tenant_id = r.tenant_id AND rp.role_id = r.id)
     ) > 0 THEN
    RAISE EXCEPTION 'demo_clean: a seeded role ended up with zero permissions (filter typo?)';
  END IF;

  -- SoD: no seeded role may hold both sides of a declared conflict pair.
  SELECT string_agg(DISTINCT r.code || ' holds ' || s.permission_a || ' + ' || s.permission_b, '; ')
    INTO v_missing
  FROM sod_conflicts s
  CROSS JOIN (VALUES
    ('tenant_admin'::text), ('doctor'::text), ('nurse'::text),
    ('pharmacist_dispenser'::text), ('receptionist'::text)) AS rr(role_code)
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
    RAISE EXCEPTION 'demo_clean: segregation-of-duty violation -> %', v_missing;
  END IF;

  RAISE NOTICE 'demo_clean: verified — 10 modules, 5 staff on MAIN, 3 patients, pharmacy/lab/supply master data, no SoD conflicts';
END $$;

COMMIT;
