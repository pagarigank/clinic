/**
 * Pharmacy scheduling jobs that fan out per tenant (todo.md 5.3,
 * specification 9 — JOB-38, JOB-39, JOB-40).
 *
 * Same defect class as the laboratory suite: these jobs used the raw
 * application pool (`getAppPool`) and queried tenant tables with no tenant GUC
 * set. Every RLS policy is `tenant_id = app.tenant_id()`, which is NULL in that
 * session, so the predicate is never true and the job silently matches zero
 * rows forever. `clinic_app` is NOBYPASSRLS and the tables are FORCE RLS.
 *
 * A second, independent defect was specific to JOB-38: it filtered
 * `stock_batches.status = 'ACTIVE'`, but the status vocabulary is
 * ('AVAILABLE','QUARANTINED','EXPIRED','RECALLED','DEPLETED'). The predicate
 * matched no batch, so on-hand read as 0 against any register balance and every
 * controlled drug was reported as a discrepancy.
 *
 * Fixtures live in Demo Clinic B (no seeded pharmacy data), so counts are the
 * rows this suite created. `controlled_register` is append-only, so teardown
 * temporarily disables its deny triggers to remove fixtures. The owner pool is
 * used for setup/teardown/assertions only.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { probeDb } from '@clinic/db/tests/helpers.js';
import { createPool } from '@clinic/db';
import {
  runControlledReconcile,
  runControlledReportGenerate,
  runPharmacyRxPendingRemind,
} from '../src/handlers/pharmacy-jobs.handler.js';

const hasDb = await probeDb();

const TENANT = '22222222-2222-4222-8222-222222222222';
const BRANCH = 'b1000000-0000-4000-8000-000000000001';
const USER = 'b3000000-0000-4000-8000-000000000002';

const tag = `phm-${Date.now().toString(36)}`;
const today = new Date().toISOString().slice(0, 10);
const month = new Date().toISOString().substring(0, 7);

const owner = createPool({ role: 'owner' });

const ids: Record<string, string> = {};

async function one<T extends string>(sql: string, params: unknown[]): Promise<T> {
  const res = await owner.query<{ id: T }>(sql, params);
  return res.rows[0]!.id;
}

async function eventCountByDrug(eventType: string, drugItemId: string): Promise<number> {
  const res = await owner.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM outbox
     WHERE tenant_id = $1 AND event_type = $2 AND payload ->> 'drugItemId' = $3`,
    [TENANT, eventType, drugItemId],
  );
  return Number(res.rows[0]!.n);
}

async function eventCount(eventType: string): Promise<number> {
  const res = await owner.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM outbox WHERE tenant_id = $1 AND event_type = $2`,
    [TENANT, eventType],
  );
  return Number(res.rows[0]!.n);
}

beforeAll(async () => {
  if (!hasDb) return;

  ids.patient = await one(
    `INSERT INTO patients (tenant_id, first_name, last_name, date_of_birth, gender)
     VALUES ($1, 'Rls', 'Pharmacy', '1990-01-01', 'MALE') RETURNING id`,
    [TENANT],
  );

  const uomRes = await owner.query<{ id: string }>(
    `SELECT id FROM uoms WHERE tenant_id = $1 LIMIT 1`,
    [TENANT],
  );
  ids.uom = uomRes.rows[0]!.id;

  ids.location = await one(
    `INSERT INTO stock_locations (tenant_id, branch_id, code, name, type)
     VALUES ($1, $2, $3, $4, 'PHARMACY') RETURNING id`,
    [TENANT, BRANCH, `${tag}-loc`, `${tag}-loc`],
  );

  // Balanced controlled drug: batch AVAILABLE, on-hand 10, register balance 10.
  ids.itemA = await one(
    `INSERT INTO items (tenant_id, code, name, item_type, base_uom_id)
     VALUES ($1, $2, $3, 'MEDICINE', $4) RETURNING id`,
    [TENANT, `${tag}-a`, `${tag}-a`, ids.uom],
  );
  ids.batchA = await one(
    `INSERT INTO stock_batches (tenant_id, item_id, lot_no, expiry_date, status)
     VALUES ($1, $2, $3, now() + interval '1 year', 'AVAILABLE') RETURNING id`,
    [TENANT, ids.itemA, `${tag}-lot-a`],
  );
  await owner.query(
    `INSERT INTO stock_balances (tenant_id, location_id, batch_id, qty_on_hand)
     VALUES ($1, $2, $3, 10)`,
    [TENANT, ids.location, ids.batchA],
  );
  await owner.query(
    `INSERT INTO controlled_register
       (tenant_id, branch_id, drug_item_id, batch_id, entry_type, qty_in, qty_out, running_balance, pharmacist_id, witness_id)
     VALUES ($1, $2, $3, $4, 'RECEIPT', 10, 0, 10, $5, $5)`,
    [TENANT, BRANCH, ids.itemA, ids.batchA, USER],
  );

  // Discrepant controlled drug: no stock on hand, register balance 5.
  ids.itemB = await one(
    `INSERT INTO items (tenant_id, code, name, item_type, base_uom_id)
     VALUES ($1, $2, $3, 'MEDICINE', $4) RETURNING id`,
    [TENANT, `${tag}-b`, `${tag}-b`, ids.uom],
  );
  ids.batchB = await one(
    `INSERT INTO stock_batches (tenant_id, item_id, lot_no, expiry_date, status)
     VALUES ($1, $2, $3, now() + interval '1 year', 'AVAILABLE') RETURNING id`,
    [TENANT, ids.itemB, `${tag}-lot-b`],
  );
  await owner.query(
    `INSERT INTO controlled_register
       (tenant_id, branch_id, drug_item_id, batch_id, entry_type, qty_in, qty_out, running_balance, pharmacist_id, witness_id)
     VALUES ($1, $2, $3, $4, 'RECEIPT', 5, 0, 5, $5, $5)`,
    [TENANT, BRANCH, ids.itemB, ids.batchB, USER],
  );

  // Visit + issued prescription older than the 2h reminder threshold.
  ids.visit = await one(
    `INSERT INTO visits (tenant_id, branch_id, visit_no, patient_id, practitioner_id, created_by)
     VALUES ($1, $2, $3, $4, $5, $5) RETURNING id`,
    [TENANT, BRANCH, `${tag}-visit`, ids.patient, USER],
  );
  ids.rx = await one(
    `INSERT INTO prescriptions (tenant_id, visit_id, patient_id, prescriber_id, rx_no, status, issued_at, issued_by)
     VALUES ($1, $2, $3, $4, $5, 'ISSUED', now() - interval '3 hours', $4) RETURNING id`,
    [TENANT, ids.visit, ids.patient, USER, `${tag}-rx`],
  );
});

afterAll(async () => {
  if (!hasDb) return;
  try {
    await owner.query(
      `DELETE FROM outbox WHERE tenant_id = $1 AND dedup_key = ANY($2::text[])`,
      [
        TENANT,
        [
          `controlled-reconcile:${BRANCH}:${ids.itemA}:${today}`,
          `controlled-reconcile:${BRANCH}:${ids.itemB}:${today}`,
          `controlled-report:${month}`,
          `rx-pending:${today}`,
        ],
      ],
    );

    // controlled_register is append-only; disable the deny triggers just for teardown.
    await owner.query(`ALTER TABLE controlled_register DISABLE TRIGGER USER`);
    try {
      await owner.query(
        `DELETE FROM controlled_register WHERE tenant_id = $1 AND drug_item_id = ANY($2::uuid[])`,
        [TENANT, [ids.itemA, ids.itemB]],
      );
    } finally {
      await owner.query(`ALTER TABLE controlled_register ENABLE TRIGGER USER`);
    }

    await owner.query(`DELETE FROM stock_balances WHERE tenant_id = $1 AND location_id = $2`, [TENANT, ids.location]);
    await owner.query(`DELETE FROM prescriptions WHERE tenant_id = $1 AND id = $2`, [TENANT, ids.rx]);
    await owner.query(`DELETE FROM visits WHERE tenant_id = $1 AND id = $2`, [TENANT, ids.visit]);
    await owner.query(`DELETE FROM stock_batches WHERE tenant_id = $1 AND id = ANY($2::uuid[])`, [
      TENANT,
      [ids.batchA, ids.batchB],
    ]);
    await owner.query(`DELETE FROM items WHERE tenant_id = $1 AND id = ANY($2::uuid[])`, [
      TENANT,
      [ids.itemA, ids.itemB],
    ]);
    await owner.query(`DELETE FROM stock_locations WHERE tenant_id = $1 AND id = $2`, [TENANT, ids.location]);
    await owner.query(`DELETE FROM patients WHERE id = $1`, [ids.patient]);
  } finally {
    await owner.end();
  }
});

describe.skipIf(!hasDb)('pharmacy scheduling jobs fan out per tenant under forced RLS', () => {
  it('JOB-38 reconciles an AVAILABLE batch without a false discrepancy', async () => {
    const res = await runControlledReconcile(TENANT);
    expect(res.reconciledCount).toBeGreaterThanOrEqual(1);
    // Batch item A is AVAILABLE with on-hand == register balance: no alert.
    expect(await eventCountByDrug('controlled.reconciliation.discrepancy', ids.itemA!)).toBe(0);
  });

  it('JOB-38 flags a genuine controlled variance once per drug per day', async () => {
    const first = await runControlledReconcile(TENANT);
    expect(first.varianceCount).toBeGreaterThanOrEqual(1);
    expect(await eventCountByDrug('controlled.reconciliation.discrepancy', ids.itemB!)).toBe(1);

    await runControlledReconcile(TENANT);
    expect(await eventCountByDrug('controlled.reconciliation.discrepancy', ids.itemB!)).toBe(1);
  });

  it('JOB-39 emits one controlled monthly report request per tenant per month', async () => {
    const first = await runControlledReportGenerate(TENANT);
    expect(first.generatedCount).toBeGreaterThanOrEqual(1);
    expect(await eventCount('controlled.report.monthly')).toBe(1);

    await runControlledReportGenerate(TENANT);
    expect(await eventCount('controlled.report.monthly')).toBe(1);
  });

  it('JOB-40 reminds for an overdue issued prescription once per tenant per day', async () => {
    const first = await runPharmacyRxPendingRemind(2, TENANT);
    expect(first.remindedCount).toBeGreaterThanOrEqual(1);
    expect(await eventCount('pharmacy.rx.pending.remind')).toBe(1);

    const payload = await owner.query<{ pending_rx: number; oldest: string | null }>(
      `SELECT (payload ->> 'pendingRxCount')::int AS pending_rx,
              payload ->> 'oldestIssuedAt' AS oldest
       FROM outbox WHERE tenant_id = $1 AND event_type = 'pharmacy.rx.pending.remind'`,
      [TENANT],
    );
    expect(payload.rows[0]!.pending_rx).toBeGreaterThanOrEqual(1);
    expect(payload.rows[0]!.oldest).not.toBeNull();

    await runPharmacyRxPendingRemind(2, TENANT);
    expect(await eventCount('pharmacy.rx.pending.remind')).toBe(1);
  });
});
