import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router";
import { AuthProvider } from "../src/shared/auth/AuthContext.js";
import { StepUpProvider } from "../src/shared/auth/StepUpContext.js";
import { SchedulingPage } from "../src/features/clinical/SchedulingPage.js";
import { QueueBoardPage } from "../src/features/clinical/QueueBoardPage.js";
import { VisitsPage } from "../src/features/clinical/VisitsPage.js";
import { VisitChartPage } from "../src/features/clinical/VisitChartPage.js";
import { useStubHandler, type StubHandler } from "./setup.js";

const baseHandler: StubHandler = (req, res) => {
  const url = req.url ?? "";
  const method = req.method ?? "GET";

  if (url.includes("/pdf") || url.includes("-pdf")) {
    res.writeHead(200, { "content-type": "application/pdf" });
    res.end(Buffer.from("%PDF-1.7 mock"));
    return;
  }

  res.writeHead(200, { "content-type": "application/json" });

  if (url.includes("/clinical/appointments")) {
    res.end(
      JSON.stringify({
        data: [
          {
            id: "a1",
            patientName: "Santos, Maria Elena",
            practitionerName: "Dr. Reyes",
            startsAt: "2026-10-02T09:00:00Z",
            endsAt: "2026-10-02T09:30:00Z",
            status: "CONFIRMED",
          },
        ],
      }),
    );
    return;
  }

  if (url.includes("/clinical/availability")) {
    res.end(
      JSON.stringify({
        slots: [{ startsAt: "09:00", endsAt: "09:30", available: true }],
      }),
    );
    return;
  }

  if (url.includes("/clinical/queue")) {
    res.end(
      JSON.stringify({
        data: [
          {
            id: "q1",
            ticketNo: "Q20261002-001",
            patientName: "Santos, Maria Elena",
            priority: 0,
            status: "SERVING",
            issuedAt: "08:02",
          },
          {
            id: "q2",
            ticketNo: "Q20261002-002",
            patientName: "Dela Cruz, Juan",
            priority: 0,
            status: "WAITING",
            issuedAt: "08:15",
          },
        ],
      }),
    );
    return;
  }

  if (url.includes("/clinical/visits") && !url.includes("/certificates") && method === "GET") {
    const match = url.match(/\/clinical\/visits\/([^/?]+)/);
    if (match && match[1] && match[1] !== "visits") {
      const visitId = match[1];
      res.end(
        JSON.stringify({
          id: visitId,
          visit_no: "V-20261002-00001",
          patient_id: "a4000000-0000-4000-8000-000000000001",
          patient_name: "Maria Elena Santos",
          date_of_birth: "1988-04-12",
          gender: "F",
          status: "IN_PROGRESS",
          branch_id: "a1000000-0000-4000-8000-000000000001",
          branch_name: "Main Branch",
          clinic_name: "Metro Health Clinic & Diagnostic Center",
          chief_complaint: "Fever x 3 days, dry cough, body malaise",
          practitioner_name: "Dr. Maria Elena Reyes, MD",
          allergies: [{ substance: "Penicillin", severity: "high" }],
          vitals: [
            {
              id: "vit-1",
              bpSys: 120,
              bpDia: 80,
              hr: 78,
              temp: 38.8,
              rr: 18,
              spo2: 98,
              recordedAt: "08:35",
              flags: ["FEVER"],
            },
          ],
          notes: [],
          diagnoses: [],
          prescriptions: [
            {
              id: "rx-1",
              rx_no: "RX-20261002-00001",
              status: "ISSUED",
              is_controlled: false,
              prescriber_name: "Dr. Maria Elena Reyes, MD",
              items: [
                {
                  generic_name: "Paracetamol",
                  brand_name: "Biogesic",
                  sig_dose: "500 mg",
                  sig_frequency: "Every 4-6 hours as needed",
                  sig_duration: "5 days",
                  dispense_qty: "20 tablets",
                  instructions: "Take after meals",
                },
              ],
            },
          ],
          labOrders: [],
          supplies: [],
        }),
      );
      return;
    }

    res.end(
      JSON.stringify({
        data: [
          {
            id: "v1",
            visit_no: "V-20261002-00001",
            patient_name: "Santos, Maria Elena",
            visit_type: "OPD",
            status: "IN_PROGRESS",
            chief_complaint: "Fever x 3 days, cough",
            opened_at: "2026-10-02 08:30",
          },
          {
            id: "v3",
            visit_no: "V-20261001-00012",
            patient_name: "Lim, Roberto",
            visit_type: "FOLLOW_UP",
            status: "CLOSED",
            chief_complaint: "Post-op wound check — clean",
            opened_at: "2026-10-01 14:00",
          },
        ],
      }),
    );
    return;
  }

  if (url.includes("/certificates")) {
    res.end(JSON.stringify({ data: [], total: 0 }));
    return;
  }

  if (url.includes("/patients")) {
    res.end(
      JSON.stringify({
        data: [
          {
            id: "a4000000-0000-4000-8000-000000000001",
            last_name: "Santos",
            first_name: "Maria Elena",
            patientNo: "P-001",
          },
        ],
      }),
    );
    return;
  }

  res.end(JSON.stringify({ message: "ok" }));
};

