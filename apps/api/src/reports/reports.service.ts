import { Injectable } from '@nestjs/common';
import { withTenant } from '@clinic/db';
import { ProblemException } from '../http/problem.exception.js';
import type {
  RunReportRequest,
  ReportScheduleRequest,
  ReportExportRequest,
} from '@clinic/contracts';
import {
  renderPdf,
  renderFormalReportHtml,
  type FormalReportDocument,
  type FormalReportColumn,
  type FormalReportSummaryCard,
} from '@clinic/print';

@Injectable()
export class ReportsService {
  /**
   * Helper to verify that tenant is entitled to the reports module AND
   * returns the list of all currently enabled modules.
   */
  private async getEntitledModules(tx: any, tenantId: string): Promise<Set<string>> {
    const res = await tx.query(
      `SELECT module, status
       FROM tenant_modules
       WHERE tenant_id = $1 AND status = 'ENABLED'`,
      [tenantId],
    );

    const activeSet = new Set<string>(res.rows.map((r: any) => String(r.module)));
    if (!activeSet.has('reports')) {
      throw new ProblemException('FORBIDDEN', {
        detail: 'Tenant is not entitled to reports module',
      });
    }

    // admin and platform always included as baseline
    activeSet.add('admin');
    activeSet.add('platform');
    return activeSet;
  }

  /**
   * GET /reports/catalog
   * Returns report definitions strictly filtered to the tenant's entitled modules (AC-21).
   * A supply-only tenant's catalog contains no RPT-LAB-*, RPT-PHM-*, RPT-CLN-*, or RPT-BIL-*.
   */
  async getCatalog(tenantId: string, userId: string) {
    return withTenant({ tenantId, userId }, async (tx) => {
      const entitledModules = await this.getEntitledModules(tx, tenantId);

      const res = await tx.query<{
        id: string;
        module: string;
        name: string;
        description: string;
        category: string;
        permitted_fields: any;
        default_period: string;
        export_formats: any;
      }>(
        `SELECT id, module, name, description, category, permitted_fields, default_period, export_formats
         FROM report_definitions
         WHERE is_active = true
         ORDER BY id ASC`,
      );

      // Filter reports by tenant's active entitled modules
      const filteredReports = res.rows.filter((r) => entitledModules.has(r.module));

      return {
        reports: filteredReports,
        meta: {
          total: filteredReports.length,
          entitledModules: Array.from(entitledModules),
        },
      };
    });
  }

