import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider, Navigate } from "react-router";
import "./shared/i18n/index.js";
// tokens.css first: it owns the semantic tokens that theme.css bridges to.
import "./shared/styles/tokens.css";
import "./theme.css";
import { ThemeProvider } from "./shared/theme/ThemeProvider.js";
import { AuthProvider } from "./shared/auth/AuthContext.js";
import { PlatformAuthProvider, RequirePlatform } from "./shared/auth/PlatformAuthContext.js";
import { PermissionsProvider, RequirePermission } from "./shared/auth/PermissionsContext.js";
import { StepUpProvider } from "./shared/auth/StepUpContext.js";
import { SearchProvider } from "./shared/search/CommandPalette.js";
import { MainLayout } from "./shell/MainLayout.js";
import { LoginPage } from "./features/auth/LoginPage.js";
import { RegisterPage } from "./features/auth/RegisterPage.js";
import { DashboardPage } from "./features/dashboard/DashboardPage.js";
import { PatientsPage } from "./features/patients/PatientsPage.js";
import { DuplicateReviewPage } from "./features/patients/DuplicateReviewPage.js";
import { SchedulingPage } from "./features/clinical/SchedulingPage.js";
import { PublicBookingPage } from "./features/clinical/PublicBookingPage.js";
import { QueueBoardPage } from "./features/clinical/QueueBoardPage.js";
import { VisitsPage } from "./features/clinical/VisitsPage.js";
import { VisitChartPage } from "./features/clinical/VisitChartPage.js";
import { ApprovalsPage } from "./features/admin/ApprovalsPage.js";
import { UsersPage } from "./features/admin/UsersPage.js";
import { CreateUserPage } from "./features/admin/CreateUserPage.js";
import { EmployeesPage } from "./features/admin/EmployeesPage.js";
import { RolesPage } from "./features/admin/RolesPage.js";
import { BranchesPage } from "./features/admin/BranchesPage.js";
import { CatalogPage } from "./features/admin/CatalogPage.js";
import { Icd10ManagementPage } from "./features/admin/Icd10ManagementPage.js";
import { SettingsPage } from "./features/admin/SettingsPage.js";
import { SupplyDashboardPage } from "./features/supply/SupplyDashboardPage.js";
import { StockExplorerPage } from "./features/supply/StockExplorerPage.js";
import { GrnWizardPage } from "./features/supply/GrnWizardPage.js";
import { RequisitionsPage } from "./features/supply/RequisitionsPage.js";
import { ItemMasterPage } from "./features/supply/ItemMasterPage.js";
import { SupplyIssueWorkbenchPage } from "./features/supply/SupplyIssueWorkbenchPage.js";
import { PharmacyQueuePage } from "./features/pharmacy/PharmacyQueuePage.js";
import { DispenseWorkbenchPage } from "./features/pharmacy/DispenseWorkbenchPage.js";
import { ControlledRegisterPage } from "./features/pharmacy/ControlledRegisterPage.js";
import { OtcSalesPage } from "./features/pharmacy/OtcSalesPage.js";
import { MedicationAdminPage } from "./features/pharmacy/MedicationAdminPage.js";
import { DrugCatalogPage } from "./features/pharmacy/DrugCatalogPage.js";
import { LabWorklistPage } from "./features/laboratory/LabWorklistPage.js";
import { ResultEntryPage } from "./features/laboratory/ResultEntryPage.js";
import { VerificationQueuePage } from "./features/laboratory/VerificationQueuePage.js";
import { CriticalAlertsPage } from "./features/laboratory/CriticalAlertsPage.js";
import { LabQcPage } from "./features/laboratory/LabQcPage.js";
import { LabReportsPage } from "./features/laboratory/LabReportsPage.js";
import { LabCatalogPage } from "./features/laboratory/LabCatalogPage.js";
import { BillingWorkbenchPage } from "./features/billing/BillingWorkbenchPage.js";
import { CashierPosPage } from "./features/billing/CashierPosPage.js";
import { CashierShiftsPage } from "./features/billing/CashierShiftsPage.js";
import { CreditNotesPage } from "./features/billing/CreditNotesPage.js";
import { DailyClosePage } from "./features/billing/DailyClosePage.js";
import { CompliancePage } from "./features/compliance/CompliancePage.js";
import { ReportsCatalogPage } from "./features/reports/ReportsCatalogPage.js";
import { RenalDashboardPage } from "./features/renal/RenalDashboardPage.js";
import { DialysisWorklistPage } from "./features/renal/DialysisWorklistPage.js";
import { DialyzerReprocessingPage } from "./features/renal/DialyzerReprocessingPage.js";
import { WaterTreatmentLogPage } from "./features/renal/WaterTreatmentLogPage.js";
import { PhilHealthTrackingPage } from "./features/renal/PhilHealthTrackingPage.js";
import { PingPage } from "./features/ping/PingPage.js";
import { PlatformShell } from "./shell/PlatformShell.js";
import { PlatformLoginPage } from "./features/platform/PlatformLoginPage.js";
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
  {
    path: "/book",
    element: <PublicBookingPage />,
  },
  {
    path: "/schedule",
    element: <PublicBookingPage />,
  },

  // Authenticated Main Menu Layout
  {
    path: "/",
    element: <MainLayout />,
    children: [
      { index: true, element: <DashboardPage /> },
      { path: "dashboard", element: <DashboardPage /> },
      { path: "patients", element: <RequirePermission module="patients" codes={["patient.record.read", "patients.read"]}><PatientsPage /></RequirePermission> },
      { path: "patients/duplicates", element: <RequirePermission module="patients" codes={["patient.record.merge", "patient.record.read", "patients.read"]}><DuplicateReviewPage /></RequirePermission> },
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
        path: "renal",
        children: [
          { index: true, element: <RenalDashboardPage /> },
          { path: "dashboard", element: <RenalDashboardPage /> },
          { path: "worklist", element: <DialysisWorklistPage /> },
          { path: "reprocessing", element: <DialyzerReprocessingPage /> },
          { path: "water-safety", element: <WaterTreatmentLogPage /> },
          { path: "philhealth", element: <PhilHealthTrackingPage /> },
        ],
      },
      {
        path: "pharmacy",
        children: [
          { index: true, element: <PharmacyQueuePage /> },
          { path: "queue", element: <PharmacyQueuePage /> },
          { path: "dispenses", element: <DispenseWorkbenchPage /> },
          { path: "dispenses/:id", element: <DispenseWorkbenchPage /> },
          { path: "dispense", element: <DispenseWorkbenchPage /> },
          { path: "dispense/:id", element: <DispenseWorkbenchPage /> },
          { path: "controlled-register", element: <ControlledRegisterPage /> },
          { path: "sales", element: <OtcSalesPage /> },
          { path: "sales/:id", element: <OtcSalesPage /> },
          { path: "administrations", element: <MedicationAdminPage /> },
          { path: "catalog", element: <DrugCatalogPage /> },
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
          { path: "catalog", element: <LabCatalogPage /> },
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
          { path: "issue", element: <SupplyIssueWorkbenchPage /> },
          { path: "issues", element: <SupplyIssueWorkbenchPage /> },
          { path: "dispense", element: <SupplyIssueWorkbenchPage /> },
          { path: "dispenses", element: <SupplyIssueWorkbenchPage /> },
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
          { path: "approvals", element: <RequirePermission module="admin" codes={["admin.user.read"]}><ApprovalsPage /></RequirePermission> },
          { path: "users", element: <RequirePermission module="admin" codes={["admin.user.read"]}><UsersPage /></RequirePermission> },
          { path: "users/new", element: <RequirePermission module="admin" codes={["admin.user.create"]}><CreateUserPage /></RequirePermission> },
          { path: "employees", element: <RequirePermission module="admin" codes={["admin.user.read"]}><EmployeesPage /></RequirePermission> },
          { path: "roles", element: <RequirePermission module="admin" codes={["admin.role.read"]}><RolesPage /></RequirePermission> },
          { path: "branches", element: <RequirePermission module="admin" codes={["admin.branch.read"]}><BranchesPage /></RequirePermission> },
          { path: "service-catalog", element: <RequirePermission module="admin" codes={["admin.service.read", "admin.price.read"]}><CatalogPage /></RequirePermission> },
          { path: "icd10", element: <RequirePermission module="admin" codes={["admin.settings.read", "reference.read"]}><Icd10ManagementPage /></RequirePermission> },
          { path: "settings", element: <RequirePermission module="admin" codes={["admin.settings.read"]}><SettingsPage /></RequirePermission> },
          { path: "clinic-profile", element: <RequirePermission module="admin" codes={["admin.settings.read"]}><SettingsPage /></RequirePermission> },
        ],
      },
      { path: "compliance", element: <CompliancePage /> },
      { path: "reports", element: <ReportsCatalogPage /> },
      { path: "ping", element: <PingPage /> },
    ],
  },

  // Platform Console (Superadmin) — separate login + platform scope guard
  {
    path: "/platform/login",
    element: <PlatformLoginPage />,
  },
  {
    path: "/platform",
    element: (
      <RequirePlatform>
        <PlatformShell />
      </RequirePlatform>
    ),
    children: [
      { path: "tenants", element: <TenantsPage /> },
      { path: "tenants/new", element: <NewTenantWizard /> },
      { path: "tenants/:tenantId", element: <TenantDetailPage /> },
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
        <PlatformAuthProvider>
          <StepUpProvider>
            <SearchProvider>
              <PermissionsProvider>
                <RouterProvider router={router} />
              </PermissionsProvider>
            </SearchProvider>
          </StepUpProvider>
        </PlatformAuthProvider>
      </AuthProvider>
    </ThemeProvider>
  </StrictMode>,
);
