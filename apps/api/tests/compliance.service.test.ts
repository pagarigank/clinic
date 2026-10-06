import { describe, it, expect, beforeEach } from 'vitest';
import { withTenant, getAppPool } from '@clinic/db';
import { ComplianceService } from '../src/compliance/compliance.service.js';
import { ProblemException } from '../src/http/problem.exception.js';
import { seedUsers } from "@clinic/db/tests/helpers.js";

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';
const { USER_A } = await seedUsers();

describe('ComplianceService (Phase 8)', () => {
  const svc = new ComplianceService();

  beforeEach(async () => {
    await withTenant({ tenantId: TENANT_A }, async (tx) => {
      await tx.query(`DELETE FROM retention_candidates WHERE tenant_id = $1`, [TENANT_A]);
      await tx.query(`DELETE FROM legal_holds WHERE tenant_id = $1`, [TENANT_A]);
      await tx.query(`DELETE FROM data_subject_requests WHERE tenant_id = $1`, [TENANT_A]);
      await tx.query(`DELETE FROM breach_incidents WHERE tenant_id = $1`, [TENANT_A]);
      await tx.query(`DELETE FROM pidsr_cases WHERE tenant_id = $1`, [TENANT_A]);
    });
  });

  describe('8.1 Audit and PHI Access Logs', () => {
    it('queries audit logs with filters and retrieves detail with states', async () => {
      let auditId = '';
      await withTenant({ tenantId: TENANT_A }, async (tx) => {
        const res = await tx.query(
          `INSERT INTO audit_log (tenant_id, action, entity_type, entity_id, actor_id, before_state, after_state)
           VALUES ($1, 'TEST_ACTION', 'PATIENT', 'a4000000-0000-4000-8000-000000000001', $2, '{"status":"DRAFT"}'::jsonb, '{"status":"ACTIVE"}'::jsonb)
           RETURNING id`,
          [TENANT_A, USER_A],
        );
        auditId = res.rows[0].id;
      });

      const logs = await svc.listAuditLogs(TENANT_A, { entityType: 'PATIENT' });
      expect(logs.length).toBeGreaterThanOrEqual(1);

      const detail = await svc.getAuditLogById(TENANT_A, auditId);
      expect(detail.id).toBe(auditId);
      expect(detail.before_state).toEqual({ status: 'DRAFT' });
      expect(detail.after_state).toEqual({ status: 'ACTIVE' });
    });

    it('queries PHI access log including anomaly detection', async () => {
      await withTenant({ tenantId: TENANT_A }, async (tx) => {
        await tx.query(
          `INSERT INTO phi_access_log (tenant_id, actor_id, patient_id, resource, purpose)
           VALUES ($1, $2, 'a4000000-0000-4000-8000-000000000001', 'DSR_EXPORT', 'DATA_SUBJECT_REQUEST_EXPORT')`,
          [TENANT_A, USER_A],
        );
      });

      const logs = await svc.listPhiAccessLogs(TENANT_A, { anomalyOnly: true });
      expect(logs.length).toBeGreaterThanOrEqual(1);
      expect(logs.some((l) => l.resource === 'DSR_EXPORT')).toBe(true);
    });
  });

  describe('8.2 Consent and DSR (discharging AC-15)', () => {
    it('manages consent template lifecycle and patient consent recording/revocation', async () => {
      const template = await svc.createConsentTemplate(
        TENANT_A,
        {
          title: 'Telemedicine Consent',
          body: 'Consent to remote digital health consultation.',
          purposes: ['TELEHEALTH', 'RECORDS'],
          locale: 'en',
          status: 'DRAFT',
        },
        USER_A,
      );
      expect(template.version).toBeGreaterThanOrEqual(1);
      expect(template.status).toBe('DRAFT');

      const published = await svc.publishConsentTemplate(TENANT_A, template.id, USER_A);
      expect(published.status).toBe('PUBLISHED');

      const consent = await svc.recordPatientConsent(
        TENANT_A,
        {
          patientId: 'a4000000-0000-4000-8000-000000000001',
          templateId: published.id,
          signedByName: 'Maria Elena Santos',
          relationship: 'SELF',
        },
        USER_A,
      );
      expect(consent.status).toBe('GRANTED');

      const patientConsents = await svc.getPatientConsents(TENANT_A, 'a4000000-0000-4000-8000-000000000001');
      expect(patientConsents.length).toBeGreaterThanOrEqual(1);

      const revoked = await svc.revokePatientConsent(TENANT_A, consent.id, 'Patient revoked telehealth consent', USER_A);
      expect(revoked.status).toBe('REVOKED');
      expect(revoked.revoked_reason).toBe('Patient revoked telehealth consent');
    });

    it('discharges AC-15: DSR workflow and patient export contains only that patient data with audited PHI access', async () => {
      const patientId = 'a4000000-0000-4000-8000-000000000001';

      // 1. Intake DSR
      const dsr = await svc.createDsrRequest(
        TENANT_A,
        {
          patientId,
          type: 'ACCESS',
          dueDays: 30,
        },
        USER_A,
      );
      expect(dsr.status).toBe('RECEIVED');
      expect(dsr.request_no).toMatch(/^DSR-\d{8}-\d{4}$/);

      // 2. Identity verification
      const verified = await svc.verifyDsrIdentity(TENANT_A, dsr.id, { identityNotes: 'Presented government UMID ID' }, USER_A);
      expect(verified.identity_verified).toBe(true);

      // 3. Start processing
      const inProgress = await svc.startDsrProcessing(TENANT_A, dsr.id, USER_A);
      expect(inProgress.status).toBe('IN_PROGRESS');

      // 4. AC-15 Export: contains exactly one patient's records and logs PHI access
      const exportBundle = await svc.exportPatientData(TENANT_A, dsr.id, USER_A, '127.0.0.1', 'Vitest-Agent');
      expect(exportBundle.patient.id).toBe(patientId);
      expect(exportBundle.exportMetadata.patientId).toBe(patientId);
      expect(exportBundle.exportMetadata.tenantId).toBe(TENANT_A);

      // Verify PHI access log was written
      const phiLogs = await svc.listPhiAccessLogs(TENANT_A, { patientId, resource: 'DSR_EXPORT' });
      expect(phiLogs.length).toBeGreaterThanOrEqual(1);
      expect(phiLogs[0].purpose).toBe('DATA_SUBJECT_REQUEST_EXPORT');

      // 5. Complete DSR
      const completed = await svc.completeDsr(TENANT_A, dsr.id, { outcomeNote: 'Secure data bundle generated and issued to patient.' }, USER_A);
      expect(completed.status).toBe('COMPLETED');
    });
  });

  describe('8.3 Breach Management (Q-2)', () => {
    it('tracks breach incidents with default 72h notification timer, assessment, and closeout', async () => {
      const breach = await svc.createBreach(
        TENANT_A,
        {
          description: 'Lost unencrypted staff USB drive with backup reports',
          severity: 'HIGH',
          dataClasses: ['PHI', 'DEMOGRAPHICS'],
          affectedCount: 25,
          deadlineHours: 72,
        },
        USER_A,
      );
      expect(breach.incident_no).toMatch(/^BRC-\d{8}-\d{4}$/);
      expect(breach.status).toBe('DETECTED');

      // Check 72h timer
      const detected = new Date(breach.detected_at).getTime();
      const deadline = new Date(breach.notify_regulator_due_at).getTime();
      const diffHours = (deadline - detected) / (3600 * 1000);
      expect(Math.round(diffHours)).toBe(72);

      const assessed = await svc.assessBreach(
        TENANT_A,
        breach.id,
        {
          severity: 'HIGH',
          affectedCount: 30,
          dataClasses: ['PHI', 'DEMOGRAPHICS', 'DIAGNOSES'],
          correctiveActions: 'Initiated remote wipe and interviewed clinic custodian',
        },
        USER_A,
      );
      expect(assessed.status).toBe('ASSESSED');
      expect(assessed.affected_count).toBe(30);

      const notified = await svc.recordBreachNotification(
        TENANT_A,
        breach.id,
        {
          notifiedRegulator: true,
          notifiedSubjects: true,
        },
        USER_A,
      );
      expect(notified.status).toBe('NOTIFIED');
      expect(notified.notified_regulator).toBe(true);

      const closed = await svc.closeBreach(
        TENANT_A,
        breach.id,
        {
          correctiveActions: 'Enforced full device encryption and security awareness retraining',
          lessonsLearned: 'Prohibit portable unmanaged media storage on clinic premises',
        },
        USER_A,
      );
      expect(closed.status).toBe('CLOSED');
      expect(closed.closed_by).toBe(USER_A);
    });
  });

  describe('8.3 Retention Policies & Legal Holds', () => {
    it('enforces legal holds over retention candidate approval', async () => {
      const patientId = 'a4000000-0000-4000-8000-000000000001';

      // 1. Create a legal hold on the patient
      const hold = await svc.createLegalHold(
        TENANT_A,
        {
          scope: 'PATIENT',
          patientId,
          reason: 'Subpoena duces tecum received from Regional Trial Court',
        },
        USER_A,
      );
      expect(hold.hold_no).toMatch(/^HLD-\d{8}-\d{4}$/);

      // 2. Insert dummy retention candidate
      let candidateId = '';
      await withTenant({ tenantId: TENANT_A }, async (tx) => {
        const p = await tx.query(`SELECT id FROM retention_policies WHERE tenant_id = $1 LIMIT 1`, [TENANT_A]);
        const policyId = p.rows[0].id;

        const cRes = await tx.query(
          `INSERT INTO retention_candidates (tenant_id, policy_id, record_class, entity_id, entity_ref, patient_id, eligible_at, status)
           VALUES ($1, $2, 'CLINICAL_VISITS', $4::uuid, 'Visit V-2026-0001', $3, now(), 'PENDING')
           RETURNING id`,
          [TENANT_A, policyId, patientId, crypto.randomUUID()],
        );
        candidateId = cRes.rows[0].id;
      });

      // 3. Approval must FAIL because an active legal hold covers this candidate
      await expect(
        svc.approveRetentionCandidates(TENANT_A, { candidateIds: [candidateId] }, USER_A),
      ).rejects.toThrow(ProblemException);

      // 4. Release legal hold
      await svc.releaseLegalHold(TENANT_A, hold.id, { releaseReason: 'Case dismissed by court' }, USER_A);

      // 5. Approval now SUCCEEDS
      const approved = await svc.approveRetentionCandidates(TENANT_A, { candidateIds: [candidateId] }, USER_A);
      expect(approved.length).toBe(1);
      expect(approved[0].status).toBe('APPROVED');
    });
  });

  describe('8.4 PIDSR Notifiable Disease Case Reporting (RA 11332)', () => {
    it('creates and tracks PIDSR case reports with CIF fields', async () => {
      const patientId = 'a4000000-0000-4000-8000-000000000001';
      const branchId = 'a1000000-0000-4000-8000-000000000001';

      const pidsr = await svc.createPidsrCase(
        TENANT_A,
        {
          branchId,
          patientId,
          diseaseCode: 'DENGUE',
          diseaseName: 'Dengue Fever with Warning Signs',
          icd10Code: 'A97.1',
          dateOfOnset: '2026-10-01',
          classification: 'SUSPECTED',
          cifData: {
            feverDays: 3,
            plateletCount: 95000,
            hasPetechiae: true,
            tourniquetTest: 'POSITIVE',
            travelHistory: 'Within Barangay',
          },
        },
        USER_A,
      );

      expect(pidsr.case_no).toMatch(/^PIDSR-\d{8}-\d{4}$/);
      expect(pidsr.status).toBe('DRAFT');

      const updated = await svc.updatePidsrCase(
        TENANT_A,
        pidsr.id,
        {
          classification: 'CONFIRMED',
          status: 'REPORTED',
        },
        USER_A,
      );

      expect(updated.classification).toBe('CONFIRMED');
      expect(updated.status).toBe('REPORTED');
      expect(updated.reported_by).toBe(USER_A);
      expect(updated.reported_at).toBeTruthy();
    });
  });
});
