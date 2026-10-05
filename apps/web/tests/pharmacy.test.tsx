import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router";
import { AuthProvider } from "../src/shared/auth/AuthContext.js";
import { StepUpProvider } from "../src/shared/auth/StepUpContext.js";
import { PharmacyQueuePage } from "../src/features/pharmacy/PharmacyQueuePage.js";
import { DispenseWorkbenchPage } from "../src/features/pharmacy/DispenseWorkbenchPage.js";
import { ControlledRegisterPage } from "../src/features/pharmacy/ControlledRegisterPage.js";
import { OtcSalesPage } from "../src/features/pharmacy/OtcSalesPage.js";
import { MedicationAdminPage } from "../src/features/pharmacy/MedicationAdminPage.js";

const apiMock = vi.hoisted(() => ({
  getQueue: vi.fn(),
  getPrescription: vi.fn(),
  listLocations: vi.fn(),
  getStock: vi.fn(),
  createDispense: vi.fn(),
  allocateFefo: vi.fn(),
  getDispense: vi.fn(),
  postDispense: vi.fn(),
  voidDispense: vi.fn(),
  getDispenseLabel: vi.fn(),
}));

vi.mock("../src/features/pharmacy/api.js", () => ({ pharmacyApi: apiMock }));

// PharmacyQueuePage fetches through the shared client (apiGet), not through
// features/pharmacy/api.js, so mocking only the latter left the page doing real
// network calls in jsdom. It then rendered nothing and the assertions below failed
// for the wrong reason. Stub the module the page actually imports.
const clientMock = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiPatch: vi.fn(),
  apiDelete: vi.fn(),
  apiGetBlob: vi.fn(),
  printBlob: vi.fn(),
  ApiError: class ApiError extends Error {
    problem: any;
    constructor(p: any) {
      super(p?.title ?? "API error");
      this.problem = p;
    }
  },
}));

vi.mock("../src/shared/api/client.js", () => clientMock);

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

function renderWorkbench(path = "/pharmacy/dispenses/rx-1") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <StepUpProvider>
          <Routes>
            <Route path="/pharmacy/dispenses/:id" element={<DispenseWorkbenchPage />} />
          </Routes>
        </StepUpProvider>
      </AuthProvider>
    </MemoryRouter>
  );
}

const LOCATION = { id: "loc-1", branch_id: "br-1", code: "PHM", name: "Main Pharmacy", type: "PHARMACY" };
const STOCK = [
  {
    location_id: "loc-1",
    batch_id: "b-1",
    qty_on_hand: 100,
    qty_reserved: 0,
    batch_no: "LOT-1",
    expiry_date: "2027-01-01",
    batch_status: "AVAILABLE",
    unit_cost: 1,
    item_id: "item-1",
    item_name: "Paracetamol 500mg Tablet",
    item_code: "MED-PAR-500",
    location_name: "Main Pharmacy",
  },
];
const PARACETAMOL_ITEM = {
  id: "pi-1",
  drug_product_id: "dp-1",
  generic_name: "Paracetamol",
  brand_name: "Biogesic",
  strength: "500mg",
  form: "Tablet",
  route: "PO",
  sig_dose: "1 tablet",
  sig_frequency: "TID",
  sig_duration: "3 days",
  qty_prescribed: 9,
  qty_dispensed: 0,
  dispense_as_written: false,
  item_id: "item-1",
  controlled_schedule: null,
  item_code: "MED-PAR-500",
  item_name: "Paracetamol 500mg Tablet",
};

