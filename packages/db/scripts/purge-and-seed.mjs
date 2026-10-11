#!/usr/bin/env node
/**
 * purge-and-seed.mjs — Destructive QA Reset & Baseline Seed for Demo Tenant.
 *
 * Credential-free: reads CLINIC_DATABASE_URL only.
 *
 * Usage:
 *   pnpm --filter @clinic/db purge:demo             # Dry run (rolls back at the end)
 *   pnpm --filter @clinic/db purge:demo -- --apply  # DESTROYS transactions and re-seeds baseline
 *   pnpm db:purge:demo                              # Shortcut from repo root
 *
 * Target Baseline after running with --apply:
 *   - 3 Patients:
 *       1. Maria Elena Santos   (PAT-2026-0001, PhilHealth Registered, Penicillin allergy)
 *       2. Juan Carlos Dela Cruz (PAT-2026-0002, PhilHealth Registered)
 *       3. Angelita Reyes       (PAT-2026-0003, PhilHealth Pending)
 *   - 9 Users (Password: DemoPassw0rd!2026) — MUST match demo_clean.sql §4:
 *       1. admin@demo-a.test      (role: tenant_admin)
 *       2. doctor@demo-a.test     (role: doctor)
 *       3. nurse@demo-a.test      (role: nurse)
 *       4. dispenser@demo-a.test  (role: pharmacist_dispenser)
 *       5. staff@demo-a.test      (role: receptionist)
 *       6. verifier@demo-a.test   (role: pharmacist_verifier)
 *       7. labtech@demo-a.test    (role: lab_technologist)
 *       8. labverify@demo-a.test  (role: lab_verifier)
 *       9. storekeeper@demo-a.test (role: storekeeper)
 *   - Comprehensive Masters:
 *       - Laboratory: Hematology, Chemistry, Microscopy, Serology, Microbiology
 *                     CBC, Urinalysis, Fecalysis, FBS, HbA1c, Lipid, Chem-8, Liver/Electrolytes, Dengue, etc.
 *       - Central Supply: 30 clinical consumable items, categories, UOMs, depot & clinic room locations
 *       - Pharmacy: 31 Philippine formulary medicines with generics, drug products, and pricing rules
 *       - Services: Consultations, minor procedures, lab fees, clearance certificates
 *       - Payment Methods & Discounts: Cash, GCash, Maya, Cards, HMO, Senior, PWD, Solo Parent, etc.
 *   - All transactional encounter, visit, billing, lab orders, dispenses, and stock movements PURGED.
 */
import pg from 'pg';
import { seedComprehensiveMasterData } from './seed_comprehensive_master_data.mjs';

const argv = process.argv.slice(2);
const has = (flag) => argv.includes(flag);
const getOption = (flag, fallback) => {
  const idx = argv.indexOf(flag);
  return idx !== -1 && argv[idx + 1] ? argv[idx + 1] : fallback;
};

const APPLY = has('--apply');
const ZERO_STOCK = has('--zero-stock');
const TENANT_ID = getOption('--tenant', '11111111-1111-4111-8111-111111111111');
const BRANCH_ID = getOption('--branch', 'a1000000-0000-4000-8000-000000000001');

const DEMO_PASSWORD_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$PJbfK+fX4INlaV6B1J1P9Q$r8KelzGMcN1aCKjlBfUifGfeT1j7Wnk7sl8WlLr624I';

