import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router";
import { beforeEach, describe, expect, it } from "vitest";
import { AuthProvider } from "../src/shared/auth/AuthContext.js";
import { PermissionsProvider } from "../src/shared/auth/PermissionsContext.js";
import { StepUpProvider } from "../src/shared/auth/StepUpContext.js";
import { CreateUserPage } from "../src/features/admin/CreateUserPage.js";
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
  modules: ["admin"],
  modulesVersion: 1,
  permissions: [
    "admin.user.read",
    "admin.user.create",
    "admin.user.update",
    "admin.user.deactivate",
    "admin.user.reset",
    "admin.role.read",
    "admin.branch.read",
  ],
};

const ROLES = [
  {
    id: "3f1d3f1d-0000-4000-8000-0000000000a1",
    code: "receptionist",
    name: "Receptionist",
    isSystem: true,
    permissions: ["patient.record.read"],
    rowVersion: 1,
  },
  {
    id: "3f1d3f1d-0000-4000-8000-0000000000a2",
    code: "doctor",
    name: "Doctor",
    isSystem: true,
    permissions: ["patient.record.read", "clinical.visit.create"],
    rowVersion: 1,
  },
];

const BRANCHES = [
  { id: "branch-uuid-1", name: "Main Clinic" },
  { id: "branch-uuid-2", name: "Makati Branch" },
];

function readBody(req: import("node:http").IncomingMessage): Promise<unknown> {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (c: Buffer) => (raw += c.toString()));
    req.on("end", () => resolve(raw.length ? JSON.parse(raw) : {}));
  });
}

const baseHandler: StubHandler = (req, res) => {
  const url = req.url ?? "";
  res.writeHead(200, { "content-type": "application/json" });
  if (url.includes("/auth/session")) res.end(JSON.stringify(SESSION));
  else if (url.includes("/admin/roles")) res.end(JSON.stringify(ROLES));
  else if (url.includes("/admin/branches")) res.end(JSON.stringify({ branches: BRANCHES }));
  else if (url.includes("/admin/users")) res.end(JSON.stringify([]));
  else res.end(JSON.stringify({ ok: true }));
};

