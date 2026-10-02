/**
 * JOB-50 billing.receipt.generate (todo.md 7.1/7.2, specification 11, 14).
 *
 * The handler previously emitted a JSON `billing.receipt.rendered` outbox event
 * and stored nothing. It also read through the raw app pool, so under the forced
 * RLS policies it selected zero rows and the job was a silent no-op in
 * production. These tests pin the behaviour the ticks in todo.md claim:
 * a receipt PDF and its thermal twin are rendered, stored as exact bytes, and
 * their SHA-256 is the digest of those bytes, so a download re-verifies.
 *
 * Runs against Demo Clinic B, which the API billing suite does not touch; Demo
 * Clinic A ("other tenant") holds seeded billing rows, so the isolation
 * assertions are not vacuous.
 */
import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { probeDb } from '@clinic/db/tests/helpers.js';
import { createPool, withTenantOnPool, type Pool } from '@clinic/db';
import { sha256Of, verifyDocument } from '@clinic/print';
import {
  runBillingReceiptGenerate,
  runBillingOverdueFlag,
} from '../src/handlers/billing-jobs.handler.js';

const hasDb = await probeDb();

const TENANT = '22222222-2222-4222-8222-222222222222';
const OTHER_TENANT = '11111111-1111-4111-8111-111111111111';
const BRANCH = 'b1000000-0000-4000-8000-000000000001';
const USER = 'b3000000-0000-4000-8000-000000000002';

const createdPatients: string[] = [];
const createdInvoices: string[] = [];
const createdPayments: string[] = [];
const patients = new Map<string, string>();

async function owner() {
  return createPool({ role: 'owner' });
}

async function patientFor(tenantId: string): Promise<string> {
  const cached = patients.get(tenantId);
  if (cached) return cached;
  const pool = await owner();
  try {
    const res = await pool.query<{ id: string }>(
      `INSERT INTO patients (tenant_id, first_name, last_name, date_of_birth, gender)
       VALUES ($1, 'Job50', 'Fixture', '1988-08-08', 'MALE')
       RETURNING id`,
      [tenantId],
    );
    const id = res.rows[0]!.id;
    createdPatients.push(id);
    patients.set(tenantId, id);
    return id;
  } finally {
    await pool.end();
  }
}

async function methodFor(tenantId: string): Promise<string> {
  const pool = await owner();
  try {
    const found = await pool.query<{ id: string }>(
      `SELECT id FROM payment_methods WHERE tenant_id = $1 AND is_active ORDER BY id LIMIT 1`,
      [tenantId],
    );
    if (found.rows[0]) return found.rows[0].id;
    const ins = await pool.query<{ id: string }>(
      `INSERT INTO payment_methods (tenant_id, code, name, is_active)
       VALUES ($1, 'CASH50', 'Cash', true) RETURNING id`,
      [tenantId],
    );
    return ins.rows[0]!.id;
  } finally {
    await pool.end();
  }
}

/** Branch must belong to the tenant: invoices and payments carry a composite tenant FK. */
async function branchFor(tenantId: string): Promise<string> {
  const pool = await owner();
  try {
    const res = await pool.query<{ id: string }>(
      `SELECT id FROM branches WHERE tenant_id = $1 ORDER BY (status = 'ACTIVE') DESC, name LIMIT 1`,
      [tenantId],
    );
    if (!res.rows[0]) throw new Error(`no branch for tenant ${tenantId}`);
    return res.rows[0].id;
  } finally {
    await pool.end();
  }
}

/** payments.received_by must be a user of the same tenant. */
async function userFor(tenantId: string): Promise<string> {
  const pool = await owner();
  try {
    const res = await pool.query<{ id: string }>(
      `SELECT id FROM users WHERE tenant_id = $1 ORDER BY (status = 'ACTIVE') DESC, created_at LIMIT 1`,
      [tenantId],
    );
    if (!res.rows[0]) throw new Error(`no user for tenant ${tenantId}`);
    return res.rows[0].id;
  } finally {
    await pool.end();
  }
}

/** Internal economics that must never reach a patient-facing document (Q-17). */
const SECRET = 'PF-RATE-ONLY-7.5pct';

