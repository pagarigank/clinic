import React, { useState } from "react";
import { Outlet, NavLink, useNavigate } from "react-router";
import { useAuth } from "../shared/auth/AuthContext.js";
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
      <a className="visually-hidden-focusable p-2 bg-primary text-white" href="#main">
        Skip to main content
      </a>

      {/* 1. Header (Top Bar) */}
      <header className="app-header">
        {/* Brand & Clinic Identity */}
        <div className="d-flex align-items-center gap-3">
          <NavLink to="/dashboard" className="brand-section">
            <div className="brand-icon">⚕</div>
            <div>
              <h1 className="brand-title">Clinic Platform</h1>
              <div className="brand-subtitle">{session?.tenantSlug || "Medical EMR"}</div>
            </div>
          </NavLink>
        </div>

        {/* Center: Branch Selector & Context */}
        <div className="header-center d-none d-md-flex">
          <button
            type="button"
            className="branch-selector-btn"
            onClick={() => setIsBranchModalOpen(true)}
            title="Switch Active Branch"
          >
            <span>🏢</span>
            <span>{session?.branchName || "Main Branch"}</span>
            <span style={{ fontSize: "0.7rem", opacity: 0.7 }}>▼</span>
          </button>
        </div>

        {/* Right: Notifications, User Profile & Sign Out */}
        <div className="header-right">
          <div className="d-none d-sm-flex align-items-center text-secondary small me-2">
            <span className="badge bg-success-subtle text-success border border-success-subtle me-2">
              ● RLS ISOLATED
            </span>
          </div>

          <div className="user-profile-badge">
            <div className="user-avatar">
              {session?.name ? session.name.charAt(0).toUpperCase() : "U"}
            </div>
            <div className="d-none d-sm-block text-start">
              <div className="fw-semibold small text-dark" style={{ lineHeight: 1.2 }}>
                {session?.name || "Dr. Maria Santos"}
              </div>
              <div className="text-secondary small" style={{ fontSize: "0.72rem" }}>
                {session?.role || "TENANT_ADMIN"}
              </div>
            </div>
          </div>

          <button
            type="button"
            className="btn btn-outline-secondary btn-sm"
            onClick={handleLogout}
            title="Sign Out"
          >
            Sign Out
          </button>
        </div>
      </header>

      {/* 2. Middle Body: Left Nav Menu + Content Page */}
      <div className="app-body">
        {/* Left Nav Menu */}
        <aside className="app-sidebar" aria-label="Main Navigation">
          <nav className="sidebar-nav">
            <div className="sidebar-group-title">WORKSPACE</div>
            <NavLink
              to="/dashboard"
              className={({ isActive }) => `sidebar-link ${isActive ? "active" : ""}`}
            >
              <span>📊</span>
              <span>Dashboard</span>
            </NavLink>
            <NavLink
              to="/patients"
              className={({ isActive }) => `sidebar-link ${isActive ? "active" : ""}`}
            >
              <span>👥</span>
              <span>Patient Registry</span>
            </NavLink>

            <div className="sidebar-group-title">CLINICAL CARE</div>
            <NavLink
              to="/clinical/appointments"
              className={({ isActive }) => `sidebar-link ${isActive ? "active" : ""}`}
            >
              <span>📅</span>
              <span>Appointments</span>
            </NavLink>
            <NavLink
              to="/clinical/visits"
              className={({ isActive }) => `sidebar-link ${isActive ? "active" : ""}`}
            >
              <span>🩺</span>
              <span>Consultations & Chart</span>
            </NavLink>

            <div className="sidebar-group-title">TENANT ADMINISTRATION</div>
            <NavLink
              to="/admin/approvals"
              className={({ isActive }) => `sidebar-link ${isActive ? "active" : ""}`}
            >
              <span>📝</span>
              <span>Staff Approvals</span>
              {pendingApprovalsCount > 0 && (
                <span className="badge-pending">{pendingApprovalsCount}</span>
              )}
            </NavLink>
            <NavLink
              to="/admin/users"
              className={({ isActive }) => `sidebar-link ${isActive ? "active" : ""}`}
            >
              <span>👤</span>
              <span>Staff & Users</span>
            </NavLink>
            <NavLink
              to="/admin/roles"
              className={({ isActive }) => `sidebar-link ${isActive ? "active" : ""}`}
            >
              <span>🛡️</span>
              <span>Roles & Permissions</span>
            </NavLink>
            <NavLink
              to="/admin/branches"
              className={({ isActive }) => `sidebar-link ${isActive ? "active" : ""}`}
            >
              <span>🏢</span>
              <span>Branches & Units</span>
            </NavLink>
            <NavLink
              to="/admin/service-catalog"
              className={({ isActive }) => `sidebar-link ${isActive ? "active" : ""}`}
            >
              <span>💰</span>
              <span>Services & Prices</span>
            </NavLink>
            <NavLink
              to="/admin/settings"
              className={({ isActive }) => `sidebar-link ${isActive ? "active" : ""}`}
            >
              <span>⚙️</span>
              <span>Settings</span>
            </NavLink>

            <div className="sidebar-group-title">SYSTEM</div>
            <NavLink
              to="/ping"
              className={({ isActive }) => `sidebar-link ${isActive ? "active" : ""}`}
            >
              <span>📡</span>
              <span>System Health</span>
            </NavLink>
          </nav>
        </aside>

        {/* 3. Content Page */}
        <main id="main" className="app-content">
          <Outlet />
        </main>
      </div>

      {/* 4. Footer */}
      <footer className="app-footer">
        <div className="footer-status-pill">
          <span className="status-dot" />
          <span>Clinic Platform v1.0 · Connected to Tenant Database</span>
        </div>
        <div className="d-none d-md-block text-secondary">
          DPA 2012 / PhilHealth Konsulta Standard · Server UTC · Local PHT (Asia/Manila)
        </div>
        <div>
          <span>© 2026 Clinic Platform. All rights reserved.</span>
        </div>
      </footer>

      {/* Branch Switcher Modal */}
      {isBranchModalOpen && (
        <div className="modal show d-block" tabIndex={-1} style={{ backgroundColor: "rgba(0,0,0,0.4)" }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">Switch Active Clinic Branch</h5>
                <button
                  type="button"
                  className="btn-close"
                  onClick={() => setIsBranchModalOpen(false)}
                />
              </div>
              <div className="modal-body">
                <p className="small text-muted mb-3">
                  Changing branch updates operational scope, consultation queues, and stock registers.
                </p>
                <div className="list-group">
                  {(session?.assignedBranches || [
                    { id: "b1", name: "Metro General Hospital - Main Branch" },
                    { id: "b2", name: "North Care Ambulatory Center" },
                  ]).map((branch) => (
                    <button
                      key={branch.id}
                      type="button"
                      className={`list-group-item list-group-item-action d-flex align-items-center justify-content-between ${
                        session?.branchId === branch.id ? "active bg-primary border-primary" : ""
                      }`}
                      onClick={() => {
                        switchBranch(branch.id);
                        setIsBranchModalOpen(false);
                      }}
                    >
                      <div className="fw-semibold">{branch.name}</div>
                      {session?.branchId === branch.id && (
                        <span className="badge bg-light text-primary">Active</span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
              <div className="modal-footer">
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => setIsBranchModalOpen(false)}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
