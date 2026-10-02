import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AlertBanner,
  DateField,
  DataTable,
  EmptyState,
  MoneyField,
  PatientBanner,
  QRSummary,
  ReasonModal,
  ScanInput,
  SearchCombobox,
  SkeletonTable,
  StatusPill,
  StepConfirmModal,
  Timeline,
} from "../src/index.js";

afterEach(cleanup);

describe("StatusPill (frontend P-5)", () => {
  it("always carries a text label, never colour alone", () => {
    render(<StatusPill tone="critical" label="Critical" />);
    expect(screen.getByText("Critical")).toBeInTheDocument();
  });

  it("maps every tone to its token class so the palette is centralised", () => {
    const tones = ["critical", "high", "normal", "low", "neutral", "pending"] as const;
    for (const tone of tones) {
      const { unmount } = render(<StatusPill tone={tone} label={`${tone} label`} />);
      const pill = document.querySelector(`.clinic-status-${tone}`);
      expect(pill).not.toBeNull();
      expect(pill?.className).toContain("clinic-status");
      unmount();
    }
  });

  it("hides a decorative icon from assistive tech but keeps the label", () => {
    render(<StatusPill tone="high" label="Near expiry" icon="⚠" />);
    expect(screen.getByText("Near expiry")).toBeInTheDocument();
    // The icon glyph must not be announced as content.
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });
});

describe("AlertBanner", () => {
  it("uses role=alert only for danger so critical banners announce immediately", () => {
    const { rerender } = render(<AlertBanner severity="danger">Stop</AlertBanner>);
    expect(screen.getByRole("alert")).toHaveTextContent("Stop");

    rerender(<AlertBanner severity="info">FYI</AlertBanner>);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("FYI");
  });

  it("keeps the existing severity prop working (back-compat with 9 call sites)", () => {
    render(<AlertBanner severity="warning">Check</AlertBanner>);
    expect(screen.getByRole("status")).toHaveTextContent("Check");
  });

  it("accepts tone as the design-system alias", () => {
    render(<AlertBanner tone="success" title="Saved">All good</AlertBanner>);
    expect(screen.getByText("Saved")).toBeInTheDocument();
    expect(screen.getByText("All good")).toBeInTheDocument();
  });
});

describe("EmptyState / SkeletonTable (frontend §19)", () => {
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

  it("announces loading and keeps a stable shape", () => {
    const { container } = render(<SkeletonTable rows={2} />);
    const region = container.querySelector('[aria-busy="true"]');
    expect(region).not.toBeNull();
    expect(screen.getByRole("status", { name: "" }) ?? region).toBeTruthy();
    expect(container.querySelectorAll(".placeholder").length).toBeGreaterThan(0);
  });
});

describe("ReasonModal (frontend §5.2, ground rule 7)", () => {
  const codes = [
    { value: "PATIENT_REQUEST", label: "Patient request" },
    { value: "DATA_ERROR", label: "Data entry error" },
  ];

  it("blocks confirm until BOTH a reason code and free text are supplied", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <ReasonModal
        show
        title="Void receipt"
        description="This voids the posted receipt."
        consequence="The original stays in the ledger as reversed."
        reasonCodes={codes}
        onConfirm={onConfirm}
        onCancel={() => {}}
      />,
    );

    const confirm = screen.getByRole("button", { name: "Confirm" });
    expect(confirm).toBeDisabled();

    await user.selectOptions(screen.getByLabelText(/Reason code/i), "DATA_ERROR");
    expect(confirm).toBeDisabled(); // code alone is not evidence

    await user.type(screen.getByLabelText(/Explanation/i), "Duplicate entry");
    expect(confirm).toBeEnabled();

    await user.click(confirm);
    expect(onConfirm).toHaveBeenCalledWith({ code: "DATA_ERROR", text: "Duplicate entry" });
  });

  it("clears a previous reason when reopened so a stale justification cannot attach", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <ReasonModal show title="Void" description="d" reasonCodes={codes} onConfirm={() => {}} onCancel={() => {}} />,
    );
    await user.selectOptions(screen.getByLabelText(/Reason code/i), "DATA_ERROR");
    await user.type(screen.getByLabelText(/Explanation/i), "first attempt");

    // close, then reopen
    rerender(<ReasonModal show={false} title="Void" description="d" reasonCodes={codes} onConfirm={() => {}} onCancel={() => {}} />);
    rerender(<ReasonModal show title="Void" description="d" reasonCodes={codes} onConfirm={() => {}} onCancel={() => {}} />);

    expect(screen.getByLabelText(/Reason code/i)).toHaveValue("");
    expect(screen.getByLabelText(/Explanation/i)).toHaveValue("");
    expect(screen.getByRole("button", { name: "Confirm" })).toBeDisabled();
  });

  it("surfaces a server error and refuses to confirm while busy", () => {
    render(
      <ReasonModal
        show
        busy
        error="Period is locked"
        title="Void"
        description="d"
        reasonCodes={codes}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Period is locked");
    expect(screen.getByRole("button", { name: "Working…" })).toBeDisabled();
  });
});

