/**
 * JOB-43 lab.report.render (todo.md 3.2, specification 14).
 *
 * These assert the *meaning* of the stored digest. The handler previously wrote
 * SHA-256 of a string containing Date.now(), and lab.service wrote SHA-256 of
 * the report JSON. Both produced well-formed 64-hex values that no stored
 * document could ever be verified against. The digest must be the SHA-256 of
 * the rendered PDF, so it re-verifies against the bytes a download serves.
 *
 * The handler renders every pending report in a tenant, so these run against
 * Demo Clinic B, which has no seeded lab reports and is untouched by the API
 * lab suite (that one uses Demo Clinic A). Demo Clinic A is the "other tenant":
 * it holds 50+ reports, so the isolation assertions there are real rather than
 * vacuous on an empty table.
 */
import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { probeDb, seedUsers, NO_SEED_USERS } from '@clinic/db/tests/helpers.js';
import { createPool, withTenantOnPool } from '@clinic/db';
import { sha256Of, verifyDocument } from '@clinic/print';
import { runLabReportRender } from '../src/handlers/lab-jobs.handler.js';

const hasDb = await probeDb();

const TENANT = '22222222-2222-4222-8222-222222222222';
const OTHER_TENANT = '11111111-1111-4111-8111-111111111111';
const BRANCH = 'b1000000-0000-4000-8000-000000000001';
const { DOCTOR_B: USER } = hasDb ? await seedUsers() : NO_SEED_USERS;

const createdOrders: string[] = [];
const createdReports: string[] = [];
const patients = new Map<string, string>();

/** One patient per tenant: patient_id must resolve within the same tenant. */
async function patientFor(tenantId: string): Promise<string> {
  const cached = patients.get(tenantId);
  if (cached) return cached;
  const owner = createPool({ role: 'owner' });
  try {
    const res = await owner.query<{ id: string }>(
      `INSERT INTO patients (tenant_id, first_name, last_name, date_of_birth, gender)
       VALUES ($1, 'Job43', 'Fixture', '1988-08-08', 'MALE')
       RETURNING id`,
      [tenantId],
    );
    patients.set(tenantId, res.rows[0]!.id);
    return res.rows[0]!.id;
  } finally {
    await owner.end();
  }
}

function reportData() {
  return {
    order: {
      order_no: 'LAB-2026-0001',
      clinic_name: 'Riverside Family Clinic',
      patient_name: 'Dela Cruz, Juan',
      patient_age: '41',
      patient_sex: 'M',
      collected_at: '2026-02-01 08:15',
      received_at: '2026-02-01 09:02',
      ordering_clinician: 'Dr. Santos',
    },
    releasedAt: '2026-02-01T10:00:00.000Z',
  };
}

const RESULTS = [
  {
    test_name: 'Complete Blood Count',
    analyte_name: 'Hemoglobin',
    value_num: 13.2,
    unit: 'g/dL',
    ref_range_text: '13.0-17.0',
    flag: 'N',
  },
  {
    test_name: 'Complete Blood Count',
    analyte_name: 'WBC',
    value_num: 11.8,
    unit: '10^9/L',
    ref_range_text: '4.0-10.0',
    flag: 'H',
  },
];

async function seedReport(tenantId = TENANT, results: unknown = RESULTS): Promise<string> {
  const patientId = await patientFor(tenantId);
  const pool = createPool({ role: 'app' });
  try {
    const id = await withTenantOnPool(pool, { tenantId, userId: USER }, async (tx) => {
      const order = await tx.query<{ id: string }>(
        `INSERT INTO lab_orders (tenant_id, branch_id, order_no, patient_id, ordered_by, status, source)
         VALUES ($1, $2, $3, $4, $5, 'RELEASED', 'WALK_IN')
         RETURNING id`,
        [tenantId, BRANCH, `LAB-JOB43-${crypto.randomUUID().slice(0, 8)}`, patientId, USER],
      );
      const orderId = order.rows[0]!.id;
      createdOrders.push(orderId);

      const report = await tx.query<{ id: string }>(
        `INSERT INTO lab_reports (tenant_id, order_id, version, sha256_hash, status,
                                  report_data, issued_by)
         VALUES ($1, $2, 1, NULL, 'FINAL', $3, $4)
         RETURNING id`,
        [
          tenantId,
          orderId,
          JSON.stringify({ ...reportData(), results }),
          USER,
        ],
      );
      return report.rows[0]!.id;
    });
    createdReports.push(id);
    return id;
  } finally {
    await pool.end();
  }
}

