import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router";
import { AuthProvider } from "../src/shared/auth/AuthContext.js";
import { StepUpProvider } from "../src/shared/auth/StepUpContext.js";
import { SchedulingPage } from "../src/features/clinical/SchedulingPage.js";
import { QueueBoardPage } from "../src/features/clinical/QueueBoardPage.js";
import { VisitsPage } from "../src/features/clinical/VisitsPage.js";
import { VisitChartPage } from "../src/features/clinical/VisitChartPage.js";

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
    expect(screen.getByText(/Visit chart/i)).toBeInTheDocument();
    // Vitals auto-flag from the demo data (CLN-T3).
    expect(await screen.findByText("FEVER")).toBeInTheDocument();
    expect(screen.getByText(/SOAP note/i)).toBeInTheDocument();
    expect(screen.getByText(/Diagnoses \(ICD-10\)/i)).toBeInTheDocument();
    expect(screen.getByText(/Prescribe/i)).toBeInTheDocument();
    // Patient banner shows the count, not the allergy contents (P-7).
    expect(screen.getByText(/Allergies: 1/)).toBeInTheDocument();
    expect(screen.queryByText("Penicillin")).not.toBeInTheDocument();
  });

  it("gates the controlled-Rx fields behind the controlled checkbox (CLN-T5)", async () => {
    renderAt("/clinical/visits/v-demo", <VisitChartPage />);
    const cb = screen.getByLabelText(/Controlled drug/i);
    fireEvent.click(cb);
    expect(screen.getByLabelText(/Special-Rx serial/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Quantity in words/i)).toBeInTheDocument();
  });

  it("sign-locks the note and confirms the consequence first", async () => {
    renderAt("/clinical/visits/v-demo", <VisitChartPage />);
    fireEvent.click(screen.getByRole("button", { name: /Sign \(locks\)/i }));
    expect(await screen.findByText(/Signing locks this SOAP note/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Sign note/i }));
    // A draft is required before signing succeeds — the error is explicit.
    await waitFor(() => expect(screen.getByText(/Save the note first/i)).toBeInTheDocument());
  });
});
