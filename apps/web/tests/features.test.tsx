import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { AuthProvider } from "../src/shared/auth/AuthContext.js";
import { PermissionsProvider } from "../src/shared/auth/PermissionsContext.js";
import { useStubHandler, type StubHandler } from "./setup.js";

/**
 * RolesPage is live-backed (specification §2.3): roles come from
 * GET /admin/roles and the catalogue from GET /admin/permissions, so this
 * suite stubs the loopback API (tests/setup.ts) with an admin session and a
 * catalogue slice. Fixtures mirror the ones in rbac.test.tsx.
 */
const ADMIN_SESSION = {
  user: { id: "3f1d3f1d-0000-4000-8000-0000000000e1", email: "admin@demo-a.test", name: "Demo A Admin" },
  tenant: { id: "11111111-1111-4111-8111-111111111111", slug: "demo-a" },
  sessionId: "3f1d3f1d-0000-4000-8000-0000000000e2",
  amr: ["pwd"],
  branchId: null,
  assignedBranches: [],
  effectiveTimezone: "Asia/Manila",
  expiresAt: new Date(Date.now() + 600_000).toISOString(),
  modules: ["admin"],
  modulesVersion: 1,
  permissions: ["admin.role.read"],
};

const ROLES = [
  {
    id: "3f1d3f1d-0000-4000-8000-0000000000a1",
    code: "tenant_admin",
    name: "Tenant Administrator",
    isSystem: true,
    permissions: ["admin.user.read", "admin.role.read"],
    rowVersion: 1,
  },
];

const CATALOGUE_SLICE = [
  {
    module: "admin",
    permissions: [
      { code: "admin.user.read", description: "View staff directory" },
      { code: "admin.role.read", description: "View roles and permissions" },
    ],
  },
];

const USERS = [
  {
    id: "3f1d3f1d-0000-4000-8000-0000000000b1",
    email: "dr.santos@demo-a.test",
    name: "Dr. Maria Clara Santos",
    status: "ACTIVE",
    mfaEnabled: true,
    roles: [{ id: "3f1d3f1d-0000-4000-8000-0000000000a1", code: "doctor", name: "Doctor" }],
    branches: [],
    lastLoginAt: null,
    rowVersion: 1,
  },
  {
    id: "3f1d3f1d-0000-4000-8000-0000000000b2",
    email: "admin@demo-a.test",
    name: "Tenant Administrator",
    status: "ACTIVE",
    mfaEnabled: true,
    roles: [{ id: "3f1d3f1d-0000-4000-8000-0000000000a1", code: "tenant_admin", name: "Tenant Administrator" }],
    branches: [],
    lastLoginAt: null,
    rowVersion: 1,
  },
];

/** Session + roles + users stub shared by the admin screens in this file. */
const adminStub: StubHandler = (req, res) => {
  const url = req.url ?? "";
  res.writeHead(200, { "content-type": "application/json" });
  if (url.includes("/auth/session")) {
    res.end(JSON.stringify(ADMIN_SESSION));
  } else if (url.includes("/admin/permissions")) {
    res.end(JSON.stringify(CATALOGUE_SLICE));
  } else if (url.includes("/admin/roles")) {
    res.end(JSON.stringify(ROLES));
  } else if (url.includes("/admin/users")) {
    res.end(JSON.stringify(USERS));
  } else {
    res.end(JSON.stringify({ ok: true }));
  }
};
import { BranchesPage } from "../src/features/admin/BranchesPage.js";
import { RolesPage } from "../src/features/admin/RolesPage.js";
import { UsersPage } from "../src/features/admin/UsersPage.js";
import { CatalogPage } from "../src/features/admin/CatalogPage.js";
import { SettingsPage } from "../src/features/admin/SettingsPage.js";
import { PatientsPage } from "../src/features/patients/PatientsPage.js";

