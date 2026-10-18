import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router";
import { AuthProvider } from "../src/shared/auth/AuthContext.js";
import { RenalDashboardPage } from "../src/features/renal/RenalDashboardPage.js";
import { DialysisWorklistPage } from "../src/features/renal/DialysisWorklistPage.js";
import { DialyzerReprocessingPage } from "../src/features/renal/DialyzerReprocessingPage.js";
import { WaterTreatmentLogPage } from "../src/features/renal/WaterTreatmentLogPage.js";
import { PhilHealthTrackingPage } from "../src/features/renal/PhilHealthTrackingPage.js";
import { useStubHandler, type StubHandler } from "./setup.js";

const renalStubHandler: StubHandler = (req, res) => {
  const url = req.url ?? "";

  res.writeHead(200, { "content-type": "application/json" });

  if (url.includes("/renal/stations")) {
    res.end(
      JSON.stringify([
        {
          id: "st-1",
          tenant_id: "t1",
          branch_id: "b1",
          station_no: "ST-01",
          name: "Chair 1 (Window)",
          room: "HD Main Hall",
          is_isolation: false,
          is_active: true,
          created_at: new Date().toISOString(),
        },
        {
          id: "st-2",
          tenant_id: "t1",
          branch_id: "b1",
          station_no: "ST-02",
          name: "Chair 2 (HBsAg Isolation)",
          room: "Isolation Room",
          is_isolation: true,
          is_active: true,
          created_at: new Date().toISOString(),
        },
      ]),
    );
    return;
  }

  if (url.includes("/renal/machines")) {
    res.end(
      JSON.stringify([
        {
          id: "m-1",
          tenant_id: "t1",
          branch_id: "b1",
          station_id: "st-1",
          serial_no: "FMC-5008-001",
          brand: "Fresenius",
          model: "5008S CorDiax",
          total_operating_hours: 140,
          status: "ACTIVE",
          is_isolation: false,
        },
      ]),
    );
    return;
  }

  if (url.includes("/renal/water-treatment/logs")) {
    res.end(
      JSON.stringify([
        {
          id: "wl-1",
          tenant_id: "t1",
          branch_id: "b1",
          log_date: new Date().toISOString().slice(0, 10),
          tested_by: "u-nurse",
          carbon_breakthrough_chlorine_ppm: 0.02,
          ro_conductivity_us: 7.5,
          ro_rejection_rate_pct: 99.2,
          status: "COMPLIANT",
          created_at: new Date().toISOString(),
        },
      ]),
    );
    return;
  }

  if (url.includes("/renal/sessions")) {
    res.end(
      JSON.stringify([
        {
          id: "sess-1",
          tenant_id: "t1",
          session_no: "HD-2026-00001",
          patient_id: "p-1",
          first_name: "Juan",
          last_name: "Dela Cruz",
          branch_id: "b1",
          station_id: "st-1",
          station_no: "ST-01",
          machine_id: "m-1",
          machine_serial: "FMC-5008-001",
          prescription_id: "rx-1",
          dialyzer_id: "dz-1",
          dialyzer_model: "FX80 High-Flux",
          dialyzer_barcode: "DZ-JUAN-001",
          scheduled_date: new Date().toISOString().slice(0, 10),
          shift_id: "sh-1",
          status: "SCHEDULED",
          primary_nurse_id: "u-nurse",
          total_uf_removed_liters: null,
          actual_duration_minutes: null,
        },
      ]),
    );
    return;
  }

  if (url.includes("/renal/dialyzers")) {
    res.end(
      JSON.stringify([
        {
          id: "dz-1",
          tenant_id: "t1",
          patient_id: "p-1",
          first_name: "Juan",
          last_name: "Dela Cruz",
          serial_barcode: "DZ-JUAN-001",
          dialyzer_model: "FX80 High-Flux",
          baseline_volume_ml: 100.0,
          current_volume_ml: 92.0,
          reuse_count: 3,
          max_allowed_reuses: 10,
          status: "CLEANED_READY",
        },
      ]),
    );
    return;
  }

  if (url.includes("/renal/philhealth/usage")) {
    res.end(
      JSON.stringify({
        patientId: "p-1",
        calendarYear: 2026,
        sessionCount: 24,
        maxBenefitSessions: 156,
        remainingSessions: 132,
        isExceeded: false,
      }),
    );
    return;
  }

  res.end(JSON.stringify({ data: [] }));
};

