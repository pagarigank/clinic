import { Injectable } from '@nestjs/common';
import { withTenant } from '@clinic/db';
import { ProblemException } from '../http/problem.exception.js';
import type {
  CreatePatientRequest,
  UpdatePatientRequest,
  DeactivatePatientRequest,
  MarkDeceasedRequest,
  AddIdentifierRequest,
  AddContactRequest,
  AddAllergyRequest,
  AddFlagRequest,
  RevealIdentifierRequest,
  CheckDuplicatesRequest,
  AcknowledgeDuplicatesRequest,
  MergePatientRequest,
  ConsentCaptureRequest,
  ConsentWithdrawRequest,
  PhilHealthDataRequest,
  PhilHealthDependentRequest,
} from '@clinic/contracts';

@Injectable()
export class PatientsService {
  // ── Core patient CRUD ──────────────────────────────────────────────────────

  async getPatient(tenantId: string, userId: string, patientId: string) {
    return withTenant({ tenantId, userId }, async (tx) => {
      const res = await tx.query(
        `SELECT p.*,
                COALESCE(json_agg(DISTINCT jsonb_build_object('id', pi.id, 'type', pi.type, 'value', '***', 'createdAt', pi.created_at)) FILTER (WHERE pi.id IS NOT NULL), '[]') AS identifiers,
                COALESCE(json_agg(DISTINCT jsonb_build_object('id', pc.id, 'type', pc.type, 'value', pc.value, 'isPrimary', pc.is_primary)) FILTER (WHERE pc.id IS NOT NULL), '[]') AS contacts,
                COALESCE(json_agg(DISTINCT jsonb_build_object('id', pa.id, 'substance', pa.substance, 'severity', pa.severity)) FILTER (WHERE pa.id IS NOT NULL), '[]') AS allergies,
                COALESCE(json_agg(DISTINCT jsonb_build_object('id', pf.id, 'title', pf.title, 'description', pf.description, 'level', pf.level)) FILTER (WHERE pf.id IS NOT NULL), '[]') AS flags
         FROM patients p
         LEFT JOIN patient_identifiers pi ON pi.patient_id = p.id
         LEFT JOIN patient_contacts pc ON pc.patient_id = p.id
         LEFT JOIN patient_allergies pa ON pa.patient_id = p.id
         LEFT JOIN patient_flags pf ON pf.patient_id = p.id
         WHERE p.id = $1
         GROUP BY p.id`,
        [patientId],
      );
      if ((res.rowCount ?? 0) === 0) throw new ProblemException('NOT_FOUND', { detail: 'Patient not found' });
      return res.rows[0];
    });
  }

