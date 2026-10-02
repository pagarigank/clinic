import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { AuthProvider } from "../src/shared/auth/AuthContext.js";
import { StepUpProvider } from "../src/shared/auth/StepUpContext.js";
import { SupplyDashboardPage } from "../src/features/supply/SupplyDashboardPage.js";
import { StockExplorerPage } from "../src/features/supply/StockExplorerPage.js";
import { GrnWizardPage } from "../src/features/supply/GrnWizardPage.js";
import { RequisitionsPage } from "../src/features/supply/RequisitionsPage.js";
import { ItemMasterPage } from "../src/features/supply/ItemMasterPage.js";

function renderWithProviders(ui: React.ReactElement) {
  return render(
    <MemoryRouter>
      <AuthProvider>
        <StepUpProvider>
          {ui}
        </StepUpProvider>
      </AuthProvider>
    </MemoryRouter>
  );
}

describe("SupplyDashboardPage (todo §4.5, SUP-T1)", () => {
  it("renders KPIs, reorder suggestions, and expiring stock tracker", async () => {
    renderWithProviders(<SupplyDashboardPage />);
    expect(screen.getByText(/Central Supply & Inventory Dashboard/i)).toBeInTheDocument();
    expect(screen.getByText(/Total Stock Valuation/i)).toBeInTheDocument();
    expect(screen.getByText(/Low Stock & Par Alerts/i)).toBeInTheDocument();
    expect(screen.getByText(/Expiring Stock Worklist \(FEFO\)/i)).toBeInTheDocument();
    expect(screen.getByText(/Amoxicillin 500mg Capsule/i)).toBeInTheDocument();
  });

  it("creates a draft PR from automated reorder suggestions", async () => {
    renderWithProviders(<SupplyDashboardPage />);
    const createPrBtn = screen.getByRole("button", { name: /Create PR for Amoxicillin 500mg Capsule/i });
    fireEvent.click(createPrBtn);
    expect(await screen.findByText(/Draft Purchase Request created/i)).toBeInTheDocument();
  });
});

describe("StockExplorerPage (todo §4.2, SUP-T8)", () => {
  it("renders balances table and filters by search query", async () => {
    renderWithProviders(<StockExplorerPage />);
    expect(screen.getByText(/Stock Explorer & Ledger/i)).toBeInTheDocument();
    expect(screen.getAllByText("LOT-AMX-2025A").length).toBeGreaterThan(0);

    const searchInput = screen.getByLabelText(/Search items/i);
    fireEvent.change(searchInput, { target: { value: "Gloves" } });
    expect(screen.getByText("Latex Examination Gloves (M)")).toBeInTheDocument();
    expect(screen.queryByText("Ceftriaxone 1g Vial")).not.toBeInTheDocument();
  });

  it("opens ledger modal with immutable SHA-256 audit trail (AC-12)", async () => {
    renderWithProviders(<StockExplorerPage />);
    const ledgerBtns = screen.getAllByRole("button", { name: /View ledger/i });
    fireEvent.click(ledgerBtns[0]!);
    expect(await screen.findByText(/Ledger Audit Trail/i)).toBeInTheDocument();
    expect(screen.getByText(/Append-Only Tamper Evident Ledger/i)).toBeInTheDocument();
  });

  it("opens quarantine modal and requires reason for status change", async () => {
    renderWithProviders(<StockExplorerPage />);
    const quarantineBtns = screen.getAllByRole("button", { name: /Quarantine/i });
    fireEvent.click(quarantineBtns[0]!);
    expect(await screen.findByText(/Quarantine Stock Batch/i)).toBeInTheDocument();
    expect(screen.getByText(/Authorized Reason \/ Inspection Finding/i)).toBeInTheDocument();
  });
});

