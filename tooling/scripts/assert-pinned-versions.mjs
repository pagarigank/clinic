#!/usr/bin/env node
/**
 * Assert every dependency in the workspace is pinned to an exact version.
 *
 * todo 0.5 — "pinned versions asserted". A caret/tilde range in a published
 * workspace package means `pnpm install` can resolve a different tree than the
 * one that was reviewed and tested, and the lockfile is the only thing standing
 * between a merge and a compromised transitive release. This check fails CI
 * before that can happen.
 *
 * Exits 0 when everything is pinned, 1 with a report otherwise.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Range markers that make a version float. */
const FLOATING = ["^", "~", ">", "<", "*", "x", "latest"];

/**
 * Fields that must be exact.
 *
 * `peerDependencies` is deliberately excluded: a UI package declaring
 * `"react": "19.x"` is stating a compatibility range, not resolving an
 * install. Pinning peers to one patch would break every consumer.
 */
const DEP_FIELDS = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
];

/**
 * Workspace protocol (`workspace:*`) is local-only — it resolves to a sibling
 * package in this repo, never to the registry, so it cannot float.
 */
function isWorkspaceLocal(range) {
  return range.startsWith("workspace:");
}

/** Workspace package.json files, found from the pnpm workspace globs. */
function packageManifests(dir = root, acc = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".git" || entry === "dist") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      packageManifests(full, acc);
    } else if (entry === "package.json") {
      acc.push(full);
    }
  }
  return acc;
}

const offenders = [];

for (const manifestPath of packageManifests()) {
  const rel = manifestPath.slice(root.length + 1).replace(/\\/g, "/");
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (err) {
    console.error(`FAIL ${rel}: not valid JSON (${err.message})`);
    process.exit(1);
  }

  for (const field of DEP_FIELDS) {
    for (const [name, range] of Object.entries(manifest[field] ?? {})) {
      if (typeof range !== "string") continue;
      if (isWorkspaceLocal(range)) continue;
      if (FLOATING.some((token) => range.includes(token))) {
        offenders.push(`  ${rel}  ${field}.${name} = "${range}"`);
      }
    }
  }
}

if (offenders.length > 0) {
  console.error(`FAIL  ${offenders.length} floating dependency version(s):`);
  for (const line of offenders) console.error(line);
  console.error("\nPin every dependency to an exact version (e.g. \"9.39.2\").");
  process.exit(1);
}

console.log("PASS  all workspace dependencies are pinned to exact versions");
