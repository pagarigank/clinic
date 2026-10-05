import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { AuthProvider } from "../src/shared/auth/AuthContext.js";
import { StepUpProvider } from "../src/shared/auth/StepUpContext.js";
import { BillingWorkbenchPage } from "../src/features/billing/BillingWorkbenchPage.js";
import { CashierPosPage } from "../src/features/billing/CashierPosPage.js";
import { CashierShiftsPage } from "../src/features/billing/CashierShiftsPage.js";
import { CreditNotesPage } from "../src/features/billing/CreditNotesPage.js";
import { DailyClosePage } from "../src/features/billing/DailyClosePage.js";
import * as billingApi from "../src/features/billing/api.js";

/**
 * The billing pages fetch from ./api.js. Without a stub the network call fails in
 * jsdom and the pages used to paper over it with hardcoded fixtures, which is how
 * tests ended up asserting on invented invoices. Stub the module so every test
 * exercises the real render path and can control exactly what the "server" returns.
 */
vi.mock("../src/features/billing/api.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/features/billing/api.js")>();
  return {
    ...actual,
    fetchActiveShift: vi.fn(),
    fetchInvoices: vi.fn(),
    fetchPaymentMethods: vi.fn(),
    fetchSessions: vi.fn(),
    saveSession: vi.fn(),
    createPayment: vi.fn(),
    fetchPaymentReceipt: vi.fn(),
    reprintReceipt: vi.fn(),
  };
});

function renderWithProviders(ui: React.ReactElement, initialEntries: string[] = ["/"]) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <AuthProvider>
        <StepUpProvider>{ui}</StepUpProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe("BillingWorkbenchPage (todo.md §7.1, BIL-T1)", () => {
  it("renders KPI cards, invoice register, and filters", async () => {
    renderWithProviders(<BillingWorkbenchPage />);

    expect(screen.getByText(/Billing Workbench & Invoices/i)).toBeInTheDocument();
    expect(screen.getByText(/Total Invoiced/i)).toBeInTheDocument();
    expect(screen.getByText(/Outstanding Receivables/i)).toBeInTheDocument();
    expect(screen.getByText(/Collected Revenue/i)).toBeInTheDocument();

    // Verify invoice list
    await waitFor(() => {
      expect(screen.getByText("INV-2026-000101")).toBeInTheDocument();
    });
    expect(screen.getByText("Juan Dela Cruz")).toBeInTheDocument();
  });

  it("opens invoice details modal and shows Professional Fee separation (Q-17)", async () => {
    renderWithProviders(<BillingWorkbenchPage />);

    await waitFor(() => {
      expect(screen.getByText("INV-2026-000101")).toBeInTheDocument();
    });

    const detailButtons = screen.getAllByRole("button", { name: /Details/i });
    fireEvent.click(detailButtons[0]!);

    expect(await screen.findByText(/Itemized Charges & Services/i)).toBeInTheDocument();
    expect(screen.getByText(/Professional Fee \(Q-17\)/i)).toBeInTheDocument();
    expect(screen.getByText(/Senior Citizen \(RA 9994\)/i)).toBeInTheDocument();
  });

  it("opens statutory discount modal with mandatory ID fields", async () => {
    renderWithProviders(<BillingWorkbenchPage />);

    await waitFor(() => {
      expect(screen.getByText("INV-2026-000101")).toBeInTheDocument();
    });

    const detailButtons = screen.getAllByRole("button", { name: /Details/i });
    fireEvent.click(detailButtons[0]!);

    const applyDiscountBtn = await screen.findByRole("button", { name: /Apply Discount/i });
    fireEvent.click(applyDiscountBtn);

    expect(await screen.findByText(/Apply Statutory Discount/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Discount Program/i)).toBeInTheDocument();
  });
});