  async listPatients(tenantId: string, userId: string, q?: string, cursor?: string) {
    return withTenant({ tenantId, userId }, async (tx) => {
      const params: unknown[] = [];
      let where = '';
      if (q && q.trim()) {
        const trimmed = q.trim();
        const tokens = trimmed.split(/[\s,]+/).filter(Boolean);
        const tokenClauses: string[] = [];
        for (const token of tokens) {
          params.push(`%${token}%`);
          const idx = params.length;
          tokenClauses.push(`(
            p.first_name ILIKE $${idx} OR 
            p.last_name ILIKE $${idx} OR 
            COALESCE(p.middle_name, '') ILIKE $${idx} OR
            EXISTS (SELECT 1 FROM patient_identifiers pi WHERE pi.patient_id = p.id AND pi.value ILIKE $${idx}) OR
            EXISTS (SELECT 1 FROM patient_contacts pc WHERE pc.patient_id = p.id AND pc.value ILIKE $${idx}) OR
            EXISTS (SELECT 1 FROM patient_philhealth pp WHERE pp.patient_id = p.id AND pp.pin ILIKE $${idx})
          )`);
        }

        params.push(trimmed);
        const qIdx = params.length;
        const fuzzyClause = `(
          word_similarity($${qIdx}, p.first_name || ' ' || p.last_name) > 0.35 OR
          word_similarity($${qIdx}, p.last_name || ' ' || p.first_name) > 0.35 OR
          similarity(p.first_name || ' ' || p.last_name, $${qIdx}) > 0.2 OR
          similarity(p.last_name || ' ' || p.first_name, $${qIdx}) > 0.2
        )`;

        if (tokenClauses.length > 0) {
          where += ` AND ((${tokenClauses.join(' AND ')}) OR ${fuzzyClause})`;
        } else {
          where += ` AND ${fuzzyClause}`;
        }
      }
      if (cursor) {
        params.push(cursor);
        where += ` AND p.id > $${params.length}`;
      }
      const res = await tx.query(
        `SELECT 
           p.id, 
           p.first_name, 
           p.last_name, 
           p.middle_name, 
           p.date_of_birth, 
           p.gender, 
           p.status, 
           p.created_at, 
           p.row_version,
           (SELECT pi.value FROM patient_identifiers pi WHERE pi.patient_id = p.id AND pi.type IN ('PATIENT_NO', 'MRN', 'HRN') ORDER BY pi.created_at ASC LIMIT 1) as patient_no,
           (SELECT pc.value FROM patient_contacts pc WHERE pc.patient_id = p.id AND pc.type IN ('PHONE', 'MOBILE') ORDER BY pc.is_primary DESC, pc.created_at ASC LIMIT 1) as phone,
           (SELECT pp.pin FROM patient_philhealth pp WHERE pp.patient_id = p.id LIMIT 1) as philhealth_no,
           (SELECT pp.konsulta_status FROM patient_philhealth pp WHERE pp.patient_id = p.id LIMIT 1) as konsulta_status
         FROM patients p
         WHERE p.status != 'MERGED' ${where}
         ORDER BY p.last_name, p.first_name, p.id
         LIMIT 51`,
        params,
      );
      const rows = res.rows;
      const hasMore = rows.length === 51;
      const data = hasMore ? rows.slice(0, 50) : rows;
      return { data, nextCursor: hasMore ? data[data.length - 1]?.id ?? null : null, hasMore };
    });
  }

  async createPatient(tenantId: string, userId: string, dto: CreatePatientRequest) {
    return withTenant({ tenantId, userId }, async (tx) => {
      const res = await tx.query(
        `INSERT INTO patients (tenant_id, first_name, last_name, middle_name, date_of_birth, gender, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'ACTIVE')
         RETURNING id, first_name, last_name, date_of_birth, gender, status, row_version, created_at`,
        [tenantId, dto.firstName, dto.lastName, dto.middleName ?? null, dto.dateOfBirth, dto.gender],
      );
      const patient = res.rows[0];

      // If emergency registration, add a flag to prompt deferred consent
      if (dto.registrationType === 'EMERGENCY') {
        await tx.query(
          `INSERT INTO patient_flags (tenant_id, patient_id, title, description, level)
           VALUES ($1, $2, 'Emergency Registration', 'Consent was deferred — obtain at next encounter', 'WARNING')`,
          [tenantId, patient.id],
        );
      }

      return patient;
    });
  }

  async updatePatient(tenantId: string, userId: string, patientId: string, dto: UpdatePatientRequest) {
    return withTenant({ tenantId, userId }, async (tx) => {
      const setClauses: string[] = ['updated_at = now()', 'row_version = row_version + 1'];
      const params: unknown[] = [];

      if (dto.firstName !== undefined) { params.push(dto.firstName); setClauses.push(`first_name = $${params.length}`); }
      if (dto.lastName !== undefined) { params.push(dto.lastName); setClauses.push(`last_name = $${params.length}`); }
      if ('middleName' in dto) { params.push(dto.middleName ?? null); setClauses.push(`middle_name = $${params.length}`); }
      if (dto.dateOfBirth !== undefined) { params.push(dto.dateOfBirth); setClauses.push(`date_of_birth = $${params.length}`); }
      if (dto.gender !== undefined) { params.push(dto.gender); setClauses.push(`gender = $${params.length}`); }

      params.push(patientId, tenantId, dto.rowVersion);
      const res = await tx.query(
        `UPDATE patients SET ${setClauses.join(', ')}
         WHERE id = $${params.length - 2} AND tenant_id = $${params.length - 1} AND row_version = $${params.length}
         RETURNING id, row_version`,
        params,
      );
      if ((res.rowCount ?? 0) === 0) throw new ProblemException('STALE_ROW_VERSION', { detail: 'Patient was modified by another request' });
      return res.rows[0];
    });
  }

