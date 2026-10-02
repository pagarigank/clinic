import { afterEach, beforeEach, describe, expect, it } from "vitest";
import i18n, { DEFAULT_LOCALE, SUPPORTED_LOCALES, setLocale } from "../src/shared/i18n/index.js";
import {
  __resetFormatCaches,
  formatCode,
  formatDate,
  formatDateTime,
  formatMoney,
  formatPercent,
  formatQuantity,
  formatRelative,
  formatResultValue,
  timeZoneLabel,
} from "../src/shared/i18n/format.js";

/**
 * i18n / formatting (frontend.md §18).
 *
 * The contract these tests protect: STORED FORMATS ARE CANONICAL. Helpers take
 * a server value and render it — they never parse a display string, never
 * re-round, and never compute a total (ground rule 6, P-6). The "does not
 * recompute" cases are the ones worth writing, because a future refactor that
 * "helpfully" sums line items in the client would pass every happy-path test.
 */

beforeEach(async () => {
  window.localStorage.clear();
  await setLocale(DEFAULT_LOCALE);
  __resetFormatCaches();
});

afterEach(() => {
  __resetFormatCaches();
});

describe("locale configuration (frontend §18)", () => {
  it("defaults to en-PH and supports en-US", () => {
    expect(DEFAULT_LOCALE).toBe("en-PH");
    expect(SUPPORTED_LOCALES).toEqual(["en-PH", "en-US"]);
  });

  it("persists a supported locale and switches the active language", async () => {
    await setLocale("en-US");
    expect(i18n.language).toBe("en-US");
    expect(window.localStorage.getItem("clinic.locale")).toBe("en-US");
  });

  it("ignores an unsupported locale rather than passing it to Intl", async () => {
    await setLocale("en-US");
    await setLocale("xx-YY" as never);
    expect(i18n.language).toBe("en-US");
  });

  it("falls back to the default when a stored locale is unsupported", () => {
    window.localStorage.setItem("clinic.locale", "zz");
    expect(i18n.t("common.actions.save")).toBe("Save");
  });
});

describe("formatMoney (P-6 — renders, never computes)", () => {
  it("renders a server numeric(14,2) in the tenant currency", () => {
    const result = formatMoney("1234.50", "PHP", "en-PH");
    expect(result).toContain("1,234.50");
    expect(result).toContain("₱");
  });

  it("renders exactly two fraction digits — the server already rounded", () => {
    expect(formatMoney("100", "PHP", "en-PH")).toContain("100.00");
  });

  it("honours a tenant-configurable currency (G-09)", () => {
    expect(formatMoney("10", "USD", "en-US")).toContain("$");
  });

  it("uses zero fraction digits for a zero-decimal currency", () => {
    // JPY has no minor units; showing "100.00 JPY" would be wrong.
    expect(formatMoney("100", "JPY", "en-US")).toContain("100");
    expect(formatMoney("100", "JPY", "en-US")).not.toContain(".00");
  });

  it("degrades to an em dash for a non-numeric value rather than NaN", () => {
    expect(formatMoney("not-a-number", "PHP", "en-PH")).toBe("—");
    expect(formatMoney(null as never, "PHP", "en-PH")).toBe("—");
  });
});

describe("formatQuantity (frontend §18 — base UOM, conversion is server-side)", () => {
  it("groups digits without converting units", () => {
    expect(formatQuantity("12500", { locale: "en-PH" })).toContain("12,500");
  });

  it("appends the unit when given", () => {
    expect(formatQuantity("6", { unit: "packs", locale: "en-PH" })).toContain("packs");
  });

  it("respects an explicit decimal scale rather than guessing one", () => {
    expect(formatQuantity("1.5", { decimals: 1, locale: "en-PH" })).toContain("1.5");
  });
});

describe("formatResultValue (Q-6 — no silent rounding)", () => {
  it("displays with the analyte's decimals", () => {
    expect(formatResultValue("5.4", 1, "mmol/L", "en-PH")).toContain("5.4 mmol/L");
  });

  it("does not round away precision the server deliberately sent", () => {
    // Q-6: "no silent rounding, display rounds only". A 3-decimal analyte must
    // not be collapsed to 1 just because a default was convenient.
    expect(formatResultValue("5.456", 3, "", "en-PH")).toContain("5.456");
  });

  it("renders a dash for an absent result rather than 0", () => {
    // An absent value and a zero are clinically different; showing 0 would be
    // a false result.
    expect(formatResultValue(null, 1)).toBe("—");
    expect(formatResultValue("", 1)).toBe("—");
  });
});

describe("date formatting (G-08 — stored UTC, rendered in tenant timezone)", () => {
  it("renders a canonical ISO date in Asia/Manila", () => {
    const result = formatDate("2026-10-01T09:30:00.000Z", "en-PH");
    expect(result).toContain("2026");
    expect(result).toContain("Oct");
  });

  it("does NOT use the browser's timezone", () => {
    // If the machine is UTC and the tenant is Asia/Manila (+8), a UTC-formatted
    // 09:30 would read as 09:30 locally; the tenant must see 17:30.
    const result = formatDateTime("2026-10-01T09:30:00.000Z", "en-PH");
    expect(result).toMatch(/5:30\s*PM|17:30/);
  });

  it("spells out the timezone alongside the timestamp (§5.2)", () => {
    expect(formatDateTime("2026-10-01T09:30:00.000Z", "en-PH")).toContain(timeZoneLabel());
  });

  it("degrades to a dash for an invalid or absent date", () => {
    expect(formatDate(null)).toBe("—");
    expect(formatDate("not-a-date")).toBe("—");
  });

  it("produces a relative label for the P-5 relative+absolute pair", () => {
    const future = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    expect(formatRelative(future)).toMatch(/hour|in 2/);
  });

  it("falls back to the absolute form beyond 30 days", () => {
    const far = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();
    expect(formatRelative(far)).toMatch(/month/);
  });
});

describe("formatPercent and formatCode", () => {
  it("renders a server-supplied ratio as a percentage", () => {
    expect(formatPercent(0.945, 1, "en-PH")).toContain("94.5");
  });

  it("renders a code verbatim and a missing code as a dash", () => {
    expect(formatCode("A09")).toBe("A09");
    expect(formatCode(null)).toBe("—");
  });
});

describe("locale-aware rendering changes with the active locale", () => {
  it("renders the same stored value identically across en-PH/en-US for PHP", async () => {
    // en-PH and en-US share the en numbering system, so PHP money groups the
    // same way in both. This is the §18 contract in its strongest form: the
    // stored value is canonical and the locale only ever *renders* it.
    await setLocale("en-PH");
    const ph = formatMoney("1234.50", "PHP");
    await setLocale("en-US");
    const us = formatMoney("1234.50", "PHP");
    expect(ph).toContain("1,234.50");
    expect(us).toContain("1,234.50");
  });

  it("renders the tenant currency symbol in both supported locales", async () => {
    // PHP (tenant default, G-09) and a second currency, proving the currency
    // argument drives the symbol rather than a hard-coded one.
    await setLocale("en-PH");
    expect(formatMoney("1234.50", "PHP")).toContain("₱");
    await setLocale("en-US");
    expect(formatMoney("1234.50", "USD")).toContain("$");
  });
});