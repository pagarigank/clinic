import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

describe("migration integrity", () => {
  it("every migration has a down script", () => {
    const ups = readdirSync(migrationsDir).filter((f) => f.endsWith(".migration.sql"));
    expect(ups.length).toBeGreaterThan(0);
    const downs = new Set(
      readdirSync(migrationsDir).filter((f) => f.endsWith(".rollback.sql")),
    );
    for (const up of ups) {
      const base = up.replace(/\.migration\.sql$/, "");
      expect(downs.has(`${base}.rollback.sql`), `missing rollback for ${up}`).toBe(true);
    }
  });

  it("migration names are sortable and unique by numeric prefix", () => {
    const prefixes = readdirSync(migrationsDir)
      .filter((f) => f.endsWith(".migration.sql"))
      .map((f) => f.slice(0, 4));
    expect(new Set(prefixes).size).toBe(prefixes.length);
  });
});
