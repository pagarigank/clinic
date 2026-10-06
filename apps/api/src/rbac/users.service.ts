import { Injectable } from "@nestjs/common";
import {
  UserCreateSchema,
  UserUpdateSchema,
  UserPasswordResetSchema,
  EmployeeUpsertSchema,
  type UserList,
  type Employee,
  type EmployeeWithUser,
} from "@clinic/contracts";
import { withTenant, type PoolClient } from "@clinic/db";
import { sha256 } from "../auth/mfa.service.js";
import { PasswordService } from "../auth/crypto/password.js";
import { randomBytes } from "node:crypto";
import { ProblemException } from "../http/problem.exception.js";
import { RbacService } from "./rbac.service.js";

interface UserRow {
  id: string;
  email: string;
  name: string;
  status: string;
  mfa_enabled: boolean;
  last_login_at: Date | null;
  row_version: number;
}

const USER_STATUSES = ["INVITED", "ACTIVE", "LOCKED", "DEACTIVATED"] as const;
type UserStatus = (typeof USER_STATUSES)[number];

/**
 * Admin user directory and lifecycle (specification §18.2, lines 1029–1035).
 *
 * Every read and write runs inside `withTenant`, so RLS (policy B,
 * tenant_or_platform on `users`) remains the security boundary; the service
 * only narrows it. Writes are audited by the global AuditInterceptor.
 *
 * Creation is invitation-shaped: the account is born `INVITED` with a random
 * Argon2id one-time secret and `must set password via forgot` — the platform
 * never sets or emails a working password on a member's behalf (architecture
 * §10: the password-reset flow is the only credential handover path).
 */
@Injectable()
export class UsersService {
  // Explicit no-DI constructor: esbuild/tsx does not emit design:paramtypes.
  private readonly passwords = new PasswordService();

  // ---- reads --------------------------------------------------------------

  async list(tenantId: string, userId: string): Promise<UserList[]> {
    return withTenant({ tenantId, userId }, async (tx) => {
      const rows = await tx.query<UserRow>(
        `SELECT id, email, name, status, mfa_enabled, last_login_at, row_version
         FROM users
         WHERE tenant_id = (SELECT app.tenant_id())
         ORDER BY name, email`,
      );
      const roleRows = await tx.query<{ user_id: string; id: string; code: string; name: string }>(
        `SELECT ur.user_id, ro.id, ro.code, ro.name
         FROM user_roles ur
         JOIN roles ro ON ro.tenant_id = ur.tenant_id AND ro.id = ur.role_id
         WHERE ur.tenant_id = (SELECT app.tenant_id())
           AND ur.branch_id IS NULL
           AND ro.deleted_at IS NULL
         ORDER BY ur.user_id, ro.code`,
      );
      const branchRows = await tx.query<{ user_id: string; id: string; name: string; is_default: boolean }>(
        `SELECT ub.user_id, b.id, b.name, ub.is_default
         FROM user_branches ub
         JOIN branches b ON b.tenant_id = ub.tenant_id AND b.id = ub.branch_id
         WHERE ub.tenant_id = (SELECT app.tenant_id()) AND b.deleted_at IS NULL
         ORDER BY ub.user_id, b.name`,
      );
      const empRows = await tx.query<any>(
        `SELECT id, user_id, employee_no, job_title, department, employment_type,
                specialization, prc_license_no, ptr_no, s2_license_no, phone,
                to_char(hire_date, 'YYYY-MM-DD') as hire_date,
                emergency_contact_name, emergency_contact_phone,
                emergency_contact_relationship, tin, sss_no, philhealth_no, notes,
                status, row_version, created_at, updated_at
         FROM employees
         WHERE tenant_id = (SELECT app.tenant_id())`,
      );
      const rolesByUser = new Map<string, UserList["roles"]>();
      for (const r of roleRows.rows) {
        const list = rolesByUser.get(r.user_id) ?? [];
        list.push({ id: r.id, code: r.code, name: r.name });
        rolesByUser.set(r.user_id, list);
      }
      const branchesByUser = new Map<string, UserList["branches"]>();
      for (const b of branchRows.rows) {
        const list = branchesByUser.get(b.user_id) ?? [];
        list.push({ id: b.id, name: b.name, isDefault: b.is_default });
        branchesByUser.set(b.user_id, list);
      }
      const empByUser = new Map<string, Employee>();
      for (const e of empRows.rows) {
        empByUser.set(e.user_id, this.toEmployeeDto(e));
      }
      return rows.rows.map((u) => ({
        id: u.id,
        email: u.email,
        name: u.name,
        status: (USER_STATUSES as readonly string[]).includes(u.status)
          ? (u.status as UserStatus)
          : "ACTIVE",
        mfaEnabled: u.mfa_enabled,
        roles: rolesByUser.get(u.id) ?? [],
        branches: branchesByUser.get(u.id) ?? [],
        employee: empByUser.get(u.id) ?? null,
        lastLoginAt: u.last_login_at ? u.last_login_at.toISOString() : null,
        rowVersion: u.row_version,
      }));
    });
  }