function prescription(overrides: Record<string, unknown> = {}) {
  return {
    id: "rx-1",
    rx_no: "RX-2026-00412",
    status: "ISSUED",
    is_controlled: false,
    patient_id: "p-1",
    patient_first_name: "Clara",
    patient_last_name: "Dela Cruz",
    hrn: "HRN-0001",
    birth_date: "1990-01-01",
    patient_sex: "FEMALE",
    prescriber_name: "Dr. Reyes",
    visit_no: "V-2026-001",
    items: [PARACETAMOL_ITEM],
    // PHM-T1 automated safety findings, returned on the prescription detail.
    findings: [
      {
        type: "ALLERGY",
        severity: "CRITICAL",
        title: "Known Severe Beta-Lactam Allergy Detected",
        description: "Patient has a recorded severe allergy to Penicillin / Amoxicillin.",
        requiresOverrideReason: true,
      },
    ],
    ...overrides,
  };
}

const POSTED_DISPENSE = {
  id: "disp-1",
  dispense_no: "DSP-2026-0001",
  status: "POSTED",
  is_controlled: false,
  patient_id: "p-1",
  items: [
    {
      id: "di-1",
      item_id: "item-1",
      qty: 9,
      unit_price: 1,
      total_price: 9,
      item_name: "Paracetamol 500mg Tablet",
      batch_no: "LOT-1",
      expiry_date: "2027-01-01",
      uom_code: "TAB",
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();

  // The queue page calls GET /pharmacy/queue, then GET /pharmacy/prescriptions/:id
  // for each row (the list endpoint carries no item lines). Route by URL so both
  // resolve to the same fixture.
  const rx = prescription({ allergies: ["Penicillin", "Amoxicillin"] });
  clientMock.apiGet.mockImplementation(async (url: string) => {
    if (url === "/pharmacy/queue") return [rx];
    if (url.startsWith("/pharmacy/prescriptions/")) return rx;
    return {};
  });
  clientMock.apiPost.mockResolvedValue({ success: true });

  apiMock.listLocations.mockResolvedValue([LOCATION]);
  apiMock.getStock.mockResolvedValue(STOCK);
  apiMock.getPrescription.mockResolvedValue(prescription());
  apiMock.createDispense.mockResolvedValue({ ...POSTED_DISPENSE, status: "DRAFT", items: [] });
  apiMock.postDispense.mockResolvedValue(POSTED_DISPENSE);
  apiMock.allocateFefo.mockResolvedValue({
    ...POSTED_DISPENSE,
    status: "DRAFT",
    items: [{ ...POSTED_DISPENSE.items[0], prescription_item_id: "pi-1", batch_id: "b-1" }],
  });
});

describe("PharmacyQueuePage (todo §5.1, PHM-T1)", () => {
  it("renders queue, patient details, and clinical safety alerts", async () => {
    renderWithProviders(<PharmacyQueuePage />);
    expect(screen.getByText(/Prescription Verification Queue/i)).toBeInTheDocument();
    // The queue is fetched on mount, so wait for it rather than asserting synchronously.
    expect(await screen.findByText("RX-2026-00412")).toBeInTheDocument();
    expect(screen.getByText("Clara Dela Cruz")).toBeInTheDocument();
    expect(screen.getByText(/Allergies: Penicillin, Amoxicillin/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Critical Alert/i).length).toBeGreaterThan(0);
  });

  it("filters prescriptions by status", async () => {
    renderWithProviders(<PharmacyQueuePage />);
    // The queue is fetched on mount.
    expect(await screen.findByText("RX-2026-00412")).toBeInTheDocument();

    // The status chips mirror the real lifecycle (specification §5.2): there is no
    // VERIFIED prescription status, so the chip must not offer one.
    expect(screen.getByRole("button", { name: "ISSUED" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "VERIFIED" })).not.toBeInTheDocument();

    // Filtering to DISPENSED hides the ISSUED prescription in the list.
    fireEvent.click(screen.getByRole("button", { name: "DISPENSED" }));
    expect(screen.queryByText("RX-2026-00412")).not.toBeInTheDocument();
  });

  it("opens verification modal with patient banner, items, and safety findings", async () => {
    renderWithProviders(<PharmacyQueuePage />);
    const verifyButtons = await screen.findAllByRole("button", { name: /Verify Rx/i });
    fireEvent.click(verifyButtons[0]!);

    expect(screen.getByText(/Clinical Pharmacist Verification/i)).toBeInTheDocument();
    expect(screen.getByText(/Known Severe Beta-Lactam Allergy Detected/i)).toBeInTheDocument();
    expect(screen.getByText(/Clinical Override Justification/i)).toBeInTheDocument();
  });

  it("approves prescription with override reason and clears for dispensing", async () => {
    renderWithProviders(<PharmacyQueuePage />);
    const verifyButtons = await screen.findAllByRole("button", { name: /Verify Rx/i });
    fireEvent.click(verifyButtons[0]!);

    const overrideInput = screen.getByLabelText(/Clinical Override Justification/i);
    fireEvent.change(overrideInput, {
      target: { value: "Prescriber confirmed alternative antihistamine co-therapy; benefit documented" },
    });

    const approveBtn = screen.getByRole("button", { name: /Approve & Clear for Dispensing/i });
    fireEvent.click(approveBtn);

    expect(await screen.findByText(/has been verified and cleared for dispensing/i)).toBeInTheDocument();
  });
});

describe("DispenseWorkbenchPage (todo §5.2, PHM-T2, AC-7)", () => {
  it("loads the prescription and shows prescribed lines with a FEFO batch", async () => {
    renderWorkbench();
    expect(await screen.findByText(/Dispense RX-2026-00412/i)).toBeInTheDocument();
    expect(await screen.findByText("Paracetamol 500mg Tablet")).toBeInTheDocument();
    expect(await screen.findByText(/FEFO earliest expiry/i)).toBeInTheDocument();
    expect(apiMock.getPrescription).toHaveBeenCalledWith("rx-1");
  });

  it("enforces AC-7 controlled substance verification (yellow slip, words, witness)", async () => {
    apiMock.getPrescription.mockResolvedValue(
      prescription({
        is_controlled: true,
        items: [{ ...PARACETAMOL_ITEM, controlled_schedule: "S2" }],
      }),
    );
    renderWorkbench();
    await screen.findByText("Paracetamol 500mg Tablet");

    const postBtn = await screen.findByRole("button", { name: /Post Dispense/i });
    fireEvent.click(postBtn);

    expect(await screen.findByText(/AC-7 Dangerous Drug Dispense Protocol/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/PDEA Special Rx Yellow Slip Serial No./i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Quantity in Words/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Witness User ID/i)).toBeInTheDocument();
    expect(apiMock.postDispense).not.toHaveBeenCalled();
  });

  it("posts the dispense and renders printable Rx labels", async () => {
    renderWorkbench();
    await screen.findByText("Paracetamol 500mg Tablet");

    fireEvent.click(await screen.findByRole("button", { name: /Post Dispense/i }));

    expect(await screen.findByText(/DSP-2026-0001 posted/i)).toBeInTheDocument();
    expect(apiMock.postDispense).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: /Print Rx Labels/i }));

    expect(await screen.findByText(/Rx Label Preview/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Paracetamol 500mg Tablet/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Qty Dispensed: 9/i)).toBeInTheDocument();
  });
});