  async deactivatePatient(tenantId: string, userId: string, patientId: string, dto: DeactivatePatientRequest) {
    return withTenant({ tenantId, userId }, async (tx) => {
      const res = await tx.query(
        `UPDATE patients SET status = 'INACTIVE', updated_at = now(), row_version = row_version + 1
         WHERE id = $1 AND tenant_id = $2 AND row_version = $3 AND status = 'ACTIVE'
         RETURNING id, status, row_version`,
        [patientId, tenantId, dto.rowVersion],
      );
      if ((res.rowCount ?? 0) === 0) throw new ProblemException('STALE_ROW_VERSION', { detail: 'Patient not found, already inactive, or version conflict' });
      // Log reason to flags (append-only)
      await tx.query(
        `INSERT INTO patient_flags (tenant_id, patient_id, title, description, level)
         VALUES ($1, $2, 'Deactivated', $3, 'WARNING')`,
        [tenantId, patientId, dto.reason],
      );
      return res.rows[0];
    });
  }

  async markDeceased(tenantId: string, userId: string, patientId: string, dto: MarkDeceasedRequest) {
    return withTenant({ tenantId, userId }, async (tx) => {
      const res = await tx.query(
        `UPDATE patients SET status = 'DECEASED', updated_at = now(), row_version = row_version + 1
         WHERE id = $1 AND tenant_id = $2 AND row_version = $3 AND status != 'MERGED'
         RETURNING id, status, row_version`,
        [patientId, tenantId, dto.rowVersion],
      );
      if ((res.rowCount ?? 0) === 0) throw new ProblemException('STALE_ROW_VERSION', { detail: 'Patient not found, merged, or version conflict' });
      await tx.query(
        `INSERT INTO patient_flags (tenant_id, patient_id, title, description, level)
         VALUES ($1, $2, 'Deceased', $3, 'DANGER')`,
        [tenantId, patientId, `Date of death: ${dto.dateOfDeath}`],
      );
      return res.rows[0];
    });
  }

  // ── Identifiers ───────────────────────────────────────────────────────────

  async addIdentifier(tenantId: string, userId: string, patientId: string, dto: AddIdentifierRequest) {
    return withTenant({ tenantId, userId }, async (tx) => {
      const res = await tx.query(
        `INSERT INTO patient_identifiers (tenant_id, patient_id, type, value)
         VALUES ($1, $2, $3, $4) RETURNING id, type, created_at`,
        [tenantId, patientId, dto.type, dto.value],
      );
      return { ...res.rows[0], value: '***' }; // always mask on return
    });
  }

  async revealIdentifier(tenantId: string, userId: string, patientId: string, identifierId: string, dto: RevealIdentifierRequest) {
    return withTenant({ tenantId, userId }, async (tx) => {
      const res = await tx.query(
        `SELECT id, type, value FROM patient_identifiers WHERE id = $1 AND patient_id = $2`,
        [identifierId, patientId],
      );
      if ((res.rowCount ?? 0) === 0) throw new ProblemException('NOT_FOUND', { detail: 'Identifier not found' });
      // Log PHI access with reason
      await tx.query(
        `INSERT INTO phi_access_log (tenant_id, actor_id, patient_id, resource, purpose)
         VALUES ($1, $2, $3, $4, $5)`,
        [tenantId, userId, patientId, `patient_identifier:${identifierId}`, dto.reason],
      );
      return res.rows[0]; // return unmasked
    });
  }

  // ── Contacts ──────────────────────────────────────────────────────────────

  async addContact(tenantId: string, userId: string, patientId: string, dto: AddContactRequest) {
    return withTenant({ tenantId, userId }, async (tx) => {
      if (dto.isPrimary) {
        await tx.query(
          `UPDATE patient_contacts SET is_primary = false WHERE patient_id = $1 AND type = $2`,
          [patientId, dto.type],
        );
      }
      const res = await tx.query(
        `INSERT INTO patient_contacts (tenant_id, patient_id, type, value, is_primary)
         VALUES ($1, $2, $3, $4, $5) RETURNING id, type, value, is_primary, created_at`,
        [tenantId, patientId, dto.type, dto.value, dto.isPrimary ?? false],
      );
      return res.rows[0];
    });
  }