  // ---- create -------------------------------------------------------------

  async create(tenantId: string, actorId: string, dto: unknown): Promise<UserList> {
    const input = UserCreateSchema.parse(dto);
    return withTenant({ tenantId, userId: actorId }, async (tx) => {
      const dup = await tx.query<{ id: string }>(
        `SELECT id FROM users WHERE tenant_id = (SELECT app.tenant_id()) AND lower(email) = $1`,
        [input.email.toLowerCase()],
      );
      if (dup.rows.length > 0) {
        throw new ProblemException("CONFLICT", { detail: "email already exists in this clinic" });
      }

      // Roles are optional at invite time (todo §1.3 keeps SoD on the final
      // union, and assignUserRoles can complete assignment later) — but any
      // ids sent must be real, undeleted roles of this tenant.
      if (input.roleIds.length > 0) {
        await this.assertRolesExist(tx, input.roleIds);
      }

      // The member sets their own credential through the audited forgot/reset
      // flow; this placeholder is not verifiable and exists only to satisfy
      // NOT NULL + block the account until first access.
      const oneTimeSecret = randomBytes(24).toString("hex");
      const passwordHash = await this.passwords.hashPassword(oneTimeSecret);
      const inserted = await tx.query<UserRow>(
        `INSERT INTO users (tenant_id, email, name, password_hash, status, created_by, updated_by)
         VALUES ((SELECT app.tenant_id()), $1, $2, $3, 'INVITED', $4, $4)
         RETURNING id, email, name, status, mfa_enabled, last_login_at, row_version`,
        [input.email, input.name, passwordHash, actorId],
      );
      const user = mustRow(inserted.rows, "user insert");

      for (const roleId of input.roleIds) {
        await tx.query(
          `INSERT INTO user_roles (tenant_id, user_id, role_id, branch_id)
           VALUES ((SELECT app.tenant_id()), $1, $2, NULL)
           ON CONFLICT DO NOTHING`,
          [user.id, roleId],
        );
      }

      if (input.roleIds.length > 0) {
        // Same check as role assignment: SoD is enforced on the final union,
        // so a fresh account cannot be born holding both halves of a conflict
        // (todo §1.3 made create+update+clone+assign consistent).
        await this.assertNoSoDConflicts(tx, user.id);
      }

      if (input.employee) {
        await tx.query(
          `INSERT INTO employees (
             tenant_id, user_id, employee_no, job_title, department, employment_type,
             specialization, prc_license_no, ptr_no, s2_license_no, phone,
             hire_date, emergency_contact_name, emergency_contact_phone,
             emergency_contact_relationship, tin, sss_no, philhealth_no, notes,
             status, created_by, updated_by
           ) VALUES (
             (SELECT app.tenant_id()), $1, $2, $3, $4, $5,
             $6, $7, $8, $9, $10,
             $11, $12, $13,
             $14, $15, $16, $17, $18,
             $19, $20, $20
           )`,
          [
            user.id,
            input.employee.employeeNo,
            input.employee.jobTitle,
            input.employee.department,
            input.employee.employmentType,
            input.employee.specialization ?? null,
            input.employee.prcLicenseNo ?? null,
            input.employee.ptrNo ?? null,
            input.employee.s2LicenseNo ?? null,
            input.employee.phone ?? null,
            input.employee.hireDate ? input.employee.hireDate : null,
            input.employee.emergencyContactName ?? null,
            input.employee.emergencyContactPhone ?? null,
            input.employee.emergencyContactRelationship ?? null,
            input.employee.tin ?? null,
            input.employee.sssNo ?? null,
            input.employee.philhealthNo ?? null,
            input.employee.notes ?? null,
            input.employee.status ?? 'ACTIVE',
            actorId,
          ],
        );
      }

      return this.hydrateOne(tx, user);
    });
  }