async function readReport(id: string) {
  const owner = createPool({ role: 'owner' });
  try {
    const res = await owner.query(
      `SELECT lr.id, lr.file_id, lr.sha256_hash, f.content, f.sha256 AS file_sha256,
              f.mime_type, f.status, f.origin, f.size_bytes
       FROM lab_reports lr
       LEFT JOIN files f ON f.id = lr.file_id AND f.tenant_id = lr.tenant_id
       WHERE lr.id = $1`,
      [id],
    );
    return res.rows[0];
  } finally {
    await owner.end();
  }
}

async function clearArtifact(reportId: string) {
  // clinic_app has INSERT/SELECT/UPDATE on files but no DELETE: artifacts are
  // immutable from the app path. Teardown uses owner for the same reason, and
  // detaches this report's file only — lab_reports holds ON DELETE RESTRICT and
  // other reports still reference their own artifacts.
  const owner = createPool({ role: 'owner' });
  try {
    const prior = await owner.query<{ file_id: string | null }>(
      `SELECT file_id FROM lab_reports WHERE id = $1`,
      [reportId],
    );
    const fileId = prior.rows[0]?.file_id;
    await owner.query(`UPDATE lab_reports SET file_id = NULL, sha256_hash = NULL WHERE id = $1`, [
      reportId,
    ]);
    if (fileId) {
      await owner.query(`DELETE FROM files WHERE id = $1`, [fileId]);
    }
  } finally {
    await owner.end();
  }
}

