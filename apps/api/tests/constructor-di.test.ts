import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Constructor-injection guard (the tsx/esbuild `design:paramtypes` trap).
 *
 * THE BUG THIS EXISTS TO CATCH
 * `emitDecoratorMetadata: true` is set in tooling/tsconfig.base.json, so
 * `constructor(private readonly svc: Svc)` looks correct to TypeScript and to
 * `tsc`. But the dev server runs through `tsx`, whose esbuild transform does
 * NOT emit design:paramtypes. Nest therefore sees a zero-length dependency list,
 * binds nothing, and every request fails at runtime with
 *
 *     Cannot read properties of undefined (reading 'listNotifications')
 *
 * This is silent: typecheck passes, `tsc` build passes, the unit tests for the
 * service pass, and the route is even listed in the OpenAPI document. It only
 * appears when a real HTTP request reaches the controller — which is exactly how
 * it shipped once already (14 controllers in d93b5dd, then
 * notifications.controller.ts in Phase 9).
 *
 * WHY A SOURCE SCAN
 * Detecting this properly needs either a live DI container (needs a database and
 * full env, and @nestjs/testing is deliberately not a dependency) or reading
 * emitted metadata. A source scan is cheap, needs no environment, and fails at
 * the exact moment someone adds the offending constructor — which is the moment
 * it matters. Controllers and services are both a closed set in this codebase, so the scan
 * has no blind spot worth trading a boot-time container for.
 *
 * The rule, stated once: any constructor parameter that is a class-typed
 * dependency MUST carry an explicit @Inject() token.
 */

const SRC_ROOT = process.cwd().endsWith("apps\\api") || process.cwd().endsWith("apps/api")
  ? join(process.cwd(), "src")
  : join(process.cwd(), "apps/api/src");

function injectableFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...injectableFiles(full));
    } else if (entry.endsWith(".controller.ts") || entry.endsWith(".service.ts")) {
      // Services count too: PharmacyService and LabService both injected SupplyService
      // without a token, so posting a dispense died with
      // "Cannot read properties of undefined (reading 'postMovement')" — the same
      // trap, one layer down, where no test or typecheck could see it.
      out.push(full);
    }
  }
  return out;
}

interface ConstructorFinding {
  file: string;
  line: number;
  text: string;
}

/** Every constructor parameter lacking an @Inject() decorator on its line. */
function findUndecoratedInjections(files: string[]): ConstructorFinding[] {
  const findings: ConstructorFinding[] = [];

  for (const file of files) {
    const src = readFileSync(file, "utf8");
    const lines = src.split("\n");

    lines.forEach((line, i) => {
      // Only a constructor declaration, not a call site or a comment.
      if (!/\bconstructor\s*\(/.test(line)) return;

      // Single-line form: constructor(private readonly x: X) {}
      const single = line.match(/constructor\s*\(([^)]*)\)/);
      if (single?.[1] && /private|public|protected|readonly/.test(single[1])) {
        if (!/@Inject\(/.test(line)) {
          findings.push({ file, line: i + 1, text: line.trim() });
        }
        return;
      }

      // Multi-line form: scan forward to the closing ") {" of the parameter list.
      if (single) return; // no params of interest
      for (let j = i + 1; j < Math.min(i + 20, lines.length); j++) {
        const l = lines[j]!;
        if (/private|public|protected/.test(l) && /:/.test(l)) {
          // A parameter that declares a type but has no @Inject token. The decorator
          // may sit on its own line above (the idiomatic form for multi-parameter
          // constructors), so accept either.
          const decorated = /@Inject\(/.test(l) || /@Inject\(/.test(lines[j - 1] ?? "");
          if (!decorated) {
            findings.push({ file, line: j + 1, text: l.trim() });
          }
        }
        if (/^\s*\)\s*\{/.test(l)) break;
      }
    });
  }

  return findings;
}

describe("constructor injection (controllers + services)", () => {
  const files = injectableFiles(SRC_ROOT);

  it("finds injectable classes to check (sanity: the scan is not silently empty)", () => {
    expect(files.length, "no controllers found — has apps/api/src moved?").toBeGreaterThan(10);
  });

  it("every constructor dependency carries an explicit @Inject() token", () => {
    const findings = findUndecoratedInjections(files);

    const report = findings
      .map((f) => `  ${f.file.replace(SRC_ROOT, "src")}:${f.line}  ${f.text}`)
      .join("\n");

    expect(
      findings,
      `Constructor injection without @Inject() — under tsx these bind undefined and every ` +
        `route fails with "Cannot read properties of undefined":\n${report}`,
    ).toEqual([]);
  });

  it("does not flag the controllers that are correctly annotated", () => {
    // Guards against the scan passing because it matches nothing at all: these
    // two are known-good and must never appear as findings.
    const findings = findUndecoratedInjections(files);
    const flagged = findings.map((f) => f.file);
    expect(flagged).not.toContain(join(SRC_ROOT, "auth", "auth.controller.ts"));
    expect(flagged).not.toContain(join(SRC_ROOT, "patients", "patients.controller.ts"));
    expect(flagged).not.toContain(join(SRC_ROOT, "notifications", "notifications.controller.ts"));
  });
});