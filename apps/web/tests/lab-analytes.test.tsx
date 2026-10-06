import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { LaboratoryAnalytesModal } from "../src/features/laboratory/LaboratoryAnalytesModal.js";
import type { LabTest } from "../src/features/laboratory/api.js";

vi.mock("../src/features/laboratory/api.js", () => ({
  labApi: {
    listAnalytes: vi.fn(),
    createAnalyte: vi.fn(),
    deleteAnalyte: vi.fn(),
    listReferenceRanges: vi.fn(),
    createReferenceRange: vi.fn(),
  },
}));

import { labApi } from "../src/features/laboratory/api.js";

const mockTest = {
  id: "test-cbc",
  code: "CBC",
  name: "Complete Blood Count",
  is_active: true,
  is_panel: false,
} as unknown as LabTest;

const hemoglobin = {
  id: "ana-1",
  test_id: "test-cbc",
  code: "HGB",
  name: "Hemoglobin",
  default_unit: "g/dL",
  precision_digits: 2,
  sort_order: 0,
  is_active: true,
  is_calculated: false,
};

describe("LaboratoryAnalytesModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (labApi.listAnalytes as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (labApi.listReferenceRanges as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (labApi.createAnalyte as ReturnType<typeof vi.fn>).mockResolvedValue(hemoglobin);
    (labApi.createReferenceRange as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (labApi.deleteAnalyte as ReturnType<typeof vi.fn>).mockResolvedValue({ success: true });
  });

  it("loads analytes for the test and lists them", async () => {
    (labApi.listAnalytes as ReturnType<typeof vi.fn>).mockResolvedValue([hemoglobin]);

    render(
      <LaboratoryAnalytesModal show test={mockTest} canCreate canUpdate onClose={vi.fn()} />,
    );

    const dialog = await screen.findByRole("dialog");
    await waitFor(() =>
      expect(labApi.listAnalytes).toHaveBeenCalledWith("test-cbc"),
    );
    expect(await within(dialog).findByText("Hemoglobin")).toBeInTheDocument();
    expect(within(dialog).getByText(/HGB · g\/dL/)).toBeInTheDocument();
  });

  it("loads reference ranges when an analyte is selected", async () => {
    (labApi.listAnalytes as ReturnType<typeof vi.fn>).mockResolvedValue([hemoglobin]);
    (labApi.listReferenceRanges as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: "rng-1",
        analyte_id: "ana-1",
        sex: "MALE",
        age_min_days: 0,
        age_max_days: 36500,
        normal_min: 4,
        normal_max: 10,
        critical_low: 2,
        critical_high: 20,
        text_range: null,
      },
    ]);

    render(
      <LaboratoryAnalytesModal show test={mockTest} canCreate canUpdate onClose={vi.fn()} />,
    );

    const dialog = await screen.findByRole("dialog");
    fireEvent.click(await within(dialog).findByLabelText("Manage ranges for Hemoglobin"));

    await waitFor(() =>
      expect(labApi.listReferenceRanges).toHaveBeenCalledWith("ana-1"),
    );
    expect(await within(dialog).findByText("MALE")).toBeInTheDocument();
    expect(within(dialog).getByText("2 / 20")).toBeInTheDocument();
  });

  it("creates an analyte with the test id in the payload", async () => {
    render(
      <LaboratoryAnalytesModal show test={mockTest} canCreate canUpdate onClose={vi.fn()} />,
    );

    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByPlaceholderText("e.g. HGB"), {
      target: { value: "HGB" },
    });
    fireEvent.change(within(dialog).getByPlaceholderText("e.g. Hemoglobin"), {
      target: { value: "Hemoglobin" },
    });
    fireEvent.change(within(dialog).getByPlaceholderText("g/dL"), {
      target: { value: "g/dL" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Add analyte" }));

    await waitFor(() => expect(labApi.createAnalyte).toHaveBeenCalledTimes(1));
    expect(labApi.createAnalyte).toHaveBeenCalledWith("test-cbc", {
      testId: "test-cbc",
      code: "HGB",
      name: "Hemoglobin",
      defaultUnit: "g/dL",
      precisionDigits: 2,
      sortOrder: 0,
      isActive: true,
      isCalculated: false,
    });
  });

  it("validates required analyte fields before calling the API", async () => {
    render(
      <LaboratoryAnalytesModal show test={mockTest} canCreate canUpdate onClose={vi.fn()} />,
    );

    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Add analyte" }));

    expect(
      await within(dialog).findByText("Analyte code, name, and unit are required."),
    ).toBeInTheDocument();
    expect(labApi.createAnalyte).not.toHaveBeenCalled();
  });

  it("creates a reference range for the selected analyte", async () => {
    (labApi.listAnalytes as ReturnType<typeof vi.fn>).mockResolvedValue([hemoglobin]);

    render(
      <LaboratoryAnalytesModal show test={mockTest} canCreate canUpdate onClose={vi.fn()} />,
    );

    const dialog = await screen.findByRole("dialog");
    fireEvent.click(await within(dialog).findByLabelText("Manage ranges for Hemoglobin"));
    await waitFor(() =>
      expect(labApi.listReferenceRanges).toHaveBeenCalledWith("ana-1"),
    );

    fireEvent.change(within(dialog).getByLabelText("Normal min"), { target: { value: "4" } });
    fireEvent.change(within(dialog).getByLabelText("Normal max"), { target: { value: "10" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Add reference range" }));

    await waitFor(() => expect(labApi.createReferenceRange).toHaveBeenCalledTimes(1));
    expect(labApi.createReferenceRange).toHaveBeenCalledWith("ana-1", {
      analyteId: "ana-1",
      sex: "ALL",
      ageMinDays: 0,
      ageMaxDays: 36500,
      normalMin: 4,
      normalMax: 10,
      criticalLow: undefined,
      criticalHigh: undefined,
      textRange: undefined,
    });
  });

  it("removes an analyte when the user has update permission", async () => {
    (labApi.listAnalytes as ReturnType<typeof vi.fn>).mockResolvedValue([hemoglobin]);

    render(
      <LaboratoryAnalytesModal show test={mockTest} canCreate canUpdate onClose={vi.fn()} />,
    );

    const dialog = await screen.findByRole("dialog");
    fireEvent.click(await within(dialog).findByLabelText("Remove analyte Hemoglobin"));

    await waitFor(() => expect(labApi.deleteAnalyte).toHaveBeenCalledWith("ana-1"));
  });
});
