import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router";
import { AuthProvider } from "../src/shared/auth/AuthContext.js";
import { StepUpProvider } from "../src/shared/auth/StepUpContext.js";
import { VisitChartPage } from "../src/features/clinical/VisitChartPage.js";
import { VisitsPage } from "../src/features/clinical/VisitsPage.js";
import { useStubHandler, type StubHandler } from "./setup.js";

/**
 * Official printouts + consultation quick registration:
 *  - PrescriptionPrintModal hydrates doctor identity from
 *    GET /clinical/visits/:id/print-profile (users.name × employees licensure,
 *    specification §7) instead of fabricated placeholder licence numbers, and
 *    fetches the PDF through the shared print pipeline.
 *  - VisitsPage offers inline quick registration (POST /patients) when the
 *    patient search returns no match, then selects the new patient (§6, §18.1).
 */

const VISIT = {
  id: "v-demo",
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
  practitioner_id: "u-doc-1",
  practitioner_name: "Dr. Maria Elena Reyes",
  allergies: [{ substance: "Penicillin", severity: "high" }],
  vitals: [],
  notes: [],
  diagnoses: [],
  prescriptions: [
    {
      id: "rx-1",
      rx_no: "RX-20261002-00001",
      status: "ISSUED",
      is_controlled: false,
      prescriber_name: "Dr. Maria Elena Reyes",
      items: [
        {
          generic_name: "Paracetamol",
          brand_name: "Biogesic",
          sig_dose: "500 mg",
          sig_frequency: "Every 4-6 hours as needed",
          sig_duration: "5 days",
        },
      ],
    },
  ],
  labOrders: [],
  supplies: [],
};

const PRINT_PROFILE = {
  visit: { id: "v-demo", visitNo: "V-20261002-00001", branchId: "b1", branchName: "Main Branch" },
  clinic: { name: "Metro Health Clinic & Diagnostic Center", branchName: "Main Branch", address: null, phone: null },
  practitioner: {
    userId: "u-doc-1",
    name: "Maria Elena Reyes",
    jobTitle: "Attending Physician",
    specialization: "Internal Medicine",
    prcLicenseNo: "PRC-0123456",
    ptrNo: "PTR-8765432",
    s2LicenseNo: null,
  },
};

function readBody(req: import("node:http").IncomingMessage): Promise<unknown> {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (c: Buffer) => (raw += c.toString()));
    req.on("end", () => resolve(raw.length ? JSON.parse(raw) : {}));
  });
}

