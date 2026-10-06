import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router";
import { beforeEach, describe, expect, it } from "vitest";
import { AuthProvider } from "../src/shared/auth/AuthContext.js";
import { PermissionsProvider } from "../src/shared/auth/PermissionsContext.js";
import { StepUpProvider } from "../src/shared/auth/StepUpContext.js";
import { Icd10ManagementPage } from "../src/features/admin/Icd10ManagementPage.js";
import { SettingsPage } from "../src/features/admin/SettingsPage.js";
import { MainLayout } from "../src/shell/MainLayout.js";
import { useStubHandler, type StubHandler } from "./setup.js";

const SESSION = {
  user: { id: "3f1d3f1d-0000-4000-8000-0000000000e1", email: "admin@demo-a.test", name: "Demo A Admin" },
  tenant: { id: "11111111-1111-4111-8111-111111111111", slug: "demo-a" },
  sessionId: "3f1d3f1d-0000-4000-8000-0000000000e2",
  amr: ["pwd"],
  branchId: "branch-uuid-1",
  assignedBranches: [{ id: "branch-uuid-1", name: "Main Clinic" }],
  effectiveTimezone: "Asia/Manila",
  expiresAt: new Date(Date.now() + 600_000).toISOString(),
  modules: ["admin", "clinical"],
  modulesVersion: 1,
  permissions: [
    "admin.settings.read",
    "admin.settings.update",
    "reference.read",
    "clinical.visit.create",
  ],
};

function readBody(req: import("node:http").IncomingMessage): Promise<unknown> {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : null);
      } catch {
        resolve(null);
      }
    });
  });
}

function renderWithProviders(ui: React.ReactElement, initialPath = "/admin/icd10") {
  return render(
    <AuthProvider>
      <PermissionsProvider>
        <StepUpProvider>
          <MemoryRouter initialEntries={[initialPath]}>{ui}</MemoryRouter>
        </StepUpProvider>
      </PermissionsProvider>
    </AuthProvider>,
  );
}

