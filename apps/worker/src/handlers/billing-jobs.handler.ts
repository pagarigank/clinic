import { getAppPool } from '@clinic/db/src/pool.js'; // only used by activeTenantIds
import { withTenant } from '@clinic/db';
import {
  renderPdf,
  renderReceiptHtml,
  renderThermalReceipt,
  sha256Of,
  buildReceiptDocument,
  toThermalReceipt,
  type ReceiptFacts,
} from '@clinic/print';

/**
 * Billing background jobs — todo.md §7, specification.md §11, §14.
 *
 * JOB-48 billing.daily.close   — nightly 23:59 collections summary & shift check
 * JOB-49 billing.overdue.flag  — daily sweep of past-due invoices & reminders
 * JOB-50 billing.receipt.generate — render / format PDF & thermal official receipts
 */

/**
 * JOB-48: billing.daily.close
 * Summarizes collections, flags open shifts, and records daily cashier summary.
 *
 * The previous version queried through raw getAppPool(). Under the forced RLS
 * policies that returned zero rows for every tenant, so the job silently did
 * nothing in production. This version fans out per active tenant via
 * withTenant() — the same pattern as JOB-49 and JOB-50 (todo.md §450).
 */
export async function runBillingDailyClose(targetDateStr?: string): Promise<{
  summariesCreated: number;
  openShiftsFlagged: number;
}> {
  const dateStr = targetDateStr ?? new Date().toISOString().slice(0, 10);
  let summariesCreated = 0;
  let openShiftsFlagged = 0;

  for (const tenantId of await activeTenantIds()) {
    // Fetch active branches for this tenant inside withTenant so RLS applies.
    const branches = await withTenant({ tenantId }, async (tx) => {
      const res = await tx.query(
        `SELECT b.id AS branch_id
         FROM branches b
         WHERE b.tenant_id = $1 AND b.status = 'ACTIVE'`,
        [tenantId],
      );
      return res.rows as Array<{ branch_id: string }>;
    });

    for (const { branch_id: branchId } of branches) {
      try {
        const summary = await withTenant({ tenantId }, async (tx) => {
          // Open shifts on this branch
          const openShiftsRes = await tx.query(
            `SELECT count(*)::int as open_count
             FROM cashier_shifts
             WHERE tenant_id = $1 AND branch_id = $2 AND status = 'OPEN'`,
            [tenantId, branchId],
          );
          const openShiftsCount = openShiftsRes.rows[0]?.open_count ?? 0;

          if (openShiftsCount > 0) {
            await tx.query(
              `INSERT INTO outbox (tenant_id, event_type, payload)
               VALUES ($1, 'billing.shift.unclosed_at_daily_close', $2)
               ON CONFLICT DO NOTHING`,
              [tenantId, JSON.stringify({ branchId, closeDate: dateStr, openShiftsCount })],
            );
          }

          // Invoiced total for date
          const invRes = await tx.query(
            `SELECT COALESCE(SUM(total), 0) as total_invoiced,
                    COALESCE(SUM(discount_total), 0) as total_discounts
             FROM invoices
             WHERE tenant_id = $1 AND branch_id = $2
               AND status != 'VOID'
               AND DATE(created_at AT TIME ZONE 'Asia/Manila') = $3::date`,
            [tenantId, branchId, dateStr],
          );
          const totalInvoiced = Number(invRes.rows[0]?.total_invoiced ?? 0);
          const totalDiscounts = Number(invRes.rows[0]?.total_discounts ?? 0);

          // Payments collected on date by method & payer
          const payRes = await tx.query(
            `SELECT
               COALESCE(SUM(p.amount), 0) as total_collected,
               COALESCE(SUM(CASE WHEN pm.code = 'CASH' THEN p.amount ELSE 0 END), 0) as total_cash,
               COALESCE(SUM(CASE WHEN pm.code = 'CARD' THEN p.amount ELSE 0 END), 0) as total_card,
               COALESCE(SUM(CASE WHEN pm.code IN ('GCASH', 'MAYA', 'ONLINE', 'BANK_TRANSFER') THEN p.amount ELSE 0 END), 0) as total_online,
               COALESCE(SUM(CASE WHEN p.payer_type = 'HMO' THEN p.amount ELSE 0 END), 0) as total_hmo,
               COALESCE(SUM(CASE WHEN p.payer_type = 'PHILHEALTH' THEN p.amount ELSE 0 END), 0) as total_philhealth,
               COALESCE(SUM(CASE WHEN p.payer_type = 'CORPORATE' THEN p.amount ELSE 0 END), 0) as total_corporate
             FROM payments p
             JOIN payment_methods pm ON pm.tenant_id = p.tenant_id AND pm.id = p.method_id
             WHERE p.tenant_id = $1 AND p.branch_id = $2
               AND p.status = 'POSTED'
               AND DATE(p.received_at AT TIME ZONE 'Asia/Manila') = $3::date`,
            [tenantId, branchId, dateStr],
          );
          const row = payRes.rows[0] ?? {};
          const totalCollected = Number(row.total_collected ?? 0);
          const totalCash = Number(row.total_cash ?? 0);
          const totalCard = Number(row.total_card ?? 0);
          const totalOnline = Number(row.total_online ?? 0);
          const totalHmo = Number(row.total_hmo ?? 0);
          const totalPhilhealth = Number(row.total_philhealth ?? 0);
          const totalCorporate = Number(row.total_corporate ?? 0);

          // Credit notes approved on date
          const cnRes = await tx.query(
            `SELECT COALESCE(SUM(amount), 0) as total_cn
             FROM credit_notes
             WHERE tenant_id = $1 AND branch_id = $2
               AND status = 'APPROVED'
               AND DATE(approved_at AT TIME ZONE 'Asia/Manila') = $3::date`,
            [tenantId, branchId, dateStr],
          );
          const totalCreditNotes = Number(cnRes.rows[0]?.total_cn ?? 0);

          await tx.query(
            `INSERT INTO daily_cashier_summaries (
               tenant_id, branch_id, close_date,
               total_invoiced, total_collected, total_cash, total_card, total_online,
               total_hmo, total_philhealth, total_corporate, total_discounts, total_credit_notes,
               open_shifts_count, is_locked
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, true)
             ON CONFLICT (tenant_id, branch_id, close_date)
             DO UPDATE SET
               total_invoiced = EXCLUDED.total_invoiced,
               total_collected = EXCLUDED.total_collected,
               total_cash = EXCLUDED.total_cash,
               total_card = EXCLUDED.total_card,
               total_online = EXCLUDED.total_online,
               total_hmo = EXCLUDED.total_hmo,
               total_philhealth = EXCLUDED.total_philhealth,
               total_corporate = EXCLUDED.total_corporate,
               total_discounts = EXCLUDED.total_discounts,
               total_credit_notes = EXCLUDED.total_credit_notes,
               open_shifts_count = EXCLUDED.open_shifts_count,
               closed_at = now()`,
            [
              tenantId,
              branchId,
              dateStr,
              totalInvoiced,
              totalCollected,
              totalCash,
              totalCard,
              totalOnline,
              totalHmo,
              totalPhilhealth,
              totalCorporate,
              totalDiscounts,
              totalCreditNotes,
              openShiftsCount,
            ],
          );

          return { openShiftsCount };
        });

        summariesCreated++;
        openShiftsFlagged += summary.openShiftsCount;
      } catch (error) {
        // One failed branch must not stop the rest.
        const message = error instanceof Error ? error.message : String(error);
        console.error(`JOB-48: failed to close branch ${branchId} for tenant ${tenantId}: ${message}`);
      }
    }
  }

  return { summariesCreated, openShiftsFlagged };
}

