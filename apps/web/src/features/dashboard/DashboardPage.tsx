import React from "react";
import { Link } from "react-router";
import { useAuth } from "../../shared/auth/AuthContext.js";
import { getRegistrationRequests } from "../../shared/services/registrationStore.js";

export function DashboardPage() {
  const { session } = useAuth();
  const requests = getRegistrationRequests();
  const pendingApprovals = requests.filter((r) => r.status === "PENDING_APPROVAL").length;

  return (
    <div>
      {/* Welcome Hero Card */}
      <div
        style={{
          background: "linear-gradient(135deg, var(--cerulean-600) 0%, var(--cerulean-800) 100%)",
          color: "var(--white)",
          borderRadius: "12px",
          padding: "2rem",
          marginBottom: "1.75rem",
          boxShadow: "0 4px 12px rgba(0, 123, 167, 0.15)",
        }}
      >
        <div className="row align-items-center">
          <div className="col-lg-8">
            <span
              style={{
                display: "inline-block",
                padding: "0.25rem 0.75rem",
                borderRadius: "20px",
                backgroundColor: "rgba(255, 255, 255, 0.2)",
                fontSize: "0.8rem",
                fontWeight: 600,
                marginBottom: "0.75rem",
                letterSpacing: "0.05em",
                textTransform: "uppercase",
              }}
            >
              {session?.branchName || "Main Branch"} · Clinic Portal
            </span>
            <h1 style={{ fontSize: "1.75rem", fontWeight: 700, margin: "0 0 0.5rem" }}>
              Welcome back, {session?.name || "Dr. Maria Santos"}
            </h1>
            <p style={{ margin: 0, opacity: 0.9, fontSize: "0.95rem" }}>
              Enterprise Practice Management & Electronic Medical Record System. Multi-tenant RLS isolation active.
            </p>
          </div>
          <div className="col-lg-4 text-lg-end mt-3 mt-lg-0">
            <div className="d-flex flex-wrap gap-2 justify-content-lg-end">
              <Link to="/patients" className="btn btn-light fw-semibold text-primary">
                + New Patient
              </Link>
              <Link to="/admin/approvals" className="btn btn-outline-light">
                Approvals {pendingApprovals > 0 && `(${pendingApprovals})`}
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* Metrics Row */}
      <div className="row g-3 mb-4">
        <div className="col-sm-6 col-xl-3">
          <div className="clinic-card p-3 mb-0">
            <div className="d-flex align-items-center justify-content-between mb-2">
              <span className="small text-secondary fw-semibold">TODAY'S APPOINTMENTS</span>
              <span style={{ fontSize: "1.2rem" }}>📅</span>
            </div>
            <div className="fs-3 fw-bold text-dark">28</div>
            <div className="small text-success mt-1">✓ 19 checked in, 9 scheduled</div>
          </div>
        </div>

        <div className="col-sm-6 col-xl-3">
          <div className="clinic-card p-3 mb-0">
            <div className="d-flex align-items-center justify-content-between mb-2">
              <span className="small text-secondary fw-semibold">ACTIVE PATIENTS</span>
              <span style={{ fontSize: "1.2rem" }}>👥</span>
            </div>
            <div className="fs-3 fw-bold text-dark">1,482</div>
            <div className="small text-muted mt-1">+14 registered this week</div>
          </div>
        </div>

        <div className="col-sm-6 col-xl-3">
          <div className="clinic-card p-3 mb-0">
            <div className="d-flex align-items-center justify-content-between mb-2">
              <span className="small text-secondary fw-semibold">PENDING APPROVALS</span>
              <span style={{ fontSize: "1.2rem" }}>📝</span>
            </div>
            <div className="fs-3 fw-bold text-warning">{pendingApprovals}</div>
            <div className="small text-muted mt-1">Staff affiliation requests</div>
          </div>
        </div>

        <div className="col-sm-6 col-xl-3">
          <div className="clinic-card p-3 mb-0">
            <div className="d-flex align-items-center justify-content-between mb-2">
              <span className="small text-secondary fw-semibold">SYSTEM HEALTH</span>
              <span style={{ fontSize: "1.2rem" }}>🛡️</span>
            </div>
            <div className="fs-3 fw-bold text-success">100%</div>
            <div className="small text-success mt-1">Postgres 18 · RLS Forced</div>
          </div>
        </div>
      </div>

      {/* Quick Access Modules */}
      <div className="row g-3">
        <div className="col-lg-8">
          <div className="clinic-card">
            <div className="clinic-card-header">
              <h2 className="clinic-card-title">Quick Action Hub</h2>
              <span className="badge bg-light text-secondary border">Core Workflows</span>
            </div>
            <div className="row g-3">
              <div className="col-md-6">
                <Link to="/patients" className="text-decoration-none">
                  <div
                    style={{
                      border: "1px solid var(--grey-200)",
                      borderRadius: "8px",
                      padding: "1rem",
                      backgroundColor: "var(--grey-50)",
                      transition: "all 0.15s ease",
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "var(--cerulean-50)"; e.currentTarget.style.borderColor = "var(--cerulean-300)"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "var(--grey-50)"; e.currentTarget.style.borderColor = "var(--grey-200)"; }}
                  >
                    <div className="d-flex align-items-center gap-2 mb-1">
                      <span style={{ fontSize: "1.2rem" }}>👤</span>
                      <strong className="text-dark">Patient Registry</strong>
                    </div>
                    <div className="small text-muted">
                      Search demographics, capture consents, PhilHealth data, and emergency intake.
                    </div>
                  </div>
                </Link>
              </div>

              <div className="col-md-6">
                <Link to="/admin/approvals" className="text-decoration-none">
                  <div
                    style={{
                      border: "1px solid var(--grey-200)",
                      borderRadius: "8px",
                      padding: "1rem",
                      backgroundColor: "var(--grey-50)",
                      transition: "all 0.15s ease",
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "var(--cerulean-50)"; e.currentTarget.style.borderColor = "var(--cerulean-300)"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "var(--grey-50)"; e.currentTarget.style.borderColor = "var(--grey-200)"; }}
                  >
                    <div className="d-flex align-items-center gap-2 mb-1">
                      <span style={{ fontSize: "1.2rem" }}>📋</span>
                      <strong className="text-dark">Registration Approvals</strong>
                      {pendingApprovals > 0 && (
                        <span className="badge bg-warning text-dark ms-auto">{pendingApprovals}</span>
                      )}
                    </div>
                    <div className="small text-muted">
                      Review, verify credentials, and approve incoming medical staff requests.
                    </div>
                  </div>
                </Link>
              </div>

              <div className="col-md-6">
                <Link to="/admin/branches" className="text-decoration-none">
                  <div
                    style={{
                      border: "1px solid var(--grey-200)",
                      borderRadius: "8px",
                      padding: "1rem",
                      backgroundColor: "var(--grey-50)",
                      transition: "all 0.15s ease",
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "var(--cerulean-50)"; e.currentTarget.style.borderColor = "var(--cerulean-300)"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "var(--grey-50)"; e.currentTarget.style.borderColor = "var(--grey-200)"; }}
                  >
                    <div className="d-flex align-items-center gap-2 mb-1">
                      <span style={{ fontSize: "1.2rem" }}>🏢</span>
                      <strong className="text-dark">Branch Operations</strong>
                    </div>
                    <div className="small text-muted">
                      Operating hours, examination rooms, service units, and licensing.
                    </div>
                  </div>
                </Link>
              </div>

              <div className="col-md-6">
                <Link to="/admin/service-catalog" className="text-decoration-none">
                  <div
                    style={{
                      border: "1px solid var(--grey-200)",
                      borderRadius: "8px",
                      padding: "1rem",
                      backgroundColor: "var(--grey-50)",
                      transition: "all 0.15s ease",
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "var(--cerulean-50)"; e.currentTarget.style.borderColor = "var(--cerulean-300)"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "var(--grey-50)"; e.currentTarget.style.borderColor = "var(--grey-200)"; }}
                  >
                    <div className="d-flex align-items-center gap-2 mb-1">
                      <span style={{ fontSize: "1.2rem" }}>💰</span>
                      <strong className="text-dark">Service & Pricing Catalog</strong>
                    </div>
                    <div className="small text-muted">
                      Manage clinic consultation fees, discount categories, and payment channels.
                    </div>
                  </div>
                </Link>
              </div>
            </div>
          </div>
        </div>

        {/* System & Tenancy Context */}
        <div className="col-lg-4">
          <div className="clinic-card">
            <div className="clinic-card-header">
              <h2 className="clinic-card-title">Tenant Security</h2>
              <span className="badge bg-success-subtle text-success border border-success-subtle">AC-1 / AC-2</span>
            </div>
            <ul className="list-unstyled small mb-0">
              <li className="d-flex justify-content-between py-2 border-bottom">
                <span className="text-muted">Tenant Org:</span>
                <span className="fw-semibold font-monospace">{session?.tenantSlug || "demo"}</span>
              </li>
              <li className="d-flex justify-content-between py-2 border-bottom">
                <span className="text-muted">Active Branch:</span>
                <span className="fw-semibold">{session?.branchName || "Main Branch"}</span>
              </li>
              <li className="d-flex justify-content-between py-2 border-bottom">
                <span className="text-muted">Isolation Mode:</span>
                <span className="badge bg-primary text-white">FORCED RLS</span>
              </li>
              <li className="d-flex justify-content-between py-2">
                <span className="text-muted">Session Timeout:</span>
                <span className="text-secondary">15 minutes idle</span>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
