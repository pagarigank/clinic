import { describe, expect, it, beforeEach } from "vitest";
import { createPool } from "../src/pool.js";
import { runInTenantScope } from "../src/tenant-scope.js";
import { withTenant } from "../src/withTenant.js";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
let ownerPool: any;

describe("audit_log table", () => {
  beforeEach(async () => {
    // Delete any default partition records inserted by tests to stay clean
    ownerPool ??= createPool({ role: "owner" });
    await ownerPool.query(`ALTER TABLE audit_log DISABLE TRIGGER audit_log_deny_delete`);
    await ownerPool.query(`DELETE FROM audit_log WHERE tenant_id = $1`, [TENANT_A]);
    await ownerPool.query(`ALTER TABLE audit_log ENABLE TRIGGER audit_log_deny_delete`);
  });

  it("allows insert", async () => {
    await runInTenantScope(TENANT_A, () =>
      withTenant({ tenantId: TENANT_A }, async (tx) => {
        const { rowCount } = await tx.query(
          `INSERT INTO audit_log (tenant_id, action, entity_type, entity_id) VALUES ($1, $2, $3, $4)`,
          [TENANT_A, "LOGIN", "session", "11111111-1111-4111-8111-111111111111"],
        );
        expect(rowCount).toBe(1);
      }),
    );
  });

  it("denies update via trigger", async () => {
    await runInTenantScope(TENANT_A, () =>
      withTenant({ tenantId: TENANT_A }, async (tx) => {
        const { rows } = await tx.query(
          `INSERT INTO audit_log (tenant_id, action, entity_type, entity_id) VALUES ($1, $2, $3, $4) RETURNING id`,
          [TENANT_A, "LOGIN", "session", "11111111-1111-4111-8111-111111111111"],
        );
        const id = rows[0].id;
        
        await expect(
          tx.query(`UPDATE audit_log SET action = 'tampered' WHERE id = $1`, [id]),
        ).rejects.toThrow(/append-only/);
      }),
    );
  });

  it("denies delete via trigger", async () => {
    await runInTenantScope(TENANT_A, () =>
      withTenant({ tenantId: TENANT_A }, async (tx) => {
        const { rows } = await tx.query(
          `INSERT INTO audit_log (tenant_id, action, entity_type, entity_id) VALUES ($1, $2, $3, $4) RETURNING id`,
          [TENANT_A, "LOGIN", "session", "11111111-1111-4111-8111-111111111111"],
        );
        const id = rows[0].id;

        await expect(
          tx.query(`DELETE FROM audit_log WHERE id = $1`, [id]),
        ).rejects.toThrow(/append-only/);
      }),
    );
  });
});