  // ---- update -------------------------------------------------------------

  async update(tenantId: string, actorId: string, targetId: string, dto: unknown): Promise<UserList> {
    const input = UserUpdateSchema.parse(dto);
    return withTenant({ tenantId, userId: actorId }, async (tx) => {
      const target = await this.findUser(tx, targetId);
      if (input.rowVersion !== undefined && input.rowVersion !== target.row_version) {
        throw new ProblemException("STALE_ROW_VERSION");
      }
      const updated = await tx.query<UserRow>(
        `UPDATE users SET name = $2, updated_at = now(), updated_by = $3, row_version = row_version + 1
         WHERE tenant_id = (SELECT app.tenant_id()) AND id = $1
         RETURNING id, email, name, status, mfa_enabled, last_login_at, row_version`,
        [targetId, input.name ?? target.name, actorId],
      );
      const row = mustRow(updated.rows, "user update");
      return this.hydrateOne(tx, row);
    });
  }

  // ---- lifecycle ----------------------------------------------------------

  /** Deactivate: append-only (no deletes anywhere — todo §49). */
  async deactivate(tenantId: string, actorId: string, targetId: string): Promise<{ deactivated: true }> {
    return withTenant({ tenantId, userId: actorId }, async (tx) => {
      const target = await this.findUser(tx, targetId);
      if (target.id === actorId) {
        throw new ProblemException("CONFLICT", { detail: "you cannot deactivate your own account" });
      }
      await tx.query(
        `UPDATE users SET status = 'DEACTIVATED', deactivated_at = now(), updated_at = now(), updated_by = $2, row_version = row_version + 1
         WHERE tenant_id = (SELECT app.tenant_id()) AND id = $1`,
        [targetId, actorId],
      );
      await this.revokeCredentials(tx, targetId, "deactivated");
      return { deactivated: true as const };
    });
  }

  async reactivate(tenantId: string, actorId: string, targetId: string): Promise<{ reactivated: true }> {
    const oneTimeSecret = randomBytes(24).toString("hex");
    const passwordHash = await this.passwords.hashPassword(oneTimeSecret);
    return withTenant({ tenantId, userId: actorId }, async (deactivatedTx) => {
      const target = await this.findUser(deactivatedTx, targetId);
      if (target.status !== "DEACTIVATED") {
        throw new ProblemException("CONFLICT", {
          detail: `cannot reactivate a user whose status is ${target.status}`,
        });
      }
      // A reactivated member must re-establish credentials through the audited
      // forgot/reset flow — the pre-deactivation password never survives.
      await deactivatedTx.query(
        `UPDATE users SET status = 'INVITED', password_hash = $3, deactivated_at = NULL, updated_at = now(), updated_by = $2, row_version = row_version + 1
         WHERE tenant_id = (SELECT app.tenant_id()) AND id = $1`,
        [targetId, actorId, passwordHash],
      );
      return { reactivated: true as const };
    });
  }

  async unlock(tenantId: string, actorId: string, targetId: string): Promise<{ unlocked: true }> {
    return withTenant({ tenantId, userId: actorId }, async (tx) => {
      await this.findUser(tx, targetId);
      await tx.query(
        `UPDATE users SET locked_until = NULL, failed_login_count = 0, updated_at = now(), updated_by = $2, row_version = row_version + 1
         WHERE tenant_id = (SELECT app.tenant_id()) AND id = $1`,
        [targetId, actorId],
      );
      return { unlocked: true as const };
    });
  }

