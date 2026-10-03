import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { AuthProvider } from "../src/shared/auth/AuthContext.js";
import { StepUpProvider } from "../src/shared/auth/StepUpContext.js";
import { CompliancePage } from "../src/features/compliance/CompliancePage.js";
import * as api from "../src/features/compliance/api.js";

// Mock API module
vi.mock("../src/features/compliance/api.js", () => ({
  fetchAuditLogs: vi.fn(),
  fetchAuditLogDetail: vi.fn(),
  fetchPhiAccessLogs: vi.fn(),
  fetchPatientPhiAccess: vi.fn(),
  fetchDsrRequests: vi.fn(),
  createDsrRequest: vi.fn(),
  verifyDsrIdentity: vi.fn(),
  completeDsrRequest: vi.fn(),
  rejectDsrRequest: vi.fn(),
  extendDsrDeadline: vi.fn(),
  exportPatientDsrData: vi.fn(),
  fetchBreachIncidents: vi.fn(),
  reportBreach: vi.fn(),
  assessBreach: vi.fn(),
  recordBreachNotification: vi.fn(),
  closeBreach: vi.fn(),
  fetchRetentionPolicies: vi.fn(),
  updateRetentionPolicy: vi.fn(),
  fetchLegalHolds: vi.fn(),
  createLegalHold: vi.fn(),
  releaseLegalHold: vi.fn(),
  fetchRetentionCandidates: vi.fn(),
  approveRetentionCandidates: vi.fn(),
  holdRetentionCandidates: vi.fn(),
  fetchAccessReviews: vi.fn(),
  fetchAccessReview: vi.fn(),
  createAccessReview: vi.fn(),
  recordAccessDecision: vi.fn(),
  completeAccessReview: vi.fn(),
  fetchPidsrCases: vi.fn(),
  createPidsrCase: vi.fn(),
  updatePidsrCaseStatus: vi.fn(),
}));