describe("StepConfirmModal (frontend P-3)", () => {
  it("names the entity and lists consequences", () => {
    render(
      <StepConfirmModal
        show
        title="Post GRN"
        entityLabel="Goods receipt"
        entityName="GRN-2026-000123"
        consequences={["Stock becomes on-hand", "The document becomes immutable"]}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByText("GRN-2026-000123")).toBeInTheDocument();
    expect(screen.getByText("Stock becomes on-hand")).toBeInTheDocument();
    expect(screen.getByText("The document becomes immutable")).toBeInTheDocument();
  });

  it("requires a passphrase only when the caller asks for step-up (G-14)", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const { rerender } = render(
      <StepConfirmModal show title="t" entityLabel="e" entityName="n" consequences={["c"]} onConfirm={onConfirm} onCancel={() => {}} />,
    );
    expect(screen.queryByLabelText(/passphrase/i)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Confirm" }));
    expect(onConfirm).toHaveBeenCalled();

    rerender(
      <StepConfirmModal
        show
        title="t"
        entityLabel="e"
        entityName="n"
        consequences={["c"]}
        requiresPassphrase
        onConfirm={onConfirm}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: "Confirm" })).toBeDisabled();
    await user.type(screen.getByLabelText(/passphrase/i), "secret");
    expect(screen.getByRole("button", { name: "Confirm" })).toBeEnabled();
  });
});

describe("PatientBanner (frontend P-7 progressive PHI reveal)", () => {
  const patient = { id: "p1", name: "Juan Dela Cruz", dateOfBirth: "1990-04-01", sex: "M" };

  it("shows only the count when collapsed — never the allergy contents", () => {
    render(
      <PatientBanner
        patient={patient}
        allergies={[{ substance: "Penicillin", reaction: "Rash", severity: "high" }]}
        allergiesCount={1}
      />,
    );
    expect(screen.getByText(/Allergies: 1/)).toBeInTheDocument();
    expect(screen.queryByText("Penicillin")).not.toBeInTheDocument();
  });

  it("reports each reveal so the server can audit the PHI read (G-07)", async () => {
    const user = userEvent.setup();
    const onReveal = vi.fn();
    render(<PatientBanner patient={patient} allergies={[{ substance: "Penicillin" }]} allergiesCount={1} onReveal={onReveal} />);

    await user.click(screen.getByRole("button", { name: /Show details/i }));
    expect(onReveal).toHaveBeenCalledWith("allergies");
    expect(screen.getByText("Penicillin")).toBeInTheDocument();
  });

  it("does not fire onReveal when collapsing", async () => {
    const user = userEvent.setup();
    const onReveal = vi.fn();
    render(<PatientBanner patient={patient} allergies={[{ substance: "Penicillin" }]} allergiesCount={1} onReveal={onReveal} />);
    const toggle = screen.getByRole("button", { name: /Show details/i });
    await user.click(toggle);
    await user.click(toggle);
    expect(onReveal).toHaveBeenCalledTimes(1);
  });
});

