import { useId, useState } from "react";
import { Badge, Form } from "react-bootstrap";

/**
 * StatusPill — frontend.md §5.2.
 *
 * Contract: a status is ALWAYS colour + text label (P-5). The tone selects a
 * `--status-*` token pair from tokens.css; the label carries meaning for
 * anyone who cannot distinguish the colour.
 *
 * `label` is required by the type system on purpose — there is deliberately no
 * signature that renders a bare coloured dot.
 */
export type StatusTone = "critical" | "high" | "normal" | "low" | "neutral" | "pending";

export function StatusPill({
  tone,
  label,
  icon,
}: {
  tone: StatusTone;
  label: string;
  icon?: React.ReactNode;
}) {
  return (
    <span className={`clinic-status clinic-status-${tone}`} data-tone={tone}>
      {icon ? <span aria-hidden="true">{icon}</span> : null}
      {label}
    </span>
  );
}

/**
 * AlertBanner — frontend.md §5.2.
 *
 * `danger` gets role="alert" so assistive tech announces it immediately; other
 * tones are polite status messages. Every banner pairs an icon with text, so
 * colour is never the only signal (P-5).
 *
 * The prop is `severity` to match the existing call sites across the admin,
 * auth, patients and ping screens. `tone` is accepted as an alias so new code
 * can follow the design-system vocabulary without a flag day later.
 */
export function AlertBanner({
  severity,
  tone,
  title,
  children,
  action,
}: {
  severity?: "info" | "success" | "warning" | "danger";
  tone?: "info" | "success" | "warning" | "danger";
  title?: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
}) {
  const level = severity ?? tone ?? "info";
  const glyph =
    level === "danger" ? "✕" : level === "warning" ? "⚠" : level === "success" ? "✓" : "ℹ";
  return (
    <div
      className={`alert alert-${level} d-flex align-items-start gap-2`}
      role={level === "danger" ? "alert" : "status"}
    >
      <span aria-hidden="true">{glyph}</span>
      <div className="flex-grow-1">
        {title ? <strong className="d-block">{title}</strong> : null}
        {children ? <div className={title ? "mt-1" : undefined}>{children}</div> : null}
      </div>
      {action}
    </div>
  );
}

/** Empty state per frontend §19: icon, headline, one-sentence explanation, action. */
export function EmptyState({
  headline,
  explanation,
  action,
}: {
  headline: string;
  explanation: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="text-center py-5" role="status">
      <div style={{ fontSize: "2rem" }} aria-hidden="true">
        ▢
      </div>
      <h2 className="h5 mt-2">{headline}</h2>
      <p className="text-body-secondary mb-3">{explanation}</p>
      {action}
    </div>
  );
}

/** Shape-stable loading (frontend §19): no layout shift while data arrives. */
export function SkeletonTable({ rows = 3 }: { rows?: number }) {
  return (
    <div className="p-3" role="status" aria-busy="true" aria-live="polite">
      <span className="visually-hidden">Loading</span>
      {Array.from({ length: rows }, (_, i) => (
        <div className="placeholder-glow mb-2" key={i}>
          <span className="placeholder col-7" />
          <span className="placeholder col-3" />
        </div>
      ))}
    </div>
  );
}

/**
 * PatientBanner — frontend.md §5.2 / P-7 "reveal PHI progressively".
 *
 * The collapsed banner shows ONLY name, DOB, sex, and an allergy COUNT. Allergies,
 * diagnoses, and results stay behind an explicit toggle, and each reveal is a
 * deliberate user action so the API can record it (specification G-07 — PHI reads
 * are audited). The component never fetches anything itself: the caller passes
 * data it already has permission to see and fires `onReveal` for auditability.
 *
 * `onReveal` is required whenever revealable data is supplied — a screen that
 * silently reveals PHI without telling the server is a ground-rule 7 violation.
 */
