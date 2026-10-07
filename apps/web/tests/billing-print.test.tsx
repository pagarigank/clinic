import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { InvoicePrintModal } from "../src/features/billing/InvoicePrintModal.js";
import { ReceiptPrintModal } from "../src/features/billing/ReceiptPrintModal.js";

// Mock client API calls
vi.mock("../src/shared/api/client.js", () => ({
  apiGet: vi.fn().mockImplementation((url: string) => {
    if (url.includes("/billing/invoices/")) {
      return Promise.resolve({
        clinic: {
          name: "La Salette Medical Center",
          branchName: "Main Branch",
          address: "100 Medical Center Way, Manila",
          phone: "(02) 8524-1000",
          email: "billing@lasalette.ph",
          tin: "009-876-543-000",
          dohLicenseNo: "DOH-LTO-01449-NCR",
          philhealthAccreditationNo: "PHIC-ACC-98765-PCP",
        },
        billingOfficer: {
          name: "Maria Clara, RMT / Cashier",
        },
        invoice: {
          notes: "Settlement due within 15 days.",
        },
      });
    }
    if (url.includes("/billing/payments/")) {
      return Promise.resolve({
        clinic: {
          name: "La Salette Medical Center",
          branchName: "Main Branch",
          address: "100 Medical Center Way, Manila",
          phone: "(02) 8524-1000",
          email: "billing@lasalette.ph",
          tin: "009-876-543-000",
          dohAccreditationNo: "DOH-LTO-01449-NCR",
          philhealthAccreditationNo: "PHIC-ACC-98765-PCP",
        },
        cashier: {
          name: "M. Aquino",
        },
        payment: {
          amount: 1500,
          tendered: 2000,
          change: 500,
        },
      });
    }
    return Promise.resolve({});
  }),
  apiGetBlob: vi.fn().mockResolvedValue(new Blob(["%PDF-1.7 mock vector pdf content"], { type: "application/pdf" })),
  apiPost: vi.fn().mockResolvedValue({
    id: "pmt-101",
    reprint_count: 1,
    reprintCount: 1,
  }),
  ApiError: class ApiError extends Error {
    problem = { title: "Error", detail: "Problem" };
  },
}));

describe("Billing True PDF Print Modals", () => {
  beforeEach(() => {
    if (!window.URL.createObjectURL) {
      window.URL.createObjectURL = vi.fn().mockReturnValue("blob:http://localhost/mock-billing-pdf");
    }
    if (!window.URL.revokeObjectURL) {
      window.URL.revokeObjectURL = vi.fn();
    }
  });

  describe("InvoicePrintModal Component", () => {
    const mockInvoice = {
      id: "inv-101",
      invoice_no: "INV-2026-00088",
      patient_first_name: "Juan",
      patient_last_name: "Dela Cruz",
      patient_number: "P-000123",
      total: 1300,
      balance: 800,
      status: "OPEN",
      issued_at: new Date().toISOString(),
      sha256: "aabbcc1122334455aabbcc1122334455aabbcc1122334455aabbcc1122334455",
    };

    it("renders invoice print modal with official vector PDF iframe and letterhead controls", async () => {
      const handleClose = vi.fn();
      render(<InvoicePrintModal isOpen={true} onClose={handleClose} invoice={mockInvoice} />);

      expect(screen.getByText(/Official Billing Invoice Print Center/i)).toBeInTheDocument();
      expect(screen.getByText(/Cryptographic Document Digest:/i)).toBeInTheDocument();
      expect(screen.getByText(/aabbcc1122334455/i)).toBeInTheDocument();

      // Check action buttons
      expect(screen.getByRole("button", { name: /Print Invoice/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Download PDF/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Open in Tab/i })).toBeInTheDocument();

      // Toggle configuration drawer
      const configBtn = screen.getByRole("button", { name: /Letterhead \/ Officer/i });
      fireEvent.click(configBtn);

      // Verify fields appear
      await waitFor(() => {
        expect(screen.getByText(/Letterhead & Officer/i)).toBeInTheDocument();
        expect(screen.getByText(/Clinic \/ Facility Name/i)).toBeInTheDocument();
        expect(screen.getByText(/Tax Identification No. \(TIN\)/i)).toBeInTheDocument();
        expect(screen.getByText(/Authorized Billing Officer/i)).toBeInTheDocument();
      });
    });
  });

  describe("ReceiptPrintModal Component", () => {
    const mockPayment = {
      id: "pmt-101",
      payment_no: "OR-2026-000456",
      receiptNumber: "OR-2026-000456",
      amount: 1500,
      tendered_amount: 2000,
      change_amount: 500,
      method_name: "Cash",
      invoice_no: "INV-2026-00088",
      received_at: new Date().toISOString(),
      patient_first_name: "Juan",
      patient_last_name: "Dela Cruz",
      receipt_sha256: "1122334455667788112233445566778811223344556677881122334455667788",
    };

    it("renders official receipt print modal with vector PDF iframe and audited reprint option", async () => {
      const handleClose = vi.fn();
      render(<ReceiptPrintModal isOpen={true} onClose={handleClose} payment={mockPayment} />);

      expect(screen.getByText(/Official Receipt \(OR\) Print Center/i)).toBeInTheDocument();
      expect(screen.getByText(/Cryptographic Receipt Seal:/i)).toBeInTheDocument();
      expect(screen.getByText(/1122334455667788/i)).toBeInTheDocument();

      // Check action buttons
      expect(screen.getByRole("button", { name: /Print Receipt/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Download PDF/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Open in Tab/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Audited Reprint/i })).toBeInTheDocument();

      // Toggle configuration drawer
      const configBtn = screen.getByRole("button", { name: /Letterhead \/ Cashier/i });
      fireEvent.click(configBtn);

      await waitFor(() => {
        expect(screen.getByText(/Letterhead & Cashier/i)).toBeInTheDocument();
        expect(screen.getByText(/Issuing Cashier/i)).toBeInTheDocument();
      });
    });
  });
});