  async resetMfa(tenantId: string, actorId: string, targetId: string): Promise<{ reset: true }> {
    return withTenant({ tenantId, userId: actorId }, async (tx) => {
      await this.findUser(tx, targetId);
      await tx.query(
        `UPDATE users SET mfa_secret = NULL, mfa_enabled = false, updated_at = now(), updated_by = $2, row_version = row_version + 1
         WHERE tenant_id = (SELECT app.tenant_id()) AND id = $1`,
        [targetId, actorId],
      );
      await tx.query(`DELETE FROM mfa_secrets WHERE tenant_id = (SELECT app.tenant_id()) AND user_id = $1`, [
        targetId,
      ]);
      await tx.query(
        `UPDATE sessions SET revoked_at = now(), revoked_reason = 'mfa_reset'
         WHERE tenant_id = (SELECT app.tenant_id()) AND user_id = $1 AND revoked_at IS NULL`,
        [targetId],
      );
      return { reset: true as const };
    });
  }

  /**
   * Admin-forced credential reset: verifies the platform password policy,
   * sets the hash, and kills every live session. The member can log in with
   * the new secret (and must enrol MFA again if it was reset).
   */
  async forcePasswordReset(
    tenantId: string,
    actorId: string,
    targetId: string,
    dto: unknown,
  ): Promise<{ reset: true }> {
    const input = UserPasswordResetSchema.parse(dto);
    const policy = this.passwords.validatePolicy(input.newPassword);
    if (!policy.ok) {
      throw new ProblemException("VALIDATION_FAILED", { errors: policy.errors });
    }
    const passwordHash = await this.passwords.hashPassword(input.newPassword);
    return withTenant({ tenantId, userId: actorId }, async (tx) => {
      const target = await this.findUser(tx, targetId);
      if (target.status === "DEACTIVATED") {
        throw new ProblemException("CONFLICT", { detail: "cannot reset the password of a deactivated user" });
      }
      await tx.query(
        `UPDATE users SET password_hash = $2, failed_login_count = 0, locked_until = NULL,
                updated_at = now(), updated_by = $3, row_version = row_version + 1
         WHERE tenant_id = (SELECT app.tenant_id()) AND id = $1`,
        [targetId, passwordHash, actorId],
      );
      await this.revokeCredentials(tx, targetId, "password_reset");
      return { reset: true as const };
    });
  }

  // ---- helpers ------------------------------------------------------------

  private async hydrateOne(tx: PoolClient, row: UserRow): Promise<UserList> {
    const roleRows = await tx.query<{ id: string; code: string; name: string }>(
      `SELECT ro.id, ro.code, ro.name
       FROM user_roles ur
       JOIN roles ro ON ro.tenant_id = ur.tenant_id AND ro.id = ur.role_id
       WHERE ur.tenant_id = (SELECT app.tenant_id()) AND ur.user_id = $1
         AND ur.branch_id IS NULL AND ro.deleted_at IS NULL
       ORDER BY ro.code`,
      [row.id],
    );
    const branchRows = await tx.query<{ id: string; name: string; is_default: boolean }>(
      `SELECT b.id, b.name, ub.is_default
       FROM user_branches ub
       JOIN branches b ON b.tenant_id = ub.tenant_id AND b.id = ub.branch_id
       WHERE ub.tenant_id = (SELECT app.tenant_id()) AND ub.user_id = $1 AND b.deleted_at IS NULL
       ORDER BY b.name`,
      [row.id],
    );
    const empRow = await tx.query<any>(
      `SELECT id, user_id, employee_no, job_title, department, employment_type,
              specialization, prc_license_no, ptr_no, s2_license_no, phone,
              to_char(hire_date, 'YYYY-MM-DD') as hire_date,
              emergency_contact_name, emergency_contact_phone,
              emergency_contact_relationship, tin, sss_no, philhealth_no, notes,
              status, row_version, created_at, updated_at
       FROM employees
       WHERE tenant_id = (SELECT app.tenant_id()) AND user_id = $1`,
      [row.id],
    );
    const emp = empRow.rows[0] ? this.toEmployeeDto(empRow.rows[0]) : null;
    return this.toDto(
      row,
      roleRows.rows.map((r) => ({ id: r.id, code: r.code, name: r.name })),
      branchRows.rows.map((b) => ({ id: b.id, name: b.name, isDefault: b.is_default })),
      emp,
    );
  }