describe("Phase 1 & 2 Frontend Feature Screens", () => {
  it("BranchesPage renders facility scopes, service profiles, and compliance badges", () => {
    render(
      <MemoryRouter>
        <AuthProvider>
          <BranchesPage />
        </AuthProvider>
      </MemoryRouter>,
    );

    expect(screen.getByText(/Branches & Operational Scopes/i)).toBeInTheDocument();
    expect(screen.getByText(/Metro General Hospital - Main Branch/i)).toBeInTheDocument();
    expect(screen.getByText(/North Care Ambulatory Center/i)).toBeInTheDocument();
    // Compliance badge for missing DOH LTO
    expect(screen.getByText(/DOH LTO licence not on file/i)).toBeInTheDocument();
  });

  it("RolesPage renders system roles and Segregation of Duties (SoD) safeguards", async () => {
    useStubHandler((req, res) => {
      const url = req.url ?? "";
      res.writeHead(200, { "content-type": "application/json" });
      if (url.includes("/auth/session")) {
        res.end(JSON.stringify(ADMIN_SESSION));
      } else if (url.includes("/admin/permissions")) {
        res.end(JSON.stringify(CATALOGUE_SLICE));
      } else if (url.includes("/admin/roles")) {
        res.end(JSON.stringify(ROLES));
      } else {
        res.end(JSON.stringify({ ok: true }));
      }
    });

    render(
      <MemoryRouter>
        <AuthProvider>
          <PermissionsProvider>
            <RolesPage />
          </PermissionsProvider>
        </AuthProvider>
      </MemoryRouter>,
    );

    expect(screen.getByText(/Roles & Access Control/i)).toBeInTheDocument();
    expect(screen.getByText(/Segregation of Duties \(SoD\) Enforcement Active/i)).toBeInTheDocument();
    // Roles arrive asynchronously from GET /admin/roles; the name renders in
    // both the role list and the matrix header, so use the all-variant.
    expect((await screen.findAllByText(/Tenant Administrator/i)).length).toBeGreaterThan(0);
    expect(screen.getByText(/pharmacy.rx.verify ⚡ pharmacy.dispense.post/i)).toBeInTheDocument();
  });

  it("UsersPage renders staff directory with roles and MFA security badges", async () => {
    useStubHandler(adminStub);
    render(
      <MemoryRouter>
        <AuthProvider>
          <PermissionsProvider>
            <UsersPage />
          </PermissionsProvider>
        </AuthProvider>
      </MemoryRouter>,
    );

    expect(screen.getByText(/Staff & User Directory/i)).toBeInTheDocument();
    // Rows arrive asynchronously from GET /admin/users.
    expect(await screen.findByText("Dr. Maria Clara Santos")).toBeInTheDocument();
    expect(screen.getAllByText(/TOTP Active/i).length).toBeGreaterThan(0);
  });

  it("CatalogPage renders services, statutory discounts, and payment methods", () => {
    render(
      <MemoryRouter>
        <AuthProvider>
          <CatalogPage />
        </AuthProvider>
      </MemoryRouter>,
    );

    expect(screen.getByText(/Service Catalog & Price Lists/i)).toBeInTheDocument();
    expect(screen.getByText(/General Practitioner Outpatient Consultation/i)).toBeInTheDocument();
    expect(screen.getByText(/PhilHealth Konsulta First Outpatient Benefit/i)).toBeInTheDocument();

    // Switch to Statutory Discounts tab
    fireEvent.click(screen.getByRole("button", { name: /Statutory Discounts/i }));
    expect(screen.getByText(/Senior Citizen Discount \(RA 9994\)/i)).toBeInTheDocument();
    expect(screen.getByText(/Persons with Disability \(RA 10754\)/i)).toBeInTheDocument();
  });

  it("SettingsPage renders module entitlements and security policies", () => {
    render(
      <MemoryRouter>
        <AuthProvider>
          <SettingsPage />
        </AuthProvider>
      </MemoryRouter>,
    );

    expect(screen.getByText(/Tenant Settings & Module Entitlements/i)).toBeInTheDocument();
    expect(screen.getByText(/15 Minutes/i)).toBeInTheDocument();
    expect(screen.getByText(/Central Supply & Inventory/i)).toBeInTheDocument();
  });

  it("PatientsPage renders MPI, enforces masked identifiers and requires audited reason for reveal", async () => {
    render(
      <MemoryRouter>
        <AuthProvider>
          <PatientsPage />
        </AuthProvider>
      </MemoryRouter>,
    );

    expect(screen.getByText(/Patient Registry & Master Patient Index/i)).toBeInTheDocument();
    expect(screen.getByText(/Santos, Maria Elena/i)).toBeInTheDocument();

    // Open patient chart
    const openChartButtons = screen.getAllByRole("button", { name: /Open Chart/i });
    expect(openChartButtons.length).toBeGreaterThan(0);
    fireEvent.click(openChartButtons[0]!);

    // Identifier is masked initially
    expect(screen.getByText(/12-\*\*\*\*\*01-2/i)).toBeInTheDocument();

    // Click reveal button to open audited reason modal
    const revealButtons = screen.getAllByRole("button", { name: /👁️ Reveal/i });
    expect(revealButtons.length).toBeGreaterThan(0);
    fireEvent.click(revealButtons[0]!);

    expect(screen.getByText(/Audited Reason Required for PHI Reveal/i)).toBeInTheDocument();

    // Fill in required reason explanation
    const reasonTextarea = screen.getByPlaceholderText(/Specify the patient encounter or invoice context/i);
    fireEvent.change(reasonTextarea, { target: { value: "Outpatient consult check" } });

    // Confirm reveal
    fireEvent.click(screen.getByRole("button", { name: /Confirm & Reveal Identifier/i }));

    // Now unmasked and marked as audited (async state update after audit api call)
    await screen.findByText(/Unmasked & Audited/i);
    expect(screen.getByText(/12-345678901-2/i)).toBeInTheDocument();
  });

  it("PatientsPage allows modifying patient information via edit modal", async () => {
    render(
      <MemoryRouter>
        <AuthProvider>
          <PatientsPage />
        </AuthProvider>
      </MemoryRouter>,
    );

    expect(screen.getByText(/Patient Registry & Master Patient Index/i)).toBeInTheDocument();

    // Click Edit button on the first patient row
    const editButtons = screen.getAllByRole("button", { name: /Edit/i });
    expect(editButtons.length).toBeGreaterThan(0);
    fireEvent.click(editButtons[0]!);

    // Modal opens
    expect(screen.getByText(/Modify Patient Information/i)).toBeInTheDocument();
    expect(screen.getByText(/Optimistic Concurrency Version/i)).toBeInTheDocument();

    // Modify first name
    const firstNameInput = screen.getByDisplayValue("Maria Elena");
    fireEvent.change(firstNameInput, { target: { value: "Maria Theresa" } });

    // Submit changes
    const saveButton = screen.getByRole("button", { name: /Save Changes/i });
    fireEvent.click(saveButton);

    // Verify modal closes and updated patient name appears
    await waitFor(() => {
      expect(screen.queryByText(/Modify Patient Information/i)).not.toBeInTheDocument();
    });
    expect(screen.getAllByText(/Santos, Maria Theresa/i).length).toBeGreaterThan(0);
  });

  const fullModuleSession = {
    user: { id: "u-full", email: "admin@demo-a.test", name: "Full Access" },
    tenant: { id: "11111111-1111-4111-8111-111111111111", slug: "demo-a" },
    sessionId: "3f1d3f1d-0000-4000-8000-0000000000f1",
    amr: ["pwd"],
    branchId: null,
    assignedBranches: [],
    effectiveTimezone: "Asia/Manila",
    expiresAt: new Date(Date.now() + 600_000).toISOString(),
    modules: ["patients", "clinical", "pharmacy", "laboratory", "supply", "billing", "admin"],
    modulesVersion: 1,
    permissions: [
      "clinical.visit.read",
      "clinical.queue.read",
      "patient.record.read",
      "patients.read",
      "lab.result.enter",
      "lab.result.verify",
      "lab.specimen.collect",
      "lab.specimen.receive",
      "lab.specimen.read",
      "pharmacy.rx.verify",
      "pharmacy.dispense.read",
      "supply.issue.read",
      "supply.grn.read",
      "supply.stock.read",
      "supply.report.view",
      "billing.invoice.read",
      "billing.invoice.create",
      "billing.payment.read",
      "billing.shift.read",
      "admin.branch.read",
    ],
  };

  const doctorOnlySession = {
    ...fullModuleSession,
    modules: ["patients", "clinical", "pharmacy", "laboratory"],
    permissions: [
      "clinical.visit.read",
      "clinical.queue.read",
      "patient.record.read",
      // Cross-module read/order grants that must NOT surface a workbench.
      "lab.order.create",
      "lab.order.read",
      "lab.result.read",
      "lab.report.read",
      "pharmacy.rx.read",
    ],
  };

  function dashboardStub(session: unknown): StubHandler {
    return (req, res) => {
      const url = req.url ?? "";
      res.writeHead(200, { "content-type": "application/json" });
      if (url.includes("/auth/session")) res.end(JSON.stringify(session));
      else res.end(JSON.stringify({ ok: true, data: [] }));
    };
  }

  it("DashboardPage renders operator KPI cards, tabs, and workbenches for a full-access session", async () => {
    const { DashboardPage } = await import("../src/features/dashboard/DashboardPage.js");
    useStubHandler(dashboardStub(fullModuleSession));
    render(
      <MemoryRouter>
        <AuthProvider>
          <PermissionsProvider>
            <DashboardPage />
          </PermissionsProvider>
        </AuthProvider>
      </MemoryRouter>,
    );

    // Hero and section titles resolve after the async permission set loads.
    expect(await screen.findByText(/Operational Working Data/i)).toBeInTheDocument();
    expect(screen.getByText(/Clinic Operations Command/i)).toBeInTheDocument();
    expect(screen.getByText(/Department Workbenches & Operations Hub/i)).toBeInTheDocument();

    expect(screen.getByText(/Active Visits/i)).toBeInTheDocument();
    expect(screen.getByText(/Lab Orders/i)).toBeInTheDocument();
    expect(screen.getByText(/Pharmacy Rx/i)).toBeInTheDocument();
    expect(screen.getByText(/Supply Items/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Billing POS/i).length).toBeGreaterThanOrEqual(1);

    expect(screen.getAllByText(/Clinical Encounters/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/Laboratory Worklist/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/Pharmacy Dispense Queue/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/Central Supply Issues/i).length).toBeGreaterThanOrEqual(1);
  });

  it("DashboardPage hides laboratory, pharmacy, supply and billing surfaces from a doctor", async () => {
    const { DashboardPage } = await import("../src/features/dashboard/DashboardPage.js");
    useStubHandler(dashboardStub(doctorOnlySession));
    render(
      <MemoryRouter>
        <AuthProvider>
          <PermissionsProvider>
            <DashboardPage />
          </PermissionsProvider>
        </AuthProvider>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText(/Active Visits/i)).toBeInTheDocument();
      expect(screen.queryByText(/Lab Orders/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/Pharmacy Rx/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/Supply Items/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/Billing POS/i)).not.toBeInTheDocument();
    });
    expect(screen.getAllByText(/Clinical Encounters/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText(/Laboratory Worklist/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Pharmacy Dispense Queue/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Central Supply Issues/i)).not.toBeInTheDocument();
  });
});