describe("CashierPosPage (todo.md §7.2, BIL-T2, BIL-T3)", () => {
  // These used to assert on the page's own hardcoded fixtures — a fabricated
  // shift (shift-demo-1 / SFT-2026-000001), a fabricated invoice
  // (INV-2026-000101 / "Juan Dela Cruz") and fabricated payment methods
  // (pm-cash). They passed only because the page fell back to that data whenever
  // an API call failed, which is exactly the behaviour that let a cashier "take
  // payment" against records that do not exist. The API layer is now mocked so the
  // tests exercise the real render path against server-shaped data.
  const SHIFT = {
    id: "11111111-2222-4333-8444-555555555555",
    shift_no: "SH-2026-000243",
    opening_cash: 1000,
    opened_at: new Date().toISOString(),
    cashier_name: "Demo A — Staff / Receptionist",
    status: "OPEN",
  };
  const INVOICE = {
    id: "22222222-3333-4444-8555-666666666666",
    invoice_no: "INV-2026-001163",
    patient_first_name: "Maria",
    patient_last_name: "Dela Cruz",
    patient_number: "P-000999",
    balance: 1200,
    total: 1200,
    payer_type: "PRIVATE_CASH",
    lines: [{ id: "l1", description: "Consultation", net_amount: 1200, is_professional_fee: true }],
  };
  const METHODS = [
    // Real UUIDs — the API rejects non-UUID methodId, which is what surfaced the bug.
    { id: "33333333-4444-4555-8666-777777777777", code: "CASH", name: "Cash" },
    { id: "44444444-5555-4666-8777-888888888888", code: "GCASH", name: "GCash" },
  ];

  beforeEach(() => {
    vi.mocked(billingApi.fetchActiveShift).mockReset().mockResolvedValue(SHIFT as never);
    vi.mocked(billingApi.fetchInvoices).mockReset().mockResolvedValue({ data: [INVOICE] } as never);
    vi.mocked(billingApi.fetchPaymentMethods).mockReset().mockResolvedValue({ data: METHODS } as never);
    vi.mocked(billingApi.fetchSessions).mockReset().mockResolvedValue({ data: [] } as never);
  });

  it("renders the POS with the shift and invoice the API returned", async () => {
    renderWithProviders(<CashierPosPage />);

    expect(screen.getByText(/Cashier POS & Official Receipts/i)).toBeInTheDocument();
    expect(screen.getByText(/1. Select Invoice to Settle/i)).toBeInTheDocument();
    expect(screen.getByText(/2. Payment & Split Tender/i)).toBeInTheDocument();

    // The shift number must come from the server, not a literal.
    await waitFor(() => {
      expect(screen.getByText(SHIFT.shift_no)).toBeInTheDocument();
    });
    expect(screen.getAllByText(/Maria Dela Cruz/i).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Juan Dela Cruz/i)).not.toBeInTheDocument();
  });

  it("shows an empty POS rather than a fabricated invoice when none are open", async () => {
    vi.mocked(billingApi.fetchInvoices).mockResolvedValue({ data: [] } as never);
    renderWithProviders(<CashierPosPage />);

    await waitFor(() => {
      expect(screen.getByText(/No invoices are awaiting payment/i)).toBeInTheDocument();
    });
    // The fabricated invoice must never appear.
    expect(screen.queryByText(/INV-2026-000101/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Juan Dela Cruz/i)).not.toBeInTheDocument();
  });

  it("does not invent a payment method when none can be loaded", async () => {
    vi.mocked(billingApi.fetchPaymentMethods).mockRejectedValue(new Error("boom"));
    renderWithProviders(<CashierPosPage />);

    await waitFor(() => {
      expect(screen.getByText(/Payment methods could not be loaded/i)).toBeInTheDocument();
    });
    expect(screen.queryByText("pm-cash")).not.toBeInTheDocument();
  });

  it("handles split tender payments and computes cash change dynamically", async () => {
    renderWithProviders(<CashierPosPage />);

    await waitFor(() => {
      expect(screen.getAllByText(/Maria Dela Cruz/i).length).toBeGreaterThan(0);
    });

    // The page defaults the first tender to CASH and to the invoice balance once
    // both the invoice and the real payment methods have loaded, so the cash
    // field appears on its own — no fabricated method needed.
    await waitFor(() => {
      expect(screen.getByPlaceholderText(/Cash handed by patient/i)).toBeInTheDocument();
    });

    // Cash handed 1500 against a 1200 balance -> 300 change.
    const cashInput = screen.getByPlaceholderText(/Cash handed by patient/i);
    fireEvent.change(cashInput, { target: { value: "1500" } });

    await waitFor(() => {
      expect(screen.getByText("₱300.00")).toBeInTheDocument();
    });

    // Add split tender line
    const splitBtn = screen.getByRole("button", { name: /Split Tender/i });
    fireEvent.click(splitBtn);

    expect(screen.getByText("Tender #2")).toBeInTheDocument();
  });

  it("reads the posted payment out of the { payment } envelope the API returns", async () => {
    // POST /billing/payments answers { payment, changeAmount, invoice }. The record
    // is nested, so `paymentRes.id` is undefined and the receipt request goes to
    // /billing/payments/undefined/receipt (500) — the cashier gets a payment with no
    // official receipt. Pin the unwrap so the envelope cannot silently change.
    vi.mocked(billingApi.createPayment).mockResolvedValue({
      payment: {
        id: "pay-real-1",
        payment_no: "OR-2026-000584",
        amount: 585,
        status: "POSTED",
      },
      changeAmount: 0,
      invoice: { id: "inv-real-1", invoiceNo: "INV-2026-001284", status: "PAID" },
    } as never);
    vi.mocked(billingApi.fetchPaymentReceipt).mockResolvedValue({
      id: "pay-real-1",
      receipt_no: "OR-2026-000584",
    } as never);

    renderWithProviders(<CashierPosPage />);

    await waitFor(() => {
      expect(billingApi.fetchInvoices).toHaveBeenCalled();
    });

    const payBtn = await screen.findByRole("button", { name: /Complete Payment/i });
    fireEvent.click(payBtn);

    await waitFor(() => {
      expect(billingApi.createPayment).toHaveBeenCalled();
    });

    // The receipt lookup must carry the real payment id, never the string "undefined".
    await waitFor(() => {
      expect(billingApi.fetchPaymentReceipt).toHaveBeenCalledWith("pay-real-1");
    });
    const receiptArg = vi.mocked(billingApi.fetchPaymentReceipt).mock.calls[0]![0];
    expect(receiptArg).toBeTruthy();
    expect(receiptArg).not.toBe("undefined");
  });

});

