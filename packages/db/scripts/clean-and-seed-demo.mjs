import pg from "pg";
import { seedComprehensiveMasterData } from "./seed_comprehensive_master_data.mjs";

const pool = new pg.Pool({
  connectionString: "postgres://kpagarigan2:P%40ssw0rd@localhost:5432/clinic",
});

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const BRANCH_A = "a1000000-0000-4000-8000-000000000001";
const ADMIN_A = "a3000000-0000-4000-8000-000000000001";
const DOCTOR_A = "a3000000-0000-4000-8000-000000000002";

async function run() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [TENANT_A]);

    console.log("1. Cleaning transactional demo data (preserving registered patients)...");

    // Disable triggers for append-only tables
    await client.query("ALTER TABLE controlled_register DISABLE TRIGGER trg_deny_delete_controlled_register");
    await client.query("ALTER TABLE stock_movements DISABLE TRIGGER stock_movements_deny_delete");
    await client.query("ALTER TABLE stock_movements_p_default DISABLE TRIGGER stock_movements_deny_delete");

    const transactionalTables = [
      // Billing & Payments
      "payment_allocations",
      "payment_splits",
      "payment_reprints",
      "credit_notes",
      "payments",
      "discount_applications",
      "invoice_lines",
      "invoices",
      "billing_charges",
      "daily_cashier_summaries",
      "cash_sessions",
      "cashier_shifts",
      // Pharmacy Transactions
      "patient_returns",
      "controlled_register",
      "dispense_items",
      "dispenses",
      "special_rx_records",
      "pharmacist_interventions",
      "interaction_decisions",
      "medication_administrations",
      "prescription_items",
      "prescriptions",
      // Laboratory Transactions
      "lab_critical_notifications",
      "lab_result_amendments",
      "lab_results",
      "lab_reports",
      "specimen_events",
      "specimens",
      "lab_order_items",
      "lab_orders",
      "lab_send_outs",
      "lab_qc_results",
      "lab_qc_runs",
      // Clinical Transactions
      "clinical_notes",
      "medical_certificates",
      "referrals",
      "visit_procedures",
      "visit_diagnoses",
      "vitals",
      "immunizations",
      "problem_list",
      "queue_tickets",
      "appointments",
      "visits",
      // Supply & Inventory Transactions
      "stock_issue_items",
      "stock_issues",
      "stock_transfer_items",
      "stock_transfers",
      "consumption_logs",
      "disposal_items",
      "disposals",
      "recall_batches",
      "recalls",
      "supplier_return_items",
      "supplier_returns",
      "stock_adjustment_items",
      "stock_adjustments",
      "physical_count_items",
      "physical_counts",
      "stock_movements",
      "stock_balances",
      "supplier_invoices",
      "goods_receipt_items",
      "goods_receipts",
      "purchase_order_items",
      "purchase_orders",
      "purchase_request_items",
      "purchase_requests",
      "requisition_items",
      "requisitions",
      "stock_batches",
    ];

    for (const table of transactionalTables) {
      try {
        const res = await client.query(`DELETE FROM ${table} WHERE tenant_id = $1`, [TENANT_A]);
        if (res.rowCount > 0) {
          console.log(`  Cleared ${res.rowCount} rows from ${table}`);
        }
      } catch (err) {
        console.warn(`  Warning on table ${table}: ${err.message}`);
      }
    }

    // Re-enable triggers
    await client.query("ALTER TABLE controlled_register ENABLE TRIGGER trg_deny_delete_controlled_register");
    await client.query("ALTER TABLE stock_movements ENABLE TRIGGER stock_movements_deny_delete");
    await client.query("ALTER TABLE stock_movements_p_default ENABLE TRIGGER stock_movements_deny_delete");

    console.log("2. Ensuring registered Filipino demo patients are present...");
    const patients = [
      {
        id: "a4000000-0000-4000-8000-000000000001",
        firstName: "Maria Elena",
        lastName: "Santos",
        middleName: "Cruz",
        dob: "1988-04-12",
        gender: "FEMALE",
        patientNo: "PAT-2026-0001",
        phone: "0917-555-0192",
        email: "maria.santos@gmail.com",
        philhealthNo: "12-345678901-2",
        konsultaStatus: "REGISTERED",
        allergy: { substance: "Penicillin", severity: "Severe Urticaria" },
      },
      {
        id: "a4000000-0000-4000-8000-000000000002",
        firstName: "Juan Carlos",
        lastName: "Dela Cruz",
        middleName: "Bautista",
        dob: "1975-11-23",
        gender: "MALE",
        patientNo: "PAT-2026-0002",
        phone: "0918-555-0344",
        email: "jcdelacruz@yahoo.com",
        philhealthNo: "09-876543210-9",
        konsultaStatus: "REGISTERED",
      },
      {
        id: "a4000000-0000-4000-8000-000000000003",
        firstName: "Angelita",
        lastName: "Reyes",
        middleName: "Manalo",
        dob: "1994-08-30",
        gender: "FEMALE",
        patientNo: "PAT-2026-0003",
        phone: "0920-555-0811",
        email: "angie.reyes@outlook.ph",
        konsultaStatus: "PENDING",
      },
      {
        id: "a4000000-0000-4000-8000-000000000004",
        firstName: "Roberto",
        lastName: "Lim",
        middleName: "Tan",
        dob: "1960-01-15",
        gender: "MALE",
        patientNo: "PAT-2026-0004",
        phone: "0917-555-0999",
        email: "rlim.const@gmail.com",
        philhealthNo: "11-223344556-7",
        konsultaStatus: "REGISTERED",
        allergy: { substance: "Aspirin / NSAIDs", severity: "Moderate Dyspepsia" },
      },
      {
        id: "a4000000-0000-4000-8000-000000000005",
        firstName: "Clara",
        lastName: "Bautista",
        middleName: "Santos",
        dob: "2001-03-22",
        gender: "FEMALE",
        patientNo: "PAT-2026-0005",
        phone: "0919-555-0211",
        email: "clara.b@student.up.edu.ph",
        konsultaStatus: "NOT_REGISTERED",
      },
    ];

    for (const p of patients) {
      await client.query(
        `INSERT INTO patients (id, tenant_id, first_name, last_name, middle_name, date_of_birth, gender, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'ACTIVE')
         ON CONFLICT (id) DO UPDATE SET
           first_name = EXCLUDED.first_name,
           last_name = EXCLUDED.last_name,
           middle_name = EXCLUDED.middle_name,
           date_of_birth = EXCLUDED.date_of_birth,
           gender = EXCLUDED.gender,
           status = 'ACTIVE'`,
        [p.id, TENANT_A, p.firstName, p.lastName, p.middleName, p.dob, p.gender]
      );

      // Primary patient identifier (PAT-...)
      await client.query(
        `INSERT INTO patient_identifiers (tenant_id, patient_id, type, value)
         VALUES ($1, $2, 'PATIENT_NO', $3), ($1, $2, 'MRN', $3)
         ON CONFLICT DO NOTHING`,
        [TENANT_A, p.id, p.patientNo]
      );

      // Contacts
      if (p.phone) {
        await client.query(
          `INSERT INTO patient_contacts (tenant_id, patient_id, type, value, is_primary)
           VALUES ($1, $2, 'PHONE', $3, true)
           ON CONFLICT DO NOTHING`,
          [TENANT_A, p.id, p.phone]
        );
      }
      if (p.email) {
        await client.query(
          `INSERT INTO patient_contacts (tenant_id, patient_id, type, value, is_primary)
           VALUES ($1, $2, 'EMAIL', $3, false)
           ON CONFLICT DO NOTHING`,
          [TENANT_A, p.id, p.email]
        );
      }

      // PhilHealth
      if (p.philhealthNo) {
        await client.query(
          `INSERT INTO patient_philhealth (tenant_id, patient_id, pin, membership_category, konsulta_status)
           VALUES ($1, $2, $3, 'FORMAL_ECONOMY', $4)
           ON CONFLICT DO NOTHING`,
          [TENANT_A, p.id, p.philhealthNo, p.konsultaStatus]
        );
        await client.query(
          `INSERT INTO patient_identifiers (tenant_id, patient_id, type, value)
           VALUES ($1, $2, 'PHILHEALTH', $3)
           ON CONFLICT DO NOTHING`,
          [TENANT_A, p.id, p.philhealthNo]
        );
      }

      // Allergy
      if (p.allergy) {
        await client.query(
          `INSERT INTO patient_allergies (tenant_id, patient_id, substance, severity)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT DO NOTHING`,
          [TENANT_A, p.id, p.allergy.substance, p.allergy.severity]
        );
      }
    }

    console.log("3. Seeding comprehensive master data (Lab, Supply, Pharmacy, Services, Payments)...");
    await seedComprehensiveMasterData(client);

    console.log("4. Seeding clean demo active encounter for Maria Elena Santos...");
    await client.query(
      `INSERT INTO visits (id, tenant_id, branch_id, visit_no, patient_id, practitioner_id, visit_type, status, chief_complaint, created_by, opened_at)
       VALUES ($1, $2, $3, 'VIS-2026-0001', 'a4000000-0000-4000-8000-000000000001', $4, 'OPD', 'IN_PROGRESS', 'Routine hypertension follow-up & maintenance prescription refill', $5, now() - interval '45 minutes')
       ON CONFLICT (id) DO UPDATE SET
         status = 'IN_PROGRESS',
         chief_complaint = 'Routine hypertension follow-up & maintenance prescription refill'`,
      ["a5000000-0000-4000-8000-000000000001", TENANT_A, BRANCH_A, DOCTOR_A, ADMIN_A]
    );

    console.log("5. Ensuring all tenant modules and role permissions are configured for Tenant A...");
    await client.query(`
      INSERT INTO tenant_modules (tenant_id, module, status, seed_status)
      VALUES 
        ($1, 'admin', 'ENABLED', 'SEEDED'),
        ($1, 'patients', 'ENABLED', 'SEEDED'),
        ($1, 'clinical', 'ENABLED', 'SEEDED'),
        ($1, 'pharmacy', 'ENABLED', 'SEEDED'),
        ($1, 'laboratory', 'ENABLED', 'SEEDED'),
        ($1, 'supply', 'ENABLED', 'SEEDED'),
        ($1, 'billing', 'ENABLED', 'SEEDED')
      ON CONFLICT (tenant_id, module) DO UPDATE SET status = 'ENABLED'
    `, [TENANT_A]);

    const ROLE_ADMIN = 'a2000000-0000-4000-8000-000000000001';
    const ROLE_DOCTOR = 'a2000000-0000-4000-8000-000000000002';
    
    // Grant all non-SoD-conflicting permissions to tenant admin
    await client.query(`
      DELETE FROM role_permissions
      WHERE tenant_id = $1 AND role_id = $2
        AND permission_id IN (SELECT p.id FROM permissions p JOIN sod_conflicts s ON s.permission_b = p.code)
    `, [TENANT_A, ROLE_ADMIN]);

    await client.query(`
      INSERT INTO role_permissions (tenant_id, role_id, permission_id)
      SELECT $1, $2, id FROM permissions
      WHERE code NOT IN (SELECT permission_b FROM sod_conflicts)
      ON CONFLICT DO NOTHING
    `, [TENANT_A, ROLE_ADMIN]);

    // Grant clinical, lab, supply, pharmacy, and billing read permissions to doctor
    const doctorPerms = [
      'lab.config.read', 'lab.order.read', 'lab.order.create', 'lab.order.cancel', 'lab.result.read', 'lab.specimen.read',
      'supply.stock.read', 'supply.item.read', 'supply.location.read', 'supply.consumption.create', 'supply.req.create', 'supply.req.read',
      'pharmacy.stock.read', 'pharmacy.product.read', 'pharmacy.rx.read',
      'clinical.rx.read', 'clinical.rx.create', 'clinical.rx.sign', 'clinical.rx.cancel',
      'billing.invoice.read', 'patient.record.read', 'clinical.visit.read', 'clinical.visit.update'
    ];
    for (const code of doctorPerms) {
      const p = await client.query('SELECT id FROM permissions WHERE code = $1', [code]);
      if (p.rows[0]) {
        await client.query(`
          INSERT INTO role_permissions (tenant_id, role_id, permission_id)
          VALUES ($1, $2, $3)
          ON CONFLICT DO NOTHING
        `, [TENANT_A, ROLE_DOCTOR, p.rows[0].id]);
      }
    }

    await client.query("COMMIT");
    console.log("Successfully cleaned transactional fixtures and seeded comprehensive master data!");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Failed to seed demo data:", err);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch(console.error);