  // ── Allergies ─────────────────────────────────────────────────────────────

  async addAllergy(tenantId: string, userId: string, patientId: string, dto: AddAllergyRequest) {
    return withTenant({ tenantId, userId }, async (tx) => {
      const res = await tx.query(
        `INSERT INTO patient_allergies (tenant_id, patient_id, substance, severity)
         VALUES ($1, $2, $3, $4) RETURNING id, substance, severity, created_at`,
        [tenantId, patientId, dto.substance, dto.severity],
      );
      return res.rows[0];
    });
  }

  // ── Flags ─────────────────────────────────────────────────────────────────

  async addFlag(tenantId: string, userId: string, patientId: string, dto: AddFlagRequest) {
    return withTenant({ tenantId, userId }, async (tx) => {
      const res = await tx.query(
        `INSERT INTO patient_flags (tenant_id, patient_id, title, description, level)
         VALUES ($1, $2, $3, $4, $5) RETURNING id, title, description, level, created_at`,
        [tenantId, patientId, dto.title, dto.description ?? null, dto.level],
      );
      return res.rows[0];
    });
  }

  // ── Duplicate detection ───────────────────────────────────────────────────

  async findDuplicates(tenantId: string, userId: string, patientId: string) {
    return withTenant({ tenantId, userId }, async (tx) => {
      const patRes = await tx.query(`SELECT first_name, last_name, date_of_birth FROM patients WHERE id = $1`, [patientId]);
      if ((patRes.rowCount ?? 0) === 0) throw new ProblemException('NOT_FOUND', { detail: 'Patient not found' });
      const { first_name, last_name, date_of_birth } = patRes.rows[0];

      const res = await tx.query(
        `SELECT id, first_name, last_name, date_of_birth, gender,
                similarity(first_name || ' ' || last_name, $1) AS name_sim
         FROM patients
         WHERE id != $2
           AND status NOT IN ('MERGED', 'DECEASED')
           AND (
             similarity(first_name || ' ' || last_name, $1) > 0.4
             OR (date_of_birth = $3 AND (first_name ILIKE $4 OR last_name ILIKE $5))
           )
         ORDER BY name_sim DESC
         LIMIT 20`,
        [`${first_name} ${last_name}`, patientId, date_of_birth, `%${first_name}%`, `%${last_name}%`],
      );
      return { data: res.rows };
    });
  }

