import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { withTenant, type PoolClient } from '@clinic/db';
import { ProblemException } from '../http/problem.exception.js';
import type {
  CreateConsentTemplateRequest,
  CreatePatientConsentRequest,
  CreateDsrRequest,
  VerifyDsrIdentityRequest,
  CompleteDsrRequest,
  RejectDsrRequest,
  ExtendDsrRequest,
  CreateBreachRequest,
  AssessBreachRequest,
  NotifyBreachRequest,
  CloseBreachRequest,
  CreateRetentionPolicyRequest,
  UpdateRetentionPolicyRequest,
  CreateLegalHoldRequest,
  ReleaseLegalHoldRequest,
  ApproveRetentionCandidatesRequest,
  HoldRetentionCandidatesRequest,
  CreateAccessReviewRequest,
  RecordAccessReviewDecisionRequest,
  CreatePidsrCaseRequest,
  UpdatePidsrCaseRequest,
} from '@clinic/contracts';

@Injectable()
export class ComplianceService {
  // ── 1. Audit Explorer (§12.1, CMP-T4) ─────────────────────────────────────

  async listAuditLogs(
    tenantId: string,
    filters: {
      actorId?: string;
      entityType?: string;
      entityId?: string;
      action?: string;
      actingAsPlatform?: boolean;
      since?: string;
      until?: string;
      limit?: number;
    } = {},
  ) {
    return withTenant({ tenantId }, async (tx) => {
      const conditions: string[] = ['tenant_id = $1'];
      const params: any[] = [tenantId];

      if (filters.actorId) {
        params.push(filters.actorId);
        conditions.push(`actor_id = $${params.length}`);
      }
      if (filters.entityType) {
        params.push(filters.entityType);
        conditions.push(`entity_type = $${params.length}`);
      }
      if (filters.entityId) {
        params.push(filters.entityId);
        conditions.push(`entity_id = $${params.length}`);
      }
      if (filters.action) {
        params.push(filters.action);
        conditions.push(`action = $${params.length}`);
      }
      if (filters.actingAsPlatform !== undefined) {
        params.push(filters.actingAsPlatform);
        conditions.push(`acting_as_platform = $${params.length}`);
      }
      if (filters.since) {
        params.push(new Date(filters.since));
        conditions.push(`created_at >= $${params.length}`);
      }
      if (filters.until) {
        params.push(new Date(filters.until));
        conditions.push(`created_at <= $${params.length}`);
      }

      const limit = Math.min(filters.limit || 50, 200);
      params.push(limit);

      const res = await tx.query(
        `SELECT id, tenant_id, created_at, actor_id, acting_as_platform,
                breakglass_id, action, entity_type, entity_id, before_state,
                after_state, request_id, ip_address, user_agent, prev_hash, row_hash
         FROM audit_log
         WHERE ${conditions.join(' AND ')}
         ORDER BY created_at DESC
         LIMIT $${params.length}`,
        params,
      );

      return res.rows;
    });
  }

  async getAuditLogById(tenantId: string, id: string) {
    return withTenant({ tenantId }, async (tx) => {
      const res = await tx.query(
        `SELECT id, tenant_id, created_at, actor_id, acting_as_platform,
                breakglass_id, action, entity_type, entity_id, before_state,
                after_state, request_id, ip_address, user_agent, prev_hash, row_hash
         FROM audit_log
         WHERE tenant_id = $1 AND id = $2`,
        [tenantId, id],
      );
      if (res.rows.length === 0) {
        throw new ProblemException('NOT_FOUND', { detail: 'Audit record not found' });
      }
      return res.rows[0];
    });
  }

  // ── 2. PHI Access Log (§12.1) ─────────────────────────────────────────────

  async listPhiAccessLogs(
    tenantId: string,
    filters: {
      patientId?: string;
      actorId?: string;
      resource?: string;
      anomalyOnly?: boolean;
      since?: string;
      until?: string;
      limit?: number;
    } = {},
  ) {
    return withTenant({ tenantId }, async (tx) => {
      const conditions: string[] = ['tenant_id = $1'];
      const params: any[] = [tenantId];

      if (filters.patientId) {
        params.push(filters.patientId);
        conditions.push(`patient_id = $${params.length}`);
      }
      if (filters.actorId) {
        params.push(filters.actorId);
        conditions.push(`actor_id = $${params.length}`);
      }
      if (filters.resource) {
        params.push(filters.resource);
        conditions.push(`resource = $${params.length}`);
      }
      if (filters.since) {
        params.push(new Date(filters.since));
        conditions.push(`created_at >= $${params.length}`);
      }
      if (filters.until) {
        params.push(new Date(filters.until));
        conditions.push(`created_at <= $${params.length}`);
      }
      if (filters.anomalyOnly) {
        // Anomaly: off-hours access (before 07:00 or after 20:00 Manila time) or DSR exports
        conditions.push(`(EXTRACT(HOUR FROM created_at AT TIME ZONE 'Asia/Manila') < 7 OR EXTRACT(HOUR FROM created_at AT TIME ZONE 'Asia/Manila') >= 20 OR resource = 'DSR_EXPORT')`);
      }

      const limit = Math.min(filters.limit || 50, 200);
      params.push(limit);

      const res = await tx.query(
        `SELECT id, tenant_id, created_at, actor_id, patient_id, resource, purpose, request_id, ip_address, user_agent
         FROM phi_access_log
         WHERE ${conditions.join(' AND ')}
         ORDER BY created_at DESC
         LIMIT $${params.length}`,
        params,
      );

      return res.rows;
    });
  }

  // ── 3. Consent Management (§12.1, §18.10) ──────────────────────────────────

