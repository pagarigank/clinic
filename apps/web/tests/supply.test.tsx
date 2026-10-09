import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { AuthProvider } from "../src/shared/auth/AuthContext.js";
import { StepUpProvider } from "../src/shared/auth/StepUpContext.js";
import { SupplyDashboardPage } from "../src/features/supply/SupplyDashboardPage.js";
import { StockExplorerPage } from "../src/features/supply/StockExplorerPage.js";
import { GrnWizardPage } from "../src/features/supply/GrnWizardPage.js";
import { RequisitionsPage } from "../src/features/supply/RequisitionsPage.js";
import { ItemMasterPage } from "../src/features/supply/ItemMasterPage.js";
import { SupplyIssueWorkbenchPage } from "../src/features/supply/SupplyIssueWorkbenchPage.js";

const supplyApiMock = vi.hoisted(() => ({
  listItems: vi.fn(),
  listLocations: vi.fn(),
  getStock: vi.fn(),
  postConsumption: vi.fn(),
  listPatientRequests: vi.fn(),
  createPatientRequest: vi.fn(),
  issuePatientRequest: vi.fn(),
  listUoms: vi.fn(),
  listCategories: vi.fn(),
  createItem: vi.fn(),
  updateItem: vi.fn(),
  bulkAdjustPricing: vi.fn(),
}));

/** Two request lines for Maria Santos, one for Juan Dela Cruz (server rows). */
const PATIENT_REQUEST_ROWS = [
  {
    id: "req-1", request_no: "PSR-1001", patient_id: "pat-1",
    patient_first_name: "Maria", patient_last_name: "Santos", hrn: "HRN-00123",
    visit_id: null, visit_no: null, status: "PENDING", notes: null,
    requested_by: "u-1", requested_at: new Date(Date.now() - 3_600_000).toISOString(),
    request_item_id: "ri-1", item_id: "item-1", item_code: "SUP-GLV-M",
    item_name: "Latex Examination Gloves (M)", uom_id: "uom-box", uom_code: "BOX",
    qty_requested: 2, qty_issued: 0, item_notes: null,
  },
  {
    id: "req-1", request_no: "PSR-1001", patient_id: "pat-1",
    patient_first_name: "Maria", patient_last_name: "Santos", hrn: "HRN-00123",
    visit_id: null, visit_no: null, status: "PENDING", notes: null,
    requested_by: "u-1", requested_at: new Date(Date.now() - 3_500_000).toISOString(),
    request_item_id: "ri-2", item_id: "item-2", item_code: "SUP-GAU-4",
    item_name: "Sterile Gauze Sponge 4x4", uom_id: "uom-pc", uom_code: "PC",
    qty_requested: 5, qty_issued: 0, item_notes: null,
  },
  {
    id: "req-2", request_no: "PSR-1002", patient_id: "pat-2",
    patient_first_name: "Juan", patient_last_name: "Dela Cruz", hrn: "MRN-1001",
    visit_id: null, visit_no: null, status: "PENDING", notes: null,
    requested_by: "u-2", requested_at: new Date(Date.now() - 1_800_000).toISOString(),
    request_item_id: "ri-3", item_id: "item-1", item_code: "SUP-GLV-M",
    item_name: "Latex Examination Gloves (M)", uom_id: "uom-box", uom_code: "BOX",
    qty_requested: 1, qty_issued: 0, item_notes: null,
  },
];

vi.mock("../src/features/supply/api.js", () => ({ supplyApi: supplyApiMock }));

beforeEach(() => {
  vi.clearAllMocks();
  supplyApiMock.listUoms.mockResolvedValue([
    { id: "uom-box", code: "BOX", name: "Box" },
    { id: "uom-pc", code: "PC", name: "Piece" },
  ]);
  supplyApiMock.listCategories.mockResolvedValue([
    { id: "cat-1", name: "Consumables" },
  ]);
  supplyApiMock.listLocations.mockResolvedValue([
    { id: "loc-1", branch_id: "br-1", code: "CS", name: "Central Store", type: "CENTRAL_STORE" },
  ]);
  supplyApiMock.listItems.mockResolvedValue([
    {
      id: "item-1",
      code: "SUP-GLV-M",
      name: "Latex Examination Gloves (M)",
      item_type: "SUPPLY",
      base_uom_id: "uom-box",
      uom_code: "BOX",
      category_name: "Consumables",
      total_on_hand: 50,
      is_batch_tracked: true,
      is_expiry_tracked: false,
    },
    {
      id: "item-2",
      code: "SUP-GAU-4",
      name: "Sterile Gauze Sponge 4x4",
      item_type: "SUPPLY",
      base_uom_id: "uom-pc",
      uom_code: "PC",
      category_name: "Consumables",
      total_on_hand: 200,
      is_batch_tracked: false,
      is_expiry_tracked: false,
    },
  ]);
  supplyApiMock.getStock.mockResolvedValue([
    {
      location_id: "loc-1",
      batch_id: "b-1",
      qty_on_hand: 50,
      qty_reserved: 0,
      location_name: "Central Store",
      lot_no: "LOT-1",
      expiry_date: "2027-01-01",
      unit_cost: 2,
      batch_status: "AVAILABLE",
      item_id: "item-1",
      item_name: "Latex Examination Gloves (M)",
      item_code: "SUP-GLV-M",
      total_value: 100,
    },
  ]);
  supplyApiMock.postConsumption.mockResolvedValue({ status: "POSTED", allocatedCount: 1 });
  supplyApiMock.listPatientRequests.mockResolvedValue(PATIENT_REQUEST_ROWS);
  supplyApiMock.createPatientRequest.mockResolvedValue({ id: "req-new", status: "PENDING" });
  supplyApiMock.issuePatientRequest.mockResolvedValue({ id: "req-1", status: "ISSUED" });
});

