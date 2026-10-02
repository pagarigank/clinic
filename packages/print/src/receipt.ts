/**
 * Receipt shaping - the one place that decides what an official receipt says.
 *
 * These are pure functions on purpose. Two callers build receipts for the same
 * money: the worker (`JOB-50 billing.receipt.generate`) for the original, and
 * the API (`POST /billing/payments/:id/reprint`) when a reprint has to be
 * rendered because no original document exists. If each of them shaped its own
 * document they could drift, and a receipt number would end up meaning two
 * different things depending on which path issued it.
 *
 * So retrieval stays with the caller (it owns its SQL) and every decision about
 * *content* lives here: which lines are patient-facing (Q-17), what the
 * subtotal is, and how the numbers are laid out for the 32-column printer.
 */

import type { ReceiptDocument } from "./templates.js";
import type { Receipt as ThermalReceipt } from "./escpos.js";

/**
 * The facts a receipt is built from, as read from the tenant's own rows.
 *
 * `invoiceTotal` is the invoice's stored total (after discount) and
 * `discountTotal` the discount on it, so the receipt can show the
 * pre-discount subtotal the patient is being charged against.
 */
export interface ReceiptFacts {
  clinicName: string;
  receiptNo: string;
  /** ISO 8601. `pg` returns TIMESTAMPTZ as a Date, so callers must convert. */
  issuedAt: string;
  cashierName: string;
  patientName?: string;
  lines: Array<{ description: string; qty: number; unitPrice: number; total: number }>;
  /** Null for a payment not tied to an invoice. */
  invoiceTotal?: number | null;
  discountTotal?: number | null;
  /** What was actually collected. Always the receipt's headline total. */
  amount: number;
  amountTendered: number;
  changeGiven: number;
  payer?: string;
  /** Set when this document is a reissue rather than the original. */
  reprintedFrom?: string;
}

/**
 * Build the patient-facing receipt document.
 *
 * Q-17: callers pass only patient-safe line data. The PF rate, revenue share
 * and internal notes never reach `ReceiptFacts`, so there is nothing here that
 * could leak them - the exclusion is structural, not a filter that a future
 * change might forget to reapply.
 */
export function buildReceiptDocument(facts: ReceiptFacts): ReceiptDocument {
  const discountTotal = facts.discountTotal ?? 0;

  return {
    clinicName: facts.clinicName,
    receiptNo: facts.receiptNo,
    // Omitted rather than left undefined, so an original receipt carries no
    // reissue provenance at all.
    ...(facts.reprintedFrom ? { reprintedFrom: facts.reprintedFrom } : {}),
    issuedAt: facts.issuedAt,
    cashierName: facts.cashierName,
    patientName: facts.patientName,
    lines: facts.lines,
    // A receipt against an invoice shows the pre-discount subtotal; a payment
    // with no invoice has nothing to discount, so the amount collected stands.
    subtotal: facts.invoiceTotal ? facts.invoiceTotal + discountTotal : facts.amount,
    discount: discountTotal > 0 ? { label: "Discount", amount: discountTotal } : null,
    total: facts.amount,
    amountTendered: facts.amountTendered,
    changeGiven: facts.changeGiven,
    payer: facts.payer,
  };
}

/** Same numbers as the PDF, laid out for a 32-column thermal printer. */
export function toThermalReceipt(doc: ReceiptDocument): ThermalReceipt {
  const lines: ThermalReceipt["lines"] = [];

  if (doc.patientName) lines.push({ label: "Patient", value: doc.patientName });
  if (doc.payer) lines.push({ label: "Payer", value: doc.payer });

  for (const line of doc.lines) {
    lines.push({ label: line.description, value: format(line.total) });
  }

  if (doc.discount?.amount) {
    lines.push({ label: doc.discount.label, value: `-${format(doc.discount.amount)}` });
  }

  const receipt: ThermalReceipt = {
    clinicName: doc.clinicName,
    receiptNo: doc.receiptNo,
    issuedAt: doc.issuedAt,
    cashierName: doc.cashierName,
    patientName: doc.patientName,
    lines,
    subtotalValue: format(doc.subtotal),
    totalValue: format(doc.total),
  };

  if (doc.amountTendered !== undefined) {
    lines.push({ label: "Tendered", value: format(doc.amountTendered), alignRight: true });
  }
  if (doc.changeGiven !== undefined && doc.changeGiven > 0) {
    lines.push({ label: "Change", value: format(doc.changeGiven), alignRight: true });
  }

  return receipt;
}

function format(value: number): string {
  return value.toFixed(2);
}
