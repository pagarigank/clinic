import { useEffect, useId, useState } from "react";
import { Button, Form, Modal } from "react-bootstrap";

/**
 * StepConfirmModal — frontend.md §5.2 / P-3.
 *
 * Names the entity, lists the consequence, and optionally requires a passphrase
 * re-entry for high-risk actions (specification G-14 step-up authentication).
 *
 * This modal deliberately does NOT implement step-up itself. It surfaces the
 * confirmation, and the API answers 401 STEP_UP_REQUIRED, which the app then
 * satisfies through the server-issued step-up flow. Implementing a second,
 * client-side auth path here would be a security defect, not a convenience.
 */
export function StepConfirmModal({
  show,
  title,
  entityLabel,
  entityName,
  consequences,
  confirmLabel = "Confirm",
  requiresPassphrase = false,
  passphrase: controlledPassphrase,
  onPassphraseChange,
  destructive = false,
  busy = false,
  error,
  onConfirm,
  onCancel,
}: {
  show: boolean;
  title: string;
  entityLabel: string;
  entityName: string;
  consequences: readonly string[];
  confirmLabel?: string;
  requiresPassphrase?: boolean;
  passphrase?: string;
  onPassphraseChange?: (value: string) => void;
  destructive?: boolean;
  busy?: boolean;
  error?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const titleId = useId();
  const passId = useId();
  const errorId = useId();

  // The passphrase is owned locally by default. A caller that needs it (to
  // attach it to the step-up request) passes `passphrase` + `onPassphraseChange`
  // and gets a controlled field; a caller that omits them would otherwise get a
  // permanently frozen password box, since a controlled input with no writer
  // never changes.
  const [internalPassphrase, setInternalPassphrase] = useState("");
  const isControlled = controlledPassphrase !== undefined;
  const passphrase = isControlled ? controlledPassphrase : internalPassphrase;

  const setPassphrase = (value: string) => {
    if (!isControlled) setInternalPassphrase(value);
    onPassphraseChange?.(value);
  };

  // Never carry a passphrase across a close — it is a credential, and a stale
  // value in a reopened dialog would be both a leak and a wrong confirmation.
  useEffect(() => {
    if (!show && !isControlled) setInternalPassphrase("");
  }, [show, isControlled]);

  const canConfirm = !busy && (!requiresPassphrase || passphrase.length > 0);

  return (
    <Modal show={show} onHide={onCancel} centered aria-labelledby={titleId}>
      <Modal.Header closeButton>
        <Modal.Title id={titleId}>{title}</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <p className="mb-1 text-body-secondary">{entityLabel}</p>
        <p className="fw-semibold mb-3">{entityName}</p>
        <h3 className="h6">This will:</h3>
        <ul>
          {consequences.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
        {requiresPassphrase ? (
          <Form.Group className="mt-3" controlId={passId}>
            <Form.Label>Confirm your passphrase</Form.Label>
            <Form.Control
              type="password"
              autoComplete="current-password"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              aria-describedby={error ? errorId : undefined}
            />
          </Form.Group>
        ) : null}
        {error ? (
          <div id={errorId} className="alert alert-danger py-2 mt-3 mb-0" role="alert">
            {error}
          </div>
        ) : null}
      </Modal.Body>
      <Modal.Footer>
        <Button variant="outline-secondary" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button
          variant={destructive ? "danger" : "primary"}
          onClick={onConfirm}
          disabled={!canConfirm}
        >
          {busy ? "Working…" : confirmLabel}
        </Button>
      </Modal.Footer>
    </Modal>
  );
}