import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router";
import { beforeEach, describe, expect, it } from "vitest";
import { AuthProvider } from "../src/shared/auth/AuthContext.js";
import { PermissionsProvider } from "../src/shared/auth/PermissionsContext.js";
import { StepUpProvider } from "../src/shared/auth/StepUpContext.js";
import { EmployeesPage } from "../src/features/admin/EmployeesPage.js";
import { UsersPage } from "../src/features/admin/UsersPage.js";
import { MainLayout } from "../src/shell/MainLayout.js";
import { useStubHandler, type StubHandler } from "./setup.js";
import type { EmployeeWithUser, UserList } from "@clinic/contracts";

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

const EMPLOYEES: EmployeeWithUser[] = [
  {
    id: "emp-uuid-1",
    userId: "user-doc-1",
    employeeNo: "EMP-1001",
    jobTitle: "Attending Cardiologist",
    department: "Clinical Care",
    employmentType: "FULL_TIME",
    specialization: "Cardiology",
    prcLicenseNo: "PRC-123456",
    ptrNo: "PTR-789012",
    s2LicenseNo: "S2-345678",
    phone: "+639171112222",
    hireDate: "2024-01-15",
    emergencyContactName: "Maria Cruz",
    emergencyContactPhone: "+639173334444",
    emergencyContactRelationship: "Spouse",
    status: "ACTIVE",
    rowVersion: 1,
    userName: "Dr. Roberto Cruz",
    userEmail: "roberto.cruz@demo-a.test",
    userStatus: "ACTIVE",
    userRoles: ["Doctor", "Cardiologist"],
  },
  {
    id: "emp-uuid-2",
    userId: "user-nurse-1",
    employeeNo: "EMP-1002",
    jobTitle: "Senior Staff Nurse",
    department: "Nursing",
    employmentType: "PART_TIME",
    specialization: "Critical Care",
    prcLicenseNo: "PRC-654321",
    ptrNo: null,
    s2LicenseNo: null,
    phone: "+639185556666",
    hireDate: "2024-06-01",
    emergencyContactName: "Juan Reyes",
    emergencyContactPhone: "+639187778888",
    emergencyContactRelationship: "Brother",
    status: "ACTIVE",
    rowVersion: 2,
    userName: "Ana Reyes",
    userEmail: "ana.reyes@demo-a.test",
    userStatus: "ACTIVE",
    userRoles: ["Nurse"],
  },
];

const USERS: UserList[] = [
  {
    id: "user-doc-1",
    name: "Dr. Roberto Cruz",
    email: "roberto.cruz@demo-a.test",
    status: "ACTIVE",
    mfaEnabled: true,
    roles: [{ id: "role-1", code: "doctor", name: "Doctor" }],
    branches: [{ id: "branch-1", name: "Main Clinic", isDefault: true }],
    employee: EMPLOYEES[0],
    lastLoginAt: "2026-10-01T08:00:00Z",
    rowVersion: 1,
  },
  {
    id: "user-unlinked-1",
    name: "Carlos Santos",
    email: "carlos.santos@demo-a.test",
    status: "ACTIVE",
    mfaEnabled: false,
    roles: [{ id: "role-2", code: "receptionist", name: "Receptionist" }],
    branches: [],
    employee: null,
    lastLoginAt: null,
    rowVersion: 1,
  },
];

function readBody(req: import("node:http").IncomingMessage): Promise<unknown> {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (c: Buffer) => (raw += c.toString()));
    req.on("end", () => resolve(raw.length ? JSON.parse(raw) : {}));
  });
}

