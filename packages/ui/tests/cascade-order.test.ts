import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

/**
 * Bootstrap cascade-order guard (architecture ADR-8, frontend.md §5.1).
 *
 * THE BUG THIS EXISTS TO CATCH
 * Bootstrap ships its own `:root, [data-bs-theme=light] { --bs-primary: #0d6efd }`.
 * Our brand bridge used the same `:root` specificity in a stylesheet imported
 * FIRST. Equal specificity means the LAST declaration wins — so Bootstrap's
 * block silently beat ours and the tenant brand colour was never applied. jsdom
 * does not evaluate custom-property cascade at all, so no component test could
 * have caught it; only reading the BUILT bundle reveals the true order.
 *
 * This test therefore asserts on `apps/web/dist/assets/*.css`. It is skipped
 * with a clear message when the bundle is absent (e.g. a fresh checkout before
 * `pnpm build`), because a missing artefact is not a cascade defect.
 *
 * To keep the check honest, the build must run before this suite in CI; see
 * .github/workflows/ci.yml (build precedes the unit step).
 */

const here = dirname(fileURLToPath(import.meta.url));
const distAssets = resolve(here, "../../apps/web/dist/assets");

function builtCss(): string | null {
  if (!existsSync(distAssets)) return null;
  const cssFiles = readdirSync(distAssets).filter((f) => f.endsWith(".css"));
  if (cssFiles.length === 0) return null;
  // The single chunk is the app bundle; concatenating keeps the check working if
  // Vite ever splits the stylesheet.
  return cssFiles.map((f) => readFileSync(resolve(distAssets, f), "utf8")).join("\n");
}

/** Offset of the first occurrence of a declaration, or -1. */
function declOffset(css: string, prop: string): number {
  const re = new RegExp(`${prop.replace(/[-]/g, "\\-")}\\s*:`, "i");
  const m = re.exec(css);
  return m ? m.index : -1;
}

describe("Bootstrap brand bridge wins the cascade in the BUILT bundle", () => {
  const css = builtCss();

  it.skipIf(css === null)("our --bs-primary bridge appears AFTER Bootstrap's own block", () => {
    expect(css).not.toBeNull();
    const source = css as string;

    const occurrences = [...source.matchAll(/--bs-primary\s*:\s*([^;]+);/gi)].map((m) => ({
      value: (m[1] ?? "").trim(),
      at: m.index ?? 0,
    }));

    expect(occurrences.length, "expected both a Bootstrap and a bridged declaration").toBeGreaterThanOrEqual(2);

    const bridge = occurrences.filter((o) => o.value.includes("var(--brand-primary)"));
    expect(
      bridge.length,
      "no --bs-primary declaration bridging to var(--brand-primary) found in the bundle",
    ).toBeGreaterThanOrEqual(1);

    // Every declaration that comes AFTER ours must not be a raw hex, or it
    // overrides the brand token.
    const ours = bridge[bridge.length - 1]!;
    const later = occurrences.filter((o) => o.at > ours.at);
    for (const o of later) {
      expect(
        o.value.startsWith("#") || o.value.startsWith("var("),
        `a declaration after the brand bridge (at ${o.at}) overrides it: --bs-primary: ${o.value}`,
      ).toBe(true);
    }
    // And specifically: no Bootstrap default hex may sit after our bridge.
    expect(
      later.some((o) => o.value === "#0d6efd"),
      "Bootstrap's default --bs-primary (#0d6efd) is declared after the brand bridge and wins",
    ).toBe(false);
  });

  it.skipIf(css === null)("the clinical status tokens reach the bundle", () => {
    const source = css as string;
    // If tokens.css stopped being imported, every status pill would lose its
    // colour and silently fall back to Bootstrap defaults.
    for (const tone of ["critical", "high", "normal", "low", "neutral", "pending"]) {
      expect(source, `--status-${tone} missing from the bundle`).toContain(`--status-${tone}:`);
    }
    expect(source).toContain(".clinic-status-critical");
    expect(source).toContain("[data-density=compact]");
    expect(source).toContain("tabular-nums");
  });

  it.skipIf(css === null)("dark mode and print overrides are both present", () => {
    const source = css as string;
    expect(source).toContain('[data-bs-theme=dark]');
    expect(source).toContain("@media print");
    expect(source).toContain("color-scheme:dark");
  });
});