  /**
   * JOB-22 worklist (specification §1055): live-computed candidate pairs across
   * the whole tenant. No candidates table exists, so pairs are derived on demand
   * from a self-join over `patients`; every pair is therefore OPEN on each read.
   */
  async listDuplicateCandidates(tenantId: string, userId: string) {
    return withTenant({ tenantId, userId }, async (tx) => {
      const res = await tx.query(
        `SELECT
           p1.id AS patient_id,
           p2.id AS other_id,
           (p1.first_name || ' ' || p1.last_name) AS patient_name,
           (p2.first_name || ' ' || p2.last_name) AS other_name,
           COALESCE(i1.value, '') AS patient_no,
           COALESCE(i2.value, '') AS other_no,
           CASE
             WHEN p1.date_of_birth = p2.date_of_birth
              AND lower(p1.first_name) = lower(p2.first_name)
              AND lower(p1.last_name) = lower(p2.last_name) THEN 'EXACT'
             WHEN p1.date_of_birth = p2.date_of_birth
              AND (lower(p1.first_name) = lower(p2.first_name) OR lower(p1.last_name) = lower(p2.last_name))
              THEN 'DOB_MOBILE_FUZZY'
             ELSE 'TRIGRAM'
           END AS match_type,
           (CASE
             WHEN p1.date_of_birth = p2.date_of_birth
              AND lower(p1.first_name) = lower(p2.first_name)
              AND lower(p1.last_name) = lower(p2.last_name) THEN 1.0
             ELSE round(similarity(p1.first_name || ' ' || p1.last_name, p2.first_name || ' ' || p2.last_name)::numeric, 2)
           END)::float8 AS score
         FROM patients p1
         JOIN patients p2 ON p2.id > p1.id
         LEFT JOIN LATERAL (
           SELECT value FROM patient_identifiers
           WHERE patient_id = p1.id AND type IN ('MRN', 'PATIENT_NO')
           ORDER BY created_at LIMIT 1
         ) i1 ON true
         LEFT JOIN LATERAL (
           SELECT value FROM patient_identifiers
           WHERE patient_id = p2.id AND type IN ('MRN', 'PATIENT_NO')
           ORDER BY created_at LIMIT 1
         ) i2 ON true
         WHERE p1.status NOT IN ('MERGED', 'DECEASED')
           AND p2.status NOT IN ('MERGED', 'DECEASED')
           AND (
             (p1.date_of_birth = p2.date_of_birth
               AND (lower(p1.first_name) = lower(p2.first_name) OR lower(p1.last_name) = lower(p2.last_name)))
             OR similarity(p1.first_name || ' ' || p1.last_name, p2.first_name || ' ' || p2.last_name) > 0.4
           )
         ORDER BY score DESC, p1.created_at DESC, p2.created_at DESC, p1.id, p2.id
         LIMIT 50`,
      );
      const candidates = res.rows.map((r) => ({
        id: `${r.patient_id}:${r.other_id}`,
        patientId: r.patient_id,
        otherId: r.other_id,
        patientName: r.patient_name,
        otherName: r.other_name,
        patientNo: r.patient_no,
        otherNo: r.other_no,
        matchType: r.match_type,
        score: Number(r.score),
        status: 'OPEN' as const,
      }));
      return { candidates };
    });
  }

  async acknowledgeDuplicates(tenantId: string, userId: string, patientId: string, dto: AcknowledgeDuplicatesRequest) {
    return withTenant({ tenantId, userId }, async (tx) => {
      // Record acknowledgement as a flag on the patient record
      await tx.query(
        `INSERT INTO patient_flags (tenant_id, patient_id, title, description, level)
         VALUES ($1, $2, 'Duplicate Review', $3, 'INFO')`,
        [tenantId, patientId, `Acknowledged ${dto.candidateIds.length} duplicate candidate(s): ${dto.reason}`],
      );
      return { acknowledged: true };
    });
  }

  // ── Merge / unmerge ───────────────────────────────────────────────────────

  async mergePatients(tenantId: string, userId: string, dto: MergePatientRequest) {
    return withTenant({ tenantId, userId }, async (tx) => {
      // Fetch both patients (RLS ensures tenant isolation)
      const survivorRes = await tx.query(`SELECT * FROM patients WHERE id = $1`, [dto.survivingPatientId]);
      const mergedRes = await tx.query(`SELECT * FROM patients WHERE id = $1`, [dto.mergedPatientId]);

      if ((survivorRes.rowCount ?? 0) === 0) throw new ProblemException('NOT_FOUND', { detail: 'Surviving patient not found' });
      if ((mergedRes.rowCount ?? 0) === 0) throw new ProblemException('NOT_FOUND', { detail: 'Patient to merge not found' });

      const merged = mergedRes.rows[0];
      if (merged.status === 'MERGED') throw new ProblemException('CONFLICT', { detail: 'Patient is already merged' });

      // Snapshot the merged patient before mutation
      const snapshot = { ...merged };

      // Re-parent sub-resources to surviving patient
      for (const table of ['patient_identifiers', 'patient_contacts', 'patient_allergies', 'patient_flags', 'patient_consents']) {
        await tx.query(`UPDATE ${table} SET patient_id = $1 WHERE patient_id = $2`, [dto.survivingPatientId, dto.mergedPatientId]);
      }

      // Mark merged patient
      await tx.query(
        `UPDATE patients SET status = 'MERGED', updated_at = now(), row_version = row_version + 1 WHERE id = $1`,
        [dto.mergedPatientId],
      );

      // Record merge with full snapshot (enables unmerge)
      const mergeRes = await tx.query(
        `INSERT INTO patient_merges (tenant_id, surviving_patient_id, merged_patient_id, snapshot_data, status)
         VALUES ($1, $2, $3, $4::jsonb, 'COMPLETED') RETURNING id, created_at`,
        [tenantId, dto.survivingPatientId, dto.mergedPatientId, JSON.stringify(snapshot)],
      );

      return { mergeId: mergeRes.rows[0].id, mergedAt: mergeRes.rows[0].created_at };
    });
  }

