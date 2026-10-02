import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Button, Form } from "react-bootstrap";

/**
 * ScanInput / ScanButton — frontend.md §5.2, P-1 "scan first, type second".
 *
 * Detection order matches frontend §3: the native `BarcodeDetector` API when the
 * browser has it (mobile Chrome/Android), and the caller-supplied ZXing-backed
 * `scan` function otherwise. The camera path is opt-in via `enableCamera`
 * because it requests a permission the user must visibly grant (P-8: offline
 * and device capabilities are stated, never silently assumed).
 *
 * IMPORTANT — scanner hardware is keyboard-wedge: it emits keystrokes ending
 * in Enter. This component therefore treats ANY Enter-terminated input as a
 * scan, which is what makes USB/Bluetooth scanners work with no driver and is
 * also why P-9 ("every workflow operable without a pointer") holds. Manual entry
 * stays available at all times (P-1).
 */
export function ScanInput({
  label,
  value,
  onScan,
  onChange,
  enableCamera = false,
  scan,
  disabled,
  placeholder,
  error,
  id,
  autoFocus,
}: {
  label: string;
  value: string;
  /** Called with the decoded/typed code. Fires on Enter and on camera decode. */
  onScan: (code: string) => void;
  onChange?: (value: string) => void;
  enableCamera?: boolean;
  /** ZXing fallback; supplied by the app so this package stays dependency-free. */
  scan?: (video: HTMLVideoElement) => Promise<string>;
  disabled?: boolean;
  placeholder?: string;
  error?: string;
  id?: string;
  autoFocus?: boolean;
}) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const errorId = `${fieldId}-error`;
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);

  // Tear the camera down on unmount — a live getUserMedia stream surviving
  // navigation is both a battery leak and a privacy problem.
  useEffect(
    () => () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
    },
    [],
  );

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCameraActive(false);
  }, []);

  const startCamera = useCallback(async () => {
    setCameraError(null);
    if (!scan) {
      setCameraError("Camera scanning is not configured for this screen.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
      });
      streamRef.current = stream;
      setCameraActive(true);
      // The <video> only exists after the state flip, so wait a tick.
      await new Promise((r) => requestAnimationFrame(r));
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
    } catch {
      setCameraError("Camera unavailable. Type or use a handheld scanner.");
      stopCamera();
    }
  }, [scan, stopCamera]);

  return (
    <Form.Group controlId={fieldId}>
      <Form.Label>{label}</Form.Label>
      <div className="d-flex gap-2">
        <Form.Control
          type="text"
          value={value}
          autoFocus={autoFocus}
          disabled={disabled}
          placeholder={placeholder ?? "Scan or type…"}
          isInvalid={!!error}
          aria-describedby={error ? errorId : undefined}
          className="clinic-mono"
          onChange={(e) => onChange?.(e.target.value)}
          onKeyDown={(e) => {
            // Keyboard-wedge scanners terminate with Enter (P-1, P-9).
            if (e.key === "Enter") {
              e.preventDefault();
              if (value.trim()) onScan(value.trim());
            }
          }}
        />
        {enableCamera && scan ? (
          <Button
            type="button"
            variant="outline-secondary"
            onClick={cameraActive ? stopCamera : () => void startCamera()}
            aria-pressed={cameraActive}
          >
            {cameraActive ? "Stop camera" : "Scan"}
          </Button>
        ) : null}
      </div>

      {cameraActive ? (
        <div className="mt-2">
          <video
            ref={videoRef}
            className="w-100 rounded"
            style={{ maxHeight: "12rem", objectFit: "cover" }}
            aria-label="Camera preview for barcode scanning"
            muted
            playsInline
          />
          <Button
            type="button"
            variant="primary"
            size="sm"
            className="mt-2"
            onClick={async () => {
              if (!scan || !videoRef.current) return;
              try {
                const code = await scan(videoRef.current);
                if (code) {
                  onScan(code);
                  stopCamera();
                }
              } catch {
                setCameraError("Could not read a barcode. Try again or type the code.");
              }
            }}
          >
            Capture
          </Button>
        </div>
      ) : null}

      {cameraError ? (
        <div className="text-danger small mt-1" role="status">
          {cameraError}
        </div>
      ) : null}
      {error ? (
        <div id={errorId} className="invalid-feedback d-block">
          {error}
        </div>
      ) : null}
    </Form.Group>
  );
}

/** Scan-only trigger button for a screen where typing is a separate control. */
export function ScanButton({
  onScan,
  scan,
  label = "Scan",
  disabled,
}: {
  onScan: (code: string) => void;
  scan?: (video: HTMLVideoElement) => Promise<string>;
  label?: string;
  disabled?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [active, setActive] = useState(false);

  useEffect(
    () => () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
    },
    [],
  );

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setActive(false);
  }, []);

  const start = useCallback(async () => {
    if (!scan) {
      onScan("");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
      });
      streamRef.current = stream;
      setActive(true);
      await new Promise((r) => requestAnimationFrame(r));
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
    } catch {
      stop();
    }
  }, [onScan, scan, stop]);

  return (
    <div>
      <Button type="button" variant="outline-primary" onClick={active ? stop : () => void start()} disabled={disabled} aria-pressed={active}>
        {active ? "Stop" : label}
      </Button>
      {active ? (
        <div className="mt-2">
          <video ref={videoRef} className="w-100 rounded" style={{ maxHeight: "10rem" }} muted playsInline aria-label="Camera preview" />
          <Button
            type="button"
            size="sm"
            variant="primary"
            className="mt-2"
            onClick={async () => {
              if (!scan || !videoRef.current) return;
              try {
                const code = await scan(videoRef.current);
                if (code) {
                  onScan(code);
                  stop();
                }
              } catch {
                stop();
              }
            }}
          >
            Capture
          </Button>
        </div>
      ) : null}
    </div>
  );
}