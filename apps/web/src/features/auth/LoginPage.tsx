import React, { useState, useEffect } from "react";
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
  const [slug, setSlug] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberDevice, setRememberDevice] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const executeLogin = async (s: string, em: string, pw: string) => {
    setLocalError(null);

    let effectiveSlug = s.trim().toLowerCase().replace(/\.(emr|test|clinic\.ph|clinic|ph|com|local|org|net)$/i, "");
    if (!effectiveSlug && em.includes("@")) {
      const domain = em.split("@")[1]?.trim().toLowerCase() || "";
      effectiveSlug = domain.replace(/\.(emr|test|clinic\.ph|clinic|ph|com|local|org|net)$/i, "");
    }

    if (!effectiveSlug) {
      setLocalError("Please enter your clinic identifier.");
      return;
    }
    if (!em.trim() || !pw.trim()) {
      setLocalError("Please enter both email and password.");
      return;
    }

    setIsLoading(true);
    try {
      await login(effectiveSlug, em.trim(), pw);
      navigate("/dashboard");
    } catch (err: any) {
      setLocalError(err?.problem?.detail || err?.message || "Invalid credentials or clinic slug.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await executeLogin(slug, email, password);
  };

  const fillCredentials = (s: string, em: string, pw: string) => {
    setSlug(s);
    setEmail(em);
    setPassword(pw);
    setLocalError(null);
  };

  const handleEmailChange = (val: string) => {
    setEmail(val);
    if (!slug.trim() && val.includes("@")) {
      const domain = val.split("@")[1]?.trim().toLowerCase() || "";
      const inferred = domain.replace(/\.(emr|test|clinic\.ph|clinic|ph|com|local|org|net)$/i, "");
      if (inferred) {
        setSlug(inferred);
      }
    }
  };

  useEffect(() => {
    // Hide these shortcuts from production builds by gating them behind DEV
    // Vite will dead-code eliminate this block in production, completely removing the credentials.
    if (!import.meta.env.DEV) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;

      const key = e.key.toLowerCase();
      let email = "";

      switch (key) {
        case "i": email = "admin@demo-a.test"; break;
        case "b": email = "doctor@demo-a.test"; break;
        case "h": email = "labtech@demo-a.test"; break;
        case "j": email = "staff@demo-a.test"; break;
        case "p": email = "dispenser@demo-a.test"; break;
        case "m": email = "storekeeper@demo-a.test"; break;
        default: return;
      }

      e.preventDefault();
      fillCredentials("demo-a", email, "DemoPassw0rd!2026");
      void executeLogin("demo-a", email, "DemoPassw0rd!2026");
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [login, navigate]);

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
                  placeholder="e.g. metrocare"
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
                onChange={(e) => handleEmailChange(e.target.value)}
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

          {/* Patient Online Appointment Booking */}
          <div className="mt-4 pt-3 border-top text-center">
            <div className="p-3 rounded-3" style={{ backgroundColor: "rgba(14, 165, 233, 0.08)", border: "1px solid rgba(14, 165, 233, 0.25)" }}>
              <div className="d-flex align-items-center justify-content-center gap-2 mb-1">
                <span style={{ fontSize: "1.1rem" }}>📅</span>
                <span className="fw-semibold text-primary" style={{ fontSize: "0.95rem" }}>
                  Patient Appointment Scheduling
                </span>
              </div>
              <p className="small text-secondary mb-2">
                Need to consult a doctor? Book an outpatient consultation online without logging in.
              </p>
              <Link
                to={slug ? `/book?slug=${encodeURIComponent(slug)}` : "/book"}
                id="patient-booking-link"
                className="btn btn-outline-primary btn-sm w-100 fw-semibold d-inline-flex align-items-center justify-content-center gap-2"
              >
                <span>Schedule Appointment with Doctor</span>
                <span aria-hidden="true">→</span>
              </Link>
            </div>
          </div>

          {/* Registration Notice & Link */}
          <div className="mt-3 pt-3 border-top text-center">
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
