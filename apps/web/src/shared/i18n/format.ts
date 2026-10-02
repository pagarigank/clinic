import { DEFAULT_CURRENCY, DEFAULT_LOCALE, DEFAULT_TIMEZONE, currentLocale } from "./index.js";

/**
 * Format helpers (frontend.md §18).
 *
 * Every function here takes a CANONICAL value from the server and renders it.
 * None of them parse, re-round, or derive. This is the enforcement point for
 * frontend principle P-6 / ground rule 6: the client displays money, it never
 * computes it. If you find yourself needing arithmetic here, the number belongs
 * in a server-rendered field instead.
 *
 * Canonical inputs:
 *   - dates  : ISO 8601 string (`2026-10-01T09:30:00.000Z`) or epoch millis
 *   - money  : `numeric(14,2)` as a number or numeric string — already rounded
 *   - qty    : base-UOM number; `formatQuantity` only applies locale grouping
 *   - clinical values: analyte-precision number; callers pass the analyte's
 *              decimals explicitly so we never guess a scale (Q-6: no silent
 *              rounding, display rounds only)
 */

/** Intl formatters are expensive to construct; memoise per (locale, opts). */
const numberCache = new Map<string, Intl.NumberFormat>();
const dateCache = new Map<string, Intl.DateTimeFormat>();

function numberFormat(locale: string, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = `${locale}|${JSON.stringify(options)}`;
  let fmt = numberCache.get(key);
  if (!fmt) {
    fmt = new Intl.NumberFormat(locale, options);
    numberCache.set(key, fmt);
  }
  return fmt;
}

function dateFormat(locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale}|${JSON.stringify(options)}`;
  let fmt = dateCache.get(key);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat(locale, { timeZone: DEFAULT_TIMEZONE, ...options });
    dateCache.set(key, fmt);
  }
  return fmt;
}

/**
 * Money. Renders the server value in the tenant's currency with grouping.
 * `minorUnits` is informational only — the server has already rounded to the
 * currency's minor units, so we format with that fraction digit count and
 * never round again here.
 */
export function formatMoney(
  amount: number | string,
  currency: string = DEFAULT_CURRENCY,
  locale: string = currentLocale(),
): string {
  const value = typeof amount === "string" ? Number(amount) : amount;
  if (!Number.isFinite(value)) return "—";
  const minorUnits = resolveMinorUnits(currency);
  return numberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: minorUnits,
    maximumFractionDigits: minorUnits,
  }).format(value);
}

/** Currency minor-unit table for the currencies v1 can encounter (G-09). */
function resolveMinorUnits(currency: string): number {
  // ISO 4217 has no minor-unit metadata in Intl; JPY/KRW are the zero-decimal
  // currencies a PH clinic would plausibly price in. Default to 2.
  return ["JPY", "KRW", "VND", "CLP", "ISK"].includes(currency) ? 0 : 2;
}

/**
 * Quantity. Locale grouping only — never unit conversion. Conversion is a
 * server concern (frontend §18: stored in base UOM, displayed in preferred UOM
 * with the conversion shown on demand).
 */
export function formatQuantity(
  quantity: number | string,
  options: { unit?: string; decimals?: number; locale?: string } = {},
): string {
  const value = typeof quantity === "string" ? Number(quantity) : quantity;
  if (!Number.isFinite(value)) return "—";
  const { unit, decimals, locale = currentLocale() } = options;
  const formatted = numberFormat(locale, {
    minimumFractionDigits: decimals ?? 0,
    maximumFractionDigits: decimals ?? 3,
  }).format(value);
  return unit ? `${formatted} ${unit}` : formatted;
}

/**
 * Clinical result value. Q-6 requires no silent rounding, so the caller passes
 * the analyte's decimals explicitly rather than letting a default guess.
 */
export function formatResultValue(
  value: number | string | null | undefined,
  decimals: number,
  unit?: string,
  locale: string = currentLocale(),
): string {
  if (value === null || value === undefined || value === "") return "—";
  const numeric = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(numeric)) return "—";
  const formatted = numberFormat(locale, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(numeric);
  return unit ? `${formatted} ${unit}` : formatted;
}

/**
 * Date only. Rendered in the tenant timezone (G-08) — never the browser's.
 */
export function formatDate(
  value: string | number | Date | null | undefined,
  locale: string = currentLocale(),
): string {
  const date = toDate(value);
  if (!date) return "—";
  return dateFormat(locale, { dateStyle: "medium" }).format(date);
}

/** Date + time in the tenant timezone, with the timezone spelled out (§5.2). */
export function formatDateTime(
  value: string | number | Date | null | undefined,
  locale: string = currentLocale(),
): string {
  const date = toDate(value);
  if (!date) return "—";
  return (
    dateFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(date) +
    ` ${timeZoneLabel()}`
  );
}

/** P-5: every date shows relative *and* absolute time. */
export function formatRelative(value: string | number | Date | null | undefined): string {
  const date = toDate(value);
  if (!date) return "—";
  const diffMs = date.getTime() - Date.now();
  const absMs = Math.abs(diffMs);
  const rtf = new Intl.RelativeTimeFormat(currentLocale(), { numeric: "auto" });
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (absMs < minute) return rtf.format(Math.round(diffMs / 1000), "second");
  if (absMs < hour) return rtf.format(Math.round(diffMs / minute), "minute");
  if (absMs < day) return rtf.format(Math.round(diffMs / hour), "hour");
  if (absMs < 30 * day) return rtf.format(Math.round(diffMs / day), "day");
  return rtf.format(Math.round(diffMs / (30 * day)), "month");
}

/** Short timezone name for display next to a timestamp (G-08). */
export function timeZoneLabel(): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: DEFAULT_TIMEZONE,
      timeZoneName: "short",
    }).formatToParts(new Date());
    return parts.find((p) => p.type === "timeZoneName")?.value ?? DEFAULT_TIMEZONE;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

/**
 * Code renderer (frontend §5.2): monospace so ICD-10 / LOINC / GS1 codes and
 * numbers line up. Never translated — codes are canonical.
 */
export function formatCode(code: string | null | undefined): string {
  return code ? code : "—";
}

function toDate(value: string | number | Date | null | undefined): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Percentage for TAT / utilisation figures; the server sends the ratio. */
export function formatPercent(ratio: number, decimals = 1, locale: string = currentLocale()): string {
  if (!Number.isFinite(ratio)) return "—";
  return numberFormat(locale, {
    style: "percent",
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(ratio);
}

/** Test seam: clears the Intl caches so a locale change cannot leak formatting. */
export function __resetFormatCaches(): void {
  numberCache.clear();
  dateCache.clear();
}

export { DEFAULT_CURRENCY, DEFAULT_LOCALE, DEFAULT_TIMEZONE };