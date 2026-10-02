import React, { useState } from "react";
import { Outlet, NavLink, useNavigate } from "react-router";
import { useAuth } from "../shared/auth/AuthContext.js";
import { CommandPalette } from "../shared/search/CommandPalette.js";
import { getRegistrationRequests } from "../shared/services/registrationStore.js";

export function MainLayout() {
  const { session, logout, switchBranch } = useAuth();
  const navigate = useNavigate();

  const [isBranchModalOpen, setIsBranchModalOpen] = useState(false);
  const requests = getRegistrationRequests();
  const pendingApprovalsCount = requests.filter((r) => r.status === "PENDING_APPROVAL").length;

  const handleLogout = async () => {
    await logout();
    navigate("/login");
  };

  return (
    <div className="app-container">
      {/* Accessibility Skip Link */}
      <a className="visually-hidden-focusable p-2" href="#main" style={{
        position: "absolute",
        top: "-100px",
        left: "1rem",
        zIndex: 9999,
        background: "var(--cerulean-600)",
        color: "#fff",
        borderRadius: "0 0 var(--radius-sm) var(--radius-sm)",
        padding: "0.5rem 1rem",
        fontWeight: 600,
        textDecoration: "none",
      }}
      onFocus={(e) => { e.currentTarget.style.top = "0"; }}
      onBlur={(e) => { e.currentTarget.style.top = "-100px"; }}
      >
        Skip to main content
      </a>

      {/* ── 1. Header ──────────────────────────────────────────────────── */}
      <header className="app-header" role="banner">
        {/* Brand */}
        <div className="d-flex align-items-center gap-3">
          <NavLink to="/dashboard" className="brand-section" aria-label="Clinic Platform Home">
            <div className="brand-icon" aria-hidden="true">⚕</div>
            <div>
              <div className="brand-title">Clinic Platform</div>
              <div className="brand-subtitle">{session?.tenantSlug || "Medical EMR"}</div>
            </div>
          </NavLink>
        </div>

        {/* Center: Branch Selector */}
        <div className="header-center d-none d-md-flex">
          <button
            type="button"
            className="branch-selector-btn"
            onClick={() => setIsBranchModalOpen(true)}
            aria-label="Switch Active Branch"
            title="Switch Active Branch"
          >
            <span aria-hidden="true">🏢</span>
            <span>{session?.branchName || "Main Branch"}</span>
            <span style={{ fontSize: "0.65rem", opacity: 0.6, marginLeft: 2 }} aria-hidden="true">▼</span>
          </button>
        </div>

        {/* Right: Isolation badge + User + Sign Out */}
        <div className="header-right">
          {/* Global search / command palette trigger (todo §2.3, frontend §9). */}
          <button
            type="button"
            className="btn btn-sm d-none d-lg-inline-flex align-items-center gap-2"
            style={{
              background: "var(--grey-100, #f1f5f9)",
              border: "1px solid var(--grey-200)",
              color: "var(--grey-500)",
              borderRadius: "var(--radius-sm)",
              fontSize: "0.78rem",
              padding: "0.3rem 0.7rem",
            }}
            aria-label="Open global search (Control K)"
            title="Global search (Ctrl+K)"
            onClick={() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true }))}
          >
            <span aria-hidden="true">🔍</span>
            <span>Search…</span>
            <kbd style={{ fontSize: "0.65rem" }}>Ctrl K</kbd>
          </button>
          <span
            className="badge d-none d-sm-inline-flex align-items-center gap-1"
            style={{
              background: "linear-gradient(135deg, #dcfce7, #bbf7d0)",
              color: "#166534",
              border: "1px solid #86efac",
              borderRadius: "var(--radius-full)",
              fontSize: "0.7rem",
              fontWeight: 700,
              padding: "0.25rem 0.6rem",
              letterSpacing: "0.04em",
            }}
            title="Row-Level Security isolation active"
          >
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#22c55e", display: "inline-block" }} />
            RLS ISOLATED
          </span>

          <div className="user-profile-badge" role="status" aria-label={`Signed in as ${session?.name || "User"}`}>
            <div className="user-avatar" aria-hidden="true">
              {session?.name ? session.name.charAt(0).toUpperCase() : "U"}
            </div>
            <div className="d-none d-sm-block text-start">
              <div style={{ fontWeight: 600, fontSize: "0.82rem", color: "var(--grey-800)", lineHeight: 1.2 }}>
                {session?.name || "Dr. Maria Santos"}
              </div>
              <div style={{ fontSize: "0.68rem", color: "var(--grey-500)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                {session?.role || "TENANT_ADMIN"}
              </div>
            </div>
          </div>

          <button
            type="button"
            className="btn btn-sm"
            style={{
              background: "transparent",
              border: "1.5px solid var(--grey-300)",
              color: "var(--grey-600)",
              borderRadius: "var(--radius-sm)",
              fontWeight: 600,
              fontSize: "0.8rem",
              padding: "0.32rem 0.8rem",
              transition: "all 0.15s ease",
            }}
            onMouseOver={(e) => {
              (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--cerulean-400)";
              (e.currentTarget as HTMLButtonElement).style.color = "var(--cerulean-700)";
            }}
            onMouseOut={(e) => {
              (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--grey-300)";
              (e.currentTarget as HTMLButtonElement).style.color = "var(--grey-600)";
            }}
            onClick={handleLogout}
            title="Sign Out"
            aria-label="Sign Out"
          >
            Sign Out
          </button>
        </div>
      </header>

      {/* ── 2. Body: Sidebar + Content ─────────────────────────────────── */}
      <div className="app-body">
        {/* Left Sidebar */}
        <aside className="app-sidebar" aria-label="Main Navigation">
          <nav className="sidebar-nav" role="navigation">
            <div className="sidebar-group-title">WORKSPACE</div>
            <NavLink to="/dashboard" className={({ isActive }) => `sidebar-link ${isActive ? "active" : ""}`}>
              <span aria-hidden="true">📊</span>
              <span>Dashboard</span>
            </NavLink>
            <NavLink to="/patients" className={({ isActive }) => `sidebar-link ${isActive ? "active" : ""}`}>
              <span aria-hidden="true">👥</span>
              <span>Patient Registry</span>
            </NavLink>
            <NavLink to="/patients/duplicates" className={({ isActive }) => `sidebar-link ${isActive ? "active" : ""}`}>
              <span aria-hidden="true">🧬</span>
              <span>Duplicate Candidates</span>
              <span className="badge-pending" aria-label="JOB-22 worklist">22</span>
            </NavLink>

            <div className="sidebar-group-title">CLINICAL CARE</div>
            <NavLink to="/clinical/appointments" className={({ isActive }) => `sidebar-link ${isActive ? "active" : ""}`}>
              <span aria-hidden="true">📅</span>
              <span>Appointments</span>
            </NavLink>
            <NavLink to="/clinical/queue" className={({ isActive }) => `sidebar-link ${isActive ? "active" : ""}`}>
              <span aria-hidden="true">🎫</span>
              <span>Queue Board</span>
            </NavLink>
            <NavLink to="/clinical/visits" className={({ isActive }) => `sidebar-link ${isActive ? "active" : ""}`}>
              <span aria-hidden="true">🩺</span>
              <span>Consultations &amp; Chart</span>
            </NavLink>

            <div className="sidebar-group-title">PHARMACY DISPENSING</div>
            <NavLink to="/pharmacy/queue" className={({ isActive }) => `sidebar-link ${isActive ? "active" : ""}`}>
              <span aria-hidden="true">💊</span>
              <span>Verification Queue</span>
            </NavLink>
            <NavLink to="/pharmacy/dispenses" className={({ isActive }) => `sidebar-link ${isActive ? "active" : ""}`}>
              <span aria-hidden="true">⚖️</span>
              <span>Dispense Workbench</span>
            </NavLink>
            <NavLink to="/pharmacy/controlled-register" className={({ isActive }) => `sidebar-link ${isActive ? "active" : ""}`}>
              <span aria-hidden="true">📕</span>
              <span>Dangerous Drugs Book</span>
            </NavLink>
            <NavLink to="/pharmacy/sales" className={({ isActive }) => `sidebar-link ${isActive ? "active" : ""}`}>
              <span aria-hidden="true">🛒</span>
              <span>OTC Sales</span>
            </NavLink>
            <NavLink to="/pharmacy/administrations" className={({ isActive }) => `sidebar-link ${isActive ? "active" : ""}`}>
              <span aria-hidden="true">💉</span>
              <span>Medication Admin (MAR)</span>
            </NavLink>

            <div className="sidebar-group-title">LABORATORY</div>
            <NavLink to="/laboratory/worklist" className={({ isActive }) => `sidebar-link ${isActive ? "active" : ""}`}>
              <span aria-hidden="true">🔬</span>
              <span>Lab Workbench</span>
            </NavLink>
            <NavLink to="/laboratory/results" className={({ isActive }) => `sidebar-link ${isActive ? "active" : ""}`}>
              <span aria-hidden="true">📝</span>
              <span>Result Entry &amp; Flags</span>
            </NavLink>
            <NavLink to="/laboratory/verification" className={({ isActive }) => `sidebar-link ${isActive ? "active" : ""}`}>
              <span aria-hidden="true">🛡️</span>
              <span>Verification Queue</span>
            </NavLink>
            <NavLink to="/laboratory/critical-alerts" className={({ isActive }) => `sidebar-link ${isActive ? "active" : ""}`}>
              <span aria-hidden="true">⚡</span>
              <span>Critical Alerts</span>
            </NavLink>
            <NavLink to="/laboratory/qc" className={({ isActive }) => `sidebar-link ${isActive ? "active" : ""}`}>
              <span aria-hidden="true">📈</span>
              <span>Quality Control &amp; LJ</span>
            </NavLink>
            <NavLink to="/laboratory/reports" className={({ isActive }) => `sidebar-link ${isActive ? "active" : ""}`}>
              <span aria-hidden="true">📜</span>
              <span>Released Reports</span>
            </NavLink>

            <div className="sidebar-group-title">SUPPLY &amp; INVENTORY</div>
            <NavLink to="/supply/dashboard" className={({ isActive }) => `sidebar-link ${isActive ? "active" : ""}`}>
              <span aria-hidden="true">📈</span>
              <span>Supply Dashboard</span>
            </NavLink>
            <NavLink to="/supply/stock" className={({ isActive }) => `sidebar-link ${isActive ? "active" : ""}`}>
              <span aria-hidden="true">📦</span>
              <span>Stock Explorer</span>
            </NavLink>
            <NavLink to="/supply/grn" className={({ isActive }) => `sidebar-link ${isActive ? "active" : ""}`}>
              <span aria-hidden="true">📥</span>
              <span>Receive Delivery (GRN)</span>
            </NavLink>
            <NavLink to="/supply/requisitions" className={({ isActive }) => `sidebar-link ${isActive ? "active" : ""}`}>
              <span aria-hidden="true">📋</span>
              <span>Requisitions &amp; Issues</span>
            </NavLink>
            <NavLink to="/supply/items" className={({ isActive }) => `sidebar-link ${isActive ? "active" : ""}`}>
              <span aria-hidden="true">🏷️</span>
              <span>Item Master</span>
            </NavLink>

            <div className="sidebar-group-title">BILLING &amp; CASHIERING</div>
            <NavLink to="/billing/invoices" className={({ isActive }) => `sidebar-link ${isActive ? "active" : ""}`}>
              <span aria-hidden="true">🧾</span>
              <span>Billing &amp; Invoices</span>
            </NavLink>
            <NavLink to="/billing/pos" className={({ isActive }) => `sidebar-link ${isActive ? "active" : ""}`}>
              <span aria-hidden="true">🛒</span>
              <span>Cashier POS</span>
            </NavLink>
            <NavLink to="/billing/shifts" className={({ isActive }) => `sidebar-link ${isActive ? "active" : ""}`}>
              <span aria-hidden="true">⏱️</span>
              <span>Cashier Shifts</span>
            </NavLink>
            <NavLink to="/billing/credit-notes" className={({ isActive }) => `sidebar-link ${isActive ? "active" : ""}`}>
              <span aria-hidden="true">📑</span>
              <span>Credit Notes</span>
            </NavLink>
            <NavLink to="/billing/daily-close" className={({ isActive }) => `sidebar-link ${isActive ? "active" : ""}`}>
              <span aria-hidden="true">🔒</span>
              <span>Daily Close &amp; Tally</span>
            </NavLink>

            <div className="sidebar-group-title">TENANT ADMINISTRATION</div>
            <NavLink to="/admin/approvals" className={({ isActive }) => `sidebar-link ${isActive ? "active" : ""}`}>
              <span aria-hidden="true">📝</span>
              <span>Staff Approvals</span>
              {pendingApprovalsCount > 0 && (
                <span className="badge-pending" aria-label={`${pendingApprovalsCount} pending`}>
                  {pendingApprovalsCount}
                </span>
              )}
            </NavLink>
            <NavLink to="/admin/users" className={({ isActive }) => `sidebar-link ${isActive ? "active" : ""}`}>
              <span aria-hidden="true">👤</span>
              <span>Staff &amp; Users</span>
            </NavLink>
            <NavLink to="/admin/roles" className={({ isActive }) => `sidebar-link ${isActive ? "active" : ""}`}>
              <span aria-hidden="true">🛡️</span>
              <span>Roles &amp; Permissions</span>
            </NavLink>
            <NavLink to="/admin/branches" className={({ isActive }) => `sidebar-link ${isActive ? "active" : ""}`}>
              <span aria-hidden="true">🏢</span>
              <span>Branches &amp; Units</span>
            </NavLink>
            <NavLink to="/admin/service-catalog" className={({ isActive }) => `sidebar-link ${isActive ? "active" : ""}`}>
              <span aria-hidden="true">💰</span>
              <span>Services &amp; Prices</span>
            </NavLink>
            <NavLink to="/admin/settings" className={({ isActive }) => `sidebar-link ${isActive ? "active" : ""}`}>
              <span aria-hidden="true">⚙️</span>
              <span>Settings</span>
            </NavLink>

            <div className="sidebar-group-title">SYSTEM</div>
            <NavLink to="/ping" className={({ isActive }) => `sidebar-link ${isActive ? "active" : ""}`}>
              <span aria-hidden="true">📡</span>
              <span>System Health</span>
            </NavLink>
            <NavLink to="/platform/tenants" className={({ isActive }) => `sidebar-link ${isActive ? "active" : ""}`}>
              <span aria-hidden="true">🖥️</span>
              <span>Platform Console</span>
            </NavLink>
          </nav>

          {/* Sidebar footer badge */}
          <div style={{
            padding: "0.875rem 1rem",
            borderTop: "1px solid var(--grey-100)",
            fontSize: "0.72rem",
            color: "var(--grey-400)",
            display: "flex",
            alignItems: "center",
            gap: "0.4rem",
          }}>
            <span style={{
              width: 8, height: 8, borderRadius: "50%",
              background: "linear-gradient(135deg, var(--cerulean-400), var(--cerulean-600))",
              flexShrink: 0,
            }} />
            <span>DPA 2012 · PHI Protected</span>
          </div>
        </aside>

        {/* ── 3. Content Area ─── */}
        <main id="main" className="app-content" role="main">
          <Outlet />
        </main>
      </div>

      {/* ── 4. Footer ───────────────────────────────────────────────────── */}
      <footer className="app-footer" role="contentinfo">
        <div className="footer-status-pill">
          <span className="status-dot" aria-hidden="true" />
          <span>Clinic Platform v1.0 · Connected to Tenant Database · Multi-tenant RLS Active</span>
        </div>
        <div className="d-none d-md-block" style={{ color: "var(--grey-400)" }}>
          DPA 2012 / PhilHealth Konsulta Standard · PHT (Asia/Manila)
        </div>
        <div style={{ color: "var(--grey-400)" }}>
          © 2026 Clinic Platform · All rights reserved
        </div>
      </footer>

      {/* ── Global command palette (Ctrl/⌘+K, todo §2.3) ─────────────── */}
      <CommandPalette />

      {/* ── Branch Switcher Modal ─────────────────────────────────────────── */}
      {isBranchModalOpen && (
        <div
          className="modal show d-block"
          tabIndex={-1}
          role="dialog"
          aria-modal="true"
          aria-labelledby="branch-modal-title"
          style={{ backgroundColor: "rgba(15,23,42,0.45)" }}
          onClick={(e) => { if (e.target === e.currentTarget) setIsBranchModalOpen(false); }}
        >
          <div className="modal-dialog modal-dialog-centered" style={{ maxWidth: 420 }}>
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title" id="branch-modal-title">Switch Active Clinic Branch</h5>
                <button
                  type="button"
                  className="btn-close"
                  onClick={() => setIsBranchModalOpen(false)}
                  aria-label="Close"
                />
              </div>
              <div className="modal-body">
                <p className="small mb-3" style={{ color: "var(--grey-500)" }}>
                  Changing branch updates your operational scope, consultation queues, and stock registers.
                </p>
                <div className="list-group list-group-flush" style={{ borderRadius: "var(--radius-md)", overflow: "hidden", border: "1px solid var(--grey-200)" }}>
                  {(session?.assignedBranches || [
                    { id: "b1", name: "Metro General Hospital - Main Branch" },
                    { id: "b2", name: "North Care Ambulatory Center" },
                  ]).map((branch) => (
                    <button
                      key={branch.id}
                      type="button"
                      className={`list-group-item list-group-item-action d-flex align-items-center justify-content-between py-3 px-4 ${session?.branchId === branch.id ? "active" : ""}`}
                      onClick={() => {
                        switchBranch(branch.id);
                        setIsBranchModalOpen(false);
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: 600, fontSize: "0.875rem" }}>{branch.name}</div>
                        <div style={{ fontSize: "0.75rem", opacity: 0.75, marginTop: 1 }}>Asia/Manila (PHT)</div>
                      </div>
                      {session?.branchId === branch.id && (
                        <span style={{
                          fontSize: "0.7rem", fontWeight: 700,
                          background: "rgba(255,255,255,0.25)",
                          borderRadius: "var(--radius-full)",
                          padding: "0.2rem 0.55rem",
                        }}>
                          ACTIVE
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
              <div className="modal-footer">
                <button
                  type="button"
                  className="btn btn-sm btn-outline-secondary"
                  onClick={() => setIsBranchModalOpen(false)}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