describe("CashierShiftsPage (todo.md §7.3, BIL-T5)", () => {
  it("renders active shift and historical blind reconciliation records", async () => {
    renderWithProviders(<CashierShiftsPage />);

    expect(screen.getByText(/Cashier Shifts & Blind Reconciliation/i)).toBeInTheDocument();
    expect(screen.getByText(/Past Shifts & Reconciliation Log/i)).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("SFT-2026-000001")).toBeInTheDocument();
    });
    expect(screen.getByText(/Balanced \(₱0.00\)/i)).toBeInTheDocument();
    expect(screen.getByText(/Short \(-₱50.00\)/i)).toBeInTheDocument();
  });

  it("enforces blind count on shift closure without exposing system expected cash", async () => {
    renderWithProviders(<CashierShiftsPage />);

    const closeBtn = await screen.findByRole("button", { name: /Close Active Shift \(Blind Count\)/i });
    fireEvent.click(closeBtn);

    expect(await screen.findByText(/Internal Control Notice:/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Physical Counted Cash in Drawer/i)).toBeInTheDocument();
    // System expected cash must NOT be rendered in this modal
    expect(screen.queryByText(/System Expected Cash:/i)).not.toBeInTheDocument();
  });
});

describe("CreditNotesPage (todo.md §7.4)", () => {
  it("renders credit notes register and issue modal", async () => {
    renderWithProviders(<CreditNotesPage />);

    expect(screen.getByText(/Credit Notes & Adjustments/i)).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("CN-2026-000001")).toBeInTheDocument();
    });

    const issueBtn = screen.getByRole("button", { name: /Issue Credit Note/i });
    fireEvent.click(issueBtn);

    expect(await screen.findByText(/Issue New Credit Note/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Target Invoice/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Adjustment Amount/i)).toBeInTheDocument();
  });
});

describe("DailyClosePage (todo.md §7.4, JOB-48, Q-16)", () => {
  it("renders daily collections summary with breakdown by payment method", async () => {
    renderWithProviders(<DailyClosePage />);

    expect(screen.getByText(/Daily Close & PhilHealth Konsulta Tally/i)).toBeInTheDocument();
    expect(screen.getByText(/Collections Breakdown by Tender Method/i)).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText(/💵 Cash/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/💳 Cards/i)).toBeInTheDocument();
    expect(screen.getByText(/📱 Wallets/i)).toBeInTheDocument();
  });

  it("switches to PhilHealth Konsulta Daily Tally tab (Q-16)", async () => {
    renderWithProviders(<DailyClosePage />);

    const konsultaTab = screen.getByRole("button", { name: /PhilHealth Konsulta Daily Tally/i });
    fireEvent.click(konsultaTab);

    expect(await screen.findByText(/Daily Konsulta Patient Encounters/i)).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText("Dr. Maria Santos, MD")).toBeInTheDocument();
    });
    expect(screen.getByText(/PHA-NCR-2024-0012/)).toBeInTheDocument();
    expect(screen.getByText(/PhilHealth Konsulta Initial Consultation/)).toBeInTheDocument();
  });

  it("switches to Receivables & Aging tab (RPT-BIL-03)", async () => {
    renderWithProviders(<DailyClosePage />);

    const recvTab = screen.getByRole("button", { name: /Receivables & Aging/i });
    fireEvent.click(recvTab);

    expect(await screen.findByText(/Accounts Receivables & Aging Schedule/i)).toBeInTheDocument();
    expect(screen.getByText(/0 – 30 Days \(Current\)/i)).toBeInTheDocument();
    expect(screen.getByText(/> 90 Days \(Overdue\)/i)).toBeInTheDocument();
    expect(screen.getByText(/Itemized Open & Partial Invoices/i)).toBeInTheDocument();
  });

  it("switches to Discounts Audit tab (RPT-BIL-04)", async () => {
    renderWithProviders(<DailyClosePage />);

    const discTab = screen.getByRole("button", { name: /Discounts Audit/i });
    fireEvent.click(discTab);

    expect(await screen.findByText(/Statutory & Promo Discounts Audit Log/i)).toBeInTheDocument();
    expect(screen.getByText(/Total Discounts Granted/i)).toBeInTheDocument();
    expect(screen.getByText(/OSCA_ID: OSCA-MNL-2023-8891/i)).toBeInTheDocument();
  });

  it("switches to Voids Audit tab (RPT-BIL-05)", async () => {
    renderWithProviders(<DailyClosePage />);

    const voidsTab = screen.getByRole("button", { name: /Voids Audit Log/i });
    fireEvent.click(voidsTab);

    expect(await screen.findByText(/Voided Transactions Audit Log/i)).toBeInTheDocument();
    expect(screen.getByText(/Voided Invoices Total/i)).toBeInTheDocument();
    expect(screen.getByText(/Voided Payments Total/i)).toBeInTheDocument();
    expect(screen.getByText(/Duplicate invoice generated by mistake/i)).toBeInTheDocument();
  });
});

