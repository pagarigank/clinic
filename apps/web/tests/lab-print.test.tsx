import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { LabReportPrintModal } from "../src/features/laboratory/LabReportPrintModal.js";
import type { LabReport } from "../src/features/laboratory/api.js";

// Mock client API calls
vi.mock("../src/shared/api/client.js", () => ({
  apiGet: vi.fn().mockResolvedValue({
    clinic: {
      name: "St. Jude Clinic",
      branchName: "Main Branch",
      address: "123 Medical Way",
      phone: "(02) 8123-4567",
      email: "lab@stjude.emr",
      dohLicenseNo: "DOH-LTO-2026-0099",
      philhealthAccreditationNo: "PH-992211",
    },
    pathologist: {
      name: "Dr. Alicia Ramos, MD",
      title: "Anatomic & Clinical Pathologist, FPSP",
      licenseNo: "0088776",
    },
    medtech: {
      name: "Juan Dela Cruz, RMT",
      title: "Registered Medical Technologist",
      licenseNo: "0011223",
    },
    report: {
      id: "rep-101",
      orderNo: "LAB-2026-9999",
      specimenType: "Venous Blood",
      orderingClinician: "Dr. Gregory House, MD",
      notes: "Routine examination normal",
    },
  }),
  apiGetBlob: vi.fn().mockResolvedValue(new Blob(["%PDF-1.7 mock pdf content"], { type: "application/pdf" })),
  ApiError: class ApiError extends Error {
    problem = { title: "Error", detail: "Problem" };
  },
}));

describe("LabReportPrintModal Component", () => {
  const mockReport: LabReport = {
    id: "rep-101",
    order_id: "order-9999",
    version: 1,
    sha256_hash: "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210",
    report_hash: "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210",
    issued_at: new Date().toISOString(),
    issued_by: "usr-path-1",
    issued_by_name: "Dr. Alicia Ramos",
    status: "FINAL",
    report_data: {
      order: { order_no: "LAB-2026-9999" },
      patient: { family_name: "Dela Cruz", given_name: "Juan" },
    },
  };

  beforeEach(() => {
    // Mock URL.createObjectURL and URL.revokeObjectURL in jsdom
    if (!window.URL.createObjectURL) {
      window.URL.createObjectURL = vi.fn().mockReturnValue("blob:http://localhost/mock-lab-pdf");
    }
    if (!window.URL.revokeObjectURL) {
      window.URL.revokeObjectURL = vi.fn();
    }
  });

  it("renders print modal with official vector PDF iframe and controls", async () => {
    const handleClose = vi.fn();
    render(<LabReportPrintModal isOpen={true} onClose={handleClose} report={mockReport} />);

    expect(screen.getByText(/Official Diagnostic Laboratory Report Print Center/i)).toBeInTheDocument();
    expect(screen.getByText(/Cryptographic Document Seal:/i)).toBeInTheDocument();
    expect(screen.getByText(/fedcba9876543210/i)).toBeInTheDocument();

    // Check action buttons
    expect(screen.getByRole("button", { name: /Print Report/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Download PDF/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Open in Tab/i })).toBeInTheDocument();

    // Toggle configuration drawer
    const configBtn = screen.getByRole("button", { name: /Doctor \/ Letterhead/i });
    fireEvent.click(configBtn);

    // Verify licensure and letterhead fields appear
    await waitFor(() => {
      expect(screen.getByText(/Letterhead & Licensure/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/Pathologist Name/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/Registered Medical Technologist/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/Laboratory \/ Clinic Name/i)).toBeInTheDocument();
    });

    // Edit clinic name
    const clinicInput = screen.getByLabelText(/Laboratory \/ Clinic Name/i);
    fireEvent.change(clinicInput, { target: { value: "Metro Health Laboratories" } });
    expect(clinicInput).toHaveValue("Metro Health Laboratories");
  });
});
