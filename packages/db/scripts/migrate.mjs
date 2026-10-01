#!/usr/bin/env node
/**
 * Migration runner (todo 0.2): forward-only SQL with **down** scripts and a
 * seed command — `pnpm db:migrate | db:rollback | db:seed`.
 *
 * Connects as clinic_owner (DATABASE_URL_MIGRATOR). Applied migrations are
 * recorded in clinic_schema_migrations. `down` rolls back the most recent
 * migration (or all with --all). Every migration file pair is
 *   NNNN_name.migration.sql / NNNN_name.rollback.sql
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, "..", "migrations");
const seedsDir = join(migrationsDir, "seeds");

function resolveUrl() {
  return (
    process.env.DATABASE_URL_MIGRATOR ??
    // Native local Postgres (see todo.md line 10). `@` in the password is
    // URL-encoded. This superuser is the migrator/owner role.
    "postgres://kpagarigan2:P%40ssw0rd@localhost:5432/clinic"
  );
}

/**
 * Native-PG bootstrap: if the `clinic` database does not exist yet, create it
 * by connecting to the maintenance `postgres` database first (error 3D000).
 */
async function ensureDatabase(url) {
  const client = new pg.Client({ connectionString: url });
  try {
    await client.connect();
    await client.end();
  } catch (e) {
    if (e.code !== "3D000" && !/database .* does not exist/.test(e.message ?? "")) throw e;
    const u = new URL(url);
    const dbName = u.pathname.replace(/^\//, "");
    u.pathname = "/postgres";
    const admin = new pg.Client({ connectionString: u.toString() });
    await admin.connect();
    try {
      await admin.query(`CREATE DATABASE "${dbName}"`);
      console.log(`created database ${dbName}`);
    } finally {
      await admin.end();
    }
  }
}

async function ensureLedger(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS clinic_schema_migrations (
      name       text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
}

function listMigrations() {
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".migration.sql"));
  return files
    .map((f) => {
      const base = f.replace(/\.migration\.sql$/, "");
      return {
        name: base,
        up: join(migrationsDir, f),
        down: join(migrationsDir, `${base}.rollback.sql`),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function migrateUp() {
  const url = resolveUrl();
  await ensureDatabase(url);
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await ensureLedger(client);
    const applied = new Set(
      (await client.query("SELECT name FROM clinic_schema_migrations")).rows.map((r) => r.name),
    );
    for (const m of listMigrations()) {
      if (applied.has(m.name)) continue;
      const sql = readFileSync(m.up, "utf8");
      try {
        await client.query("BEGIN");
        await client.query(sql);
        // Migrations may SET ROLE (ownership transfer); reset so the runner's
        // ledger bookkeeping runs as the connecting superuser.
        await client.query("RESET ROLE");
        await client.query("INSERT INTO clinic_schema_migrations (name) VALUES ($1)", [m.name]);
        await client.query("COMMIT");
        console.log(`up   ${m.name}`);
      } catch (e) {
        await client.query("ROLLBACK");
        throw new Error(`migration ${m.name} failed: ${e.message}`);
      }
    }
    console.log("migrations up to date");
  } finally {
    await client.end();
  }
}

async function migrateDown(all = false) {
  const client = new pg.Client({ connectionString: resolveUrl() });
  await client.connect();
  try {
    await ensureLedger(client);
    const { rows } = await client.query(
      "SELECT name FROM clinic_schema_migrations ORDER BY applied_at DESC, name DESC",
    );
    if (rows.length === 0) {
      console.log("nothing to roll back");
      return;
    }
    const targets = all ? rows : rows.slice(0, 1);
    for (const { name } of targets) {
      const down = join(migrationsDir, `${name}.rollback.sql`);
      const sql = readFileSync(down, "utf8");
      try {
        await client.query("BEGIN");
        await client.query(sql);
        await client.query("DELETE FROM clinic_schema_migrations WHERE name = $1", [name]);
        await client.query("COMMIT");
        console.log(`down ${name}`);
      } catch (e) {
        await client.query("ROLLBACK");
        throw new Error(`rollback ${name} failed: ${e.message}`);
      }
    }
  } finally {
    await client.end();
  }
}

async function seed() {
  const client = new pg.Client({ connectionString: resolveUrl() });
  await client.connect();
  try {
    const files = readdirSync(seedsDir).filter((f) => f.endsWith(".sql")).sort();
    for (const f of files) {
      await client.query(readFileSync(join(seedsDir, f), "utf8"));
      console.log(`seed ${f}`);
    }
    console.log("seeds applied");
  } finally {
    await client.end();
  }
}

const cmd = process.argv[2] ?? "up";
const flag = process.argv[3];
try {
  if (cmd === "up") await migrateUp();
  else if (cmd === "down") await migrateDown(flag === "--all");
  else if (cmd === "seed") await seed();
  else {
    console.error(`unknown command: ${cmd} (use up | down [--all] | seed)`);
    process.exit(1);
  }
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