async function seedPayment(tenantId = TENANT): Promise<string> {
  const patientId = await patientFor(tenantId);
  const methodId = await methodFor(tenantId);
  const branchId = await branchFor(tenantId);
  const userId = await userFor(tenantId);
  const pool = createPool({ role: 'app' });
  try {
    return await withTenantOnPool(pool, { tenantId, userId: USER }, async (tx) => {
      const invoice = await tx.query<{ id: string }>(
        `INSERT INTO invoices (tenant_id, branch_id, invoice_no, patient_id, created_by, status,
                               subtotal, discount_total, tax_total, total, balance, issued_at, notes)
         VALUES ($1, $2, $3, $4, $5, 'PARTIAL', 2500.00, 0, 0, 2500.00, 2500.00, now(), $6)
         RETURNING id`,
        [tenantId, branchId, `INV-JOB50-${crypto.randomUUID().slice(0, 8)}`, patientId, userId, SECRET],
      );
      const invoiceId = invoice.rows[0]!.id;
      createdInvoices.push(invoiceId);

      await tx.query(
        `INSERT INTO invoice_lines (tenant_id, invoice_id, line_no, source_type, description,
                                    qty, unit_price, subtotal, net_amount, is_professional_fee)
         VALUES ($1, $2, 1, 'CONSULT', 'Professional fee - consultation', 1, 1500.00, 1500.00, 1500.00, true),
                ($1, $2, 2, 'SERVICE', 'Deductible medicine', 1, 1000.00, 1000.00, 1000.00, false)`,
        [tenantId, invoiceId],
      );

      const pay = await tx.query<{ id: string }>(
        `INSERT INTO payments (tenant_id, branch_id, payment_no, patient_id, invoice_id, method_id,
                               amount, tendered_amount, change_amount, payer_type, received_by, received_at, status)
         VALUES ($1, $2, $3, $4, $5, $6, 2500.00, 3000.00, 500.00, 'PRIVATE_CASH', $7, now(), 'POSTED')
         RETURNING id`,
        [tenantId, branchId, `PAY-JOB50-${crypto.randomUUID().slice(0, 8)}`, patientId, invoiceId, methodId, userId],
      );
      const id = pay.rows[0]!.id;
      createdPayments.push(id);
      return id;
    });
  } finally {
    await pool.end();
  }
}

type ReceiptRow = {
  receipt_file_id: string | null;
  receipt_sha256: string | null;
  receipt_thermal_file_id: string | null;
  receipt_thermal_sha256: string | null;
};

async function receiptLink(tenantId: string, paymentId: string): Promise<ReceiptRow> {
  const pool = await owner();
  try {
    const res = await pool.query<ReceiptRow>(
      `SELECT receipt_file_id, receipt_sha256, receipt_thermal_file_id, receipt_thermal_sha256
       FROM payments WHERE tenant_id = $1 AND id = $2`,
      [tenantId, paymentId],
    );
    return res.rows[0]!;
  } finally {
    await pool.end();
  }
}

async function fileBytes(tenantId: string, fileId: string): Promise<Buffer> {
  const pool = await owner();
  try {
    const res = await pool.query<{ content: Buffer; sha256: string; origin: string; status: string }>(
      `SELECT content, sha256, origin, status FROM files WHERE tenant_id = $1 AND id = $2`,
      [tenantId, fileId],
    );
    const row = res.rows[0]!;
    expect(row.origin).toBe('GENERATED');
    expect(row.status).toBe('READY');
    return row.content;
  } finally {
    await pool.end();
  }
}