// Keep this list in lockstep with demo_clean.sql §4 (the canonical demo staff
// set) and with the login-page DEV shortcuts — a purge that drops an account
// the login screen advertises presents as "login is broken", not "seeder drift".
// The clinical/bench roles (dispenser, verifier, labtechnologist, labverifier,
// storekeeper) get their grants from migrations 0055–0057, not from Step 9.
const SEED_USERS = [
  { email: 'admin@demo-a.test',      name: 'Demo A — Tenant Admin',          role: 'tenant_admin'          },
  { email: 'doctor@demo-a.test',     name: 'Demo A — Doctor',                role: 'doctor'                },
  { email: 'nurse@demo-a.test',      name: 'Demo A — Nurse',                 role: 'nurse'                 },
  { email: 'dispenser@demo-a.test',  name: 'Demo A — Pharmacist',            role: 'pharmacist_dispenser'  },
  { email: 'staff@demo-a.test',      name: 'Demo A — Receptionist',          role: 'receptionist'          },
  { email: 'verifier@demo-a.test',   name: 'Demo A — Pharmacist Verifier',   role: 'pharmacist_verifier'   },
  { email: 'labtech@demo-a.test',    name: 'Demo A — Medical Technologist',  role: 'lab_technologist'      },
  { email: 'labverify@demo-a.test',  name: 'Demo A — Lab Verifier',          role: 'lab_verifier'          },
  { email: 'storekeeper@demo-a.test', name: 'Demo A — Storekeeper',          role: 'storekeeper'           },
];

const SEED_PATIENTS = [
  {
    id: 'a4000000-0000-4000-8000-000000000001',
    firstName: 'Maria Elena',
    lastName: 'Santos',
    middleName: 'Cruz',
    dob: '1988-04-12',
    gender: 'FEMALE',
    patientNo: 'PAT-2026-0001',
    phone: '0917-555-0192',
    email: 'maria.santos@gmail.com',
    philhealthNo: '12-345678901-2',
    konsultaStatus: 'REGISTERED',
    allergy: { substance: 'Penicillin', severity: 'Severe Urticaria' },
  },
  {
    id: 'a4000000-0000-4000-8000-000000000002',
    firstName: 'Juan Carlos',
    lastName: 'Dela Cruz',
    middleName: 'Bautista',
    dob: '1975-11-23',
    gender: 'MALE',
    patientNo: 'PAT-2026-0002',
    phone: '0918-555-0344',
    email: 'jcdelacruz@yahoo.com',
    philhealthNo: '09-876543210-9',
    konsultaStatus: 'REGISTERED',
  },
  {
    id: 'a4000000-0000-4000-8000-000000000003',
    firstName: 'Angelita',
    lastName: 'Reyes',
    middleName: 'Manalo',
    dob: '1994-08-30',
    gender: 'FEMALE',
    patientNo: 'PAT-2026-0003',
    phone: '0920-555-0811',
    email: 'angie.reyes@outlook.ph',
    konsultaStatus: 'PENDING',
  },
];

