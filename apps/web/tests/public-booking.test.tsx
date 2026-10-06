import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router";
import { describe, expect, it, beforeEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { PublicBookingPage } from "../src/features/clinical/PublicBookingPage.js";
import { useStubHandler, type StubHandler } from "./setup.js";

const publicBookingHandler: StubHandler = (req, res) => {
  const url = req.url ?? "";
  const method = req.method ?? "GET";
  res.writeHead(200, { "content-type": "application/json" });

  if (url.includes("/public/booking/clinic")) {
    res.end(
      JSON.stringify({
        clinic: {
          id: "11111111-1111-4111-8111-111111111111",
          name: "Metro Health Demo Clinic",
          slug: "demo-a",
        },
        branches: [
          {
            id: "a1000000-0000-4000-8000-000000000001",
            name: "Main Branch - Makati",
            code: "MAIN",
          },
        ],
        practitioners: [
          {
            id: "doc-1",
            name: "Dr. Maria Elena Reyes",
            title: "Attending Physician",
            specialization: "Internal Medicine",
          },
        ],
      }),
    );
    return;
  }

  if (url.includes("/public/booking/availability")) {
    res.end(
      JSON.stringify({
        date: "2026-11-20",
        slots: [
          {
            startsAt: "2026-11-20T09:00:00Z",
            endsAt: "2026-11-20T09:30:00Z",
            available: true,
          },
          {
            startsAt: "2026-11-20T10:00:00Z",
            endsAt: "2026-11-20T10:30:00Z",
            available: true,
          },
        ],
      }),
    );
    return;
  }

  if (url.includes("/public/booking/appointments") && method === "POST") {
    res.end(
      JSON.stringify({
        appointmentId: "apt-12345",
        referenceNo: "APT-12345",
        status: "BOOKED",
        channel: "ONLINE",
        startsAt: "2026-11-20T09:00:00Z",
        endsAt: "2026-11-20T09:30:00Z",
        patientName: "Juan Dela Cruz",
        practitionerId: "doc-1",
        branchId: "a1000000-0000-4000-8000-000000000001",
      }),
    );
    return;
  }

  res.end(JSON.stringify({ message: "ok" }));
};

describe("PublicBookingPage (Independent Patient Scheduling)", () => {
  beforeEach(() => {
    useStubHandler(publicBookingHandler);
  });

  it("renders the public booking interface with clinic name and doctor list without login", async () => {
    render(
      <MemoryRouter initialEntries={["/book?slug=demo-a"]}>
        <Routes>
          <Route path="/book" element={<PublicBookingPage />} />
        </Routes>
      </MemoryRouter>,
    );

    const clinicNames = await screen.findAllByText("Metro Health Demo Clinic");
    expect(clinicNames.length).toBeGreaterThan(0);
    expect(screen.getByText("Schedule a Doctor's Appointment")).toBeInTheDocument();
    const docNames = await screen.findAllByText("Dr. Maria Elena Reyes");
    expect(docNames.length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Internal Medicine/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Main Branch - Makati/i).length).toBeGreaterThan(0);
  });

  it("allows selecting a time slot, filling patient info, and confirms booking", async () => {
    render(
      <MemoryRouter initialEntries={["/book?slug=demo-a"]}>
        <Routes>
          <Route path="/book" element={<PublicBookingPage />} />
        </Routes>
      </MemoryRouter>,
    );

    // Wait for doctor to appear
    const docNames = await screen.findAllByText("Dr. Maria Elena Reyes");
    expect(docNames.length).toBeGreaterThan(0);

    // Available slot button
    const slotBtn = await screen.findByRole("button", { name: /9:00 AM/i });
    expect(slotBtn).toBeInTheDocument();
    fireEvent.click(slotBtn);

    // Fill patient details
    fireEvent.change(screen.getByLabelText(/FIRST NAME/i), { target: { value: "Juan" } });
    fireEvent.change(screen.getByLabelText(/LAST NAME/i), { target: { value: "Dela Cruz" } });
    fireEvent.change(screen.getByLabelText(/MOBILE NUMBER/i), { target: { value: "09171234567" } });
    fireEvent.change(screen.getByLabelText(/REASON FOR CONSULTATION/i), { target: { value: "Annual checkup and medical clearance" } });

    // Submit booking
    const submitBtn = screen.getByRole("button", { name: /Confirm & Book Appointment/i });
    expect(submitBtn).toBeEnabled();
    fireEvent.click(submitBtn);

    // Wait for confirmation receipt
    expect(await screen.findByText(/Appointment Confirmed!/i)).toBeInTheDocument();
    expect(screen.getAllByText("APT-12345").length).toBeGreaterThan(0);
    expect(screen.getByText("Juan Dela Cruz")).toBeInTheDocument();
    expect(screen.getByText(/CONFIRMED \(ONLINE BOOKING\)/i)).toBeInTheDocument();
  });
});