/**
 * Phase 3 clinical screens (frontend §14.4): scheduling day view + booking,
 * queue board actions, visits worklist, and the encounter chart with the
 * sign-locks-the-note workflow (CLN-T4).
 */
function renderAt(path: string, ui: React.ReactElement) {
  const initial = path === "*" ? "/" : path;
  return render(
    <MemoryRouter initialEntries={[initial]}>
      <AuthProvider>
        <StepUpProvider>
          <Routes>
            <Route path="/clinical/visits/:visitId" element={ui} />
            <Route path="*" element={ui} />
          </Routes>
        </StepUpProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  useStubHandler(baseHandler);
});

describe("SchedulingPage (todo §3.1, CLN-T1)", () => {

  it("renders the day view with appointments and availability panel", async () => {
    renderAt("*", <SchedulingPage />);
    expect(screen.getByText(/Appointments & Scheduling/i)).toBeInTheDocument();
    expect(await screen.findByText("Santos, Maria Elena")).toBeInTheDocument();
    expect(screen.getByText(/Availability/)).toBeInTheDocument();
    // Walk-in mode is offered (PH solo-practice default, todo §3.1).
    expect(screen.getByText(/Book \/ Walk-in/i)).toBeInTheDocument();
  });

  it("opens the booking modal and offers walk-in sequential mode", async () => {
    renderAt("*", <SchedulingPage />);
    fireEvent.click(await screen.findByRole("button", { name: /Book \/ Walk-in/i }));
    expect(screen.getByText(/Walk-in ticket|Book appointment/i)).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(/Walk-in \/ sequential mode/i));
    expect(screen.getByRole("button", { name: /Issue ticket/i })).toBeInTheDocument();
  });

  it("provides fuzzy search for patient selection in booking modal and allows selecting/changing", async () => {
    renderAt("*", <SchedulingPage />);
    fireEvent.click(await screen.findByRole("button", { name: /Book \/ Walk-in/i }));
    expect(screen.getByText(/Walk-in ticket|Book appointment/i)).toBeInTheDocument();

    // The fuzzy search input is present instead of legacy select dropdown
    const searchInput = screen.getByPlaceholderText(/Type patient name, ID, or MRN…/i);
    expect(searchInput).toBeInTheDocument();

    // Focus or type fuzzy term e.g. "san"
    fireEvent.focus(searchInput);
    fireEvent.change(searchInput, { target: { value: "san" } });

    // Matching patient appears in fuzzy results dropdown
    const selectBtn = await screen.findByRole("button", { name: /Select/i });
    expect(selectBtn).toBeInTheDocument();
    expect(screen.getAllByText("Santos, Maria Elena").length).toBeGreaterThanOrEqual(1);

    // Select the patient
    fireEvent.click(selectBtn);

    // Selected patient chip is displayed with Change button
    expect(screen.getByText("✓ Selected")).toBeInTheDocument();
    const changeBtn = screen.getByRole("button", { name: /Change/i });
    expect(changeBtn).toBeInTheDocument();

    // Clicking change resets selection back to fuzzy search input
    fireEvent.click(changeBtn);
    expect(screen.getByPlaceholderText(/Type patient name, ID, or MRN…/i)).toBeInTheDocument();
  });

  it("renders appointments booked online with the online channel badge", async () => {
    useStubHandler((req, res) => {
      const url = req.url ?? "";
      if (url.includes("/clinical/appointments")) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            data: [
              {
                id: "apt-online-1",
                patient_name: "Dela Cruz, Juan",
                practitioner_name: "Dr. Reyes",
                starts_at: "2026-10-02T10:00:00Z",
                ends_at: "2026-10-02T10:30:00Z",
                status: "BOOKED",
                channel: "ONLINE",
              },
            ],
          }),
        );
        return;
      }
      baseHandler(req, res);
    });

    renderAt("*", <SchedulingPage />);
    expect(await screen.findByText("Dela Cruz, Juan")).toBeInTheDocument();
    expect(screen.getByText(/Online/i)).toBeInTheDocument();
  });

  it("opens reschedule modal for a booked patient and modifies the schedule", async () => {
    let patchCalled = false;
    let patchBody: any = null;

    useStubHandler((req, res) => {
      const url = req.url ?? "";
      if (req.method === "PATCH" && url.includes("/clinical/appointments/a1/reschedule")) {
        patchCalled = true;
        let body = "";
        req.on("data", (chunk) => {
          body += chunk;
        });
        req.on("end", () => {
          patchBody = JSON.parse(body);
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ id: "a1", status: "CONFIRMED" }));
        });
        return;
      }
      baseHandler(req, res);
    });

    renderAt("*", <SchedulingPage />);
    expect(await screen.findByText("Santos, Maria Elena")).toBeInTheDocument();

    const rescheduleBtn = await screen.findByRole("button", { name: /Reschedule/i });
    fireEvent.click(rescheduleBtn);

    expect(await screen.findByText(/Modify Appointment Schedule/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Start Time/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/End Time/i)).toBeInTheDocument();

    // Change start and end times
    fireEvent.change(screen.getByLabelText(/Start Time/i), { target: { value: "11:00" } });
    fireEvent.change(screen.getByLabelText(/End Time/i), { target: { value: "11:30" } });

    // Submit reschedule
    fireEvent.click(screen.getByRole("button", { name: /Save New Schedule/i }));

    await waitFor(() => {
      expect(patchCalled).toBe(true);
    });
    expect(patchBody.startsAt).toMatch(/T\d{2}:00:00/);
    expect(patchBody.endsAt).toMatch(/T\d{2}:30:00/);
    expect(await screen.findByText(/Schedule modified for Santos, Maria Elena/i)).toBeInTheDocument();
  });

  it("opens cancel modal and cancels appointment with reason", async () => {
    let cancelCalled = false;
    let cancelBody: any = null;

    useStubHandler((req, res) => {
      const url = req.url ?? "";
      if (req.method === "PATCH" && url.includes("/clinical/appointments/a1/cancel")) {
        cancelCalled = true;
        let body = "";
        req.on("data", (chunk) => {
          body += chunk;
        });
        req.on("end", () => {
          cancelBody = JSON.parse(body);
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ id: "a1", status: "CANCELLED" }));
        });
        return;
      }
      baseHandler(req, res);
    });

    renderAt("*", <SchedulingPage />);
    expect(await screen.findByText("Santos, Maria Elena")).toBeInTheDocument();

    const cancelBtn = await screen.findByRole("button", { name: /Cancel/i });
    fireEvent.click(cancelBtn);

    expect(await screen.findByText(/Reason for Cancellation/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Confirm Cancellation/i }));

    await waitFor(() => {
      expect(cancelCalled).toBe(true);
    });
    expect(cancelBody.reason).toBe("Patient requested cancellation");
    expect(await screen.findByText(/Appointment for Santos, Maria Elena has been cancelled/i)).toBeInTheDocument();
  });
});