  async unmergePatients(tenantId: string, userId: string, mergeId: string) {
    return withTenant({ tenantId, userId }, async (tx) => {
      const mergeRes = await tx.query(
        `SELECT * FROM patient_merges WHERE id = $1 AND status = 'COMPLETED'`,
        [mergeId],
      );
      if ((mergeRes.rowCount ?? 0) === 0) throw new ProblemException('NOT_FOUND', { detail: 'Merge record not found or already unmerged' });

      const merge = mergeRes.rows[0];
      const snapshot = merge.snapshot_data as Record<string, unknown>;

      // Restore merged patient from snapshot
      await tx.query(
        `UPDATE patients SET
           first_name = $1, last_name = $2, middle_name = $3,
           date_of_birth = $4, gender = $5, status = 'ACTIVE',
           updated_at = now(), row_version = row_version + 1
         WHERE id = $6`,
        [snapshot.first_name, snapshot.last_name, snapshot.middle_name ?? null, snapshot.date_of_birth, snapshot.gender, merge.merged_patient_id],
      );

      // Re-parent sub-resources back (best-effort: only move ones currently on the survivor)
      for (const table of ['patient_identifiers', 'patient_contacts', 'patient_allergies', 'patient_consents']) {
        await tx.query(
          `UPDATE ${table} SET patient_id = $1 WHERE patient_id = $2 AND created_at <= $3`,
          [merge.merged_patient_id, merge.surviving_patient_id, merge.created_at],
        );
      }

      // Mark merge as REVERSED
      await tx.query(`UPDATE patient_merges SET status = 'REVERSED' WHERE id = $1`, [mergeId]);

      return { unmerged: true };
    });
  }

  // ── Consents ──────────────────────────────────────────────────────────────

  async captureConsent(tenantId: string, userId: string, patientId: string, dto: ConsentCaptureRequest) {
    return withTenant({ tenantId, userId }, async (tx) => {
      const res = await tx.query(
        `INSERT INTO patient_consents (tenant_id, patient_id, template_version_id, status, file_id)
         VALUES ($1, $2, $3, 'ACTIVE', $4) RETURNING id, status, created_at`,
        [tenantId, patientId, dto.templateVersionId, dto.fileId ?? null],
      );
      // Remove emergency-registration flag if present
      await tx.query(
        `DELETE FROM patient_flags WHERE patient_id = $1 AND title = 'Emergency Registration'`,
        [patientId],
      );
      return res.rows[0];
    });
  }

  async withdrawConsent(tenantId: string, userId: string, patientId: string, consentId: string, dto: ConsentWithdrawRequest) {
    return withTenant({ tenantId, userId }, async (tx) => {
      const res = await tx.query(
        `UPDATE patient_consents SET status = 'WITHDRAWN', withdrawn_at = now()
         WHERE id = $1 AND patient_id = $2 AND status = 'ACTIVE'
         RETURNING id, status, withdrawn_at`,
        [consentId, patientId],
      );
      if ((res.rowCount ?? 0) === 0) throw new ProblemException('NOT_FOUND', { detail: 'Active consent not found' });
      await tx.query(
        `INSERT INTO patient_flags (tenant_id, patient_id, title, description, level)
         VALUES ($1, $2, 'Consent Withdrawn', $3, 'WARNING')`,
        [tenantId, patientId, dto.reason],
      );
      return res.rows[0];
    });
  }

  // ── PhilHealth ────────────────────────────────────────────────────────────