describe.skipIf(!hasDb)('JOB-43 lab.report.render', () => {
  beforeAll(async () => {
    await patientFor(TENANT);
  });

  afterAll(async () => {
    const owner = createPool({ role: 'owner' });
    try {
      if (createdReports.length > 0) {
        await owner.query(`DELETE FROM outbox WHERE payload->>'reportId' = ANY($1)`, [createdReports]);
      }
      // Detach this run's reports from their artifacts before deleting the
      // artifacts: lab_reports holds ON DELETE RESTRICT.
      if (createdReports.length > 0) {
        await owner.query(`UPDATE lab_reports SET file_id = NULL WHERE id = ANY($1)`, [createdReports]);
      }
      for (const tenantId of new Set([TENANT, OTHER_TENANT])) {
        const files = await owner.query<{ id: string }>(
          `SELECT f.id FROM files f
           WHERE f.tenant_id = $1 AND f.object_key LIKE $2
             AND NOT EXISTS (SELECT 1 FROM lab_reports lr WHERE lr.file_id = f.id)
             AND NOT EXISTS (SELECT 1 FROM medical_certificates mc WHERE mc.file_id = f.id)
             AND NOT EXISTS (SELECT 1 FROM payment_reprints pr WHERE pr.file_id = f.id)`,
          [tenantId, `t/${tenantId}/lab-report/%`],
        );
        for (const f of files.rows) {
          await owner.query(`DELETE FROM files WHERE id = $1`, [f.id]);
        }
      }
      // Deleting orders cascades to this run's lab_reports.
      if (createdOrders.length > 0) {
        await owner.query(`DELETE FROM lab_orders WHERE id = ANY($1)`, [createdOrders]);
      }
      for (const pid of patients.values()) {
        await owner.query(`DELETE FROM patients WHERE id = $1`, [pid]);
      }
    } finally {
      await owner.end();
    }
  });

  it('renders a PDF artifact and records the digest of those exact bytes', async () => {
    const reportId = await seedReport();
    const result = await runLabReportRender(TENANT);

    expect(result.renderedCount).toBeGreaterThanOrEqual(1);

    const row = await readReport(reportId);
    expect(row.file_id).toBeTruthy();
    expect(row.origin).toBe('GENERATED');
    expect(row.status).toBe('READY');
    expect(row.mime_type).toBe('application/pdf');
    expect(row.content.subarray(0, 5).toString('latin1')).toBe('%PDF-');

    // The central assertion: the recorded digest describes the stored bytes.
    expect(row.sha256_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.file_sha256).toBe(row.sha256_hash);
    expect(sha256Of(row.content)).toBe(row.sha256_hash);
    // size_bytes is bigint, which node-pg surfaces as a string.
    expect(Number(row.size_bytes)).toBe(row.content.length);
  });

  it('produces a digest that verifies against the bytes a download would serve', async () => {
    const reportId = await seedReport();
    await runLabReportRender(TENANT);

    const row = await readReport(reportId);
    const verified = verifyDocument(row.content, row.sha256_hash);
    expect(verified.valid).toBe(true);
    expect(verified.actualSha256).toBe(row.sha256_hash);
  });

  it('is deterministic: re-rendering the same report yields an identical digest', async () => {
    const reportId = await seedReport();
    await runLabReportRender(TENANT);
    const first = await readReport(reportId);

    // Clear the artifact so the report is picked up again, as it would be if the
    // first attempt had been rolled back.
    await clearArtifact(reportId);
    await runLabReportRender(TENANT);

    const second = await readReport(reportId);
    expect(second.sha256_hash).toBe(first.sha256_hash);
  });

  it('does not re-render a report that already has an artifact', async () => {
    const reportId = await seedReport();
    await runLabReportRender(TENANT);
    const first = await readReport(reportId);

    await runLabReportRender(TENANT);
    const after = await readReport(reportId);

    expect(after.file_id).toBe(first.file_id);
    expect(after.sha256_hash).toBe(first.sha256_hash);
  });

  it('emits lab.report.rendered carrying the real digest', async () => {
    const reportId = await seedReport();
    await runLabReportRender(TENANT);

    const row = await readReport(reportId);
    const owner = createPool({ role: 'owner' });
    try {
      const res = await owner.query(
        `SELECT payload FROM outbox WHERE event_type = 'lab.report.rendered'
           AND payload->>'reportId' = $1`,
        [reportId],
      );
      expect(res.rowCount).toBe(1);
      expect(res.rows[0].payload.sha256).toBe(row.sha256_hash);
    } finally {
      await owner.end();
    }
  });

  it('records a render failure without blocking other reports in the batch', async () => {
    const bad = await seedReport(TENANT, []);
    const good = await seedReport();

    const result = await runLabReportRender(TENANT);
    expect(result.failedCount).toBeGreaterThanOrEqual(1);

    // The malformed report is left untouched and observable...
    const badRow = await readReport(bad);
    expect(badRow.file_id).toBeNull();
    expect(badRow.sha256_hash).toBeNull();

    // ...while a healthy report in the same batch still renders. This is the
    // regression guard: a single bad report used to throw out of the whole
    // tenant loop and roll back every other report with it.
    const goodRow = await readReport(good);
    expect(goodRow.file_id).toBeTruthy();
    expect(goodRow.sha256_hash).toMatch(/^[0-9a-f]{64}$/);

    const owner = createPool({ role: 'owner' });
    try {
      const res = await owner.query(
        `SELECT payload FROM outbox WHERE event_type = 'lab.report.render_failed'
           AND payload->>'reportId' = $1`,
        [bad],
      );
      expect(res.rowCount).toBe(1);
      expect(res.rows[0].payload.error).toMatch(/no results/i);
    } finally {
      await owner.end();
    }
  });

  it('retains the superseded version\'s artifact unaltered when an amended version is rendered', async () => {
    // 1. Create v1
    const v1ReportId = await seedReport();
    await runLabReportRender(TENANT);
    const v1 = await readReport(v1ReportId);
    expect(v1.file_id).toBeTruthy();

    // 2. Create v2 (Amended)
    const owner = createPool({ role: 'owner' });
    let v2ReportId: string;
    try {
      const v2Res = await owner.query<{ id: string }>(
        `INSERT INTO lab_reports (
           tenant_id, order_id, version, status, report_data, issued_by
         )
         SELECT tenant_id, order_id, version + 1, 'CORRECTED', report_data, issued_by
         FROM lab_reports WHERE id = $1
         RETURNING id`,
        [v1ReportId]
      );
      v2ReportId = v2Res.rows[0]!.id;
      createdReports.push(v2ReportId);
    } finally {
      await owner.end();
    }

    // 3. Render v2
    await runLabReportRender(TENANT);
    
    // 4. Read both and compare
    const v1After = await readReport(v1ReportId);
    const v2 = await readReport(v2ReportId);
    
    // V1 artifact is completely untouched
    expect(v1After.file_id).toBe(v1.file_id);
    expect(v1After.sha256_hash).toBe(v1.sha256_hash);
    
    // V2 has its own distinct artifact
    expect(v2.file_id).toBeTruthy();
    expect(v2.file_id).not.toBe(v1.file_id);
    expect(v2.sha256_hash).toBeTruthy();
    expect(v2.sha256_hash).not.toBe(v1.sha256_hash);
  });

  it('leaves other tenants reports and artifacts untouched', async () => {
    const otherTenant = await seedReport(OTHER_TENANT);

    const owner = createPool({ role: 'owner' });
    const before = await owner.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM lab_reports WHERE tenant_id = $1 AND file_id IS NOT NULL`,
      [OTHER_TENANT],
    );
    const beforeFiles = await owner.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM files WHERE tenant_id = $1`,
      [OTHER_TENANT],
    );

    await runLabReportRender(TENANT);

    // The report seeded in the other tenant is not picked up...
    const row = await readReport(otherTenant);
    expect(row.file_id).toBeNull();
    expect(row.sha256_hash).toBeNull();

    // ...and no pre-existing artifact in that tenant was rewritten or added to.
    const after = await owner.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM lab_reports WHERE tenant_id = $1 AND file_id IS NOT NULL`,
      [OTHER_TENANT],
    );
    const afterFiles = await owner.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM files WHERE tenant_id = $1`,
      [OTHER_TENANT],
    );
    expect(after.rows[0]!.n).toBe(before.rows[0]!.n);
    expect(afterFiles.rows[0]!.n).toBe(beforeFiles.rows[0]!.n);
  });
});

