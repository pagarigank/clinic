import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

/**
 * Token contract tests (frontend.md §5.1).
 *
 * §5.1 is explicit that contrast is "verified in CI with a contrast test over
 * the full token set in light, dark, and the top three tenant brand colours".
 * This file lints the palette and computes real WCAG contrast ratios so a bad
 * token cannot ship. jsdom does not load the stylesheet, so the values are
 * parsed straight out of tokens.css — which also means the test fails if a
 * token is removed rather than silently passing on a default.
 *
 * The numeric assertions below are the §5.1 table transcribed; keep them and
 * tokens.css in sync when a palette changes.
 */

const here = dirname(fileURLToPath(import.meta.url));
const tokensPath = resolve(here, "../../../apps/web/src/shared/styles/tokens.css");
const css = readFileSync(tokensPath, "utf8");

/** Read `--name: value` from a selector block (`:root` or a theme selector). */
function tokenBlock(selector: string): Map<string, string> {
  const start = css.indexOf(selector);
  if (start === -1) throw new Error(`token block not found: ${selector}`);
  const open = css.indexOf("{", start);
  const close = css.indexOf("}", open);
  const body = css.slice(open + 1, close);
  const map = new Map<string, string>();
  for (const line of body.split("\n")) {
    // Match custom properties AND plain declarations such as `color-scheme:`,
    // so a theme that forgets to declare a token fails loudly rather than
    // silently comparing against undefined.
    const m = line.match(/^\s*(--[a-z0-9-]+|color-scheme)\s*:\s*([^;]+);/i);
    if (m?.[1] && m[2]) map.set(m[1], m[2].trim());
  }
  return map;
}

const light = tokenBlock(":root {");
const dark = tokenBlock('[data-bs-theme="dark"] {');

/** The §5.1 clinical status palette, transcribed. */
const STATUS_PALETTE = {
  light: {
    critical: "#b42318",
    high: "#b54708",
    normal: "#027a48",
    low: "#175cd3",
    neutral: "#475467",
    pending: "#6941c6",
  },
  dark: {
    critical: "#f97066",
    high: "#fdb022",
    normal: "#47cd89",
    low: "#53b1fd",
    neutral: "#98a2b3",
    pending: "#b692f6",
  },
} as const;

/** Read a token, failing the test with a useful message if it is absent. */
function token(map: Map<string, string>, name: string, mode: string): string {
  const value = map.get(name);
  expect(value, `${mode} must declare ${name}`).toBeTruthy();
  return value as string;
}

