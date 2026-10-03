import React, { useState } from "react";
import { useNavigate, Link } from "react-router";
import { useAuth } from "../../shared/auth/AuthContext.js";
import { AlertBanner } from "@clinic/ui";

export function LoginPage() {
  const navigate = useNavigate();
  const { login, error: authError } = useAuth();

  // Defaults MUST match packages/db/migrations/seeds/demo.sql. The seed creates
  // tenants `demo-a` / `demo-b` with users `admin@demo-a.test` /
  // `doctor@demo-a.test` — there is no `demo` slug and no `admin@example.com`.
  // A mismatch here is invisible in dev until someone presses Submit, and then
  // it looks like the login endpoint is broken when it is not.
  const [slug, setSlug] = useState("demo-a");
  const [email, setEmail] = useState("admin@demo-a.test");
  const [password, setPassword] = useState("DemoPassw0rd!2026");
  const [rememberDevice, setRememberDevice] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);

    if (!slug.trim()) {
      setLocalError("Please enter your clinic identifier (slug).");
      return;
    }
    if (!email.trim() || !password.trim()) {
      setLocalError("Please enter both email and password.");
      return;
    }

    setIsLoading(true);
    try {
      await login(slug.trim(), email.trim(), password);
      navigate("/dashboard");
    } catch (err: any) {
      setLocalError(err?.problem?.detail || err?.message || "Invalid credentials or clinic slug.");
    } finally {
      setIsLoading(false);
    }
  };

  const fillCredentials = (s: string, em: string, pw: string) => {
    setSlug(s);
    setEmail(em);
    setPassword(pw);
    setLocalError(null);
  };

  return (
    <div className="auth-page-wrapper">
      <div className="auth-card">
        {/* Cerulean Blue Header Banner */}
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
            ⚕
          </div>
          <h1 style={{ fontSize: "1.5rem", fontWeight: 700, margin: "0 0 0.25rem" }}>
            Clinic Platform
          </h1>
          <p style={{ margin: 0, opacity: 0.85, fontSize: "0.9rem" }}>
            Clinical & Practice Management System
          </p>
        </div>

        {/* Form Body */}
        <div className="auth-form-body">
          {(localError || authError) && (
            <div className="mb-3">
              <AlertBanner severity="danger">
                {localError || authError}
              </AlertBanner>
            </div>
          )}

          <form onSubmit={handleSubmit}>
            <div className="mb-3">
              <label htmlFor="clinic-slug" className="form-label fw-semibold text-secondary small">
                CLINIC IDENTIFIER (TENANT SLUG)
              </label>
              <div className="input-group">
                <input
                  id="clinic-slug"
                  type="text"
                  className="form-control"
                  placeholder="e.g. demo or metrocare"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                  autoComplete="organization"
                  required
                />
                <span className="input-group-text bg-light text-muted small">.clinic.ph</span>
              </div>
            </div>

            <div className="mb-3">
              <label htmlFor="login-email" className="form-label fw-semibold text-secondary small">
                WORK EMAIL ADDRESS
              </label>
              <input
                id="login-email"
                type="email"
                className="form-control"
                placeholder="name@clinic.ph"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
              />
            </div>

            <div className="mb-3">
              <div className="d-flex justify-content-between align-items-center mb-1">
                <label htmlFor="login-password" className="form-label fw-semibold text-secondary small mb-0">
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
                id="login-password"
                type={showPassword ? "text" : "password"}
                className="form-control"
                placeholder="••••••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
            </div>

            <div className="d-flex justify-content-between align-items-center mb-4">
              <div className="form-check">
                <input
                  type="checkbox"
                  className="form-check-input"
                  id="rememberDevice"
                  checked={rememberDevice}
                  onChange={(e) => setRememberDevice(e.target.checked)}
                />
                <label className="form-check-label small text-secondary" htmlFor="rememberDevice">
                  Remember this device for 30 days
                </label>
              </div>
              <a href="#forgot" className="small text-decoration-none text-muted" onClick={(e) => { e.preventDefault(); alert("Contact your Clinic Tenant Admin to initiate a password reset."); }}>
                Forgot?
              </a>
            </div>

            <button
              type="submit"
              className="btn btn-cerulean w-100 py-2 d-flex align-items-center justify-content-center gap-2"
              disabled={isLoading}
            >
              {isLoading ? (
                <>
                  <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true" />
                  <span>Verifying Credentials...</span>
                </>
              ) : (
                <span>Sign In to Clinic</span>
              )}
            </button>
          </form>

          {/* Quick Demo Credentials */}
          <div className="mt-4 pt-3 border-top text-center">
            <span className="text-muted small d-block mb-2">One-Click Demo Credentials:</span>
            <div className="d-flex gap-2 justify-content-center">
              <button
                type="button"
                className="btn btn-sm btn-outline-secondary"
                onClick={() => fillCredentials("demo-a", "admin@demo-a.test", "DemoPassw0rd!2026")}
              >
                Tenant Admin
              </button>
              <button
                type="button"
                className="btn btn-sm btn-outline-secondary"
                onClick={() => fillCredentials("demo-a", "doctor@demo-a.test", "DemoPassw0rd!2026")}
              >
                Attending Doctor
              </button>
            </div>
          </div>

          {/* Registration Notice & Link */}
          <div className="mt-4 pt-3 border-top text-center">
            <p className="small text-muted mb-2">
              New clinician, nurse, or medical staff?
            </p>
            <Link
              to="/register"
              className="btn btn-cerulean-outline btn-sm w-100"
            >
              Submit Staff Registration Request
            </Link>
            <span className="d-block small text-muted mt-2" style={{ fontSize: "0.75rem" }}>
              * Registration requests require approval by the Clinic Tenant Admin.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
