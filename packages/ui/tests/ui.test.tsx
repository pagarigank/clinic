import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { EmptyState, StatusPill } from "../src/index.js";

afterEach(cleanup);

describe("StatusPill (frontend P-5)", () => {
  it("always carries a text label, never colour alone", () => {
    render(<StatusPill tone="critical" label="Critical" />);
    expect(screen.getByText("Critical")).toBeInTheDocument();
  });
});

describe("EmptyState (frontend §19)", () => {
  it("renders headline, explanation, and action", () => {
    render(
      <EmptyState
        headline="No patients yet"
        explanation="Register the first patient to begin."
        action={<button type="button">Register patient</button>}
      />,
    );
    expect(screen.getByRole("heading", { name: "No patients yet" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Register patient" })).toBeInTheDocument();
  });
});