  async upsertPhilHealth(tenantId: string, userId: string, patientId: string, dto: PhilHealthDataRequest) {
    return withTenant({ tenantId, userId }, async (tx) => {
      const res = await tx.query(
        `INSERT INTO patient_philhealth (tenant_id, patient_id, pin, membership_category, konsulta_pcp, konsulta_status)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (patient_id) DO UPDATE SET
           pin = EXCLUDED.pin,
           membership_category = EXCLUDED.membership_category,
           konsulta_pcp = EXCLUDED.konsulta_pcp,
           konsulta_status = EXCLUDED.konsulta_status,
           updated_at = now()
         RETURNING id, pin, membership_category, konsulta_status`,
        [tenantId, patientId, dto.pin, dto.membershipCategory, dto.konsultaPcp ?? null, dto.konsultaStatus ?? 'NOT_REGISTERED'],
      );
      return res.rows[0];
    });
  }

  async addPhilHealthDependent(tenantId: string, userId: string, patientId: string, dto: PhilHealthDependentRequest) {
    return withTenant({ tenantId, userId }, async (tx) => {
      const res = await tx.query(
        `INSERT INTO patient_philhealth_dependents (tenant_id, patient_id, dependent_first_name, dependent_last_name, dependent_dob, dependent_relationship)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, dependent_first_name, dependent_last_name, dependent_relationship`,
        [tenantId, patientId, dto.dependentFirstName, dto.dependentLastName, dto.dependentDob, dto.dependentRelationship],
      );
      return res.rows[0];
    });
  }

  // ── Pre-registration duplicate check ───────────────────────────────────────

  async checkDuplicates(tenantId: string, userId: string, dto: CheckDuplicatesRequest) {
    return withTenant({ tenantId, userId }, async (tx) => {
      const res = await tx.query(
        `SELECT id, first_name, last_name, date_of_birth, gender, status,
                similarity(first_name || ' ' || last_name, $1) AS name_sim
         FROM patients
         WHERE status NOT IN ('MERGED', 'DECEASED')
           AND (
             similarity(first_name || ' ' || last_name, $1) > 0.4
             OR (date_of_birth = $2 AND (first_name ILIKE $3 OR last_name ILIKE $4))
           )
         ORDER BY name_sim DESC
         LIMIT 20`,
        [`${dto.firstName} ${dto.lastName}`, dto.dateOfBirth, `%${dto.firstName}%`, `%${dto.lastName}%`],
      );
      return { candidates: res.rows };
    });
  }

  // ── Access log & Summary ───────────────────────────────────────────────────

  async getAccessLog(tenantId: string, userId: string, patientId: string) {
    return withTenant({ tenantId, userId }, async (tx) => {
      const res = await tx.query(
        `SELECT id, created_at, actor_id, resource, purpose, request_id
         FROM phi_access_log
         WHERE patient_id = $1
         ORDER BY created_at DESC
         LIMIT 50`,
        [patientId],
      );
      return { data: res.rows };
    });
  }

  async getSummary(tenantId: string, userId: string, patientId: string) {
    return withTenant({ tenantId, userId }, async (tx) => {
      const patRes = await tx.query(
        `SELECT p.id, p.first_name, p.last_name, p.middle_name, p.date_of_birth, p.gender, p.status, p.created_at,
                (SELECT json_agg(json_build_object('id', pf.id, 'title', pf.title, 'level', pf.level)) FROM patient_flags pf WHERE pf.patient_id = p.id) AS flags,
                (SELECT json_agg(json_build_object('id', pa.id, 'substance', pa.substance, 'severity', pa.severity)) FROM patient_allergies pa WHERE pa.patient_id = p.id) AS allergies,
                (SELECT json_build_object('pin', pp.pin, 'membershipCategory', pp.membership_category, 'konsultaStatus', pp.konsulta_status) FROM patient_philhealth pp WHERE pp.patient_id = p.id) AS philhealth,
                (SELECT json_build_object('id', pco.id, 'status', pco.status, 'createdAt', pco.created_at) FROM patient_consents pco WHERE pco.patient_id = p.id AND pco.status = 'ACTIVE' ORDER BY pco.created_at DESC LIMIT 1) AS active_consent
         FROM patients p
         WHERE p.id = $1`,
        [patientId],
      );
      if ((patRes.rowCount ?? 0) === 0) throw new ProblemException('NOT_FOUND', { detail: 'Patient not found' });
      return patRes.rows[0];
    });
  }
}
