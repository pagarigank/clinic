import React, { useEffect, useMemo, useState } from "react";
import { Outlet, NavLink, useLocation, useNavigate, Navigate } from "react-router";
import { useAuth } from "../shared/auth/AuthContext.js";
import { CommandPalette } from "../shared/search/CommandPalette.js";
import { getRegistrationRequests } from "../shared/services/registrationStore.js";

interface NavItem {
  to: string;
  icon: string;
  label: string;
  badge?: React.ReactNode;
}

interface NavGroup {
  id: string;
  label: string;
  icon: string;
  items: NavItem[];
}

/** Sidebar sections (frontend §8). Rendered as animated collapsible groups. */
const NAV_GROUPS: NavGroup[] = [
  {
    id: "workspace",
    label: "Workspace",
    icon: "🗂️",
    items: [
      { to: "/dashboard", icon: "📊", label: "Dashboard" },
      { to: "/patients", icon: "👥", label: "Patient Registry" },
      { to: "/patients/duplicates", icon: "🧬", label: "Duplicate Candidates" },
    ],
  },
  {
    id: "clinical",
    label: "Clinical Care",
    icon: "🩺",
    items: [
      { to: "/clinical/appointments", icon: "📅", label: "Appointments" },
      { to: "/clinical/queue", icon: "🎫", label: "Queue Board" },
      { to: "/clinical/visits", icon: "🩺", label: "Consultations & Chart" },
    ],
  },
  {
    id: "pharmacy",
    label: "Pharmacy Dispensing",
    icon: "💊",
    items: [
      { to: "/pharmacy/queue", icon: "💊", label: "Verification Queue" },
      { to: "/pharmacy/dispenses", icon: "⚖️", label: "Dispense Workbench" },
      { to: "/pharmacy/controlled-register", icon: "📕", label: "Dangerous Drugs Book" },
      { to: "/pharmacy/sales", icon: "🛒", label: "OTC Sales" },
      { to: "/pharmacy/administrations", icon: "💉", label: "Medication Admin (MAR)" },
    ],
  },
  {
    id: "laboratory",
    label: "Laboratory",
    icon: "🔬",
    items: [
      { to: "/laboratory/worklist", icon: "🔬", label: "Lab Workbench" },
      { to: "/laboratory/results", icon: "📝", label: "Result Entry & Flags" },
      { to: "/laboratory/verification", icon: "🛡️", label: "Verification Queue" },
      { to: "/laboratory/critical-alerts", icon: "⚡", label: "Critical Alerts" },
      { to: "/laboratory/qc", icon: "📈", label: "Quality Control & LJ" },
      { to: "/laboratory/reports", icon: "📜", label: "Released Reports" },
    ],
  },
  {
    id: "supply",
    label: "Supply & Inventory",
    icon: "📦",
    items: [
      { to: "/supply/dashboard", icon: "📈", label: "Supply Dashboard" },
      { to: "/supply/stock", icon: "📦", label: "Stock Explorer" },
      { to: "/supply/grn", icon: "📥", label: "Receive Delivery (GRN)" },
      { to: "/supply/requisitions", icon: "📋", label: "Requisitions & Issues" },
      { to: "/supply/issue", icon: "📤", label: "Issue / Consumption" },
      { to: "/supply/items", icon: "🏷️", label: "Item Master" },
    ],
  },
  {
    id: "billing",
    label: "Billing & Cashiering",
    icon: "💳",
    items: [
      { to: "/billing/invoices", icon: "🧾", label: "Billing & Invoices" },
      { to: "/billing/pos", icon: "🛒", label: "Cashier POS" },
      { to: "/billing/shifts", icon: "⏱️", label: "Cashier Shifts" },
      { to: "/billing/credit-notes", icon: "📑", label: "Credit Notes" },
      { to: "/billing/daily-close", icon: "🔒", label: "Daily Close & Tally" },
    ],
  },
  {
    id: "admin",
    label: "Tenant Administration",
    icon: "🏛️",
    items: [
      { to: "/admin/approvals", icon: "📝", label: "Staff Approvals" },
      { to: "/admin/users", icon: "👤", label: "Staff & Users" },
      { to: "/admin/roles", icon: "🛡️", label: "Roles & Permissions" },
      { to: "/admin/branches", icon: "🏢", label: "Branches & Units" },
      { to: "/admin/service-catalog", icon: "💰", label: "Services & Prices" },
      { to: "/admin/settings", icon: "⚙️", label: "Settings" },
    ],
  },
  {
    id: "system",
    label: "System",
    icon: "🖥️",
    items: [
      { to: "/ping", icon: "📡", label: "System Health" },
      { to: "/platform/tenants", icon: "🖥️", label: "Platform Console" },
    ],
  },
];