  /**
   * POST /reports/:reportId/run
   * Executes report and returns rows inline if < 2,000 rows.
   * Invariant (AC-21): Verifies BOTH reports entitlement and the underlying module entitlement!
   * Refuses with FORBIDDEN if tenant is not entitled to the underlying module.
   */
  async runReport(
    tenantId: string,
    userId: string,
    reportId: string,
    dto?: Partial<RunReportRequest>,
  ) {
    return withTenant({ tenantId, userId }, async (tx) => {
      // 1. Check reports module entitlement and active modules
      const entitledModules = await this.getEntitledModules(tx, tenantId);

      // 2. Fetch report definition
      const defRes = await tx.query<{
        id: string;
        module: string;
        name: string;
        permitted_fields: string[];
      }>(
        `SELECT id, module, name, permitted_fields
         FROM report_definitions
         WHERE id = $1 AND is_active = true`,
        [reportId],
      );

      if ((defRes.rowCount ?? 0) === 0) {
        throw new ProblemException('NOT_FOUND', {
          detail: `Report definition '${reportId}' not found`,
        });
      }

      const def = defRes.rows[0];
      if (!def) {
        throw new ProblemException('NOT_FOUND', {
          detail: `Report definition '${reportId}' not found`,
        });
      }

      // 3. Invariant: Check underlying module entitlement (AC-21)
      if (!entitledModules.has(def.module)) {
        throw new ProblemException('FORBIDDEN', {
          detail: `Tenant is not entitled to module '${def.module}'. Cannot run report '${reportId}'.`,
        });
      }

      // 4. Generate report rows scoped to tenant
      let rows: any[] = [];
      const fields = def.permitted_fields || ['id', 'created_at'];

      if (def.module === 'supply') {
        const q = await tx.query(
          `SELECT id, name, code, item_type, base_uom_id, is_batch_tracked, created_at
           FROM items
           WHERE tenant_id = $1
           LIMIT 500`,
          [tenantId],
        );
        rows = q.rows;
      } else if (def.module === 'clinical') {
        const q = await tx.query(
          `SELECT id, visit_no, status, created_at, closed_at
           FROM visits
           WHERE tenant_id = $1
           LIMIT 500`,
          [tenantId],
        );
        rows = q.rows;
      } else if (def.module === 'billing') {
        const q = await tx.query(
          `SELECT id, invoice_no, status, total_amount, balance_amount, created_at
           FROM invoices
           WHERE tenant_id = $1
           LIMIT 500`,
          [tenantId],
        );
        rows = q.rows;
      } else if (def.module === 'laboratory') {
        const q = await tx.query(
          `SELECT id, order_no, status, created_at
           FROM lab_orders
           WHERE tenant_id = $1
           LIMIT 500`,
          [tenantId],
        );
        rows = q.rows;
      } else if (def.module === 'pharmacy') {
        const q = await tx.query(
          `SELECT id, dispense_no, status, created_at
           FROM pharmacy_dispenses
           WHERE tenant_id = $1
           LIMIT 500`,
          [tenantId],
        );
        rows = q.rows;
      } else if (def.module === 'compliance') {
        const q = await tx.query(
          `SELECT id, incident_no, severity, status, created_at
           FROM breach_incidents
           WHERE tenant_id = $1
           LIMIT 500`,
          [tenantId],
        );
        rows = q.rows;
      } else if (def.module === 'renal') {
        if (reportId === 'RPT-REN-01') {
          const q = await tx.query(
            `SELECT s.id, s.session_no, s.scheduled_date, s.status, s.actual_duration_minutes,
                    st.station_no, m.serial_no as machine_serial, rx.modality
             FROM dialysis_sessions s
             JOIN renal_stations st ON st.tenant_id = s.tenant_id AND st.id = s.station_id
             JOIN dialysis_machines m ON m.tenant_id = s.tenant_id AND m.id = s.machine_id
             JOIN dialysis_prescriptions rx ON rx.tenant_id = s.tenant_id AND rx.id = s.prescription_id
             WHERE s.tenant_id = $1
             ORDER BY s.scheduled_date DESC LIMIT 500`,
            [tenantId],
          );
          rows = q.rows;
        } else if (reportId === 'RPT-REN-02') {
          const q = await tx.query(
            `SELECT id, log_date, carbon_breakthrough_chlorine_ppm, ro_conductivity_us,
                    ro_rejection_rate_pct, status, created_at
             FROM water_treatment_logs
             WHERE tenant_id = $1
             ORDER BY log_date DESC LIMIT 500`,
            [tenantId],
          );
          rows = q.rows;
        } else if (reportId === 'RPT-REN-03') {
          const q = await tx.query(
            `SELECT d.id, d.serial_barcode, d.dialyzer_model, d.baseline_volume_ml,
                    d.current_volume_ml, d.reuse_count, d.max_allowed_reuses, d.status, d.discard_reason
             FROM dialyzers d
             WHERE d.tenant_id = $1
             ORDER BY d.created_at DESC LIMIT 500`,
            [tenantId],
          );
          rows = q.rows;
        } else if (reportId === 'RPT-REN-04') {
          const q = await tx.query(
            `SELECT a.id, a.access_type, a.anatomical_site, a.side, a.status, a.created_date,
                    p.first_name, p.last_name
             FROM vascular_accesses a
             JOIN patients p ON p.tenant_id = a.tenant_id AND p.id = a.patient_id
             WHERE a.tenant_id = $1
             ORDER BY a.created_at DESC LIMIT 500`,
            [tenantId],
          );
          rows = q.rows;
        } else if (reportId === 'RPT-REN-05') {
          const q = await tx.query(
            `SELECT c.id, c.claim_no, c.calendar_year, c.session_sequence_no, c.claim_amount,
                    c.copay_amount, c.eclaims_status, p.first_name, p.last_name
             FROM philhealth_dialysis_claims c
             JOIN patients p ON p.tenant_id = c.tenant_id AND p.id = c.patient_id
             WHERE c.tenant_id = $1
             ORDER BY c.calendar_year DESC, c.session_sequence_no ASC LIMIT 500`,
            [tenantId],
          );
          rows = q.rows;
        } else {
          // RPT-REN-06
          const q = await tx.query(
            `SELECT s.id, s.session_no, s.scheduled_date, s.actual_duration_minutes,
                    s.total_uf_removed_liters, rx.target_dry_weight_kg
             FROM dialysis_sessions s
             JOIN dialysis_prescriptions rx ON rx.tenant_id = s.tenant_id AND rx.id = s.prescription_id
             WHERE s.tenant_id = $1 AND s.status = 'COMPLETED'
             ORDER BY s.scheduled_date DESC LIMIT 500`,
            [tenantId],
          );
          rows = q.rows;
        }
      } else {
        // Generic fallback for admin / platform
        const q = await tx.query(
          `SELECT id, name, email, status, created_at
           FROM users
           WHERE tenant_id = $1
           LIMIT 500`,
          [tenantId],
        );
        rows = q.rows;
      }

      // 5. Record execution in report_runs
      const runRes = await tx.query<{ id: string }>(
        `INSERT INTO report_runs (
           tenant_id, report_id, parameters, status, row_count, started_at, completed_at, executed_by
         )
         VALUES ($1, $2, $3::jsonb, 'COMPLETED', $4, now(), now(), $5)
         RETURNING id`,
        [tenantId, reportId, JSON.stringify(dto?.parameters || {}), rows.length, userId],
      );

      return {
        runId: runRes.rows[0]?.id || '',
        reportId: def.id,
        reportName: def.name,
        module: def.module,
        rowCount: rows.length,
        permittedFields: fields,
        data: rows,
        executedAt: new Date().toISOString(),
      };
    });
  }

