/**
 * Centralised value renderers — frontend.md §5.2 (`Money` / `Quantity` /
 * `DateTime` / `Code`).
 *
 * "Centralised formatting so money never appears ad hoc": every screen renders
 * server values through these components instead of hand-rolled template
 * strings. They are deliberately *display-only* (ground rule 6, P-6):
 *
 *   - They never parse a previously formatted string back into a number.
 *   - They never round, convert, or recompute a value the server produced.
 *     A value that cannot be rendered is shown as an em dash, not guessed.
 *   - Storage is canonical (ISO 8601, `numeric(14,2)`); `Intl` is the renderer,
 *     with the tenant locale + timezone supplied by the caller (frontend §18).
 */

/** A server amount: `numeric(14,2)` arrives from pg as a string. */
export type ServerAmount = string | number | null | undefined;

function toLocaleString(value: ServerAmount): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : null;
  // Strings must already be canonical; anything unparsable renders as a dash
  // rather than a silently wrong amount.
  return /^-?\d+(\.\d+)?$/.test(value.trim()) ? value.trim() : null;
}

export function Money({
  amount,
  currency = "PHP",
  locale = "en-PH",
  className,
}: {
  amount: ServerAmount;
  currency?: string;
  locale?: string;
  className?: string;
}) {
  const canonical = toLocaleString(amount);
  if (canonical === null) {
    return <span className={`tabular ${className ?? ""}`.trim()}>—</span>;
  }
  let formatted: string;
  try {
    formatted = new Intl.NumberFormat(locale, { style: "currency", currency }).format(
      Number(canonical),
    );
  } catch {
    // Unknown currency code — fall back to the ISO code + raw amount.
    formatted = `${currency} ${canonical}`;
  }
  return <span className={`tabular ${className ?? ""}`.trim()}>{formatted}</span>;
}

export function Quantity({
  value,
  uom,
  locale = "en-PH",
  className,
}: {
  value: ServerAmount;
  /** Base or preferred display UOM; pharmacy strengths always show the unit (frontend §18). */
  uom?: string | null;
  locale?: string;
  className?: string;
}) {
  const canonical = toLocaleString(value);
  if (canonical === null) {
    return <span className={`tabular ${className ?? ""}`.trim()}>—</span>;
  }
  let formatted: string;
  try {
    formatted = new Intl.NumberFormat(locale, { maximumFractionDigits: 4 }).format(
      Number(canonical),
    );
  } catch {
    formatted = canonical;
  }
  return (
    <span className={`tabular ${className ?? ""}`.trim()}>
      {formatted}
      {uom ? <span className="text-body-secondary"> {uom}</span> : null}
    </span>
  );
}

export function DateTime({
  iso,
  timezone = "Asia/Manila",
  locale = "en-PH",
  mode = "datetime",
  className,
}: {
  /** Canonical ISO 8601 string (G-08). */
  iso: string | null | undefined;
  timezone?: string;
  locale?: string;
  mode?: "date" | "time" | "datetime";
  className?: string;
}) {
  if (!iso) return <span className={className}>—</span>;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return <span className={className}>—</span>;
  const parts: Intl.DateTimeFormatOptions =
    mode === "date"
      ? { year: "numeric", month: "short", day: "numeric" }
      : mode === "time"
        ? { hour: "2-digit", minute: "2-digit" }
        : { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" };
  let formatted: string;
  try {
    formatted = new Intl.DateTimeFormat(locale, { ...parts, timeZone: timezone }).format(date);
  } catch {
    // Unknown timezone/locale — ISO stays legible and canonical.
    formatted = iso;
  }
  return (
    <span className={className} title={iso}>
      {formatted}
    </span>
  );
}

/** Monospace code/identifier chip (permission codes, MRNs, accession numbers). */
export function Code({ children, className }: { children: string; className?: string }) {
  return <code className={`clinic-mono ${className ?? ""}`.trim()}>{children}</code>;
}
