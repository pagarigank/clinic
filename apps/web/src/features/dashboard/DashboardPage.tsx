import React from "react";
import { Link } from "react-router";
import { useAuth } from "../../shared/auth/AuthContext.js";
import { getRegistrationRequests } from "../../shared/services/registrationStore.js";

const QUICK_ACTIONS = [
  {
    to: "/patients",
    icon: "👤",
    title: "Patient Registry",
    desc: "Search demographics, capture consents, PhilHealth data, and emergency intake.",
    accent: false,
  },
  {
    to: "/admin/approvals",
    icon: "📋",
    title: "Registration Approvals",
    desc: "Review, verify credentials, and approve incoming medical staff requests.",
    accent: true,
  },
  {
    to: "/admin/branches",
    icon: "🏢",
    title: "Branch Operations",
    desc: "Operating hours, examination rooms, service units, and licensing.",
    accent: false,
  },
  {
    to: "/admin/service-catalog",
    icon: "💰",
    title: "Service & Pricing Catalog",
    desc: "Manage consultation fees, discount categories, and payment channels.",
    accent: false,
  },
];

export function DashboardPage() {
  const { session } = useAuth();
  const requests = getRegistrationRequests();
  const pendingApprovals = requests.filter((r) => r.status === "PENDING_APPROVAL").length;

  return (
    <div>
      {/* ── Welcome Hero ──────────────────────────────────────────── */}
      <div
        style={{
          background: "var(--gradient-hero)",
          color: "var(--white)",
          borderRadius: "var(--radius-lg)",
          padding: "2rem 2rem 1.75rem",
          marginBottom: "1.75rem",
          boxShadow: "0 6px 20px rgba(0,123,167,0.18)",
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* Subtle grid pattern overlay */}
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: 0,
            backgroundImage:
              "repeating-linear-gradient(0deg,rgba(255,255,255,0.03) 0px,rgba(255,255,255,0.03) 1px,transparent 1px,transparent 40px),repeating-linear-gradient(90deg,rgba(255,255,255,0.03) 0px,rgba(255,255,255,0.03) 1px,transparent 1px,transparent 40px)",
            pointerEvents: "none",
          }}
        />
        <div className="row align-items-center" style={{ position: "relative" }}>
          <div className="col-lg-8">
            <span
              style={{
                display: "inline-block",
                padding: "0.25rem 0.8rem",
                borderRadius: "var(--radius-full)",
                background: "rgba(255,255,255,0.18)",
                fontSize: "0.75rem",
                fontWeight: 700,
                marginBottom: "0.75rem",
                letterSpacing: "0.07em",
                textTransform: "uppercase",
                backdropFilter: "blur(4px)",
              }}
            >
              {session?.branchName || "Main Branch"} · Clinic Portal
            </span>
            <h1 style={{ fontSize: "1.85rem", fontWeight: 800, margin: "0 0 0.5rem", letterSpacing: "-0.025em" }}>
              Welcome back, {session?.name || "Dr. Maria Santos"}
            </h1>
            <p style={{ margin: 0, opacity: 0.88, fontSize: "0.925rem", lineHeight: 1.6 }}>
              Enterprise Practice Management &amp; Electronic Medical Record System.&nbsp;
              Multi-tenant RLS isolation active.
            </p>
          </div>
          <div className="col-lg-4 text-lg-end mt-3 mt-lg-0">
            <div className="d-flex flex-wrap gap-2 justify-content-lg-end">
              <Link
                to="/patients"
                className="btn btn-light fw-semibold"
                style={{ color: "var(--cerulean-700)", borderRadius: "var(--radius-sm)", fontSize: "0.875rem" }}
              >
                + New Patient
              </Link>
              <Link
                to="/admin/approvals"
                className="btn btn-outline-light fw-semibold"
                style={{ borderRadius: "var(--radius-sm)", fontSize: "0.875rem" }}
              >
                Approvals {pendingApprovals > 0 && `(${pendingApprovals})`}
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* ── KPI Metric Cards ──────────────────────────────────────── */}
      <div className="row g-3 mb-4">
        {/* Today's Appointments */}
        <div className="col-sm-6 col-xl-3">
          <div className="metric-card d-flex align-items-center justify-content-between">
            <div>
              <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "var(--grey-400)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 4 }}>
                Today's Appointments
              </div>
              <div style={{ fontSize: "1.9rem", fontWeight: 800, color: "var(--grey-900)", lineHeight: 1 }}>28</div>
              <div style={{ fontSize: "0.78rem", color: "#16a34a", marginTop: 4 }}>✓ 19 checked in, 9 scheduled</div>
            </div>
            <div className="metric-icon" style={{ background: "linear-gradient(135deg, var(--cerulean-50), var(--cerulean-100))", color: "var(--cerulean-600)" }}>
              📅
            </div>
          </div>
        </div>

        {/* Active Patients */}
        <div className="col-sm-6 col-xl-3">
          <div className="metric-card d-flex align-items-center justify-content-between">
            <div>
              <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "var(--grey-400)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 4 }}>
                Active Patients
              </div>
              <div style={{ fontSize: "1.9rem", fontWeight: 800, color: "var(--grey-900)", lineHeight: 1 }}>1,482</div>
              <div style={{ fontSize: "0.78rem", color: "var(--grey-400)", marginTop: 4 }}>+14 registered this week</div>
            </div>
            <div className="metric-icon" style={{ background: "linear-gradient(135deg, #f0fdf4, #dcfce7)", color: "#16a34a" }}>
              👥
            </div>
          </div>
        </div>

        {/* Pending Approvals */}
        <div className="col-sm-6 col-xl-3">
          <div className="metric-card d-flex align-items-center justify-content-between">
            <div>
              <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "var(--grey-400)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 4 }}>
                Pending Approvals
              </div>
              <div style={{ fontSize: "1.9rem", fontWeight: 800, color: pendingApprovals > 0 ? "#d97706" : "var(--grey-900)", lineHeight: 1 }}>
                {pendingApprovals}
              </div>
              <div style={{ fontSize: "0.78rem", color: "var(--grey-400)", marginTop: 4 }}>Staff affiliation requests</div>
            </div>
            <div className="metric-icon" style={{ background: "linear-gradient(135deg, #fffbeb, #fef3c7)", color: "#d97706" }}>
              📝
            </div>
          </div>
        </div>

        {/* System Health */}
        <div className="col-sm-6 col-xl-3">
          <div className="metric-card d-flex align-items-center justify-content-between">
            <div>
              <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "var(--grey-400)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 4 }}>
                System Health
              </div>
              <div style={{ fontSize: "1.9rem", fontWeight: 800, color: "#16a34a", lineHeight: 1 }}>100%</div>
              <div style={{ fontSize: "0.78rem", color: "#16a34a", marginTop: 4 }}>Postgres 18 · RLS Forced</div>
            </div>
            <div className="metric-icon" style={{ background: "linear-gradient(135deg, #f0fdf4, #dcfce7)", color: "#16a34a" }}>
              🛡️
            </div>
          </div>
        </div>
      </div>

      {/* ── Quick Actions + Security Context ─────────────────────── */}
      <div className="row g-3">
        {/* Quick Actions Grid */}
        <div className="col-lg-8">
          <div className="clinic-card">
            <div className="clinic-card-header">
              <h2 className="clinic-card-title">Quick Action Hub</h2>
              <span
                style={{
                  fontSize: "0.72rem",
                  fontWeight: 700,
                  background: "var(--cerulean-100)",
                  color: "var(--cerulean-700)",
                  border: "1px solid var(--cerulean-200)",
                  borderRadius: "var(--radius-full)",
                  padding: "0.2rem 0.7rem",
                  letterSpacing: "0.04em",
                }}
              >
                CORE WORKFLOWS
              </span>
            </div>
            <div className="row g-3">
              {QUICK_ACTIONS.map((action) => (
                <div key={action.to} className="col-md-6">
                  <Link to={action.to} className="text-decoration-none d-block h-100">
                    <div
                      style={{
                        border: `1px solid ${action.accent ? "var(--cerulean-200)" : "var(--grey-200)"}`,
                        borderRadius: "var(--radius-md)",
                        padding: "1rem 1.1rem",
                        background: action.accent ? "linear-gradient(135deg, var(--cerulean-50), rgba(240,249,255,0.5))" : "var(--white)",
                        transition: "all 0.18s ease",
                        height: "100%",
                        cursor: "pointer",
                      }}
                      onMouseEnter={(e) => {
                        (e.currentTarget as HTMLDivElement).style.background = "linear-gradient(135deg, var(--cerulean-50), rgba(240,249,255,0.8))";
                        (e.currentTarget as HTMLDivElement).style.borderColor = "var(--cerulean-300)";
                        (e.currentTarget as HTMLDivElement).style.boxShadow = "0 4px 12px rgba(14,165,233,0.1)";
                        (e.currentTarget as HTMLDivElement).style.transform = "translateY(-2px)";
                      }}
                      onMouseLeave={(e) => {
                        (e.currentTarget as HTMLDivElement).style.background = action.accent
                          ? "linear-gradient(135deg, var(--cerulean-50), rgba(240,249,255,0.5))"
                          : "var(--white)";
                        (e.currentTarget as HTMLDivElement).style.borderColor = action.accent ? "var(--cerulean-200)" : "var(--grey-200)";
                        (e.currentTarget as HTMLDivElement).style.boxShadow = "none";
                        (e.currentTarget as HTMLDivElement).style.transform = "translateY(0)";
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", marginBottom: "0.4rem" }}>
                        <span style={{ fontSize: "1.25rem" }}>{action.icon}</span>
                        <strong style={{ color: "var(--grey-800)", fontSize: "0.9rem" }}>{action.title}</strong>
                        {action.to === "/admin/approvals" && pendingApprovals > 0 && (
                          <span
                            style={{
                              marginLeft: "auto",
                              background: "linear-gradient(135deg, #f59e0b, #d97706)",
                              color: "#fff",
                              fontSize: "0.68rem",
                              fontWeight: 700,
                              padding: "0.15rem 0.45rem",
                              borderRadius: "var(--radius-full)",
                            }}
                          >
                            {pendingApprovals}
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: "0.8rem", color: "var(--grey-500)", lineHeight: 1.5 }}>{action.desc}</div>
                    </div>
                  </Link>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Tenant Security Panel */}
        <div className="col-lg-4">
          <div className="clinic-card h-100" style={{ borderTop: "3px solid var(--cerulean-400)" }}>
            <div className="clinic-card-header">
              <h2 className="clinic-card-title">Tenant Security</h2>
              <span
                style={{
                  fontSize: "0.7rem",
                  fontWeight: 700,
                  background: "linear-gradient(135deg, #dcfce7, #bbf7d0)",
                  color: "#166534",
                  border: "1px solid #86efac",
                  borderRadius: "var(--radius-full)",
                  padding: "0.2rem 0.6rem",
                }}
              >
                AC-1 / AC-2
              </span>
            </div>
            <ul className="list-unstyled small mb-0">
              {[
                { label: "Tenant Org", value: session?.tenantSlug || "demo", mono: true },
                { label: "Active Branch", value: session?.branchName || "Main Branch", mono: false },
                { label: "Isolation Mode", value: "FORCED RLS", badge: true },
                { label: "Session Timeout", value: "15 min idle", mono: false },
                { label: "PHI Masking", value: "Active (RA 10173)", mono: false },
                { label: "SoD Enforcement", value: "Enabled", mono: false },
              ].map(({ label, value, mono, badge }, i, arr) => (
                <li
                  key={label}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "0.6rem 0",
                    borderBottom: i < arr.length - 1 ? "1px solid var(--grey-100)" : "none",
                  }}
                >
                  <span style={{ color: "var(--grey-500)" }}>{label}:</span>
                  {badge ? (
                    <span
                      style={{
                        fontSize: "0.68rem",
                        fontWeight: 700,
                        background: "var(--gradient-cerulean)",
                        color: "var(--white)",
                        borderRadius: "var(--radius-full)",
                        padding: "0.2rem 0.6rem",
                        letterSpacing: "0.04em",
                      }}
                    >
                      {value}
                    </span>
                  ) : (
                    <span
                      style={{
                        fontWeight: 600,
                        color: "var(--grey-800)",
                        fontFamily: mono ? "'Courier New', monospace" : undefined,
                        fontSize: mono ? "0.8rem" : undefined,
                      }}
                    >
                      {value}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