// Ordered by foreign-key depth (children first)
const TRANSACTIONAL_TABLES = [
  // 1. Billing & Finance
  'payment_allocations',
  'payment_splits',
  'payment_reprints',
  'credit_notes',
  'payments',
  'discount_applications',
  'invoice_lines',
  'invoices',
  'billing_charges',
  'daily_cashier_summaries',
  'cash_sessions',
  'cashier_shifts',
  // 2. Pharmacy Transactions
  'patient_returns',
  'controlled_register',
  'dispense_items',
  'dispenses',
  'special_rx_records',
  'pharmacist_interventions',
  'interaction_decisions',
  'medication_administrations',
  'prescription_items',
  'prescriptions',
  // 3. Laboratory Transactions
  'lab_critical_notifications',
  'lab_result_amendments',
  'lab_results',
  'lab_reports',
  'specimen_events',
  'specimens',
  'lab_order_items',
  'lab_orders',
  'lab_send_outs',
  'lab_qc_results',
  'lab_qc_runs',
  // 4. Clinical Encounters & Records
  'clinical_notes',
  'medical_certificates',
  'referrals',
  'visit_procedures',
  'visit_diagnoses',
  'vitals',
  'immunizations',
  'problem_list',
  'queue_tickets',
  'appointments',
  // 4b. Patient supply requisitions bridge clinical -> supply: they FK to both
  //     `visits` AND `patient_supply_request_items`, so they must be cleared
  //     before `visits`. Added with the central-supply module; their absence
  //     made Step 4 fail on visits_tenant_id_patient_id_fkey.
  'patient_supply_request_items',
  'patient_supply_requests',
  'visits',
  // 5. Supply & Inventory Transactions
  'stock_issue_items',
  'stock_issues',
  'stock_transfer_items',
  'stock_transfers',
  'consumption_logs',
  'disposal_items',
  'disposals',
  'recall_batches',
  'recalls',
  'supplier_return_items',
  'supplier_returns',
  'stock_adjustment_items',
  'stock_adjustments',
  'physical_count_items',
  'physical_counts',
  'valuation_snapshots',
  'stock_movements',
  'stock_balances',
  'supplier_invoices',
  'goods_receipt_items',
  'goods_receipts',
  'purchase_order_items',
  'purchase_orders',
  'purchase_request_items',
  'purchase_requests',
  'requisition_items',
  'requisitions',
  'stock_batches',
  // 6. Operational, audit residue, telemetry, auth sessions
  'data_subject_requests',
  'access_reviews',
  'access_review_decisions',
  'files',
  'file_versions',
  'report_runs',
  'report_schedules',
  'pidsr_cases',
  'breach_incidents',
  'sessions',
  'password_resets',
  'mfa_secrets',
  'mfa_recovery_codes',
  'mfa_trusted_devices',
  'user_notification_preferences',
  'login_attempts',
  // 7. Patient dependents / flags / merges / consents
  'patient_flags',
  'patient_consents',
  'patient_merges',
  'patient_philhealth_dependents',
];

const APPEND_ONLY_TRIGGERS = [
  ['controlled_register', 'trg_deny_delete_controlled_register'],
  ['controlled_register', 'trg_deny_update_controlled_register'],
  ['stock_movements', 'stock_movements_deny_delete'],
  ['stock_movements', 'stock_movements_deny_update'],
  ['stock_movements_p_default', 'stock_movements_deny_delete'],
  ['stock_movements_p_default', 'stock_movements_deny_update'],
];

