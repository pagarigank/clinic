import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { AuthProvider } from "../src/shared/auth/AuthContext.js";
import { DuplicateReviewPage } from "../src/features/patients/DuplicateReviewPage.js";
import { PatientsPage } from "../src/features/patients/PatientsPage.js";

/**
 * JOB-22 duplicate candidates review (todo §2.2) and the registration live
 * duplicate check with "this is the same person" acknowledgement
 * (frontend.md §14.3). No delete affordance exists anywhere in either surface.
 */
describe("Duplicate candidates review (todo §2.2, JOB-22)", () => {
  it("lists candidate pairs with match type, score, and no delete action", async () => {
    render(
      <MemoryRouter>
        <AuthProvider>
          <DuplicateReviewPage />
        </AuthProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByText(/JOB-22 patient\.duplicate\.detect worklist/i)).toBeInTheDocument();
    expect(screen.getByText("Santos, Maria Elena")).toBeInTheDocument();
    expect(screen.getByText("Santos, Maria Ellena")).toBeInTheDocument();
    expect(screen.getByText(/Name similarity/i)).toBeInTheDocument();
    expect(screen.getByText("0.93")).toBeInTheDocument();
    // Append-only: the screen disposes of candidates, it never deletes.
    expect(screen.queryByRole("button", { name: /delete/i })).not.toBeInTheDocument();
  });

  it("requires an audited reason before disposing of a candidate", async () => {
    render(
      <MemoryRouter>
        <AuthProvider>
          <DuplicateReviewPage />
        </AuthProvider>
      </MemoryRouter>,
    );

    fireEvent.click((await screen.findAllByRole("button", { name: /Compare & dispose/i }))[0]!);
    const distinct = screen.getByRole("button", { name: /Mark distinct/i });

    // No reason → the audit gate refuses.
    fireEvent.click(distinct);
    expect(await screen.findByRole("alert")).toHaveTextContent(/reason is required/i);

    fireEvent.change(screen.getByLabelText(/Reason \(required/i), { target: { value: "Different middle name confirmed by phone" } });
    fireEvent.click(distinct);

    expect(await screen.findByText(/marked distinct\./i)).toBeInTheDocument();
    expect(screen.getAllByText("ACKNOWLEDGED").length).toBeGreaterThan(0);
  });
});

describe("Registration duplicate gate (frontend §14.3)", () => {
  it("gates submit behind the same-person acknowledgement when a duplicate is detected", async () => {
    render(
      <MemoryRouter>
        <AuthProvider>
          <PatientsPage />
        </AuthProvider>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: /Register New Patient/i }));
    expect(screen.getByText(/Patient Intake & Registration/i)).toBeInTheDocument();

    // Santos + 1988-04-12 collides with the seeded demo record.
    fireEvent.change(screen.getByPlaceholderText(/e\.g\. Maria/i), { target: { value: "Maria Elena" } });
    fireEvent.change(screen.getByPlaceholderText(/e\.g\. Santos/i), { target: { value: "Santos" } });
    const dobInputs = screen.getAllByDisplayValue("1990-01-01");
    fireEvent.change(dobInputs[0]!, { target: { value: "1988-04-12" } });

    const warning = await screen.findByText(/Possible duplicates found \(1\)/i, {}, { timeout: 3000 });
    expect(warning).toBeInTheDocument();
    // The candidate card names the seeded record (the registry table behind
    // the modal shows the same number, hence getAllByText).
    expect(screen.getAllByText(/PAT-2026-0001/).length).toBeGreaterThan(0);

    const submit = screen.getByRole("button", { name: /Save & Create Patient Record/i });
    expect(submit).toBeDisabled();

    const ackCheckbox = screen.getByLabelText(/This is the same person/i);
    fireEvent.click(ackCheckbox);
    await waitFor(() => expect(submit).toBeEnabled());
  });
});
