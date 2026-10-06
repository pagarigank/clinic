/**
 * Laboratory scheduling jobs that fan out per tenant (todo.md 6.4,
 * specification 14 — JOB-41, JOB-44, JOB-45, JOB-46).
 *
 * Regression guard for a class of defect, not just a line of code: these jobs
 * used the raw application pool (`getAppPool`) and queried tenant tables with
 * no tenant GUC set. Every RLS policy is `tenant_id = app.tenant_id()`, which
 * is NULL in that session, so the predicate is never true and the job returns
 * zero rows forever — silently, without erroring. The jobs "ran" on schedule
 * and did nothing. `clinic_app` is NOBYPASSRLS, and the tables are FORCE RLS,
 * so this is not a theoretical concern.
 *
 * The fix fans out via activeTenantIds() -> withTenant({tenantId}), matching
 * JOB-43 and JOB-47 in the same file. These tests prove a job now *finds* a
 * qualifying row in a tenant (which only happens if the tenant GUC is set) and
 * that its outbox event is emitted exactly once across repeated ticks
 * (dedup_key), since a schedule re-runs forever.
 *
 * Fixtures live in Demo Clinic B: it has no seeded lab data, so counts are the
 * rows this suite created rather than whatever the seed happens to contain.
 * The owner pool is used for setup/teardown/assertions only.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { probeDb, seedUsers, NO_SEED_USERS } from '@clinic/db/tests/helpers.js';
import { createPool } from '@clinic/db';
import {
  runLabCriticalEscalate,
  runLabQcMissingRemind,
  runLabSpecimenStaleFlag,
  runLabInstrumentCalibrationRemind,
} from '../src/handlers/lab-jobs.handler.js';

const hasDb = await probeDb();

const TENANT = '22222222-2222-4222-8222-222222222222';
const BRANCH = 'b1000000-0000-4000-8000-000000000001';
const { DOCTOR_B: USER } = hasDb ? await seedUsers() : NO_SEED_USERS;

const tag = `rls-${Date.now().toString(36)}`;
const owner = createPool({ role: 'owner' });

const created = {
  sections: [] as string[],
  instruments: [] as string[],
  specimenTypes: [] as string[],
  tests: [] as string[],
  analytes: [] as string[],
  orders: [] as string[],
  orderItems: [] as string[],
  results: [] as string[],
  notifications: [] as string[],
  specimens: [] as string[],
  patients: [] as string[],
};

async function one<T extends string>(sql: string, params: unknown[]): Promise<T> {
  const res = await owner.query<{ id: T }>(sql, params);
  return res.rows[0]!.id;
}

async function eventCount(eventType: string, payloadKey: string, payloadValue: string): Promise<number> {
  const res = await owner.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM outbox
     WHERE tenant_id = $1 AND event_type = $2 AND payload ->> $3 = $4`,
    [TENANT, eventType, payloadKey, payloadValue],
  );
  return Number(res.rows[0]!.n);
}

beforeAll(async () => {
  if (!hasDb) return;
  const section = await one(
    `INSERT INTO lab_sections (tenant_id, code, name) VALUES ($1, $2, $3) RETURNING id`,
    [TENANT, tag, tag],
  );
  created.sections.push(section);

  const patient = await one(
    `INSERT INTO patients (tenant_id, first_name, last_name, date_of_birth, gender)
     VALUES ($1, 'Rls', 'Fixture', '1990-01-01', 'MALE') RETURNING id`,
    [TENANT],
  );
  created.patients.push(patient);
});

afterAll(async () => {
  try {
    if (!hasDb) return;
    if (created.notifications.length) {
      await owner.query(`DELETE FROM lab_critical_notifications WHERE id = ANY($1::uuid[])`, [created.notifications]);
    }
    if (created.results.length) {
      await owner.query(`DELETE FROM lab_results WHERE id = ANY($1::uuid[])`, [created.results]);
    }
    if (created.orderItems.length) {
      await owner.query(`DELETE FROM lab_order_items WHERE id = ANY($1::uuid[])`, [created.orderItems]);
    }
    if (created.specimens.length) {
      await owner.query(`DELETE FROM specimens WHERE id = ANY($1::uuid[])`, [created.specimens]);
    }
    if (created.orders.length) {
      await owner.query(`DELETE FROM lab_orders WHERE id = ANY($1::uuid[])`, [created.orders]);
    }
    if (created.analytes.length) {
      await owner.query(`DELETE FROM lab_analytes WHERE id = ANY($1::uuid[])`, [created.analytes]);
    }
    if (created.tests.length) {
      await owner.query(`DELETE FROM lab_tests WHERE id = ANY($1::uuid[])`, [created.tests]);
    }
    if (created.instruments.length) {
      await owner.query(`DELETE FROM lab_instruments WHERE id = ANY($1::uuid[])`, [created.instruments]);
    }
    if (created.specimenTypes.length) {
      await owner.query(`DELETE FROM lab_specimen_types WHERE id = ANY($1::uuid[])`, [created.specimenTypes]);
    }
    if (created.patients.length) {
      await owner.query(`DELETE FROM patients WHERE id = ANY($1::uuid[])`, [created.patients]);
    }
    if (created.sections.length) {
      await owner.query(`DELETE FROM lab_sections WHERE id = ANY($1::uuid[])`, [created.sections]);
    }
  } finally {
    await owner.end();
  }
});

describe.skipIf(!hasDb)('lab scheduling jobs fan out per tenant under forced RLS', () => {
  it('JOB-41 escalates an overdue unacknowledged critical value and does not re-escalate it', async () => {
    const specimenType = await one(
      `INSERT INTO lab_specimen_types (tenant_id, code, name, default_container)
       VALUES ($1, $2, $3, 'EDTA tube') RETURNING id`,
      [TENANT, `${tag}-st`, `${tag}-st`],
    );
    created.specimenTypes.push(specimenType);

    const test = await one(
      `INSERT INTO lab_tests (tenant_id, section_id, specimen_type_id, code, name)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [TENANT, created.sections[0], specimenType, `${tag}-t`, `${tag}-t`],
    );
    created.tests.push(test);

    const analyte = await one(
      `INSERT INTO lab_analytes (tenant_id, test_id, code, name, default_unit)
       VALUES ($1, $2, $3, $4, 'mg/dL') RETURNING id`,
      [TENANT, test, `${tag}-a`, `${tag}-a`],
    );
    created.analytes.push(analyte);

    const order = await one(
      `INSERT INTO lab_orders (tenant_id, branch_id, order_no, patient_id, ordered_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [TENANT, BRANCH, `${tag}-ord`, created.patients[0], USER],
    );
    created.orders.push(order);

    const item = await one(
      `INSERT INTO lab_order_items (tenant_id, order_id, test_id) VALUES ($1, $2, $3) RETURNING id`,
      [TENANT, order, test],
    );
    created.orderItems.push(item);

    const result = await one(
      `INSERT INTO lab_results (tenant_id, order_item_id, analyte_id, unit, flag, status, entered_by)
       VALUES ($1, $2, $3, 'mg/dL', 'HH', 'ENTERED', $4) RETURNING id`,
      [TENANT, item, analyte, USER],
    );
    created.results.push(result);

    const notification = await one(
      `INSERT INTO lab_critical_notifications (tenant_id, result_id, notified_to, notified_by, detected_at)
       VALUES ($1, $2, 'LAB_MANAGER', $3, now() - interval '30 minutes') RETURNING id`,
      [TENANT, result, USER],
    );
    created.notifications.push(notification);

    const first = await runLabCriticalEscalate(15, TENANT);
    expect(first.escalatedCount).toBeGreaterThanOrEqual(1);

    const escalated = await owner.query<{ escalated_at: string | null }>(
      `SELECT escalated_at FROM lab_critical_notifications WHERE id = $1`,
      [notification],
    );
    expect(escalated.rows[0]!.escalated_at).not.toBeNull();
    expect(await eventCount('lab.critical.escalated', 'resultId', result)).toBe(1);

    // escalated_at is now set, so the second tick must find nothing to escalate
    // and must not duplicate the event.
    const second = await runLabCriticalEscalate(15, TENANT);
    expect(second.escalatedCount).toBe(0);
    expect(await eventCount('lab.critical.escalated', 'resultId', result)).toBe(1);
  });

  it('JOB-44 reminds for an instrument with no QC run today, once per day', async () => {
    const instrument = await one(
      `INSERT INTO lab_instruments (tenant_id, branch_id, section_id, code, name)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [TENANT, BRANCH, created.sections[0], `${tag}-qc`, `${tag}-qc`],
    );
    created.instruments.push(instrument);

    const first = await runLabQcMissingRemind(TENANT);
    expect(first.remindedCount).toBeGreaterThanOrEqual(1);
    expect(await eventCount('lab.qc.missing.reminder', 'instrumentId', instrument)).toBe(1);

    // Re-running the schedule must not duplicate the day's reminder.
    await runLabQcMissingRemind(TENANT);
    expect(await eventCount('lab.qc.missing.reminder', 'instrumentId', instrument)).toBe(1);
  });

  it('JOB-45 flags a specimen past its stability window, once per specimen', async () => {
    const specimenType = await one(
      `INSERT INTO lab_specimen_types (tenant_id, code, name, default_container, stability_hours)
       VALUES ($1, $2, $3, 'EDTA tube', 1) RETURNING id`,
      [TENANT, `${tag}-stale`, `${tag}-stale`],
    );
    created.specimenTypes.push(specimenType);

    const order = await one(
      `INSERT INTO lab_orders (tenant_id, branch_id, order_no, patient_id, ordered_by, ordered_at)
       VALUES ($1, $2, $3, $4, $5, now() - interval '2 days') RETURNING id`,
      [TENANT, BRANCH, `${tag}-stale-ord`, created.patients[0], USER],
    );
    created.orders.push(order);

    const specimen = await one(
      `INSERT INTO specimens (tenant_id, accession_no, order_id, specimen_type_id, condition, collected_at)
       VALUES ($1, $2, $3, $4, 'OK', now() - interval '5 hours') RETURNING id`,
      [TENANT, `${tag}-acc`, order, specimenType],
    );
    created.specimens.push(specimen);

    const first = await runLabSpecimenStaleFlag(TENANT);
    expect(first.staleCount).toBeGreaterThanOrEqual(1);
    expect(await eventCount('lab.specimen.stale', 'specimenId', specimen)).toBe(1);

    await runLabSpecimenStaleFlag(TENANT);
    expect(await eventCount('lab.specimen.stale', 'specimenId', specimen)).toBe(1);
  });

  it('JOB-46 reminds for an instrument due for calibration, once per due date', async () => {
    const instrument = await one(
      `INSERT INTO lab_instruments (tenant_id, branch_id, section_id, code, name, calibration_due_at)
       VALUES ($1, $2, $3, $4, $5, now()) RETURNING id`,
      [TENANT, BRANCH, created.sections[0], `${tag}-cal`, `${tag}-cal`],
    );
    created.instruments.push(instrument);

    const first = await runLabInstrumentCalibrationRemind(TENANT);
    expect(first.remindedCount).toBeGreaterThanOrEqual(1);
    expect(await eventCount('lab.instrument.calibration.due', 'instrumentId', instrument)).toBe(1);

    await runLabInstrumentCalibrationRemind(TENANT);
    expect(await eventCount('lab.instrument.calibration.due', 'instrumentId', instrument)).toBe(1);
  });
});