describe("Timeline (append-only history)", () => {
  it("renders entries and never offers an edit affordance", () => {
    render(
      <Timeline
        entries={[
          { at: "2026-10-01 09:00", title: "Result amended", actor: "Dr Santos", tone: "high" },
          { at: "2026-10-01 08:00", title: "Result verified", actor: "Medtech Reyes" },
        ]}
      />,
    );
    expect(screen.getByText("Result amended")).toBeInTheDocument();
    expect(screen.getByText("by Dr Santos")).toBeInTheDocument();
    expect(document.querySelectorAll("button, input, textarea")).toHaveLength(0);
  });

  it("states plainly when there is no history", () => {
    render(<Timeline entries={[]} />);
    expect(screen.getByText(/No history recorded/i)).toBeInTheDocument();
  });
});

describe("QRSummary / MoneyField / DateField (frontend §5.2)", () => {
  it("renders a scannable identity block", () => {
    render(<QRSummary primary="Juan Dela Cruz" secondary="DOB 1990-04-01" tertiary="MRN 000123" />);
    expect(screen.getByText("Juan Dela Cruz")).toBeInTheDocument();
    expect(screen.getByText("MRN 000123")).toBeInTheDocument();
  });

  it("keeps the currency symbol out of the input and in the label", () => {
    render(<MoneyField label="Amount" currency="PHP" value="100" onChange={() => {}} />);
    const input = screen.getByLabelText(/Amount/i) as HTMLInputElement;
    expect(input).toHaveValue(100);
    // The symbol lives in the label, never in the value a keypad produces.
    expect(input.value).not.toContain("₱");
  });

  it("rounds a money field to currency minor units on blur", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<MoneyField label="Amount" value="100.005" onChange={onChange} />);
    // Tab must move focus OUT of the field for the blur handler to fire.
    await user.click(screen.getByLabelText(/Amount/i));
    await user.tab();
    expect(onChange).toHaveBeenCalledWith("100.01");
  });

  it("uses a native date input so keyboard/screen-reader behaviour is not re-implemented", () => {
    render(<DateField label="Date of birth" value="1990-04-01" onChange={() => {}} />);
    expect(screen.getByLabelText(/Date of birth/i)).toHaveAttribute("type", "date");
  });
});

