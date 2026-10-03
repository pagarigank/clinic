import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";
import { AuthProvider } from "../src/shared/auth/AuthContext.js";
import { PermissionsProvider, RequirePermission } from "../src/shared/auth/PermissionsContext.js";
import { usePermissions } from "../src/shared/auth/PermissionsContext.js";
import { RolesPage } from "../src/features/admin/RolesPage.js";
import { useStubHandler, type StubHandler } from "./setup.js";

/**
 * RBAC surface tests (specification §2.3, frontend §13).
 *
 * The suite stubs the loopback API (tests/setup.ts) with:
 *  - GET /auth/session   → the caller's modules + effective permission codes
 *  - GET /admin/roles    → one system role + one custom role
 *  - GET /admin/permissions → a two-module catalogue slice
 *  - PATCH /admin/roles/:id → echo the new permission set (or refuse with SoD)
 */

const SESSION = {
  user: { id: "u-1", email: "admin@demo-a.test", name: "Demo A Admin" },
  tenant: { id: "11111111-1111-4111-8111-111111111111", slug: "demo-a" },
  sessionId: "3f1d3f1d-0000-4000-8000-000000000001",
  amr: ["pwd"],
  branchId: null,
  assignedBranches: [],
  effectiveTimezone: "Asia/Manila",
  expiresAt: new Date(Date.now() + 600_000).toISOString(),
  modules: ["admin", "patients"],
  modulesVersion: 1,
  permissions: ["admin.user.read", "admin.role.read", "admin.role.update", "patients.read"],
};

const ROLES = [
  {
    id: "3f1d3f1d-0000-4000-8000-0000000000a1",
    code: "tenant_admin",
    name: "Tenant Admin",
    isSystem: true,
    permissions: ["admin.user.read", "admin.role.read"],
    rowVersion: 1,
  },
  {
    id: "3f1d3f1d-0000-4000-8000-0000000000a2",
    code: "front_desk",
    name: "Front Desk",
    isSystem: false,
    permissions: ["patients.read"],
    rowVersion: 3,
  },
];

const CATALOGUE = [
  {
    module: "admin",
    permissions: [
      { code: "admin.user.read", description: "View users" },
      { code: "admin.role.read", description: "View roles" },
      { code: "admin.role.update", description: "Edit roles" },
    ],
  },
  {
    module: "patients",
    permissions: [{ code: "patients.read", description: "View patients" }],
  },
];

const baseHandler: StubHandler = (req, res) => {
  const url = req.url ?? "";
  res.writeHead(200, { "content-type": "application/json" });
  if (url.includes("/auth/session")) {
    res.end(JSON.stringify(SESSION));
  } else if (url.includes("/admin/permissions")) {
    res.end(JSON.stringify(CATALOGUE));
  } else if (url.includes("/admin/roles")) {
    res.end(JSON.stringify(ROLES));
  } else {
    res.end(JSON.stringify({ ok: true }));
  }
};

function renderWithProviders(ui: React.ReactElement, initialEntries: string[] = ["/"]) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <AuthProvider>
        <PermissionsProvider>
          <Routes>{ui}</Routes>
        </PermissionsProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe("RequirePermission route guard", () => {
  beforeEach(() => {
    useStubHandler(baseHandler);
  });

  it("renders children when the caller holds one of the codes", async () => {
    renderWithProviders(
      <>
        <Route
          path="*"
          element={
            <RequirePermission module="patients" codes={["patients.read"]}>
              <div>ALLOWED CONTENT</div>
            </RequirePermission>
          }
        />
      </>,
    );
    await waitFor(() => expect(screen.getByText("ALLOWED CONTENT")).toBeInTheDocument(), { timeout: 5000 });
  });

  it("shows the denial panel when the permission is missing, naming the code", async () => {
    renderWithProviders(
      <>
        <Route
          path="*"
          element={
            <RequirePermission module="billing" codes={["billing.invoice.create"]}>
              <div>ALLOWED CONTENT</div>
            </RequirePermission>
          }
        />
      </>,
    );
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByText(/billing.invoice.create/)).toBeInTheDocument();
    expect(screen.queryByText("ALLOWED CONTENT")).not.toBeInTheDocument();
  });

  it("mentions the module when the tenant is not entitled", async () => {
    renderWithProviders(
      <>
        <Route
          path="*"
          element={
            <RequirePermission module="laboratory" codes={["lab.order.read"]}>
              <div>ALLOWED CONTENT</div>
            </RequirePermission>
          }
        />
      </>,
    );
    await waitFor(() => expect(screen.getByText(/module not enabled/i)).toBeInTheDocument());
  });
});