describe("QueueBoardPage (CLN-T2)", () => {
  it("shows now-serving and waiting tickets with call/skip actions", async () => {
    renderAt("*", <QueueBoardPage />);
    expect(screen.getAllByText(/Now serving/i).length).toBeGreaterThan(0);
    expect((await screen.findAllByText("Q20261002-001")).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: /^Call$/ }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: /^Skip$/ }).length).toBeGreaterThan(0);
  });
});

describe("VisitsPage (todo §3.2)", () => {
  it("lists visits with status filter and distinguishes immutable closed visits", async () => {
    renderAt("*", <VisitsPage />);
    expect(screen.getByText(/Consultations & Chart/i)).toBeInTheDocument();
    expect(await screen.findByText("V-20261002-00001")).toBeInTheDocument();
    expect(screen.getAllByText(/CLOSED/i).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "CLOSED" }));
    expect(screen.getByText("V-20261001-00012")).toBeInTheDocument();
    expect(screen.queryByText("V-20261002-00001")).not.toBeInTheDocument();
  });
});

describe("VisitChartPage (CLN-T4/T5)", () => {
  it("renders the encounter chart with vitals, SOAP, dx, and prescribe sections", async () => {
    renderAt("/clinical/visits/v-demo", <VisitChartPage />);
    // Vitals auto-flag from the demo data (CLN-T3).
    expect(await screen.findByText("FEVER")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Visit chart/i })).toBeInTheDocument();
    expect(screen.getByText(/SOAP note/i)).toBeInTheDocument();
    expect(screen.getByText(/Diagnoses \(ICD-10\)/i)).toBeInTheDocument();
    expect(screen.getByText(/Prescribe/i)).toBeInTheDocument();
    // Patient banner shows the count, not the allergy contents (P-7).
    expect(screen.getByText(/Allergies: 1/)).toBeInTheDocument();
    expect(screen.queryByText("Penicillin")).not.toBeInTheDocument();
  });

  it("gates the controlled-Rx fields behind the controlled checkbox (CLN-T5)", async () => {
    renderAt("/clinical/visits/v-demo", <VisitChartPage />);
    const cb = await screen.findByLabelText(/Controlled drug/i);
    fireEvent.click(cb);
    expect(screen.getByLabelText(/Special-Rx serial/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Quantity in words/i)).toBeInTheDocument();
  });

  it("sign-locks the note and confirms the consequence first", async () => {
    renderAt("/clinical/visits/v-demo", <VisitChartPage />);
    fireEvent.click(await screen.findByRole("button", { name: /Sign \(locks\)/i }));
    expect(await screen.findByText(/Signing locks this SOAP note/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Sign note/i }));
    // A draft is required before signing succeeds — the error is explicit.
    await waitFor(() => expect(screen.getByText(/Save the note first/i)).toBeInTheDocument());
  });

  it("renders laboratory orders and central supply request areas with workbench wiring", async () => {
    renderAt("/clinical/visits/v-demo", <VisitChartPage />);
    expect(await screen.findByText(/Laboratory Orders & Requests/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Order Lab Test/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Lab Worklist/i })).toBeInTheDocument();

    expect(screen.getByText(/Central Supply & Consumables/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Request Supply/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Supply Issues/i })).toBeInTheDocument();

    expect(screen.getByRole("link", { name: /Pharmacy Workbench/i })).toBeInTheDocument();
  });

  it("opens doctor prescription and lab order print center with printable Rx and requisition slips", async () => {
    const printSpy = vi.spyOn(window, "print").mockImplementation(() => {});
    renderAt("/clinical/visits/v-demo", <VisitChartPage />);

    // Header print button
    const printHeaderBtn = await screen.findByRole("button", { name: /Print Prescription & Orders/i });
    expect(printHeaderBtn).toBeInTheDocument();

    fireEvent.click(printHeaderBtn);

    // Modal dialog is open
    expect(await screen.findByText(/Doctor's Prescription & Clinical Order Print Center/i)).toBeInTheDocument();
    expect(screen.getByText(/Prescription Slip \(Rx\)/i)).toBeInTheDocument();
    expect(screen.getByText(/Laboratory Request Slip/i)).toBeInTheDocument();
    expect(screen.getByText(/Combined Encounter Orders/i)).toBeInTheDocument();

    // Trigger Print
    const printNowBtn = screen.getByRole("button", { name: /Print Now/i });
    fireEvent.click(printNowBtn);
    expect(printSpy).toHaveBeenCalled();

    printSpy.mockRestore();
  });

  it("switches between Prescription (Rx), Laboratory Requisition, and Combined Encounter Orders", async () => {
    renderAt("/clinical/visits/v-demo", <VisitChartPage />);

    // Open from Rx card
    const printRxBtn = await screen.findByRole("button", { name: /Print Rx/i });
    fireEvent.click(printRxBtn);

    expect(await screen.findByText(/Prescription Slip \(Rx\)/i)).toBeInTheDocument();

    // Switch to Laboratory Request Slip tab
    const labTabBtn = screen.getByRole("button", { name: /Laboratory Request Slip/i });
    fireEvent.click(labTabBtn);

    expect(await screen.findByText(/Laboratory Request Slip/i)).toBeInTheDocument();

    // Close preview modal
    const closeBtn = screen.getAllByRole("button", { name: /Close/i })[0]!;
    fireEvent.click(closeBtn);
    expect(screen.queryByText(/Doctor's Prescription & Clinical Order Print Center/i)).not.toBeInTheDocument();
  });

  it("offers official PDF download and new tab viewer actions", async () => {
    renderAt("/clinical/visits/v-demo", <VisitChartPage />);

    const printHeaderBtn = await screen.findByRole("button", { name: /Print Prescription & Orders/i });
    fireEvent.click(printHeaderBtn);

    expect(await screen.findByText(/Doctor's Prescription & Clinical Order Print Center/i)).toBeInTheDocument();
    expect((await screen.findAllByRole("button", { name: /Download Official PDF/i })).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /View PDF/i })).toBeInTheDocument();
  });

  it("renders the medical certificates panel with the numbered issue form (CLN-T8)", async () => {
    renderAt("/clinical/visits/v-demo", <VisitChartPage />);
    expect(await screen.findByText(/Medical Certificates/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Issue Certificate/i })).toBeInTheDocument();
    expect(await screen.findByText(/No certificates issued for this visit/i)).toBeInTheDocument();
  });

  it("issues a numbered certificate and prints it from the server-rendered PDF", async () => {
    const calls: string[] = [];
    useStubHandler((req, res) => {
      const url = req.url ?? "";
      const method = req.method ?? "GET";
      calls.push(`${method} ${url}`);
      if (url.includes("/pdf")) {
        res.writeHead(200, { "content-type": "application/pdf" });
        res.end(Buffer.from("%PDF-1.7 certificate"));
        return;
      }
      if (method === "POST" && /\/certificates$/.test(url)) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ id: "cert-1", doc_no: "MC-2026-00001" }));
        return;
      }
      if (method === "GET" && /\/certificates$/.test(url)) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            data: [
              {
                id: "cert-1",
                doc_no: "MC-2026-00001",
                cert_type: "FIT_TO_WORK",
                findings: "Physically fit for employment",
                valid_from: "2026-10-02",
                valid_to: null,
                issued_at: "2026-10-02T08:00:00Z",
                voided_at: null,
                void_reason: null,
                patient_name: "Santos, Maria Elena",
                issuer_name: "Dr. Maria Elena Reyes, MD",
              },
            ],
            total: 1,
          }),
        );
        return;
      }
      baseHandler(req, res);
    });

    const printSpy = vi.spyOn(window, "print").mockImplementation(() => {});
    renderAt("/clinical/visits/v-123", <VisitChartPage />);

    fireEvent.change(await screen.findByLabelText(/certificate type/i), { target: { value: "FIT_TO_WORK" } });
    fireEvent.change(screen.getByLabelText(/findings/i), { target: { value: "Physically fit for employment" } });
    fireEvent.click(screen.getByRole("button", { name: /Issue Certificate/i }));

    expect(await screen.findByText(/MC-2026-00001/)).toBeInTheDocument();
    await waitFor(() =>
      expect(calls.some((c) => c.startsWith("POST /api/v1/clinical/visits/v-123/certificates"))).toBe(true),
    );

    fireEvent.click(screen.getByRole("button", { name: /Print.*PDF/i }));
    await waitFor(() =>
      expect(calls.some((c) => c.startsWith("GET /api/v1/clinical/certificates/cert-1/pdf"))).toBe(true),
    );
    printSpy.mockRestore();
  });

  it("raises a central-supply request (not a direct consumption) so it lands in the dispensing queue", async () => {
    let requestBody: any = null;
    let postPath = "";
    useStubHandler((req, res) => {
      const url = req.url ?? "";
      const method = req.method ?? "GET";
      if (method === "GET" && url.includes("/supply/items")) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify([
            {
              id: "b2000000-0000-4000-8000-000000000001",
              code: "GAUZE-4X4",
              name: "Sterile Gauze 4x4",
              item_type: "SUPPLY",
              base_uom_id: "b3000000-0000-4000-8000-000000000001",
              category_name: "Wound Care",
            },
          ]),
        );
        return;
      }
      if (method === "POST" && url.includes("/supply/patient-requests")) {
        postPath = url;
        let body = "";
        req.on("data", (chunk) => {
          body += chunk;
        });
        req.on("end", () => {
          requestBody = JSON.parse(body);
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ id: "req-1" }));
        });
        return;
      }
      baseHandler(req, res);
    });

    renderAt("/clinical/visits/v-demo", <VisitChartPage />);

    // The item picker is a fuzzy combobox, not a plain <select>.
    const input = await screen.findByRole("combobox", { name: /Select Supply Item/i });
    fireEvent.change(input, { target: { value: "gauze" } });
    fireEvent.mouseDown(await screen.findByRole("option", { name: /Sterile Gauze 4x4/i }));

    fireEvent.click(screen.getByRole("button", { name: /Request Supply/i }));

    await waitFor(() => expect(postPath).toContain("/supply/patient-requests"));
    expect(requestBody).toMatchObject({
      patientId: "a4000000-0000-4000-8000-000000000001",
      branchId: "a1000000-0000-4000-8000-000000000001",
      visitId: "v-demo",
    });
    expect(requestBody.items[0]).toMatchObject({
      itemId: "b2000000-0000-4000-8000-000000000001",
      uomId: "b3000000-0000-4000-8000-000000000001",
      qtyRequested: 1,
    });
    // It must NOT have gone through the direct-consumption endpoint.
    expect(screen.getByText(/appears in the Supply Dispensing workbench/i)).toBeInTheDocument();
  });

  it("preloads doctor SOAP notes and supports diagnosis description and Rx care instructions", async () => {
    useStubHandler((req, res) => {
      const url = req.url ?? "";
      const method = req.method ?? "GET";
      if (url.includes("/clinical/visits/v-soap-preload") && method === "GET") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            id: "v-soap-preload",
            visit_no: "V-20261002-00099",
            patient_id: "a4000000-0000-4000-8000-000000000001",
            patient_name: "Maria Elena Santos",
            date_of_birth: "1988-04-12",
            gender: "F",
            status: "IN_PROGRESS",
            branch_id: "a1000000-0000-4000-8000-000000000001",
            branch_name: "Main Branch",
            clinic_name: "Metro Health Clinic",
            chief_complaint: "Cough and mild fever",
            practitioner_name: "Dr. Maria Elena Reyes, MD",
            allergies: [],
            vitals: [],
            notes: [
              {
                id: "note-1",
                note_type: "SOAP",
                subjective: "Patient reports 3-day productive cough",
                objective: "Clear breath sounds bilateral",
                assessment: "Acute bronchitis",
                plan: "Rest, oral fluids, paracetamol PRN",
                status: "DRAFT",
                version: 1,
              },
            ],
            diagnoses: [
              {
                id: "dx-1",
                icd10_code: "J20.9",
                description: "Acute bronchitis, unspecified",
                dx_type: "PRIMARY",
                certainty: "CONFIRMED",
              },
            ],
            prescriptions: [],
            labOrders: [],
            supplies: [],
          }),
        );
        return;
      }
      baseHandler(req, res);
    });

    renderAt("/clinical/visits/v-soap-preload", <VisitChartPage />);

    // Verify SOAP notes form was preloaded from existing clinical note
    expect(await screen.findByDisplayValue("Patient reports 3-day productive cough")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Clear breath sounds bilateral")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Acute bronchitis")).toBeInTheDocument();
    // Both SOAP Plan and Rx instructions are preloaded with the care plan
    expect(screen.getAllByDisplayValue("Rest, oral fluids, paracetamol PRN")).toHaveLength(2);

    // Verify preloaded diagnosis with description is rendered
    expect(screen.getByText("J20.9")).toBeInTheDocument();
    expect(screen.getByText("Acute bronchitis, unspecified")).toBeInTheDocument();

    // Verify Doctor's Instructions & Care Notes for prescription pad is present and preloaded
    const rxNotes = screen.getByLabelText(/Physician's Instructions & Notes for Prescription/i);
    expect(rxNotes).toBeInTheDocument();
    expect(rxNotes).toHaveValue("Rest, oral fluids, paracetamol PRN");
  });
});


