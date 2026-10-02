import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useLocation } from "react-router";
import { SearchProvider, useSearchContext, CommandPalette, type PatientRef } from "../src/shared/search/CommandPalette.js";

/**
 * Command palette — todo.md §2.3 (global patient search, recents, deep links)
 * per frontend.md §9. Deep links carry the patient id only (`/patients?focus=
 * <id>`); recents live in memory, never in storage (frontend §20).
 */
function LocationProbe({ onChange }: { onChange: (path: string) => void }) {
  const location = useLocation();
  onChange(location.pathname + location.search);
  return null;
}

function RecentsSeeder({ patient }: { patient: PatientRef }) {
  const { rememberPatient } = useSearchContext();
  return (
    <button type="button" onClick={() => rememberPatient(patient)}>
      seed-recent
    </button>
  );
}

describe("Command palette (todo §2.3, frontend §9)", () => {
  it("opens with Ctrl+K, filters navigation, and deep-links on Enter", async () => {
    let currentPath = "";
    render(
      <SearchProvider>
        <MemoryRouter initialEntries={["/dashboard"]}>
          <LocationProbe onChange={(p) => (currentPath = p)} />
          <CommandPalette />
          <Routes>
            <Route path="/dashboard" element={<div>Dashboard</div>} />
            <Route path="/patients/duplicates" element={<div>Duplicates</div>} />
          </Routes>
        </MemoryRouter>
      </SearchProvider>,
    );

    expect(screen.queryByRole("dialog", { name: /Global search/i })).not.toBeInTheDocument();
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true }));
    });

    const dialog = screen.getByRole("dialog", { name: /Global search/i });
    expect(dialog).toBeInTheDocument();

    const input = screen.getByLabelText(/Search patients and pages/i);
    await act(async () => {
      fireEvent.change(input, { target: { value: "dup" } });
    });
    expect(screen.getByText(/Duplicate Candidates \(JOB-22\)/i)).toBeInTheDocument();

    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });
    expect(currentPath).toBe("/patients/duplicates");
  });

  it("lists in-memory recents before typing and navigates to the id-only deep link", async () => {
    let currentPath = "";
    const patient: PatientRef = { id: "p1000000-0000-4000-8000-000000000001", name: "Santos, Maria Elena", patientNo: "PAT-2026-0001" };
    render(
      <SearchProvider>
        <MemoryRouter initialEntries={["/dashboard"]}>
          <LocationProbe onChange={(p) => (currentPath = p)} />
          <RecentsSeeder patient={patient} />
          <CommandPalette />
          <Routes>
            <Route path="/dashboard" element={<div>Dashboard</div>} />
            <Route path="/patients" element={<div>Registry</div>} />
          </Routes>
        </MemoryRouter>
      </SearchProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: /seed-recent/i }));
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true }));
    });

    expect(screen.getByText("Santos, Maria Elena")).toBeInTheDocument();
    expect(screen.getByText(/Recent · PAT-2026-0001/i)).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByText("Santos, Maria Elena"));
    expect(currentPath).toBe(`/patients?focus=${patient.id}`);
  });

  it("Esc closes without acting", async () => {
    render(
      <SearchProvider>
        <MemoryRouter>
          <CommandPalette />
        </MemoryRouter>
      </SearchProvider>,
    );
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true }));
    });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