  private toDto(
    row: UserRow,
    roles: UserList["roles"],
    branches: UserList["branches"],
    employee?: Employee | null,
  ): UserList {
    return {
      id: row.id,
      email: row.email,
      name: row.name,
      status: (USER_STATUSES as readonly string[]).includes(row.status)
        ? (row.status as UserStatus)
        : "ACTIVE",
      mfaEnabled: row.mfa_enabled,
      roles,
      branches,
      employee: employee ?? null,
      lastLoginAt: row.last_login_at ? row.last_login_at.toISOString() : null,
      rowVersion: row.row_version,
    };
  }

  private toEmployeeDto(r: any): Employee {
    return {
      id: r.id,
      userId: r.user_id,
      employeeNo: r.employee_no,
      jobTitle: r.job_title,
      department: r.department,
      employmentType: r.employment_type,
      specialization: r.specialization ?? null,
      prcLicenseNo: r.prc_license_no ?? null,
      ptrNo: r.ptr_no ?? null,
      s2LicenseNo: r.s2_license_no ?? null,
      phone: r.phone ?? null,
      hireDate: r.hire_date ?? null,
      emergencyContactName: r.emergency_contact_name ?? null,
      emergencyContactPhone: r.emergency_contact_phone ?? null,
      emergencyContactRelationship: r.emergency_contact_relationship ?? null,
      tin: r.tin ?? null,
      sssNo: r.sss_no ?? null,
      philhealthNo: r.philhealth_no ?? null,
      notes: r.notes ?? null,
      status: r.status,
      rowVersion: r.row_version,
      createdAt: r.created_at ? new Date(r.created_at).toISOString() : undefined,
      updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : undefined,
    };
  }

  // ---- Employee Information CRUD -----------------------------------------

  async listEmployees(tenantId: string, actorId: string): Promise<EmployeeWithUser[]> {
    return withTenant({ tenantId, userId: actorId }, async (tx) => {
      const rows = await tx.query<any>(
        `SELECT e.id, e.user_id, e.employee_no, e.job_title, e.department, e.employment_type,
                e.specialization, e.prc_license_no, e.ptr_no, e.s2_license_no, e.phone,
                to_char(e.hire_date, 'YYYY-MM-DD') as hire_date,
                e.emergency_contact_name, e.emergency_contact_phone,
                e.emergency_contact_relationship, e.tin, e.sss_no, e.philhealth_no, e.notes,
                e.status, e.row_version, e.created_at, e.updated_at,
                u.name as user_name, u.email as user_email, u.status as user_status
         FROM employees e
         JOIN users u ON u.tenant_id = e.tenant_id AND u.id = e.user_id
         WHERE e.tenant_id = (SELECT app.tenant_id())
         ORDER BY e.employee_no, u.name`,
      );
      const roleRows = await tx.query<{ user_id: string; role_name: string }>(
        `SELECT ur.user_id, ro.name as role_name
         FROM user_roles ur
         JOIN roles ro ON ro.tenant_id = ur.tenant_id AND ro.id = ur.role_id
         WHERE ur.tenant_id = (SELECT app.tenant_id()) AND ro.deleted_at IS NULL`,
      );
      const rolesByUser = new Map<string, string[]>();
      for (const r of roleRows.rows) {
        const arr = rolesByUser.get(r.user_id) ?? [];
        arr.push(r.role_name);
        rolesByUser.set(r.user_id, arr);
      }

      return rows.rows.map((r: any) => ({
        ...this.toEmployeeDto(r),
        userName: r.user_name,
        userEmail: r.user_email,
        userStatus: r.user_status,
        userRoles: rolesByUser.get(r.user_id) ?? [],
      }));
    });
  }

  async getEmployee(tenantId: string, actorId: string, targetUserId: string): Promise<Employee | null> {
    return withTenant({ tenantId, userId: actorId }, async (tx) => {
      await this.findUser(tx, targetUserId);
      const res = await tx.query<any>(
        `SELECT id, user_id, employee_no, job_title, department, employment_type,
                specialization, prc_license_no, ptr_no, s2_license_no, phone,
                to_char(hire_date, 'YYYY-MM-DD') as hire_date,
                emergency_contact_name, emergency_contact_phone,
                emergency_contact_relationship, tin, sss_no, philhealth_no, notes,
                status, row_version, created_at, updated_at
         FROM employees
         WHERE tenant_id = (SELECT app.tenant_id()) AND user_id = $1`,
        [targetUserId],
      );
      return res.rows[0] ? this.toEmployeeDto(res.rows[0]) : null;
    });
  }