describe("DataTable (frontend §5.2 — server-driven)", () => {
  interface Row {
    id: string;
    name: string;
    balance: number;
  }
  const rows: Row[] = [
    { id: "1", name: "Alpha", balance: 100 },
    { id: "2", name: "Beta", balance: 250 },
  ];
  const columns = [
    { key: "name", header: "Name", render: (r: Row) => r.name, sortable: true },
    { key: "balance", header: "Balance", render: (r: Row) => r.balance, numeric: true },
  ];

  it("exposes the sort state via aria-sort on the sorted column", async () => {
    const onSortChange = vi.fn();
    render(
      <DataTable
        columns={columns}
        rows={rows}
        getRowId={(r) => r.id}
        caption="Patients"
        sort={{ key: "name", direction: "asc" }}
        onSortChange={onSortChange}
      />,
    );
    const headers = screen.getAllByRole("columnheader");
    expect(headers[0]).toHaveAttribute("aria-sort", "ascending");
    expect(headers[1]).not.toHaveAttribute("aria-sort");
  });

  it("flips direction on the same column and starts ascending on a new one", async () => {
    const user = userEvent.setup();
    const onSortChange = vi.fn();
    render(
      <DataTable
        columns={columns}
        rows={rows}
        getRowId={(r) => r.id}
        caption="Patients"
        sort={{ key: "name", direction: "asc" }}
        onSortChange={onSortChange}
      />,
    );
    await user.click(screen.getByRole("button", { name: /Name/ }));
    expect(onSortChange).toHaveBeenLastCalledWith({ key: "name", direction: "desc" });
  });

  it("marks numeric columns so tabular numerals apply", () => {
    render(<DataTable columns={columns} rows={rows} getRowId={(r) => r.id} caption="Patients" />);
    const cells = document.querySelector("tbody")?.querySelectorAll("td");
    expect(cells?.[1]?.className).toContain("tabular");
  });

  it("shows the empty state rather than an empty table", () => {
    render(
      <DataTable
        columns={columns}
        rows={[]}
        getRowId={(r: Row) => r.id}
        caption="Patients"
        emptyHeadline="No patients"
        emptyExplanation="Try a different search."
      />,
    );
    expect(screen.getByRole("heading", { name: "No patients" })).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("announces loading with a skeleton instead of an empty grid", () => {
    const { container } = render(
      <DataTable columns={columns} rows={[]} getRowId={(r: Row) => r.id} caption="Patients" loading />,
    );
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(screen.queryByRole("heading", { name: "No patients" })).not.toBeInTheDocument();
  });

  it("is keyboard-operable when rows are activatable (P-9)", async () => {
    const user = userEvent.setup();
    const onRowActivate = vi.fn();
    render(
      <DataTable columns={columns} rows={rows} getRowId={(r) => r.id} caption="Patients" onRowActivate={onRowActivate} />,
    );
    const firstRow = document.querySelector("tbody tr") as HTMLElement | null;
    firstRow?.focus();
    await user.keyboard("{Enter}");
    expect(onRowActivate).toHaveBeenCalledWith(rows[0]);
  });
});

describe("SearchCombobox (frontend §5.2 — keyboard-navigable picker)", () => {
  interface Opt {
    id: string;
    label: string;
    detail?: string;
  }
  const options: Opt[] = [
    { id: "a", label: "Amoxicillin", detail: "500mg cap" },
    { id: "b", label: "Azithromycin", detail: "250mg tab" },
  ];
  const getId = (o: unknown) => (o as Opt).id;
  const getLabel = (o: unknown) => (o as Opt).label;
  const getDetail = (o: unknown) => (o as Opt).detail ?? null;

  it("implements the combobox pattern with aria-activedescendant", async () => {
    const user = userEvent.setup();
    render(
      <SearchCombobox
        label="Medicine"
        value=""
        onChange={() => {}}
        onSearch={() => {}}
        options={options}
        getOptionId={getId}
        getOptionLabel={getLabel}
        getOptionDescription={getDetail}
      />,
    );
    const input = screen.getByRole("combobox", { name: "Medicine" });
    expect(input).toHaveAttribute("aria-expanded", "false");

    await user.type(input, "am");
    const listbox = screen.getByRole("listbox");
    expect(input).toHaveAttribute("aria-controls", listbox.id);

    await user.keyboard("{ArrowDown}");
    // The active option id is generated by useId, so assert the *relationship*
    // (aria-activedescendant points at the element aria-selected marks) rather
    // than a hardcoded id string.
    const activeId = input.getAttribute("aria-activedescendant");
    expect(activeId).toBeTruthy();
    const activeOption = document.getElementById(activeId!);
    expect(activeOption).not.toBeNull();
    expect(activeOption).toHaveAttribute("role", "option");
    expect(activeOption).toHaveAttribute("aria-selected", "true");
    expect(activeOption).toHaveTextContent("Amoxicillin");
  });

  it("selects with Enter and reports the label", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <SearchCombobox
        label="Medicine"
        value=""
        onChange={onChange}
        onSearch={() => {}}
        options={options}
        getOptionId={getId}
        getOptionLabel={getLabel}
      />,
    );
    const input = screen.getByRole("combobox", { name: "Medicine" });
    await user.type(input, "a");
    await user.keyboard("{ArrowDown}{Enter}");
    expect(onChange).toHaveBeenCalledWith("Amoxicillin");
  });
});

describe("ScanInput (frontend P-1 scan-first, P-9 keyboard-complete)", () => {
  it("treats an Enter-terminated value as a scan, which is how keyboard-wedge hardware works", async () => {
    const user = userEvent.setup();
    const onScan = vi.fn();
    render(<ScanInput label="Item code" value="12345" onScan={onScan} />);
    const input = screen.getByLabelText("Item code");
    input.focus();
    await user.keyboard("{Enter}");
    expect(onScan).toHaveBeenCalledWith("12345");
  });

  it("keeps manual entry available even with a camera configured", () => {
    const scan = vi.fn(async () => "999");
    render(<ScanInput label="Item code" value="" onScan={() => {}} enableCamera scan={scan} />);
    expect(screen.getByLabelText("Item code")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Scan" })).toBeInTheDocument();
  });
});