/** Group owning the current route (longest path match) so deep links expand. */
function groupForPath(pathname: string): string | undefined {
  let best: { id: string; len: number } | undefined;
  for (const group of NAV_GROUPS) {
    for (const item of group.items) {
      if (pathname === item.to || pathname.startsWith(`${item.to}/`)) {
        if (!best || item.to.length > best.len) best = { id: group.id, len: item.to.length };
      }
    }
  }
  return best?.id;
}

export function MainLayout() {
  const { session, logout, switchBranch, isLoading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [isBranchModalOpen, setIsBranchModalOpen] = useState(false);
  const requests = getRegistrationRequests();
  const pendingApprovalsCount = requests.filter((r) => r.status === "PENDING_APPROVAL").length;

  const navGroups = useMemo(
    () =>
      NAV_GROUPS.map((group) =>
        group.id === "workspace"
          ? {
              ...group,
              items: group.items.map((item) =>
                item.to === "/patients/duplicates"
                  ? { ...item, badge: <span className="badge-pending" aria-label="JOB-22 worklist">22</span> }
                  : item,
              ),
            }
          : group.id === "admin"
            ? {
                ...group,
                items: group.items.map((item) =>
                  item.to === "/admin/approvals" && pendingApprovalsCount > 0
                    ? {
                        ...item,
                        badge: (
                          <span className="badge-pending" aria-label={`${pendingApprovalsCount} pending`}>
                            {pendingApprovalsCount}
                          </span>
                        ),
                      }
                    : item,
                ),
              }
            : group,
      ),
    [pendingApprovalsCount],
  );

  const [openGroups, setOpenGroups] = useState<Set<string>>(() => {
    const active = groupForPath(location.pathname);
    return new Set(active ? [active] : ["workspace"]);
  });

  // Keep the section that owns the active route expanded (deep links, command
  // palette navigation) without fighting a user's manual collapse.
  useEffect(() => {
    const active = groupForPath(location.pathname);
    if (!active) return;
    setOpenGroups((prev) => (prev.has(active) ? prev : new Set(prev).add(active)));
  }, [location.pathname]);

  const toggleGroup = (id: string) => {
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

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
            {navGroups.map((group) => {
              const isOpen = openGroups.has(group.id);
              const panelId = `nav-group-${group.id}`;
              return (
                <div key={group.id} className={`sidebar-group ${isOpen ? "open" : ""}`}>
                  <button
                    type="button"
                    className="sidebar-group-toggle"
                    aria-expanded={isOpen}
                    aria-controls={panelId}
                    onClick={() => toggleGroup(group.id)}
                  >
                    <span className="sidebar-group-heading">
                      <span className="sidebar-group-icon" aria-hidden="true">
                        {group.icon}
                      </span>
                      <span>{group.label}</span>
                    </span>
                    <span className="sidebar-group-chevron" aria-hidden="true">
                      ▾
                    </span>
                  </button>
                  <div id={panelId} className="sidebar-group-panel" inert={!isOpen ? true : undefined}>
                    <div className="sidebar-group-panel-inner">
                      {group.items.map((item) => (
                        <NavLink
                          key={item.to}
                          to={item.to}
                          className={({ isActive }) => `sidebar-link ${isActive ? "active" : ""}`}
                          tabIndex={isOpen ? undefined : -1}
                        >
                          <span aria-hidden="true">{item.icon}</span>
                          <span>{item.label}</span>
                          {item.badge}
                        </NavLink>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })}
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
          {/* Gate on session init: AuthProvider restores the in-memory access
              token asynchronously on hard reload. Mounting page effects before
              that completes makes their first fetch race the refresh and 401.
              With refresh-token rotation + reuse detection, a second refresh
              would revoke the session family, so we wait instead. */}
          {isLoading ? (
            <div className="d-flex flex-column align-items-center justify-content-center py-5" role="status" aria-live="polite">
              <div className="spinner-border text-primary" aria-hidden="true" />
              <span className="visually-hidden">Restoring your session…</span>
            </div>
          ) : !session ? (
            <Navigate to="/login" replace />
          ) : (
            <Outlet />
          )}
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
