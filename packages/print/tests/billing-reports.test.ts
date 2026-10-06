import { describe, expect, it } from "vitest";
import {
  renderPatientStatementHtml,
  renderShiftReportHtml,
  renderReceivablesAgingHtml,
  renderDailyCloseSummaryHtml,
  type PatientStatementDocument,
  type ShiftReportDocument,
  type ReceivablesAgingDocument,
  type DailyCloseSummaryDocument,
} from "../src/index.js";

describe("renderPatientStatementHtml", () => {
  const statement: PatientStatementDocument = {
    clinicName: "Metro Health Medical Center",
    clinicAddress: "123 Taft Avenue, Manila",
    clinicPhone: "(02) 8524-1000",
    generatedAt: "2026-10-05T08:00:00Z",
    patient: {
      id: "pat-1",
      name: "Juan Dela Cruz",
      dateOfBirth: "1980-05-15",
      gender: "M",
      patientNumber: "MRN-2026-0042",
    },
    summary: {
      totalBilled: 15450,
      totalPaid: 10000,
      totalBalance: 5450,
      aging: {
        current_0_30: 3450,
        days_31_60: 2000,
        days_61_90: 0,
        over_90: 0,
      },
    },
    invoices: [
      {
        invoiceNo: "INV-2026-00101",
        issuedAt: "2026-09-20",
        dueAt: "2026-10-20",
        status: "PARTIAL",
        total: 10000,
        paidAmount: 6000,
        balance: 4000,
      },
      {
        invoiceNo: "INV-2026-00142",
        issuedAt: "2026-10-02",
        dueAt: "2026-11-02",
        status: "OPEN",
        total: 5450,
        paidAmount: 4000,
        balance: 1450,
      },
    ],
  };

  it("renders clinic header, patient details, and statement title", () => {
    const html = renderPatientStatementHtml(statement);
    expect(html).toContain("Metro Health Medical Center");
    expect(html).toContain("STATEMENT OF ACCOUNT");
    expect(html).toContain("Juan Dela Cruz");
    expect(html).toContain("MRN-2026-0042");
  });

  it("renders itemized invoice rows, totals, and aging breakdown", () => {
    const html = renderPatientStatementHtml(statement);
    expect(html).toContain("INV-2026-00101");
    expect(html).toContain("INV-2026-00142");
    expect(html).toContain("15,450.00");
    expect(html).toContain("5,450.00");
    expect(html).toContain("Aging of Accounts Receivable");
    expect(html).toContain("3,450.00");
  });

  it("handles empty invoice lists gracefully", () => {
    const html = renderPatientStatementHtml({ ...statement, invoices: [] });
    expect(html).toContain("No active invoices on record");
  });
});

describe("renderShiftReportHtml (Z-Report and X-Report)", () => {
  const zReport: ShiftReportDocument = {
    clinicName: "Metro Health Medical Center",
    branchName: "Main Outpatient Pavilion",
    reportType: "Z_REPORT",
    title: "End-of-Shift Final Settlement (Z-Reading)",
    timestamp: "2026-10-05T18:00:00Z",
    shiftNo: "SH-2026-0089",
    shiftId: "sh-1",
    cashier: "Maria Santos, Cashier",
    openedAt: "2026-10-05T08:00:00Z",
    closedAt: "2026-10-05T17:30:00Z",
    status: "CLOSED",
    openingCash: 5000,
    countedCash: 24500,
    expectedCash: 24500,
    variance: 0,
    notes: "Drawer balanced cleanly.",
    metrics: {
      total_invoiced: 32000,
      total_discounts: 2500,
      total_collected: 29500,
      total_cash: 19500,
      total_card: 7000,
      total_ewallet: 3000,
      total_other: 0,
      transaction_count: 45,
      void_count: 1,
      refund_count: 0,
    },
  };

  it("renders Z-Report with cash balancing and tender breakdowns", () => {
    const html = renderShiftReportHtml(zReport);
    expect(html).toContain("END-OF-SHIFT FINAL SETTLEMENT (Z-READING)");
    expect(html).toContain("SH-2026-0089");
    expect(html).toContain("Maria Santos, Cashier");
    expect(html).toContain("5,000.00"); // opening cash
    expect(html).toContain("19,500.00"); // cash collections
    expect(html).toContain("24,500.00"); // counted cash
    expect(html).toContain("0.00 (BALANCED)");
    expect(html).toContain("7,000.00"); // card
    expect(html).toContain("3,000.00"); // ewallet
  });

  it("renders X-Report correctly without final variance", () => {
    const xReport: ShiftReportDocument = {
      ...zReport,
      reportType: "X_REPORT",
      title: "Mid-Shift Inquiry (X-Reading)",
      status: "OPEN",
      closedAt: null,
      countedCash: null,
      variance: null,
    };
    const html = renderShiftReportHtml(xReport);
    expect(html).toContain("MID-SHIFT INQUIRY (X-READING)");
    expect(html).toContain("Shift Status");
    expect(html).not.toContain("Physical Cash Counted");
  });
});