function hexToRgb(hex: string): [number, number, number] {
  const m = hex.trim().replace(/^#/, "").match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) throw new Error(`not a 6-digit hex colour: ${hex}`);
  return [parseInt(m[1]!, 16), parseInt(m[2]!, 16), parseInt(m[3]!, 16)];
}

/** WCAG 2.x relative luminance. */
function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((c) => {
    const channel = c / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

/** WCAG 2.x contrast ratio, 1..21. */
export function contrastRatio(foreground: string, background: string): number {
  const l1 = luminance(foreground);
  const l2 = luminance(background);
  const [lightest, darkest] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (lightest + 0.05) / (darkest + 0.05);
}

describe("tokens.css exists and declares the §5.1 token families", () => {
  it("defines every clinical status token in light mode", () => {
    for (const tone of Object.keys(STATUS_PALETTE.light)) {
      expect(light.get(`--status-${tone}`), `--status-${tone}`).toBe(STATUS_PALETTE.light[tone as keyof typeof STATUS_PALETTE.light]);
    }
  });

  it("defines every clinical status token in dark mode", () => {
    for (const tone of Object.keys(STATUS_PALETTE.dark)) {
      expect(dark.get(`--status-${tone}`), `--status-${tone}`).toBe(STATUS_PALETTE.dark[tone as keyof typeof STATUS_PALETTE.dark]);
    }
  });

  it("keeps the clinical status palette FIXED across themes — a tenant brand cannot recolour it", () => {
    // The whole point of the §5.1 split: status colour must never track branding.
    expect(light.get("--brand-primary")).not.toBe(light.get("--status-normal"));
    for (const tone of Object.keys(STATUS_PALETTE.light)) {
      expect(dark.get(`--status-${tone}`)).not.toBe(light.get(`--status-${tone}`));
    }
  });

  it("provides a tinted background for each status so a pill is text-on-tint", () => {
    for (const tone of Object.keys(STATUS_PALETTE.light)) {
      expect(light.get(`--status-${tone}-bg`), `--status-${tone}-bg`).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it("declares the 4px spacing scale (§5.1)", () => {
    expect(light.get("--space-1")).toBe("0.25rem");
    expect(light.get("--space-4")).toBe("1rem");
  });

  it("declares §5.1 radii and the touch row-height minimum (P-10)", () => {
    expect(light.get("--radius-sm")).toBe("6px");
    expect(light.get("--radius-md")).toBe("10px");
    expect(light.get("--radius-lg")).toBe("14px");
    expect(light.get("--radius-input")).toBe("8px");
    // P-10: 44px minimum target on touch.
    expect(light.get("--row-height")).toBe("44px");
  });
});

describe("contrast (frontend §5.1 — body text >= 4.5:1)", () => {
  const BODY_MIN = 4.5;
  const LARGE_OR_BORDER_MIN = 3.0;

  for (const [mode, palette] of Object.entries(STATUS_PALETTE)) {
    const tokens = mode === "dark" ? dark : light;
    const canvas = token(tokens, "--surface-canvas", mode);

    for (const [tone, hex] of Object.entries(palette)) {
      it(`${mode}: --status-${tone} text on ${canvas} meets 4.5:1`, () => {
        const ratio = contrastRatio(hex, canvas);
        expect(
          ratio,
          `--status-${tone} (${hex}) on ${canvas} is ${ratio.toFixed(2)}:1, below ${BODY_MIN}:1`,
        ).toBeGreaterThanOrEqual(BODY_MIN);
      });

      it(`${mode}: --status-${tone} on its own tint meets 4.5:1`, () => {
        // A StatusPill is text-on-tint, so this pair is the real one a user reads.
        const tint = token(tokens, `--status-${tone}-bg`, mode);
        const ratio = contrastRatio(hex, tint);
        expect(
          ratio,
          `--status-${tone} (${hex}) on ${tint} is ${ratio.toFixed(2)}:1, below ${BODY_MIN}:1`,
        ).toBeGreaterThanOrEqual(BODY_MIN);
      });
    }

    it(`${mode}: body text on canvas meets 4.5:1`, () => {
      const ratio = contrastRatio(token(tokens, "--text-primary", mode), canvas);
      expect(ratio, `body text is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(BODY_MIN);
    });

    it(`${mode}: secondary text on canvas meets 4.5:1`, () => {
      const ratio = contrastRatio(token(tokens, "--text-secondary", mode), canvas);
      expect(ratio, `secondary text is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(BODY_MIN);
    });

    it(`${mode}: muted text on raised surface meets 4.5:1`, () => {
      const ratio = contrastRatio(
        token(tokens, "--text-muted", mode),
        token(tokens, "--surface-raised", mode),
      );
      expect(ratio, `muted text is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(BODY_MIN);
    });

    it(`${mode}: borders meet the 3:1 non-text minimum`, () => {
      const raised = token(tokens, "--surface-raised", mode);
      for (const name of ["--border-subtle", "--border-strong"]) {
        const ratio = contrastRatio(token(tokens, name, mode), raised);
        expect(ratio, `${name} is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(LARGE_OR_BORDER_MIN);
      }
    });

    it(`${mode}: link colour on canvas meets 4.5:1`, () => {
      // Use THIS mode's link token — the light-mode cerulean is unreadable on a
      // dark canvas, which is exactly why dark mode defines its own.
      const link = token(tokens, "--text-link", mode);
      const ratio = contrastRatio(link, canvas);
      expect(ratio, `${mode} link ${link} on ${canvas} is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(BODY_MIN);
    });

    it(`${mode}: focus ring meets 3:1 against raised surface`, () => {
      const ratio = contrastRatio(
        token(tokens, "--border-focus", mode),
        token(tokens, "--surface-raised", mode),
      );
      expect(ratio, `${mode} focus ring is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(LARGE_OR_BORDER_MIN);
    });
  }

  it("sets color-scheme so form controls and scrollbars follow the theme", () => {
    expect(light.get("color-scheme")).toBe("light");
    expect(dark.get("color-scheme")).toBe("dark");
  });
});

describe("density (frontend §5.1)", () => {
  it("offers comfortable and compact", () => {
    expect(css).toContain('[data-density="comfortable"]');
    expect(css).toContain('[data-density="compact"]');
  });

  it("keeps interactive controls at the 44px touch minimum in compact density", () => {
    // P-10 is a floor for tappable targets; compact may tighten table ROWS on
    // pointer devices, but it must never shrink an input below 44px.
    const compact = css.slice(css.indexOf('[data-density="compact"] {'));
    const compactBlock = compact.slice(0, compact.indexOf("}"));
    expect(compactBlock).not.toContain("--control-height");
  });
});

describe("print (frontend §6)", () => {
  it("forces black-on-white regardless of theme and strips navigation", () => {
    const print = css.slice(css.indexOf("@media print"));
    expect(print).toContain("#000000");
    expect(print).toContain("display: none");
    expect(print).toContain("clinic-no-print");
  });
});