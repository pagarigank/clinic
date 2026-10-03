import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { LabWorklistPage } from "../src/features/laboratory/LabWorklistPage.js";
import { ResultEntryPage } from "../src/features/laboratory/ResultEntryPage.js";
import { VerificationQueuePage } from "../src/features/laboratory/VerificationQueuePage.js";
import { CriticalAlertsPage } from "../src/features/laboratory/CriticalAlertsPage.js";
import { LabQcPage } from "../src/features/laboratory/LabQcPage.js";
import { LabReportsPage } from "../src/features/laboratory/LabReportsPage.js";
import { labApi } from "../src/features/laboratory/api.js";

// Mock AuthContext to provide an active user session
vi.mock("../src/shared/auth/AuthContext.js", () => ({
  useAuth: () => ({
    session: {
      userId: "current-user-id",
      name: "Current Tech",
      tenantId: "tenant-1",
      role: "tech",
      modules: ["laboratory"],
    },
    isAuthenticated: true,
  }),
  AuthProvider: ({ children }: any) => <>{children}</>,
}));

// Mock StepUpContext
vi.mock("../src/shared/auth/StepUpContext.js", () => ({
  useStepUp: () => ({
    promptStepUp: vi.fn().mockResolvedValue(true),
  }),
  StepUpProvider: ({ children }: any) => <>{children}</>,
}));

