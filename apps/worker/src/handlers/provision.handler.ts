/**
 * JOB-03: tenant.provision — seeds entitled modules and activates the tenant.
 *
 * For each module in the payload:
 *  1. Sets seed_status = SEEDING
 *  2. Seeds module-specific defaults (Phase 1: just marks SEEDED — real seeding
 *     per module lands with the phase that owns the module's master data)
 *  3. Sets status = ENABLED, seed_status = SEEDED
 *
 * Activates the tenant once ALL entitled modules are SEEDED.
 * On failure: sets seed_status = FAILED, tenant.status = PROVISIONING (retryable).
 */
import { getAppPool, runTenantBootstrap, withTenantOnPool } from '@clinic/db';

export interface ProvisionPayload {
  tenantId: string;
  modules: string[];
}

/**
 * Seed a single module for a tenant.
 * Wrapped in withTenantOnPool so all tenant tables respect forced RLS.
 */
async function seedModule(pool: ReturnType<typeof getAppPool>, tenantId: string, module: string): Promise<void> {
  return withTenantOnPool(pool, { tenantId, scope: 'tenant' }, async (tx) => {
    // Mark as SEEDING
    await tx.query(
      `UPDATE tenant_modules SET seed_status = 'SEEDING', updated_at = now()
       WHERE tenant_id = $1 AND module = $2`,
      [tenantId, module],
    );

    // Module-specific seeding (extensible registry pattern)
    switch (module) {
      case 'admin': {
        await tx.query(
          `INSERT INTO roles (tenant_id, code, name, is_system)
           SELECT $1, code, name, true
           FROM (VALUES
             ('tenant_admin', 'Tenant Administrator'),
             ('branch_manager', 'Branch Manager'),
             ('doctor', 'Doctor'),
             ('nurse', 'Nurse'),
             ('encoder', 'Encoder'),
             ('cashier', 'Cashier'),
             ('pharmacist', 'Pharmacist'),
             ('pharmacy_assistant', 'Pharmacy Assistant'),
             ('phlebotomist', 'Phlebotomist'),
             ('medtech', 'Medical Technologist'),
             ('lab_manager', 'Laboratory Manager'),
             ('pathologist', 'Pathologist'),
             ('supply_officer', 'Supply Officer'),
             ('purchaser', 'Purchaser'),
             ('auditor', 'Auditor'),
             ('dpo', 'Data Privacy Officer')
           ) AS t(code, name)
           ON CONFLICT (tenant_id, code) DO NOTHING`,
          [tenantId],
        );

        await tx.query(
          `INSERT INTO service_catalog (tenant_id, code, name, category, default_price, is_active)
           VALUES ($1, 'consult', 'General Consultation', 'consult', 500.00, true)
           ON CONFLICT DO NOTHING`,
          [tenantId]
        );

        await tx.query(
          `INSERT INTO price_lists (tenant_id, service_id, amount, effective_from)
           SELECT $1, sc.id, 500.00, CURRENT_DATE
           FROM service_catalog sc
           WHERE sc.tenant_id = $1 AND sc.code = 'consult'
           ON CONFLICT DO NOTHING`,
          [tenantId]
        );

        await tx.query(
          `INSERT INTO discount_types (tenant_id, code, name, percentage, requires_id, legal_basis, is_active)
           VALUES 
             ($1, 'SENIOR', 'Senior Citizen Discount (20%)', 20.00, true, 'RA 9994 Expanded Senior Citizens Act of 2010', true),
             ($1, 'PWD', 'Persons with Disability (20%)', 20.00, true, 'RA 10754 Act Expanding Benefits and Privileges of PWDs', true),
             ($1, 'EMPLOYEE', 'Employee / Staff Welfare (50%)', 50.00, true, 'Clinic Staff Health Benefit Policy', true),
             ($1, 'PROMO', 'Promotional Campaign (10%)', 10.00, false, 'Tenant Marketing Policy', true)
           ON CONFLICT (tenant_id, name) DO UPDATE
             SET code = EXCLUDED.code, requires_id = EXCLUDED.requires_id, legal_basis = EXCLUDED.legal_basis`,
          [tenantId]
        );

        await tx.query(
          `INSERT INTO payment_methods (tenant_id, code, name, is_active)
           VALUES 
             ($1, 'CASH', 'Cash', true),
             ($1, 'CARD', 'Credit / Debit Card', true),
             ($1, 'GCASH', 'GCash', true),
             ($1, 'MAYA', 'Maya', true),
             ($1, 'BANK_TRANSFER', 'Bank Transfer', true),
             ($1, 'HMO', 'HMO / Insurance', true),
             ($1, 'PHILHEALTH', 'PhilHealth', true)
           ON CONFLICT (tenant_id, code) DO NOTHING`,
          [tenantId]
        );

        await tx.query(
          `INSERT INTO role_permissions (tenant_id, role_id, permission_id)
           SELECT $1, ro.id, p.id
           FROM roles ro
           CROSS JOIN permissions p
           WHERE ro.tenant_id = $1
             AND (
               (ro.code IN ('tenant_admin', 'branch_manager') AND p.code IN (
                 'billing.invoice.read',  'billing.invoice.create', 'billing.invoice.update',
                 'billing.invoice.void',  'billing.charge.create',
                 'billing.payment.read',  'billing.payment.create',
                 'billing.credit.read',   'billing.credit.create',  'billing.credit.approve',
                 'billing.shift.read',    'billing.shift.open',     'billing.shift.close',
                 'billing.discount.read', 'billing.discount.create','billing.discount.revoke'
               ))
               OR
               (ro.code = 'cashier' AND p.code IN (
                 'billing.invoice.read',  'billing.invoice.create', 'billing.invoice.update',
                 'billing.charge.create',
                 'billing.payment.read',  'billing.payment.create',
                 'billing.credit.read',   'billing.credit.create',
                 'billing.shift.read',    'billing.shift.open',     'billing.shift.close',
                 'billing.discount.read', 'billing.discount.create','billing.discount.revoke'
               ))
               OR
               (ro.code IN ('doctor', 'nurse', 'encoder') AND p.code IN (
                 'billing.invoice.read', 'billing.payment.read',
                 'billing.charge.create'
               ))
             )
           ON CONFLICT (tenant_id, role_id, permission_id) DO NOTHING`,
          [tenantId]
        );

        break;
      }
      case 'patients': {
        break;
      }
      case 'supply': {
        await tx.query(
          `INSERT INTO uoms (tenant_id, code, name)
           VALUES 
             ($1, 'PCS', 'Pieces'),
             ($1, 'BOX', 'Box'),
             ($1, 'BOTTLE', 'Bottle'),
             ($1, 'VIAL', 'Vial'),
             ($1, 'PACK', 'Pack')
           ON CONFLICT (tenant_id, code) DO NOTHING`,
          [tenantId],
        );

        await tx.query(
          `INSERT INTO item_categories (tenant_id, name)
           VALUES 
             ($1, 'Medicines'),
             ($1, 'Medical Supplies'),
             ($1, 'Laboratory Reagents'),
             ($1, 'Equipment')
           ON CONFLICT DO NOTHING`,
          [tenantId],
        );

        const branches = await tx.query(
          `SELECT id FROM branches WHERE tenant_id = $1 AND status = 'ACTIVE'`,
          [tenantId],
        );
        for (const branch of branches.rows) {
          await tx.query(
            `INSERT INTO stock_locations (tenant_id, branch_id, code, name, type)
             VALUES ($1, $2, 'MAIN_STORE', 'Main Central Store', 'CENTRAL_STORE')
             ON CONFLICT (tenant_id, branch_id, code) DO NOTHING`,
            [tenantId, branch.id],
          );
        }
        break;
      }
      case 'compliance': {
        await tx.query(
          `INSERT INTO retention_policies (tenant_id, record_class, retention_years, action, legal_basis)
           VALUES
             ($1, 'CLINICAL_VISITS', 10, 'ARCHIVE', 'DOH AO 2007-0027 retention of clinical records'),
             ($1, 'CLINICAL_NOTES', 10, 'ARCHIVE', 'DOH AO 2007-0027 retention of clinical notes'),
             ($1, 'LAB_ORDERS', 10, 'ARCHIVE', 'DOH AO 2007-0027 clinical laboratory archive'),
             ($1, 'LAB_RESULTS', 10, 'ARCHIVE', 'DOH AO 2007-0027 clinical laboratory archive'),
             ($1, 'PRESCRIPTIONS', 5, 'ARCHIVE', 'PDEA S2 Dangerous Drugs Act RA 9165 / FDA Circular'),
             ($1, 'INVOICES', 10, 'ARCHIVE', 'NIRC Sec 235 / BIR RR 9-2009 commercial books retention'),
             ($1, 'PAYMENTS', 10, 'ARCHIVE', 'NIRC Sec 235 / BIR RR 9-2009 financial receipts'),
             ($1, 'AUDIT_LOGS', 10, 'ARCHIVE', 'DPA RA 10173 accountability principle')
           ON CONFLICT (tenant_id, record_class) DO NOTHING`,
          [tenantId],
        );

        await tx.query(
          `INSERT INTO consent_templates (tenant_id, version, title, body, purposes, locale, status)
           VALUES (
             $1, 1, 'General Consent to Medical Treatment and Data Processing',
             'I hereby grant consent for medical consultation, clinical examinations, laboratory testing, and necessary treatment. I acknowledge that my personal and sensitive health information (PHI) will be processed in accordance with Republic Act No. 10173 (Data Privacy Act of 2012) and Department of Health regulations.',
             '["TREATMENT", "BILLING", "HEALTHCARE_OPERATIONS", "REGULATORY_COMPLIANCE"]'::jsonb,
             'en', 'PUBLISHED'
           )
           ON CONFLICT (tenant_id, locale, version) DO NOTHING`,
          [tenantId],
        );
        break;
      }
      default: {
        break;
      }
    }

    // Mark as SEEDED and ENABLED
    await tx.query(
      `UPDATE tenant_modules
       SET seed_status = 'SEEDED', status = 'ENABLED', updated_at = now(), row_version = row_version + 1
       WHERE tenant_id = $1 AND module = $2`,
      [tenantId, module],
    );
  });
}

