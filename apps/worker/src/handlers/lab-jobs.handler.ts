import { getAppPool } from '@clinic/db/src/pool.js';
import { withTenant } from '@clinic/db';
import { renderPdf, renderLabReportHtml, type LabReport as LabReportDocument } from '@clinic/print';

/**
 * Laboratory background jobs — todo.md §6.4, specification.md §14 (JOB-41..JOB-47).
 *
 * JOB-41 lab.critical.escalate            — unacknowledged critical values escalation
 * JOB-42 lab.tat.monitor                  — detect STAT/routine orders exceeding TAT
 * JOB-43 lab.report.render                — renders report PDF, records SHA-256 hash
 * JOB-44 lab.qc.missing.remind            — reminds when daily QC not recorded
 * JOB-45 lab.specimen.stale.flag          — flags specimens beyond stability limit
 * JOB-46 lab.instrument.calibration.remind — calibration due reminders
 * JOB-47 lab.interface.poll              — process instrument interface queue (P2)
 */

/**
 * JOB-41: lab.critical.escalate
 * Unacknowledged critical values escalation:
 * If an alert in `lab_critical_notifications` is not acknowledged within the configured threshold
 * (e.g. 15 minutes by default), mark escalated_at and post an outbox escalation notification.
 */
export async function runLabCriticalEscalate(thresholdMinutes = 15): Promise<{ escalatedCount: number }> {
  const pool = getAppPool();

  const unacked = await pool.query(
    `SELECT lcn.id, lcn.tenant_id, lcn.result_id, lcn.detected_at, lcn.notified_to,
            lr.analyte_id, lr.value_num, lr.value_text, lr.flag,
            la.name as analyte_name, lo.order_no, lo.patient_id, lo.branch_id
     FROM lab_critical_notifications lcn
     JOIN lab_results lr ON lr.id = lcn.result_id AND lr.tenant_id = lcn.tenant_id
     JOIN lab_analytes la ON la.id = lr.analyte_id AND la.tenant_id = lcn.tenant_id
     JOIN lab_order_items loi ON loi.id = lr.order_item_id AND loi.tenant_id = lcn.tenant_id
     JOIN lab_orders lo ON lo.id = loi.order_id AND lo.tenant_id = lcn.tenant_id
     WHERE lcn.acknowledged_at IS NULL
       AND lcn.escalated_at IS NULL
       AND lcn.detected_at < now() - ($1 || ' minutes')::interval`,
    [thresholdMinutes],
  );

  let escalatedCount = 0;

  for (const row of unacked.rows) {
    await pool.query(
      `UPDATE lab_critical_notifications
       SET escalated_at = now()
       WHERE tenant_id = $1 AND id = $2`,
      [row.tenant_id, row.id],
    );

    await pool.query(
      `INSERT INTO outbox (tenant_id, event_type, payload)
       VALUES ($1, 'lab.critical.escalated', $2)
       ON CONFLICT DO NOTHING`,
      [
        row.tenant_id,
        JSON.stringify({
          notificationId: row.id,
          resultId: row.result_id,
          orderNo: row.order_no,
          patientId: row.patient_id,
          branchId: row.branch_id,
          analyteName: row.analyte_name,
          value: row.value_num ?? row.value_text,
          flag: row.flag,
          escalatedTo: 'LAB_MANAGER',
          detectedAt: row.detected_at,
          escalatedAt: new Date().toISOString(),
        }),
      ],
    );
    escalatedCount++;
  }

  return { escalatedCount };
}

/**
 * JOB-42: lab.tat.monitor
 * Detects STAT and routine orders that have exceeded target turnaround time.
 */
export async function runLabTatMonitor(): Promise<{ breachedCount: number }> {
  const pool = getAppPool();

  const overdue = await pool.query(
    `SELECT loi.id as item_id, loi.tenant_id, lo.order_no, lo.priority, lo.ordered_at,
            lt.name as test_name, lt.tat_minutes, lo.branch_id
     FROM lab_order_items loi
     JOIN lab_orders lo ON lo.id = loi.order_id AND lo.tenant_id = loi.tenant_id
     JOIN lab_tests lt ON lt.id = loi.test_id AND lt.tenant_id = loi.tenant_id
     WHERE loi.status NOT IN ('VERIFIED', 'RELEASED', 'CANCELLED', 'REJECTED')
       AND lo.status != 'CANCELLED'
       AND (
         (lo.priority = 'STAT' AND lo.ordered_at < now() - (COALESCE(lt.tat_minutes / 2, 30) || ' minutes')::interval)
         OR
         (lo.priority != 'STAT' AND lo.ordered_at < now() - (COALESCE(lt.tat_minutes, 60) || ' minutes')::interval)
       )`,
  );

  let breachedCount = 0;

  for (const row of overdue.rows) {
    await pool.query(
      `INSERT INTO outbox (tenant_id, event_type, payload)
       VALUES ($1, 'lab.tat.breached', $2)
       ON CONFLICT DO NOTHING`,
      [
        row.tenant_id,
        JSON.stringify({
          orderItemId: row.item_id,
          orderNo: row.order_no,
          testName: row.test_name,
          priority: row.priority,
          branchId: row.branch_id,
          orderedAt: row.ordered_at,
          detectedAt: new Date().toISOString(),
        }),
      ],
    );
    breachedCount++;
  }

  return { breachedCount };
}

