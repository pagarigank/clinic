import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router";
import { AuthProvider } from "../src/shared/auth/AuthContext.js";
import { StepUpProvider } from "../src/shared/auth/StepUpContext.js";
import { TenantsPage } from "../src/features/platform/TenantsPage.js";
import { TenantDetailPage } from "../src/features/platform/TenantDetailPage.js";
import { NewTenantWizard } from "../src/features/platform/NewTenantWizard.js";

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
});