export async function handleTenantProvision(payload: ProvisionPayload): Promise<void> {
  const pool = getAppPool();
  const { tenantId, modules } = payload;

  try {
    for (const module of modules) {
      try {
        await seedModule(pool, tenantId, module);
      } catch (err) {
        // Mark this specific module as FAILED, continue trying others
        await withTenantOnPool(pool, { scope: 'platform' }, async (tx) => {
          await tx.query(
            `UPDATE tenant_modules SET seed_status = 'FAILED', updated_at = now()
             WHERE tenant_id = $1 AND module = $2`,
            [tenantId, module],
          );
        });
        console.error(`JOB-03: failed to seed module ${module} for tenant ${tenantId}:`, err);
      }
    }

    // Bootstrap masters, roles and starter accounts (tenant_bootstrap.sql).
    try {
      const tenantRow = await withTenantOnPool(pool, { scope: 'platform' }, async (tx) => {
        return tx.query<{ name: string; slug: string }>(
          `SELECT name, slug FROM tenants WHERE id = $1`,
          [tenantId],
        );
      });
      if ((tenantRow.rowCount ?? 0) === 0) {
        throw new Error(`tenant ${tenantId} not found`);
      }
      const { name, slug } = tenantRow.rows[0]!;
      await runTenantBootstrap(pool, { tenantId, slug, name });
      console.log(`JOB-03: tenant bootstrap applied for ${slug} (${tenantId})`);
    } catch (err) {
      console.error(`JOB-03: tenant bootstrap failed for ${tenantId}:`, err);
      await withTenantOnPool(pool, { scope: 'platform' }, async (tx) => {
        await tx.query(
          `UPDATE tenant_modules SET seed_status = 'FAILED', updated_at = now()
           WHERE tenant_id = $1`,
          [tenantId],
        );
      });
      throw err;
    }

    // Check if ALL entitled modules are SEEDED
    const statusRows = await withTenantOnPool(pool, { scope: 'platform' }, async (tx) => {
      return tx.query<{ seed_status: string; count: string }>(
        `SELECT seed_status, count(*) AS count FROM tenant_modules WHERE tenant_id = $1 GROUP BY seed_status`,
        [tenantId],
      );
    });
    const statusMap = Object.fromEntries(statusRows.rows.map(r => [r.seed_status, parseInt(r.count, 10)]));
    const hasFailed = (statusMap['FAILED'] ?? 0) > 0;
    const hasPending = (statusMap['PENDING'] ?? 0) > 0 || (statusMap['SEEDING'] ?? 0) > 0;

    if (!hasFailed && !hasPending) {
      // All seeded — activate the tenant
      await withTenantOnPool(pool, { scope: 'platform' }, async (tx) => {
        await tx.query(
          `UPDATE tenants SET status = 'ACTIVE', updated_at = now(), modules_version = modules_version + 1
           WHERE id = $1 AND status = 'PROVISIONING'`,
          [tenantId],
        );
      });
      console.log(`JOB-03: tenant ${tenantId} provisioned and activated`);
    } else {
      console.warn(`JOB-03: tenant ${tenantId} provisioning incomplete — failed=${statusMap['FAILED'] ?? 0}, pending=${hasPending}`);
    }
  } catch (err) {
    console.error(`JOB-03: critical failure for tenant ${tenantId}:`, err);
    throw err;
  }
}