describe("Employee Information CRUD & Profile Linkage", () => {
  let putPayload: any = null;
  let deleteEndpointCalled = false;

  const baseHandler: StubHandler = async (req, res) => {
    const url = req.url ?? "";
    const method = req.method ?? "GET";

    res.writeHead(200, { "content-type": "application/json" });

    if (url.includes("/auth/session")) {
      res.end(JSON.stringify(SESSION));
    } else if (url.includes("/admin/employees") && method === "GET") {
      res.end(JSON.stringify(EMPLOYEES));
    } else if (url.includes("/admin/users") && method === "GET") {
      res.end(JSON.stringify(USERS));
    } else if (url.includes("/admin/roles")) {
      res.end(JSON.stringify([]));
    } else if (url.includes("/admin/branches")) {
      res.end(JSON.stringify([]));
    } else if (url.includes("/employee") && method === "PUT") {
      putPayload = await readBody(req);
      res.end(JSON.stringify({ ...EMPLOYEES[0], ...putPayload }));
    } else if (url.includes("/employee") && method === "DELETE") {
      deleteEndpointCalled = true;
      res.end(JSON.stringify({ deleted: true }));
    } else {
      res.end(JSON.stringify({ ok: true }));
    }
  };

  beforeEach(() => {
    putPayload = null;
    deleteEndpointCalled = false;
    useStubHandler(baseHandler);
  });

  it("renders Employee Records navigation link under Tenant Administration", async () => {
    render(
      <MemoryRouter initialEntries={["/admin/employees"]}>
        <AuthProvider>
          <PermissionsProvider>
            <StepUpProvider>
              <Routes>
                <Route element={<MainLayout />}>
                  <Route path="/admin/employees" element={<div>Employees Page Content</div>} />
                </Route>
              </Routes>
            </StepUpProvider>
          </PermissionsProvider>
        </AuthProvider>
      </MemoryRouter>,
    );

    const navLink = await screen.findByRole("link", { name: /Employee Records/i });
    expect(navLink).toBeInTheDocument();
    expect(navLink.getAttribute("href")).toBe("/admin/employees");
  });

  it("renders employees directory with professional licensure, status, and department details", async () => {
    render(
      <MemoryRouter initialEntries={["/admin/employees"]}>
        <AuthProvider>
          <PermissionsProvider>
            <StepUpProvider>
              <EmployeesPage />
            </StepUpProvider>
          </PermissionsProvider>
        </AuthProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByText("Employee Records & HR Profiles")).toBeInTheDocument();
    expect(await screen.findByText("Dr. Roberto Cruz")).toBeInTheDocument();
    expect(screen.getByText("EMP-1001")).toBeInTheDocument();
    expect(screen.getByText("Attending Cardiologist")).toBeInTheDocument();
    expect(screen.getByText("PRC-123456")).toBeInTheDocument();
    expect(screen.getByText("S2: S2-345678")).toBeInTheDocument();

    expect(screen.getByText("Ana Reyes")).toBeInTheDocument();
    expect(screen.getByText("EMP-1002")).toBeInTheDocument();
    expect(screen.getByText("Senior Staff Nurse")).toBeInTheDocument();
  });

  it("filters employee records by search query", async () => {
    render(
      <MemoryRouter initialEntries={["/admin/employees"]}>
        <AuthProvider>
          <PermissionsProvider>
            <StepUpProvider>
              <EmployeesPage />
            </StepUpProvider>
          </PermissionsProvider>
        </AuthProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByText("Dr. Roberto Cruz")).toBeInTheDocument();

    const searchInput = screen.getByPlaceholderText(/Search by name, ID, job title, PRC/i);
    fireEvent.change(searchInput, { target: { value: "Nurse" } });

    expect(screen.getByText("Ana Reyes")).toBeInTheDocument();
    expect(screen.queryByText("Dr. Roberto Cruz")).not.toBeInTheDocument();
  });

  it("opens edit modal and updates employee licensure and contact details", async () => {
    render(
      <MemoryRouter initialEntries={["/admin/employees"]}>
        <AuthProvider>
          <PermissionsProvider>
            <StepUpProvider>
              <EmployeesPage />
            </StepUpProvider>
          </PermissionsProvider>
        </AuthProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByText("Dr. Roberto Cruz")).toBeInTheDocument();

    await waitFor(() => expect(screen.getAllByRole("button", { name: "Edit" })[0]).not.toBeDisabled());
    const editBtns = screen.getAllByRole("button", { name: "Edit" });
    fireEvent.click(editBtns[0]!);

    expect(await screen.findByText(/Edit Employee Profile: Dr. Roberto Cruz/i)).toBeInTheDocument();

    const titleInput = screen.getByLabelText(/Job Title \/ Designation \*/i);
    fireEvent.change(titleInput, { target: { value: "Chief of Cardiology" } });

    const saveBtn = screen.getByRole("button", { name: "Save Changes" });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(putPayload).toMatchObject({
        employeeNo: "EMP-1001",
        jobTitle: "Chief of Cardiology",
        department: "Clinical Care",
      });
    });
  });

  it("displays tied employee profile badge and opens modal in UsersPage", async () => {
    render(
      <MemoryRouter initialEntries={["/admin/users"]}>
        <AuthProvider>
          <PermissionsProvider>
            <StepUpProvider>
              <UsersPage />
            </StepUpProvider>
          </PermissionsProvider>
        </AuthProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByText("Staff & User Directory")).toBeInTheDocument();
    expect(await screen.findByText("Dr. Roberto Cruz")).toBeInTheDocument();
    expect(screen.getByText("EMP-1001")).toBeInTheDocument();
    expect(screen.getByText("Attending Cardiologist")).toBeInTheDocument();

    await waitFor(() => expect(screen.getAllByRole("button", { name: /HR Profile/i })[0]).not.toBeDisabled());
    const hrBtns = screen.getAllByRole("button", { name: /HR Profile/i });
    expect(hrBtns.length).toBeGreaterThan(0);
    fireEvent.click(hrBtns[0]!);

    expect(await screen.findByText(/Employee Profile: Dr. Roberto Cruz/i)).toBeInTheDocument();
    expect(screen.getByDisplayValue("EMP-1001")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Attending Cardiologist")).toBeInTheDocument();
  });

  it("unlinks an employee record when delete is confirmed", async () => {
    render(
      <MemoryRouter initialEntries={["/admin/employees"]}>
        <AuthProvider>
          <PermissionsProvider>
            <StepUpProvider>
              <EmployeesPage />
            </StepUpProvider>
          </PermissionsProvider>
        </AuthProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByText("Dr. Roberto Cruz")).toBeInTheDocument();

    await waitFor(() => expect(screen.getAllByRole("button", { name: "Unlink" })[0]).not.toBeDisabled());
    const unlinkBtns = screen.getAllByRole("button", { name: "Unlink" });
    fireEvent.click(unlinkBtns[0]!);

    expect(await screen.findByText("Unlink Employee Profile")).toBeInTheDocument();

    const confirmBtn = screen.getByRole("button", { name: "Unlink Record" });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(deleteEndpointCalled).toBe(true);
    });
  });
});
