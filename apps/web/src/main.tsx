import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider, Navigate } from "react-router";
import "./shared/i18n/index.js";
// tokens.css first: it owns the semantic tokens that theme.css bridges to.
import "./shared/styles/tokens.css";
import "./theme.css";
import { ThemeProvider } from "./shared/theme/ThemeProvider.js";
import { AuthProvider } from "./shared/auth/AuthContext.js";
import { StepUpProvider } from "./shared/auth/StepUpContext.js";
import { SearchProvider } from "./shared/search/CommandPalette.js";
import { MainLayout } from "./shell/MainLayout.js";
import { LoginPage } from "./features/auth/LoginPage.js";
import { RegisterPage } from "./features/auth/RegisterPage.js";
import { DashboardPage } from "./features/dashboard/DashboardPage.js";
import { PatientsPage } from "./features/patients/PatientsPage.js";
import { DuplicateReviewPage } from "./features/patients/DuplicateReviewPage.js";
import { SchedulingPage } from "./features/clinical/SchedulingPage.js";
import { QueueBoardPage } from "./features/clinical/QueueBoardPage.js";
import { VisitsPage } from "./features/clinical/VisitsPage.js";
import { VisitChartPage } from "./features/clinical/VisitChartPage.js";
import { ApprovalsPage } from "./features/admin/ApprovalsPage.js";
import { UsersPage } from "./features/admin/UsersPage.js";
import { RolesPage } from "./features/admin/RolesPage.js";
import { BranchesPage } from "./features/admin/BranchesPage.js";
import { CatalogPage } from "./features/admin/CatalogPage.js";
import { SettingsPage } from "./features/admin/SettingsPage.js";
import { SupplyDashboardPage } from "./features/supply/SupplyDashboardPage.js";
import { StockExplorerPage } from "./features/supply/StockExplorerPage.js";
import { GrnWizardPage } from "./features/supply/GrnWizardPage.js";
import { RequisitionsPage } from "./features/supply/RequisitionsPage.js";
import { ItemMasterPage } from "./features/supply/ItemMasterPage.js";
import { PharmacyQueuePage } from "./features/pharmacy/PharmacyQueuePage.js";
import { DispenseWorkbenchPage } from "./features/pharmacy/DispenseWorkbenchPage.js";
import { ControlledRegisterPage } from "./features/pharmacy/ControlledRegisterPage.js";
import { OtcSalesPage } from "./features/pharmacy/OtcSalesPage.js";
import { MedicationAdminPage } from "./features/pharmacy/MedicationAdminPage.js";
import { LabWorklistPage } from "./features/laboratory/LabWorklistPage.js";
import { ResultEntryPage } from "./features/laboratory/ResultEntryPage.js";
import { VerificationQueuePage } from "./features/laboratory/VerificationQueuePage.js";
import { CriticalAlertsPage } from "./features/laboratory/CriticalAlertsPage.js";
import { LabQcPage } from "./features/laboratory/LabQcPage.js";
import { LabReportsPage } from "./features/laboratory/LabReportsPage.js";
import { BillingWorkbenchPage } from "./features/billing/BillingWorkbenchPage.js";
import { CashierPosPage } from "./features/billing/CashierPosPage.js";
import { CashierShiftsPage } from "./features/billing/CashierShiftsPage.js";
import { CreditNotesPage } from "./features/billing/CreditNotesPage.js";
import { DailyClosePage } from "./features/billing/DailyClosePage.js";
import { PingPage } from "./features/ping/PingPage.js";
import { PlatformShell } from "./shell/PlatformShell.js";
import { TenantsPage } from "./features/platform/TenantsPage.js";
import { TenantDetailPage } from "./features/platform/TenantDetailPage.js";
import { NewTenantWizard } from "./features/platform/NewTenantWizard.js";

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
      { path: "patients/duplicates", element: <DuplicateReviewPage /> },
      {
        path: "clinical",
        children: [
          { path: "appointments", element: <SchedulingPage /> },
          { path: "queue", element: <QueueBoardPage /> },
          { path: "visits", element: <VisitsPage /> },
          { path: "visits/:visitId", element: <VisitChartPage /> },
        ],
      },
      {
        path: "pharmacy",
        children: [
          { index: true, element: <PharmacyQueuePage /> },
          { path: "queue", element: <PharmacyQueuePage /> },
          { path: "dispenses", element: <DispenseWorkbenchPage /> },
          { path: "dispenses/:id", element: <DispenseWorkbenchPage /> },
          { path: "controlled-register", element: <ControlledRegisterPage /> },
          { path: "sales", element: <OtcSalesPage /> },
          { path: "sales/:id", element: <OtcSalesPage /> },
          { path: "administrations", element: <MedicationAdminPage /> },
        ],
      },
      {
        path: "laboratory",
        children: [
          { index: true, element: <LabWorklistPage /> },
          { path: "worklist", element: <LabWorklistPage /> },
          { path: "results", element: <ResultEntryPage /> },
          { path: "verification", element: <VerificationQueuePage /> },
          { path: "critical-alerts", element: <CriticalAlertsPage /> },
          { path: "qc", element: <LabQcPage /> },
          { path: "reports", element: <LabReportsPage /> },
        ],
      },
      {
        path: "supply",
        children: [
          { index: true, element: <SupplyDashboardPage /> },
          { path: "dashboard", element: <SupplyDashboardPage /> },
          { path: "stock", element: <StockExplorerPage /> },
          { path: "grn", element: <GrnWizardPage /> },
          { path: "requisitions", element: <RequisitionsPage /> },
          { path: "items", element: <ItemMasterPage /> },
        ],
      },
      {
        path: "billing",
        children: [
          { index: true, element: <BillingWorkbenchPage /> },
          { path: "invoices", element: <BillingWorkbenchPage /> },
          { path: "pos", element: <CashierPosPage /> },
          { path: "shifts", element: <CashierShiftsPage /> },
          { path: "credit-notes", element: <CreditNotesPage /> },
          { path: "daily-close", element: <DailyClosePage /> },
        ],
      },
      {
        path: "admin",
        children: [
          { path: "approvals", element: <ApprovalsPage /> },
          { path: "users", element: <UsersPage /> },
          { path: "roles", element: <RolesPage /> },
          { path: "branches", element: <BranchesPage /> },
          { path: "service-catalog", element: <CatalogPage /> },
          { path: "settings", element: <SettingsPage /> },
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
      { path: "tenants", element: <TenantsPage /> },
      { path: "tenants/new", element: <NewTenantWizard /> },
      { path: "tenants/:tenantId", element: <TenantDetailPage /> },
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
    <ThemeProvider>
      <AuthProvider>
        <StepUpProvider>
          <SearchProvider>
            <RouterProvider router={router} />
          </SearchProvider>
        </StepUpProvider>
      </AuthProvider>
    </ThemeProvider>
  </StrictMode>,
);
