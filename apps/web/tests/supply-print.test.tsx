import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ConsumptionPrintModal } from "../src/features/supply/ConsumptionPrintModal.js";
import { GrnPrintModal } from "../src/features/supply/GrnPrintModal.js";

// Mock client API calls
vi.mock("../src/shared/api/client.js", () => ({
  apiGet: vi.fn().mockImplementation((url: string) => {
    if (url.includes("/supply/consumption/print-profile") || url.includes("/supply/goods-receipts/")) {
      return Promise.resolve({
        clinic: {
          name: "La Salette Medical Center",
          branchName: "Central Warehouse & Pharmacy Store",
          address: "100 Medical Center Way, Manila",
          phone: "(02) 8524-1000",
          email: "materials@lasalette.ph",
        },
        officer: {
          name: "Roberto Cruz, Materials Manager",
        },
        locations: [
          { id: "loc-central", name: "Central Pharmacy Store" },
          { id: "loc-supply", name: "Central Supply Store" },
        ],
        grn: {
          id: "grn-2026-101",
          grn_no: "GRN-2026-00088",
          received_by_name: "Roberto Cruz",
          supplier_name: "Metro Pharma Distribution Inc.",
          location_name: "Central Pharmacy Store",
          notes: "Received in pristine condition.",
        },
      });
    }
    return Promise.resolve({});
  }),
  apiGetBlob: vi.fn().mockResolvedValue(new Blob(["%PDF-1.7 mock supply vector pdf"], { type: "application/pdf" })),
  apiPostBlob: vi.fn().mockResolvedValue(new Blob(["%PDF-1.7 mock draft grn vector pdf"], { type: "application/pdf" })),
  apiPost: vi.fn().mockResolvedValue({}),
  ApiError: class ApiError extends Error {
    problem = { title: "Error", detail: "Problem" };
  },
}));

describe("Central Supply True PDF Print Modals", () => {
  beforeEach(() => {
    if (!window.URL.createObjectURL) {
      window.URL.createObjectURL = vi.fn().mockReturnValue("blob:http://localhost/mock-supply-pdf");
    }
    if (!window.URL.revokeObjectURL) {
      window.URL.revokeObjectURL = vi.fn();
    }
  });

  describe("ConsumptionPrintModal Component", () => {
    it("renders consumption print modal with official vector PDF iframe and letterhead controls", async () => {
      const handleClose = vi.fn();
      render(
        <ConsumptionPrintModal
          isOpen={true}
          onClose={handleClose}
          defaultLocationId="loc-central"
          defaultLocationName="Central Pharmacy Store"
        />
      );

      expect(screen.getByText(/Central Supply Consumption & Issuance Print Center/i)).toBeInTheDocument();
      expect(screen.getByText(/Stock Consumption & Issuance Register/i)).toBeInTheDocument();

      // Action buttons
      expect(screen.getByRole("button", { name: /Print Document/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Download PDF/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Open in Tab/i })).toBeInTheDocument();

      // Toggle configuration drawer
      const configBtn = screen.getByRole("button", { name: /Filters \/ Letterhead/i });
      fireEvent.click(configBtn);

      await waitFor(() => {
        expect(screen.getByText(/Period & Letterhead/i)).toBeInTheDocument();
        expect(screen.getByText(/Clinic \/ Facility Name/i)).toBeInTheDocument();
        expect(screen.getByText(/Prepared By \(Officer\)/i)).toBeInTheDocument();
      });
    });
  });

  describe("GrnPrintModal Component", () => {
    const mockDraftGrn = {
      grnNo: "GRN-2026-99001",
      supplierName: "Metro Pharma Distribution Inc. (SUP-001)",
      locationName: "Central Pharmacy Store",
      deliveryNoteNo: "DR-2026-8912",
      lines: [
        {
          itemCode: "i-amox",
          itemName: "Amoxicillin 500mg Capsule",
          lotNo: "LOT-AMX-2026B",
          expiryDate: "2028-06-30",
          qtyReceived: 500,
          uomCode: "CAP",
          unitCost: 8.5,
          inspectionResult: "PASS",
        },
      ],
      notes: "Delivered intact with cold chain verified.",
    };

    it("renders Goods Receipt Note print modal with preview and signoff controls", async () => {
      const handleClose = vi.fn();
      render(
        <GrnPrintModal
          isOpen={true}
          onClose={handleClose}
          draftGrn={mockDraftGrn}
        />
      );

      expect(screen.getByText(/Official Goods Receipt Note \(GRN\) Print Center/i)).toBeInTheDocument();
      expect(screen.getByText(/Official Receiving Document/i)).toBeInTheDocument();
      expect(screen.getAllByText(/GRN-2026-99001/i).length).toBeGreaterThan(0);

      // Action buttons
      expect(screen.getByRole("button", { name: /Print GRN/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Download PDF/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Open in Tab/i })).toBeInTheDocument();

      // Toggle configuration drawer
      const configBtn = screen.getByRole("button", { name: /Letterhead \/ Signoffs/i });
      fireEvent.click(configBtn);

      await waitFor(() => {
        expect(screen.getByText(/Letterhead & Signatories/i)).toBeInTheDocument();
        expect(screen.getByText(/Received By \(Officer\)/i)).toBeInTheDocument();
        expect(screen.getByText(/Inspected & Verified By/i)).toBeInTheDocument();
      });
    });

    it("renders with existing GRN ID", async () => {
      const handleClose = vi.fn();
      render(
        <GrnPrintModal
          isOpen={true}
          onClose={handleClose}
          grnId="grn-2026-101"
        />
      );

      expect(screen.getByText(/Official Goods Receipt Note \(GRN\) Print Center/i)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Print GRN/i })).toBeInTheDocument();
    });
  });
});