describe.skipIf(!hasDb)('JOB-50 billing.receipt.generate', () => {
  let paymentId: string;

  beforeAll(async () => {
    paymentId = await seedPayment();
  });

  afterAll(async () => {
    const pool = await owner();
    try {
      await pool.query(
        `DELETE FROM outbox WHERE tenant_id = ANY($1::uuid[]) AND event_type LIKE 'billing.%'`,
        [[TENANT, OTHER_TENANT]],
      );
      await pool.query(`DELETE FROM payment_reprints WHERE tenant_id = ANY($1::uuid[])`, [
        [TENANT, OTHER_TENANT],
      ]);
      // Clear every pointer for these tenants, not just this run's ids: an
      // aborted earlier run can leave receipts behind, and files is RESTRICT.
      await pool.query(
        `UPDATE payments
         SET receipt_file_id = NULL, receipt_sha256 = NULL,
             receipt_thermal_file_id = NULL, receipt_thermal_sha256 = NULL,
             receipt_generated_at = NULL
         WHERE tenant_id = ANY($1::uuid[])
           AND (receipt_file_id IS NOT NULL OR receipt_thermal_file_id IS NOT NULL)`,
        [[TENANT, OTHER_TENANT]],
      );
      await pool.query(
        `DELETE FROM files
         WHERE tenant_id = ANY($1::uuid[])
           AND object_key LIKE 't/%/receipt/%'`,
        [[TENANT, OTHER_TENANT]],
      );
      // payments reference invoices, so they must go first.
      await pool.query(`DELETE FROM payments WHERE id = ANY($1::uuid[])`, [createdPayments]);
      await pool.query(`DELETE FROM invoice_lines WHERE tenant_id = ANY($1::uuid[]) AND invoice_id = ANY($2::uuid[])`,
        [[TENANT, OTHER_TENANT], createdInvoices]);
      await pool.query(`DELETE FROM invoices WHERE id = ANY($1::uuid[])`, [createdInvoices]);
      await pool.query(`DELETE FROM patients WHERE id = ANY($1::uuid[])`, [createdPatients]);
      // The cached ids now point at deleted rows; the JOB-49 suite must build
      // its own fixtures rather than reuse them.
      patients.clear();
      createdPatients.length = 0;
      createdInvoices.length = 0;
      createdPayments.length = 0;
    } finally {
      await pool.end();
    }
  });

  it('renders a receipt PDF whose digest is the hash of the stored bytes', async () => {
    const result = await runBillingReceiptGenerate();
    expect(result.renderedCount).toBeGreaterThanOrEqual(1);

    const link = await receiptLink(TENANT, paymentId);
    expect(link.receipt_file_id).toBeTruthy();
    expect(link.receipt_sha256).toMatch(/^[0-9a-f]{64}$/);

    const bytes = await fileBytes(TENANT, link.receipt_file_id!);
    expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
    expect(await sha256Of(bytes)).toBe(link.receipt_sha256);
    expect((await verifyDocument(bytes, link.receipt_sha256!)).valid).toBe(true);
  });

  it('renders the thermal twin and digests it independently', async () => {
    await runBillingReceiptGenerate();
    const link = await receiptLink(TENANT, paymentId);

    expect(link.receipt_thermal_file_id).toBeTruthy();
    expect(link.receipt_thermal_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(link.receipt_thermal_sha256).not.toBe(link.receipt_sha256);

    const thermal = await fileBytes(TENANT, link.receipt_thermal_file_id!);
    expect(thermal.length).toBeGreaterThan(0);
    // ESC/POS opens with GS v 0 (cut) or the ESC init sequence.
    expect(thermal[0]).toBe(0x1b);
    expect(await sha256Of(thermal)).toBe(link.receipt_thermal_sha256);
  });

  it('is idempotent: a second tick reuses the stored documents', async () => {
    await runBillingReceiptGenerate();
    const first = await receiptLink(TENANT, paymentId);

    const second = await runBillingReceiptGenerate();
    expect(second.renderedCount).toBe(0);

    const after = await receiptLink(TENANT, paymentId);
    expect(after.receipt_file_id).toBe(first.receipt_file_id);
    expect(after.receipt_sha256).toBe(first.receipt_sha256);
  });

  it('emits billing.receipt.rendered carrying the file and digest', async () => {
    await runBillingReceiptGenerate();
    const pool = await owner();
    try {
      const res = await pool.query<{ payload: Record<string, unknown> }>(
        `SELECT payload FROM outbox
         WHERE tenant_id = $1 AND event_type = 'billing.receipt.rendered'
           AND payload->>'paymentId' = $2`,
        [TENANT, paymentId],
      );
      expect(res.rows.length).toBeGreaterThanOrEqual(1);
      const payload = res.rows[0]!.payload;
      expect(payload.fileId).toBeTruthy();
      expect(payload.sha256).toMatch(/^[0-9a-f]{64}$/);
    } finally {
      await pool.end();
    }
  });

  it('never leaks internal practitioner economics into the receipt (Q-17)', async () => {
    await runBillingReceiptGenerate();
    const link = await receiptLink(TENANT, paymentId);
    const bytes = await fileBytes(TENANT, link.receipt_file_id!);

    // The internal note lives on an invoice line; it must not reach the document.
    expect(bytes.toString('latin1')).not.toContain(SECRET);
  });

  it('does not render another tenant\'s payments', async () => {
    const otherPayment = await seedPayment(OTHER_TENANT);
    await runBillingReceiptGenerate();

    const link = await receiptLink(OTHER_TENANT, otherPayment);
    // Fan-out must actually reach the second tenant...
    expect(link.receipt_file_id).toBeTruthy();

    const pool = await owner();
    try {
      // ...and the artifact must be owned by that tenant, never by the tenant
      // whose payment was being processed when the scan started.
      const owned = await pool.query(`SELECT tenant_id FROM files WHERE id = $1`, [
        link.receipt_file_id!,
      ]);
      expect(owned.rows[0]!.tenant_id).toBe(OTHER_TENANT);

      const leaked = await pool.query(
        `SELECT count(*)::int AS n FROM files
         WHERE tenant_id = $1 AND object_key LIKE '%' || $2`,
        [TENANT, otherPayment],
      );
      expect(leaked.rows[0]!.n).toBe(0);
    } finally {
      await pool.end();
    }
  });
});

describe.skipIf(!hasDb)('JOB-49 billing.overdue.flag', () => {
  // JOB-49 runs daily at 01:00 UTC. The outbox carries no natural uniqueness,
  // so without an explicit dedup key the job re-inserted one
  // billing.invoice.overdue per past-due invoice per run, forever, each with a
  // balance payload staler than the last.
  const seedOverdueInvoice = async (pool: Pool) => {
    const patientId = await patientFor(TENANT);
    const inv = await pool.query<{ id: string }>(
      `INSERT INTO invoices (tenant_id, branch_id, invoice_no, patient_id, created_by, status,
                             subtotal, discount_total, tax_total, total, balance, due_at, issued_at)
       VALUES ($1, $2, $3, $4, $5, 'OPEN', 1000.00, 0, 0, 1000.00, 1000.00, now() - INTERVAL '3 days', now())
       RETURNING id`,
      [TENANT, BRANCH, `INV-JOB49-${crypto.randomUUID().slice(0, 8)}`, patientId, USER],
    );
    const id = inv.rows[0]!.id;
    createdInvoices.push(id);
    return id;
  };

  const overdueEvents = (pool: Pool, invoiceId: string) =>
    pool.query<{ n: number; aggregate_type: string; dedup_key: string | null }>(
      `SELECT count(*)::int AS n, min(aggregate_type) AS aggregate_type, min(dedup_key) AS dedup_key
       FROM outbox
       WHERE tenant_id = $1 AND event_type = 'billing.invoice.overdue'
         AND dedup_key = $2`,
      [TENANT, `invoice:${invoiceId}`],
    );

  it('emits exactly one overdue event, keyed to the invoice', async () => {
    const pool = await owner();
    let invoiceId: string | undefined;
    try {
      invoiceId = await seedOverdueInvoice(pool);

      const result = await runBillingOverdueFlag();
      expect(result.overdueCount).toBeGreaterThanOrEqual(1);

      const ev = await overdueEvents(pool, invoiceId);
      expect(ev.rows[0]!.n).toBe(1);
      expect(ev.rows[0]!.aggregate_type).toBe('invoice');
      expect(ev.rows[0]!.dedup_key).toBe(`invoice:${invoiceId}`);
    } finally {
      await cleanupOverdue(pool, invoiceId);
      await pool.end();
    }
  });

  it('does not re-emit for the same invoice on the next daily run', async () => {
    const pool = await owner();
    let invoiceId: string | undefined;
    try {
      invoiceId = await seedOverdueInvoice(pool);

      await runBillingOverdueFlag();
      expect((await overdueEvents(pool, invoiceId)).rows[0]!.n).toBe(1);

      // Still past due, so the second run must see it and decline to duplicate.
      const second = await runBillingOverdueFlag();
      expect(second.overdueCount).toBeGreaterThanOrEqual(0);
      expect((await overdueEvents(pool, invoiceId)).rows[0]!.n).toBe(1);
    } finally {
      await cleanupOverdue(pool, invoiceId);
      await pool.end();
    }
  });

  const cleanupOverdue = async (pool: Pool, invoiceId: string | undefined) => {
    if (!invoiceId) return;
    await pool.query(`DELETE FROM outbox WHERE tenant_id = $1 AND dedup_key = $2`, [
      TENANT,
      `invoice:${invoiceId}`,
    ]);
    await pool.query(`DELETE FROM invoices WHERE id = $1`, [invoiceId]);
    const idx = createdInvoices.indexOf(invoiceId);
    if (idx >= 0) createdInvoices.splice(idx, 1);
  };
});

// ── JOB-48 billing.daily.close ─────────────────────────────────────────────────
// The previous implementation queried through raw getAppPool(). Under forced RLS
// that returns zero rows, so the job wrote nothing. The fixed version fans out per
// active tenant via withTenant(), matching JOB-49/50 (todo.md §450 audit note).

import { runBillingDailyClose } from '../src/handlers/billing-jobs.handler.js';

describe.skipIf(!hasDb)('JOB-48 billing.daily.close', () => {
  it('writes daily_cashier_summaries for each active branch under forced RLS', async () => {
    const pool = await owner();
    const dateStr = new Date().toISOString().slice(0, 10);

    // Remove any row from a previous run so the assertion is non-trivial.
    await pool.query(
      `DELETE FROM daily_cashier_summaries WHERE tenant_id = $1 AND close_date = $2`,
      [TENANT, dateStr],
    );

    try {
      const result = await runBillingDailyClose(dateStr);

      // The job must have processed at least one summary for the demo tenants.
      expect(result.summariesCreated).toBeGreaterThanOrEqual(1);

      // Confirm a row was actually written for Tenant B's branch.
      const row = await pool.query<{ total_collected: string; close_date: string }>(
        `SELECT total_collected, close_date::text FROM daily_cashier_summaries
         WHERE tenant_id = $1 AND close_date = $2
         LIMIT 1`,
        [TENANT, dateStr],
      );
      // Without the withTenant() fix, rows would be 0 (silent no-op).
      expect(row.rows).toHaveLength(1);
      expect(row.rows[0]!.close_date).toBe(dateStr);
    } finally {
      await pool.query(
        `DELETE FROM daily_cashier_summaries WHERE tenant_id = $1 AND close_date = $2`,
        [TENANT, dateStr],
      );
      await pool.end();
    }
  });

  it('flags open cashier shifts in the outbox at daily close', async () => {
    const pool = await owner();
    const dateStr = new Date().toISOString().slice(0, 10);

    // Seed an open shift for Tenant B.
    const shiftRes = await pool.query<{ id: string }>(
      `INSERT INTO cashier_shifts (tenant_id, branch_id, shift_no, cashier_id, opening_cash, status)
       VALUES ($1, $2, $3, $4, 0, 'OPEN') RETURNING id`,
      [TENANT, BRANCH, `SH-TEST-${Date.now()}`, USER],
    );
    const shiftId = shiftRes.rows[0]!.id;

    try {
      // Clear any prior unclosed-shift events for this date.
      await pool.query(
        `DELETE FROM outbox WHERE tenant_id = $1 AND event_type = 'billing.shift.unclosed_at_daily_close'`,
        [TENANT],
      );

      const result = await runBillingDailyClose(dateStr);
      expect(result.openShiftsFlagged).toBeGreaterThanOrEqual(1);

      // An outbox event must exist; without the fix, nothing was written.
      const ev = await pool.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM outbox
         WHERE tenant_id = $1 AND event_type = 'billing.shift.unclosed_at_daily_close'`,
        [TENANT],
      );
      expect(ev.rows[0]!.n).toBeGreaterThanOrEqual(1);
    } finally {
      await pool.query(`DELETE FROM cashier_shifts WHERE id = $1`, [shiftId]);
      await pool.query(
        `DELETE FROM outbox WHERE tenant_id = $1 AND event_type = 'billing.shift.unclosed_at_daily_close'`,
        [TENANT],
      );
      await pool.query(
        `DELETE FROM daily_cashier_summaries WHERE tenant_id = $1 AND close_date = $2`,
        [TENANT, dateStr],
      );
      await pool.end();
    }
  });
});