  async upsertEmployee(tenantId: string, actorId: string, targetUserId: string, dto: unknown): Promise<Employee> {
    const input = EmployeeUpsertSchema.parse(dto);
    return withTenant({ tenantId, userId: actorId }, async (tx) => {
      await this.findUser(tx, targetUserId);

      const dup = await tx.query<{ id: string }>(
        `SELECT id FROM employees
         WHERE tenant_id = (SELECT app.tenant_id()) AND lower(employee_no) = $1 AND user_id != $2`,
        [input.employeeNo.toLowerCase(), targetUserId],
      );
      if (dup.rows.length > 0) {
        throw new ProblemException("CONFLICT", { detail: "employee number is already in use by another staff member" });
      }

      const existing = await tx.query<any>(
        `SELECT id, row_version FROM employees WHERE tenant_id = (SELECT app.tenant_id()) AND user_id = $1`,
        [targetUserId],
      );

      let resultRow;
      if (existing.rows.length === 0) {
        const inserted = await tx.query<any>(
          `INSERT INTO employees (
             tenant_id, user_id, employee_no, job_title, department, employment_type,
             specialization, prc_license_no, ptr_no, s2_license_no, phone,
             hire_date, emergency_contact_name, emergency_contact_phone,
             emergency_contact_relationship, tin, sss_no, philhealth_no, notes,
             status, created_by, updated_by
           ) VALUES (
             (SELECT app.tenant_id()), $1, $2, $3, $4, $5,
             $6, $7, $8, $9, $10,
             $11, $12, $13,
             $14, $15, $16, $17, $18,
             $19, $20, $20
           )
           RETURNING id, user_id, employee_no, job_title, department, employment_type,
                     specialization, prc_license_no, ptr_no, s2_license_no, phone,
                     to_char(hire_date, 'YYYY-MM-DD') as hire_date,
                     emergency_contact_name, emergency_contact_phone,
                     emergency_contact_relationship, tin, sss_no, philhealth_no, notes,
                     status, row_version, created_at, updated_at`,
          [
            targetUserId,
            input.employeeNo,
            input.jobTitle,
            input.department,
            input.employmentType,
            input.specialization ?? null,
            input.prcLicenseNo ?? null,
            input.ptrNo ?? null,
            input.s2LicenseNo ?? null,
            input.phone ?? null,
            input.hireDate ? input.hireDate : null,
            input.emergencyContactName ?? null,
            input.emergencyContactPhone ?? null,
            input.emergencyContactRelationship ?? null,
            input.tin ?? null,
            input.sssNo ?? null,
            input.philhealthNo ?? null,
            input.notes ?? null,
            input.status ?? 'ACTIVE',
            actorId,
          ],
        );
        resultRow = inserted.rows[0];
      } else {
        const current = existing.rows[0];
        if (input.rowVersion !== undefined && input.rowVersion !== current.row_version) {
          throw new ProblemException("STALE_ROW_VERSION");
        }
        const updated = await tx.query<any>(
          `UPDATE employees SET
             employee_no = $2, job_title = $3, department = $4, employment_type = $5,
             specialization = $6, prc_license_no = $7, ptr_no = $8, s2_license_no = $9, phone = $10,
             hire_date = $11, emergency_contact_name = $12, emergency_contact_phone = $13,
             emergency_contact_relationship = $14, tin = $15, sss_no = $16, philhealth_no = $17, notes = $18,
             status = $19, updated_at = now(), updated_by = $20, row_version = row_version + 1
           WHERE tenant_id = (SELECT app.tenant_id()) AND user_id = $1
           RETURNING id, user_id, employee_no, job_title, department, employment_type,
                     specialization, prc_license_no, ptr_no, s2_license_no, phone,
                     to_char(hire_date, 'YYYY-MM-DD') as hire_date,
                     emergency_contact_name, emergency_contact_phone,
                     emergency_contact_relationship, tin, sss_no, philhealth_no, notes,
                     status, row_version, created_at, updated_at`,
          [
            targetUserId,
            input.employeeNo,
            input.jobTitle,
            input.department,
            input.employmentType,
            input.specialization ?? null,
            input.prcLicenseNo ?? null,
            input.ptrNo ?? null,
            input.s2LicenseNo ?? null,
            input.phone ?? null,
            input.hireDate ? input.hireDate : null,
            input.emergencyContactName ?? null,
            input.emergencyContactPhone ?? null,
            input.emergencyContactRelationship ?? null,
            input.tin ?? null,
            input.sssNo ?? null,
            input.philhealthNo ?? null,
            input.notes ?? null,
            input.status ?? 'ACTIVE',
            actorId,
          ],
        );
        resultRow = updated.rows[0];
      }
      return this.toEmployeeDto(resultRow);
    });
  }