describe("Renal Care Frontend Suite (Phase 7A, AC-29, AC-30, AC-31, AC-32)", () => {
  beforeEach(() => {
    useStubHandler(renalStubHandler);
  });

  function renderWithProviders(ui: React.ReactElement, initialRoute = "/") {
    return render(
      <MemoryRouter initialEntries={[initialRoute]}>
        <AuthProvider>
          <Routes>
            <Route path="/" element={ui} />
            <Route path="/renal/dashboard" element={<RenalDashboardPage />} />
            <Route path="/renal/worklist" element={<DialysisWorklistPage />} />
            <Route path="/renal/reprocessing" element={<DialyzerReprocessingPage />} />
            <Route path="/renal/water-safety" element={<WaterTreatmentLogPage />} />
            <Route path="/renal/philhealth" element={<PhilHealthTrackingPage />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    );
  }

  it("RenalDashboardPage renders station occupancy grid and water safety banner", async () => {
    renderWithProviders(<RenalDashboardPage />, "/renal/dashboard");

    await waitFor(() => {
      expect(screen.getByText(/Hemodialysis Unit Operations/i)).toBeInTheDocument();
      expect(screen.getByText(/PRE-SHIFT WATER SAFETY COMPLIANT/i)).toBeInTheDocument();
      expect(screen.getByText("ST-01")).toBeInTheDocument();
      expect(screen.getByText("ST-02")).toBeInTheDocument();
      expect(screen.getByText("ISOLATION")).toBeInTheDocument();
    });
  });

  it("DialysisWorklistPage renders daily scheduled sessions and action buttons", async () => {
    renderWithProviders(<DialysisWorklistPage />, "/renal/worklist");

    await waitFor(() => {
      expect(screen.getByText(/Dialysis Session Worklist/i)).toBeInTheDocument();
      expect(screen.getByText("HD-2026-00001")).toBeInTheDocument();
      expect(screen.getByText(/Juan Dela Cruz/i)).toBeInTheDocument();
      expect(screen.getByText("Intake & Start")).toBeInTheDocument();
    });
  });

  it("DialyzerReprocessingPage displays single-patient dialyzer inventory and volume %", async () => {
    renderWithProviders(<DialyzerReprocessingPage />, "/renal/reprocessing");

    await waitFor(() => {
      expect(screen.getByText(/Dialyzer Reprocessing & QA/i)).toBeInTheDocument();
      expect(screen.getByText("DZ-JUAN-001")).toBeInTheDocument();
      expect(screen.getByText(/92.0 mL \(92.0%\)/i)).toBeInTheDocument();
      expect(screen.getByText("Reprocess QA")).toBeInTheDocument();
    });
  });

  it("WaterTreatmentLogPage displays pre-shift total chlorine surveillance log", async () => {
    renderWithProviders(<WaterTreatmentLogPage />, "/renal/water-safety");

    await waitFor(() => {
      expect(screen.getByText(/Water Safety & Reverse Osmosis Logs/i)).toBeInTheDocument();
      expect(screen.getByText("0.020 ppm")).toBeInTheDocument();
      expect(screen.getByText("COMPLIANT (SAFE)")).toBeInTheDocument();
    });
  });

  it("PhilHealthTrackingPage renders annual 156-session benefit tracker and financial tally", async () => {
    renderWithProviders(<PhilHealthTrackingPage />, "/renal/philhealth");

    await waitFor(() => {
      expect(screen.getByText(/PhilHealth 156-Session Dialysis Benefit Tracker/i)).toBeInTheDocument();
      expect(screen.getByText(/₱2,600.00 \/ session/i)).toBeInTheDocument();
    });
  });
});