function renderWithProviders(ui: React.ReactElement, initialEntries: string[] = ["/"]) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
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

describe("SupplyIssueWorkbenchPage (todo §4.4, SUP-T10)", () => {
  it("selects an item and shows FEFO batches available at the location", async () => {
    renderWithProviders(<SupplyIssueWorkbenchPage />);
    // The workbench opens on the patient-grouped view; direct issue is a toggle.
    fireEvent.click(await screen.findByRole("button", { name: /Direct Stock Issue/i }));
    fireEvent.click(await screen.findByText("Latex Examination Gloves (M)"));

    expect((await screen.findAllByText(/LOT-1/)).length).toBeGreaterThan(0);
    expect(await screen.findByRole("button", { name: /Issue Stock/i })).toBeInTheDocument();
    expect(supplyApiMock.getStock).toHaveBeenCalledWith({ itemId: "item-1" });
  });

  it("posts consumption and surfaces the server result", async () => {
    renderWithProviders(<SupplyIssueWorkbenchPage />);
    fireEvent.click(await screen.findByRole("button", { name: /Direct Stock Issue/i }));
    fireEvent.click(await screen.findByText("Latex Examination Gloves (M)"));

    const qtyInput = await screen.findByLabelText(/Quantity/i);
    fireEvent.change(qtyInput, { target: { value: "5" } });

    fireEvent.click(screen.getByRole("button", { name: /Issue Stock/i }));

    expect(await screen.findByText(/Issued 5 BOX/i)).toBeInTheDocument();
    expect(supplyApiMock.postConsumption).toHaveBeenCalledWith(
      expect.objectContaining({ itemId: "item-1", locationId: "loc-1", qty: 5, uomId: "uom-box" }),
    );
  });

  it("groups patient supply requests by patient and issues individual lines", async () => {
    renderWithProviders(<SupplyIssueWorkbenchPage />);

    // Level 1: one row per patient, sourced from the real request queue.
    expect(await screen.findByText("Maria Santos")).toBeInTheDocument();
    expect(screen.getByText("Juan Dela Cruz")).toBeInTheDocument();
    expect(supplyApiMock.listPatientRequests).toHaveBeenCalled();

    // Badges count requested lines, not patients.
    expect(screen.getByText(/2 Supply Items/i)).toBeInTheDocument();
    expect(screen.getByText(/1 Supply Item\b/i)).toBeInTheDocument();

    // Maria Santos appears once in the patient table.
    const mariaElements = screen.getAllByText("Maria Santos");
    expect(mariaElements.length).toBe(1);

    // Drill down to the patient's request lines.
    fireEvent.click(mariaElements[0]!);
    expect(await screen.findByRole("button", { name: /Back to Patient List/i })).toBeInTheDocument();
    expect(screen.getByText(/Latex Examination Gloves \(M\)/i)).toBeInTheDocument();
    expect(screen.getByText(/Sterile Gauze Sponge 4x4/i)).toBeInTheDocument();

    const issueButtons = screen.getAllByRole("button", { name: /Issue 2 BOX/i });
    expect(issueButtons.length).toBe(1);
    fireEvent.click(issueButtons[0]!);

    // The issue endpoint is called for the line, and the result is surfaced.
    expect(await screen.findByText(/Successfully issued 2 BOX of Latex Examination Gloves \(M\) to Maria Santos/i)).toBeInTheDocument();
    expect(supplyApiMock.issuePatientRequest).toHaveBeenCalledWith("req-1", "ri-1", {
      locationId: "loc-1",
      qty: 2,
    });

    // Back to the patient list keeps both patients visible.
    fireEvent.click(screen.getByRole("button", { name: /Back to Patient List/i }));
    expect(await screen.findByText("Juan Dela Cruz")).toBeInTheDocument();
  });

  it("fuzzy-searches the New Supply Request item picker", async () => {
    renderWithProviders(<SupplyIssueWorkbenchPage />);
    fireEvent.click(await screen.findByRole("button", { name: /New Supply Request/i }));
    const dialog = await screen.findByRole("dialog");
    const input = within(dialog).getByRole("combobox");

    fireEvent.change(input, { target: { value: "gauze" } });
    expect(await within(dialog).findByText(/Sterile Gauze Sponge 4x4/i)).toBeInTheDocument();
    expect(within(dialog).queryByText(/Latex Examination Gloves/i)).not.toBeInTheDocument();
  });
});


