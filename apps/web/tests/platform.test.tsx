import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router";
import { AuthProvider } from "../src/shared/auth/AuthContext.js";
import { StepUpProvider } from "../src/shared/auth/StepUpContext.js";
import { TenantsPage } from "../src/features/platform/TenantsPage.js";
import { TenantDetailPage } from "../src/features/platform/TenantDetailPage.js";
import { NewTenantWizard } from "../src/features/platform/NewTenantWizard.js";
import { setStepUpToken } from "../src/shared/api/client.js";
import { useStubHandler } from "./setup.js";

/**
 * Platform console — todo.md §1.7 ⛔ (Modules tab, RPT-PLT-09) and the new
 * tenant wizard module step (frontend.md §14.1). The default stub answers 200
 * with non-matching JSON, which exercises each page's demo-fallback path
 * deterministically.
 */
describe("Platform console (todo §1.7)", () => {
  it("TenantsPage lists tenants with plan, status, and module chips; no PHI surface", async () => {
    render(
      <MemoryRouter>
        <AuthProvider>
          <TenantsPage />
        </AuthProvider>
      </MemoryRouter>,
    );

    expect(screen.getByText(/Platform scope — no patient data/i)).toBeInTheDocument();
    expect(await screen.findByText(/Northwind Clinic/i)).toBeInTheDocument();
    expect(screen.getByText(/Southgate Medical/i)).toBeInTheDocument();
    // The deliberately module-gated tenant shape from frontend §22.
    expect(screen.getByText("PROVISIONING_FAILED")).toBeInTheDocument();
    // Filter narrows the table.
    fireEvent.change(screen.getByLabelText(/Filter tenants/i), { target: { value: "southgate" } });
    expect(screen.getByText(/1 of 3 tenants/i)).toBeInTheDocument();
  });

  it("TenantDetailPage Modules tab renders status/seed/trials and opens the disable preflight", async () => {
    render(
      <MemoryRouter
        initialEntries={[
          { pathname: "/platform/tenants/t1", state: { tenant: { name: "Northwind Clinic", slug: "northwind" } } },
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

    expect(await screen.findByRole("tab", { name: /Modules \(5 enabled\)/i })).toBeInTheDocument();
    expect(screen.getAllByText("ENABLED").length).toBe(4);
    expect(screen.getByText("DRAINING")).toBeInTheDocument();
    expect(screen.getAllByText("DISABLED").length).toBeGreaterThan(0);
    expect(screen.getByText(/ends 2026-11-15/)).toBeInTheDocument();

    // Three-beat disable: preflight first.
    const disableButtons = screen.getAllByRole("button", { name: /Disable…/ });
    fireEvent.click(disableButtons[0]!);
    const preflightDialog = await screen.findByRole("dialog");
    expect(within(preflightDialog).getByText(/What would be blocked/i)).toBeInTheDocument();
    expect(within(preflightDialog).getByRole("button", { name: /Drain \(read-only\)…/ })).toBeInTheDocument();
    expect(within(preflightDialog).getByRole("button", { name: /Force-disable…/ })).toBeInTheDocument();
  });

  it("force-disable requires the typed tenant slug, a reason, and a passphrase", async () => {
    render(
      <MemoryRouter
        initialEntries={[
          { pathname: "/platform/tenants/t1", state: { tenant: { name: "Northwind Clinic", slug: "northwind" } } },
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

    await screen.findByRole("tab", { name: /Modules/i });
    fireEvent.click(screen.getAllByRole("button", { name: /Disable…/ })[0]!);
    const preflightDialog = await screen.findByRole("dialog");
    fireEvent.click(within(preflightDialog).getByRole("button", { name: /Force-disable…/ }));

    const forceDialog = screen.getByRole("dialog");
    const forceButton = within(forceDialog).getByRole("button", { name: /Force-disable module/i });
    expect(forceButton).toBeDisabled();

    fireEvent.change(within(forceDialog).getByLabelText(/Type the tenant slug/i), { target: { value: "wrong-slug" } });
    fireEvent.change(within(forceDialog).getByLabelText(/^Reason/i), { target: { value: "Plan downgraded" } });
    fireEvent.change(within(forceDialog).getByLabelText(/Confirm your passphrase/i), { target: { value: "pw" } });
    expect(forceButton).toBeDisabled(); // slug mismatch still blocks

    fireEvent.change(within(forceDialog).getByLabelText(/Type the tenant slug/i), { target: { value: "northwind" } });
    expect(forceButton).toBeEnabled();

    fireEvent.click(forceButton);
    // Success toast names the module and the effective time (frontend §14.1).
    expect(await screen.findByText(/force-disabled —/i)).toBeInTheDocument();
  });

  it("wizard auto-ticks dependencies and shows the live summary before anything is posted", async () => {
    render(
      <MemoryRouter initialEntries={["/platform/tenants/new"]}>
        <AuthProvider>
          <StepUpProvider>
            <Routes>
              <Route path="/platform/tenants/new" element={<NewTenantWizard />} />
              <Route path="/platform/tenants/:tenantId" element={<div>DETAIL-LANDING</div>} />
            </Routes>
          </StepUpProvider>
        </AuthProvider>
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText(/Clinic name/i), { target: { value: "Test Clinic" } });
    fireEvent.change(screen.getByLabelText(/Slug/i), { target: { value: "test-clinic" } });
    fireEvent.click(screen.getByRole("button", { name: /Next: modules/i }));

    // Admin + Patients start on and locked.
    expect(screen.getByLabelText(/Administration/i)).toBeChecked();
    expect(screen.getByLabelText(/Administration/i)).toBeDisabled();

    // Ticking Pharmacy auto-ticks its hard dependencies (patients, supply).
    fireEvent.click(screen.getByLabelText(/^Pharmacy$/i));
    expect(screen.getByLabelText(/^Pharmacy$/i)).toBeChecked();
    expect(screen.getByLabelText(/Patients/i)).toBeChecked();
    expect(screen.getByLabelText(/Central Supply/i)).toBeChecked();
    // Every auto-ticked dependency card explains itself (frontend §14.1).
    expect(screen.getAllByText(/auto-enabled/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/This tenant will run Administration, Patients, Central Supply, and Pharmacy\./i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Next: confirm/i }));
    // Insertion order of the selection set: seeded keys first, then the
    // clicked module, then its auto-ticked dependencies.
    expect(screen.getByText("admin, patients, pharmacy, supply")).toBeInTheDocument();
  });

  it("wizard step 4 renders created logins, shared password, and 1-click copy handover card", async () => {
    useStubHandler((req, res) => {
      if (req.method === "POST" && req.url === "/platform/tenants") {
        res.writeHead(201, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            tenant: {
              id: "new-tenant-123",
              name: "Metro General",
              slug: "metro-general",
              status: "PROVISIONING",
            },
            credentials: {
              tenantSlug: "metro-general",
              defaultPassword: "DemoPassw0rd!2026",
              loginUrl: "http://localhost:8085/login",
              accounts: [
                { email: "admintenant@metro-general.emr", role: "admin", description: "Tenant Administrator" },
                { email: "doctor@metro-general.emr", role: "doctor", description: "Primary Physician" },
                { email: "receptionist@metro-general.emr", role: "receptionist", description: "Front Desk & Scheduling" },
                { email: "pharmacist@metro-general.emr", role: "pharmacist", description: "Licensed Pharmacist" },
                { email: "labtech@metro-general.emr", role: "lab_tech", description: "Laboratory Technician" },
              ],
            },
          }),
        );
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ message: "pong" }));
    });

    render(
      <MemoryRouter initialEntries={["/platform/tenants/new"]}>
        <AuthProvider>
          <StepUpProvider>
            <Routes>
              <Route path="/platform/tenants/new" element={<NewTenantWizard />} />
              <Route path="/platform/tenants/:tenantId" element={<div>DETAIL-PAGE</div>} />
            </Routes>
          </StepUpProvider>
        </AuthProvider>
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText(/Clinic name/i), { target: { value: "Metro General" } });
    fireEvent.change(screen.getByLabelText(/Slug/i), { target: { value: "metro-general" } });
    fireEvent.click(screen.getByRole("button", { name: /Next: modules/i }));
    fireEvent.click(screen.getByRole("button", { name: /Next: confirm/i }));

    const submitBtn = screen.getByRole("button", { name: /Create tenant/i });
    fireEvent.click(submitBtn);

    // Lands on Step 4 "Logins & Handover"
    expect(await screen.findByText(/Tenant Successfully Created!/i)).toBeInTheDocument();
    expect(screen.getByText(/Tenant Logins & Default Password/i)).toBeInTheDocument();
    expect(screen.getByText("admintenant@metro-general.emr")).toBeInTheDocument();
    expect(screen.getByText("doctor@metro-general.emr")).toBeInTheDocument();
    expect(screen.getByText("pharmacist@metro-general.emr")).toBeInTheDocument();
    expect(screen.getByText("labtech@metro-general.emr")).toBeInTheDocument();
    expect(screen.getByText("DemoPassw0rd!2026")).toBeInTheDocument();

    // Verify copy buttons are rendered
    expect(screen.getByRole("button", { name: /Copy All Credentials/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Proceed to Tenant Console/i })).toBeInTheDocument();
  });

  it("TenantDetailPage includes Logins & Credentials tab displaying starter accounts", async () => {
    render(
      <MemoryRouter
        initialEntries={[
          { pathname: "/platform/tenants/t1", state: { tenant: { name: "Northwind Clinic", slug: "northwind" } } },
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

    const loginsTab = await screen.findByRole("tab", { name: /Logins & Credentials/i });
    expect(loginsTab).toBeInTheDocument();
    fireEvent.click(loginsTab);

    expect(await screen.findByText(/admintenant@northwind.emr/i)).toBeInTheDocument();
    expect(screen.getByText(/doctor@northwind.emr/i)).toBeInTheDocument();
    expect(screen.getByText(/receptionist@northwind.emr/i)).toBeInTheDocument();
    expect(screen.getByText(/DemoPassw0rd!2026/i)).toBeInTheDocument();
  });

  /**
   * Admins tab — specification.md §18.1. Platform operators manage tenant
   * administrators from the Tenant detail surface (metadata only, never PHI);
   * every mutation is step-up protected (todo.md §1.2).
   */
  const ADMIN_ROWS = {
    admins: [
      {
        id: "u1",
        email: "admin@demo-a.test",
        name: "Dr Amina Reyes",
        status: "ACTIVE",
        mfaEnabled: true,
        lastLoginAt: "2026-10-01T10:00:00.000Z",
        roles: ["tenant_admin"],
      },
      {
        id: "u2",
        email: "locked@demo-a.test",
        name: "Dr Lito Cruz",
        status: "LOCKED",
        mfaEnabled: false,
        lastLoginAt: null,
        roles: ["tenant_admin"],
      },
    ],
  };

  function renderTenantDetail() {
    return render(
      <MemoryRouter
        initialEntries={[
          { pathname: "/platform/tenants/t1", state: { tenant: { name: "Northwind Clinic", slug: "northwind" } } },
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
  }

  it("Administrators tab lists tenant admins and resets MFA through the step-up challenge", async () => {
    setStepUpToken(null);
    useStubHandler((req, res) => {
      const url = req.url ?? "";
      const method = req.method ?? "GET";
      const send = (status: number, body: unknown) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(body));
      };
      if (url.endsWith("/admins") && method === "GET") {
        return send(200, ADMIN_ROWS);
      }
      if (url.includes("/reset-mfa")) {
        if (!req.headers["x-step-up-token"]) {
          return send(401, {
            type: "about:blank",
            title: "Step-up required",
            status: 401,
            code: "STEP_UP_REQUIRED",
          });
        }
        return send(200, { reset: true });
      }
      if (url.includes("/auth/step-up")) {
        return send(200, { stepUpToken: "step-token", expiresIn: 300 });
      }
      return send(200, {});
    });

    renderTenantDetail();
    fireEvent.click(await screen.findByRole("tab", { name: /Administrators/i }));

    expect(await screen.findByText("Dr Amina Reyes")).toBeInTheDocument();
    expect(screen.getByText("admin@demo-a.test")).toBeInTheDocument();
    expect(screen.getByText("Dr Lito Cruz")).toBeInTheDocument();
    expect(screen.getByText("LOCKED")).toBeInTheDocument();

    // Reset MFA is offered only for MFA-enrolled admins.
    const mfaButtons = screen.getAllByRole("button", { name: /Reset MFA/i });
    expect(mfaButtons).toHaveLength(2);
    expect(mfaButtons[0]).toBeEnabled();
    expect(mfaButtons[1]).toBeDisabled();

    fireEvent.click(mfaButtons[0]!);
    expect(await screen.findByText(/Confirm it's you/i)).toBeInTheDocument();
    expect(screen.getByText(/Reset MFA for admin@demo-a\.test/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/^Passphrase$/i), { target: { value: "DemoPassw0rd!2026" } });
    fireEvent.click(screen.getByRole("button", { name: /^Confirm$/i }));

    expect(await screen.findByText(/MFA reset for admin@demo-a\.test/)).toBeInTheDocument();
  });

  it("Unlock and password reset are step-up gated and post the operator's intent", async () => {
    setStepUpToken(null);
    const posted: string[] = [];
    useStubHandler((req, res) => {
      const url = req.url ?? "";
      const method = req.method ?? "GET";
      const send = (status: number, body: unknown) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(body));
      };
      if (url.endsWith("/admins") && method === "GET") {
        return send(200, ADMIN_ROWS);
      }
      if ((url.includes("/unlock") || url.includes("/reset-password")) && method === "POST") {
        posted.push(url);
        if (!req.headers["x-step-up-token"]) {
          return send(401, {
            type: "about:blank",
            title: "Step-up required",
            status: 401,
            code: "STEP_UP_REQUIRED",
          });
        }
        return send(200, { ok: true });
      }
      if (url.includes("/auth/step-up")) {
        return send(200, { stepUpToken: "step-token", expiresIn: 300 });
      }
      return send(200, {});
    });

    renderTenantDetail();
    fireEvent.click(await screen.findByRole("tab", { name: /Administrators/i }));
    await screen.findByText("Dr Lito Cruz");

    // Unlock is offered only for LOCKED rows, and challenges for step-up first.
    fireEvent.click(screen.getByRole("button", { name: /^Unlock$/i }));
    expect(await screen.findByText(/Unlock locked@demo-a\.test/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/^Passphrase$/i), { target: { value: "DemoPassw0rd!2026" } });
    fireEvent.click(screen.getByRole("button", { name: /^Confirm$/i }));
    expect(await screen.findByText(/Account unlocked for locked@demo-a\.test/)).toBeInTheDocument();

    // Reset password opens a modal and posts the new password (step-up already held).
    await screen.findByText("Dr Lito Cruz");
    fireEvent.click(screen.getAllByRole("button", { name: /Reset password…/i })[0]!);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/Reset password for admin@demo-a\.test/i)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: /^Reset password$/i })).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText(/New password/i), {
      target: { value: "BrandNewPassw0rd!2026" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: /^Reset password$/i }));

    expect(await screen.findByText(/Password reset for admin@demo-a\.test/)).toBeInTheDocument();
    expect(posted.some((u) => u.includes("/users/u2/unlock"))).toBe(true);
    expect(posted.some((u) => u.includes("/admins/u1/reset-password"))).toBe(true);
  });
});

