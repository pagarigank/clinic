import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider, Navigate } from "react-router";
import "./theme.css";
import { AuthProvider } from "./shared/auth/AuthContext.js";
import { MainLayout } from "./shell/MainLayout.js";
import { LoginPage } from "./features/auth/LoginPage.js";
import { RegisterPage } from "./features/auth/RegisterPage.js";
import { DashboardPage } from "./features/dashboard/DashboardPage.js";
import { PatientsPage } from "./features/patients/PatientsPage.js";
import { ApprovalsPage } from "./features/admin/ApprovalsPage.js";
import { PingPage } from "./features/ping/PingPage.js";
import { PlatformShell } from "./shell/PlatformShell.js";

const router = createBrowserRouter([
  // Public Auth Routes
  {
    path: "/login",
    element: <LoginPage />,
  },
  {
    path: "/register",
    element: <RegisterPage />,
  },

  // Authenticated Main Menu Layout
  {
    path: "/",
    element: <MainLayout />,
    children: [
      { index: true, element: <DashboardPage /> },
      { path: "dashboard", element: <DashboardPage /> },
      { path: "patients", element: <PatientsPage /> },
      {
        path: "clinical",
        children: [
          { path: "appointments", element: <div className="clinic-card"><h2 className="clinic-card-title mb-3">Appointments & Scheduling</h2><p className="text-muted">Physician calendar slots and booking manager (Phase 3).</p></div> },
          { path: "visits", element: <div className="clinic-card"><h2 className="clinic-card-title mb-3">Clinical Encounters & Visits</h2><p className="text-muted">Outpatient consultation, vitals, and SOAP notes (Phase 3).</p></div> },
        ],
      },
      {
        path: "admin",
        children: [
          { path: "approvals", element: <ApprovalsPage /> },
          { path: "users", element: <div className="clinic-card"><h2 className="clinic-card-title mb-3">Staff & User Directory</h2><p className="text-muted">Manage clinical staff, practitioner profiles, and invitations.</p></div> },
          { path: "roles", element: <div className="clinic-card"><h2 className="clinic-card-title mb-3">Roles & Permissions Matrix</h2><p className="text-muted">354 permission catalogue codes and system roles.</p></div> },
          { path: "branches", element: <div className="clinic-card"><h2 className="clinic-card-title mb-3">Branches & Service Units</h2><p className="text-muted">Manage clinic branch licenses and examination rooms.</p></div> },
          { path: "service-catalog", element: <div className="clinic-card"><h2 className="clinic-card-title mb-3">Service Catalog & Price Lists</h2><p className="text-muted">Configurable consultation services and effective-dated pricing.</p></div> },
          { path: "settings", element: <div className="clinic-card"><h2 className="clinic-card-title mb-3">Tenant Configuration & Policies</h2><p className="text-muted">MFA policy, SoD enforcement, and audit settings.</p></div> },
        ],
      },
      { path: "ping", element: <PingPage /> },
    ],
  },

  // Platform Console (Superadmin)
  {
    path: "/platform",
    element: <PlatformShell />,
    children: [
      { path: "tenants", element: <div>Tenants List</div> },
      { path: "admins", element: <div>Admins</div> },
      { path: "break-glass", element: <div>Break-glass Console</div> },
      { path: "jobs", element: <div>Jobs Monitor</div> },
    ],
  },

  // Catch-all redirect
  {
    path: "*",
    element: <Navigate to="/dashboard" replace />,
  },
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>
  </StrictMode>,
);
