import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router";
import { AuthProvider } from "../src/shared/auth/AuthContext.js";
import { StepUpProvider } from "../src/shared/auth/StepUpContext.js";
import { MainLayout } from "../src/shell/MainLayout.js";
import { ReportsCatalogPage } from "../src/features/reports/ReportsCatalogPage.js";
import { TenantDetailPage } from "../src/features/platform/TenantDetailPage.js";
import { useStubHandler } from "./setup.js";

describe("Phase 9 Frontend — Notifications, Reports, and Platform Console Completion", () => {
  describe("9.1 Notification Center & Preferences", () => {
    it("renders notification bell, unread badge, opens drawer and quiet hours modal", async () => {
      useStubHandler((req, res) => {
        res.writeHead(200, { "content-type": "application/json" });
        if (req.url?.includes("/notifications/read-all")) {
          return res.end(JSON.stringify({ success: true, count: 2 }));
        }
        if (req.url?.includes("/notifications")) {
          return res.end(
            JSON.stringify({
              data: [
                {
                  id: "notif-1",
                  severity: "CLINICAL_ALERT",
                  title: "Critical Potassium Alert",
                  body: "Patient serum potassium is 6.2 mmol/L",
                  read_at: null,
                  created_at: new Date().toISOString(),
                  deep_link: "/laboratory/critical-alerts",
                },
                {
                  id: "notif-2",
                  severity: "INFO",
                  title: "Report Export Ready",
                  body: "Daily revenue report has finished exporting.",
                  read_at: null,
                  created_at: new Date().toISOString(),
                  deep_link: "/reports",
                },
              ],
              meta: { unreadCount: 2 },
            }),
          );
        }
        if (req.url?.includes("/me/preferences")) {
          return res.end(
            JSON.stringify({
              quiet_hours_enabled: true,
              quiet_hours_start: "22:00:00",
              quiet_hours_end: "07:00:00",
              channels: { in_app: true, email: true, sms: false },
            }),
          );
        }
        res.end(JSON.stringify({ message: "ok" }));
      });

      render(
        <MemoryRouter initialEntries={["/dashboard"]}>
          <AuthProvider>
            <MainLayout />
          </AuthProvider>
        </MemoryRouter>,
      );

      // Bell button should render
      const bellButton = await screen.findByRole("button", { name: /Open notifications/i });
      expect(bellButton).toBeInTheDocument();

      // Open drawer
      fireEvent.click(bellButton);
      expect(await screen.findByText(/🔔 Notifications/i)).toBeInTheDocument();

      // Notifications should load from /notifications
      expect(await screen.findByText("Critical Potassium Alert")).toBeInTheDocument();
      expect(screen.getByText("CLINICAL_ALERT")).toBeInTheDocument();
      expect(screen.getByText("Report Export Ready")).toBeInTheDocument();

      // Notification badge should show "2"
      await waitFor(() => {
        expect(within(bellButton).getByText("2")).toBeInTheDocument();
      });

      // Open quiet hours settings
      const settingsBtn = screen.getByRole("button", { name: /Quiet Hours/i });
      fireEvent.click(settingsBtn);

      expect(await screen.findByText(/Notification Channels & Quiet Hours/i)).toBeInTheDocument();
      expect(screen.getByText(/In-App Notification Center/i)).toBeInTheDocument();
      expect(screen.getByText(/Email Alerts/i)).toBeInTheDocument();
    });
  });

  describe("9.3 Reports Catalogue, Runner & Schedules (AC-21)", () => {
    it("renders reports catalog, runs report, displays results table and export action", async () => {
      useStubHandler((req, res) => {
        res.writeHead(200, { "content-type": "application/json" });
        if (req.url?.includes("/reports/catalog")) {
          return res.end(
            JSON.stringify({
              reports: [
                {
                  id: "RPT-CLN-01",
                  module: "clinical",
                  name: "Daily Patient Census",
                  description: "Total encounters and admissions per provider",
                  category: "Clinical",
                  permitted_fields: ["visit_id", "patient_name", "doctor_name", "status"],
                  default_period: "today",
                  export_formats: ["CSV", "JSON"],
                },
                {
                  id: "RPT-SUP-01",
                  module: "supply",
                  name: "Stock Reorder List",
                  description: "Items below minimum safe inventory level",
                  category: "Supply",
                  permitted_fields: ["item_code", "name", "qty_on_hand", "min_level"],
                  default_period: "all",
                  export_formats: ["CSV"],
                },
              ],
            }),
          );
        }
        if (req.url?.includes("/reports/schedules")) {
          return res.end(
            JSON.stringify({
              schedules: [
                {
                  id: "sched-1",
                  report_id: "RPT-CLN-01",
                  cron_expression: "0 8 * * *",
                  format: "CSV",
                  is_active: true,
                  last_run_at: null,
                  created_at: new Date().toISOString(),
                },
              ],
            }),
          );
        }
        if (req.url?.includes("/reports/RPT-CLN-01/run")) {
          return res.end(
            JSON.stringify({
              runId: "run-001",
              reportId: "RPT-CLN-01",
              reportName: "Daily Patient Census",
              module: "clinical",
              rowCount: 1,
              data: [
                {
                  visit_id: "vis-101",
                  patient_name: "Juan Dela Cruz",
                  doctor_name: "Dr. Santos",
                  status: "COMPLETED",
                },
              ],
              permittedFields: ["visit_id", "patient_name", "doctor_name", "status"],
              executedAt: new Date().toISOString(),
            }),
          );
        }
        if (req.url?.includes("/reports/RPT-CLN-01/export")) {
          return res.end(
            JSON.stringify({
              runId: "run-001",
              fileId: "file-001",
              fileName: "RPT-CLN-01-export.csv",
            }),
          );
        }
        res.end(JSON.stringify({ message: "ok" }));
      });

      render(
        <MemoryRouter>
          <ReportsCatalogPage />
        </MemoryRouter>,
      );

      // Verifies catalog cards render
      expect(await screen.findByText("Daily Patient Census")).toBeInTheDocument();
      expect(screen.getByText("Stock Reorder List")).toBeInTheDocument();
      expect(screen.getByText("RPT-CLN-01")).toBeInTheDocument();

      // Run report button
      const runButtons = screen.getAllByRole("button", { name: /Run Now/i });
      expect(runButtons.length).toBeGreaterThan(0);
      fireEvent.click(runButtons[0]!);

      // Results tab should show
      expect(await screen.findByText("Juan Dela Cruz")).toBeInTheDocument();
      expect(screen.getByText("Dr. Santos")).toBeInTheDocument();

      // Export CSV
      const exportButton = screen.getByRole("button", { name: /Download CSV/i });
      fireEvent.click(exportButton);
      expect(await screen.findByText(/Export completed! File reference: RPT-CLN-01-export\.csv/i)).toBeInTheDocument();
    });
  });

  describe("9.4 Platform Console Completion (Q-15, JOB-04, JOB-05, RPT-PLT-09)", () => {
    it("renders subscription downgrade protection, jobs monitor replay, and RPT-PLT-09 transparency report without PHI", async () => {
      useStubHandler((req, res) => {
        res.writeHead(200, { "content-type": "application/json" });
        if (req.url?.includes("/platform/plans")) {
          return res.end(
            JSON.stringify({
              plans: [
                { id: "plan-starter", code: "starter", name: "Starter Tier" },
                { id: "plan-ent", code: "enterprise", name: "Enterprise Tier" },
              ],
            }),
          );
        }
        if (req.url?.includes("/platform/tenants/t1/export")) {
          return res.end(JSON.stringify({ fileName: "tenant-t1-backup.json" }));
        }
        if (req.url?.includes("/platform/jobs")) {
          return res.end(
            JSON.stringify({
              jobs: [
                {
                  id: "job-dlq-123456",
                  event_type: "notification.send",
                  processed_at: null,
                  created_at: new Date().toISOString(),
                },
              ],
            }),
          );
        }
        if (req.url?.includes("/platform/reports/RPT-PLT-09")) {
          return res.end(
            JSON.stringify({
              reportId: "RPT-PLT-09",
              title: "Module Entitlement Transparency Audit",
              rows: [
                {
                  id: "row-1",
                  created_at: new Date().toISOString(),
                  module: "laboratory",
                  action: "DISABLE",
                  reason: "Trial expired and drained",
                  is_forced: false,
                },
              ],
            }),
          );
        }
        res.end(JSON.stringify({ message: "ok" }));
      });

      render(
        <MemoryRouter
          initialEntries={[
            { pathname: "/platform/tenants/t1", state: { tenant: { name: "Apex Health", slug: "apex" } } },
          ]}
        >
          <AuthProvider>
            <StepUpProvider>
              <Routes>
                <Route path="/platform/tenants/:tenantId" element={<TenantDetailPage />} />
              </Routes>
            </StepUpProvider>
          </AuthProvider>
        </MemoryRouter>,
      );

      // Switch to Subscription & Lifecycle tab
      const subTab = await screen.findByRole("tab", { name: /Subscription & Lifecycle/i });
      fireEvent.click(subTab);

      expect(await screen.findByText(/Commercial Subscription Plan \(Q-15 Downgrade Protection\)/i)).toBeInTheDocument();
      expect(screen.getByText(/Tenant Data Export \(JOB-04\)/i)).toBeInTheDocument();
      expect(screen.getByText(/Tenant Offboarding & Purge \(JOB-05\)/i)).toBeInTheDocument();

      // Trigger export
      const exportBtn = screen.getByRole("button", { name: /Generate Tenant Export/i });
      fireEvent.click(exportBtn);
      expect(await screen.findByText(/Tenant dataset export created: tenant-t1-backup\.json/i)).toBeInTheDocument();

      // Switch to Job Monitor tab
      const jobsTab = screen.getByRole("tab", { name: /Job Monitor/i });
      fireEvent.click(jobsTab);
      expect(await screen.findByText(/Platform Background Jobs & DLQ Tooling/i)).toBeInTheDocument();
      expect(await screen.findByText("notification.send")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Replay/i })).toBeInTheDocument();

      // Switch to Transparency tab (RPT-PLT-09)
      const transTab = screen.getByRole("tab", { name: /Transparency \(RPT-PLT-09\)/i });
      fireEvent.click(transTab);
      expect(await screen.findByText(/RPT-PLT-09: Module Entitlement Transparency Audit/i)).toBeInTheDocument();
      expect(screen.getByText(/NO PHI \(VERIFIED\)/i)).toBeInTheDocument();
      expect(await screen.findByText("Trial expired and drained")).toBeInTheDocument();
      expect(screen.getByText("DISABLE")).toBeInTheDocument();
    });
  });
});