describe("renderReceivablesAgingHtml (RPT-BIL-03)", () => {
  const agingReport: ReceivablesAgingDocument = {
    clinicName: "Metro Health Medical Center",
    branchName: "Main Branch",
    asOfDate: "2026-10-05",
    totalReceivables: 18500,
    totalInvoices: 3,
    aging: {
      current_0_30: 10000,
      days_31_60: 5500,
      days_61_90: 3000,
      over_90: 0,
    },
    items: [
      {
        invoiceNo: "INV-001",
        issuedAt: "2026-10-01",
        ageDays: 4,
        patientName: "Ana Reyes",
        patientNumber: "MRN-101",
        payerType: "PRIVATE_CASH",
        total: 10000,
        paidAmount: 0,
        balance: 10000,
      },
      {
        invoiceNo: "INV-002",
        issuedAt: "2026-08-20",
        ageDays: 46,
        patientName: "Roberto Tan",
        patientNumber: "MRN-102",
        payerType: "HMO",
        total: 8500,
        paidAmount: 3000,
        balance: 5500,
      },
    ],
    generatedBy: "Finance Auditor",
  };

  it("renders aging schedule with bracketed summaries and line items", () => {
    const html = renderReceivablesAgingHtml(agingReport);
    expect(html).toContain("ACCOUNTS RECEIVABLES &amp; AGING SCHEDULE");
    expect(html).toContain("RPT-BIL-03");
    expect(html).toContain("18,500.00");
    expect(html).toContain("10,000.00");
    expect(html).toContain("5,500.00");
    expect(html).toContain("Ana Reyes");
    expect(html).toContain("Roberto Tan");
  });
});

describe("renderDailyCloseSummaryHtml (JOB-48)", () => {
  const dailyClose: DailyCloseSummaryDocument = {
    clinicName: "Metro Health Medical Center",
    closeDate: "2026-10-05",
    generatedAt: "2026-10-05T20:00:00Z",
    summaries: [
      {
        branch_name: "Main Branch",
        total_invoiced: 50000,
        total_discounts: 5000,
        total_collected: 45000,
        total_cash: 25000,
        total_card: 15000,
        total_ewallet: 5000,
        total_other: 0,
      },
      {
        branch_name: "Satellite Annex",
        total_invoiced: 20000,
        total_discounts: 1000,
        total_collected: 19000,
        total_cash: 12000,
        total_card: 5000,
        total_ewallet: 2000,
        total_other: 0,
      },
    ],
  };

  it("renders daily close consolidated summary across branches", () => {
    const html = renderDailyCloseSummaryHtml(dailyClose);
    expect(html).toContain("DAILY CLOSE CONSOLIDATED COLLECTIONS");
    expect(html).toContain("2026-10-05");
    expect(html).toContain("Main Branch");
    expect(html).toContain("Satellite Annex");
    expect(html).toContain("64,000.00"); // 45000 + 19000
    expect(html).toContain("JOB-48");
  });
});
