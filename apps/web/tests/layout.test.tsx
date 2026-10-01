import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";
import { AuthProvider } from "../src/shared/auth/AuthContext.js";
import { MainLayout } from "../src/shell/MainLayout.js";
import { ApprovalsPage } from "../src/features/admin/ApprovalsPage.js";

describe("MainLayout Shell", () => {
  it("renders header, left nav menu, and footer", () => {
    render(
      <MemoryRouter initialEntries={["/dashboard"]}>
        <AuthProvider>
          <MainLayout />
        </AuthProvider>
      </MemoryRouter>,
    );

    // 1. Header elements
    expect(screen.getByText("Clinic Platform")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Sign Out/i })).toBeInTheDocument();

    // 2. Left nav menu links
    expect(screen.getByText("Dashboard")).toBeInTheDocument();
    expect(screen.getByText("Patient Registry")).toBeInTheDocument();
    expect(screen.getByText("Appointments")).toBeInTheDocument();
    expect(screen.getByText("Staff Approvals")).toBeInTheDocument();
    expect(screen.getByText("Staff & Users")).toBeInTheDocument();
    expect(screen.getByText("Roles & Permissions")).toBeInTheDocument();

    // 3. Footer elements
    expect(screen.getByText(/Connected to Tenant Database/i)).toBeInTheDocument();
    expect(screen.getByText(/All rights reserved/i)).toBeInTheDocument();
  });
});

describe("ApprovalsPage (Tenant Admin Approval)", () => {
  it("displays pending registration queue and allows approval action", () => {
    render(
      <MemoryRouter>
        <AuthProvider>
          <ApprovalsPage />
        </AuthProvider>
      </MemoryRouter>,
    );

    expect(screen.getByText(/Staff Registration Approvals/i)).toBeInTheDocument();
    expect(screen.getByText(/Maria Clara Santos/i)).toBeInTheDocument();

    // Approve action on the first pending item
    const approveButtons = screen.getAllByRole("button", { name: /^Approve$/ });
    expect(approveButtons.length).toBeGreaterThan(0);
    fireEvent.click(approveButtons[0]!);

    expect(screen.getByText(/has been APPROVED/i)).toBeInTheDocument();
  });
});