export function PatientBanner({
  patient,
  allergies,
  allergiesCount,
  diagnoses,
  onReveal,
  revealLabel = "Show details",
  className,
}: {
  patient: {
    id: string;
    name: string;
    dateOfBirth?: string | null;
    sex?: string | null;
    mrn?: string | null;
  };
  allergies?: ReadonlyArray<{ substance: string; reaction?: string | null; severity?: string | null }>;
  /** Shown while collapsed — never the allergy contents themselves. */
  allergiesCount?: number;
  diagnoses?: ReadonlyArray<{ code: string; label?: string | null }>;
  onReveal?: (section: "allergies" | "diagnoses") => void;
  revealLabel?: string;
  className?: string;
}) {
  const allergiesId = useId();
  const diagnosesId = useId();
  const [showAllergies, setShowAllergies] = useState(false);
  const [showDiagnoses, setShowDiagnoses] = useState(false);

  const reveal = (section: "allergies" | "diagnoses", next: boolean, setter: (v: boolean) => void) => {
    if (next) onReveal?.(section);
    setter(next);
  };

  return (
    <div className={`card clinic-patient-banner ${className ?? ""}`.trim()} data-testid="patient-banner">
      <div className="card-body">
        <div className="d-flex flex-wrap align-items-center justify-content-between gap-2">
          <div>
            <h2 className="h5 mb-1">{patient.name}</h2>
            <div className="text-body-secondary">
              {patient.dateOfBirth ? <span className="me-3">DOB {patient.dateOfBirth}</span> : null}
              {patient.sex ? <span className="me-3">{patient.sex}</span> : null}
              {patient.mrn ? <span className="clinic-mono">MRN {patient.mrn}</span> : null}
            </div>
          </div>
          <div className="d-flex align-items-center gap-2">
            {/* Allergy COUNT is safe to show collapsed; the substances are not. */}
            <Badge bg={allergiesCount && allergiesCount > 0 ? "warning" : "secondary"} text={allergiesCount && allergiesCount > 0 ? "dark" : undefined}>
              Allergies: {allergiesCount ?? 0}
            </Badge>
          </div>
        </div>

        {allergiesCount !== undefined ? (
          <div className="mt-3">
            <button
              type="button"
              className="btn btn-link btn-sm px-0"
              aria-expanded={showAllergies}
              aria-controls={allergiesId}
              onClick={() => reveal("allergies", !showAllergies, setShowAllergies)}
            >
              {revealLabel}
            </button>
            {showAllergies ? (
              <div id={allergiesId} className="mt-2">
                {allergies && allergies.length > 0 ? (
                  <ul className="mb-0">
                    {allergies.map((a, i) => (
                      <li key={`${a.substance}-${i}`}>
                        <strong>{a.substance}</strong>
                        {a.reaction ? ` — ${a.reaction}` : ""}
                        {a.severity ? ` (${a.severity})` : ""}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mb-0 text-body-secondary">No known allergies recorded.</p>
                )}
              </div>
            ) : null}
          </div>
        ) : null}

        {diagnoses ? (
          <div className="mt-2">
            <button
              type="button"
              className="btn btn-link btn-sm px-0"
              aria-expanded={showDiagnoses}
              aria-controls={diagnosesId}
              onClick={() => reveal("diagnoses", !showDiagnoses, setShowDiagnoses)}
            >
              Diagnoses
            </button>
            {showDiagnoses ? (
              <div id={diagnosesId} className="mt-2">
                {diagnoses.length > 0 ? (
                  <ul className="mb-0">
                    {diagnoses.map((d, i) => (
                      <li key={`${d.code}-${i}`} className="clinic-mono">
                        {d.code}
                        {d.label ? ` — ${d.label}` : ""}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mb-0 text-body-secondary">No diagnoses recorded.</p>
                )}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * FooterBar — frontend.md §5.3.
 *
 * Sticky primary action on mobile: the commit-bar pattern used by dispensing,
 * GRN posting, and shift close. Rendered above the safe-area inset so it does
 * not sit under a phone's home indicator.
 */
export function FooterBar({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`clinic-sticky-footer d-flex gap-2 justify-content-end p-3 ${className ?? ""}`.trim()}
      style={{
        position: "sticky",
        bottom: 0,
        zIndex: "var(--z-sticky-footer)",
        backgroundColor: "var(--surface-raised)",
        borderTop: "1px solid var(--border-subtle)",
        paddingBottom: "calc(var(--space-3) + env(safe-area-inset-bottom, 0px))",
      }}
    >
      {children}
    </div>
  );
}

/**
 * Timeline — frontend.md §5.2.
 *
 * Audit trail, result amendments, and stock-movement history. Used on
 * append-only records (ground rule 7), so this component is deliberately
 * read-only: there is no edit affordance anywhere in its surface.
 */
export function Timeline({
  entries,
  className,
}: {
  entries: ReadonlyArray<{
    at: string;
    title: string;
    actor?: string | null;
    detail?: React.ReactNode;
    tone?: "neutral" | "normal" | "high" | "critical";
  }>;
  className?: string;
}) {
  if (entries.length === 0) {
    return <p className="text-body-secondary mb-0">No history recorded.</p>;
  }
  return (
    <ol className={`list-unstyled mb-0 ${className ?? ""}`.trim()}>
      {entries.map((entry, i) => (
        <li key={`${entry.at}-${i}`} className="d-flex gap-3 pb-3">
          <div className="text-body-secondary clinic-mono flex-shrink-0" style={{ minWidth: "9rem" }}>
            {entry.at}
          </div>
          <div className="flex-grow-1">
            <div className="d-flex align-items-center gap-2">
              <strong>{entry.title}</strong>
              {/* An optional status marker is supplementary text, so it must
                  not repeat the title verbatim — that would announce the same
                  words twice to a screen reader. */}
              {entry.tone ? <StatusPill tone={entry.tone} label={entry.tone} /> : null}
            </div>
            {entry.actor ? <div className="text-body-secondary">by {entry.actor}</div> : null}
            {entry.detail ? <div className="mt-1">{entry.detail}</div> : null}
          </div>
        </li>
      ))}
    </ol>
  );
}

/**
 * QRSummary — frontend.md §5.2.
 *
 * Scannable identity block for wristbands, specimen labels, Rx labels and
 * payment references. Deliberately minimal and high-contrast: it is read at
 * arm's length, often in bad light, sometimes printed (tokens.css forces
 * black-on-white in print).
 */
export function QRSummary({
  primary,
  secondary,
  tertiary,
  mono = false,
  className,
}: {
  primary: string;
  secondary?: string | null;
  tertiary?: string | null;
  mono?: boolean;
  className?: string;
}) {
  return (
    <div className={`clinic-qr-summary ${mono ? "clinic-mono" : ""} ${className ?? ""}`.trim()}>
      <div className="fw-semibold" style={{ fontSize: "var(--font-size-lg)" }}>
        {primary}
      </div>
      {secondary ? <div className="text-body-secondary">{secondary}</div> : null}
      {tertiary ? <div className="text-body-secondary">{tertiary}</div> : null}
    </div>
  );
}

/**
 * MoneyField — frontend.md §5.2.
 *
 * Numeric input with the currency symbol in the LABEL, never inside the field,
 * so a keypad user never has to strip a symbol out of a value. Rounding to
 * currency minor units happens on blur — and it only formats what the server
 * already sent; the authoritative total is always the server's (P-6).
 */
export function MoneyField({
  label,
  currency = "PHP",
  value,
  onChange,
  id,
  disabled,
  required,
  error,
}: {
  label: string;
  currency?: string;
  value: string;
  onChange: (value: string) => void;
  id?: string;
  disabled?: boolean;
  required?: boolean;
  error?: string;
}) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const errorId = `${fieldId}-error`;

  const handleBlur = () => {
    if (value.trim() === "") return;
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return;
    // Round half-away-from-zero on the decimal string rather than toFixed():
    // toFixed relies on the binary float value, so an input like "100.005" is
    // stored as 100.00499... and would round DOWN to 100.00 while the user sees
    // 100.005. This is display rounding of a value the server already
    // authoritative — it never recomputes a total (P-6).
    const [whole, fraction = ""] = value.trim().split(".");
    const padded = (fraction + "000").slice(0, 3);
    const thousandths = Number(padded);
    const bump = thousandths >= 5 ? 1 : 0;
    const cents = Number(fraction.slice(0, 2).padEnd(2, "0") || "0") + bump;
    if (cents >= 100) {
      onChange(`${Number(whole) + Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`);
    } else {
      onChange(`${whole}.${String(cents).padStart(2, "0")}`);
    }
  };

  return (
    <Form.Group controlId={fieldId}>
      <Form.Label>
        {label} <span className="text-body-secondary">({currency})</span>
      </Form.Label>
      <Form.Control
        type="number"
        inputMode="decimal"
        step="0.01"
        min="0"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={handleBlur}
        disabled={disabled}
        required={required}
        isInvalid={!!error}
        aria-describedby={error ? errorId : undefined}
        className="tabular"
      />
      {error ? (
        <Form.Control.Feedback type="invalid" id={errorId}>
          {error}
        </Form.Control.Feedback>
      ) : null}
    </Form.Group>
  );
}

/**
 * DateField — frontend.md §5.2.
 *
 * Native `<input type="date">` deliberately: a custom calendar re-implements
 * keyboard navigation badly and traps screen-reader users. Storage is ISO
 * 8601 (G-08); this only presents it in the tenant's locale.
 */
export function DateField({
  label,
  value,
  onChange,
  id,
  disabled,
  required,
  max,
  error,
  hint,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  id?: string;
  disabled?: boolean;
  required?: boolean;
  max?: string;
  error?: string;
  hint?: string;
}) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const errorId = `${fieldId}-error`;
  const hintId = `${fieldId}-hint`;

  return (
    <Form.Group controlId={fieldId}>
      <Form.Label>{label}</Form.Label>
      <Form.Control
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        required={required}
        max={max}
        isInvalid={!!error}
        aria-describedby={[hint ? hintId : null, error ? errorId : null].filter(Boolean).join(" ") || undefined}
      />
      {hint ? (
        <Form.Text id={hintId}>
          {hint}
        </Form.Text>
      ) : null}
      {error ? (
        <Form.Control.Feedback type="invalid" id={errorId}>
          {error}
        </Form.Control.Feedback>
      ) : null}
    </Form.Group>
  );
}