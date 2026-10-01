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
import { getAppPool } from '@clinic/db';

export interface ProvisionPayload {
  tenantId: string;
  modules: string[];
}

/**
 * Seed a single module for a tenant.
 * Phase 1: only `admin` and `patients` have real seed content (permissions).
 * All other modules are marked SEEDED immediately — actual data-seeding lands
 * with the phase that introduces that module's screens.
 */
async function seedModule(pool: ReturnType<typeof getAppPool>, tenantId: string, module: string): Promise<void> {
  // Mark as SEEDING
  await pool.query(
    `UPDATE tenant_modules SET seed_status = 'SEEDING', updated_at = now()
     WHERE tenant_id = $1 AND module = $2`,
    [tenantId, module],
  );

  // Module-specific seeding (extensible registry pattern)
  switch (module) {
    case 'admin': {
      // Seed system roles (SYSTEM_ROLE_TEMPLATES are already in the DB via migration 0007)
      // Here we ensure system roles are created for this tenant if not already present
      await pool.query(
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
      break;
    }
    case 'patients': {
      // No master data to seed at Phase 1; patient module relies on reference data
      // seeded separately (ICD-10, PSGC etc. are global catalogues, Phase 2)
      break;
    }
    default: {
      // All other modules: mark immediately SEEDED (actual data lands with the module phase)
      break;
    }
  }

  // Mark as SEEDED and ENABLED
  await pool.query(
    `UPDATE tenant_modules
     SET seed_status = 'SEEDED', status = 'ENABLED', updated_at = now(), row_version = row_version + 1
     WHERE tenant_id = $1 AND module = $2`,
    [tenantId, module],
  );
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
        await pool.query(
          `UPDATE tenant_modules SET seed_status = 'FAILED', updated_at = now()
           WHERE tenant_id = $1 AND module = $2`,
          [tenantId, module],
        );
        console.error(`JOB-03: failed to seed module ${module} for tenant ${tenantId}:`, err);
      }
    }

    // Check if ALL entitled modules are SEEDED
    const statusRows = await pool.query<{ seed_status: string; count: string }>(
      `SELECT seed_status, count(*) AS count FROM tenant_modules WHERE tenant_id = $1 GROUP BY seed_status`,
      [tenantId],
    );
    const statusMap = Object.fromEntries(statusRows.rows.map(r => [r.seed_status, parseInt(r.count, 10)]));
    const hasFailed = (statusMap['FAILED'] ?? 0) > 0;
    const hasPending = (statusMap['PENDING'] ?? 0) > 0 || (statusMap['SEEDING'] ?? 0) > 0;

    if (!hasFailed && !hasPending) {
      // All seeded — activate the tenant
      await pool.query(
        `UPDATE tenants SET status = 'ACTIVE', updated_at = now(), modules_version = modules_version + 1
         WHERE id = $1 AND status = 'PROVISIONING'`,
        [tenantId],
      );
      console.log(`JOB-03: tenant ${tenantId} provisioned and activated`);
    } else {
      console.warn(`JOB-03: tenant ${tenantId} provisioning incomplete — failed=${statusMap['FAILED'] ?? 0}, pending=${hasPending}`);
    }
  } catch (err) {
    console.error(`JOB-03: critical failure for tenant ${tenantId}:`, err);
    throw err;
  }
}