function renderCreateUserPage() {
  return render(
    <MemoryRouter initialEntries={["/admin/users/new"]}>
      <AuthProvider>
        <PermissionsProvider>
          <StepUpProvider>
            <CreateUserPage />
          </StepUpProvider>
        </PermissionsProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe("CreateUserPage CRUD & Navigation", () => {
  beforeEach(() => {
    useStubHandler(baseHandler);
  });

  it("renders Create Staff User link in MainLayout navigation under Tenant Administration", async () => {
    render(
      <MemoryRouter initialEntries={["/dashboard"]}>
        <AuthProvider>
          <PermissionsProvider>
            <MainLayout />
          </PermissionsProvider>
        </AuthProvider>
      </MemoryRouter>,
    );

    const navLink = await screen.findByRole("link", { name: /Create Staff User/i });
    expect(navLink).toBeInTheDocument();
    expect(navLink.getAttribute("href")).toBe("/admin/users/new");
  });

  it("renders the Create Staff User form with all fields and options", async () => {
    renderCreateUserPage();

    expect(await screen.findByRole("heading", { name: "Create Staff User" })).toBeInTheDocument();
    expect(screen.getByLabelText(/Full Name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Work Email Address/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Primary Clinic Branch/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Direct Activation/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Send Invitation/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Initial Temporary Password/i)).toBeInTheDocument();
    expect(await screen.findByText("Receptionist")).toBeInTheDocument();
    expect(screen.getByText("Doctor")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Create Staff User/i })).toBeInTheDocument();
  });

  it("creates a staff user in DIRECT mode with assigned branch and initial password", async () => {
    let createdPayload: unknown = null;
    let branchPayload: unknown = null;
    let passwordPayload: unknown = null;

    useStubHandler((req, res) => {
      const url = req.url ?? "";
      if (req.method === "POST" && url.endsWith("/admin/users")) {
        void readBody(req).then((body) => {
          createdPayload = body;
          res.writeHead(200, { "content-type": "application/json" });
          res.end(
            JSON.stringify({
              id: "new-user-uuid-1",
              name: (body as { name: string }).name,
              email: (body as { email: string }).email,
              status: "ACTIVE",
              mfaEnabled: false,
              roles: [{ id: ROLES[0]!.id, code: "receptionist", name: "Receptionist" }],
              branches: [{ id: "branch-uuid-1", isDefault: true }],
              lastLoginAt: null,
              rowVersion: 1,
            }),
          );
        });
        return;
      }
      if (req.method === "PUT" && url.includes("/admin/users/new-user-uuid-1/branches")) {
        void readBody(req).then((body) => {
          branchPayload = body;
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ ok: true }));
        });
        return;
      }
      if (req.method === "POST" && url.includes("/admin/users/new-user-uuid-1/force-password-reset")) {
        void readBody(req).then((body) => {
          passwordPayload = body;
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ ok: true }));
        });
        return;
      }
      baseHandler(req, res);
    });

    renderCreateUserPage();

    await screen.findByText("Receptionist");
    fireEvent.change(screen.getByLabelText(/Full Name/i), { target: { value: "Dr. Ana Reyes" } });
    fireEvent.change(screen.getByLabelText(/Work Email Address/i), { target: { value: "ana.reyes@demo-a.test" } });
    fireEvent.change(screen.getByLabelText(/Primary Clinic Branch/i), { target: { value: "branch-uuid-1" } });
    fireEvent.change(screen.getByLabelText(/Initial Temporary Password/i), { target: { value: "SecurePass!2026" } });
    fireEvent.click(screen.getByLabelText("Receptionist"));

    const submitBtn = screen.getByRole("button", { name: /Create Staff User/i });
    await waitFor(() => expect(submitBtn).not.toBeDisabled());
    fireEvent.click(submitBtn);

    expect(await screen.findByText("Staff Member Successfully Created!")).toBeInTheDocument();
    expect(screen.getAllByText("Dr. Ana Reyes").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/ana\.reyes@demo-a\.test/).length).toBeGreaterThan(0);
    expect(screen.getByDisplayValue("SecurePass!2026")).toBeInTheDocument();

    expect(createdPayload).toMatchObject({
      name: "Dr. Ana Reyes",
      email: "ana.reyes@demo-a.test",
      roleIds: [ROLES[0]!.id],
    });
    expect(branchPayload).toMatchObject({
      branchIds: ["branch-uuid-1"],
      defaultBranchId: "branch-uuid-1",
    });
    expect(passwordPayload).toMatchObject({
      newPassword: "SecurePass!2026",
    });
  });

  it("creates a staff user in INVITE mode without calling password reset", async () => {
    let createdPayload: unknown = null;
    let passwordEndpointCalled = false;

    useStubHandler((req, res) => {
      const url = req.url ?? "";
      if (req.method === "POST" && url.endsWith("/admin/users")) {
        void readBody(req).then((body) => {
          createdPayload = body;
          res.writeHead(200, { "content-type": "application/json" });
          res.end(
            JSON.stringify({
              id: "new-user-uuid-2",
              name: (body as { name: string }).name,
              email: (body as { email: string }).email,
              status: "INVITED",
              mfaEnabled: false,
              roles: [],
              branches: [],
              lastLoginAt: null,
              rowVersion: 1,
            }),
          );
        });
        return;
      }
      if (url.includes("force-password-reset")) {
        passwordEndpointCalled = true;
      }
      baseHandler(req, res);
    });

    renderCreateUserPage();

    await screen.findByText("Receptionist");
    fireEvent.click(screen.getByLabelText(/Send Invitation/i));
    fireEvent.change(screen.getByLabelText(/Full Name/i), { target: { value: "Invite Only User" } });
    fireEvent.change(screen.getByLabelText(/Work Email Address/i), { target: { value: "invite@demo-a.test" } });

    const submitBtn = screen.getByRole("button", { name: /Create Staff User/i });
    await waitFor(() => expect(submitBtn).not.toBeDisabled());
    fireEvent.click(submitBtn);

    expect(await screen.findByText("Staff Member Successfully Created!")).toBeInTheDocument();
    expect(screen.getAllByText("INVITED").length).toBeGreaterThan(0);
    expect(passwordEndpointCalled).toBe(false);
    expect(createdPayload).toMatchObject({
      name: "Invite Only User",
      email: "invite@demo-a.test",
    });
  });

  it("displays conflict error from server when email is duplicate", async () => {
    useStubHandler((req, res) => {
      const url = req.url ?? "";
      if (req.method === "POST" && url.endsWith("/admin/users")) {
        res.writeHead(409, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            type: "about:blank",
            title: "Conflict",
            status: 409,
            code: "CONFLICT",
            detail: "email already exists in this clinic",
          }),
        );
        return;
      }
      baseHandler(req, res);
    });

    renderCreateUserPage();

    await screen.findByText("Receptionist");
    fireEvent.change(screen.getByLabelText(/Full Name/i), { target: { value: "Duplicate User" } });
    fireEvent.change(screen.getByLabelText(/Work Email Address/i), { target: { value: "existing@demo-a.test" } });

    const submitBtn = screen.getByRole("button", { name: /Create Staff User/i });
    await waitFor(() => expect(submitBtn).not.toBeDisabled());
    fireEvent.click(submitBtn);

    expect(await screen.findByText(/email already exists in this clinic/i)).toBeInTheDocument();
  });
});
