import React, { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { AlertBanner } from "@clinic/ui";
import { usePlatformAuth } from "../../shared/auth/PlatformAuthContext.js";

/**
 * Platform console sign-in (frontend.md §14, Phase 9). Distinct from the tenant
 * LoginPage: operators present email + password (+ TOTP once enrolled) and
 * receive a `platform` token. No tenant slug — platform users are global.
 */
export function PlatformLoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { login, error: authError } = usePlatformAuth();

  // Defaults match packages/db/migrations/seeds/demo.sql (superadmin@clinic.local)
  // which has no seeded TOTP secret, so password-only login works in dev.
  const [email, setEmail] = useState("superadmin@clinic.local");
  const [password, setPassword] = useState("DemoPassw0rd!2026");
  const [totp, setTotp] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    if (!email.trim() || !password) {
      setLocalError("Enter both email and password.");
      return;
    }
    setBusy(true);
    try {
      await login(email.trim(), password, totp.trim() || undefined);
      const from = (location.state as { from?: string } | null)?.from;
      navigate(from && from.startsWith("/platform") ? from : "/platform/tenants", { replace: true });
    } catch (err: unknown) {
      const problem = (err as { problem?: { detail?: string; title?: string } })?.problem;
      setLocalError(problem?.detail || (err as Error)?.message || "Invalid credentials.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-page-wrapper">
      <div className="auth-card">
        <div className="auth-header-banner">
          <div
            style={{
              width: "48px",
              height: "48px",
              backgroundColor: "rgba(255, 255, 255, 0.2)",
              borderRadius: "12px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              margin: "0 auto 1rem",
              fontSize: "1.5rem",
              fontWeight: 700,
            }}
          >
            ⚙
          </div>
          <h1 style={{ fontSize: "1.5rem", fontWeight: 700, margin: "0 0 0.25rem" }}>Platform Console</h1>
          <p style={{ margin: 0, opacity: 0.85, fontSize: "0.9rem" }}>Operator sign-in — platform scope only</p>
        </div>

        <div className="auth-form-body">
          {(localError || authError) && (
            <div className="mb-3">
              <AlertBanner severity="danger">{localError || authError}</AlertBanner>
            </div>
          )}

          <form onSubmit={handleSubmit}>
            <div className="mb-3">
              <label htmlFor="platform-email" className="form-label fw-semibold text-secondary small">
                PLATFORM EMAIL
              </label>
              <input
                id="platform-email"
                type="email"
                className="form-control"
                placeholder="name@clinic.local"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
              />
            </div>

            <div className="mb-3">
              <div className="d-flex justify-content-between align-items-center mb-1">
                <label htmlFor="platform-password" className="form-label fw-semibold text-secondary small mb-0">
                  PASSWORD
                </label>
                <button
                  type="button"
                  className="btn btn-link p-0 text-decoration-none small text-muted"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? "Hide" : "Show"}
                </button>
              </div>
              <input
                id="platform-password"
                type={showPassword ? "text" : "password"}
                className="form-control"
                placeholder="••••••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
            </div>

            <div className="mb-4">
              <label htmlFor="platform-totp" className="form-label fw-semibold text-secondary small">
                AUTHENTICATOR CODE (IF ENROLLED)
              </label>
              <input
                id="platform-totp"
                type="text"
                inputMode="numeric"
                className="form-control"
                placeholder="123456"
                value={totp}
                onChange={(e) => setTotp(e.target.value)}
                autoComplete="one-time-code"
              />
            </div>

            <button
              type="submit"
              className="btn btn-cerulean w-100 py-2 d-flex align-items-center justify-content-center gap-2"
              disabled={busy}
            >
              {busy ? (
                <>
                  <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true" />
                  <span>Verifying…</span>
                </>
              ) : (
                <span>Sign in to Platform Console</span>
              )}
            </button>
          </form>

          <div className="mt-4 pt-3 border-top text-center">
            <Link to="/login" className="small text-decoration-none text-muted">
              Back to clinic sign-in
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