  async deleteEmployee(tenantId: string, actorId: string, targetUserId: string): Promise<{ deleted: true }> {
    return withTenant({ tenantId, userId: actorId }, async (tx) => {
      await this.findUser(tx, targetUserId);
      await tx.query(
        `DELETE FROM employees WHERE tenant_id = (SELECT app.tenant_id()) AND user_id = $1`,
        [targetUserId],
      );
      return { deleted: true as const };
    });
  }

  private async findUser(tx: PoolClient, userId: string): Promise<UserRow> {
    const r = await tx.query<UserRow>(
      `SELECT id, email, name, status, mfa_enabled, last_login_at, row_version
       FROM users
       WHERE tenant_id = (SELECT app.tenant_id()) AND id = $1`,
      [userId],
    );
    const row = r.rows[0];
    if (!row) throw new ProblemException("NOT_FOUND", { detail: "user not found" });
    return row;
  }

  private async assertRolesExist(tx: PoolClient, roleIds: readonly string[]): Promise<void> {
    const ids = [...roleIds];
    const roles = await tx.query<{ id: string }>(
      `SELECT id FROM roles
       WHERE tenant_id = (SELECT app.tenant_id()) AND id = ANY($1) AND deleted_at IS NULL`,
      [ids],
    );
    if (roles.rows.length !== new Set(ids).size) {
      throw new ProblemException("NOT_FOUND", { detail: "one or more roles do not exist" });
    }
  }

  /** SoD over the target's full permission union, mirroring RbacService. */
  private async assertNoSoDConflicts(tx: PoolClient, targetUserId: string): Promise<void> {
    const union = await tx.query<{ permission_code: string }>(
      `SELECT DISTINCT p.code AS permission_code
       FROM user_roles ur
       JOIN role_permissions rp ON rp.tenant_id = ur.tenant_id AND rp.role_id = ur.role_id
       JOIN permissions p ON p.id = rp.permission_id
       WHERE ur.tenant_id = (SELECT app.tenant_id()) AND ur.user_id = $1`,
      [targetUserId],
    );
    const codes = new Set(union.rows.map((r) => r.permission_code));
    const conflicts = await tx.query<{ permission_a: string; permission_b: string; rationale: string }>(
      `SELECT permission_a, permission_b, rationale FROM sod_conflicts`,
    );
    for (const row of conflicts.rows) {
      if (codes.has(row.permission_a) && codes.has(row.permission_b)) {
        throw new ProblemException("SEGREGATION_OF_DUTIES", {
          detail: `${row.permission_a} + ${row.permission_b} may not be held together: ${row.rationale}`,
        });
      }
    }
  }

  private async revokeCredentials(tx: PoolClient, targetId: string, reason: string): Promise<void> {
    await tx.query(
      `UPDATE sessions SET revoked_at = now(), revoked_reason = $2
       WHERE tenant_id = (SELECT app.tenant_id()) AND user_id = $1 AND revoked_at IS NULL`,
      [targetId, reason],
    );
  }
}

/** Postgres RETURNING always yields the row for these statements; fail loud if not. */
function mustRow(rows: readonly UserRow[], what: string): UserRow {
  const row = rows[0];
  if (!row) throw new ProblemException("CONFLICT", { detail: `${what} returned no row` });
  return row;
}
