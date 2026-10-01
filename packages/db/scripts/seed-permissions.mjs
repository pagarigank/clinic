// Seeds the canonical permission catalogue (specification §2.3) + demo role
// grants from packages/contracts. Additive and idempotent:
//  - permissions: the catalogue itself is now versioned by migration 0007, so
//    this script only reconciles descriptions for codes that already exist
//  - role_permissions for the demo tenants: replaced from the §2.2/§2.3
//    system-role templates for the roles the demo seed created
// Runs as the migrator (superuser) — outside RLS entirely.
//
// The owner URL is resolved locally rather than imported from src/pool.ts:
// this runs as plain `node`, and @clinic/db has no build step, so a `.ts`
// import here fails with ERR_MODULE_NOT_FOUND. Mirrors migrate.mjs and the
// fallback table in pool.ts.
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";

/** Mirrors `resolveUrl("owner")` in src/pool.ts and migrate.mjs. */
function resolveUrl() {
  return (
    process.env.DATABASE_URL_MIGRATOR ??
    process.env.DATABASE_URL_OWNER ??
    // Native local Postgres, no Docker. `@` in the password is URL-encoded.
    "postgres://kpagarigan2:P%40ssw0rd@localhost:5432/clinic"
  );
}

const require = createRequire(import.meta.url);

// Load the catalogue straight from the contracts TS source (no build step).
const contractsSrc = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../contracts/src/permissions.ts"),
  "utf8",
);

// Extract PERMISSION_CATALOGUE entries — the file is a frozen object literal
// with `"code": "description"` pairs inside it; a regex keeps this script
// dependency-free while staying robust to formatting.
const catalogueStart = contractsSrc.indexOf("export const PERMISSION_CATALOGUE");
const templatesStart = contractsSrc.indexOf("export const SYSTEM_ROLE_TEMPLATES");
if (catalogueStart === -1 || templatesStart === -1) {
  throw new Error("cannot locate PERMISSION_CATALOGUE / SYSTEM_ROLE_TEMPLATES in contracts");
}
const catalogueSrc = contractsSrc.slice(catalogueStart, templatesStart);
const catalogue = [...catalogueSrc.matchAll(/"([a-z][a-z0-9_.]+)":\s*"([^"]*)"/g)].map(
  ([, code, description]) => ({ code, description }),
);
if (catalogue.length < 300) {
  throw new Error(`catalogue parse looks wrong: ${catalogue.length} entries`);
}

const TEMPLATES = {
  tenant_admin: "a2000000-0000-4000-8000-000000000001",
  doctor: "a2000000-0000-4000-8000-000000000002",
  // receptionist keeps the legacy grants (demo A only)
  receptionist: "a2000000-0000-4000-8000-000000000003",
};
const TEMPLATE_SOURCE = {
  tenant_admin: null, // resolved from the source below
  doctor: null,
};
// Parse the SYSTEM_ROLE_TEMPLATES block per role.
{
  const block = contractsSrc.slice(templatesStart);
  for (const role of Object.keys(TEMPLATE_SOURCE)) {
    const m = block.match(new RegExp(`${role}: \\[([\\s\\S]*?)\\],`));
    if (m) {
      TEMPLATE_SOURCE[role] = [...m[1].matchAll(/"([a-z][a-z0-9_.]+)"/g)].map((x) => x[1]);
    }
  }
}

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";
const ROLE_B = {
  tenant_admin: "b2000000-0000-4000-8000-000000000001",
  doctor: "b2000000-0000-4000-8000-000000000002",
  receptionist: "b2000000-0000-4000-8000-000000000003",
};

const client = new pg.Client({ connectionString: resolveUrl() });
await client.connect();

try {
  // 1. Catalogue sync
  let inserted = 0;
  for (const { code, description } of catalogue) {
    const r = await client.query(
      `INSERT INTO permissions (code, description) VALUES ($1, $2)
       ON CONFLICT (code) DO UPDATE SET description = EXCLUDED.description
       RETURNING (xmax = 0) AS inserted`,
      [code, description],
    );
    if (r.rows[0]?.inserted) inserted++;
  }
  console.log(`permissions: ${catalogue.length} total, ${inserted} newly inserted`);

  // 2. Demo role grants from templates (delete-then-insert per role)
  for (const tenantId of [TENANT_A, TENANT_B]) {
    const roles = tenantId === TENANT_A ? TEMPLATES : ROLE_B;
    for (const [role, roleId] of Object.entries(roles)) {
      const codes =
        role === "receptionist"
          ? ["patient.record.read", "clinical.schedule.read", "clinical.appointment.read", "clinical.appointment.create", "reference.read"]
          : TEMPLATE_SOURCE[role];
      if (!codes) continue;
      await client.query(`DELETE FROM role_permissions WHERE tenant_id = $1 AND role_id = $2`, [tenantId, roleId]);
      for (const code of codes) {
        await client.query(
          `INSERT INTO role_permissions (tenant_id, role_id, permission_id)
           SELECT $1, $2, id FROM permissions WHERE code = $3
           ON CONFLICT DO NOTHING`,
          [tenantId, roleId, code],
        );
      }
      const count = await client.query(
        `SELECT count(*)::int AS n FROM role_permissions WHERE tenant_id = $1 AND role_id = $2`,
        [tenantId, roleId],
      );
      console.log(`  ${tenantId === TENANT_A ? "A" : "B"} ${role}: ${count.rows[0].n} permissions`);
    }
  }
  console.log("seed-permissions done");
} finally {
  await client.end();
}