describe.skipIf(!hasDb)('JOB-47 lab.interface.poll', () => {
  afterAll(async () => {
    const owner = createPool({ role: 'owner' });
    try {
      await owner.query(`DELETE FROM outbox WHERE event_type IN ('lab.interface.raw_message', 'lab.interface.exception')`);
    } finally {
      await owner.end();
    }
  });

  it('processes simulator messages and surfaces exceptions into the outbox', async () => {
    const owner = createPool({ role: 'owner' });
    try {
      // Insert a normal message
      await owner.query(
        `INSERT INTO outbox (tenant_id, aggregate_type, aggregate_id, event_type, payload)
         VALUES ($1, 'lab_interface', 'sim1', 'lab.interface.raw_message', $2)`,
        [TENANT, { message: 'OK', data: 'success' }]
      );

      // Insert an error message
      await owner.query(
        `INSERT INTO outbox (tenant_id, aggregate_type, aggregate_id, event_type, payload)
         VALUES ($1, 'lab_interface', 'sim2', 'lab.interface.raw_message', $2)`,
        [TENANT, { simulateError: true, errorMessage: 'HL7 parsing error: unexpected segment' }]
      );
    } finally {
      await owner.end();
    }

    const { runLabInterfacePoll } = await import('../src/handlers/lab-jobs.handler.js');
    const result = await runLabInterfacePoll();

    expect(result.processedCount).toBe(1);
    expect(result.exceptionCount).toBe(1);

    const owner2 = createPool({ role: 'owner' });
    try {
      // Check that the exception was surfaced
      const exceptions = await owner2.query(
        `SELECT payload FROM outbox WHERE tenant_id = $1 AND event_type = 'lab.interface.exception'`,
        [TENANT]
      );
      expect(exceptions.rowCount).toBe(1);
      expect(exceptions.rows[0].payload.error).toBe('HL7 parsing error: unexpected segment');

      // Check that the raw messages were marked as processed
      const raw = await owner2.query(
        `SELECT processed_at FROM outbox WHERE tenant_id = $1 AND event_type = 'lab.interface.raw_message'`,
        [TENANT]
      );
      expect(raw.rowCount).toBe(2);
      expect(raw.rows[0].processed_at).toBeTruthy();
      expect(raw.rows[1].processed_at).toBeTruthy();
    } finally {
      await owner2.end();
    }
  });
});