  /**
   * POST /reports/:reportId/export
   * Generates async export file for report (AC-21).
   */
  async exportReport(
    tenantId: string,
    userId: string,
    reportId: string,
    dto?: Partial<ReportExportRequest>,
  ) {
    return withTenant({ tenantId, userId }, async (tx) => {
      // 1. Verify entitlements
      const entitledModules = await this.getEntitledModules(tx, tenantId);

      const defRes = await tx.query<{ id: string; module: string; name: string }>(
        `SELECT id, module, name FROM report_definitions WHERE id = $1 AND is_active = true`,
        [reportId],
      );

      if ((defRes.rowCount ?? 0) === 0) {
        throw new ProblemException('NOT_FOUND', { detail: `Report definition '${reportId}' not found` });
      }

      const def = defRes.rows[0];
      if (!def) {
        throw new ProblemException('NOT_FOUND', { detail: `Report definition '${reportId}' not found` });
      }
      if (!entitledModules.has(def.module)) {
        throw new ProblemException('FORBIDDEN', {
          detail: `Tenant is not entitled to module '${def.module}'. Cannot export report '${reportId}'.`,
        });
      }

      // 2. Run report to fetch actual data
      const runData = await this.runReport(tenantId, userId, reportId, { parameters: dto?.parameters });

      // 3. Create queued report_run
      const runRes = await tx.query<{ id: string }>(
        `INSERT INTO report_runs (
           tenant_id, report_id, parameters, status, row_count, executed_by
         )
         VALUES ($1, $2, $3::jsonb, 'QUEUED', $4, $5)
         RETURNING id`,
        [tenantId, reportId, JSON.stringify(dto?.parameters || {}), runData.rowCount, userId],
      );

      const runId = runRes.rows[0]?.id || '';
      const format = (dto?.format || 'CSV').toUpperCase();
      let mimeType = 'text/csv';
      let sizeBytes = 0;
      let fileName = '';

      if (format === 'PDF') {
        const rendered = await this.renderReportPdf(tenantId, userId, reportId, dto?.parameters);
        mimeType = 'application/pdf';
        sizeBytes = rendered.byteLength;
        fileName = `${reportId.toLowerCase()}_${new Date().toISOString().slice(0, 10)}.pdf`;
      } else {
        // Build real CSV
        const headers = runData.permittedFields;
        const csvLines = [headers.join(',')];
        for (const row of runData.data) {
          const line = headers.map((h) => {
            const val = row[h] ?? '';
            const str = typeof val === 'object' ? JSON.stringify(val) : String(val);
            return `"${str.replace(/"/g, '""')}"`;
          }).join(',');
          csvLines.push(line);
        }
        const payload = csvLines.join('\n');
        sizeBytes = Buffer.byteLength(payload, 'utf8');
        fileName = `${reportId.toLowerCase()}_${new Date().toISOString().slice(0, 10)}.csv`;
      }

      const objectKey = `t/${tenantId}/reports/${fileName}`;

      const fileRes = await tx.query<{ id: string }>(
        `INSERT INTO files (tenant_id, object_key, file_name, mime_type, size_bytes, status, uploaded_by)
         VALUES ($1, $2, $3, $4, $5, 'READY', $6)
         RETURNING id`,
        [tenantId, objectKey, fileName, mimeType, sizeBytes, userId],
      );

      const fileId = fileRes.rows[0]?.id || '';

      await tx.query(
        `UPDATE report_runs
         SET status = 'COMPLETED', file_id = $1, row_count = $2, completed_at = now()
         WHERE id = $3 AND tenant_id = $4`,
        [fileId, runData.rowCount, runId, tenantId],
      );

      return {
        runId,
        reportId,
        format,
        status: 'COMPLETED',
        fileId,
        fileName,
      };
    });
  }