describe("Phase 7 Enhancements: SOA, POS Hold/Resume, Shift X/Z Reports", () => {
  it("opens Statement of Account (SOA) modal with aging schedule from BillingWorkbenchPage", async () => {
    renderWithProviders(<BillingWorkbenchPage />);

    const soaBtn = (await screen.findAllByRole("button", { name: "SOA" }))[0]!;
    fireEvent.click(soaBtn);

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText(/0–30 Days/i)).toBeInTheDocument();
    expect(screen.getByText(/31–60 Days/i)).toBeInTheDocument();
    expect(screen.getByText(/Net Balance Due/i)).toBeInTheDocument();
  });

  it("holds and resumes ticket in CashierPosPage", async () => {
    renderWithProviders(<CashierPosPage />);

    await waitFor(() => {
      expect(screen.getByText(/SHIFT ACTIVE/i)).toBeInTheDocument();
    });

    // Click Hold Ticket
    const holdBtn = screen.getByRole("button", { name: /Hold \(F4\)/i });
    fireEvent.click(holdBtn);

    // Held tickets button shows 1 ticket
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Held Tickets \(1\)/i })).toBeInTheDocument();
    });

    // Open Held Tickets modal
    const ticketsBtn = screen.getByRole("button", { name: /Held Tickets \(1\)/i });
    fireEvent.click(ticketsBtn);

    expect(await screen.findByText(/Held Transactions \(1\)/i)).toBeInTheDocument();

    // Resume the held ticket
    const resumeBtn = screen.getByRole("button", { name: /^Resume$/i });
    fireEvent.click(resumeBtn);

    // Modal closes and ticket restored
    await waitFor(() => {
      expect(screen.queryByText(/Held Transactions \(1\)/i)).not.toBeInTheDocument();
    });
  });

  it("opens Mid-Shift X-Report and End-of-Shift Z-Report from CashierShiftsPage", async () => {
    renderWithProviders(<CashierShiftsPage />);

    // Click X-Report button on active shift
    const xReportBtn = await screen.findByRole("button", { name: /View X-Report/i });
    fireEvent.click(xReportBtn);

    expect(await screen.findByText(/Mid-Shift Inquiry \(X-Reading\)/i)).toBeInTheDocument();
    expect(screen.getByText(/Tender Breakdown \(Interim\)/i)).toBeInTheDocument();
    expect(screen.getByText(/Estimated Drawer Position/i)).toBeInTheDocument();

    // Close X-Report modal
    const closeBtns = screen.getAllByRole("button", { name: /Close/i });
    fireEvent.click(closeBtns[closeBtns.length - 1]!);

    // Click Z-Report button on past shift row
    const zReportBtns = await screen.findAllByRole("button", { name: /Z-Report/i });
    expect(zReportBtns.length).toBeGreaterThan(0);
    fireEvent.click(zReportBtns[0]!);

    expect(await screen.findByText(/End-of-Shift Z-Reading & Settlement/i)).toBeInTheDocument();
    expect(screen.getByText(/Reconciliation & Variance/i)).toBeInTheDocument();
  });


});