const baseHandler: StubHandler = (req, res) => {
  const url = req.url ?? "";
  const method = req.method ?? "GET";
  res.writeHead(200, { "content-type": "application/json" });

  if (url.includes("/clinical/visits/v-demo") && method === "GET" && !url.includes("print-profile") && !url.includes("-pdf")) {
    res.end(JSON.stringify(VISIT));
    return;
  }
  if (url.includes("/clinical/visits/v-demo/print-profile")) {
    res.end(JSON.stringify(PRINT_PROFILE));
    return;
  }
  if (url.includes("-pdf")) {
    // The stub returns JSON, not PDF bytes; the modal only needs the request to
    // succeed to show the preview iframe path — blob preview asserts are kept
    // out of jsdom scope. Record the request instead.
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  if (url.includes("/certificates")) {
    res.end(JSON.stringify({ data: [], total: 0 }));
    return;
  }
  if (url.includes("/patients")) {
    res.end(JSON.stringify({ data: [] }));
    return;
  }
  res.end(JSON.stringify({ message: "ok" }));
};

function renderChart() {
  return render(
    <MemoryRouter initialEntries={["/clinical/visits/v-demo"]}>
      <AuthProvider>
        <StepUpProvider>
          <Routes>
            <Route path="/clinical/visits/:visitId" element={<VisitChartPage />} />
            <Route path="*" element={<div />} />
          </Routes>
        </StepUpProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
}

function renderVisits() {
  return render(
    <MemoryRouter initialEntries={["/clinical/visits"]}>
      <AuthProvider>
        <StepUpProvider>
          <Routes>
            <Route path="/clinical/visits/:visitId" element={<div />} />
            <Route path="*" element={<VisitsPage />} />
          </Routes>
        </StepUpProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe("PrescriptionPrintModal doctor-profile hydration (specification §7)", () => {
  beforeEach(() => {
    useStubHandler(baseHandler);
  });

  it("fetches the recorded practitioner profile and requests the official prescription PDF", async () => {
    const requests: string[] = [];
    useStubHandler((req, res) => {
      const url = req.url ?? "";
      if (url.includes("-pdf")) {
        requests.push(`${req.method} ${url}`);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
        return;
      }
      baseHandler(req, res);
    });

    renderChart();
    fireEvent.click(await screen.findByRole("button", { name: /Print Prescription$/i }));

    // Profile hydration: recorded licensure shows up in the settings drawer.
    fireEvent.click(await screen.findByRole("button", { name: /Doctor \/ Clinic Info/i }));
    expect(await screen.findByDisplayValue("PRC-0123456")).toBeInTheDocument();
    expect(screen.getByDisplayValue("PTR-8765432")).toBeInTheDocument();
    expect(screen.getByDisplayValue(/Internal Medicine/)).toBeInTheDocument();

    // PDF endpoint hit with NO fabricated credential overrides.
    await waitFor(() => expect(requests.some((r) => r.includes("/prescription-pdf"))).toBe(true));
    const rx = requests.find((r) => r.includes("/prescription-pdf"))!;
    expect(rx).not.toMatch(/prcNumber=/);
  });

  it("sends an edited licence as the only override while untouched fields stay server-driven", async () => {
    const requests: string[] = [];
    useStubHandler((req, res) => {
      const url = req.url ?? "";
      if (url.includes("-pdf")) {
        requests.push(`${req.method} ${url}`);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
        return;
      }
      baseHandler(req, res);
    });

    renderChart();
    fireEvent.click(await screen.findByRole("button", { name: /Print Prescription$/i }));
    fireEvent.click(await screen.findByRole("button", { name: /Doctor \/ Clinic Info/i }));
    await screen.findByDisplayValue("PRC-0123456");

    // Edit only the S2 field.
    const s2 = screen.getByLabelText("S2 License No.");
    fireEvent.change(s2, { target: { value: "S2-TEST-0001" } });
    // The PDF must be re-requested for the new override set — assert on the most
    // recent request, not the initial (pre-edit) one.
    await waitFor(() =>
      expect(requests.some((r) => /s2Number=S2-TEST-0001/.test(r))).toBe(true),
    );
    const rx = requests.findLast((r) => r.includes("/prescription-pdf"))!;
    expect(rx).toMatch(/s2Number=S2-TEST-0001/);
    // The untouched recorded values are not echoed back as overrides.
    expect(rx).not.toMatch(/prcNumber=/);
    expect(rx).not.toMatch(/doctorName=/);
  });

  it("sends the recorded professional title and honours an edited one", async () => {
    const requests: string[] = [];
    useStubHandler((req, res) => {
      const url = req.url ?? "";
      if (url.includes("-pdf")) {
        requests.push(`${req.method} ${url}`);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
        return;
      }
      baseHandler(req, res);
    });

    renderChart();
    fireEvent.click(await screen.findByRole("button", { name: /Print Prescription$/i }));
    fireEvent.click(await screen.findByRole("button", { name: /Doctor \/ Clinic Info/i }));

    // Hydrated from employees.job_title — sent only once the user edits it, so
    // an untouched field never overrides the server-rendered value.
    expect(await screen.findByDisplayValue("Attending Physician")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Professional Title"), {
      target: { value: "Consultant, Internal Medicine" },
    });
    await waitFor(() =>
      expect(requests.some((r) => /doctorTitle=Consultant%2C\+Internal\+Medicine/.test(r))).toBe(true),
    );
  });
});

describe("VisitsPage quick registration (specification §6, §18.1)", () => {
  beforeEach(() => {
    useStubHandler(baseHandler);
  });

  it("offers inline registration when the patient search finds no match and registers via POST /patients", async () => {
    let createdBody: unknown = null;
    useStubHandler((req, res) => {
      const url = req.url ?? "";
      const method = req.method ?? "GET";
      // The duplicate probe also posts to /patients/... — match it first, or it
      // would be swallowed by the create stub below and clobber createdBody.
      if (url.includes("/patients/check-duplicates")) {
        void readBody(req).then(() => {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ candidates: [] }));
        });
        return;
      }
      if (url.includes("/patients") && method === "POST") {
        void readBody(req).then((body) => {
          createdBody = body;
          res.writeHead(200, { "content-type": "application/json" });
          res.end(
            JSON.stringify({
              id: "p-new-1",
              first_name: "Juan",
              last_name: "Dela Cruz",
              date_of_birth: "1990-01-01",
              gender: "M",
              status: "ACTIVE",
              row_version: 1,
              created_at: new Date().toISOString(),
            }),
          );
        });
        return;
      }
      baseHandler(req, res);
    });

    renderVisits();
    fireEvent.click(await screen.findByRole("button", { name: /Register Visit/i }));

    const search = screen.getByPlaceholderText(/Search by name or ID/i);
    fireEvent.change(search, { target: { value: "Juan Dela Cruz" } });

    // Debounced search resolves empty → the quick-registration affordance appears.
    fireEvent.click(await screen.findByRole("button", { name: /Patient not found\? Register/i }));

    const first = screen.getByLabelText("First name *") as HTMLInputElement;
    expect(first.value).toBe("Juan");
    expect((screen.getByLabelText("Last name *") as HTMLInputElement).value).toBe("Dela Cruz");

    fireEvent.change(screen.getByLabelText("Date of birth *"), { target: { value: "1990-01-01" } });
    fireEvent.click(screen.getByRole("button", { name: /Register & select patient/i }));

    await waitFor(() => expect(createdBody).toMatchObject({ firstName: "Juan", lastName: "Dela Cruz", dateOfBirth: "1990-01-01", gender: "F" }));
  });

  it("blocks submission until a duplicate match is acknowledged, then registers", async () => {
    let dupProbes = 0;
    let createCalls = 0;
    useStubHandler((req, res) => {
      const url = req.url ?? "";
      const method = req.method ?? "GET";
      if (url.includes("/patients/check-duplicates") && method === "POST") {
        dupProbes += 1;
        void readBody(req).then(() => {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(
            JSON.stringify({
              candidates: [{ id: "p-existing-1", patientNo: "PT-0001", firstName: "Juan", lastName: "Dela Cruz" }],
            }),
          );
        });
        return;
      }
      if (url.includes("/patients") && method === "POST") {
        createCalls += 1;
        void readBody(req).then((body) => {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ ...(body as object), id: "p-new-2" }));
        });
        return;
      }
      baseHandler(req, res);
    });

    renderVisits();
    fireEvent.click(await screen.findByRole("button", { name: /Register Visit/i }));
    fireEvent.change(screen.getByPlaceholderText(/Search by name or ID/i), {
      target: { value: "Juan Dela Cruz" },
    });
    fireEvent.click(await screen.findByRole("button", { name: /Patient not found\? Register/i }));
    fireEvent.change(screen.getByLabelText("Date of birth *"), { target: { value: "1990-01-01" } });

    // The duplicate guard surfaces the existing record.
    expect(await screen.findByText(/Possible duplicates found \(1\)/)).toBeInTheDocument();
    expect(screen.getByText("Dela Cruz, Juan — PT-0001")).toBeInTheDocument();
    expect(dupProbes).toBeGreaterThan(0);

    // Submit is gated until the acknowledgement is ticked.
    const submit = screen.getByRole("button", { name: /Register & select patient/i });
    expect(submit).toBeDisabled();
    expect(createCalls).toBe(0);

    fireEvent.click(screen.getByLabelText(/These are different people/i));
    expect(submit).not.toBeDisabled();

    fireEvent.click(submit);
    await waitFor(() => expect(createCalls).toBe(1));
  });

  it("registers without an acknowledgement when the duplicate probe finds no match", async () => {
    let createCalls = 0;
    useStubHandler((req, res) => {
      const url = req.url ?? "";
      const method = req.method ?? "GET";
      if (url.includes("/patients/check-duplicates") && method === "POST") {
        void readBody(req).then(() => {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ candidates: [] }));
        });
        return;
      }
      if (url.includes("/patients") && method === "POST") {
        createCalls += 1;
        void readBody(req).then((body) => {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ ...(body as object), id: "p-new-3" }));
        });
        return;
      }
      baseHandler(req, res);
    });

    renderVisits();
    fireEvent.click(await screen.findByRole("button", { name: /Register Visit/i }));
    fireEvent.change(screen.getByPlaceholderText(/Search by name or ID/i), {
      target: { value: "Ana Reyes" },
    });
    fireEvent.click(await screen.findByRole("button", { name: /Patient not found\? Register/i }));
    fireEvent.change(screen.getByLabelText("Date of birth *"), { target: { value: "1988-02-02" } });

    await waitFor(() =>
      expect(screen.queryByText(/Possible duplicates found/)).not.toBeInTheDocument(),
    );

    const submit = screen.getByRole("button", { name: /Register & select patient/i });
    expect(submit).not.toBeDisabled();
    fireEvent.click(submit);
    await waitFor(() => expect(createCalls).toBe(1));
  });
});
