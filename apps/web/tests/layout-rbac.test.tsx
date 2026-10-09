import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";
import { AuthProvider } from "../src/shared/auth/AuthContext.js";
import { PermissionsProvider } from "../src/shared/auth/PermissionsContext.js";
import { MainLayout } from "../src/shell/MainLayout.js";
import { useStubHandler, type StubHandler } from "./setup.js";

/**
 * Sidebar RBAC gating (architecture §5.3, specification §2.3, frontend §8):
 * a module group renders only when the tenant is entitled to the module AND the
 * caller holds at least one permission in that module's namespace, so a
 * clinical-only doctor never sees the pharmacy or laboratory rails.
 */

function sessionFor(modules: string[], permissions: string[]) {
  return {
    user: { id: "u-1", email: "user@demo-a.test", name: "Test User" },
    tenant: { id: "11111111-1111-4111-8111-111111111111", slug: "demo-a" },
    sessionId: "3f1d3f1d-0000-4000-8000-000000000001",
    amr: ["pwd"],
    branchId: null,
    assignedBranches: [],
    effectiveTimezone: "Asia/Manila",
    expiresAt: new Date(Date.now() + 600_000).toISOString(),
    modules,
    modulesVersion: 1,
    permissions,
  };
}

function stubSession(session: unknown): StubHandler {
  return (req, res) => {
    const url = req.url ?? "";
    res.writeHead(200, { "content-type": "application/json" });
    if (url.includes("/auth/session")) res.end(JSON.stringify(session));
    else res.end(JSON.stringify({ ok: true }));
  };
}

function renderShell() {
  return render(
    <MemoryRouter initialEntries={["/dashboard"]}>
      <AuthProvider>
        <PermissionsProvider>
          <MainLayout />
        </PermissionsProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe("MainLayout RBAC nav gating", () => {
  it("hides entitled module groups the caller holds no permission for", async () => {
    // Tenant owns four modules; the role is clinical-only.
    useStubHandler(
      stubSession(
        sessionFor(
          ["patients", "clinical", "pharmacy", "laboratory"],
          ["clinical.consultation.read"],
        ),
      ),
    );
    renderShell();

    // waitFor the settled filtered state: the shell renders the full nav until
    // the async session + permissions resolve, so assert both the visible and
    // hidden groups together (retries until gating has applied).
    await waitFor(() => {
      expect(screen.getByText("Consultations & Chart")).toBeInTheDocument();
      expect(screen.queryByText("Dispense Workbench")).not.toBeInTheDocument(); // pharmacy
    });

    // Clinical + shared Workspace/System remain visible.
    expect(screen.getByText("Appointments")).toBeInTheDocument();
    expect(screen.getByText("Dashboard")).toBeInTheDocument();
    expect(screen.getByText("System Health")).toBeInTheDocument();
    expect(screen.queryByText("Lab Workbench")).not.toBeInTheDocument(); // laboratory
  });

  it("shows the pharmacy group to a pharmacist and hides clinical", async () => {
    useStubHandler(
      stubSession(sessionFor(["patients", "clinical", "pharmacy"], ["pharmacy.rx.verify"])),
    );
    renderShell();

    await waitFor(() => {
      expect(screen.getByText("Dispense Workbench")).toBeInTheDocument();
      expect(screen.queryByText("Consultations & Chart")).not.toBeInTheDocument();
    });
  });

  it("still hides a group when the tenant is not entitled, regardless of permissions", async () => {
    useStubHandler(stubSession(sessionFor(["patients"], ["pharmacy.rx.verify"])));
    renderShell();

    await waitFor(() => {
      expect(screen.getByText("Dashboard")).toBeInTheDocument();
      expect(screen.queryByText("Dispense Workbench")).not.toBeInTheDocument();
    });
  });
});
