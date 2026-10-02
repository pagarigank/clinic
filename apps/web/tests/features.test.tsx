import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { AuthProvider } from "../src/shared/auth/AuthContext.js";
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

  it("RolesPage renders system roles and Segregation of Duties (SoD) safeguards", () => {
    render(
      <MemoryRouter>
        <AuthProvider>
          <RolesPage />
        </AuthProvider>
      </MemoryRouter>,
    );

    expect(screen.getByText(/Roles & Access Control/i)).toBeInTheDocument();
    expect(screen.getByText(/Segregation of Duties \(SoD\) Enforcement Active/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Tenant Administrator/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/pharmacy.rx.verify ⚡ pharmacy.dispense.post/i)).toBeInTheDocument();
  });

  it("UsersPage renders staff directory with roles and MFA security badges", () => {
    render(
      <MemoryRouter>
        <AuthProvider>
          <UsersPage />
        </AuthProvider>
      </MemoryRouter>,
    );

    expect(screen.getByText(/Staff & User Directory/i)).toBeInTheDocument();
    expect(screen.getByText(/Dr. Maria Clara Santos/i)).toBeInTheDocument();
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
});