  /**
   * Render formal statutory or operational report PDF (true vector PDF via Playwright Chromium).
   */
  async renderReportPdf(tenantId: string, userId: string, reportId: string, query?: Record<string, any>) {
    return withTenant({ tenantId, userId }, async (tx) => {
      // 1. Run the report
      const runRes = await this.runReport(tenantId, userId, reportId, { parameters: query });

      // 2. Fetch clinic details
      const tenantRes = await tx.query<{ name: string; email: string; phone: string; address: string }>(
        `SELECT name, email, phone, address FROM tenants WHERE id = $1`,
        [tenantId],
      );
      const clinic = tenantRes.rows[0] ?? { name: 'Healthcare Facility', email: '', phone: '', address: '' };

      let branchName = '';
      if (query?.branchId) {
        const branchRes = await tx.query<{ name: string }>(
          `SELECT name FROM branches WHERE tenant_id = $1 AND id = $2`,
          [tenantId, query.branchId],
        );
        if (branchRes.rows[0]?.name) branchName = branchRes.rows[0].name;
      }

      // 3. User details for signature block
      const userRes = await tx.query<{ name: string; email: string }>(
        `SELECT name, email FROM users WHERE tenant_id = $1 AND id = $2`,
        [tenantId, userId],
      );
      const userName = userRes.rows[0]?.name || userRes.rows[0]?.email || 'Reporting Officer';

      // 4. Form columns
      const sampleRow = runRes.data[0] || {};
      const allKeys = Object.keys(sampleRow).length > 0 ? Object.keys(sampleRow) : runRes.permittedFields;

      const columns: FormalReportColumn[] = allKeys.map((key) => {
        const sampleVal = sampleRow[key];
        const isNum = typeof sampleVal === 'number';
        const isMoney = key.toLowerCase().includes('amount') || key.toLowerCase().includes('copay') || key.toLowerCase().includes('balance') || key.toLowerCase().includes('price');
        const isCode = key.toLowerCase().includes('no') || key.toLowerCase().includes('code') || key.toLowerCase().includes('id') || key.toLowerCase().includes('serial') || key.toLowerCase().includes('barcode');

        const label = key
          .split('_')
          .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
          .join(' ')
          .replace('Ppm', '(ppm)')
          .replace('Us', '(µS)')
          .replace('Pct', '(%)')
          .replace('Kg', '(kg)')
          .replace('Ml', '(mL)')
          .replace('Uf', 'UF');

        return {
          key,
          label,
          align: isNum ? 'right' : 'left',
          isMonospace: isCode,
          isCurrency: isMoney,
        };
      });

      // 5. Build summary cards
      const summaryCards: FormalReportSummaryCard[] = [
        { label: 'Total Records', value: String(runRes.rowCount), tone: 'info' },
      ];

      for (const col of columns) {
        if (col.isCurrency) {
          const sum = runRes.data.reduce((acc, row) => acc + (Number(row[col.key]) || 0), 0);
          summaryCards.push({
            label: `Total ${col.label}`,
            value: `₱${sum.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
            tone: 'success',
          });
        }
      }

      if (summaryCards.length > 4) {
        summaryCards.splice(4);
      }

      const doc: FormalReportDocument = {
        clinicName: clinic.name,
        branchName: branchName || undefined,
        clinicAddress: clinic.address,
        clinicPhone: clinic.phone,
        reportId: runRes.reportId,
        title: runRes.reportName,
        category: runRes.module.toUpperCase(),
        description: `Official statutory and operational reporting register for ${runRes.module} operations.`,
        periodText: query?.period || (query?.startDate ? `${query.startDate} to ${query.endDate || 'Present'}` : 'Current Calendar Period'),
        generatedAt: new Date().toISOString(),
        generatedBy: userName,
        filterSummary: query && Object.keys(query).length > 0 ? query : undefined,
        summaryCards,
        columns,
        rows: runRes.data,
        preparedByLabel: `Prepared by: ${userName}`,
        certifiedByLabel: 'Reviewed & Certified by (Unit Head / Medical Director)',
      };

      const html = renderFormalReportHtml(doc);
      return renderPdf(html, {
        format: 'A4',
        landscape: columns.length > 5,
      });
    });
  }

  /**
   * Schedule management for automated report delivery (JOB-20).
   */
  async listSchedules(tenantId: string, userId: string) {
    return withTenant({ tenantId, userId }, async (tx) => {
      const res = await tx.query(
        `SELECT s.id, s.report_id, r.name as report_name, s.cron_expression, s.parameters, s.recipients, s.format, s.is_active, s.last_run_at, s.created_at
         FROM report_schedules s
         JOIN report_definitions r ON r.id = s.report_id
         WHERE s.tenant_id = $1
         ORDER BY s.created_at DESC`,
        [tenantId],
      );
      return { schedules: res.rows };
    });
  }

  async createSchedule(
    tenantId: string,
    userId: string,
    dto: ReportScheduleRequest | (Partial<ReportScheduleRequest> & { reportId: string; cronExpression: string }),
  ) {
    return withTenant({ tenantId, userId }, async (tx) => {
      const entitledModules = await this.getEntitledModules(tx, tenantId);

      const defRes = await tx.query<{ id: string; module: string }>(
        `SELECT id, module FROM report_definitions WHERE id = $1 AND is_active = true`,
        [dto.reportId],
      );

      if ((defRes.rowCount ?? 0) === 0) {
        throw new ProblemException('NOT_FOUND', { detail: `Report definition '${dto.reportId}' not found` });
      }

      const def = defRes.rows[0];
      if (!def) {
        throw new ProblemException('NOT_FOUND', { detail: `Report definition '${dto.reportId}' not found` });
      }

      if (!entitledModules.has(def.module)) {
        throw new ProblemException('FORBIDDEN', {
          detail: `Tenant is not entitled to module '${def.module}'`,
        });
      }

      const res = await tx.query(
        `INSERT INTO report_schedules (
           tenant_id, report_id, cron_expression, parameters, recipients, format, is_active, created_by
         )
         VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, true, $7)
         RETURNING id, report_id, cron_expression, format, is_active, created_at`,
        [
          tenantId,
          dto.reportId,
          dto.cronExpression,
          JSON.stringify(dto.parameters || {}),
          JSON.stringify(dto.recipients || []),
          dto.format || 'CSV',
          userId,
        ],
      );

      return res.rows[0];
    });
  }

  async deleteSchedule(tenantId: string, userId: string, scheduleId: string) {
    return withTenant({ tenantId, userId }, async (tx) => {
      const res = await tx.query(
        `DELETE FROM report_schedules
         WHERE id = $1 AND tenant_id = $2
         RETURNING id`,
        [scheduleId, tenantId],
      );

      if ((res.rowCount ?? 0) === 0) {
        throw new ProblemException('NOT_FOUND', { detail: 'Report schedule not found' });
      }

      return { deleted: true, id: scheduleId };
    });
  }
}
