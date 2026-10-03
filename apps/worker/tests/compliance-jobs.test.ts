import { describe, it, expect, beforeEach } from 'vitest';
import { withTenant } from '@clinic/db';
import {
  handleRetentionEnforce,
  handleDsrDeadlineRemind,
  handleBreachClockRemind,
} from '../src/handlers/compliance-jobs.handler.js';

const TENANT_A = '11111111-1111-4111-8111-111111111111';

describe('Compliance Background Jobs (JOB-15, JOB-16, JOB-17)', () => {

  beforeEach(async () => {
    await withTenant({ tenantId: TENANT_A }, async (tx) => {
      await tx.query(`DELETE FROM retention_candidates WHERE tenant_id = $1`, [TENANT_A]);
      await tx.query(`DELETE FROM data_subject_requests WHERE tenant_id = $1`, [TENANT_A]);
      await tx.query(`DELETE FROM breach_incidents WHERE tenant_id = $1`, [TENANT_A]);
      await tx.query(`DELETE FROM legal_holds WHERE tenant_id = $1`, [TENANT_A]);
      await tx.query(`DELETE FROM outbox WHERE tenant_id = $1 AND event_type IN ('dsr.deadline.approaching', 'breach.clock.urgent')`, [TENANT_A]);
    });
  });

  it('JOB-15 retention.enforce identifies old records and flags held ones', async () => {
    // 1. Create a dummy patient and closed visit 11 years ago
    let patientId = '';
    let visitId = '';
    const runSuffix = Math.random().toString(36).slice(2, 8);

    await withTenant({ tenantId: TENANT_A }, async (tx) => {
      const pRes = await tx.query(
        `INSERT INTO patients (tenant_id, first_name, last_name, date_of_birth, gender)
         VALUES ($1, 'Ret', 'Patient', '1980-01-01', 'M')
         RETURNING id`,
        [TENANT_A],
      );
      patientId = pRes.rows[0].id;

      const vRes = await tx.query(
        `INSERT INTO visits (tenant_id, patient_id, branch_id, practitioner_id, visit_no, status, closed_at, created_by)
         VALUES ($1, $2, 'a1000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000002', $3, 'CLOSED', now() - interval '11 years', 'a3000000-0000-4000-8000-000000000001')
         RETURNING id`,
        [TENANT_A, patientId, `V-RET-${runSuffix}`],
      );
      visitId = vRes.rows[0].id;

      // Place a legal hold on this patient
      await tx.query(
        `INSERT INTO legal_holds (tenant_id, hold_no, scope, patient_id, reason)
         VALUES ($1, $2, 'PATIENT', $3, 'Active litigation hold')`,
        [TENANT_A, `HLD-TEST-${runSuffix}`, patientId],
      );
    });

    const res = await handleRetentionEnforce(TENANT_A);
    expect(res.candidatesFound).toBeGreaterThanOrEqual(1);

    await withTenant({ tenantId: TENANT_A }, async (tx) => {
      const cRes = await tx.query(
        `SELECT * FROM retention_candidates WHERE tenant_id = $1 AND entity_id = $2`,
        [TENANT_A, visitId],
      );
      expect(cRes.rows.length).toBe(1);
      expect(cRes.rows[0].status).toBe('HELD');
      expect(cRes.rows[0].held_by_legal_hold_id).toBeTruthy();
    });
  });

  it('JOB-16 dsr.deadline.remind writes outbox events for nearing DSRs', async () => {
    const dsrSuffix = Math.random().toString(36).slice(2, 8);
    await withTenant({ tenantId: TENANT_A }, async (tx) => {
      const pRes = await tx.query(
        `SELECT id FROM patients WHERE tenant_id = $1 LIMIT 1`,
        [TENANT_A],
      );
      const patientId = pRes.rows[0].id;

      await tx.query(
        `INSERT INTO data_subject_requests (tenant_id, patient_id, request_no, type, status, due_at)
         VALUES ($1, $2, $3, 'ACCESS', 'IN_PROGRESS', now() + interval '2 days')`,
        [TENANT_A, patientId, `DSR-TEST-${dsrSuffix}`],
      );
    });

    const res = await handleDsrDeadlineRemind(TENANT_A);
    expect(res.reminded).toBeGreaterThanOrEqual(1);

    await withTenant({ tenantId: TENANT_A }, async (tx) => {
      const outboxRes = await tx.query(
        `SELECT * FROM outbox WHERE tenant_id = $1 AND event_type = 'dsr.deadline.approaching'`,
        [TENANT_A],
      );
      expect(outboxRes.rows.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('JOB-17 breach.clock.remind escalates unnotified breaches approaching 72h deadline', async () => {
    const breachSuffix = Math.random().toString(36).slice(2, 8);
    await withTenant({ tenantId: TENANT_A }, async (tx) => {
      await tx.query(
        `INSERT INTO breach_incidents (tenant_id, incident_no, description, severity, status, notify_regulator_due_at, notified_regulator)
         VALUES ($1, $2, 'Test breach', 'HIGH', 'ASSESSED', now() + interval '4 hours', false)`,
        [TENANT_A, `BRC-TEST-${breachSuffix}`],
      );
    });

    const res = await handleBreachClockRemind(TENANT_A);
    expect(res.escalated).toBeGreaterThanOrEqual(1);

    await withTenant({ tenantId: TENANT_A }, async (tx) => {
      const outboxRes = await tx.query(
        `SELECT * FROM outbox WHERE tenant_id = $1 AND event_type = 'breach.clock.urgent'`,
        [TENANT_A],
      );
      expect(outboxRes.rows.length).toBeGreaterThanOrEqual(1);
    });
  });
});
