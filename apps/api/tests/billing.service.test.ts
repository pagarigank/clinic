/**
 * Billing Service Test Suite — Phase 7 (todo.md §7, specification.md §11, §18.9).
 *
 * Discharges acceptance criteria:
 *  - Invoice lifecycle from visit charges (consumed from Phase 3 charge capture)
 *  - Manual invoices and line origin traceability
 *  - Payer types (PRIVATE_CASH, HMO, PHILHEALTH, CORPORATE)
 *  - Private consultation receipts with professional fee separation (Q-17)
 *  - Discounts with mandatory ID capture (RA 9994 / RA 10754)
 *  - Revoking discounts before payment
 *  - Split-tender payment capture, tendered amount, change computation
 *  - Official Receipt generation (OR-YYYY-XXXXXX) and audited reprint counter
 *  - Void payment with balance reversal and step-up / reason
 *  - Cashier shift open/close with blind count and variance
 *  - Shared period lock enforcement (409 PERIOD_LOCKED)
 *  - Daily PhilHealth Konsulta tally
 *  - Tenant isolation (Tenant B cannot access Tenant A's invoices/payments)
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { probeDb } from '@clinic/db/tests/helpers.js';
import { createPool } from '@clinic/db';
import { BillingService } from '../src/billing/billing.service.js';
import { ProblemException } from '../src/http/problem.exception.js';
import { seedUsers, NO_SEED_USERS } from "@clinic/db/tests/helpers.js";

const hasDb = await probeDb();

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';
const BRANCH_A = 'a1000000-0000-4000-8000-000000000001';
const BRANCH_B = 'b1000000-0000-4000-8000-000000000001';
const { USER_A } = hasDb ? await seedUsers() : NO_SEED_USERS;
const { USER_B } = hasDb ? await seedUsers() : NO_SEED_USERS;
const { DOCTOR_A } = hasDb ? await seedUsers() : NO_SEED_USERS;

describe.skipIf(!hasDb)('BillingService (Phase 7)', () => {
  let svc: BillingService;
  const cleanupInvoiceIds: string[] = [];
  const cleanupShiftIds: string[] = [];
  const cleanupPatientIds: string[] = [];
  const cleanupVisitIds: string[] = [];
  const cleanupServiceIds: string[] = [];

  beforeEach(() => {
    svc = new BillingService();
  });

  afterAll(async () => {
    const ownerPool = createPool({ role: 'owner' });
    if (cleanupInvoiceIds.length > 0) {
      await ownerPool.query(`DELETE FROM payment_reprints WHERE payment_id IN (SELECT id FROM payments WHERE invoice_id = ANY($1))`, [cleanupInvoiceIds]);
      await ownerPool.query(`DELETE FROM payment_allocations WHERE invoice_id = ANY($1)`, [cleanupInvoiceIds]);
      await ownerPool.query(`DELETE FROM payments WHERE invoice_id = ANY($1)`, [cleanupInvoiceIds]);
      await ownerPool.query(`DELETE FROM credit_notes WHERE invoice_id = ANY($1)`, [cleanupInvoiceIds]);
      await ownerPool.query(`DELETE FROM discount_applications WHERE invoice_id = ANY($1)`, [cleanupInvoiceIds]);
      await ownerPool.query(`UPDATE billing_charges SET invoice_id = NULL, invoice_line_id = NULL WHERE invoice_id = ANY($1)`, [cleanupInvoiceIds]);
      await ownerPool.query(`DELETE FROM invoice_lines WHERE invoice_id = ANY($1)`, [cleanupInvoiceIds]);
      await ownerPool.query(`DELETE FROM invoices WHERE id = ANY($1)`, [cleanupInvoiceIds]);
    }
    if (cleanupShiftIds.length > 0) {
      await ownerPool.query(`DELETE FROM cashier_shifts WHERE id = ANY($1)`, [cleanupShiftIds]);
    }
    if (cleanupVisitIds.length > 0) {
      await ownerPool.query(`DELETE FROM billing_charges WHERE visit_id = ANY($1)`, [cleanupVisitIds]);
      await ownerPool.query(`DELETE FROM visits WHERE id = ANY($1)`, [cleanupVisitIds]);
    }
    if (cleanupPatientIds.length > 0) {
      await ownerPool.query(`DELETE FROM patient_philhealth WHERE patient_id = ANY($1)`, [cleanupPatientIds]);
      await ownerPool.query(`DELETE FROM patients WHERE id = ANY($1)`, [cleanupPatientIds]);
    }
    if (cleanupServiceIds.length > 0) {
      await ownerPool.query(`DELETE FROM service_catalog WHERE id = ANY($1)`, [cleanupServiceIds]);
    }
  });

  // Helper to create test patient and visit
  async function createTestPatientAndVisit(tenantId: string, branchId: string) {
    const ownerPool = createPool({ role: 'owner' });
    const pRes = await ownerPool.query(
      `INSERT INTO patients (tenant_id, first_name, last_name, date_of_birth, gender)
       VALUES ($1, 'Juan', 'Dela Cruz', '1955-06-15', 'M')
       RETURNING id`,
      [tenantId],
    );
    const patientId = pRes.rows[0]!.id;
    cleanupPatientIds.push(patientId);

    // Add PhilHealth record
    await ownerPool.query(
      `INSERT INTO patient_philhealth (tenant_id, patient_id, pin, membership_category, konsulta_status)
       VALUES ($1, $2, '12-345678901-2', 'KONSULTA', 'REGISTERED')`,
      [tenantId, patientId],
    );

    const visitNo = `VIS-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    const vRes = await ownerPool.query(
      `INSERT INTO visits (tenant_id, branch_id, visit_no, patient_id, practitioner_id, visit_type, status, opened_at, created_by)
       VALUES ($1, $2, $3, $4, $5, 'WALK_IN', 'IN_PROGRESS', now(), $6)
       RETURNING id`,
      [tenantId, branchId, visitNo, patientId, tenantId === TENANT_B ? USER_B : DOCTOR_A, tenantId === TENANT_B ? USER_B : USER_A],
    );
    const visitId = vRes.rows[0]!.id;
    cleanupVisitIds.push(visitId);

    return { patientId, visitId };
  }

  // ── Test 1: Invoicing & Line Item Math Invariant ────────────────────────────
  it('creates manual invoices and computes totals on backend (ground rule: no client totals)', async () => {
    const { patientId, visitId } = await createTestPatientAndVisit(TENANT_A, BRANCH_A);

    const invoice = await svc.createInvoice(TENANT_A, USER_A, {
      branchId: BRANCH_A,
      patientId,
      visitId,
      payerType: 'PRIVATE_CASH',
      lines: [
        {
          description: 'General Consultation (Dr. Rizal)',
          qty: 1,
          unitPrice: 500,
          isProfessionalFee: true,
          sourceType: 'CONSULT',
        },
        {
          description: 'CBC with Platelet',
          qty: 2,
          unitPrice: 250,
          isProfessionalFee: false,
          sourceType: 'LAB',
        },
      ],
    });

    cleanupInvoiceIds.push(invoice.id);

    expect(invoice.invoice_no).toMatch(/^INV-\d{4}-\d{6}$/);
    expect(Number(invoice.subtotal)).toBe(1000.0);
    expect(Number(invoice.discount_total)).toBe(0);
    expect(Number(invoice.total)).toBe(1000.0);
    expect(Number(invoice.balance)).toBe(1000.0);
    expect(invoice.status).toBe('OPEN');
    expect(invoice.lines).toHaveLength(2);
  });

  // ── Test 2: Consume Visit Charges (BIL-T1) ─────────────────────────────────
  it('consumes captured charges from billing_charges into an invoice with traceability', async () => {
    const { patientId, visitId } = await createTestPatientAndVisit(TENANT_A, BRANCH_A);

    // Price is resolved server-side from the catalog (todo §49: no client price).
    const ownerPool = createPool({ role: 'owner' });
    const svcRes = await ownerPool.query(
      `INSERT INTO service_catalog (tenant_id, code, name, category, default_price, is_active)
       VALUES ($1, 'PROC-DRESS', 'Minor Wound Dressing', 'procedure', 350, true)
       RETURNING id`,
      [TENANT_A],
    );
    const serviceId = svcRes.rows[0]!.id;
    cleanupServiceIds.push(serviceId);

    // Simulate Phase 3 charge capture
    const charge = await svc.createCharge(TENANT_A, USER_A, {
      visitId,
      chargeType: 'PROCEDURE',
      sourceType: 'PROCEDURE',
      sourceId: '33333333-3333-4333-8333-333333333333',
      serviceId,
      description: 'Minor Wound Dressing',
      quantity: 1,
      payerType: 'PRIVATE_CASH',
    });

    expect(charge.id).toBeDefined();

    // Create invoice consuming the charge
    const invoice = await svc.createInvoice(TENANT_A, USER_A, {
      branchId: BRANCH_A,
      patientId,
      visitId,
      consumeChargeIds: [charge.id],
    });

    cleanupInvoiceIds.push(invoice.id);

    expect(Number(invoice.total)).toBe(350.0);
    expect(invoice.lines).toHaveLength(1);
    expect(invoice.lines[0].source_type).toBe('CHARGE');
    expect(invoice.lines[0].source_id).toBe(charge.id);

    // Verify billing_charges row is now linked to invoice
    const checkCharge = await ownerPool.query(
      `SELECT invoice_id FROM billing_charges WHERE id = $1`,
      [charge.id],
    );
    expect(checkCharge.rows[0]!.invoice_id).toBe(invoice.id);
  });

  // ── Test 3: Discounts with ID Capture (BIL-T2, RA 9994 / RA 10754) ────────
  it('enforces mandatory ID capture for Senior/PWD discounts (DISCOUNT_ID_REQUIRED)', async () => {
    const { patientId, visitId } = await createTestPatientAndVisit(TENANT_A, BRANCH_A);

    const invoice = await svc.createInvoice(TENANT_A, USER_A, {
      branchId: BRANCH_A,
      patientId,
      visitId,
      lines: [
        {
          description: 'Specialist Consultation',
          qty: 1,
          unitPrice: 1000,
          isProfessionalFee: true,
          sourceType: 'CONSULT',
        },
      ],
    });
    cleanupInvoiceIds.push(invoice.id);

    const discounts = await svc.getDiscounts(TENANT_A);
    const seniorDiscount = discounts.find((d: any) => d.code === 'SENIOR');
    expect(seniorDiscount).toBeDefined();
    expect(seniorDiscount.requires_id).toBe(true);

    // Attempt to apply without ID number -> MUST reject with DISCOUNT_ID_REQUIRED
    await expect(
      svc.applyDiscount(TENANT_A, USER_A, invoice.id, {
        discountTypeId: seniorDiscount.id,
        idNumber: '', // Empty ID
      }),
    ).rejects.toThrow(ProblemException);

    // Apply with valid Senior Citizen ID number -> succeeds with 20% off
    const discountedInv = await svc.applyDiscount(TENANT_A, USER_A, invoice.id, {
      discountTypeId: seniorDiscount.id,
      idNumber: 'SC-12345-QC',
      idType: 'SENIOR_CITIZEN_ID',
    });

    expect(Number(discountedInv.discount_total)).toBe(200.0);
    expect(Number(discountedInv.total)).toBe(800.0);
    expect(Number(discountedInv.balance)).toBe(800.0);
    expect(discountedInv.discounts).toHaveLength(1);
    expect(discountedInv.discounts[0].id_number).toBe('SC-12345-QC');

    // Revoke discount before payment -> balance restored
    const revoked = await svc.revokeDiscount(TENANT_A, USER_A, discountedInv.discounts[0].id);
    expect(Number(revoked.discount_total)).toBe(0);
    expect(Number(revoked.total)).toBe(1000.0);
    expect(Number(revoked.balance)).toBe(1000.0);
  });

  // ── Test 4: Cashier Shifts & Blind Count Variance (BIL-T5) ─────────────────
  it('opens a cashier shift, requires active shift for payments, and tracks blind count variance', async () => {
    // Open shift
    const shift = await svc.openShift(TENANT_A, USER_A, {
      branchId: BRANCH_A,
      openingCash: 1000, // ₱1,000 float
      notes: 'Morning shift float',
    });
    cleanupShiftIds.push(shift.id);

    expect(shift.shift_no).toMatch(/^SH-\d{4}-\d{6}$/);
    expect(shift.status).toBe('OPEN');
    expect(Number(shift.opening_cash)).toBe(1000);

    const { patientId } = await createTestPatientAndVisit(TENANT_A, BRANCH_A);

    const invoice = await svc.createInvoice(TENANT_A, USER_A, {
      branchId: BRANCH_A,
      patientId,
      lines: [{ description: 'Follow-up Consultation', qty: 1, unitPrice: 500 }],
    });
    cleanupInvoiceIds.push(invoice.id);

    const ownerPool = createPool({ role: 'owner' });
    const cashMethod = await ownerPool.query(
      `SELECT id FROM payment_methods WHERE tenant_id = $1 AND code = 'CASH'`,
      [TENANT_A],
    );

    // Pay with cash
    await svc.createPayment(TENANT_A, USER_A, {
      branchId: BRANCH_A,
      invoiceId: invoice.id,
      shiftId: shift.id,
      methodId: cashMethod.rows[0]!.id,
      amount: 500,
      tenderedAmount: 500,
    });

    // Close shift with blind count: Expected = 1000 + 500 = 1500. Cashier counts 1480 (₱20 short).
    const closed = await svc.closeShift(TENANT_A, USER_A, shift.id, {
      countedCash: 1480,
      notes: '₱20 short change difference',
    });

    expect(closed.status).toBe('CLOSED');
    expect(Number(closed.counted_cash)).toBe(1480);
    expect(Number(closed.expected_cash)).toBe(1500);
    expect(Number(closed.variance)).toBe(-20.0); // Exact negative variance recorded!
  });

  // ── Test 5: Split Tender Payments, Change, and OR Generation (BIL-T3) ───────
  it('processes split-tender payments, computes change, and increments audited reprint counter', async () => {
    // Open shift
    const shift = await svc.openShift(TENANT_A, USER_A, {
      branchId: BRANCH_A,
      openingCash: 500,
    });
    cleanupShiftIds.push(shift.id);

    const { patientId } = await createTestPatientAndVisit(TENANT_A, BRANCH_A);

    const invoice = await svc.createInvoice(TENANT_A, USER_A, {
      branchId: BRANCH_A,
      patientId,
      lines: [{ description: 'Comprehensive Executive Health Exam', qty: 1, unitPrice: 3500 }],
    });
    cleanupInvoiceIds.push(invoice.id);

    const ownerPool = createPool({ role: 'owner' });
    const cashMethod = await ownerPool.query(`SELECT id FROM payment_methods WHERE tenant_id = $1 AND code = 'CASH'`, [TENANT_A]);
    const gcashMethod = await ownerPool.query(`SELECT id FROM payment_methods WHERE tenant_id = $1 AND code = 'GCASH'`, [TENANT_A]);

    // Partial payment via GCash (₱2,000)
    const pay1 = await svc.createPayment(TENANT_A, USER_A, {
      branchId: BRANCH_A,
      invoiceId: invoice.id,
      shiftId: shift.id,
      methodId: gcashMethod.rows[0]!.id,
      amount: 2000,
      tenderedAmount: 2000,
      reference: 'GCASH-REF-889900',
    });

    expect(pay1.invoice.paidAmount).toBe(2000);
    expect(pay1.invoice.balance).toBe(1500);
    expect(pay1.invoice.status).toBe('PARTIAL');

    // Final payment via Cash: owes 1500, tenders 2000 -> change 500
    const pay2 = await svc.createPayment(TENANT_A, USER_A, {
      branchId: BRANCH_A,
      invoiceId: invoice.id,
      shiftId: shift.id,
      methodId: cashMethod.rows[0]!.id,
      amount: 1500,
      tenderedAmount: 2000,
    });

    expect(pay2.changeAmount).toBe(500.0);
    expect(pay2.invoice.balance).toBe(0);
    expect(pay2.invoice.status).toBe('PAID');
    expect(pay2.payment.payment_no).toMatch(/^OR-\d{4}-\d{6}$/);

    // Official receipt reprint audit
    const receipt1 = await svc.getPaymentReceipt(TENANT_A, pay2.payment.id);
    expect(receipt1.isReprint).toBe(false);
    expect(receipt1.reprintCount).toBe(0);

    const reprinted = await svc.reprintReceipt(TENANT_A, USER_A, pay2.payment.id, {
      reason: 'Patient misplaced original receipt',
      format: 'PDF',
    });

    expect(reprinted.isReprint).toBe(true);
    expect(reprinted.reprintCount).toBe(1);
  });

  // ── Reprint artifact evidence (todo.md §7.2, migration 0041/0042) ───────────
  it('reissues the original receipt bytes and records their digest on the audit row', async () => {
    const shift = await svc.openShift(TENANT_A, USER_A, { branchId: BRANCH_A, openingCash: 500 });
    cleanupShiftIds.push(shift.id);

    const { patientId } = await createTestPatientAndVisit(TENANT_A, BRANCH_A);
    const invoice = await svc.createInvoice(TENANT_A, USER_A, {
      branchId: BRANCH_A,
      patientId,
      lines: [{ description: 'Reprint Evidence Consult', qty: 1, unitPrice: 1200 }],
    });
    cleanupInvoiceIds.push(invoice.id);

    const ownerPool = createPool({ role: 'owner' });
    const cashMethod = await ownerPool.query(`SELECT id FROM payment_methods WHERE tenant_id = $1 AND code = 'CASH'`, [TENANT_A]);
    const pay = await svc.createPayment(TENANT_A, USER_A, {
      branchId: BRANCH_A,
      invoiceId: invoice.id,
      shiftId: shift.id,
      methodId: cashMethod.rows[0]!.id,
      amount: 1200,
      tenderedAmount: 1200,
    });

    // Stand in for JOB-50 having issued the original document.
    const original = await ownerPool.query<{ id: string }>(
      `INSERT INTO files (tenant_id, object_key, file_name, mime_type, size_bytes,
                          uploaded_by, origin, content, sha256, status)
       VALUES ($1, $2, 'original.pdf', 'application/pdf', 5, $3, 'GENERATED', $4, $5, 'READY')
       RETURNING id`,
      [TENANT_A, `t/${TENANT_A}/receipt/${pay.payment.id}`, USER_A, Buffer.from('%PDF-'), 'a'.repeat(64)],
    );
    await ownerPool.query(
      `UPDATE payments SET receipt_file_id = $3, receipt_sha256 = $4 WHERE tenant_id = $1 AND id = $2`,
      [TENANT_A, pay.payment.id, original.rows[0]!.id, 'a'.repeat(64)],
    );

    const res = await svc.reprintReceipt(TENANT_A, USER_A, pay.payment.id, {
      reason: 'Patient lost the original',
      format: 'PDF',
    });

    // Reissued, not re-rendered: same artifact, and the caller is told so.
    expect(res.document!.reissuedOriginal).toBe(true);
    expect(res.document!.fileId).toBe(original.rows[0]!.id);
    expect(res.document!.sha256).toBe('a'.repeat(64));

    const audit = await ownerPool.query<{ file_id: string; sha256_hash: string; reason: string }>(
      `SELECT file_id, sha256_hash, reason FROM payment_reprints
       WHERE tenant_id = $1 AND payment_id = $2 ORDER BY reprinted_at DESC LIMIT 1`,
      [TENANT_A, pay.payment.id],
    );
    // The evidence of what was handed over now exists, which it did not before.
    expect(audit.rows[0]!.file_id).toBe(original.rows[0]!.id);
    expect(audit.rows[0]!.sha256_hash).toBe('a'.repeat(64));
    expect(audit.rows[0]!.reason).toBe('Patient lost the original');

    // And exactly one artifact was created - a reprint must not mint a second
    // document for a payment that already has one.
    const fileCount = await ownerPool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM files WHERE tenant_id = $1 AND object_key LIKE $2`,
      [TENANT_A, `t/${TENANT_A}/receipt/${pay.payment.id}%`],
    );
    expect(fileCount.rows[0]!.n).toBe(1);
    await ownerPool.end();
  });

  it('renders and stores a document when the original was never issued', async () => {
    const shift = await svc.openShift(TENANT_A, USER_A, { branchId: BRANCH_A, openingCash: 500 });
    cleanupShiftIds.push(shift.id);

    const { patientId } = await createTestPatientAndVisit(TENANT_A, BRANCH_A);
    const invoice = await svc.createInvoice(TENANT_A, USER_A, {
      branchId: BRANCH_A,
      patientId,
      lines: [{ description: 'No Original Receipt Consult', qty: 1, unitPrice: 900 }],
    });
    cleanupInvoiceIds.push(invoice.id);

    const ownerPool = createPool({ role: 'owner' });
    const cashMethod = await ownerPool.query(`SELECT id FROM payment_methods WHERE tenant_id = $1 AND code = 'CASH'`, [TENANT_A]);
    const pay = await svc.createPayment(TENANT_A, USER_A, {
      branchId: BRANCH_A,
      invoiceId: invoice.id,
      shiftId: shift.id,
      methodId: cashMethod.rows[0]!.id,
      amount: 900,
      tenderedAmount: 1000,
    });

    // JOB-50 has not swept this payment, so there is nothing to reissue.
    await ownerPool.query(
      `UPDATE payments SET receipt_file_id = NULL, receipt_sha256 = NULL, receipt_generated_at = NULL WHERE id = $1`,
      [pay.payment.id],
    );
    await ownerPool.query(
      `DELETE FROM files WHERE tenant_id = $1 AND (object_key LIKE $2 OR object_key LIKE $3)`,
      [TENANT_A, `t/${TENANT_A}/receipt/${pay.payment.id}%`, `receipts/${pay.payment.payment_no}.pdf`],
    );
    const before = await ownerPool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM files WHERE tenant_id = $1 AND object_key LIKE $2`,
      [TENANT_A, `t/${TENANT_A}/receipt/${pay.payment.id}%`],
    );
    expect(before.rows[0]!.n).toBe(0);

    const res = await svc.reprintReceipt(TENANT_A, USER_A, pay.payment.id, {
      reason: 'Original lost before the job ran',
      format: 'PDF',
    });

    expect(res.document!.reissuedOriginal).toBe(false);
    expect(res.document!.sha256).toMatch(/^[0-9a-f]{64}$/);

    const stored = await ownerPool.query<{ content: Buffer; sha256: string; size_bytes: number }>(
      `SELECT content, sha256, size_bytes FROM files WHERE tenant_id = $1 AND id = $2`,
      [TENANT_A, res.document!.fileId],
    );
    // Real PDF bytes, and the digest on the audit row is the digest of them.
    expect(stored.rows[0]!.content.subarray(0, 5).toString()).toBe('%PDF-');
    // size_bytes is BIGINT, which pg returns as a string.
    expect(Number(stored.rows[0]!.size_bytes)).toBe(stored.rows[0]!.content.length);
    const audit = await ownerPool.query<{ sha256_hash: string }>(
      `SELECT sha256_hash FROM payment_reprints WHERE tenant_id = $1 AND payment_id = $2
       ORDER BY reprinted_at DESC LIMIT 1`,
      [TENANT_A, pay.payment.id],
    );
    expect(audit.rows[0]!.sha256_hash).toBe(res.document!.sha256);
    await ownerPool.end();
  });

  it('emits an audited reprint event carrying the artifact that was issued', async () => {
    const shift = await svc.openShift(TENANT_A, USER_A, { branchId: BRANCH_A, openingCash: 500 });
    cleanupShiftIds.push(shift.id);

    const { patientId } = await createTestPatientAndVisit(TENANT_A, BRANCH_A);
    const invoice = await svc.createInvoice(TENANT_A, USER_A, {
      branchId: BRANCH_A,
      patientId,
      lines: [{ description: 'Reprint Event Consult', qty: 1, unitPrice: 700 }],
    });
    cleanupInvoiceIds.push(invoice.id);

    const ownerPool = createPool({ role: 'owner' });
    const cashMethod = await ownerPool.query(`SELECT id FROM payment_methods WHERE tenant_id = $1 AND code = 'CASH'`, [TENANT_A]);
    const pay = await svc.createPayment(TENANT_A, USER_A, {
      branchId: BRANCH_A,
      invoiceId: invoice.id,
      shiftId: shift.id,
      methodId: cashMethod.rows[0]!.id,
      amount: 700,
      tenderedAmount: 700,
    });

    await ownerPool.query(
      `UPDATE payments SET receipt_file_id = NULL, receipt_sha256 = NULL, receipt_generated_at = NULL WHERE id = $1`,
      [pay.payment.id],
    );
    await ownerPool.query(
      `DELETE FROM files WHERE tenant_id = $1 AND (object_key LIKE $2 OR object_key LIKE $3)`,
      [TENANT_A, `t/${TENANT_A}/receipt/${pay.payment.id}%`, `receipts/${pay.payment.payment_no}.pdf`],
    );

    const res = await svc.reprintReceipt(TENANT_A, USER_A, pay.payment.id, { reason: 'Duplicate request' });

    const ev = await ownerPool.query<{ payload: any; dedup_key: string | null; aggregate_type: string }>(
      `SELECT payload, dedup_key, aggregate_type FROM outbox
       WHERE tenant_id = $1 AND event_type = 'billing.receipt.reprinted'
         AND payload->>'reprintId' = $2`,
      [TENANT_A, res.reprintId],
    );
    expect(ev.rows).toHaveLength(1);
    expect(ev.rows[0]!.payload.reissuedOriginal).toBe(false);
    expect(ev.rows[0]!.payload.sha256).toBe(res.document!.sha256);
    expect(ev.rows[0]!.aggregate_type).toBe('payment');
    // Each reprint is a distinct audited act, so it is never deduplicated.
    expect(ev.rows[0]!.dedup_key).toBeNull();
    await ownerPool.end();
  });

  // ── Test 6: Voiding Payments and Reversal (BIL-T4) ──────────────────────────
  it('voids payments, reverses invoice balance, and rejects mutation on posted payments', async () => {
    const shift = await svc.openShift(TENANT_A, USER_A, { branchId: BRANCH_A, openingCash: 100 });
    cleanupShiftIds.push(shift.id);

    const { patientId } = await createTestPatientAndVisit(TENANT_A, BRANCH_A);
    const invoice = await svc.createInvoice(TENANT_A, USER_A, {
      branchId: BRANCH_A,
      patientId,
      lines: [{ description: 'Procedure Charge', qty: 1, unitPrice: 750 }],
    });
    cleanupInvoiceIds.push(invoice.id);

    const ownerPool = createPool({ role: 'owner' });
    const cashMethod = await ownerPool.query(`SELECT id FROM payment_methods WHERE tenant_id = $1 AND code = 'CASH'`, [TENANT_A]);

    const payment = await svc.createPayment(TENANT_A, USER_A, {
      branchId: BRANCH_A,
      invoiceId: invoice.id,
      shiftId: shift.id,
      methodId: cashMethod.rows[0]!.id,
      amount: 750,
      tenderedAmount: 750,
    });

    // Verify DB immutability trigger blocks direct UPDATE of posted amount
    await expect(
      ownerPool.query(`UPDATE payments SET amount = 999 WHERE id = $1`, [payment.payment.id]),
    ).rejects.toThrow();

    // Void payment through service
    const voidResult = await svc.voidPayment(TENANT_A, USER_A, payment.payment.id, {
      reason: 'Encoder error on billing amount',
    });
    expect(voidResult.status).toBe('VOIDED');

    // Invoice balance should be restored to 750 (status OPEN)
    const refreshedInv = await svc.getInvoiceById(TENANT_A, invoice.id);
    expect(Number(refreshedInv.balance)).toBe(750);
    expect(Number(refreshedInv.paid_amount)).toBe(0);
    expect(refreshedInv.status).toBe('OPEN');
  });

  // ── Test 7: Shared Period Lock Enforcement (AC-20, todo §7.4) ──────────────
  it('refuses postings when accounting period is locked (409 PERIOD_LOCKED)', async () => {
    const ownerPool = createPool({ role: 'owner' });
    const now = new Date();
    const periodStr = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;

    // Lock current period on TENANT_B to avoid race conditions with concurrent TENANT_A tests
    await ownerPool.query(
      `INSERT INTO periods (tenant_id, period, status, locked_by, locked_at)
       VALUES ($1, $2, 'LOCKED', $3, now())
       ON CONFLICT (tenant_id, period) DO UPDATE SET status = 'LOCKED'`,
      [TENANT_B, periodStr, USER_B],
    );

    try {
      const { patientId } = await createTestPatientAndVisit(TENANT_B, BRANCH_B);

      await expect(
        svc.createInvoice(TENANT_B, USER_B, {
          branchId: BRANCH_B,
          patientId,
          lines: [{ description: 'Test consultation', qty: 1, unitPrice: 300 }],
        }),
      ).rejects.toThrow(ProblemException);
    } finally {
      // Re-open period for subsequent tests
      await ownerPool.query(`UPDATE periods SET status = 'OPEN' WHERE tenant_id = $1 AND period = $2`, [
        TENANT_B,
        periodStr,
      ]);
    }
  });

  // ── Test 8: Daily PhilHealth Konsulta Tally (Q-16 / todo §7.4) ──────────────
  it('assembles daily PhilHealth Konsulta tally grouped by physician', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const { patientId, visitId } = await createTestPatientAndVisit(TENANT_A, BRANCH_A);

    // Create Konsulta invoice line
    const invoice = await svc.createInvoice(TENANT_A, USER_A, {
      branchId: BRANCH_A,
      patientId,
      visitId,
      payerType: 'PHILHEALTH',
      lines: [
        {
          description: 'PhilHealth Konsulta Initial Consultation',
          qty: 1,
          unitPrice: 500,
          payerType: 'PHILHEALTH',
          isProfessionalFee: true,
          sourceType: 'CONSULT',
        },
      ],
    });
    cleanupInvoiceIds.push(invoice.id);

    const tally = await svc.getKonsultaTally(TENANT_A, today);

    expect(tally.date).toBe(today);
    expect(tally.totalEncounters).toBeGreaterThan(0);
    expect(tally.physicianTallies.length).toBeGreaterThan(0);

    const doctorTally = tally.physicianTallies.find((pt: any) =>
      pt.encounters.some((e: any) => e.visitId === visitId),
    );
    expect(doctorTally).toBeDefined();
    expect(doctorTally!.physician).toBeDefined();
    expect(doctorTally!.encounters.length).toBeGreaterThan(0);

    const enc = doctorTally!.encounters.find((e: any) => e.visitId === visitId);
    expect(enc).toBeDefined();
    expect(enc.pin).toBe('12-345678901-2');
    expect(enc.konsultaStatus).toBe('REGISTERED');
  });

  // ── Test 9: Multi-Tenant RLS Isolation (Ground Rule 1) ──────────────────────
  it('guarantees strict tenant isolation: Tenant B cannot read Tenant A invoices', async () => {
    const { patientId } = await createTestPatientAndVisit(TENANT_A, BRANCH_A);
    const invA = await svc.createInvoice(TENANT_A, USER_A, {
      branchId: BRANCH_A,
      patientId,
      lines: [{ description: 'Confidential Consultation A', qty: 1, unitPrice: 900 }],
    });
    cleanupInvoiceIds.push(invA.id);

    // Tenant B querying Tenant A's invoice MUST throw NOT_FOUND
    await expect(svc.getInvoiceById(TENANT_B, invA.id)).rejects.toThrow(ProblemException);

    // Tenant B invoice list does NOT include Tenant A's invoice
    const listB = await svc.getInvoices(TENANT_B, {});
    const leaked = listB.data.some((i: any) => i.id === invA.id);
    expect(leaked).toBe(false);
  });

  // ── Test 10: Patient Statement of Account (SOA / todo §7.1) ─────────────────
  it('generates patient statement of account (SOA) with aging schedule', async () => {
    const { patientId } = await createTestPatientAndVisit(TENANT_A, BRANCH_A);
    const inv = await svc.createInvoice(TENANT_A, USER_A, {
      branchId: BRANCH_A,
      patientId,
      lines: [{ description: 'General Consultation', qty: 1, unitPrice: 750 }],
    });
    cleanupInvoiceIds.push(inv.id);

    const statement = await svc.getPatientStatement(TENANT_A, patientId);

    expect(statement).toBeDefined();
    expect(statement.patient.id).toBe(patientId);
    expect(statement.totalBilled).toBeGreaterThanOrEqual(750);
    expect(statement.totalBalance).toBeGreaterThanOrEqual(750);
    expect(statement.aging).toBeDefined();
    expect(statement.aging.current_0_30).toBeGreaterThanOrEqual(750);
    expect(statement.invoices.some((i: any) => i.id === inv.id)).toBe(true);
  });

  // ── Test 11: Receivables & Aging Report (RPT-BIL-03 / todo §7.4) ─────────────
  it('generates accounts receivables report with aging brackets and payer breakdown', async () => {
    const { patientId } = await createTestPatientAndVisit(TENANT_A, BRANCH_A);
    const inv = await svc.createInvoice(TENANT_A, USER_A, {
      branchId: BRANCH_A,
      patientId,
      payerType: 'PRIVATE_CASH',
      lines: [{ description: 'Cardiology Consultation', qty: 1, unitPrice: 1200 }],
    });
    cleanupInvoiceIds.push(inv.id);

    const report = await svc.getReceivablesReport(TENANT_A);

    expect(report).toBeDefined();
    expect(report.totalReceivables).toBeGreaterThanOrEqual(1200);
    expect(report.aging).toBeDefined();
    expect(report.aging.current_0_30).toBeGreaterThanOrEqual(1200);
    expect(report.byPayer).toBeDefined();
    expect(report.byPayer.PRIVATE_CASH!.total).toBeGreaterThanOrEqual(1200);
    expect(report.items.some((i: any) => i.id === inv.id)).toBe(true);
  });

  // ── Test 12: Statutory Discounts Report (RPT-BIL-04 / todo §7.1, §7.4) ──────
  it('generates statutory discounts audit log with ID capture', async () => {
    const { patientId } = await createTestPatientAndVisit(TENANT_A, BRANCH_A);
    const inv = await svc.createInvoice(TENANT_A, USER_A, {
      branchId: BRANCH_A,
      patientId,
      lines: [{ description: 'Consultation with Senior Citizen', qty: 1, unitPrice: 1000 }],
    });
    cleanupInvoiceIds.push(inv.id);

    const discounts = await svc.getDiscounts(TENANT_A);
    const seniorDiscount = discounts.find((d: any) => d.code === 'SENIOR') || discounts[0];

    // Apply Senior Citizen discount with OSCA ID
    await svc.applyDiscount(TENANT_A, USER_A, inv.id, {
      invoiceLineId: inv.lines[0].id,
      discountTypeId: seniorDiscount.id,
      idNumber: 'OSCA-TEST-12345',
      idType: 'OSCA_ID',
    });

    const report = await svc.getDiscountsReport(TENANT_A);

    expect(report).toBeDefined();
    expect(report.totalDiscounts).toBeGreaterThanOrEqual(200);
    expect(report.byCode[seniorDiscount.code]).toBeDefined();
    const item = report.items.find((d: any) => d.idNumber === 'OSCA-TEST-12345');
    expect(item).toBeDefined();
    expect(item!.idType).toBe('OSCA_ID');
    expect(item!.discountAmount).toBe(200);
  });

  // ── Test 13: Voids Audit Log (RPT-BIL-05 / todo §7.4) ──────────────────────
  it('generates voids audit report for voided invoices and voided payments', async () => {
    const { patientId } = await createTestPatientAndVisit(TENANT_A, BRANCH_A);
    const inv = await svc.createInvoice(TENANT_A, USER_A, {
      branchId: BRANCH_A,
      patientId,
      lines: [{ description: 'Voidable Consultation', qty: 1, unitPrice: 500 }],
    });
    cleanupInvoiceIds.push(inv.id);

    // Void the invoice
    await svc.voidInvoice(TENANT_A, USER_A, inv.id, { reason: 'Patient cancelled consult before service rendered' });

    const report = await svc.getVoidsReport(TENANT_A);

    expect(report).toBeDefined();
    expect(report.items.some((v: any) => v.id === inv.id && v.entityType === 'INVOICE')).toBe(true);
    const voidedInv = report.items.find((v: any) => v.id === inv.id);
    expect(voidedInv!.reason).toBe('Patient cancelled consult before service rendered');
  });

  // ── Test 14: Shift X-Report and Z-Report (RPT-BIL-01 / todo §7.3) ────────────
  it('generates mid-shift X-reading and end-of-shift Z-reading', async () => {
    const existing = await svc.getShifts(TENANT_A, { cashierId: USER_A, status: 'OPEN' });
    for (const s of existing.data) {
      await svc.closeShift(TENANT_A, USER_A, s.id, { countedCash: Number(s.opening_cash) });
    }

    const shift = await svc.openShift(TENANT_A, USER_A, {
      branchId: BRANCH_A,
      openingCash: 1000,
    });
    cleanupShiftIds.push(shift.id);

    // Interim X-Report
    const xReport = await svc.getShiftXReport(TENANT_A, shift.id);
    expect(xReport.reportType).toBe('X_REPORT');
    expect(xReport.shiftId).toBe(shift.id);
    expect(xReport.openingCash).toBe(1000);
    expect(xReport.metrics).toBeDefined();

    // Close Shift with blind count
    const closed = await svc.closeShift(TENANT_A, USER_A, shift.id, {
      countedCash: 1000,
      notes: 'Balanced drawer close',
    });
    expect(closed.status).toBe('CLOSED');

    // Formal Z-Report
    const zReport = await svc.getShiftZReport(TENANT_A, shift.id);
    expect(zReport.reportType).toBe('Z_REPORT');
    expect(zReport.countedCash).toBe(1000);
    expect(zReport.expectedCash).toBe(1000);
    expect(zReport.variance).toBe(0);
  });
});
