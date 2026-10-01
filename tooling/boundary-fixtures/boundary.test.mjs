/**
 * Boundary-lint guard test (todo.md Phase 0 exit gate:
 * "Boundary lint rules are active — a deliberate violation fails CI").
 * Runs eslint on the fixtures; violations must exit non-zero, clean must pass.
 */
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
// here = <repo>/tooling/boundary-fixtures → repo root is two levels up.
const repo = dirname(dirname(here));
// Spawn eslint's JS entry with Node directly — the .bin shims do not execute
// under execFileSync on Windows.
const eslintBin = join(repo, "node_modules", "eslint", "bin", "eslint.js");
const nodeBin = process.execPath;

function lint(file) {
  try {
    const args = [eslintBin, file, "--no-config-lookup", "--config", join(repo, "eslint.config.mjs")];
    const out = execFileSync(nodeBin, args, { cwd: repo, stdio: "pipe", encoding: "utf8" });
    if (out) console.log(out);
    return true;
  } catch (e) {
    console.error(String(e.stdout ?? "") + String(e.stderr ?? ""));
    return false;
  }
}

const violationFiles = [
  join(here, "violation-bootstrap.ts"),
  join(here, "violation-migration.ts"),
];

for (const f of violationFiles) {
  if (lint(f)) {
    throw new Error(`Boundary violation NOT caught by lint: ${f}`);
  }
}
if (!lint(join(here, "clean.ts"))) {
  throw new Error("Clean file failed boundary lint — rules over-fire");
}
console.log("boundary lint fixtures OK (violations caught, clean passes)");