// Mock labApi methods
vi.mock("../src/features/laboratory/api.js", () => {
  const mockWorklist = [
    {
      order_item_id: "item-1",
      order_id: "order-1",
      order_no: "LAB-2026-000001",
      priority: "STAT",
      item_status: "ORDERED",
      test_id: "test-cbc",
      test_code: "CBC",
      test_name: "Complete Blood Count",
      is_panel: false,
      requires_pathologist_review: false,
      tat_minutes: 60,
      is_confidential: false,
      patient_id: "pat-1",
      mrn: "MRN-1001",
      first_name: "Juan",
      last_name: "Dela Cruz",
      gender: "MALE",
      date_of_birth: "1990-01-01",
      accession_no: "ACC-2026-000001",
      specimen_type_id: "spec-type-1",
      specimen_type_name: "Whole Blood",
      tube_top_color: "Lavender",
      ordered_at: new Date().toISOString(),
    },
    {
      order_item_id: "item-2",
      order_id: "order-2",
      order_no: "LAB-2026-000002",
      priority: "ROUTINE",
      item_status: "RESULTED",
      test_id: "test-glu",
      test_code: "GLU",
      test_name: "Fasting Blood Glucose",
      is_panel: false,
      requires_pathologist_review: false,
      tat_minutes: 120,
      is_confidential: false,
      patient_id: "pat-2",
      mrn: "MRN-1002",
      first_name: "Maria",
      last_name: "Santos",
      gender: "FEMALE",
      date_of_birth: "1985-05-15",
      accession_no: "ACC-2026-000002",
      specimen_type_id: "spec-type-2",
      specimen_type_name: "Serum",
      tube_top_color: "Red",
      ordered_at: new Date().toISOString(),
    },
    {
      order_item_id: "item-3",
      order_id: "order-2",
      order_no: "LAB-2026-000002",
      priority: "ROUTINE",
      item_status: "RELEASED",
      test_id: "test-glu",
      test_code: "GLU",
      test_name: "Fasting Blood Glucose",
      is_panel: false,
      requires_pathologist_review: false,
      tat_minutes: 120,
      is_confidential: false,
      patient_id: "pat-2",
      mrn: "MRN-1002",
      first_name: "Maria",
      last_name: "Santos",
      gender: "FEMALE",
      date_of_birth: "1985-05-15",
      accession_no: "ACC-2026-000002",
      specimen_type_id: "spec-type-2",
      specimen_type_name: "Serum",
      tube_top_color: "Red",
      ordered_at: new Date().toISOString(),
    },
  ];

  const mockTests = [
    {
      id: "test-cbc",
      section_id: "sec-1",
      specimen_type_id: "spec-type-1",
      code: "CBC",
      name: "Complete Blood Count",
      tat_minutes: 60,
      is_stat_allowed: true,
      is_confidential: false,
      fasting_required: false,
      is_panel: false,
      requires_pathologist_review: false,
      is_active: true,
      analytes: [
        {
          id: "an-hgb",
          test_id: "test-cbc",
          code: "HGB",
          name: "Hemoglobin",
          default_unit: "g/dL",
          precision_digits: 1,
          is_calculated: false,
          sort_order: 1,
          is_active: true,
          reference_range: {
            normal_min: 12.0,
            normal_max: 16.0,
            critical_low: 7.0,
            critical_high: 20.0,
          },
        },
      ],
    },
  ];

  const mockInstruments = [
    {
      id: "inst-1",
      branch_id: "branch-1",
      section_id: "sec-1",
      code: "SYS-01",
      name: "Sysmex XN-550",
      is_active: true,
      section_name: "Hematology",
    },
  ];

  const mockResults = [
    {
      id: "res-1",
      tenant_id: "tenant-1",
      order_item_id: "item-2",
      analyte_id: "an-glu",
      analyte_code: "GLU",
      analyte_name: "Glucose",
      default_unit: "mg/dL",
      precision_digits: 1,
      is_calculated: false,
      value_numeric: 450.0,
      flag: "HH",
      status: "PRELIMINARY",
      entered_by: "current-user-id", // Same as mocked user session to test AC-17 SoD!
      entered_by_name: "Current Tech",
      entered_at: new Date().toISOString(),
    },
  ];

  const mockAlerts = [
    {
      id: "alert-1",
      result_id: "res-1",
      order_id: "order-2",
      order_no: "LAB-2026-000002",
      patient_id: "pat-2",
      patient_name: "Maria Santos",
      mrn: "MRN-1002",
      test_name: "Fasting Blood Glucose",
      analyte_name: "Glucose",
      value: "450.0",
      unit: "mg/dL",
      flag: "HH",
      created_at: new Date(Date.now() - 15 * 60 * 1000).toISOString(),
      is_escalated: true,
    },
  ];

  const mockQcRuns = [
    {
      id: "qc-run-1",
      instrument_id: "inst-1",
      material_id: "mat-1",
      run_at: new Date().toISOString(),
      run_by: "tech-1",
      status: "ACCEPTED",
      instrument_name: "Sysmex XN-550",
      material_name: "Hematology Control Level 2",
      lot_no: "LOT-8891",
      results: [
        {
          id: "qc-res-1",
          analyte_id: "an-hgb",
          analyte_name: "Hemoglobin",
          value_num: 14.1,
          target_mean: 14.0,
          target_sd: 0.5,
          z_score: 0.2,
          westgard_flags: null,
          is_accepted: true,
        },
      ],
    },
  ];

  const mockReports = [
    {
      id: "rep-1",
      order_id: "order-2",
      version: 1,
      report_hash: "a3b5c7d9e1f20485963214785236987410258963147852369874102589631478",
      issued_at: new Date().toISOString(),
      issued_by: "usr-path-1",
      issued_by_name: "Dr. Alicia Ramos, FPSP",
      status: "FINAL",
      report_data: {
        order: { order_no: "LAB-2026-000002" },
        patient: { last_name: "Santos", first_name: "Maria", mrn: "MRN-1002", gender: "F" },
        results: [
          {
            analyte_name: "Glucose",
            value_numeric: 450,
            default_unit: "mg/dL",
            flag: "HH",
            reference_range: { normal_min: 70, normal_max: 100 },
          },
        ],
      },
    },
  ];

  return {
    labApi: {
      getWorklist: vi.fn().mockImplementation((params) => {
        if (params?.status === "RESULTED") {
          return Promise.resolve(mockWorklist.filter((w) => w.item_status === "RESULTED"));
        }
        if (params?.status === "RELEASED") {
          return Promise.resolve(mockWorklist.filter((w) => w.item_status === "RELEASED"));
        }
        return Promise.resolve(mockWorklist);
      }),
      listTests: vi.fn().mockResolvedValue(mockTests),
      getTest: vi.fn().mockResolvedValue(mockTests[0]),
      listSpecimenTypes: vi.fn().mockResolvedValue([
        { id: "spec-type-1", code: "WB", name: "Whole Blood", default_container: "EDTA Tube", tube_top_color: "Lavender", is_active: true },
      ]),
      listInstruments: vi.fn().mockResolvedValue(mockInstruments),
      listQcMaterials: vi.fn().mockResolvedValue([
        { id: "mat-1", section_id: "sec-1", code: "QC-HEM-2", name: "Hematology Control Level 2", lot_no: "LOT-8891", expiry_date: "2027-01-01", is_active: true },
      ]),
      listQcRuns: vi.fn().mockResolvedValue(mockQcRuns),
      getOrder: vi.fn().mockResolvedValue({
        id: "order-1",
        order_no: "LAB-2026-000001",
        priority: "STAT",
        first_name: "Juan",
        last_name: "Dela Cruz",
        mrn: "MRN-1001",
        gender: "MALE",
        items: [{ id: "item-1", test_id: "test-cbc" }],
      }),
      getItemResults: vi.fn().mockResolvedValue(mockResults),
      listCriticalAlerts: vi.fn().mockResolvedValue(mockAlerts),
      listReports: vi.fn().mockResolvedValue(mockReports),
      createOrder: vi.fn().mockResolvedValue({ success: true }),
      collectSpecimen: vi.fn().mockResolvedValue({ accessionNo: "ACC-2026-000001" }),
      receiveSpecimen: vi.fn().mockResolvedValue({ success: true }),
      enterResults: vi.fn().mockResolvedValue({ success: true }),
      verifyResult: vi.fn().mockResolvedValue({ success: true }),
      amendResult: vi.fn().mockResolvedValue({ success: true }),
      acknowledgeCriticalAlert: vi.fn().mockResolvedValue({ success: true }),
      releaseReport: vi.fn().mockResolvedValue(mockReports[0]),
      createQcRun: vi.fn().mockResolvedValue({ success: true }),
    },
  };
});