/**
 * JOB-49: billing.overdue.flag
 * Daily check for invoices exceeding due_at without full settlement.
 */
export async function runBillingOverdueFlag(): Promise<{ overdueCount: number }> {
  let overdueCount = 0;

  for (const tenantId of await activeTenantIds()) {
    // Tenant-scoped: the previous version read through the raw app pool, and
    // under the forced RLS policies that returned zero rows for every tenant,
    // so the job silently did nothing in production.
    const overdueInvoices = await withTenant({ tenantId }, async (tx) => {
      const res = await tx.query(
        `SELECT i.id, i.invoice_no, i.patient_id, i.balance, i.due_at
         FROM invoices i
         WHERE i.tenant_id = $1
           AND i.status IN ('OPEN', 'PARTIAL')
           AND i.due_at IS NOT NULL
           AND i.due_at < now()`,
        [tenantId],
      );
      return res.rows;
    });

    // Batched into one statement per tenant, and deduped on the invoice
    // itself. Without the dedup key this re-emitted a reminder every day for
    // every past-due invoice, each with a staler balance than the last.
    if (overdueInvoices.length > 0) {
      const values: string[] = [];
      const params: unknown[] = [tenantId];
      for (const inv of overdueInvoices) {
        // $1 is the tenant for every tuple; the next three slots are this row.
        const idParam = `$${params.length + 1}`;
        const payloadParam = `$${params.length + 2}`;
        const keyParam = `$${params.length + 3}`;
        values.push(
          `($1, 'invoice', ${idParam}::text, 'billing.invoice.overdue', ${payloadParam}::jsonb, ${keyParam})`,
        );
        params.push(
          inv.id,
          JSON.stringify({
            invoiceId: inv.id,
            invoiceNo: inv.invoice_no,
            patientId: inv.patient_id,
            balance: inv.balance,
            dueAt: inv.due_at,
          }),
          `invoice:${inv.id}`,
        );
      }

      const inserted = await withTenant({ tenantId }, async (tx) => {
        const res = await tx.query<{ id: string }>(
          `INSERT INTO outbox (tenant_id, aggregate_type, aggregate_id, event_type, payload, dedup_key)
           VALUES ${values.join(', ')}
           ON CONFLICT (tenant_id, event_type, dedup_key) WHERE dedup_key IS NOT NULL DO NOTHING
           RETURNING id`,
          params,
        );
        return res.rows.length;
      });
      overdueCount += inserted;
    }
  }

  return { overdueCount };
}