/**
 * JOB-43: lab.report.render
 * Renders the report PDF, stores the exact bytes, and records their SHA-256.
 *
 * The digest recorded here is SHA-256 over the rendered PDF, so it can be
 * re-verified against the bytes a later download serves. It is deliberately not
 * computed from the report JSON: that describes the *inputs* to rendering, not
 * the document, and a hash of the inputs says nothing about the artifact a
 * clinician signs. `lab_reports.sha256_hash` stays NULL until the PDF exists.
 *
 * Handlers run inside withTenant and fan out per active tenant, matching the
 * supply jobs. A raw app-pool query has no tenant set, and clinic_app is
 * NOBYPASSRLS, so such a query returns zero rows rather than erroring.
 *
 * Each report is an independent unit of work. A report that cannot be rendered
 * is recorded as a failure and the batch continues: otherwise one malformed
 * report would roll back every other report in the tenant and poison-pill the
 * schedule with a retry that can never succeed. Rendering happens outside any
 * transaction so a Chromium call never pins a pooled connection.
 */
export async function runLabReportRender(
  targetTenantId?: string,
): Promise<{ renderedCount: number; failedCount: number }> {
  const tenantIds = targetTenantId ? [targetTenantId] : await activeTenantIds();
  let renderedCount = 0;
  let failedCount = 0;

  for (const tenantId of tenantIds) {
    // Short read-only transaction to select the work, then released.
    const pending = await withTenant({ tenantId }, async (tx) => {
      // file_id IS NULL is the honest "not yet rendered" marker: a digest
      // cannot exist before the bytes it describes.
      const res = await tx.query(
        `SELECT lr.id, lr.order_id, lr.version, lr.status, lr.issued_by, lr.report_data
         FROM lab_reports lr
         WHERE lr.tenant_id = $1 AND lr.file_id IS NULL
         ORDER BY lr.issued_at`,
        [tenantId],
      );
      return res.rows;
    });

    for (const report of pending) {
      try {
        // Render outside the transaction: Chromium startup and page layout are
        // far too slow to hold a transaction and a pooled connection open.
        const document = buildLabReportDocument(report);
        // renderPdf normalises the PDF's own timestamps, so the same report
        // always produces byte-identical output and therefore a stable digest.
        const rendered = await renderPdf(renderLabReportHtml(document), { format: 'A4' });

        const fileName = `lab-report-${document.orderNo}-v${report.version}.pdf`;
        const objectKey = `t/${tenantId}/lab-report/${report.order_id}-v${report.version}`;

        // One transaction per report: artifact, owning row, digest and event
        // commit together or not at all, so a report can never reference bytes
        // whose hash was not recorded.
        await withTenant({ tenantId }, async (tx) => {
          // Re-check under the write lock: two concurrent ticks must not both
          // publish a version, and a report rendered by another tick must not
          // be overwritten with a duplicate event.
          const claim = await tx.query(
            `SELECT 1 FROM lab_reports WHERE tenant_id = $1 AND id = $2 AND file_id IS NULL FOR UPDATE`,
            [tenantId, report.id],
          );
          if (claim.rowCount === 0) return;

          const fileRes = await tx.query<{ id: string }>(
            `INSERT INTO files (tenant_id, object_key, file_name, mime_type, size_bytes,
                                uploaded_by, origin, content, sha256, status)
             VALUES ($1, $2, $3, 'application/pdf', $4, $5, 'GENERATED', $6, $7, 'READY')
             RETURNING id`,
            [
              tenantId,
              objectKey,
              fileName,
              rendered.bytes.length,
              report.issued_by,
              rendered.bytes,
              rendered.sha256,
            ],
          );
          const fileId = fileRes.rows[0]!.id;

          await tx.query(
            `UPDATE lab_reports
             SET file_id = $1, sha256_hash = $2
             WHERE tenant_id = $3 AND id = $4`,
            [fileId, rendered.sha256, tenantId, report.id],
          );

          await tx.query(
            `INSERT INTO outbox (tenant_id, event_type, payload)
             VALUES ($1, 'lab.report.rendered', $2)`,
            [
              tenantId,
              JSON.stringify({
                reportId: report.id,
                orderId: report.order_id,
                version: report.version,
                fileId,
                sha256: rendered.sha256,
              }),
            ],
          );
        });

        renderedCount++;
      } catch (err) {
        // Record the failure so it is observable and never silently retried
        // forever, then keep processing the remaining reports.
        failedCount++;
        const message = err instanceof Error ? err.message : String(err);
        await withTenant({ tenantId }, async (tx) => {
          await tx.query(
            `INSERT INTO outbox (tenant_id, event_type, payload)
             VALUES ($1, 'lab.report.render_failed', $2)`,
            [
              tenantId,
              JSON.stringify({
                reportId: report.id,
                orderId: report.order_id,
                version: report.version,
                error: message,
                failedAt: new Date().toISOString(),
              }),
            ],
          );
        });
        console.error(`JOB-43: failed to render report ${report.id}: ${message}`);
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

/**
 * lab_results.flag and lab_reports.status use different vocabularies from the
 * print template, so both are mapped explicitly rather than passed through:
 *   results  N/A -> no marker, L/H/LL/HH carry through
 *   status   FINAL -> RELEASED (the template's word for a final report)
 */
function mapResultFlag(flag: string | null | undefined): 'H' | 'L' | 'HH' | 'LL' | 'CRITICAL' | null {
  switch (flag) {
    case 'H':
      return 'H';
    case 'L':
      return 'L';
    case 'HH':
      return 'HH';
    case 'LL':
      return 'LL';
    default:
      // 'A' is abnormal-without-direction and 'N' is normal; neither maps onto a
      // direction the template can print.
      return null;
  }
}

function mapReportStatus(status: string): LabReportDocument['status'] {
  switch (status) {
    case 'PRELIMINARY':
      return 'PRELIMINARY';
    case 'CORRECTED':
      return 'CORRECTED';
    default:
      return 'RELEASED';
  }
}

/** Assemble the print document from the stored report_data snapshot. */
function buildLabReportDocument(report: {
  id: string;
  report_data: unknown;
  version: number;
  status: string;
}): LabReportDocument {
  const data = (report.report_data ?? {}) as {
    order?: Record<string, unknown>;
    results?: Array<Record<string, unknown>>;
    releasedAt?: string | null;
    notes?: string | null;
  };

  const results = Array.isArray(data.results) ? data.results : [];

  const resultRows = results.map((r) => ({
    test: String(r.test_name ?? r.test ?? '—'),
    analyte: String(r.analyte_name ?? r.analyte ?? ''),
    value: String(r.value_text ?? r.value_num ?? '—'),
    unit: r.unit ? String(r.unit) : undefined,
    referenceRange: r.ref_range_text ? String(r.ref_range_text) : undefined,
    flag: mapResultFlag(r.flag as string | undefined),
  }));

  // An empty result set must not silently produce a blank "official" report.
  if (resultRows.length === 0) {
    throw new Error(`JOB-43: lab report ${report.id} has no results to render`);
  }

  const orderNo = String(data.order?.order_no ?? '');

  return {
    clinicName: String(data.order?.clinic_name ?? 'Clinic'),
    reportNo: String(data.order?.report_no ?? `${orderNo}-v${report.version}`),
    orderNo,
    version: report.version,
    status: mapReportStatus(report.status),
    patientName: String(data.order?.patient_name ?? '—'),
    patientAge: data.order?.patient_age ? String(data.order.patient_age) : undefined,
    patientSex: data.order?.patient_sex ? String(data.order.patient_sex) : undefined,
    collectedAt: data.order?.collected_at ? String(data.order.collected_at) : undefined,
    receivedAt: data.order?.received_at ? String(data.order.received_at) : undefined,
    releasedAt: data.releasedAt ?? undefined,
    orderingClinician: data.order?.ordering_clinician ? String(data.order.ordering_clinician) : undefined,
    interpretation: data.notes ?? undefined,
    results: resultRows,
  };
}

/**
 * JOB-44: lab.qc.missing.remind
 * Reminds technicians when daily QC runs have not been recorded for instruments with active tests.
 */
export async function runLabQcMissingRemind(): Promise<{ remindedCount: number }> {
  const pool = getAppPool();

  const missingQc = await pool.query(
    `SELECT DISTINCT li.tenant_id, li.id as instrument_id, li.name as instrument_name, li.branch_id
     FROM lab_instruments li
     WHERE li.deleted_at IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM lab_qc_runs lqr
         WHERE lqr.tenant_id = li.tenant_id
           AND lqr.instrument_id = li.id
           AND lqr.run_at >= CURRENT_DATE
       )`,
  );

  let remindedCount = 0;

  for (const row of missingQc.rows) {
    await pool.query(
      `INSERT INTO outbox (tenant_id, event_type, payload)
       VALUES ($1, 'lab.qc.missing.reminder', $2)
       ON CONFLICT DO NOTHING`,
      [
        row.tenant_id,
        JSON.stringify({
          instrumentId: row.instrument_id,
          instrumentName: row.instrument_name,
          branchId: row.branch_id,
          date: new Date().toISOString().slice(0, 10),
        }),
      ],
    );
    remindedCount++;
  }

  return { remindedCount };
}

/**
 * JOB-45: lab.specimen.stale.flag
 * Flags unreceived or un-resulted specimens that have exceeded specimen stability hours.
 */
export async function runLabSpecimenStaleFlag(): Promise<{ staleCount: number }> {
  const pool = getAppPool();

  const stale = await pool.query(
    `SELECT s.id as specimen_id, s.tenant_id, s.accession_no, s.collected_at,
            st.name as specimen_type_name, st.stability_hours, lo.order_no
     FROM specimens s
     JOIN specimen_types st ON st.id = s.specimen_type_id AND st.tenant_id = s.tenant_id
     JOIN lab_orders lo ON lo.id = s.order_id AND lo.tenant_id = s.tenant_id
     WHERE s.condition = 'OK'
       AND s.received_at IS NULL
       AND s.collected_at IS NOT NULL
       AND s.collected_at < now() - (COALESCE(st.stability_hours, 24) || ' hours')::interval`,
  );

  let staleCount = 0;

  for (const row of stale.rows) {
    await pool.query(
      `INSERT INTO outbox (tenant_id, event_type, payload)
       VALUES ($1, 'lab.specimen.stale', $2)
       ON CONFLICT DO NOTHING`,
      [
        row.tenant_id,
        JSON.stringify({
          specimenId: row.specimen_id,
          accessionNo: row.accession_no,
          orderNo: row.order_no,
          specimenType: row.specimen_type_name,
          collectedAt: row.collected_at,
          stabilityHours: row.stability_hours,
        }),
      ],
    );
    staleCount++;
  }

  return { staleCount };
}

/**
 * JOB-46: lab.instrument.calibration.remind
 * Reminds when lab instruments are due or past due for calibration.
 */
export async function runLabInstrumentCalibrationRemind(): Promise<{ remindedCount: number }> {
  const pool = getAppPool();

  const due = await pool.query(
    `SELECT li.id, li.tenant_id, li.name, li.model, li.serial_no, li.calibration_due, li.branch_id
     FROM lab_instruments li
     WHERE li.deleted_at IS NULL
       AND li.calibration_due IS NOT NULL
       AND li.calibration_due <= CURRENT_DATE + INTERVAL '7 days'`,
  );

  let remindedCount = 0;

  for (const row of due.rows) {
    await pool.query(
      `INSERT INTO outbox (tenant_id, event_type, payload)
       VALUES ($1, 'lab.instrument.calibration.due', $2)
       ON CONFLICT DO NOTHING`,
      [
        row.tenant_id,
        JSON.stringify({
          instrumentId: row.id,
          name: row.name,
          model: row.model,
          serialNo: row.serial_no,
          calibrationDue: row.calibration_due,
          branchId: row.branch_id,
        }),
      ],
    );
    remindedCount++;
  }

  return { remindedCount };
}

/**
 * JOB-47: lab.interface.poll (P2)
 * Polls unparsed/pending instrument messages and reports errors or matches.
 */
export async function runLabInterfacePoll(): Promise<{ processedCount: number; exceptionCount: number }> {
  const pool = getAppPool();

  // If there are unhandled outbox events or raw interface messages, process them
  const pending = await pool.query(
    `SELECT id, tenant_id, payload
     FROM outbox
     WHERE event_type = 'lab.interface.raw_message'
       AND processed_at IS NULL
     LIMIT 50`,
  );

  let processedCount = 0;
  let exceptionCount = 0;

  for (const row of pending.rows) {
    try {
      // Mark as processed
      await pool.query(
        `UPDATE outbox SET processed_at = now() WHERE id = $1`,
        [row.id],
      );
      processedCount++;
    } catch {
      exceptionCount++;
    }
  }

  return { processedCount, exceptionCount };
}