function renderWithProviders(ui: React.ReactElement) {
  return render(
    <MemoryRouter>
      {ui}
    </MemoryRouter>
  );
}

describe("Laboratory Frontend Suite (Phase 6, todo.md §6)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllTimers();
  });

  describe("LabWorklistPage (LAB-T1, LAB-T2, LAB-T3)", () => {
    it("renders worklist items with priority badges and scanner", async () => {
      renderWithProviders(<LabWorklistPage />);

      expect(await screen.findByText(/Laboratory Workbench & Worklist/i)).toBeInTheDocument();
      expect(screen.getByText("LAB-2026-000001")).toBeInTheDocument();
      expect(screen.getByText(/Dela Cruz/i)).toBeInTheDocument();
      expect(screen.getAllByText(/STAT/i).length).toBeGreaterThan(0);
      expect(screen.getByPlaceholderText(/Scan Accession barcode/i)).toBeInTheDocument();
    });

    it("opens specimen collection modal and enforces two-identifier confirmation", async () => {
      renderWithProviders(<LabWorklistPage />);

      const collectBtn = await screen.findByRole("button", { name: /Collect Specimen/i });
      fireEvent.click(collectBtn);

      expect(screen.getByText(/Specimen Collection \(Phlebotomy\)/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/Two-Identifier Verification Confirmed/i)).toBeInTheDocument();

      const submitBtn = screen.getByRole("button", { name: /Collect & Print Accession/i });
      expect(submitBtn).toBeDisabled();

      // Check two-identifier verification
      const check = screen.getByLabelText(/Two-Identifier Verification Confirmed/i);
      fireEvent.click(check);
      expect(submitBtn).not.toBeDisabled();
    });
  });

  describe("VerificationQueuePage (AC-17 Segregation of Duties)", () => {
    it("enforces SoD: blocks verification and shows warning when current user is the encoder", async () => {
      renderWithProviders(<VerificationQueuePage />);

      const reviewBtn = await screen.findByRole("button", { name: /Review & Verify/i });
      fireEvent.click(reviewBtn);

      // Verify modal opens
      expect(await screen.findByText(/Result Verification & Approval/i)).toBeInTheDocument();

      // Verify AC-17 SoD message is prominently displayed explaining WHY encoder cannot verify
      expect(
        screen.getByText(/Encoder cannot verify own result \(AC-17 Segregation of Duties\)/i)
      ).toBeInTheDocument();

      // Verify action buttons are disabled due to SoD
      expect(screen.getByRole("button", { name: /Verification Blocked/i })).toBeDisabled();
    });
  });

  describe("CriticalAlertsPage (AC-10 Verbal Read-back)", () => {
    it("renders panic value alerts and requires read-back confirmation to acknowledge", async () => {
      renderWithProviders(<CriticalAlertsPage />);

      expect(await screen.findByText(/Critical Panic Value Notifications \(AC-10\)/i)).toBeInTheDocument();
      expect(screen.getByText("Maria Santos")).toBeInTheDocument();
      expect(screen.getByText(/450.0 mg\/dL/i)).toBeInTheDocument();

      const ackBtn = screen.getByRole("button", { name: /Acknowledge & Read-back/i });
      fireEvent.click(ackBtn);

      expect(screen.getByText(/Verbal Read-Back Acknowledgment \(AC-10\)/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/Mandatory Read-Back Confirmation Text/i)).toBeInTheDocument();

      const confirmBtn = screen.getByRole("button", { name: /Confirm Read-Back & Close Alert/i });
      expect(confirmBtn).toBeDisabled();

      const checkbox = screen.getByLabelText(/verbal read-back was conducted/i);
      fireEvent.click(checkbox);
      expect(confirmBtn).not.toBeDisabled();
    });
  });

  describe("LabQcPage (LAB-T5 Levey-Jennings & Westgard)", () => {
    it("renders Levey-Jennings control chart and QC run history", async () => {
      renderWithProviders(<LabQcPage />);

      expect(await screen.findByText(/Quality Control & Levey–Jennings \(LAB-T5\)/i)).toBeInTheDocument();
      expect(screen.getByText(/Levey–Jennings Control Chart/i)).toBeInTheDocument();
      expect(screen.getAllByText(/Sysmex XN-550/i).length).toBeGreaterThan(0);
      expect(screen.getByText(/Passed All Rules/i)).toBeInTheDocument();
    });
  });

  describe("LabReportsPage (LAB-T8 SHA-256 Integrity)", () => {
    it("renders released reports with cryptographic SHA-256 integrity hash", async () => {
      renderWithProviders(<LabReportsPage />);

      expect(await screen.findByText(/Official Released Laboratory Reports \(LAB-T8\)/i)).toBeInTheDocument();
      expect(await screen.findByText("LAB-2026-000002")).toBeInTheDocument();
      expect(screen.getByText(/a3b5c7d9e1f20485963214785236987410258963147852369874102589631478/i)).toBeInTheDocument();

      const viewBtn = screen.getByRole("button", { name: /View Report/i });
      fireEvent.click(viewBtn);

      expect(screen.getByText(/Official Diagnostic Laboratory Report/i)).toBeInTheDocument();
      expect(screen.getByText(/Cryptographic Document Seal/i)).toBeInTheDocument();
    });
  });
});