/**
 * JOB-50: billing.receipt.generate
 * Generates official receipt payloads (PDF / thermal metadata) with Q-17 professional fee separation.
 */
export async function runBillingReceiptGenerate(): Promise<{
  renderedCount: number;
  failedCount: number;
}> {
  let renderedCount = 0;
  let failedCount = 0;

  for (const tenantId of await activeTenantIds()) {
    // receipt_file_id IS NULL is the honest "not yet rendered" marker: a digest
    // cannot exist before the bytes it describes.
    const pending = await withTenant({ tenantId }, async (tx) => {
      const res = await tx.query(
        `SELECT p.id, p.payment_no, p.amount, p.tendered_amount, p.change_amount,
                p.payer_type, p.received_at, p.patient_id, p.invoice_id,
                pm.code AS method_code, pm.name AS method_name,
                u.id AS cashier_id, u.name AS cashier_name,
                i.invoice_no, i.total AS invoice_total, i.discount_total,
                t.name AS clinic_name,
                pt.first_name AS patient_first, pt.last_name AS patient_last
         FROM payments p
         JOIN payment_methods pm ON pm.tenant_id = p.tenant_id AND pm.id = p.method_id
         JOIN users u ON u.tenant_id = p.tenant_id AND u.id = p.received_by
         JOIN tenants t ON t.id = p.tenant_id
         LEFT JOIN invoices i ON i.tenant_id = p.tenant_id AND i.id = p.invoice_id
         LEFT JOIN patients pt ON pt.tenant_id = p.tenant_id AND pt.id = p.patient_id
         WHERE p.tenant_id = $1 AND p.status = 'POSTED' AND p.receipt_file_id IS NULL
         ORDER BY p.received_at
         LIMIT 100`,
        [tenantId],
      );
      return res.rows;
    });

    for (const payment of pending) {
      try {
        // Build and render outside the transaction: Chromium startup and page
        // layout are far too slow to hold a transaction and a pooled
        // connection open.
        const document = buildReceiptDocument(await loadReceiptFacts(tenantId, payment));
        const rendered = await renderPdf(renderReceiptHtml(document), { format: 'A4' });
        const thermal = renderThermalReceipt(toThermalReceipt(document));

        const objectKey = `t/${tenantId}/receipt/${payment.id}`;

        // One transaction per payment: both artifacts, the owning row, the
        // digests and the event commit together or not at all, so a payment can
        // never reference bytes whose hash was not recorded.
        const published = await withTenant({ tenantId }, async (tx) => {
          // Re-check under the write lock: two concurrent ticks must not both
          // issue a receipt for the same tender.
          const claim = await tx.query(
            `SELECT 1 FROM payments
             WHERE tenant_id = $1 AND id = $2 AND status = 'POSTED' AND receipt_file_id IS NULL
             FOR UPDATE`,
            [tenantId, payment.id],
          );
          if (claim.rowCount === 0) return null;

          const pdfFile = await tx.query<{ id: string }>(
            `INSERT INTO files (tenant_id, object_key, file_name, mime_type, size_bytes,
                                uploaded_by, origin, content, sha256, status)
             VALUES ($1, $2, $3, 'application/pdf', $4, $5, 'GENERATED', $6, $7, 'READY')
             RETURNING id`,
            [
              tenantId,
              objectKey,
              `receipt-${document.receiptNo}.pdf`,
              rendered.bytes.length,
              payment.cashier_id,
              rendered.bytes,
              rendered.sha256,
            ],
          );

          const thermalFile = await tx.query<{ id: string }>(
            `INSERT INTO files (tenant_id, object_key, file_name, mime_type, size_bytes,
                                uploaded_by, origin, content, sha256, status)
             VALUES ($1, $2, $3, 'application/escpos', $4, $5, 'GENERATED', $6, $7, 'READY')
             RETURNING id`,
            [
              tenantId,
              `${objectKey}-thermal`,
              `receipt-${document.receiptNo}.escpos`,
              thermal.length,
              payment.cashier_id,
              thermal,
              await sha256Of(thermal),
            ],
          );

          await tx.query(
            `UPDATE payments
             SET receipt_file_id = $3, receipt_sha256 = $4,
                 receipt_thermal_file_id = $5, receipt_thermal_sha256 = $6,
                 receipt_generated_at = now()
             WHERE tenant_id = $1 AND id = $2`,
            [tenantId, payment.id, pdfFile.rows[0]!.id, rendered.sha256, thermalFile.rows[0]!.id, await sha256Of(thermal)],
          );

          await tx.query(
            `INSERT INTO outbox (tenant_id, event_type, payload)
             VALUES ($1, 'billing.receipt.rendered', $2)`,
            [
              tenantId,
              JSON.stringify({
                paymentId: payment.id,
                paymentNo: document.receiptNo,
                invoiceNo: payment.invoice_no ?? null,
                cashierName: document.cashierName,
                receivedAt: document.issuedAt,
                amount: document.total,
                tenderedAmount: document.amountTendered,
                changeAmount: document.changeGiven,
                methodName: payment.method_name,
                fileId: pdfFile.rows[0]!.id,
                sha256: rendered.sha256,
                thermalFileId: thermalFile.rows[0]!.id,
                thermalSha256: await sha256Of(thermal),
              }),
            ],
          );

          return pdfFile.rows[0]!.id;
        });

        if (published) renderedCount++;
      } catch (error) {
        // One bad receipt must not stop the queue: the payment keeps a NULL
        // receipt pointer and is retried on the next tick.
        failedCount++;
        const message = error instanceof Error ? error.message : String(error);
        console.error(`JOB-50: failed to render receipt for payment ${payment.id}: ${message}`);
      }
    }
  }

  return { renderedCount, failedCount };
}

