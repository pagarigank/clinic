import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Code, DateTime, Money, Quantity } from "../src/index.js";

afterEach(cleanup);

/**
 * Renderers (frontend §5.2): display-only. They must never recompute, round,
 * or second-guess a server value (ground rule 6 / P-6) — an unrenderable value
 * becomes an em dash, never a guessed amount.
 */
describe("Money renderer (frontend §5.2)", () => {
  it("formats a canonical numeric(14,2) string with Intl, not ad-hoc templates", () => {
    render(<Money amount="1234.50" currency="PHP" locale="en-PH" />);
    expect(screen.getByText("₱1,234.50")).toBeInTheDocument();
  });

  it("accepts numbers as well as pg-returned decimal strings", () => {
    render(<Money amount={42} currency="PHP" locale="en-PH" />);
    expect(screen.getByText("₱42.00")).toBeInTheDocument();
  });

  it("renders an em dash for missing or non-numeric values instead of a wrong amount", () => {
    const { rerender } = render(<Money amount={null} />);
    expect(screen.getByText("—")).toBeInTheDocument();
    rerender(<Money amount="12,50" />);
    expect(screen.getByText("—")).toBeInTheDocument();
    rerender(<Money amount={Number.NaN} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("falls back to ISO code + amount for an unknown currency rather than throwing", () => {
    render(<Money amount="5" currency="NOT-A-CODE" />);
    expect(screen.getByText("NOT-A-CODE 5")).toBeInTheDocument();
  });
});

describe("Quantity renderer", () => {
  it("renders the value with tabular numerals and appends the UOM", () => {
    const { container } = render(<Quantity value="12" uom="packs" />);
    expect(screen.getByText(/12/)).toBeInTheDocument();
    expect(screen.getByText("packs")).toBeInTheDocument();
    // tabular class drives font-variant-numeric for column alignment (§5.1)
    expect(container.querySelector(".tabular")).not.toBeNull();
  });

  it("shows an em dash rather than 0 for a missing quantity — 0 is a clinical value", () => {
    render(<Quantity value={null} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("keeps up to 4 fraction digits for analyte-style quantities", () => {
    render(<Quantity value="0.12345" />);
    // Intl maximumFractionDigits: 4 → 0.1235 (display rounding of a stored
    // value; the stored value is untouched).
    expect(screen.getByText(/0\.1235/)).toBeInTheDocument();
  });
});

describe("DateTime renderer (G-08 canonical storage, locale display)", () => {
  it("renders an ISO instant in the tenant timezone", () => {
    render(<DateTime iso="2026-10-01T00:30:00.000Z" timezone="Asia/Manila" locale="en-PH" mode="datetime" />);
    // Node's ICU zero-pads the 2-digit hour ("08:30 AM") — assert the shape.
    expect(screen.getByText(/Oct 1, 2026, 0?8:30( AM)?/i)).toBeInTheDocument();
  });

  it("supports date-only and time-only modes", () => {
    const { rerender } = render(<DateTime iso="2026-10-01T00:30:00.000Z" timezone="Asia/Manila" mode="date" />);
    expect(screen.getByText(/2026/)).toBeInTheDocument();
    rerender(<DateTime iso="2026-10-01T00:30:00.000Z" timezone="Asia/Manila" mode="time" />);
    expect(screen.getByText(/8:30/i)).toBeInTheDocument();
  });

  it("renders an em dash for null and keeps the ISO in the title for hover honesty", () => {
    const { rerender, container } = render(<DateTime iso={null} />);
    expect(screen.getByText("—")).toBeInTheDocument();
    rerender(<DateTime iso="2026-10-01T00:30:00.000Z" />);
    const span = container.querySelector("span[title]");
    expect(span?.getAttribute("title")).toBe("2026-10-01T00:30:00.000Z");
  });

  it("renders garbage input as an em dash, never as Invalid Date", () => {
    render(<DateTime iso="not-a-date" />);
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.queryByText(/invalid/i)).not.toBeInTheDocument();
  });
});

describe("Code renderer", () => {
  it("renders identifiers in a monospace code element", () => {
    render(<Code>pharmacy.rx.verify</Code>);
    const code = screen.getByText("pharmacy.rx.verify");
    expect(code.tagName).toBe("CODE");
    expect(code.className).toContain("clinic-mono");
  });
});
