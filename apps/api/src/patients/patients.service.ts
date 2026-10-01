import { Injectable } from '@nestjs/common';
import { getAppPool, withTenant } from '@clinic/db';
import { ProblemException } from '../http/problem.exception.js';

@Injectable()
export class PatientsService {
  async getPatient(tenantId: string, patientId: string) {
    const pool = getAppPool();
    const res = await pool.query(`SELECT * FROM patients WHERE id = $1 AND tenant_id = $2`, [patientId, tenantId]);
    if (res.rowCount === 0) throw new ProblemException('NOT_FOUND', { detail: 'Patient not found' });
    return res.rows[0];
  }

  async listPatients(tenantId: string, q?: string) {
    const pool = getAppPool();
    let query = `SELECT * FROM patients WHERE tenant_id = $1`;
    const params: any[] = [tenantId];
    if (q) {
      query += ` AND (first_name ILIKE $2 OR last_name ILIKE $2)`;
      params.push(`%${q}%`);
    }
    query += ` ORDER BY last_name, first_name LIMIT 50`;
    const res = await pool.query(query, params);
    return { data: res.rows };
  }

  async createPatient(tenantId: string, userId: string, dto: any) {
    return withTenant({ tenantId, userId }, async (tx) => {
      // Basic insert
      const res = await tx.query(
        `INSERT INTO patients (tenant_id, first_name, last_name, date_of_birth, gender)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [tenantId, dto.firstName, dto.lastName, dto.dateOfBirth, dto.gender]
      );
      return res.rows[0];
    });
  }
}