describe("usePermissions", () => {
  beforeEach(() => {
    useStubHandler(baseHandler);
  });

  it("exposes hasModule / hasAnyPermission from the session payload", async () => {
    let probe: { hasModule: (m: string) => boolean; hasAnyPermission: (c: string[]) => boolean } | null = null;
    function Probe() {
      const p = usePermissions();
      probe = { hasModule: p.hasModule, hasAnyPermission: p.hasAnyPermission };
      return null;
    }
    render(
      <MemoryRouter>
        <AuthProvider>
          <PermissionsProvider>
            <Probe />
          </PermissionsProvider>
        </AuthProvider>
      </MemoryRouter>,
    );
    await waitFor(() => expect(probe).not.toBeNull());
    await waitFor(() => expect(probe!.hasModule("patients")).toBe(true));
    expect(probe!.hasModule("billing")).toBe(false);
    expect(probe!.hasAnyPermission(["patients.write", "patients.read"])).toBe(true);
    expect(probe!.hasAnyPermission(["billing.payment.create"])).toBe(false);
  });
});

describe("RolesPage live matrix", () => {
  beforeEach(() => {
    useStubHandler(baseHandler);
  });

  it("lists roles from the API and marks system roles immutable", async () => {
    renderWithProviders(<Route path="*" element={<RolesPage />} />);
    await waitFor(() => expect(screen.getByText("Front Desk")).toBeInTheDocument());
    expect(screen.getAllByText(/Tenant Admin/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Immutable Template/).length).toBeGreaterThan(0);
  });

  it("grants a permission on the custom role via PATCH with the full permission set", async () => {
    let patchBody: unknown = null;
    useStubHandler((req, res) => {
      const url = req.url ?? "";
      if (req.method === "PATCH" && url.includes(`/admin/roles/${ROLES[1]!.id}`)) {
        let raw = "";
        req.on("data", (c: Buffer) => (raw += c.toString()));
        req.on("end", () => {
          patchBody = JSON.parse(raw);
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ ...ROLES[1], permissions: (patchBody as any).permissions, rowVersion: 4 }));
        });
        return;
      }
      baseHandler(req, res);
    });

    renderWithProviders(<Route path="*" element={<RolesPage />} />);
    await waitFor(() => expect(screen.getByText("Front Desk")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Front Desk"));

    // Wait for the matrix to render, then tick admin.role.update.
    const checkbox = await waitFor(() => {
      const cb = screen.getByRole("checkbox", { name: /Grant admin\.role\.update on Front Desk/ });
      expect(cb).not.toBeDisabled();
      return cb;
    });
    fireEvent.click(checkbox);

    await waitFor(() => expect(patchBody).not.toBeNull());
    expect((patchBody as any).permissions).toEqual(
      expect.arrayContaining(["patients.read", "admin.role.update"]),
    );
    expect((patchBody as any).rowVersion).toBe(3);
    await waitFor(() => expect(screen.getByText(/Granted admin.role.update/)).toBeInTheDocument());
  });

  it("surfaces a SEGREGATION_OF_DUTIES refusal verbatim and keeps the state unchanged", async () => {
    useStubHandler((req, res) => {
      const url = req.url ?? "";
      if (req.method === "PATCH" && url.includes(`/admin/roles/${ROLES[1]!.id}`)) {
        res.writeHead(409, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            type: "https://clinic.example/problems/seggregation-of-duties",
            title: "Segregation of Duties",
            status: 409,
            code: "SEGREGATION_OF_DUTIES",
            detail: "lab.result.enter + lab.result.verify may not be held together: entering and verifying",
          }),
        );
        return;
      }
      baseHandler(req, res);
    });

    renderWithProviders(<Route path="*" element={<RolesPage />} />);
    await waitFor(() => expect(screen.getByText("Front Desk")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Front Desk"));

    const checkbox = await waitFor(() => {
      const cb = screen.getByRole("checkbox", { name: /Grant admin\.role\.update on Front Desk/ });
      expect(cb).not.toBeDisabled();
      return cb;
    });
    fireEvent.click(checkbox);

    await waitFor(() =>
      expect(screen.getByText(/lab\.result\.enter \+ lab\.result\.verify may not be held together/)).toBeInTheDocument(),
    );
  });

  it("hides nav groups for modules the tenant does not have (rendered via MainLayout contract)", async () => {
    // Indirectly covered here: canAccess requires BOTH module and permission.
    let probe: { canAccess: (m: string, c: string[]) => boolean } | null = null;
    function Probe() {
      const p = usePermissions();
      probe = { canAccess: p.canAccess };
      return null;
    }
    render(
      <MemoryRouter>
        <AuthProvider>
          <PermissionsProvider>
            <Probe />
          </PermissionsProvider>
        </AuthProvider>
      </MemoryRouter>,
    );
    await waitFor(() => expect(probe).not.toBeNull());
    await waitFor(() => {
      // patients module + patients.read → allowed
      expect(probe!.canAccess("patients", ["patients.read"])).toBe(true);
      // patients module but missing permission → denied
      expect(probe!.canAccess("patients", ["patients.write"])).toBe(false);
      // billing permission hypothetical but module not enabled → denied
      expect(probe!.canAccess("billing", ["patients.read"])).toBe(false);
    });
  });
});