function renderWithProviders(ui: React.ReactElement, initialEntries: string[] = ["/compliance"]) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <AuthProvider>
        <StepUpProvider>{ui}</StepUpProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe("CompliancePage (Phase 8 — Compliance, audit, consent, DSR, retention)", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    if (!globalThis.URL.createObjectURL) {
      globalThis.URL.createObjectURL = vi.fn(() => "blob:mock-url");
    }
    if (!globalThis.URL.revokeObjectURL) {
      globalThis.URL.revokeObjectURL = vi.fn();
    }

    vi.mocked(api.fetchAuditLogs).mockResolvedValue({
      data: [
        {
          id: "aud-001",
          created_at: new Date().toISOString(),
          action: "UPDATE",
          entity_type: "patients",
          entity_id: "p-001-uuid",
          actor_id: "usr-001",
          actor_name: "Dr. Maria Santos",
        },
      ],
      total: 1,
    });

    vi.mocked(api.fetchPhiAccessLogs).mockResolvedValue({
      data: [
        {
          id: "phi-001",
          created_at: new Date().toISOString(),
          actor_id: "usr-001",
          actor_name: "Dr. Maria Santos",
          patient_id: "p-001-uuid",
          patient_name: "Juan Dela Cruz",
          resource: "VISIT_CHART",
          purpose: "TREATMENT",
          ip_address: "192.168.1.10",
          is_anomaly: false,
        },
      ],
      total: 1,
    });

    vi.mocked(api.fetchDsrRequests).mockResolvedValue([
      {
        id: "dsr-001",
        request_no: "DSR-2026-0001",
        first_name: "Juan",
        last_name: "Dela Cruz",
        patient_no: "P-000123",
        type: "ACCESS",
        status: "IN_PROGRESS",
        identity_verified_at: new Date().toISOString(),
        due_at: new Date(Date.now() + 25 * 86400000).toISOString(),
      },
    ]);

    vi.mocked(api.fetchBreachIncidents).mockResolvedValue([
      {
        id: "brc-001",
        incident_no: "BRC-2026-0001",
        description: "Misdirected patient statement email batch",
        severity: "HIGH",
        status: "REPORTED",
        affected_count: 5,
        notified_regulator: false,
        notify_regulator_due_at: new Date(Date.now() + 48 * 3600000).toISOString(),
      },
    ]);

    vi.mocked(api.fetchRetentionPolicies).mockResolvedValue([
      {
        id: "pol-001",
        record_class: "CLINICAL_VISITS",
        retention_years: 10,
        legal_basis: "DOH AO 2021-0037 / RA 9439",
        is_active: true,
      },
    ]);

    vi.mocked(api.fetchLegalHolds).mockResolvedValue([
      {
        id: "hld-001",
        hold_no: "HLD-2026-0001",
        scope: "ENTIRE_TENANT",
        reason: "Subpoena duces tecum RTC Br. 12",
        placed_at: new Date().toISOString(),
        released_at: null,
      },
    ]);

    vi.mocked(api.fetchRetentionCandidates).mockResolvedValue([
      {
        id: "cand-001",
        record_class: "CLINICAL_VISITS",
        entity_ref: "VISIT-2015-0982",
        first_name: "Pedro",
        last_name: "Penduko",
        eligible_at: "2025-10-01",
        status: "HELD",
        hold_no: "HLD-2026-0001",
      },
    ]);

    vi.mocked(api.fetchAccessReviews).mockResolvedValue([
      {
        id: "rev-001",
        campaign_name: "Q4 2026 Entitlement Review",
        started_at: new Date().toISOString(),
        status: "IN_PROGRESS",
        reviewer_name: "Compliance Officer",
        decision_count: 14,
      },
    ]);

    vi.mocked(api.fetchPidsrCases).mockResolvedValue([
      {
        id: "pid-001",
        case_no: "PIDSR-2026-0001",
        disease_name: "Dengue Fever / Hemorrhagic Fever",
        icd10_code: "A90",
        first_name: "Maria",
        last_name: "Clara",
        patient_no: "P-000456",
        date_of_onset: "2026-09-28",
        classification: "PROBABLE",
        status: "INVESTIGATING",
        cif_data: { feverDays: 4, hospitalized: false },
      },
    ]);
  });

  it("8.1 Audit Explorer: renders page header, audit events, and integrity status", async () => {
    renderWithProviders(<CompliancePage />);

    expect(screen.getByText(/Compliance & Audit Governance/i)).toBeInTheDocument();
    expect(screen.getByText(/🔒 Verified Intact/i)).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("Dr. Maria Santos")).toBeInTheDocument();
    });
    expect(screen.getAllByText("patients").length).toBeGreaterThanOrEqual(1);
  });

  it("8.2 DSR & AC-15: renders DSR list and triggers AC-15 export download", async () => {
    const exportBundle = {
      exportMetadata: { dsrId: "dsr-001", patientId: "p-001" },
      patient: { id: "p-001", first_name: "Juan", last_name: "Dela Cruz" },
    };
    vi.mocked(api.exportPatientDsrData).mockResolvedValue(exportBundle);

    renderWithProviders(<CompliancePage />, ["/compliance?tab=dsr"]);

    await waitFor(() => {
      expect(screen.getByText("DSR-2026-0001")).toBeInTheDocument();
    });
    expect(screen.getByText("Juan Dela Cruz")).toBeInTheDocument();

    // Trigger AC-15 patient data export
    const exportButton = screen.getByRole("button", { name: /Export Pack \(AC-15\)/i });
    expect(exportButton).toBeInTheDocument();

    fireEvent.click(exportButton);

    await waitFor(() => {
      expect(api.exportPatientDsrData).toHaveBeenCalledWith("dsr-001");
    });
    expect(await screen.findByText(/Export pack successfully downloaded for DSR DSR-2026-0001/i)).toBeInTheDocument();
  });

  it("8.3 Breach Register (Q-2): displays 72h regulatory notification clock warning", async () => {
    renderWithProviders(<CompliancePage />, ["/compliance?tab=breach"]);

    await waitFor(() => {
      expect(screen.getByText("BRC-2026-0001")).toBeInTheDocument();
    });

    expect(screen.getByText(/URGENT: 1 Incident\(s\) Approaching 72h Regulatory Deadline/i)).toBeInTheDocument();
    expect(screen.getByText(/Misdirected patient statement email batch/i)).toBeInTheDocument();
    expect(screen.getByText("Pending NPC")).toBeInTheDocument();
  });

  it("8.3 Retention & Legal Holds: renders statutory policies and protected candidate status", async () => {
    renderWithProviders(<CompliancePage />, ["/compliance?tab=retention"]);

    await waitFor(() => {
      expect(screen.getAllByText("CLINICAL_VISITS").length).toBeGreaterThanOrEqual(1);
    });

    expect(screen.getByText("10 years")).toBeInTheDocument();
    expect(screen.getByText("HLD-2026-0001")).toBeInTheDocument();
    expect(screen.getByText(/Protected by HLD-2026-0001/i)).toBeInTheDocument();
  });

  it("8.4 PIDSR Notifiable Diseases (RA 11332, Q-16): renders surveillance cases and CIF modal", async () => {
    renderWithProviders(<CompliancePage />, ["/compliance?tab=pidsr"]);

    await waitFor(() => {
      expect(screen.getByText("PIDSR-2026-0001")).toBeInTheDocument();
    });

    expect(screen.getByText(/Dengue Fever/i)).toBeInTheDocument();
    expect(screen.getByText("A90")).toBeInTheDocument();

    // Click View CIF button
    const cifBtn = screen.getByRole("button", { name: /View CIF/i });
    fireEvent.click(cifBtn);

    expect(await screen.findByText(/PIDSR Case Investigation Form \(CIF\)/i)).toBeInTheDocument();
    expect(screen.getByText(/feverDays/i)).toBeInTheDocument();
  });
});
