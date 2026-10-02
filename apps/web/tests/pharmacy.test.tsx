import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { AuthProvider } from "../src/shared/auth/AuthContext.js";
import { StepUpProvider } from "../src/shared/auth/StepUpContext.js";
import { PharmacyQueuePage } from "../src/features/pharmacy/PharmacyQueuePage.js";
import { DispenseWorkbenchPage } from "../src/features/pharmacy/DispenseWorkbenchPage.js";
import { ControlledRegisterPage } from "../src/features/pharmacy/ControlledRegisterPage.js";
import { OtcSalesPage } from "../src/features/pharmacy/OtcSalesPage.js";
import { MedicationAdminPage } from "../src/features/pharmacy/MedicationAdminPage.js";

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

describe("PharmacyQueuePage (todo §5.1, PHM-T1)", () => {
  it("renders queue, patient details, and clinical safety alerts", async () => {
    renderWithProviders(<PharmacyQueuePage />);
    expect(screen.getByText(/Prescription Verification Queue/i)).toBeInTheDocument();
    expect(screen.getByText("RX-2026-00412")).toBeInTheDocument();
    expect(screen.getByText("Clara Dela Cruz")).toBeInTheDocument();
    expect(screen.getByText(/Allergies: Penicillin, Amoxicillin/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Critical Alert/i).length).toBeGreaterThan(0);
  });

  it("filters prescriptions by status", async () => {
    renderWithProviders(<PharmacyQueuePage />);
    const verifiedBtn = screen.getByRole("button", { name: "VERIFIED" });
    fireEvent.click(verifiedBtn);

    expect(screen.getByText("RX-2026-00409")).toBeInTheDocument();
    expect(screen.queryByText("RX-2026-00412")).not.toBeInTheDocument();
  });

  it("opens verification modal with patient banner, items, and safety findings", async () => {
    renderWithProviders(<PharmacyQueuePage />);
    const verifyButtons = screen.getAllByRole("button", { name: /Verify Rx/i });
    fireEvent.click(verifyButtons[0]!);

    expect(screen.getByText(/Clinical Pharmacist Verification/i)).toBeInTheDocument();
    expect(screen.getByText(/Known Severe Beta-Lactam Allergy Detected/i)).toBeInTheDocument();
    expect(screen.getByText(/Clinical Override Justification/i)).toBeInTheDocument();
  });

  it("approves prescription with override reason and clears for dispensing", async () => {
    renderWithProviders(<PharmacyQueuePage />);
    const verifyButtons = screen.getAllByRole("button", { name: /Verify Rx/i });
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
  it("renders prescribed lines and FEFO batch recommendations", async () => {
    renderWithProviders(<DispenseWorkbenchPage />);
    expect(screen.getByText(/Pharmacy Dispense Workbench/i)).toBeInTheDocument();
    expect(screen.getByText("Paracetamol 500mg Tablet")).toBeInTheDocument();
    expect(screen.getAllByText(/FEFO Earliest Expiry Matched/i).length).toBeGreaterThan(0);
  });

  it("enforces AC-7 controlled substance verification (yellow slip, words/numerals, witness)", async () => {
    renderWithProviders(<DispenseWorkbenchPage />);
    const ctrlToggle = screen.getByRole("button", { name: /Switch to AC-7 Controlled Demo/i });
    fireEvent.click(ctrlToggle);

    expect(screen.getByText(/AC-7 Controlled Substance Dispensing Flow Active/i)).toBeInTheDocument();
    expect(screen.getByText("Morphine Sulfate 10mg/mL Ampoule")).toBeInTheDocument();

    const ac7Btn = screen.getByRole("button", { name: /Complete AC-7 Requirements/i });
    fireEvent.click(ac7Btn);

    expect(screen.getByText(/AC-7 Dangerous Drug Dispense Protocol/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/PDEA Special Rx Yellow Slip Serial No./i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Quantity in Words/i)).toBeInTheDocument();

    const witnessSelect = screen.getByLabelText(/Witness User/i);
    fireEvent.change(witnessSelect, { target: { value: "usr-phm-2" } });

    const verifyAc7Btn = screen.getByRole("button", { name: /Verify & Attest AC-7 Record/i });
    fireEvent.click(verifyAc7Btn);

    expect(screen.getByText(/AC-7 Witness Verified/i)).toBeInTheDocument();
  });

  it("posts dispense transaction and generates printable Rx labels", async () => {
    renderWithProviders(<DispenseWorkbenchPage />);
    const postBtn = screen.getByRole("button", { name: /Post Dispense & Deduct Stock/i });
    fireEvent.click(postBtn);

    expect(await screen.findByText(/Dispense posted successfully/i)).toBeInTheDocument();
    expect(screen.getAllByText(/POSTED/i).length).toBeGreaterThan(0);

    const printLabelBtn = screen.getByRole("button", { name: /Print Rx Labels/i });
    fireEvent.click(printLabelBtn);

    expect(screen.getByText(/Rx Label Preview/i)).toBeInTheDocument();
    expect(screen.getAllByText(/METROPOLIS CLINIC & PHARMACY/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/CAUTION: Take exactly as directed/i).length).toBeGreaterThan(0);
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