describe("ICD-10 Management CRUD & Clinical Wiring Suite", () => {
  let icdStore: Array<{ code: string; description: string }> = [];

  beforeEach(() => {
    icdStore = [
      { code: "J06.9", description: "Acute upper respiratory infection, unspecified" },
      { code: "I10", description: "Essential (primary) hypertension" },
      { code: "E11.9", description: "Type 2 diabetes mellitus without complications" },
    ];
  });

  const setupHandler = (): StubHandler => async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname;

    if (path === "/api/v1/auth/session") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(SESSION));
      return;
    }

    if (path === "/api/v1/reference/icd10") {
      if (req.method === "GET") {
        const q = url.searchParams.get("q")?.toLowerCase();
        let filtered = icdStore;
        if (q) {
          filtered = icdStore.filter(
            (i) => i.code.toLowerCase().includes(q) || i.description.toLowerCase().includes(q),
          );
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ data: filtered, total: filtered.length, limit: 100, offset: 0 }));
        return;
      }

      if (req.method === "POST") {
        const body = (await readBody(req)) as any;
        if (!body || !body.code || !body.description) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Missing fields" }));
          return;
        }
        const code = body.code.toUpperCase();
        if (icdStore.some((i) => i.code === code)) {
          res.writeHead(409, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ code: "CONFLICT", detail: `ICD-10 code "${code}" already exists.` }));
          return;
        }
        const created = { code, description: body.description };
        icdStore.push(created);
        res.writeHead(201, { "Content-Type": "application/json" });
        res.end(JSON.stringify(created));
        return;
      }
    }

    if (path.startsWith("/api/v1/reference/icd10/")) {
      const code = decodeURIComponent(path.replace("/api/v1/reference/icd10/", "")).toUpperCase();

      if (req.method === "PUT") {
        const body = (await readBody(req)) as any;
        const item = icdStore.find((i) => i.code === code);
        if (!item) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Not found" }));
          return;
        }
        item.description = body.description;
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(item));
        return;
      }

      if (req.method === "DELETE") {
        const idx = icdStore.findIndex((i) => i.code === code);
        if (idx === -1) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Not found" }));
          return;
        }
        icdStore.splice(idx, 1);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true, code }));
        return;
      }
    }

    if (path === "/api/v1/reference/icd10/seed-common" && req.method === "POST") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: true, inserted: 5, totalCommon: 45 }));
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  };

  it("renders the ICD-10 Management page and displays current codes", async () => {
    useStubHandler(setupHandler());

    renderWithProviders(<Icd10ManagementPage />);

    expect(await screen.findByText(/ICD-10 Diagnostic Codes Catalogue/i)).toBeInTheDocument();
    expect(await screen.findByText("J06.9")).toBeInTheDocument();
    expect(await screen.findByText("Essential (primary) hypertension")).toBeInTheDocument();
  });

  it("adds a new ICD-10 diagnostic code through modal form", async () => {
    useStubHandler(setupHandler());

    renderWithProviders(<Icd10ManagementPage />);
    await screen.findByText("J06.9");

    fireEvent.click(screen.getByRole("button", { name: /\+ Add ICD-10 Code/i }));
    expect(await screen.findByText("Add ICD-10 Diagnostic Code")).toBeInTheDocument();

    const codeInput = screen.getByLabelText(/ICD-10 Code \*/i);
    const descInput = screen.getByLabelText(/Clinical Description \/ Impression \*/i);

    fireEvent.change(codeInput, { target: { value: "A09" } });
    fireEvent.change(descInput, { target: { value: "Infectious gastroenteritis and colitis, unspecified" } });

    fireEvent.click(screen.getByRole("button", { name: /Save to Catalog/i }));

    await waitFor(() => {
      expect(screen.getByText("A09")).toBeInTheDocument();
      expect(screen.getByText("Infectious gastroenteritis and colitis, unspecified")).toBeInTheDocument();
    });
  });

  it("edits an existing ICD-10 code description", async () => {
    useStubHandler(setupHandler());

    renderWithProviders(<Icd10ManagementPage />);
    await screen.findByText("I10");

    const editBtns = await screen.findAllByRole("button", { name: /Edit/i });
    fireEvent.click(editBtns[1]!); // I10 edit button

    expect(await screen.findByText(/Edit ICD-10 Code: I10/i)).toBeInTheDocument();

    const descInput = screen.getByLabelText(/Clinical Description \/ Impression \*/i);
    fireEvent.change(descInput, { target: { value: "Primary systemic arterial hypertension" } });

    fireEvent.click(screen.getByRole("button", { name: /Update Description/i }));

    await waitFor(() => {
      expect(screen.getByText("Primary systemic arterial hypertension")).toBeInTheDocument();
    });
  });

  it("deletes an ICD-10 code with confirmation", async () => {
    useStubHandler(setupHandler());

    renderWithProviders(<Icd10ManagementPage />);
    await screen.findByText("E11.9");

    const deleteBtns = screen.getAllByRole("button", { name: "🗑️" });
    fireEvent.click(deleteBtns[2]!); // E11.9 delete button

    expect(await screen.findByText(/Delete ICD-10 Code/i)).toBeInTheDocument();
    expect(screen.getByText(/Are you sure you want to remove/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Confirm Delete/i }));

    await waitFor(() => {
      expect(screen.queryByText("E11.9")).not.toBeInTheDocument();
    });
  });

  it("includes ICD-10 Diagnoses navigation link in MainLayout and SettingsPage", async () => {
    useStubHandler(setupHandler());

    renderWithProviders(
      <Routes>
        <Route path="/admin" element={<MainLayout />}>
          <Route path="settings" element={<SettingsPage />} />
        </Route>
      </Routes>,
      "/admin/settings",
    );

    // Sidebar navigation
    expect(await screen.findByRole("link", { name: /ICD-10 Diagnoses/i })).toBeInTheDocument();

    // SettingsPage card link
    expect(await screen.findByText(/Clinical Master Data & ICD-10 Catalogue/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Manage ICD-10 Codes →/i })).toHaveAttribute("href", "/admin/icd10");
  });
});
