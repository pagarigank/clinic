import pg from 'pg';

const connectionString = process.env.DATABASE_URL_MIGRATOR || 'postgres://kpagarigan2:P%40ssw0rd@localhost:5432/clinic';
const pool = new pg.Pool({ connectionString });

async function seed() {
  const client = await pool.connect();
  try {
    console.log('Seeding Phase 9 plan modules and report catalog...');
    await client.query('SET ROLE clinic_owner;');

    // 1. Fetch or create standard subscription plans
    await client.query(`
      INSERT INTO subscription_plans (id, code, name, is_active)
      VALUES 
        ('b0000000-0000-4000-8000-000000000001', 'starter', 'Starter Clinic', true),
        ('b0000000-0000-4000-8000-000000000002', 'standard', 'Standard Practice', true),
        ('b0000000-0000-4000-8000-000000000003', 'enterprise', 'Enterprise Hospital & Diagnostic', true)
      ON CONFLICT (code) DO NOTHING;
    `);

    const plansRes = await client.query(`SELECT id, code FROM subscription_plans`);
    const planMap = Object.fromEntries(plansRes.rows.map(r => [r.code, r.id]));

    // 2. Seed Plan Modules
    const starterModules = ['admin', 'patients', 'clinical', 'billing'];
    const standardModules = ['admin', 'patients', 'clinical', 'billing', 'pharmacy', 'supply', 'notifications', 'reports'];
    const enterpriseModules = ['admin', 'patients', 'clinical', 'billing', 'pharmacy', 'supply', 'laboratory', 'compliance', 'notifications', 'reports'];

    for (const mod of starterModules) {
      if (planMap['starter']) {
        await client.query(`
          INSERT INTO plan_modules (plan_id, module, limits)
          VALUES ($1, $2, '{"max_users": 5, "max_branches": 1}'::jsonb)
          ON CONFLICT (plan_id, module) DO NOTHING;
        `, [planMap['starter'], mod]);
      }
    }

    for (const mod of standardModules) {
      if (planMap['standard']) {
        await client.query(`
          INSERT INTO plan_modules (plan_id, module, limits)
          VALUES ($1, $2, '{"max_users": 25, "max_branches": 3}'::jsonb)
          ON CONFLICT (plan_id, module) DO NOTHING;
        `, [planMap['standard'], mod]);
      }
    }

    for (const mod of enterpriseModules) {
      if (planMap['enterprise']) {
        await client.query(`
          INSERT INTO plan_modules (plan_id, module, limits)
          VALUES ($1, $2, '{"max_users": 100, "max_branches": 10}'::jsonb)
          ON CONFLICT (plan_id, module) DO NOTHING;
        `, [planMap['enterprise'], mod]);
      }
    }

    // 3. Seed Master Report Definitions
    const reports = [
      // Admin
      { id: 'RPT-ADM-01', module: 'admin', name: 'User Directory & Roles', desc: 'Active users, branches, roles, and MFA status', cat: 'Administration' },
      { id: 'RPT-ADM-02', module: 'admin', name: 'User Activity Log', desc: 'Logins and operations by user and module', cat: 'Administration' },
      { id: 'RPT-ADM-03', module: 'admin', name: 'Data Mutation Audit', desc: 'Full audit record of state changes before and after', cat: 'Administration' },
      { id: 'RPT-ADM-04', module: 'admin', name: 'License & Credential Expiry', desc: 'PRC licenses, branch operating permits, and expiry posture', cat: 'Administration' },
      { id: 'RPT-ADM-05', module: 'admin', name: 'Settings Change History', desc: 'Audit log of tenant configuration updates', cat: 'Administration' },

      // Clinical
      { id: 'RPT-CLN-01', module: 'clinical', name: 'Daily Census & Patient Log', desc: 'Consultation visits grouped by branch and status', cat: 'Clinical' },
      { id: 'RPT-CLN-04', module: 'clinical', name: 'Top Diagnoses (ICD-10)', desc: 'Frequent diagnostic codes categorized by age group and gender', cat: 'Clinical' },
      { id: 'RPT-CLN-09', module: 'clinical', name: 'Medical Certificate Register', desc: 'Issued medical certificates and fitness recommendations', cat: 'Clinical' },
      { id: 'RPT-CLN-10', module: 'clinical', name: 'Communicable Disease Surveillance', desc: 'Weekly communicable and notifiable disease breakdown (RA 11332)', cat: 'Clinical' },
      { id: 'RPT-CLN-11', module: 'clinical', name: 'Immunization Register', desc: 'Vaccine batch, dosage sequence, and patient administration history', cat: 'Clinical' },

      // Pharmacy
      { id: 'RPT-PHM-01', module: 'pharmacy', name: 'Daily Dispensing Log', desc: 'Dispensations with pharmacist, prescriber, and patient linkage', cat: 'Pharmacy' },
      { id: 'RPT-PHM-02', module: 'pharmacy', name: 'Prescription Record Book', desc: 'Chronological prescription register required by FDA/DOH', cat: 'Pharmacy' },
      { id: 'RPT-PHM-03', module: 'pharmacy', name: 'Dangerous Drugs Book (Controlled Register)', desc: 'PDEA-mandated controlled substance log with witness signatures', cat: 'Pharmacy' },
      { id: 'RPT-PHM-04', module: 'pharmacy', name: 'Controlled Drug Periodic Report', desc: 'DDB/PDEA monthly and semi-annual regulatory submission layout', cat: 'Pharmacy' },
      { id: 'RPT-PHM-07', module: 'pharmacy', name: 'Near-Expiry & Expired Stock', desc: 'Items approaching shelf-life expiration (90/60/30 days)', cat: 'Pharmacy' },

      // Supply
      { id: 'RPT-SUP-01', module: 'supply', name: 'Stock on Hand by Location', desc: 'Inventory quantities and batch balances across all clinic sites', cat: 'Supply' },
      { id: 'RPT-SUP-02', module: 'supply', name: 'Stock Ledger / Stock Card', desc: 'Complete FEFO item transaction history and movements', cat: 'Supply' },
      { id: 'RPT-SUP-04', module: 'supply', name: 'Goods Receipt Note (GRN) Register', desc: 'Deliveries received, verified, and variances by supplier', cat: 'Supply' },
      { id: 'RPT-SUP-10', module: 'supply', name: 'Automated Reorder Suggestions', desc: 'Stock falling below safety par levels with vendor lead times', cat: 'Supply' },
      { id: 'RPT-SUP-17', module: 'supply', name: 'Inventory Valuation', desc: 'Month-end inventory asset valuation using weighted average cost', cat: 'Supply' },

      // Laboratory
      { id: 'RPT-LAB-01', module: 'laboratory', name: 'Daily Lab Worklist', desc: 'Pending, collected, resulted, and verified test orders', cat: 'Laboratory' },
      { id: 'RPT-LAB-03', module: 'laboratory', name: 'Turnaround Time (TAT) Analysis', desc: 'Order-to-collection and collection-to-release benchmarks', cat: 'Laboratory' },
      { id: 'RPT-LAB-04', module: 'laboratory', name: 'Critical Value Notification Log', desc: 'Panic alert values detected, phoned, and acknowledged with timestamp', cat: 'Laboratory' },
      { id: 'RPT-LAB-08', module: 'laboratory', name: 'Quality Control & Levey-Jennings', desc: 'Analyte control runs, Westgard rule violations, and actions', cat: 'Laboratory' },

      // Billing
      { id: 'RPT-BIL-01', module: 'billing', name: 'Daily Cashier Collection (Z-Report)', desc: 'Reconciled collections by payment method, cashier, and shift', cat: 'Billing' },
      { id: 'RPT-BIL-02', module: 'billing', name: 'Revenue by Department & Service', desc: 'Gross revenue and professional fee breakdown', cat: 'Billing' },
      { id: 'RPT-BIL-03', module: 'billing', name: 'Accounts Receivables & Aging', desc: 'Outstanding balances bracketed by 30/60/90+ days', cat: 'Billing' },
      { id: 'RPT-BIL-04', module: 'billing', name: 'Statutory Discounts Log', desc: 'Senior citizen (RA 9994) and PWD (RA 10754) deductions', cat: 'Billing' },

      // Compliance
      { id: 'RPT-CMP-01', module: 'compliance', name: 'Patient PHI Access Log', desc: 'Audited log of personnel who viewed medical records', cat: 'Compliance' },
      { id: 'RPT-CMP-04', module: 'compliance', name: 'Data Subject Request Register', desc: 'SLA countdown and fulfillment tracking under RA 10173', cat: 'Compliance' },
      { id: 'RPT-CMP-05', module: 'compliance', name: 'Breach Incident & 72h Clock Register', desc: 'Regulator notification timeline and corrective actions', cat: 'Compliance' },
      { id: 'RPT-CMP-08', module: 'compliance', name: 'Retention & Legal Holds Register', desc: 'Statutory retention candidates and active litigation holds', cat: 'Compliance' },

      // Platform
      { id: 'RPT-PLT-05', module: 'admin', name: 'Break-Glass Transparency Report', desc: 'Emergency override sessions audited by tenant admins', cat: 'Platform' },
      { id: 'RPT-PLT-07', module: 'admin', name: 'Background Job Health & DLQ', desc: 'Queue depths, dead-letter items, and retry counts', cat: 'Platform' },
      { id: 'RPT-PLT-09', module: 'admin', name: 'Module Entitlement Changes', desc: 'Audit log of module activations, drains, and plan limits', cat: 'Platform' },
    ];

    for (const r of reports) {
      await client.query(`
        INSERT INTO report_definitions (id, module, name, description, category)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (id) DO UPDATE
        SET name = EXCLUDED.name, description = EXCLUDED.description, category = EXCLUDED.category;
      `, [r.id, r.module, r.name, r.desc, r.cat]);
    }

    console.log(`Seeded ${reports.length} report definitions successfully.`);
  } finally {
    client.release();
    await pool.end();
  }
}

seed().catch(err => {
  console.error('Phase 9 seeding error:', err);
  process.exit(1);
});
