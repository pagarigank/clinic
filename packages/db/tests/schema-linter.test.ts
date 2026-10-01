import { describe, expect, it } from "vitest";
import { createPool } from "../src/pool.js";

/**
 * DB Schema Linter (todo 0.2 / architecture §5.2 layer 5).
 * Enforces ground rule 1: Every tenant table must have RLS, FORCE RLS,
 * a policy, and an index starting with tenant_id.
 */
describe("schema linter (ground rule 1)", () => {
  it("every table with tenant_id has RLS, FORCE RLS, a policy, and a tenant index", async () => {
    const pool = createPool({ role: "owner" });
    
    const { rows: tenantTables } = await pool.query(`
      SELECT c.relname as table_name,
             c.relrowsecurity as has_rls,
             c.relforcerowsecurity as force_rls
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid
      WHERE n.nspname = 'public'
        AND c.relkind = 'r'
        AND a.attname = 'tenant_id'
        AND a.attisdropped = false
        AND c.relname NOT LIKE '%_p_default'
        AND c.relname NOT LIKE '%_p20%';
    `);

    expect(tenantTables.length).toBeGreaterThan(0);

    for (const table of tenantTables) {
      expect(table.has_rls, `${table.table_name} lacks ENABLE ROW LEVEL SECURITY`).toBe(true);
      expect(table.force_rls, `${table.table_name} lacks FORCE ROW LEVEL SECURITY`).toBe(true);

      const { rows: policies } = await pool.query(
        `SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = $1`,
        [table.table_name],
      );
      expect(policies.length, `${table.table_name} has no RLS policies`).toBeGreaterThan(0);

      // Check for index starting with tenant_id or (tenant_id, id) PK
      const { rows: indexes } = await pool.query(`
        SELECT ix.relname as index_name,
               a.attname as leading_column
        FROM pg_index i
        JOIN pg_class c ON c.oid = i.indrelid
        JOIN pg_class ix ON ix.oid = i.indexrelid
        JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = i.indkey[0]
        WHERE c.relname = $1
          AND a.attname = 'tenant_id'
      `, [table.table_name]);
      
      expect(indexes.length, `${table.table_name} lacks an index starting with tenant_id`).toBeGreaterThan(0);
    }
  });
});
