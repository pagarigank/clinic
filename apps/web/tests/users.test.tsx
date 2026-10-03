import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it } from "vitest";
import { AuthProvider } from "../src/shared/auth/AuthContext.js";
import { PermissionsProvider } from "../src/shared/auth/PermissionsContext.js";
import { StepUpProvider } from "../src/shared/auth/StepUpContext.js";
import { UsersPage } from "../src/features/admin/UsersPage.js";
import { useStubHandler, type StubHandler } from "./setup.js";

/**
 * Staff & User Directory against the admin user CRUD (specification §18.2,
 * lines 1029–1035). The loopback stub (tests/setup.ts) serves:
 *  - GET /auth/session        → modules + effective permission codes
 *  - GET /admin/users         → one active user (no MFA)
 *  - GET /admin/roles         → two roles for the assignment editor
 *  - POST /admin/users        → echo invite (or duplicate conflict)
 *  - PUT /admin/users/:id/roles → echo assignment
 *  - POST /admin/users/:id/deactivate → echo lifecycle (or 401 step-up first)
 */

const SESSION = {
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
  permissions: ["admin.user.read", "admin.user.create", "admin.user.update", "admin.user.deactivate", "admin.user.reset", "admin.role.read"],
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

const USERS = [
  {
    id: "3f1d3f1d-0000-4000-8000-0000000000b1",
    email: "nurse.reyes@demo-a.test",
    name: "Carmela Reyes, RN",
    status: "ACTIVE",
    mfaEnabled: false,
    roles: [{ id: ROLES[0]!.id, code: "receptionist", name: "Receptionist" }],
    branches: [],
    lastLoginAt: null,
    rowVersion: 2,
  },
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
  else if (url.includes("/admin/users")) res.end(JSON.stringify(USERS));
  else res.end(JSON.stringify({ ok: true }));
};

function renderPage() {
  return render(
    <MemoryRouter>
      <AuthProvider>
        <PermissionsProvider>
          <StepUpProvider>
            <UsersPage />
          </StepUpProvider>
        </PermissionsProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe("UsersPage against the admin user CRUD (specification §18.2)", () => {
  beforeEach(() => {
    useStubHandler(baseHandler);
  });

  it("lists users with roles and MFA state from GET /admin/users", async () => {
    renderPage();
    expect(await screen.findByText("Carmela Reyes, RN")).toBeInTheDocument();
    expect(screen.getByText("Receptionist")).toBeInTheDocument();
    expect(screen.getAllByText(/MFA Pending/i).length).toBeGreaterThan(0);
  });

  it("invites a user via POST /admin/users with the ticked role ids", async () => {
    let postBody: unknown = null;
    useStubHandler((req, res) => {
      const url = req.url ?? "";
      if (req.method === "POST" && url.includes("/admin/users")) {
        void readBody(req).then((body) => {
          postBody = body;
          res.writeHead(200, { "content-type": "application/json" });
          res.end(
            JSON.stringify({
              ...USERS[0],
              id: "3f1d3f1d-0000-4000-8000-0000000000b9",
              name: (body as { name: string }).name,
              email: (body as { email: string }).email,
              status: "INVITED",
            }),
          );
        });
        return;
      }
      baseHandler(req, res);
    });

    renderPage();
    await screen.findByText("Carmela Reyes, RN");
    await waitFor(() => expect(screen.getByRole("button", { name: /Invite Staff User/i })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: /Invite Staff User/i }));

    fireEvent.change(screen.getByLabelText("Full name"), { target: { value: "New Nurse" } });
    fireEvent.change(screen.getByLabelText("Work email"), { target: { value: "new.nurse@demo-a.test" } });
    fireEvent.click(screen.getByLabelText(/Receptionist \(receptionist\)/));
    fireEvent.click(screen.getByRole("button", { name: /Create invitation/i }));

    await waitFor(() => expect(screen.getByText(/invited as INVITED/i)).toBeInTheDocument());
    expect(postBody).toMatchObject({
      email: "new.nurse@demo-a.test",
      name: "New Nurse",
      roleIds: [ROLES[0]!.id],
    });
  });

  it("refuses a duplicate invite with the server's CONFLICT detail", async () => {
    useStubHandler((req, res) => {
      const url = req.url ?? "";
      if (req.method === "POST" && url.includes("/admin/users")) {
        void readBody(req).then(() => {
          res.writeHead(409, { "content-type": "application/json" });
          res.end(
            JSON.stringify({ type: "about:blank", title: "Conflict", status: 409, code: "CONFLICT", detail: "email already exists in this clinic" }),
          );
        });
        return;
      }
      baseHandler(req, res);
    });

    renderPage();
    await screen.findByText("Carmela Reyes, RN");
    await waitFor(() => expect(screen.getByRole("button", { name: /Invite Staff User/i })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: /Invite Staff User/i }));
    fireEvent.change(screen.getByLabelText("Full name"), { target: { value: "Dup" } });
    fireEvent.change(screen.getByLabelText("Work email"), { target: { value: "admin@demo-a.test" } });
    fireEvent.click(screen.getByRole("button", { name: /Create invitation/i }));

    expect(await screen.findByText(/email already exists in this clinic/i)).toBeInTheDocument();
  });

  it("assigns roles through PUT /admin/users/:id/roles after the step-up challenge", async () => {
    let putBody: unknown = null;
    useStubHandler((req, res) => {
      const url = req.url ?? "";
      if (req.method === "PUT" && url.includes("/admin/users")) {
        if (!req.headers["x-step-up-token"]) {
          res.writeHead(401, { "content-type": "application/json" });
          res.end(
            JSON.stringify({ type: "about:blank", title: "Step-up Authentication Required", status: 401, code: "STEP_UP_REQUIRED" }),
          );
          return;
        }
        void readBody(req).then((body) => {
          putBody = body;
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ assigned: (body as { roleIds: string[] }).roleIds.length }));
        });
        return;
      }
      if (url.includes("/auth/step-up")) {
        void readBody(req).then(() => {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ stepUpToken: "step-up-token", accessToken: "step-up-token" }));
        });
        return;
      }
      baseHandler(req, res);
    });

    renderPage();
    await screen.findByText("Carmela Reyes, RN");
    const rolesBtn = await screen.findByRole("button", { name: "Roles" });
    fireEvent.click(rolesBtn);
    fireEvent.click(screen.getByLabelText(/Doctor \(doctor\)/));

    // First attempt is refused with 401 STEP_UP_REQUIRED.
    fireEvent.click(screen.getByRole("button", { name: /Save roles/i }));
    expect(await screen.findByText(/high-risk action/i)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Passphrase"), { target: { value: "DemoPassw0rd!2026" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    // Retry succeeds after the step-up grant.
    await waitFor(() => expect(screen.getByText(/Roles updated for Carmela Reyes, RN/i)).toBeInTheDocument());
    expect(putBody).toMatchObject({ roleIds: [ROLES[0]!.id, ROLES[1]!.id], branchId: null });
  });

  it("deactivates a user through the step-up protected lifecycle endpoint", async () => {
    let deactivateCalled = 0;
    useStubHandler((req, res) => {
      const url = req.url ?? "";
      if (req.method === "POST" && url.includes("/deactivate")) {
        deactivateCalled += 1;
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ deactivated: true }));
        return;
      }
      baseHandler(req, res);
    });

    renderPage();
    await screen.findByText("Carmela Reyes, RN");
    fireEvent.click(await screen.findByRole("button", { name: /Deactivate/i }));
    await waitFor(() => expect(screen.getByText(/deactivate completed for Carmela Reyes, RN/i)).toBeInTheDocument());
    expect(deactivateCalled).toBe(1);
  });

  it("hides mutation buttons when the caller lacks the matching admin.user.* codes", async () => {
    useStubHandler((req, res) => {
      const url = req.url ?? "";
      res.writeHead(200, { "content-type": "application/json" });
      if (url.includes("/auth/session")) {
        res.end(JSON.stringify({ ...SESSION, permissions: ["admin.user.read"] }));
      } else if (url.includes("/admin/roles")) {
        res.end(JSON.stringify(ROLES));
      } else if (url.includes("/admin/users")) {
        res.end(JSON.stringify(USERS));
      } else {
        res.end(JSON.stringify({ ok: true }));
      }
    });

    renderPage();
    await screen.findByText("Carmela Reyes, RN");
    expect(screen.queryByRole("button", { name: /Invite Staff User/i })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Roles" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Deactivate/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Reset password/i })).not.toBeInTheDocument();
  });
});