async function run() {
  const connectionString = process.env.CLINIC_DATABASE_URL;
  if (!connectionString) {
    console.error('purge-and-seed: CLINIC_DATABASE_URL is not set.');
    process.exit(1);
  }

  const pool = new pg.Pool({ connectionString });
  const client = await pool.connect();

  console.log(`\n================================================================`);
  console.log(` CLINIC PLATFORM — PURGE AND BASELINE SEED`);
  console.log(` Mode: ${APPLY ? 'APPLY (DESTRUCTIVE COMMIT)' : 'DRY RUN (ROLLBACK)'}`);
  console.log(` Target Tenant: ${TENANT_ID}`);
  console.log(` Branch: ${BRANCH_ID}`);
  console.log(` Stock Mode: ${ZERO_STOCK ? 'ZERO STOCK' : 'INITIAL TEST BALANCES'}`);
  console.log(`================================================================\n`);

  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [TENANT_ID]);

    // Step 1: Temporarily disable deny-delete triggers
    console.log('Step 1: Disabling append-only / deny-delete triggers...');
    for (const [table, trigger] of APPEND_ONLY_TRIGGERS) {
      await client.query(`ALTER TABLE ${table} DISABLE TRIGGER ${trigger}`).catch(() => {});
    }

    // Step 2: Purge transactional tables
    console.log('Step 2: Purging transactional encounter, clinical, pharmacy, lab, and inventory data...');
    let totalPurgedRows = 0;
    const purgedDetails = [];

    for (const table of TRANSACTIONAL_TABLES) {
      await client.query('SAVEPOINT sp_del');
      try {
        const res = await client.query(`DELETE FROM ${table} WHERE tenant_id = $1`, [TENANT_ID]);
        if (res.rowCount > 0) {
          purgedDetails.push({ table, rows: res.rowCount });
          totalPurgedRows += res.rowCount;
          console.log(`  ✓ Cleared ${res.rowCount.toString().padStart(4, ' ')} rows from ${table}`);
        }
        await client.query('RELEASE SAVEPOINT sp_del');
      } catch (err) {
        await client.query('ROLLBACK TO SAVEPOINT sp_del');
        if (process.env.DEBUG) {
          console.warn(`  ⚠ Notice on table ${table}: ${err.message}`);
        }
      }
    }

    // Step 3: Re-enable triggers
    console.log('Step 3: Re-enabling triggers...');
    for (const [table, trigger] of APPEND_ONLY_TRIGGERS) {
      await client.query(`ALTER TABLE ${table} ENABLE TRIGGER ${trigger}`).catch(() => {});
    }

    // Step 4: Purge unseeded patients and their ledger rows
    console.log('Step 4: Purging unseeded patients and patient records...');
    const seedPatientIds = SEED_PATIENTS.map((p) => p.id);

    await client.query(
      `DELETE FROM patient_allergies WHERE tenant_id = $1 AND patient_id NOT IN ($2, $3, $4)`,
      [TENANT_ID, ...seedPatientIds],
    ).catch(() => {});
    await client.query(
      `DELETE FROM patient_philhealth WHERE tenant_id = $1 AND patient_id NOT IN ($2, $3, $4)`,
      [TENANT_ID, ...seedPatientIds],
    ).catch(() => {});
    await client.query(
      `DELETE FROM patient_contacts WHERE tenant_id = $1 AND patient_id NOT IN ($2, $3, $4)`,
      [TENANT_ID, ...seedPatientIds],
    ).catch(() => {});
    await client.query(
      `DELETE FROM patient_identifiers WHERE tenant_id = $1 AND patient_id NOT IN ($2, $3, $4)`,
      [TENANT_ID, ...seedPatientIds],
    ).catch(() => {});

    const patDel = await client.query(
      `DELETE FROM patients WHERE tenant_id = $1 AND id NOT IN ($2, $3, $4)`,
      [TENANT_ID, ...seedPatientIds],
    );
    if (patDel.rowCount > 0) {
      console.log(`  ✓ Purged ${patDel.rowCount} unseeded test patients`);
      totalPurgedRows += patDel.rowCount;
    }

    // Step 5: Purge unseeded staff users
    console.log('Step 5: Purging unseeded staff accounts...');
    const seedEmails = SEED_USERS.map((u) => u.email);

    await client.query(
      `DELETE FROM user_roles WHERE tenant_id = $1 AND user_id NOT IN (
         SELECT id FROM users WHERE tenant_id = $1 AND email = ANY($2)
       )`,
      [TENANT_ID, seedEmails],
    ).catch(() => {});
    await client.query(
      `DELETE FROM user_branches WHERE tenant_id = $1 AND user_id NOT IN (
         SELECT id FROM users WHERE tenant_id = $1 AND email = ANY($2)
       )`,
      [TENANT_ID, seedEmails],
    ).catch(() => {});

    const userDel = await client.query(
      `DELETE FROM users WHERE tenant_id = $1 AND email != ALL($2)`,
      [TENANT_ID, seedEmails],
    );
    if (userDel.rowCount > 0) {
      console.log(`  ✓ Purged ${userDel.rowCount} non-seed users`);
      totalPurgedRows += userDel.rowCount;
    }

    // Step 6: Seed / update the 3 standard demo patients
    console.log('Step 6: Seeding 3 demo patients (Maria Santos, Juan Dela Cruz, Angelita Reyes)...');
    for (const p of SEED_PATIENTS) {
      await client.query(
        `INSERT INTO patients (id, tenant_id, first_name, middle_name, last_name, date_of_birth, gender, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'ACTIVE')
         ON CONFLICT (id) DO UPDATE SET
           first_name = EXCLUDED.first_name,
           middle_name = EXCLUDED.middle_name,
           last_name = EXCLUDED.last_name,
           date_of_birth = EXCLUDED.date_of_birth,
           gender = EXCLUDED.gender,
           status = 'ACTIVE',
           updated_at = now()`,
        [p.id, TENANT_ID, p.firstName, p.middleName, p.lastName, p.dob, p.gender],
      );

      // Patient identifiers
      await client.query(
        `DELETE FROM patient_identifiers WHERE tenant_id = $1 AND patient_id = $2`,
        [TENANT_ID, p.id],
      );
      await client.query(
        `INSERT INTO patient_identifiers (tenant_id, patient_id, type, value)
         VALUES ($1, $2, 'PATIENT_NO', $3), ($1, $2, 'MRN', $3)
         ON CONFLICT DO NOTHING`,
        [TENANT_ID, p.id, p.patientNo],
      );

      // Contacts
      await client.query(
        `DELETE FROM patient_contacts WHERE tenant_id = $1 AND patient_id = $2`,
        [TENANT_ID, p.id],
      );
      if (p.phone) {
        await client.query(
          `INSERT INTO patient_contacts (tenant_id, patient_id, type, value, is_primary)
           VALUES ($1, $2, 'PHONE', $3, true)
           ON CONFLICT DO NOTHING`,
          [TENANT_ID, p.id, p.phone],
        );
      }
      if (p.email) {
        await client.query(
          `INSERT INTO patient_contacts (tenant_id, patient_id, type, value, is_primary)
           VALUES ($1, $2, 'EMAIL', $3, false)
           ON CONFLICT DO NOTHING`,
          [TENANT_ID, p.id, p.email],
        );
      }

      // PhilHealth
      await client.query(
        `DELETE FROM patient_philhealth WHERE tenant_id = $1 AND patient_id = $2`,
        [TENANT_ID, p.id],
      );
      if (p.philhealthNo) {
        await client.query(
          `INSERT INTO patient_philhealth (tenant_id, patient_id, pin, membership_category, konsulta_status)
           VALUES ($1, $2, $3, 'FORMAL_ECONOMY', $4)
           ON CONFLICT DO NOTHING`,
          [TENANT_ID, p.id, p.philhealthNo, p.konsultaStatus],
        );
        await client.query(
          `INSERT INTO patient_identifiers (tenant_id, patient_id, type, value)
           VALUES ($1, $2, 'PHILHEALTH', $3)
           ON CONFLICT DO NOTHING`,
          [TENANT_ID, p.id, p.philhealthNo],
        );
      }

      // Allergies
      await client.query(
        `DELETE FROM patient_allergies WHERE tenant_id = $1 AND patient_id = $2`,
        [TENANT_ID, p.id],
      );
      if (p.allergy) {
        await client.query(
          `INSERT INTO patient_allergies (tenant_id, patient_id, substance, severity)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT DO NOTHING`,
          [TENANT_ID, p.id, p.allergy.substance, p.allergy.severity],
        );
      }

      console.log(`  ✓ Patient: ${p.firstName} ${p.lastName} (${p.patientNo})`);
    }

    // Step 7: Seed / update the 9 staff users
    console.log('Step 7: Seeding 9 staff accounts (Admin, Doctor, Nurse, Pharmacist, Receptionist, Pharmacist Verifier, Lab Technologist, Lab Verifier, Storekeeper)...');
    for (const u of SEED_USERS) {
      await client.query(
        `INSERT INTO users (tenant_id, email, name, password_hash, status, failed_login_count, mfa_enabled, mfa_secret)
         VALUES ($1, $2, $3, $4, 'ACTIVE', 0, false, NULL)
         ON CONFLICT (tenant_id, email) DO UPDATE SET
           name = EXCLUDED.name,
           password_hash = EXCLUDED.password_hash,
           status = 'ACTIVE',
           deactivated_at = NULL,
           locked_until = NULL,
           failed_login_count = 0,
           mfa_secret = NULL,
           mfa_enabled = false,
           updated_at = now()`,
        [TENANT_ID, u.email, u.name, DEMO_PASSWORD_HASH],
      );

      // Assign branch MAIN
      await client.query(
        `INSERT INTO user_branches (tenant_id, user_id, branch_id, is_default)
         SELECT b.tenant_id, u.id, b.id, true
         FROM users u CROSS JOIN branches b
         WHERE u.tenant_id = $1 AND u.email = $2 AND b.tenant_id = u.tenant_id AND b.code = 'MAIN'
         ON CONFLICT (user_id, branch_id) DO UPDATE SET is_default = true`,
        [TENANT_ID, u.email],
      );

      // Assign role
      await client.query(
        `INSERT INTO user_roles (tenant_id, user_id, role_id)
         SELECT u.tenant_id, u.id, r.id
         FROM users u JOIN roles r ON r.tenant_id = u.tenant_id AND r.code = $3
         WHERE u.tenant_id = $1 AND u.email = $2
         ON CONFLICT (tenant_id, user_id, role_id, branch_id) DO NOTHING`,
        [TENANT_ID, u.email, u.role],
      );

      console.log(`  ✓ User: ${u.email.padEnd(22, ' ')} -> ${u.role}`);
    }

    // Step 8: Master Data (Laboratory, Central Supply, Pharmacy, Services, Payment Methods, Discounts)
    console.log('Step 8: Ensuring comprehensive master catalog...');
    await seedComprehensiveMasterData(client, TENANT_ID, BRANCH_ID, { zeroStock: ZERO_STOCK });

    // Step 9: Configure tenant modules & role permissions
    console.log('Step 9: Configuring tenant modules and permissions for the demo roles...');
    const MODULES = [
      'admin',
      'patients',
      'clinical',
      'laboratory',
      'pharmacy',
      'supply',
      'billing',
      'compliance',
      'notifications',
      'reports',
    ];

    for (const mod of MODULES) {
      await client.query(
        `INSERT INTO tenant_modules (tenant_id, module, status, seed_status)
         VALUES ($1, $2, 'ENABLED', 'SEEDED')
         ON CONFLICT (tenant_id, module) DO UPDATE
           SET status = 'ENABLED', seed_status = 'SEEDED', updated_at = now()`,
        [TENANT_ID, mod],
      );
    }

    // Tenant Admin: all non-SoD permissions
    await client.query(
      `INSERT INTO role_permissions (tenant_id, role_id, permission_id)
       SELECT $1, r.id, p.id
       FROM roles r, permissions p
       WHERE r.tenant_id = $1 AND r.code = 'tenant_admin'
         AND p.code NOT IN (SELECT permission_b FROM sod_conflicts)
       ON CONFLICT DO NOTHING`,
      [TENANT_ID],
    );

    // Doctor permissions — MUST equal `SYSTEM_ROLE_TEMPLATES.doctor`
    // (packages/contracts/src/permissions.ts) and demo_clean.sql §3b. §2.2 gives
    // a physician Clinical F(own) plus read/order/prescribe across Lab/Pharmacy;
    // it does NOT give lab-bench, supply-stock or billing actions. Keep this list
    // and the canonical set in 0063_reconcile_demo_doctor_role.migration.sql in
    // lockstep — a mismatch is what drifted demo-a's role to 92 grants.
    const DOCTOR_PERMISSIONS = [
      'patient.record.read', 'patient.record.update',
      'clinical.schedule.read', 'clinical.schedule.update',
      'clinical.appointment.read', 'clinical.appointment.update',
      'clinical.queue.read',
      'clinical.visit.read', 'clinical.visit.create', 'clinical.visit.update',
      'clinical.visit.start', 'clinical.visit.ready', 'clinical.visit.close',
      'clinical.vitals.read', 'clinical.vitals.create', 'clinical.vitals.update',
      'clinical.note.read', 'clinical.note.create', 'clinical.note.update', 'clinical.note.sign', 'clinical.note.amend',
      'clinical.diagnosis.read', 'clinical.diagnosis.create', 'clinical.diagnosis.update', 'clinical.diagnosis.delete',
      'clinical.procedure.read', 'clinical.procedure.create', 'clinical.procedure.update', 'clinical.procedure.delete',
      'clinical.supply.read', 'clinical.supply.create',
      'clinical.certificate.read', 'clinical.certificate.create',
      'clinical.referral.read', 'clinical.referral.create', 'clinical.referral.update',
      'clinical.problem.read', 'clinical.problem.create', 'clinical.problem.update', 'clinical.problem.resolve',
      'clinical.rx.read', 'clinical.rx.create', 'clinical.rx.update', 'clinical.rx.sign', 'clinical.rx.cancel',
      'clinical.order_set.read', 'clinical.order_set.create', 'clinical.order_set.update',
      'clinical.template.read', 'clinical.template.create', 'clinical.template.update',
      'clinical.immunization.read', 'clinical.immunization.create',
      'lab.order.read', 'lab.order.create', 'lab.result.read', 'lab.report.read',
      'pharmacy.rx.read',
      'reference.read', 'files.read', 'files.write', 'notifications.read',
    ];
    // Converge, don't just add: delete any doctor grant outside the canonical
    // set first, so re-running this reset cannot leave stale over-grants behind.
    await client.query(
      `DELETE FROM role_permissions rp
       USING roles r, permissions p
       WHERE rp.tenant_id = r.tenant_id
         AND rp.role_id = r.id
         AND rp.permission_id = p.id
         AND r.tenant_id = $1
         AND r.code = 'doctor'
         AND p.code <> ALL($2::text[])`,
      [TENANT_ID, DOCTOR_PERMISSIONS],
    );
    for (const code of DOCTOR_PERMISSIONS) {
      await client.query(
        `INSERT INTO role_permissions (tenant_id, role_id, permission_id)
         SELECT r.tenant_id, r.id, p.id
         FROM roles r, permissions p
         WHERE r.tenant_id = $1 AND r.code = 'doctor' AND p.code = $2
         ON CONFLICT DO NOTHING`,
        [TENANT_ID, code],
      );
    }

    // Nurse permissions
    const NURSE_PERMISSIONS = [
      'patient.record.read',
      'clinical.schedule.read', 'clinical.appointment.read', 'clinical.appointment.create', 'clinical.appointment.update',
      'clinical.queue.read', 'clinical.queue.call', 'clinical.queue.skip',
      'clinical.visit.read', 'clinical.visit.create', 'clinical.visit.update',
      'clinical.vitals.read', 'clinical.vitals.create', 'clinical.vitals.update',
      'clinical.note.read', 'clinical.note.create', 'clinical.note.update',
      'clinical.procedure.read', 'clinical.procedure.create',
      'clinical.supply.read', 'clinical.supply.create',
      'clinical.immunization.read', 'clinical.immunization.create',
      'lab.specimen.collect', 'lab.order.read', 'lab.result.read', 'lab.specimen.read',
      'supply.stock.read', 'supply.item.read', 'supply.req.read', 'supply.req.create', 'supply.consumption.create',
      'pharmacy.stock.read', 'pharmacy.rx.read', 'pharmacy.admin.create',
      'billing.invoice.read', 'reference.read', 'files.read', 'notifications.read',
    ];
    for (const code of NURSE_PERMISSIONS) {
      await client.query(
        `INSERT INTO role_permissions (tenant_id, role_id, permission_id)
         SELECT r.tenant_id, r.id, p.id
         FROM roles r, permissions p
         WHERE r.tenant_id = $1 AND r.code = 'nurse' AND p.code = $2
         ON CONFLICT DO NOTHING`,
        [TENANT_ID, code],
      );
    }

    // Staff / Receptionist permissions (Front Desk, Patient Reg, Queue, Appointments, Invoices & Payments)
    const RECEPTIONIST_PERMISSIONS = [
      'patient.record.read', 'patient.record.create', 'patient.record.update',
      'clinical.schedule.read', 'clinical.appointment.read', 'clinical.appointment.create', 'clinical.appointment.update', 'clinical.appointment.cancel',
      'clinical.queue.read', 'clinical.queue.call', 'clinical.queue.skip',
      'clinical.visit.read', 'clinical.visit.create',
      'billing.invoice.read', 'billing.invoice.create',
      'billing.payment.read', 'billing.payment.create',
      'billing.shift.read', 'billing.shift.open', 'billing.shift.close',
      'reference.read', 'files.read', 'notifications.read',
    ];
    for (const code of RECEPTIONIST_PERMISSIONS) {
      await client.query(
        `INSERT INTO role_permissions (tenant_id, role_id, permission_id)
         SELECT r.tenant_id, r.id, p.id
         FROM roles r, permissions p
         WHERE r.tenant_id = $1 AND r.code = 'receptionist' AND p.code = $2
         ON CONFLICT DO NOTHING`,
        [TENANT_ID, code],
      );
    }

    console.log('  ✓ Permissions granted to tenant_admin, doctor, nurse, and receptionist');

    if (APPLY) {
      await client.query('COMMIT');
      console.log(`\n================================================================`);
      console.log(` ✅  DESTRUCTIVE PURGE AND BASELINE SEED COMMITTED`);
      console.log(`================================================================`);
      console.log(`  Purged: ~${totalPurgedRows} transactional records`);
      console.log(`  Preserved / Seeded:`);
      console.log(`    - 3 Patients:`);
      console.log(`        * Maria Elena Santos (PAT-2026-0001)`);
      console.log(`        * Juan Carlos Dela Cruz (PAT-2026-0002)`);
      console.log(`        * Angelita Reyes (PAT-2026-0003)`);
      console.log(`    - 9 Staff Accounts (Password: DemoPassw0rd!2026):`);
      console.log(`        * admin@demo-a.test      (Tenant Admin)`);
      console.log(`        * doctor@demo-a.test     (Doctor)`);
      console.log(`        * nurse@demo-a.test      (Nurse)`);
      console.log(`        * dispenser@demo-a.test  (Pharmacist / Dispenser)`);
      console.log(`        * staff@demo-a.test      (Receptionist)`);
      console.log(`        * verifier@demo-a.test   (Pharmacist — Verification)`);
      console.log(`        * labtech@demo-a.test    (Lab Technologist)`);
      console.log(`        * labverify@demo-a.test  (Lab Verifier)`);
      console.log(`        * storekeeper@demo-a.test (Storekeeper — central supply)`);
      console.log(`    - Complete Master Data:`);
      console.log(`        * Laboratory: Sections, Specimens, Analyte Reference Ranges`);
      console.log(`        * Central Supply: 30 Consumables, Locations, UOMs`);
      console.log(`        * Pharmacy: 31 Medicines, Formularies, Pricing Rules`);
      console.log(`        * Service Catalog & Prices, Payment Methods, Discount Types`);
      console.log(`================================================================\n`);
    } else {
      await client.query('ROLLBACK');
      console.log(`\n================================================================`);
      console.log(` 🔍  DRY RUN COMPLETED (CHANGES ROLLED BACK)`);
      console.log(`================================================================`);
      console.log(`  Would have purged: ${totalPurgedRows} transactional rows across ${purgedDetails.length} tables.`);
      console.log(`  To apply destructive changes and commit baseline, re-run with:`);
      console.log(`    pnpm db:purge:demo -- --apply`);
      console.log(`================================================================\n`);
    }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    // Guarantee triggers are re-enabled
    for (const [table, trigger] of APPEND_ONLY_TRIGGERS) {
      await client.query(`ALTER TABLE ${table} ENABLE TRIGGER ${trigger}`).catch(() => {});
    }
    console.error('\n❌  Error during purge-and-seed (Transaction Rolled Back):', err.message);
    if (process.env.DEBUG) console.error(err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

run();