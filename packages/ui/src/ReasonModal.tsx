import { useEffect, useId, useState } from "react";
import { Button, Form, Modal } from "react-bootstrap";

/**
 * ReasonModal — frontend.md §5.2.
 *
 * Used by every 🔒 destructive or state-transition action (ground rules 3 and
 * 7, specification G-03). It requires BOTH a reason code and free text,
 * because an audit row with an empty reason is not evidence. The confirm button
 * stays disabled until both are satisfied.
 *
 * The reason is handed back to the caller verbatim; this component stores
 * nothing and emits no telemetry (ground rule 5 — no PHI in logs).
 */
export function ReasonModal({
  show,
  title,
  description,
  consequence,
  reasonCodes,
  confirmLabel = "Confirm",
  destructive = false,
  busy = false,
  error,
  onConfirm,
  onCancel,
}: {
  show: boolean;
  title: string;
  description: string;
  /** What will happen, stated plainly (P-3). */
  consequence?: string;
  reasonCodes: ReadonlyArray<{ value: string; label: string }>;
  confirmLabel?: string;
  destructive?: boolean;
  busy?: boolean;
  error?: string;
  onConfirm: (reason: { code: string; text: string }) => void;
  onCancel: () => void;
}) {
  const codeId = useId();
  const textId = useId();
  const errorId = useId();
  const [code, setCode] = useState("");
  const [text, setText] = useState("");

  // Each open is a fresh decision; reason text carried over from a cancelled
  // attempt would silently attach the wrong justification to a new action.
  useEffect(() => {
    if (show) {
      setCode("");
      setText("");
    }
  }, [show]);

  const canConfirm = code.trim().length > 0 && text.trim().length > 0 && !busy;

  return (
    <Modal show={show} onHide={onCancel} centered aria-labelledby={`${codeId}-title`}>
      <Modal.Header closeButton>
        <Modal.Title id={`${codeId}-title`}>{title}</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <p className="mb-2">{description}</p>
        {consequence ? (
          <div className="alert alert-warning py-2 mb-3">
            {consequence}
          </div>
        ) : null}
        <Form.Group className="mb-3" controlId={codeId}>
          <Form.Label>Reason code</Form.Label>
          <Form.Select value={code} onChange={(e) => setCode(e.target.value)}>
            <option value="">Select a reason…</option>
            {reasonCodes.map((rc) => (
              <option key={rc.value} value={rc.value}>
                {rc.label}
              </option>
            ))}
          </Form.Select>
          <Form.Text>Required. Recorded against your name and the request id.</Form.Text>
        </Form.Group>
        <Form.Group controlId={textId}>
          <Form.Label>Explanation</Form.Label>
          <Form.Control
            as="textarea"
            rows={3}
            value={text}
            onChange={(e) => setText(e.target.value)}
            aria-describedby={error ? errorId : undefined}
          />
        </Form.Group>
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
          onClick={() => onConfirm({ code: code.trim(), text: text.trim() })}
          disabled={!canConfirm}
        >
          {busy ? "Working…" : confirmLabel}
        </Button>
      </Modal.Footer>
    </Modal>
  );
}