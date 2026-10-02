import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Button } from "react-bootstrap";

/**
 * SignaturePad — frontend.md §5.2.
 *
 * "Pointer-event signature for pharmacy witness and lab verifier attestation."
 * A controlled canvas: the caller owns the signature as a PNG data URL, this
 * component only captures and displays strokes.
 *
 * Deliberate choices:
 *   - Pointer Events (not mouse/touch pairs) so one handler covers pen, touch,
 *     and mouse — the pharmacy witness signs on whatever device is at the
 *     bench (frontend §5.2).
 *   - The value is a data URL held by the caller, never component-local state,
 *     so a posted dispense carries the witness signature in the same payload
 *     and a remount (tab switch) restores it instead of losing it.
 *   - A signed state is announced via role="img" + aria-label so a screen
 *     reader confirms capture without exposing the image.
 *   - `disabled` freezes the canvas but keeps the image visible: an attested
 *     record must not lose its signature just because it is no longer editable
 *     (ground rule 7 — append-only history stays readable).
 */
export function SignaturePad({
  label,
  value,
  onChange,
  disabled = false,
  height = 140,
  hint = "Draw the signature inside the box.",
  className,
}: {
  label: string;
  value: string | null;
  onChange: (dataUrl: string | null) => void;
  disabled?: boolean;
  height?: number;
  hint?: string;
  className?: string;
}) {
  const canvasId = useId();
  const hintId = `${canvasId}-hint`;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);
  const hasInkRef = useRef(false);
  const lastEmittedRef = useRef<string | null>(null);
  const [hasSignature, setHasSignature] = useState(value !== null);

  const ctx = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const context = canvas.getContext("2d");
    if (!context) return null;
    // Render at device resolution so a printed register page is not jagged.
    const ratio = window.devicePixelRatio || 1;
    const targetW = canvas.clientWidth;
    const targetH = canvas.clientHeight;
    if (canvas.width !== Math.round(targetW * ratio) || canvas.height !== Math.round(targetH * ratio)) {
      canvas.width = Math.round(targetW * ratio);
      canvas.height = Math.round(targetH * ratio);
    }
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.lineWidth = 2;
    context.lineCap = "round";
    context.lineJoin = "round";
    // Ink must survive print (tokens.css forces black-on-white in print).
    context.strokeStyle = "#111827";
    return context;
  }, []);

  // Keep the canvas in sync with the controlled value: restore an external
  // value once, and clear when the caller resets to null (after a successful
  // post, the confirm flow nulls the signature).
  useEffect(() => {
    if (value === lastEmittedRef.current) return;
    lastEmittedRef.current = value;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    context.clearRect(0, 0, w, h);
    hasInkRef.current = false;
    setHasSignature(value !== null);
    if (value !== null) {
      const img = new Image();
      img.onload = () => context.drawImage(img, 0, 0, w, h);
      img.src = value;
      hasInkRef.current = true;
    }
  }, [value]);

  const pointFrom = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const emitIfComplete = () => {
    if (!hasInkRef.current || !canvasRef.current) return;
    const dataUrl = canvasRef.current.toDataURL("image/png");
    lastEmittedRef.current = dataUrl;
    setHasSignature(true);
    onChange(dataUrl);
  };

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (disabled) return;
    // jsdom (and older browsers) may not implement pointer capture — drawing
    // still works without it, capture only keeps strokes outside the box alive.
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const context = ctx();
    if (!context) return;
    drawingRef.current = true;
    const { x, y } = pointFrom(event);
    context.beginPath();
    context.moveTo(x, y);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current || disabled) return;
    const context = ctx();
    if (!context) return;
    const { x, y } = pointFrom(event);
    context.lineTo(x, y);
    context.stroke();
    hasInkRef.current = true;
  };

  const endStroke = () => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    emitIfComplete();
  };

  const clear = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
    hasInkRef.current = false;
    lastEmittedRef.current = null;
    setHasSignature(false);
    onChange(null);
  };

  return (
    <div className={className}>
      <label htmlFor={canvasId} className="form-label">
        {label}
      </label>
      <canvas
        id={canvasId}
        ref={canvasRef}
        role={hasSignature ? "img" : undefined}
        aria-label={hasSignature ? `${label} — signature captured` : undefined}
        aria-describedby={hintId}
        style={{
          width: "100%",
          height,
          border: "1px solid var(--border-subtle, #dee2e6)",
          borderRadius: "var(--radius-sm, 6px)",
          background: "var(--surface-raised, #fff)",
          touchAction: "none",
          cursor: disabled ? "default" : "crosshair",
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endStroke}
        onPointerCancel={endStroke}
        onPointerLeave={endStroke}
      />
      <div className="d-flex align-items-center justify-content-between mt-1">
        <span id={hintId} className="form-text">
          {hasSignature ? "Signature captured." : hint}
        </span>
        <Button variant="link" size="sm" onClick={clear} disabled={disabled || !hasSignature}>
          Clear signature
        </Button>
      </div>
    </div>
  );
}