describe("ControlledRegisterPage (todo §5.3, PHM-T4, AC-7 Dangerous Drugs Book)", () => {
  it("renders Dangerous Drugs Book with running balance and reconciliation banner", async () => {
    renderWithProviders(<ControlledRegisterPage />);
    expect(screen.getByText(/Controlled Substances Register \(AC-7\)/i)).toBeInTheDocument();
    expect(screen.getByText(/Dangerous Drugs Inventory Reconciled/i)).toBeInTheDocument();
    expect(screen.getByText(/IMMUTABLE APPEND-ONLY LEDGER/i)).toBeInTheDocument();
    expect(screen.getByText("PDEA-DDB-2026-00981")).toBeInTheDocument();
    expect(screen.getAllByText("Maria Santos, RPh").length).toBeGreaterThan(0);
  });

  it("switches to Special Rx Yellow Slip registry tab", async () => {
    renderWithProviders(<ControlledRegisterPage />);
    const yellowTab = screen.getByRole("button", { name: /Yellow Slip \(Special Rx\) Registry/i });
    fireEvent.click(yellowTab);

    expect(screen.getByText(/Yellow Slip Special Prescription Registry/i)).toBeInTheDocument();
    expect(screen.getByText("PDEA-DDB-2026-00982")).toBeInTheDocument();
    expect(screen.getByText(/ACTIVE \/ UNUSED/i)).toBeInTheDocument();
    expect(screen.getByText(/DISPENSED & VOIDED FOR REFILLS/i)).toBeInTheDocument();
  });
});

