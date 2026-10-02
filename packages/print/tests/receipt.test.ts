import { describe, it, expect } from 'vitest';
import { buildReceiptDocument, toThermalReceipt, type ReceiptFacts } from '../src/index.js';

/**
 * The worker's JOB-50 and the API's reprint endpoint both shape receipts
 * through these functions, so a change here changes what a patient is handed
 * in both paths.
 */

const base: ReceiptFacts = {
  clinicName: 'Riverside Family Clinic',
  receiptNo: 'PAY-2026-0001',
  issuedAt: '2026-10-02T09:15:00.000Z',
  cashierName: 'Demo B Doctor',
  patientName: 'Dela Cruz, Juan',
  lines: [{ description: 'Consultation', qty: 1, unitPrice: 1500, total: 1500 }],
  invoiceTotal: 1500,
  discountTotal: 0,
  amount: 1500,
  amountTendered: 2000,
  changeGiven: 500,
  payer: 'PRIVATE_CASH',
};

describe('buildReceiptDocument', () => {
  it('keeps the collected amount as the headline total', () => {
    const doc = buildReceiptDocument(base);
    expect(doc.total).toBe(1500);
    expect(doc.receiptNo).toBe('PAY-2026-0001');
    expect(doc.amountTendered).toBe(2000);
    expect(doc.changeGiven).toBe(500);
  });

  it('derives the pre-discount subtotal from the invoice total plus the discount', () => {
    // The invoice stores 1500 *after* a 200 discount, so the patient was
    // charged against 1700 and the receipt has to say so.
    const doc = buildReceiptDocument({ ...base, invoiceTotal: 1500, discountTotal: 200, amount: 1500 });
    expect(doc.subtotal).toBe(1700);
    expect(doc.discount).toEqual({ label: 'Discount', amount: 200 });
  });

  it('falls back to the amount collected when the payment has no invoice', () => {
    const doc = buildReceiptDocument({ ...base, invoiceTotal: null, discountTotal: null });
    expect(doc.subtotal).toBe(1500);
    expect(doc.discount).toBeNull();
  });

  it('carries no discount row when the discount is zero', () => {
    expect(buildReceiptDocument({ ...base, discountTotal: 0 }).discount).toBeNull();
  });

  it('marks a reissue without altering the money on it', () => {
    const original = buildReceiptDocument(base);
    const reprint = buildReceiptDocument({ ...base, reprintedFrom: 'PAY-2026-0001' });

    expect(reprint.reprintedFrom).toBe('PAY-2026-0001');
    expect(original.reprintedFrom).toBeUndefined();
    // The reissue must show the same figures as the original: same receipt
    // number, same total, same change. Only provenance differs.
    expect(reprint.total).toBe(original.total);
    expect(reprint.subtotal).toBe(original.subtotal);
    expect(reprint.changeGiven).toBe(original.changeGiven);
  });

  it('exposes nothing beyond the facts it was given', () => {
    const doc = buildReceiptDocument(base);
    // Q-17 is structural: no internal field exists on the facts, so none can
    // reach the document.
    expect(Object.keys(doc).sort()).toEqual(
      [
        'amountTendered',
        'cashierName',
        'changeGiven',
        'clinicName',
        'discount',
        'issuedAt',
        'lines',
        'patientName',
        'payer',
        'receiptNo',
        'subtotal',
        'total',
      ].sort(),
    );
  });
});

describe('toThermalReceipt', () => {
  const labels = (doc: Parameters<typeof toThermalReceipt>[0]) =>
    toThermalReceipt(doc).lines.map((l) => l.label);

  it('lays out patient, payer and lines', () => {
    const lines = labels(buildReceiptDocument(base));
    expect(lines).toEqual(['Patient', 'Payer', 'Consultation', 'Tendered', 'Change']);
  });

  it('shows the same total as the PDF', () => {
    const doc = buildReceiptDocument({ ...base, invoiceTotal: 1500, discountTotal: 200, amount: 1500 });
    const thermal = toThermalReceipt(doc);
    expect(thermal.totalValue).toBe('1500.00');
    expect(thermal.subtotalValue).toBe('1700.00');
    expect(thermal.lines.some((l) => l.label === 'Discount' && l.value === '-200.00')).toBe(true);
  });

  it('omits change when none was given', () => {
    const lines = labels(buildReceiptDocument({ ...base, changeGiven: 0 }));
    expect(lines).not.toContain('Change');
    expect(lines).toContain('Tendered');
  });
});