  async listConsentTemplates(tenantId: string, locale?: string) {
    return withTenant({ tenantId }, async (tx) => {
      const conditions = ['tenant_id = $1'];
      const params: any[] = [tenantId];
      if (locale) {
        params.push(locale);
        conditions.push(`locale = $${params.length}`);
      }
      const res = await tx.query(
        `SELECT id, tenant_id, version, title, body, purposes, locale, effective_from, status, created_at
         FROM consent_templates
         WHERE ${conditions.join(' AND ')}
         ORDER BY locale ASC, version DESC`,
        params,
      );
      return res.rows;
    });
  }

  async createConsentTemplate(tenantId: string, req: CreateConsentTemplateRequest, actorId: string) {
    return withTenant({ tenantId }, async (tx) => {
      const vRes = await tx.query<{ max_v: number }>(
        `SELECT COALESCE(MAX(version), 0) AS max_v FROM consent_templates WHERE tenant_id = $1 AND locale = $2`,
        [tenantId, req.locale],
      );
      const nextVersion = (vRes.rows[0]?.max_v || 0) + 1;

      const res = await tx.query(
        `INSERT INTO consent_templates (tenant_id, version, title, body, purposes, locale, status, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [
          tenantId,
          nextVersion,
          req.title,
          req.body,
          JSON.stringify(req.purposes || []),
          req.locale || 'en',
          req.status || 'DRAFT',
          actorId,
        ],
      );
      return res.rows[0];
    });
  }

  async publishConsentTemplate(tenantId: string, templateId: string, actorId: string) {
    return withTenant({ tenantId }, async (tx) => {
      const res = await tx.query(
        `UPDATE consent_templates
         SET status = 'PUBLISHED', effective_from = now(), updated_at = now(), updated_by = $1
         WHERE tenant_id = $2 AND id = $3
         RETURNING *`,
        [actorId, tenantId, templateId],
      );
      if (res.rows.length === 0) {
        throw new ProblemException('NOT_FOUND', { detail: 'Consent template not found' });
      }
      return res.rows[0];
    });
  }

  async getPatientConsents(tenantId: string, patientId: string) {
    return withTenant({ tenantId }, async (tx) => {
      const res = await tx.query(
        `SELECT pc.id, pc.tenant_id, pc.patient_id, pc.template_id, pc.template_version,
                pc.status, pc.signed_at, pc.signed_by_name, pc.relationship, pc.signature_data,
                pc.withdrawn_at AS revoked_at, pc.revoked_reason, pc.created_at,
                ct.title AS template_title, ct.purposes AS template_purposes
         FROM patient_consents pc
         LEFT JOIN consent_templates ct ON ct.tenant_id = pc.tenant_id AND ct.id = pc.template_id
         WHERE pc.tenant_id = $1 AND pc.patient_id = $2
         ORDER BY pc.signed_at DESC`,
        [tenantId, patientId],
      );
      return res.rows;
    });
  }

  async recordPatientConsent(tenantId: string, req: CreatePatientConsentRequest, actorId: string) {
    return withTenant({ tenantId }, async (tx) => {
      const tRes = await tx.query(
        `SELECT id, version, title, status FROM consent_templates WHERE tenant_id = $1 AND id = $2`,
        [tenantId, req.templateId],
      );
      if (tRes.rows.length === 0) {
        throw new ProblemException('NOT_FOUND', { detail: 'Consent template not found' });
      }

      const template = tRes.rows[0];
      const res = await tx.query(
        `INSERT INTO patient_consents (
           tenant_id, patient_id, template_id, template_version, status,
           signed_at, signed_by_name, relationship, signature_data
         )
         VALUES ($1, $2, $3, $4, 'GRANTED', now(), $5, $6, $7)
         RETURNING *`,
        [
          tenantId,
          req.patientId,
          template.id,
          template.version,
          req.signedByName,
          req.relationship || 'SELF',
          req.signatureData || null,
        ],
      );

      // Log PHI consent capture
      await tx.query(
        `INSERT INTO phi_access_log (tenant_id, actor_id, patient_id, resource, purpose)
         VALUES ($1, $2, $3, 'PATIENT_CONSENT', 'CONSENT_RECORDED')`,
        [tenantId, actorId, req.patientId],
      );

      return res.rows[0];
    });
  }

  async revokePatientConsent(tenantId: string, id: string, reason: string, actorId: string) {
    return withTenant({ tenantId }, async (tx) => {
      const res = await tx.query(
        `UPDATE patient_consents
         SET status = 'REVOKED', withdrawn_at = now(), revoked_reason = $1
         WHERE tenant_id = $2 AND id = $3
         RETURNING id, tenant_id, patient_id, status, withdrawn_at AS revoked_at, revoked_reason`,
        [reason, tenantId, id],
      );
      if (res.rows.length === 0) {
        throw new ProblemException('NOT_FOUND', { detail: 'Patient consent not found' });
      }

      await tx.query(
        `INSERT INTO phi_access_log (tenant_id, actor_id, patient_id, resource, purpose)
         VALUES ($1, $2, $3, 'PATIENT_CONSENT', 'CONSENT_REVOKED')`,
        [tenantId, actorId, res.rows[0].patient_id],
      );

      return res.rows[0];
    });
  }

  // ── 4. Data Subject Requests (DSR - AC-15, CMP-T1) ─────────────────────────

  async listDsrRequests(tenantId: string, filters: { status?: string; type?: string } = {}) {
    return withTenant({ tenantId }, async (tx) => {
      const conditions = ['d.tenant_id = $1'];
      const params: any[] = [tenantId];
      if (filters.status) {
        params.push(filters.status);
        conditions.push(`d.status = $${params.length}`);
      }
      if (filters.type) {
        params.push(filters.type);
        conditions.push(`d.type = $${params.length}`);
      }

      const res = await tx.query(
        `SELECT d.*, p.first_name, p.last_name,
                COALESCE((SELECT pi.value FROM patient_identifiers pi WHERE pi.tenant_id = p.tenant_id AND pi.patient_id = p.id LIMIT 1), p.id) AS patient_no,
                u.name AS handled_by_name
         FROM data_subject_requests d
         JOIN patients p ON p.tenant_id = d.tenant_id AND p.id = d.patient_id
         LEFT JOIN users u ON u.tenant_id = d.tenant_id AND u.id = d.handled_by
         WHERE ${conditions.join(' AND ')}
         ORDER BY d.due_at ASC`,
        params,
      );
      return res.rows;
    });
  }

  async getDsrRequest(tenantId: string, id: string) {
    return withTenant({ tenantId }, async (tx) => {
      const res = await tx.query(
        `SELECT d.*, p.first_name, p.last_name,
                COALESCE((SELECT pi.value FROM patient_identifiers pi WHERE pi.tenant_id = p.tenant_id AND pi.patient_id = p.id LIMIT 1), p.id) AS patient_no,
                u.name AS handled_by_name
         FROM data_subject_requests d
         JOIN patients p ON p.tenant_id = d.tenant_id AND p.id = d.patient_id
         LEFT JOIN users u ON u.tenant_id = d.tenant_id AND u.id = d.handled_by
         WHERE d.tenant_id = $1 AND d.id = $2`,
        [tenantId, id],
      );
      if (res.rows.length === 0) {
        throw new ProblemException('NOT_FOUND', { detail: 'DSR request not found' });
      }
      return res.rows[0];
    });
  }

  async createDsrRequest(tenantId: string, req: CreateDsrRequest, actorId: string) {
    return withTenant({ tenantId }, async (tx) => {
      const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      const seqRes = await tx.query<{ count: string }>(
        `SELECT COUNT(*) AS count FROM data_subject_requests WHERE tenant_id = $1`,
        [tenantId],
      );
      const seq = String(parseInt(seqRes.rows[0]?.count || '0', 10) + 1).padStart(4, '0');
      const requestNo = `DSR-${dateStr}-${seq}`;

      const dueDays = req.dueDays || 30;
      const dueAt = new Date(Date.now() + dueDays * 24 * 3600 * 1000);

      const res = await tx.query(
        `INSERT INTO data_subject_requests (
           tenant_id, patient_id, request_no, type, status, due_at,
           identity_notes, handled_by, created_at, updated_at
         )
         VALUES ($1, $2, $3, $4, 'RECEIVED', $5, $6, $7, now(), now())
         RETURNING *`,
        [
          tenantId,
          req.patientId,
          requestNo,
          req.type,
          dueAt,
          req.identityNotes || null,
          actorId,
        ],
      );

      // Log PHI DSR intake
      await tx.query(
        `INSERT INTO phi_access_log (tenant_id, actor_id, patient_id, resource, purpose)
         VALUES ($1, $2, $3, 'DSR_REQUEST', 'DSR_INTAKE')`,
        [tenantId, actorId, req.patientId],
      );

      return res.rows[0];
    });
  }

  async verifyDsrIdentity(tenantId: string, id: string, req: VerifyDsrIdentityRequest, actorId: string) {
    return withTenant({ tenantId }, async (tx) => {
      const res = await tx.query(
        `UPDATE data_subject_requests
         SET identity_verified = true, identity_verified_at = now(),
             identity_notes = COALESCE(identity_notes || E'\n' || $1, $1),
             status = 'VERIFYING', handled_by = $2, updated_at = now()
         WHERE tenant_id = $3 AND id = $4
         RETURNING *`,
        [req.identityNotes, actorId, tenantId, id],
      );
      if (res.rows.length === 0) {
        throw new ProblemException('NOT_FOUND', { detail: 'DSR request not found' });
      }
      return res.rows[0];
    });
  }

  async startDsrProcessing(tenantId: string, id: string, actorId: string) {
    return withTenant({ tenantId }, async (tx) => {
      const curr = await tx.query(
        `SELECT id, identity_verified FROM data_subject_requests WHERE tenant_id = $1 AND id = $2`,
        [tenantId, id],
      );
      if (curr.rows.length === 0) {
        throw new ProblemException('NOT_FOUND', { detail: 'DSR request not found' });
      }
      if (!curr.rows[0].identity_verified) {
        throw new ProblemException('VALIDATION_FAILED', {
          detail: 'Cannot start processing DSR before identity verification is complete.',
        });
      }

      const res = await tx.query(
        `UPDATE data_subject_requests
         SET status = 'IN_PROGRESS', handled_by = $1, updated_at = now()
         WHERE tenant_id = $2 AND id = $3
         RETURNING *`,
        [actorId, tenantId, id],
      );
      return res.rows[0];
    });
  }

  async completeDsr(tenantId: string, id: string, req: CompleteDsrRequest, actorId: string) {
    return withTenant({ tenantId }, async (tx) => {
      const res = await tx.query(
        `UPDATE data_subject_requests
         SET status = 'COMPLETED', outcome_note = $1, handled_by = $2, updated_at = now()
         WHERE tenant_id = $3 AND id = $4
         RETURNING *`,
        [req.outcomeNote, actorId, tenantId, id],
      );
      if (res.rows.length === 0) {
        throw new ProblemException('NOT_FOUND', { detail: 'DSR request not found' });
      }
      return res.rows[0];
    });
  }

  async rejectDsr(tenantId: string, id: string, req: RejectDsrRequest, actorId: string) {
    return withTenant({ tenantId }, async (tx) => {
      const res = await tx.query(
        `UPDATE data_subject_requests
         SET status = 'REJECTED', rejection_reason = $1, handled_by = $2, updated_at = now()
         WHERE tenant_id = $3 AND id = $4
         RETURNING *`,
        [req.rejectionReason, actorId, tenantId, id],
      );
      if (res.rows.length === 0) {
        throw new ProblemException('NOT_FOUND', { detail: 'DSR request not found' });
      }
      return res.rows[0];
    });
  }

  async extendDsr(tenantId: string, id: string, req: ExtendDsrRequest, actorId: string) {
    return withTenant({ tenantId }, async (tx) => {
      const res = await tx.query(
        `UPDATE data_subject_requests
         SET due_at = due_at + ($1 || ' days')::interval,
             outcome_note = COALESCE(outcome_note || E'\n' || $2, $2),
             handled_by = $3, updated_at = now()
         WHERE tenant_id = $4 AND id = $5
         RETURNING *`,
        [req.extensionDays, `Extended by ${req.extensionDays} days: ${req.reason}`, actorId, tenantId, id],
      );
      if (res.rows.length === 0) {
        throw new ProblemException('NOT_FOUND', { detail: 'DSR request not found' });
      }
      return res.rows[0];
    });
  }

  /**
   * Discharges AC-15: Export of patient records contains exactly one patient's records
   * and the access is audited in phi_access_log.
   */
  async exportPatientData(tenantId: string, dsrId: string, actorId: string, ipAddress?: string, userAgent?: string) {
    return withTenant({ tenantId }, async (tx) => {
      // 1. Resolve DSR and ensure it belongs to this tenant
      const dsrRes = await tx.query(
        `SELECT id, patient_id, request_no, type, status FROM data_subject_requests WHERE tenant_id = $1 AND id = $2`,
        [tenantId, dsrId],
      );
      if (dsrRes.rows.length === 0) {
        throw new ProblemException('NOT_FOUND', { detail: 'DSR request not found' });
      }
      const dsr = dsrRes.rows[0];
      const patientId = dsr.patient_id;

      // 2. Fetch patient demographics
      const patientRes = await tx.query(
        `SELECT id, tenant_id, first_name, last_name, middle_name, date_of_birth, gender, status, created_at,
                (SELECT pi.value FROM patient_identifiers pi WHERE pi.tenant_id = patients.tenant_id AND pi.patient_id = patients.id LIMIT 1) AS patient_no
         FROM patients
         WHERE tenant_id = $1 AND id = $2`,
        [tenantId, patientId],
      );
      if (patientRes.rows.length === 0) {
        throw new ProblemException('NOT_FOUND', { detail: 'Patient record not found' });
      }
      const patient = patientRes.rows[0];

      // 3. Fetch consents
      const consents = await tx.query(
        `SELECT id, template_id, template_version, status, signed_at, signed_by_name, relationship
         FROM patient_consents
         WHERE tenant_id = $1 AND patient_id = $2`,
        [tenantId, patientId],
      );

      // 4. Fetch clinical visits
      const visits = await tx.query(
        `SELECT id, visit_no, branch_id, status, chief_complaint, opened_at, closed_at
         FROM visits
         WHERE tenant_id = $1 AND patient_id = $2`,
        [tenantId, patientId],
      );

      // 5. Fetch vitals
      const vitals = await tx.query(
        `SELECT v.id, v.visit_id, v.bp_sys, v.bp_dia, v.heart_rate, v.temperature_c, v.spo2, v.recorded_at
         FROM vitals v
         JOIN visits vs ON vs.tenant_id = v.tenant_id AND vs.id = v.visit_id
         WHERE v.tenant_id = $1 AND vs.patient_id = $2`,
        [tenantId, patientId],
      );

      // 6. Fetch prescriptions
      const prescriptions = await tx.query(
        `SELECT id, rx_no, visit_id, status, is_controlled, issued_at
         FROM prescriptions
         WHERE tenant_id = $1 AND patient_id = $2`,
        [tenantId, patientId],
      );

      // 7. Fetch lab orders
      const labOrders = await tx.query(
        `SELECT id, order_no, priority, status, ordered_at
         FROM lab_orders
         WHERE tenant_id = $1 AND patient_id = $2`,
        [tenantId, patientId],
      );

      // 8. Fetch invoices
      const invoices = await tx.query(
        `SELECT id, invoice_no, total AS total_amount, balance AS balance_amount, status, created_at
         FROM invoices
         WHERE tenant_id = $1 AND patient_id = $2`,
        [tenantId, patientId],
      );

      // 9. AUDITED: write phi_access_log entry (AC-15 compliance)
      await tx.query(
        `INSERT INTO phi_access_log (tenant_id, actor_id, patient_id, resource, purpose, ip_address, user_agent)
         VALUES ($1, $2, $3, 'DSR_EXPORT', 'DATA_SUBJECT_REQUEST_EXPORT', $4, $5)`,
        [tenantId, actorId, patientId, ipAddress || null, userAgent || null],
      );

      // 10. Assemble isolated export bundle
      return {
        exportMetadata: {
          dsrId: dsr.id,
          requestNo: dsr.request_no,
          exportedAt: new Date().toISOString(),
          exportedBy: actorId,
          patientId: patient.id,
          tenantId: tenantId,
          recordCount: {
            consents: consents.rows.length,
            visits: visits.rows.length,
            vitals: vitals.rows.length,
            prescriptions: prescriptions.rows.length,
            labOrders: labOrders.rows.length,
            invoices: invoices.rows.length,
          },
        },
        patient,
        consents: consents.rows,
        clinicalVisits: visits.rows,
        vitals: vitals.rows,
        prescriptions: prescriptions.rows,
        labOrders: labOrders.rows,
        billingInvoices: invoices.rows,
      };
    });
  }

  // ── 5. Breach Management (§12.1, CMP-T2, Q-2) ──────────────────────────────

  async listBreaches(tenantId: string, filters: { status?: string; severity?: string } = {}) {
    return withTenant({ tenantId }, async (tx) => {
      const conditions = ['tenant_id = $1'];
      const params: any[] = [tenantId];
      if (filters.status) {
        params.push(filters.status);
        conditions.push(`status = $${params.length}`);
      }
      if (filters.severity) {
        params.push(filters.severity);
        conditions.push(`severity = $${params.length}`);
      }
      const res = await tx.query(
        `SELECT * FROM breach_incidents
         WHERE ${conditions.join(' AND ')}
         ORDER BY detected_at DESC`,
        params,
      );
      return res.rows;
    });
  }

  async getBreach(tenantId: string, id: string) {
    return withTenant({ tenantId }, async (tx) => {
      const res = await tx.query(
        `SELECT * FROM breach_incidents WHERE tenant_id = $1 AND id = $2`,
        [tenantId, id],
      );
      if (res.rows.length === 0) {
        throw new ProblemException('NOT_FOUND', { detail: 'Breach incident not found' });
      }
      return res.rows[0];
    });
  }

  async createBreach(tenantId: string, req: CreateBreachRequest, actorId: string) {
    return withTenant({ tenantId }, async (tx) => {
      const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      const seqRes = await tx.query<{ count: string }>(
        `SELECT COUNT(*) AS count FROM breach_incidents WHERE tenant_id = $1`,
        [tenantId],
      );
      const seq = String(parseInt(seqRes.rows[0]?.count || '0', 10) + 1).padStart(4, '0');
      const incidentNo = `BRC-${dateStr}-${seq}`;

      const deadlineHours = req.deadlineHours || 72; // Default 72h per Q-2
      const deadlineAt = new Date(Date.now() + deadlineHours * 3600 * 1000);

      const res = await tx.query(
        `INSERT INTO breach_incidents (
           tenant_id, incident_no, detected_at, description, severity,
           data_classes, affected_count, status, notify_regulator_due_at,
           created_at, updated_at
         )
         VALUES ($1, $2, now(), $3, $4, $5, $6, 'DETECTED', $7, now(), now())
         RETURNING *`,
        [
          tenantId,
          incidentNo,
          req.description,
          req.severity || 'MEDIUM',
          req.dataClasses || [],
          req.affectedCount || 0,
          deadlineAt,
        ],
      );

      // Record security event
      await tx.query(
        `INSERT INTO security_events (tenant_id, event_type, severity, actor_id, detail)
         VALUES ($1, 'SECURITY_ANOMALY', $2, $3, $4)`,
        [
          tenantId,
          req.severity === 'CRITICAL' ? 'CRITICAL' : 'WARNING',
          actorId,
          JSON.stringify({ incidentNo, description: req.description, affectedCount: req.affectedCount }),
        ],
      );

      return res.rows[0];
    });
  }

  async assessBreach(tenantId: string, id: string, req: AssessBreachRequest, actorId: string) {
    return withTenant({ tenantId }, async (tx) => {
      const res = await tx.query(
        `UPDATE breach_incidents
         SET severity = $1, affected_count = $2, data_classes = $3,
             corrective_actions = COALESCE($4, corrective_actions),
             status = 'ASSESSED', updated_at = now()
         WHERE tenant_id = $5 AND id = $6
         RETURNING *`,
        [req.severity, req.affectedCount, req.dataClasses, req.correctiveActions || null, tenantId, id],
      );
      if (res.rows.length === 0) {
        throw new ProblemException('NOT_FOUND', { detail: 'Breach incident not found' });
      }
      return res.rows[0];
    });
  }

  async recordBreachNotification(tenantId: string, id: string, req: NotifyBreachRequest, actorId: string) {
    return withTenant({ tenantId }, async (tx) => {
      const res = await tx.query(
        `UPDATE breach_incidents
         SET notified_regulator = $1, notified_subjects = $2, notified_at = now(),
             status = 'NOTIFIED', updated_at = now()
         WHERE tenant_id = $3 AND id = $4
         RETURNING *`,
        [req.notifiedRegulator, req.notifiedSubjects, tenantId, id],
      );
      if (res.rows.length === 0) {
        throw new ProblemException('NOT_FOUND', { detail: 'Breach incident not found' });
      }
      return res.rows[0];
    });
  }

  async closeBreach(tenantId: string, id: string, req: CloseBreachRequest, actorId: string) {
    return withTenant({ tenantId }, async (tx) => {
      const res = await tx.query(
        `UPDATE breach_incidents
         SET corrective_actions = $1, lessons_learned = $2,
             closed_at = now(), closed_by = $3, status = 'CLOSED', updated_at = now()
         WHERE tenant_id = $4 AND id = $5
         RETURNING *`,
        [req.correctiveActions, req.lessonsLearned, actorId, tenantId, id],
      );
      if (res.rows.length === 0) {
        throw new ProblemException('NOT_FOUND', { detail: 'Breach incident not found' });
      }
      return res.rows[0];
    });
  }

  // ── 6. Retention Policies & Legal Holds (CMP-T1/T5, JOB-15) ─────────────────

  async listRetentionPolicies(tenantId: string) {
    return withTenant({ tenantId }, async (tx) => {
      const res = await tx.query(
        `SELECT * FROM retention_policies WHERE tenant_id = $1 ORDER BY record_class ASC`,
        [tenantId],
      );
      return res.rows;
    });
  }

  async createRetentionPolicy(tenantId: string, req: CreateRetentionPolicyRequest, actorId: string) {
    return withTenant({ tenantId }, async (tx) => {
      const res = await tx.query(
        `INSERT INTO retention_policies (tenant_id, record_class, retention_years, action, legal_basis)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (tenant_id, record_class) DO UPDATE
         SET retention_years = EXCLUDED.retention_years,
             action = EXCLUDED.action,
             legal_basis = EXCLUDED.legal_basis,
             updated_at = now()
         RETURNING *`,
        [tenantId, req.recordClass, req.retentionYears, req.action || 'ARCHIVE', req.legalBasis],
      );
      return res.rows[0];
    });
  }

  async updateRetentionPolicy(tenantId: string, id: string, req: UpdateRetentionPolicyRequest, actorId: string) {
    return withTenant({ tenantId }, async (tx) => {
      const fields: string[] = ['updated_at = now()'];
      const params: any[] = [tenantId, id];

      if (req.retentionYears !== undefined) {
        params.push(req.retentionYears);
        fields.push(`retention_years = $${params.length}`);
      }
      if (req.action !== undefined) {
        params.push(req.action);
        fields.push(`action = $${params.length}`);
      }
      if (req.legalBasis !== undefined) {
        params.push(req.legalBasis);
        fields.push(`legal_basis = $${params.length}`);
      }
      if (req.isActive !== undefined) {
        params.push(req.isActive);
        fields.push(`is_active = $${params.length}`);
      }

      const res = await tx.query(
        `UPDATE retention_policies SET ${fields.join(', ')}
         WHERE tenant_id = $1 AND id = $2
         RETURNING *`,
        params,
      );
      if (res.rows.length === 0) {
        throw new ProblemException('NOT_FOUND', { detail: 'Retention policy not found' });
      }
      return res.rows[0];
    });
  }

  async listLegalHolds(tenantId: string, filters: { scope?: string; patientId?: string } = {}) {
    return withTenant({ tenantId }, async (tx) => {
      const conditions = ['tenant_id = $1'];
      const params: any[] = [tenantId];
      if (filters.scope) {
        params.push(filters.scope);
        conditions.push(`scope = $${params.length}`);
      }
      if (filters.patientId) {
        params.push(filters.patientId);
        conditions.push(`patient_id = $${params.length}`);
      }
      const res = await tx.query(
        `SELECT lh.*, p.first_name, p.last_name,
                COALESCE((SELECT pi.value FROM patient_identifiers pi WHERE pi.tenant_id = p.tenant_id AND pi.patient_id = p.id LIMIT 1), p.id) AS patient_no,
                u.name AS placed_by_name
         FROM legal_holds lh
         LEFT JOIN patients p ON p.tenant_id = lh.tenant_id AND p.id = lh.patient_id
         LEFT JOIN users u ON u.tenant_id = lh.tenant_id AND u.id = lh.placed_by
         WHERE ${conditions.join(' AND ')}
         ORDER BY lh.placed_at DESC`,
        params,
      );
      return res.rows;
    });
  }

  async createLegalHold(tenantId: string, req: CreateLegalHoldRequest, actorId: string) {
    return withTenant({ tenantId }, async (tx) => {
      const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      const seqRes = await tx.query<{ count: string }>(
        `SELECT COUNT(*) AS count FROM legal_holds WHERE tenant_id = $1`,
        [tenantId],
      );
      const seq = String(parseInt(seqRes.rows[0]?.count || '0', 10) + 1).padStart(4, '0');
      const holdNo = `HLD-${dateStr}-${seq}`;

      const res = await tx.query(
        `INSERT INTO legal_holds (
           tenant_id, hold_no, scope, patient_id, record_class, reason,
           placed_by, placed_at, created_at, updated_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, now(), now(), now())
         RETURNING *`,
        [
          tenantId,
          holdNo,
          req.scope,
          req.patientId || null,
          req.recordClass || null,
          req.reason,
          actorId,
        ],
      );
      return res.rows[0];
    });
  }

  async releaseLegalHold(tenantId: string, id: string, req: ReleaseLegalHoldRequest, actorId: string) {
    return withTenant({ tenantId }, async (tx) => {
      const res = await tx.query(
        `UPDATE legal_holds
         SET released_at = now(), released_by = $1, release_reason = $2, updated_at = now()
         WHERE tenant_id = $3 AND id = $4 AND released_at IS NULL
         RETURNING *`,
        [actorId, req.releaseReason, tenantId, id],
      );
      if (res.rows.length === 0) {
        throw new ProblemException('NOT_FOUND', { detail: 'Active legal hold not found or already released' });
      }

      // Unhold candidates that were held under this legal hold
      await tx.query(
        `UPDATE retention_candidates
         SET status = 'PENDING', held_by_legal_hold_id = NULL
         WHERE tenant_id = $1 AND held_by_legal_hold_id = $2`,
        [tenantId, id],
      );

      return res.rows[0];
    });
  }

  async listRetentionCandidates(tenantId: string, status?: string) {
    return withTenant({ tenantId }, async (tx) => {
      const conditions = ['rc.tenant_id = $1'];
      const params: any[] = [tenantId];
      if (status) {
        params.push(status);
        conditions.push(`rc.status = $${params.length}`);
      }
      const res = await tx.query(
        `SELECT rc.*, p.first_name, p.last_name,
                COALESCE((SELECT pi.value FROM patient_identifiers pi WHERE pi.tenant_id = p.tenant_id AND pi.patient_id = p.id LIMIT 1), p.id) AS patient_no,
                lh.hold_no
         FROM retention_candidates rc
         LEFT JOIN patients p ON p.tenant_id = rc.tenant_id AND p.id = rc.patient_id
         LEFT JOIN legal_holds lh ON lh.tenant_id = rc.tenant_id AND lh.id = rc.held_by_legal_hold_id
         WHERE ${conditions.join(' AND ')}
         ORDER BY rc.eligible_at ASC`,
        params,
      );
      return res.rows;
    });
  }

  /**
   * Approves retention candidates in bulk.
   * Ground rule: Nothing is deleted/approved before checking whether an active legal hold applies.
   */
  async approveRetentionCandidates(tenantId: string, req: ApproveRetentionCandidatesRequest, actorId: string) {
    return withTenant({ tenantId }, async (tx) => {
      // Check if any candidate has an active legal hold
      const candidates = await tx.query(
        `SELECT rc.id, rc.entity_ref, rc.record_class, rc.patient_id,
                lh.hold_no
         FROM retention_candidates rc
         LEFT JOIN legal_holds lh ON lh.tenant_id = rc.tenant_id
           AND lh.released_at IS NULL
           AND (
             lh.scope = 'ENTIRE_TENANT'
             OR (lh.scope = 'PATIENT' AND lh.patient_id = rc.patient_id)
             OR (lh.scope = 'RECORD_CLASS' AND lh.record_class = rc.record_class)
           )
         WHERE rc.tenant_id = $1 AND rc.id = ANY($2::uuid[])`,
        [tenantId, req.candidateIds],
      );

      const held = candidates.rows.find((c) => c.hold_no);
      if (held) {
        throw new ProblemException('CONFLICT', {
          detail: `Cannot approve candidate '${held.entity_ref}': an active legal hold (${held.hold_no}) covers this record.`,
        });
      }

      const res = await tx.query(
        `UPDATE retention_candidates
         SET status = 'APPROVED', reviewed_by = $1, reviewed_at = now()
         WHERE tenant_id = $2 AND id = ANY($3::uuid[])
         RETURNING *`,
        [actorId, tenantId, req.candidateIds],
      );
      return res.rows;
    });
  }

  async holdRetentionCandidates(tenantId: string, req: HoldRetentionCandidatesRequest, actorId: string) {
    return withTenant({ tenantId }, async (tx) => {
      const res = await tx.query(
        `UPDATE retention_candidates
         SET status = 'HELD', held_by_legal_hold_id = $1, reviewed_by = $2, reviewed_at = now()
         WHERE tenant_id = $3 AND id = ANY($4::uuid[])
         RETURNING *`,
        [req.legalHoldId, actorId, tenantId, req.candidateIds],
      );
      return res.rows;
    });
  }

  // ── 7. Access Reviews (§12.1, CMP-T3, ADM-T5) ──────────────────────────────

  async listAccessReviews(tenantId: string) {
    return withTenant({ tenantId }, async (tx) => {
      const res = await tx.query(
        `SELECT ar.*, u.name AS reviewer_name,
                (SELECT COUNT(*) FROM access_review_decisions ard WHERE ard.tenant_id = ar.tenant_id AND ard.review_id = ar.id) AS decisions_count
         FROM access_reviews ar
         LEFT JOIN users u ON u.tenant_id = ar.tenant_id AND u.id = ar.reviewer_id
         WHERE ar.tenant_id = $1
         ORDER BY ar.started_at DESC`,
        [tenantId],
      );
      return res.rows;
    });
  }

  async getAccessReview(tenantId: string, id: string) {
    return withTenant({ tenantId }, async (tx) => {
      const reviewRes = await tx.query(
        `SELECT * FROM access_reviews WHERE tenant_id = $1 AND id = $2`,
        [tenantId, id],
      );
      if (reviewRes.rows.length === 0) {
        throw new ProblemException('NOT_FOUND', { detail: 'Access review campaign not found' });
      }

      const decisionsRes = await tx.query(
        `SELECT ard.*, u.name AS user_name, u.email AS user_email, r.name AS role_name
         FROM access_review_decisions ard
         JOIN users u ON u.tenant_id = ard.tenant_id AND u.id = ard.user_id
         JOIN roles r ON r.tenant_id = ard.tenant_id AND r.id = ard.role_id
         WHERE ard.tenant_id = $1 AND ard.review_id = $2`,
        [tenantId, id],
      );

      return {
        review: reviewRes.rows[0],
        decisions: decisionsRes.rows,
      };
    });
  }

  async createAccessReview(tenantId: string, req: CreateAccessReviewRequest, actorId: string) {
    return withTenant({ tenantId }, async (tx) => {
      const res = await tx.query(
        `INSERT INTO access_reviews (tenant_id, campaign_name, status, started_at, reviewer_id, created_at, updated_at)
         VALUES ($1, $2, 'OPEN', now(), $3, now(), now())
         RETURNING *`,
        [tenantId, req.campaignName, actorId],
      );
      const review = res.rows[0];

      // Auto-populate decisions for all active users and their roles
      await tx.query(
        `INSERT INTO access_review_decisions (tenant_id, review_id, user_id, role_id, decision, decided_at, decided_by)
         SELECT $1, $2, ur.user_id, ur.role_id, 'MAINTAIN', now(), $3
         FROM user_roles ur
         JOIN users u ON u.tenant_id = ur.tenant_id AND u.id = ur.user_id
         WHERE ur.tenant_id = $1 AND u.status = 'ACTIVE'`,
        [tenantId, review.id, actorId],
      );

      return review;
    });
  }

  async recordAccessReviewDecision(tenantId: string, reviewId: string, req: RecordAccessReviewDecisionRequest, actorId: string) {
    return withTenant({ tenantId }, async (tx) => {
      const res = await tx.query(
        `INSERT INTO access_review_decisions (tenant_id, review_id, user_id, role_id, decision, notes, decided_at, decided_by)
         VALUES ($1, $2, $3, $4, $5, $6, now(), $7)
         ON CONFLICT (tenant_id, id) DO NOTHING
         RETURNING *`,
        [tenantId, reviewId, req.userId, req.roleId, req.decision, req.notes || null, actorId],
      );

      // If REVOKE was selected, optionally remove the role
      if (req.decision === 'REVOKE') {
        await tx.query(
          `DELETE FROM user_roles WHERE tenant_id = $1 AND user_id = $2 AND role_id = $3`,
          [tenantId, req.userId, req.roleId],
        );
      }

      return res.rows[0];
    });
  }

  // ── 8. PIDSR Case Registry (RA 11332, todo §8.4, Q-16) ──────────────────────

  async listPidsrCases(tenantId: string, filters: { status?: string; diseaseCode?: string; branchId?: string } = {}) {
    return withTenant({ tenantId }, async (tx) => {
      const conditions = ['c.tenant_id = $1'];
      const params: any[] = [tenantId];
      if (filters.status) {
        params.push(filters.status);
        conditions.push(`c.status = $${params.length}`);
      }
      if (filters.diseaseCode) {
        params.push(filters.diseaseCode);
        conditions.push(`c.disease_code = $${params.length}`);
      }
      if (filters.branchId) {
        params.push(filters.branchId);
        conditions.push(`c.branch_id = $${params.length}`);
      }

      const res = await tx.query(
        `SELECT c.*, p.first_name, p.last_name, p.date_of_birth, p.gender,
                COALESCE((SELECT pi.value FROM patient_identifiers pi WHERE pi.tenant_id = p.tenant_id AND pi.patient_id = p.id LIMIT 1), p.id) AS patient_no,
                b.name AS branch_name
         FROM pidsr_cases c
         JOIN patients p ON p.tenant_id = c.tenant_id AND p.id = c.patient_id
         JOIN branches b ON b.tenant_id = c.tenant_id AND b.id = c.branch_id
         WHERE ${conditions.join(' AND ')}
         ORDER BY c.date_of_onset DESC, c.created_at DESC`,
        params,
      );
      return res.rows;
    });
  }

  async getPidsrCase(tenantId: string, id: string) {
    return withTenant({ tenantId }, async (tx) => {
      const res = await tx.query(
        `SELECT c.*, p.first_name, p.last_name, p.date_of_birth, p.gender,
                COALESCE((SELECT pi.value FROM patient_identifiers pi WHERE pi.tenant_id = p.tenant_id AND pi.patient_id = p.id LIMIT 1), p.id) AS patient_no,
                b.name AS branch_name
         FROM pidsr_cases c
         JOIN patients p ON p.tenant_id = c.tenant_id AND p.id = c.patient_id
         JOIN branches b ON b.tenant_id = c.tenant_id AND b.id = c.branch_id
         WHERE c.tenant_id = $1 AND c.id = $2`,
        [tenantId, id],
      );
      if (res.rows.length === 0) {
        throw new ProblemException('NOT_FOUND', { detail: 'PIDSR case record not found' });
      }
      return res.rows[0];
    });
  }

  async createPidsrCase(tenantId: string, req: CreatePidsrCaseRequest, actorId: string) {
    return withTenant({ tenantId }, async (tx) => {
      const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      const seqRes = await tx.query<{ count: string }>(
        `SELECT COUNT(*) AS count FROM pidsr_cases WHERE tenant_id = $1`,
        [tenantId],
      );
      const seq = String(parseInt(seqRes.rows[0]?.count || '0', 10) + 1).padStart(4, '0');
      const caseNo = `PIDSR-${dateStr}-${seq}`;

      const res = await tx.query(
        `INSERT INTO pidsr_cases (
           tenant_id, branch_id, case_no, patient_id, visit_id,
           disease_code, disease_name, icd10_code, date_of_onset,
           classification, cif_data, status, created_at, updated_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'DRAFT', now(), now())
         RETURNING *`,
        [
          tenantId,
          req.branchId,
          caseNo,
          req.patientId,
          req.visitId || null,
          req.diseaseCode,
          req.diseaseName,
          req.icd10Code,
          req.dateOfOnset,
          req.classification || 'SUSPECTED',
          JSON.stringify(req.cifData || {}),
        ],
      );
      return res.rows[0];
    });
  }

  async updatePidsrCase(tenantId: string, id: string, req: UpdatePidsrCaseRequest, actorId: string) {
    return withTenant({ tenantId }, async (tx) => {
      const fields: string[] = ['updated_at = now()'];
      const params: any[] = [tenantId, id];

      if (req.classification) {
        params.push(req.classification);
        fields.push(`classification = $${params.length}`);
      }
      if (req.cifData) {
        params.push(JSON.stringify(req.cifData));
        fields.push(`cif_data = $${params.length}`);
      }
      if (req.status) {
        params.push(req.status);
        fields.push(`status = $${params.length}`);
        if (req.status === 'REPORTED') {
          params.push(actorId);
          fields.push(`reported_by = $${params.length}, reported_at = now()`);
        }
      }

      const res = await tx.query(
        `UPDATE pidsr_cases SET ${fields.join(', ')}
         WHERE tenant_id = $1 AND id = $2
         RETURNING *`,
        params,
      );
      if (res.rows.length === 0) {
        throw new ProblemException('NOT_FOUND', { detail: 'PIDSR case not found' });
      }
      return res.rows[0];
    });
  }

  // ── 9. Security Events (§12.1) ─────────────────────────────────────────────

  async listSecurityEvents(tenantId: string, filters: { eventType?: string; severity?: string } = {}) {
    return withTenant({ tenantId }, async (tx) => {
      const conditions = ['tenant_id = $1'];
      const params: any[] = [tenantId];
      if (filters.eventType) {
        params.push(filters.eventType);
        conditions.push(`event_type = $${params.length}`);
      }
      if (filters.severity) {
        params.push(filters.severity);
        conditions.push(`severity = $${params.length}`);
      }

      const res = await tx.query(
        `SELECT * FROM security_events
         WHERE ${conditions.join(' AND ')}
         ORDER BY created_at DESC
         LIMIT 100`,
        params,
      );
      return res.rows;
    });
  }
}
