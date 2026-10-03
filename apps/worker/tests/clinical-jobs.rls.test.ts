/**
 * Clinical scheduling jobs that fan out per tenant (todo.md 3.1/3.2/3.3,
 * JOB-23..JOB-26).
 *
 * Same RLS defect class as the laboratory and pharmacy suites: the handlers used
 * the raw application pool with no tenant GUC set, so every `tenant_id =
 * app.tenant_id()` predicate was false and the jobs silently did nothing.
 *
 * Fixtures live in Demo Clinic B. The owner pool is used for setup, teardown and
 * assertions only.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { probeDb } from '@clinic/db/tests/helpers.js';
import { createPool } from '@clinic/db';
import {
  runAppointmentReminders,
  runNoShowMarking,
  runStaleVisitClose,
  runRxExpire,
} from '../src/handlers/clinical-jobs.handler.js';

const hasDb = await probeDb();

const TENANT = '22222222-2222-4222-8222-222222222222';
const BRANCH = 'b1000000-0000-4000-8000-000000000001';
const USER = 'b3000000-0000-4000-8000-000000000002';

const tag = `cln-${Date.now().toString(36)}`;
const owner = createPool({ role: 'owner' });

const ids: Record<string, string> = {};

async function one<T extends string>(sql: string, params: unknown[]): Promise<T> {
  const res = await owner.query<{ id: T }>(sql, params);
  return res.rows[0]!.id;
}

async function status(table: string, id: string): Promise<string> {
  const res = await owner.query<{ status: string }>(
    `SELECT status FROM ${table} WHERE id = $1`,
    [id],
  );
  return res.rows[0]!.status;
}

beforeAll(async () => {
  if (!hasDb) return;

  ids.patient = await one(
    `INSERT INTO patients (tenant_id, first_name, last_name, date_of_birth, gender)
     VALUES ($1, 'Rls', 'Clinical', '1990-01-01', 'FEMALE') RETURNING id`,
    [TENANT],
  );

  ids.apptTomorrow = await one(
    `INSERT INTO appointments (tenant_id, branch_id, patient_id, practitioner_id, starts_at, ends_at, status, created_by)
     VALUES ($1, $2, $3, $4, now() + interval '1 day', now() + interval '1 day 30 minutes', 'BOOKED', $4) RETURNING id`,
    [TENANT, BRANCH, ids.patient, USER],
  );

  ids.apptOverdue = await one(
    `INSERT INTO appointments (tenant_id, branch_id, patient_id, practitioner_id, starts_at, ends_at, status, created_by)
     VALUES ($1, $2, $3, $4, now() - interval '1 hour', now() - interval '30 minutes', 'BOOKED', $4) RETURNING id`,
    [TENANT, BRANCH, ids.patient, USER],
  );

  ids.visit = await one(
    `INSERT INTO visits (tenant_id, branch_id, visit_no, patient_id, practitioner_id, status, opened_at, created_by)
     VALUES ($1, $2, $3, $4, $5, 'OPEN', now() - interval '2 days', $5) RETURNING id`,
    [TENANT, BRANCH, `${tag}-visit`, ids.patient, USER],
  );

  ids.rx = await one(
    `INSERT INTO prescriptions (tenant_id, visit_id, patient_id, prescriber_id, rx_no, status, valid_until, issued_at, issued_by)
     VALUES ($1, $2, $3, $4, $5, 'ISSUED', (now() - interval '1 day')::date, now() - interval '2 days', $4) RETURNING id`,
    [TENANT, ids.visit, ids.patient, USER, `${tag}-rx`],
  );
});

afterAll(async () => {
  if (!hasDb) return;
  try {
    await owner.query(
      `DELETE FROM outbox WHERE tenant_id = $1 AND event_type = 'appointment.reminder'`,
      [TENANT],
    );
    await owner.query(`DELETE FROM appointments WHERE tenant_id = $1 AND id = ANY($2::uuid[])`, [
      TENANT,
      [ids.apptTomorrow, ids.apptOverdue],
    ]);
    await owner.query(`DELETE FROM prescriptions WHERE tenant_id = $1 AND id = $2`, [TENANT, ids.rx]);
    await owner.query(`DELETE FROM visits WHERE tenant_id = $1 AND id = $2`, [TENANT, ids.visit]);
    await owner.query(`DELETE FROM patients WHERE id = $1`, [ids.patient]);
  } finally {
    await owner.end();
  }
});

describe.skipIf(!hasDb)('clinical scheduling jobs fan out per tenant under forced RLS', () => {
  it('JOB-23 queues a reminder for tomorrow and stamps reminded rows', async () => {
    const res = await runAppointmentReminders(TENANT);
    expect(res.reminded).toBeGreaterThanOrEqual(1);

    const stamped = await owner.query<{ reminder_sent_at: string | null }>(
      `SELECT reminder_sent_at FROM appointments WHERE id = $1`,
      [ids.apptTomorrow],
    );
    expect(stamped.rows[0]!.reminder_sent_at).not.toBeNull();

    const second = await runAppointmentReminders(TENANT);
    expect(second.reminded).toBe(0);
  });

  it('JOB-24 marks an overdue live appointment as NO_SHOW', async () => {
    const res = await runNoShowMarking(15, TENANT);
    expect(res.marked).toBeGreaterThanOrEqual(1);
    expect(await status('appointments', ids.apptOverdue!)).toBe('NO_SHOW');
  });

  it('JOB-25 moves a stale open visit to READY_FOR_BILLING', async () => {
    const res = await runStaleVisitClose(24, TENANT);
    expect(res.closed).toBeGreaterThanOrEqual(1);
    expect(await status('visits', ids.visit!)).toBe('READY_FOR_BILLING');
  });

  it('JOB-26 expires an issued prescription past valid_until', async () => {
    const res = await runRxExpire(TENANT);
    expect(res.expired).toBeGreaterThanOrEqual(1);
    expect(await status('prescriptions', ids.rx!)).toBe('EXPIRED');
  });
});