describe("GrnWizardPage (todo §4.3, SUP-T2, AC-8)", () => {
  it("renders delivery header and line items entry form", () => {
    renderWithProviders(<GrnWizardPage />);
    expect(screen.getByText(/Goods Receipt Note \(GRN\) Receiving Wizard/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Supplier DR \/ Invoice Ref/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /\+ Add Line Item/i })).toBeInTheDocument();
  });

  it("triggers AC-8 shelf-life warning when batch expiry is near", async () => {
    renderWithProviders(<GrnWizardPage />);
    // Select expiry within 10 days
    const nearDate = new Date();
    nearDate.setDate(nearDate.getDate() + 10);
    const dateStr = nearDate.toISOString().split("T")[0];

    const lotInput = screen.getByLabelText(/Lot number/i);
    const expiryInput = screen.getByLabelText(/Expiry date/i);

    fireEvent.change(lotInput, { target: { value: "LOT-SHORT-TEST" } });
    fireEvent.change(expiryInput, { target: { value: dateStr } });

    // AC-8 warning appears and requests authorized override reason
    expect(await screen.findByText(/AC-8 Shelf-Life Warning/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Authorized override reason/i)).toBeInTheDocument();
  });
});

describe("RequisitionsPage (todo §4.3, SUP-T3, AC-9)", () => {
  it("renders requisitions list with status badges", () => {
    renderWithProviders(<RequisitionsPage />);
    expect(screen.getByText(/Department Requisitions & Stock Issues/i)).toBeInTheDocument();
    expect(screen.getByText("REQ-2026-0045")).toBeInTheDocument();
    expect(screen.getByText("REQ-2026-0042")).toBeInTheDocument();
  });

  it("verifies AC-9 discrepancy tracking when received count differs from issued", async () => {
    renderWithProviders(<RequisitionsPage />);
    // Click Receive on ISSUED requisition
    const receiveBtn = screen.getByRole("button", { name: /Receive REQ-2026-0045/i });
    fireEvent.click(receiveBtn);

    expect(await screen.findByText(/Receive Goods & Discrepancy Verification \(AC-9\)/i)).toBeInTheDocument();

    // Change received qty from 100 to 95
    const receivedInput = screen.getByLabelText(/Actual Quantity Received/i);
    fireEvent.change(receivedInput, { target: { value: "95" } });

    // AC-9 discrepancy detected message appears
    expect(await screen.findByText(/AC-9 Discrepancy Detected/i)).toBeInTheDocument();
  });
});

describe("ItemMasterPage (todo §4.1)", () => {
  it("displays items and opens item registration modal with flags", async () => {
    renderWithProviders(<ItemMasterPage />);
    expect(screen.getByText(/Item Master & Catalog/i)).toBeInTheDocument();
    expect(screen.getByText("MED-AMOX-500")).toBeInTheDocument();

    const newBtn = screen.getByRole("button", { name: /\+ Register New Item/i });
    fireEvent.click(newBtn);

    expect(await screen.findByText(/Register Item in Master/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Batch \/ Lot Tracked/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Expiry Tracked \(FEFO\)/i)).toBeInTheDocument();
  });

  it("opens bulk CSV import modal, loads sample, and processes import report with errors (todo §4.1)", async () => {
    renderWithProviders(<ItemMasterPage />);
    const csvBtn = screen.getByRole("button", { name: /Bulk CSV Import/i });
    fireEvent.click(csvBtn);

    expect(await screen.findByText(/Bulk CSV Import — Location Item Parameters/i)).toBeInTheDocument();

    const sampleBtn = screen.getByRole("button", { name: /Load Sample CSV/i });
    fireEvent.click(sampleBtn);

    const processBtn = screen.getByRole("button", { name: /Process CSV Import/i });
    fireEvent.click(processBtn);

    expect(await screen.findByText(/Import Summary & Error Report/i)).toBeInTheDocument();
    expect(screen.getAllByText(/INVALID-ITEM-CODE/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Item 'INVALID-ITEM-CODE' not found/i)).toBeInTheDocument();
  });
});