describe("OtcSalesPage (todo §5.4, PHM-T3)", () => {
  it("hard rejects controlled substances and Rx-only medications", async () => {
    renderWithProviders(<OtcSalesPage />);
    expect(screen.getByText(/Over-The-Counter \(OTC\) Pharmacy POS/i)).toBeInTheDocument();

    // Find and click Test Block for Morphine (Controlled Schedule II)
    const morphRow = screen.getByText("Morphine Sulfate 10mg/mL Ampoule").closest("tr");
    const morphBlockBtn = morphRow?.querySelector("button");
    if (morphBlockBtn) fireEvent.click(morphBlockBtn);

    expect(screen.getByText(/Dispensing Blocked by Clinical Policy/i)).toBeInTheDocument();
    expect(screen.getByText(/AC-7 Controlled Substance/i)).toBeInTheDocument();

    // Find and click Test Block for Amoxicillin (Rx Antibiotic)
    const amxRow = screen.getByText("Amoxicillin 500mg Capsule").closest("tr");
    const amxBlockBtn = amxRow?.querySelector("button");
    if (amxBlockBtn) fireEvent.click(amxBlockBtn);

    expect(screen.getByText(/Rx-only medication/i)).toBeInTheDocument();
  });

  it("applies statutory 20% Senior/PWD discount and completes sale with receipt", async () => {
    renderWithProviders(<OtcSalesPage />);

    const discountChk = screen.getByLabelText(/Senior Citizen \/ PWD 20% Statutory Discount/i);
    fireEvent.click(discountChk);

    const idInput = screen.getByPlaceholderText(/Enter Senior Citizen \/ PWD ID Number/i);
    fireEvent.change(idInput, { target: { value: "OSCA-QC-2026-9901" } });

    expect(screen.getByText(/Senior \/ PWD 20% Discount:/i)).toBeInTheDocument();

    const completeBtn = screen.getByRole("button", { name: /Complete Sale/i });
    fireEvent.click(completeBtn);

    expect(await screen.findByText(/Official Sales Receipt/i)).toBeInTheDocument();
    expect(await screen.findByText(/OSCA-QC-2026-9901/i)).toBeInTheDocument();
  });
});

describe("MedicationAdminPage (todo §5.5, PHM-T6)", () => {
  it("enforces all 5 Rights before permitting administration record", async () => {
    renderWithProviders(<MedicationAdminPage />);
    expect(screen.getByText(/In-Clinic Medication Administration Record \(MAR\)/i)).toBeInTheDocument();

    const adminBtn = screen.getByRole("button", { name: /Confirm Administration & Record MAR/i });
    expect(adminBtn).toBeDisabled();

    // Check all 5 Rights
    fireEvent.click(screen.getByLabelText(/1. Right Patient/i));
    fireEvent.click(screen.getByLabelText(/2. Right Drug/i));
    fireEvent.click(screen.getByLabelText(/3. Right Dose/i));
    fireEvent.click(screen.getByLabelText(/4. Right Route & Site/i));
    fireEvent.click(screen.getByLabelText(/5. Right Time/i));

    expect(adminBtn).not.toBeDisabled();
    fireEvent.click(adminBtn);

    expect(await screen.findByText(/Medication administration recorded/i)).toBeInTheDocument();
  });
});
