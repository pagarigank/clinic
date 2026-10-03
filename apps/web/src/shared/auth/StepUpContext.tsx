import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { Form, Modal } from "@clinic/ui";
import { ApiError } from "../api/client.js";
import { apiPost } from "../api/client.js";

/**
 * Step-up authentication client (todo.md §1.2/§1.3, frontend.md §11 P-3).
 *
 * The API answers `401 STEP_UP_REQUIRED` (contracts `index.ts:43`) for
 * high-risk actions and mints a 5-minute step-up JWT from `POST /auth/step-up`.
 * This module is the web half of that contract:
 *
 *   - `isStepUpRequired(error)` classifies an `ApiError` by its problem code.
 *   - `requestStepUp(action)` opens the passphrase modal and resolves `true`
 *     once the server accepts the re-authentication, `false` on cancel/failure.
 *   - On success the short-lived step-up token replaces the access token in
 *     memory, so the retried request carries it the same way every other
 *     authorised call does. It is never written to storage (frontend §20).
 *
 * The modal is hosted ONCE by `StepUpProvider` — call sites never mount their
 * own copy, which is what keeps the prompt consistent and avoids three modals
 * racing for the same action.
 */

export interface StepUpSuccess {
  stepUpToken?: string;
  expiresIn?: number;
  accessToken?: string;
}

/** True when the problem is the step-up challenge (401 STEP_UP_REQUIRED). */
export function isStepUpRequired(error: unknown): boolean {
  return error instanceof ApiError && error.problem.code === "STEP_UP_REQUIRED";
}

interface PendingRequest {
  action: string;
  resolve: (granted: boolean) => void;
}

interface StepUpContextValue {
  /** Opens the modal; resolves true only after the server accepts. */
  requestStepUp: (action: string) => Promise<boolean>;
  /** True while a server-issued step-up grant is in force. */
  stepUpActive: boolean;
}

const StepUpContext = createContext<StepUpContextValue | null>(null);

export function StepUpProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingRequest | null>(null);
  const [passphrase, setPassphrase] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [stepUpActive, setStepUpActive] = useState(false);
  const expiryRef = useRef<number>(0);

  const requestStepUp = useCallback((action: string) => {
    return new Promise<boolean>((resolve) => {
      setPassphrase("");
      setError(null);
      setBusy(false);
      setPending({ action, resolve });
    });
  }, []);

  const cancel = useCallback(() => {
    pending?.resolve(false);
    setPending(null);
    setPassphrase("");
    setError(null);
  }, [pending]);

  const submit = useCallback(async () => {
    if (!pending || passphrase.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      // The API also accepts a TOTP code for MFA-enrolled users; the passphrase
      // path is the default the contract documents (apps/api auth.controller).
      const res = await apiPost<StepUpSuccess>("/auth/step-up", { password: passphrase });
      const token = res?.stepUpToken || res?.accessToken;
      if (token) {
        const { setStepUpToken, setAccessToken } = await import("../api/client.js");
        if (res.stepUpToken) setStepUpToken(res.stepUpToken);
        if (res.accessToken) setAccessToken(res.accessToken);
        // 5-minute ceiling mirrors the server; the UI simply re-challenges
        // after it lapses instead of tracking a countdown nobody reads.
        const ttlMs = res.expiresIn ? res.expiresIn * 1000 : 5 * 60 * 1000;
        expiryRef.current = Date.now() + ttlMs;
        setStepUpActive(true);
      }
      pending.resolve(true);
      setPending(null);
      setPassphrase("");
    } catch (err) {
      const detail =
        err instanceof ApiError ? err.problem.detail ?? err.problem.title : "Verification failed.";
      setError(detail);
    } finally {
      setBusy(false);
    }
  }, [pending, passphrase]);

  const value = useMemo<StepUpContextValue>(
    () => ({ requestStepUp, stepUpActive }),
    [requestStepUp, stepUpActive],
  );

  return (
    <StepUpContext.Provider value={value}>
      {children}
      <Modal show={pending !== null} onHide={cancel} centered aria-labelledby="stepup-title">
        <Modal.Header closeButton>
          <Modal.Title id="stepup-title">Confirm it's you</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <p className="mb-1 text-body-secondary">
            <strong>{pending?.action}</strong> is a high-risk action and requires re-entering your
            passphrase.
          </p>
          <Form.Group controlId="stepup-passphrase" className="mt-3">
            <Form.Label>Passphrase</Form.Label>
            <Form.Control
              type="password"
              autoComplete="current-password"
              value={passphrase}
              autoFocus
              onChange={(e) => setPassphrase(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void submit();
              }}
              isInvalid={!!error}
              aria-describedby={error ? "stepup-error" : undefined}
            />
            {error ? (
              <Form.Control.Feedback type="invalid" id="stepup-error" role="alert">
                {error}
              </Form.Control.Feedback>
            ) : null}
          </Form.Group>
        </Modal.Body>
        <Modal.Footer>
          <button type="button" className="btn btn-outline-secondary" onClick={cancel} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-cerulean"
            onClick={() => void submit()}
            disabled={busy || passphrase.length === 0}
          >
            {busy ? "Verifying…" : "Confirm"}
          </button>
        </Modal.Footer>
      </Modal>
    </StepUpContext.Provider>
  );
}

export function useStepUp(): StepUpContextValue {
  const ctx = useContext(StepUpContext);
  if (!ctx) throw new Error("useStepUp must be used within a StepUpProvider");
  return ctx;
}

/**
 * Fail-soft variant for pages that must also mount without a StepUpProvider
 * (isolated component tests, future islands). Returns null instead of
 * throwing; call sites degrade to surfacing the raw 401 problem instead of
 * prompting for re-authentication.
 */
export function useStepUpOptional(): StepUpContextValue | null {
  return useContext(StepUpContext);
}
