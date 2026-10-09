import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useLocation } from "react-router";
import { SearchProvider, useSearchContext, CommandPalette, type PatientRef } from "../src/shared/search/CommandPalette.js";
import { AuthProvider } from "../src/shared/auth/AuthContext.js";
import { PermissionsProvider, usePermissions } from "../src/shared/auth/PermissionsContext.js";
import { useStubHandler, type StubHandler } from "./setup.js";

/**
 * Command palette — todo.md §2.3 (global patient search, recents, deep links)
 * per frontend.md §9. Deep links carry the patient id only (`/patients?focus=
 * <id>`); recents live in memory, never in storage (frontend §20). Navigation
 * destinations are entitlement/permission-filtered (frontend §7.2).
 */
function LocationProbe({ onChange }: { onChange: (path: string) => void }) {
  const location = useLocation();
  onChange(location.pathname + location.search);
  return null;
}

function RecentsSeeder({ patient }: { patient: PatientRef }) {
  const { rememberPatient } = useSearchContext();
  return (
    <button type="button" onClick={() => rememberPatient(patient)}>
      seed-recent
    </button>
  );
}

function PermissionsProbe() {
  const { permissions } = usePermissions();
  return <span data-testid="perm-count">{permissions.size}</span>;
}

function sessionFor(modules: string[], permissions: string[]) {
  return {
    user: { id: "u-1", email: "doctor@demo-a.test", name: "Test Doctor" },
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

function renderPalette() {
  return render(
    <AuthProvider>
      <PermissionsProvider>
        <SearchProvider>
          <MemoryRouter initialEntries={["/dashboard"]}>
            <PermissionsProbe />
            <CommandPalette />
          </MemoryRouter>
        </SearchProvider>
      </PermissionsProvider>
    </AuthProvider>,
  );
}

describe("Command palette (todo §2.3, frontend §9)", () => {
  it("opens with Ctrl+K, filters navigation, and deep-links on Enter", async () => {
    useStubHandler(
      stubSession(sessionFor(["patients", "clinical"], ["patient.record.read", "clinical.visit.read"])),
    );
    let currentPath = "";
    render(
      <AuthProvider>
        <PermissionsProvider>
          <SearchProvider>
            <MemoryRouter initialEntries={["/dashboard"]}>
              <LocationProbe onChange={(p) => (currentPath = p)} />
              <PermissionsProbe />
              <CommandPalette />
              <Routes>
                <Route path="/dashboard" element={<div>Dashboard</div>} />
                <Route path="/patients/duplicates" element={<div>Duplicates</div>} />
              </Routes>
            </MemoryRouter>
          </SearchProvider>
        </PermissionsProvider>
      </AuthProvider>,
    );

    // Wait for the async /auth/session payload so gating has settled before we
    // assert on destinations.
    await waitFor(() => {
      expect(Number(screen.getByTestId("perm-count").textContent)).toBeGreaterThan(0);
    });

    expect(screen.queryByRole("dialog", { name: /Global search/i })).not.toBeInTheDocument();
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true }));
    });

    const dialog = screen.getByRole("dialog", { name: /Global search/i });
    expect(dialog).toBeInTheDocument();

    const input = screen.getByLabelText(/Search patients and pages/i);
    await act(async () => {
      fireEvent.change(input, { target: { value: "dup" } });
    });
    expect(screen.getByText(/Duplicate Candidates \(JOB-22\)/i)).toBeInTheDocument();

    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });
    expect(currentPath).toBe("/patients/duplicates");
  });

  it("skips navigation destinations the caller has no entitlement or permission for", async () => {
    // A clinical-only doctor: patients + clinical entitled, no supply/admin.
    useStubHandler(
      stubSession(sessionFor(["patients", "clinical"], ["patient.record.read", "clinical.visit.read"])),
    );
    renderPalette();

    await waitFor(() => {
      expect(Number(screen.getByTestId("perm-count").textContent)).toBeGreaterThan(0);
    });
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true }));
    });

    const input = screen.getByLabelText(/Search patients and pages/i);
    await act(async () => {
      fireEvent.change(input, { target: { value: "s" } });
    });

    // Permitted destinations remain; supply/admin/platform never surface.
    expect(screen.getByText("Consultations & Chart")).toBeInTheDocument();
    expect(screen.getByText("Patient Registry")).toBeInTheDocument();
    expect(screen.queryByText("Stock Explorer")).not.toBeInTheDocument();
    expect(screen.queryByText("Staff & Users")).not.toBeInTheDocument();
    expect(screen.queryByText("Platform Console")).not.toBeInTheDocument();
  });

  it("does not surface workbenches for a doctor holding only cross-module read/order grants", async () => {
    // pharmacy.rx.read previously leaked the pharmacy destination via the
    // namespace-prefix rule; the operative permission is pharmacy.dispense.read.
    useStubHandler(
      stubSession(
        sessionFor(
          ["patients", "clinical", "pharmacy", "laboratory"],
          ["patient.record.read", "clinical.visit.read", "pharmacy.rx.read", "lab.order.read", "lab.report.read"],
        ),
      ),
    );
    renderPalette();

    await waitFor(() => {
      expect(Number(screen.getByTestId("perm-count").textContent)).toBeGreaterThan(0);
    });
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true }));
    });

    const input = screen.getByLabelText(/Search patients and pages/i);
    await act(async () => {
      fireEvent.change(input, { target: { value: "pharmacy" } });
    });
    expect(screen.queryByText("Pharmacy Dispense Workbench")).not.toBeInTheDocument();
  });

  it("lists in-memory recents before typing and navigates to the id-only deep link", async () => {
    let currentPath = "";
    const patient: PatientRef = { id: "p1000000-0000-4000-8000-000000000001", name: "Santos, Maria Elena", patientNo: "PAT-2026-0001" };
    render(
      <SearchProvider>
        <MemoryRouter initialEntries={["/dashboard"]}>
          <LocationProbe onChange={(p) => (currentPath = p)} />
          <RecentsSeeder patient={patient} />
          <CommandPalette />
          <Routes>
            <Route path="/dashboard" element={<div>Dashboard</div>} />
            <Route path="/patients" element={<div>Registry</div>} />
          </Routes>
        </MemoryRouter>
      </SearchProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: /seed-recent/i }));
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true }));
    });

    expect(screen.getByText("Santos, Maria Elena")).toBeInTheDocument();
    expect(screen.getByText(/Recent · PAT-2026-0001/i)).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByText("Santos, Maria Elena"));
    expect(currentPath).toBe(`/patients?focus=${patient.id}`);
  });

  it("Esc closes without acting", async () => {
    render(
      <SearchProvider>
        <MemoryRouter>
          <CommandPalette />
        </MemoryRouter>
      </SearchProvider>,
    );
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true }));
    });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
