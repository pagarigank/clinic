import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router";
import { AuthProvider } from "../src/shared/auth/AuthContext.js";
import { StepUpProvider } from "../src/shared/auth/StepUpContext.js";
import { SettingsPage } from "../src/features/admin/SettingsPage.js";
import { useStubHandler, type StubHandler } from "./setup.js";

const MOCK_CLINIC_PROFILE = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "La Salette Family Medical Center",
  slug: "la-salette",
  tagline: "Primary Care & Specialized Outpatient Clinic",
  address: "100 Medical Center Way, Ermita, Manila, Philippines",
  phone: "(02) 8524-1000 / +63 917 555 0100",
  email: "care@lasaletteclinic.ph",
  website: "https://lasaletteclinic.ph",
  dohLicenseNo: "DOH-LTO-01449-NCR",
  philhealthAccreditationNo: "PHIC-ACC-98765-PCP",
  tin: "009-876-543-000",
  letterheadFooter: "Licensed Secondary Clinical Laboratory & PhilHealth Konsulta Accredited Facility",
};

describe("Tenant Clinic Information & Printout Letterhead Page", () => {
  let lastPutPayload: any = null;

  beforeEach(() => {
    lastPutPayload = null;
  });

  const stub: StubHandler = (req, res) => {
    const url = req.url ?? "";
    const method = req.method ?? "GET";
    res.writeHead(200, { "content-type": "application/json" });

    if (url.includes("/admin/clinic-profile")) {
      if (method === "GET") {
        res.end(JSON.stringify(MOCK_CLINIC_PROFILE));
        return;
      }
      if (method === "PUT") {
        let raw = "";
        req.on("data", (chunk: Buffer) => (raw += chunk.toString()));
        req.on("end", () => {
          lastPutPayload = JSON.parse(raw);
          res.end(JSON.stringify({ ...MOCK_CLINIC_PROFILE, ...lastPutPayload }));
        });
        return;
      }
    }

    res.end(JSON.stringify({}));
  };

  function renderPage() {
    return render(
      <MemoryRouter initialEntries={["/admin/settings"]}>
        <AuthProvider>
          <StepUpProvider>
            <Routes>
              <Route path="/admin/settings" element={<SettingsPage />} />
            </Routes>
          </StepUpProvider>
        </AuthProvider>
      </MemoryRouter>,
    );
  }

  it("loads and displays the tenant clinic profile and printout letterhead details", async () => {
    useStubHandler(stub);
    renderPage();

    // Verify header and card are rendered
    expect(await screen.findByText(/Clinic Information & Official Letterhead/i)).toBeInTheDocument();
    expect(screen.getByText(/Tied to Encounter Printouts/i)).toBeInTheDocument();

    // Verify fields populated from server
    await waitFor(() => {
      const nameInput = screen.getByLabelText(/CLINIC \/ FACILITY NAME/i) as HTMLInputElement;
      expect(nameInput.value).toBe("La Salette Family Medical Center");
    });

    const taglineInput = screen.getByLabelText(/FACILITY TAGLINE/i) as HTMLInputElement;
    expect(taglineInput.value).toBe("Primary Care & Specialized Outpatient Clinic");

    const dohInput = screen.getByLabelText(/DOH LICENSE TO OPERATE/i) as HTMLInputElement;
    expect(dohInput.value).toBe("DOH-LTO-01449-NCR");

    const philhealthInput = screen.getByLabelText(/PHILHEALTH ACCREDITATION NO/i) as HTMLInputElement;
    expect(philhealthInput.value).toBe("PHIC-ACC-98765-PCP");

    // Verify live letterhead preview is rendered
    expect(screen.getByText(/Real-Time Official Letterhead Preview/i)).toBeInTheDocument();
  });

  it("updates clinic profile and sends payload to PUT /admin/clinic-profile", async () => {
    useStubHandler(stub);
    renderPage();

    const nameInput = (await screen.findByLabelText(/CLINIC \/ FACILITY NAME/i)) as HTMLInputElement;
    await waitFor(() => expect(nameInput.value).toBe("La Salette Family Medical Center"));

    // Modify clinic name, address, and DOH license
    fireEvent.change(nameInput, { target: { value: "La Salette Comprehensive Healthcare" } });

    const addrInput = screen.getByLabelText(/MAIN PHYSICAL ADDRESS/i);
    fireEvent.change(addrInput, { target: { value: "250 Taft Avenue, Manila, Philippines" } });

    const dohInput = screen.getByLabelText(/DOH LICENSE TO OPERATE/i);
    fireEvent.change(dohInput, { target: { value: "DOH-LTO-2026-NEW-999" } });

    // Submit save
    const saveButton = screen.getByRole("button", { name: /Save Clinic Profile & Letterhead/i });
    expect(saveButton).not.toBeDisabled();
    fireEvent.click(saveButton);

    // Verify success banner appears
    await waitFor(() => {
      expect(screen.getByText(/updated successfully! All medical certificates, prescriptions/i)).toBeInTheDocument();
    });

    // Verify payload sent
    expect(lastPutPayload).toBeDefined();
    expect(lastPutPayload.name).toBe("La Salette Comprehensive Healthcare");
    expect(lastPutPayload.address).toBe("250 Taft Avenue, Manila, Philippines");
    expect(lastPutPayload.dohLicenseNo).toBe("DOH-LTO-2026-NEW-999");
  });

  it("resets modified fields when Reset button is clicked", async () => {
    useStubHandler(stub);
    renderPage();

    const nameInput = (await screen.findByLabelText(/CLINIC \/ FACILITY NAME/i)) as HTMLInputElement;
    await waitFor(() => expect(nameInput.value).toBe("La Salette Family Medical Center"));

    fireEvent.change(nameInput, { target: { value: "Temporary Changed Name" } });
    expect(nameInput.value).toBe("Temporary Changed Name");

    const resetButton = screen.getByRole("button", { name: /Reset/i });
    expect(resetButton).not.toBeDisabled();
    fireEvent.click(resetButton);

    expect(nameInput.value).toBe("La Salette Family Medical Center");
  });
});
