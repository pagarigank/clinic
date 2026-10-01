import Button from "react-bootstrap/Button";
import Alert from "react-bootstrap/Alert";
import Badge from "react-bootstrap/Badge";
import Placeholder from "react-bootstrap/Placeholder";
import Container from "react-bootstrap/Container";
import Nav from "react-bootstrap/Nav";

export { Button, Alert, Badge, Placeholder, Container, Nav };

/** Status pill per frontend §5.1: status + text label, never colour alone. */
export function StatusPill({
  tone,
  label,
}: {
  tone: "critical" | "high" | "normal" | "low" | "neutral" | "pending";
  label: string;
}) {
  return (
    <Badge bg={tone === "critical" ? "danger" : tone === "high" ? "warning" : tone === "normal" ? "success" : "secondary"} text={tone === "high" ? "dark" : undefined}>
      {label}
    </Badge>
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
    <div className="p-3" aria-busy="true" aria-live="polite">
      {Array.from({ length: rows }, (_, i) => (
        <Placeholder as="p" animation="glow" key={i}>
          <Placeholder xs={7} /> <Placeholder xs={3} />
        </Placeholder>
      ))}
    </div>
  );
}

/** Alert banner with role=alert for critical severity (frontend §5.2). */
export function AlertBanner({
  severity,
  children,
}: {
  severity: "info" | "success" | "warning" | "danger";
  children: React.ReactNode;
}) {
  return (
    <Alert variant={severity} role={severity === "danger" ? "alert" : "status"}>
      {children}
    </Alert>
  );
}