/** Active tenant IDs, for handlers that fan out across tenants. */
async function activeTenantIds(): Promise<string[]> {
  const pool = getAppPool();
  const res = await pool.query(`SELECT id FROM tenant_directory WHERE status = 'ACTIVE'`);
  return res.rows.map((r: { id: string }) => r.id);
}

type PaymentRow = {
  id: string;
  payment_no: string;
  amount: string;
  tendered_amount: string;
  change_amount: string;
  payer_type: string;
  received_at: string;
  invoice_id: string | null;
  invoice_no: string | null;
  invoice_total: string | null;
  discount_total: string | null;
  method_code: string;
  method_name: string;
  cashier_id: string;
  cashier_name: string;
  clinic_name: string;
  patient_first: string | null;
  patient_last: string | null;
};

/**
 * Retrieve the tenant's own receipt facts, then hand them to `@clinic/print`.
 *
 * Q-17: only patient-facing fields are read. Invoice-level `notes`, practitioner
 * revenue-share rates and PF percentages are never selected here, so they
 * cannot print - the facts object has no field that could carry them.
 *
 * The shaping itself lives in `@clinic/print` so this job and the API reprint
 * path cannot disagree about what a receipt says.
 */
async function loadReceiptFacts(tenantId: string, payment: PaymentRow): Promise<ReceiptFacts> {
  let lines: ReceiptFacts['lines'] = [];

  if (payment.invoice_id) {
    const res = await withTenant({ tenantId }, async (tx) => {
      const lineRes = await tx.query(
        `SELECT description, qty, unit_price, net_amount
         FROM invoice_lines
         WHERE tenant_id = $1 AND invoice_id = $2
         ORDER BY line_no ASC`,
        [tenantId, payment.invoice_id],
      );
      return lineRes.rows as Array<{
        description: string;
        qty: string;
        unit_price: string;
        net_amount: string;
      }>;
    });
    lines = res.map((l) => ({
      description: l.description,
      qty: Number(l.qty),
      unitPrice: Number(l.unit_price),
      total: Number(l.net_amount),
    }));
  }

  return {
    clinicName: payment.clinic_name,
    receiptNo: payment.payment_no,
    // pg returns TIMESTAMPTZ as a Date; the templates take strings.
    issuedAt: new Date(payment.received_at).toISOString(),
    cashierName: payment.cashier_name,
    patientName:
      payment.patient_first && payment.patient_last
        ? `${payment.patient_last}, ${payment.patient_first}`
        : undefined,
    lines,
    invoiceTotal: payment.invoice_total ? Number(payment.invoice_total) : null,
    discountTotal: payment.discount_total ? Number(payment.discount_total) : null,
    amount: Number(payment.amount),
    amountTendered: Number(payment.tendered_amount),
    changeGiven: Number(payment.change_amount),
    payer: payment.payer_type,
  };
}

